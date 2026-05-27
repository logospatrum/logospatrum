"""Pydantic models for pipeline ingest/embed/query."""
from pydantic import BaseModel, Field


class AuthorRow(BaseModel):
    slug: str
    name_display: str
    years: str | None = None
    century: int | None = None
    global_section: str | None = None


class WorkRow(BaseModel):
    slug: str
    author_slug: str
    title_display: str
    creation_date: str | None = None
    section: str | None = None
    source_url: str | None = None
    topics: list[str] | None = None
    paragraph_count: int = 0


class ChapterRow(BaseModel):
    work_slug: str
    chapter_num: int
    title: str | None = None
    source_md_path: str | None = None


class ParagraphRow(BaseModel):
    work_slug: str
    chapter_num: int
    para_num: int
    text: str
    char_offset_start: int
    char_offset_end: int


class ParsedMarkdown(BaseModel):
    """Parsed output of a single md file."""
    frontmatter: dict
    body: str
    paragraphs: list[str]


class ConceptEntry(BaseModel):
    canonical: str
    synonyms: list[str] = Field(default_factory=list)
    related: list[str] = Field(default_factory=list)
    antonyms: list[str] = Field(default_factory=list)
    greek: list[str] = Field(default_factory=list)


# Scrape-side dataclasses, used by Scraper / Downloader / MarkdownConverter
# (the legacy import path). These mirror the JSON written under data/<section>/
# <author>/<work>.json.

class WorkMetadata(BaseModel):
    title: str
    work_url: str | None = None  # optional — legacy Bible JSONs lack this
    creation_date: str | None = None
    views: float = 0
    section: str = ""  # optional — legacy Bible JSONs lack this
    epub_url: str | None = None
    annotation: str | None = None
    epub_path: str | None = None


class AuthorMetadata(BaseModel):
    name: str
    author_url: str
    years_of_life: str | None = None
    global_section: str
    works: list[WorkMetadata] = Field(default_factory=list)
