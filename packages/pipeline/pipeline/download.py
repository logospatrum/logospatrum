import json
from pathlib import Path
from typing import Generator

import httpx

from .config import Config
from .models import WorkMetadata


class Downloader:
    def __init__(self, config: Config):
        self.config = config
        self.client = httpx.Client(timeout=60.0, follow_redirects=True)

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
            response.raise_for_status()

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
