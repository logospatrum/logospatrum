import hashlib
import json
import re
from pathlib import Path
from typing import Generator, List, Tuple

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

from .config import Config


class MarkdownConverter:
    def __init__(self, config: Config):
        self.config = config

    def iter_metadata_files(self) -> Generator[Tuple[Path, dict], None, None]:
        data_dir = self.config.data_dir
        if not data_dir.exists():
            return

        bible_dir = data_dir / "Bible"

        for json_path in data_dir.rglob("*.json"):
            try:
                json_path.relative_to(bible_dir)
                continue
            except ValueError:
                pass

            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            yield json_path, data

    def extract_author_info(self, json_path: Path) -> Tuple[str, str]:
        parts = json_path.relative_to(self.config.data_dir).parts
        global_section = parts[0] if len(parts) > 0 else "Unknown"
        author_name = parts[1] if len(parts) > 1 else "Unknown"
        author_name = author_name.replace("_", " ")
        return global_section.replace("_", " "), author_name

    def read_epub(self, epub_path: Path) -> List[Tuple[str, str]]:
        if not epub_path.exists():
            return []

        book = epub.read_epub(str(epub_path))
        chapters = []

        for item in book.get_items():
            if item.get_type() == ebooklib.ITEM_DOCUMENT:
                content = item.get_content().decode("utf-8", errors="ignore")
                soup = BeautifulSoup(content, "xml")

                has_notes_section = self._has_notes_marker(soup)
                if has_notes_section:
                    self._remove_notes_section(soup)

                title = self._extract_chapter_title(soup)
                text = self._html_to_markdown(soup)

                if text.strip():
                    chapters.append((title, text))

                if has_notes_section:
                    break

        return chapters

    def _has_notes_marker(self, soup: BeautifulSoup) -> bool:
        for hr in soup.find_all("hr"):
            next_sibling = hr.find_next_sibling()
            if next_sibling and next_sibling.name == "h4":
                text = next_sibling.get_text()
                if "Примечания" in text or "notes" in text:
                    return True

        return False

    def _remove_notes_section(self, soup: BeautifulSoup):
        for hr in soup.find_all("hr", class_="calibre6"):
            next_sibling = hr.find_next_sibling()
            if next_sibling and next_sibling.name == "h4":
                if "Примечания" in next_sibling.get_text():
                    elements_to_remove = []
                    for sibling in hr.find_next_siblings():
                        elements_to_remove.append(sibling)
                    for elem in elements_to_remove:
                        elem.decompose()
                    hr.decompose()
                    break

    def _extract_chapter_title(self, soup: BeautifulSoup) -> str:
        for tag in ["h1", "h2", "h3", "title"]:
            element = soup.find(tag)
            if element:
                return element.get_text(strip=True)
        return "Untitled"

    def _html_to_markdown(self, soup: BeautifulSoup) -> str:
        for script in soup(["script", "style"]):
            script.decompose()

        for sup in soup.select("a > sup"):
            sup.parent.decompose()

        # Azbyka epubs use two distinct layouts:
        #  - Calibre-style: each block is `<div class="...paragraph...">`
        #    (older / typesetter route). Existing 92 authors mostly this.
        #  - Plain HTML: `<p>`, `<h1>`–`<h6>`, `<blockquote>`, `<li>` directly
        #    in the document (newer / liturgical books — Косма Маиумский,
        #    Феодор Эдесский, ~10 authors observed).
        #
        # Strategy: try the div.paragraph layout first; if it yields nothing,
        # fall back to scanning the standard block elements.
        elements = soup.find_all(
            "div", class_=lambda x: x and "paragraph" in x.split()
        )
        if not elements:
            elements = soup.find_all(
                ["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "li"]
            )

        lines = []
        for element in elements:
            tag = element.name
            text = element.get_text(strip=False)

            if not text or not text.strip():
                continue

            if tag == "h1":
                lines.append(f"# {text}\n")
            elif tag == "h2":
                lines.append(f"## {text}\n")
            elif tag == "h3":
                lines.append(f"### {text}\n")
            elif tag == "h4":
                lines.append(f"#### {text}\n")
            elif tag == "h5":
                lines.append(f"##### {text}\n")
            elif tag == "h6":
                lines.append(f"###### {text}\n")
            elif tag == "blockquote":
                lines.append(f"> {text}\n")
            elif tag == "li":
                lines.append(f"- {text}\n")
            else:
                lines.append(f"{text}\n")

        return "\n".join(lines)

    def create_markdown_document(
            self,
            chapter_title: str,
            chapter_content: str,
            chapter_number: int,
            metadata: dict,
            global_section: str,
            author_name: str,
    ) -> str:
        frontmatter = f"""---
author: {author_name}
author_years_of_life: {metadata.get('years_of_life', '')}
global_section: {global_section}
section: {metadata.get('section', '')}
views: {metadata.get('views', '')}
book_title: {metadata.get('title', '')}
creation_date: {metadata.get('creation_date', '')}
chapter_title: {chapter_title}
chapter_number: {chapter_number}
source_url: {metadata.get('work_url', '')}
---

"""
        # if metadata.get("annotation"):
        #     frontmatter += f"**Аннотация:** {metadata['annotation']}\n\n"

        return frontmatter + chapter_content

    def save_markdown(self, content: str, output_path: Path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(content)

    def _safe_filename(self, name: str) -> str:
        # Keep only word characters (letters, digits) - works for Cyrillic too.
        words = re.findall(r'[\w]+', name, re.UNICODE)
        return '_'.join(words)[:30]

    def _safe_title(self, name: str) -> str:
        # Work titles need a uniqueness guarantee — pure 30-char truncation
        # collapses ~80% of canonized authors' similarly-titled works into
        # one output dir (e.g. "Из пережитого: Речь Рязанскую кафедру" and
        # "Из пережитого: Речь Якутскую кафедру" both → "Из_пережитого_…").
        # Append a short content hash so distinct sources land in distinct
        # dirs while keeping the path length under Windows MAX_PATH=260.
        # Full-length expansion (80 chars per component) blew past MAX_PATH
        # once author + work + chapter were concatenated.
        words = re.findall(r'[\w]+', name, re.UNICODE)
        truncated = '_'.join(words)[:30]
        h = hashlib.md5(name.encode('utf-8')).hexdigest()[:8]
        return f"{truncated}_{h}"

    def run(self):
        output_dir = self.config.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        for json_path, metadata in self.iter_metadata_files():
            epub_path_str = metadata.get("epub_path")
            if not epub_path_str:
                continue

            epub_path = self.config.data_dir.parent / epub_path_str
            if not epub_path.exists():
                print(f"EPUB not found: {epub_path}")
                continue

            global_section, author_name = self.extract_author_info(json_path)
            print(f"Converting: {metadata.get('title', 'Unknown')}")

            # Some epubs from azbyka.ru are corrupted (BadZipFile, missing
            # OPF, etc.). Don't let a single bad file kill the whole batch —
            # log and continue. read_epub may also fail on weird XML inside
            # otherwise-valid epubs.
            try:
                chapters = self.read_epub(epub_path)
            except Exception as e:
                print(f"  [skip] read_epub failed: {type(e).__name__}: {e}")
                continue

            for i, (chapter_title, chapter_content) in enumerate(chapters, 2):
                if chapter_title == "Untitled":
                    continue

                md_content = self.create_markdown_document(
                    chapter_title=chapter_title,
                    chapter_content=chapter_content,
                    chapter_number=i - 1,
                    metadata=metadata,
                    global_section=global_section,
                    author_name=author_name,
                )

                safe_section = self._safe_filename(global_section)
                safe_author = self._safe_filename(author_name)
                safe_title = self._safe_title(metadata.get("title", "unknown"))
                safe_chapter = self._safe_filename(chapter_title)

                output_path = (
                        output_dir
                        / safe_section
                        / safe_author
                        / safe_title
                        / f"{i:03d}_{safe_chapter}.md"
                )
                self.save_markdown(md_content, output_path)

        print("Markdown conversion completed!")
