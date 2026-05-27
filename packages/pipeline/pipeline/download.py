import json
from pathlib import Path
from typing import Generator

import httpx

from .config import Config
from .models import WorkMetadata


# Azbyka.ru added an auth-wall on epub downloads in 2026. Without a logged-in
# session, /otechnik/books/download/<id>/<file>.epub returns 302 → /auth/, and
# follow_redirects=True silently saves the HTML login page as the epub.
#
# Store the Cookie header value (verbatim from DevTools "Copy as cURL") in
# packages/pipeline/.azbyka_session.txt (gitignored). Refresh when sessions
# expire (look for HTML payloads instead of epubs in data/<author>/epubs/).
#
# Browser User-Agent helps avoid bot heuristics on the same endpoint.
_AZBYKA_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
)


def _load_azbyka_cookies(repo_root: Path) -> str | None:
    path = repo_root / ".azbyka_session.txt"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    return text or None


class Downloader:
    def __init__(self, config: Config):
        self.config = config
        cookies_str = _load_azbyka_cookies(config.data_dir.parent)
        headers = {"User-Agent": _AZBYKA_UA}
        if cookies_str:
            headers["Cookie"] = cookies_str
            print(f"[downloader] using azbyka session cookies "
                  f"({len(cookies_str)} chars)", flush=True)
        else:
            print("[downloader] WARNING: no .azbyka_session.txt found — "
                  "downloads will likely be HTML login pages, not epubs",
                  flush=True)
        # follow_redirects=False so we DETECT the auth redirect instead of
        # silently saving the login page. download_epub() will print a clear
        # error if redirected.
        self.client = httpx.Client(
            timeout=60.0,
            follow_redirects=False,
            headers=headers,
        )

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def iter_metadata_files(self) -> Generator[Path, None, None]:
        data_dir = self.config.data_dir
        if not data_dir.exists():
            return

        for json_path in data_dir.rglob("*.json"):
            yield json_path

    def download_epub(self, work: WorkMetadata, json_path: Path) -> str | None:
        if not work.epub_url:
            return None

        epub_dir = json_path.parent / "epubs"
        epub_dir.mkdir(parents=True, exist_ok=True)

        epub_filename = json_path.stem + ".epub"
        epub_path = epub_dir / epub_filename

        if epub_path.exists():
            return str(epub_path.relative_to(self.config.data_dir.parent))

        try:
            response = self.client.get(work.epub_url)
            # Detect auth redirects explicitly (follow_redirects=False).
            if response.status_code in (301, 302, 303, 307, 308):
                target = response.headers.get("location", "?")
                print(f"      [auth] {response.status_code} → {target[:80]}")
                print(f"      Hint: refresh .azbyka_session.txt cookies")
                return None
            response.raise_for_status()

            # Guard against HTML payloads masquerading as epubs (defence in
            # depth — if the redirect detection above ever misses, content
            # sniffing catches it).
            head = response.content[:4]
            if head[:2] != b"PK":
                ct = response.headers.get("content-type", "?")
                print(f"      [skip] not a zip (Content-Type={ct}, "
                      f"head={head!r})")
                return None

            with open(epub_path, "wb") as f:
                f.write(response.content)

            return str(epub_path.relative_to(self.config.data_dir.parent))
        except httpx.HTTPError as e:
            print(f"Failed to download {work.epub_url}: {e}")
            return None

    def update_metadata(self, json_path: Path, epub_path: str):
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        data["epub_path"] = epub_path

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def run(self):
        for json_path in self.iter_metadata_files():
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            work = WorkMetadata(**data)

            if work.epub_path:
                print(f"Already downloaded: {work.title}")
                continue

            if not work.epub_url:
                print(f"No epub URL for: {work.title}")
                continue

            print(f"Downloading: {work.title}")
            epub_path = self.download_epub(work, json_path)

            if epub_path:
                self.update_metadata(json_path, epub_path)
                print(f"  Saved to: {epub_path}")

        print("Download completed!")
