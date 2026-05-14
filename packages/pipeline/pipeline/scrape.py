import json
import re
from pathlib import Path
from typing import List, Optional
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from .config import Config
from .models import AuthorMetadata, WorkMetadata

EXCLUDED_SECTIONS = {"Труды на иностранных языках", "Аудиокниги"}
BASE_URL = "https://azbyka.ru"


class Scraper:
    def __init__(self, config: Config):
        self.config = config
        self.client = httpx.Client(timeout=30.0, follow_redirects=True)

    def close(self):
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def load_library_urls(self) -> List[str]:
        with open(self.config.libraries_file, "r", encoding="utf-8") as f:
            return [line.strip() for line in f if line.strip()]

    def scrape_library_page(self, url: str) -> tuple[str, List[AuthorMetadata]]:
        response = self.client.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")

        section_title = self._extract_section_title(soup)
        authors = self._extract_authors(soup, section_title)
        return section_title, authors

    def _extract_section_title(self, soup: BeautifulSoup) -> str:
        h1 = soup.find("h1", class_="h1-public")
        if h1:
            return h1.get_text(strip=True)
        return "Unknown"

    def _extract_authors(self, soup: BeautifulSoup, global_section: str) -> List[AuthorMetadata]:
        authors = []
        items = soup.find_all("li", class_="authors-list__item")

        for item in items:
            link = item.find("a", class_="authors-list__link")
            if not link:
                continue

            name = link.get_text(strip=True)
            href = link.get("href", "")
            author_url = urljoin(BASE_URL, href)

            years_span = item.find("span", class_="author-date")
            years = years_span.get_text(strip=True) if years_span else None

            authors.append(AuthorMetadata(
                name=name,
                author_url=author_url,
                years_of_life=years,
                global_section=global_section
            ))

        return authors

    def scrape_author_works(self, author: AuthorMetadata, author_dir: Optional[Path] = None) -> List[WorkMetadata]:
        response = self.client.get(author.author_url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "lxml")

        works = []
        sections = soup.find_all("div", class_="text-base mb-2")

        excluded_divs = set()
        for section_div in sections:
            section_title_span = section_div.find("span", class_="author-group__title")
            if not section_title_span:
                continue

            section_title = section_title_span.get_text(strip=True)
            if section_title in EXCLUDED_SECTIONS:
                excluded_divs.add(id(section_div))
                for child_div in section_div.find_all("div", class_="text-base mb-2"):
                    excluded_divs.add(id(child_div))

        for section_div in sections:
            if id(section_div) in excluded_divs:
                continue

            section_title_span = section_div.find("span", class_="author-group__title")
            if not section_title_span:
                continue

            section_title = section_title_span.get_text(strip=True)

            work_items = section_div.find_all("li", recursive=False)
            if not work_items:
                inner_list = section_div.find("ul")
                if inner_list:
                    work_items = inner_list.find_all("li", recursive=False)

            for item in work_items:
                work = self._extract_work_from_item(item, section_title)
                if work:
                    if author_dir and self._work_json_exists(work, author_dir):
                        continue
                    works.append(work)

        return works

    def _work_json_exists(self, work: WorkMetadata, author_dir: Path) -> bool:
        safe_title = self._safe_filename(work.title)[:50]
        json_path = author_dir / f"{safe_title}.json"
        return json_path.exists()

    def _extract_work_from_item(self, item, section: str) -> Optional[WorkMetadata]:
        link = item.find("a", href=True)
        if not link:
            return None

        title_parts = []
        for child in link.children:
            if hasattr(child, 'name'):
                if child.name == 'span' and 'italic' in child.get('class', []):
                    continue
                elif child.name == 'span':
                    continue
                else:
                    title_parts.append(child.get_text(strip=True))
            else:
                text = str(child).strip()
                if text:
                    title_parts.append(text)

        title = " ".join(title_parts).strip()
        if not title:
            title = link.get_text(strip=True).split('\n')[0].strip()

        work_url = link.get("href", "")
        if not work_url.startswith("http"):
            work_url = urljoin(BASE_URL, work_url)

        date_span = link.find("span", class_="italic")
        creation_date = date_span.get_text(strip=True) if date_span else None

        views_span = item.find("span", title=lambda x: x and "просмотров" in x)
        views = views_span.get_text(strip=True) if views_span else None
        views = parse_count_string(views)

        return WorkMetadata(
            title=title,
            work_url=work_url,
            creation_date=creation_date,
            views=views,
            section=section
        )

    def scrape_work_page(self, work: WorkMetadata) -> Optional[WorkMetadata]:
        try:
            response = self.client.get(work.work_url)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            print(f"      [SKIP] HTTP {e.response.status_code}: {work.work_url}")
            return None
        except httpx.RequestError as e:
            print(f"      [SKIP] Request error: {e}")
            return None

        soup = BeautifulSoup(response.text, "lxml")

        epub_link = soup.find("a", class_="epub")
        if epub_link and epub_link.get("href"):
            work.epub_url = epub_link.get("href")

        annotation_section = soup.find("section", id="annotation")
        if annotation_section:
            divs = annotation_section.find_all(["div", "p"])
            annotation_text = " ".join(
                div.get_text(strip=True)
                for div in divs
                if "read-more" not in div.get("class", [])
            )
            work.annotation = annotation_text if annotation_text else None

        return work

    def save_metadata(self, author: AuthorMetadata, data_dir: Path):
        safe_section = self._safe_filename(author.global_section)
        safe_author = self._safe_filename(author.name)

        author_dir = data_dir / safe_section / safe_author
        author_dir.mkdir(parents=True, exist_ok=True)

        for work in author.works:
            safe_title = self._safe_filename(work.title)[:50]
            json_path = author_dir / f"{safe_title}.json"

            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(work.model_dump(), f, ensure_ascii=False, indent=2)

    def _safe_filename(self, name: str) -> str:
        # Keep only word characters (letters, digits) - works for Cyrillic too
        words = re.findall(r'[\w]+', name, re.UNICODE)
        name = '_'.join(words)
        return name[:100]

    def run(self):
        urls = self.load_library_urls()
        data_dir = self.config.data_dir
        data_dir.mkdir(parents=True, exist_ok=True)

        for url in urls:
            print(f"Scraping library: {url}")
            section_title, authors = self.scrape_library_page(url)
            print(f"  Found {len(authors)} authors in '{section_title}'")

            for author in authors:
                print(f"  Processing author: {author.name}")

                safe_section = self._safe_filename(author.global_section)
                safe_author = self._safe_filename(author.name)
                author_dir = data_dir / safe_section / safe_author

                works = self.scrape_author_works(author, author_dir)
                print(f"    Found {len(works)} new works")

                successful_works = []
                for work in works:
                    print(f"    Scraping work: {work.title}")
                    result = self.scrape_work_page(work)
                    if result:
                        successful_works.append(result)

                author.works = successful_works
                if successful_works:
                    self.save_metadata(author, data_dir)

        print("Scraping completed!")


def parse_count_string(count_str):
    """
    Преобразует строки формата "1.9K", "89", "5K" в числа.

    Args:
        count_str (str): Строка с числом, возможно с суффиксом K, M, B и т.д.

    Returns:
        float: Числовое значение
    """
    if not count_str or not isinstance(count_str, str):
        return 0

    # Удаляем пробелы и приводим к верхнему регистру
    count_str = count_str.strip().upper()

    # Если строка пустая
    if not count_str:
        return 0

    # Соответствие суффиксов множителям
    multipliers = {
        'K': 1000,  # Тысячи
        'M': 1000000,  # Миллионы
        'B': 1000000000,  # Миллиарды
        'T': 1000000000000  # Триллионы
    }

    try:
        # Проверяем, есть ли суффикс
        for suffix, multiplier in multipliers.items():
            if count_str.endswith(suffix):
                # Убираем суффикс и преобразуем в число
                number_part = count_str[:-len(suffix)]
                # Заменяем запятую на точку, если есть
                number_part = number_part.replace(',', '.')
                return float(number_part) * multiplier

        # Если нет суффикса, просто преобразуем в число
        return float(count_str.replace(',', '.'))

    except ValueError:
        # В случае ошибки преобразования возвращаем 0
        return 0
