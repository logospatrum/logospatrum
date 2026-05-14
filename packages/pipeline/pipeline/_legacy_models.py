from typing import Optional, List
from pydantic import BaseModel


class WorkMetadata(BaseModel):
    title: str
    work_url: str
    epub_url: Optional[str] = None
    epub_path: Optional[str] = None
    creation_date: Optional[str] = None
    views: Optional[float] = None
    annotation: Optional[str] = None
    section: Optional[str] = None


class AuthorMetadata(BaseModel):
    name: str
    author_url: str
    years_of_life: Optional[str] = None
    global_section: str
    works: List[WorkMetadata] = []


class ChapterDocument(BaseModel):
    author: str
    author_years_of_life: Optional[str] = None
    global_section: str
    section: Optional[str] = None
    views: Optional[str] = None
    book_title: str
    creation_date: Optional[str] = None
    chapter_title: str
    chapter_number: int
    source_url: str
    content: str
    topics: List[str] = []


class BibleBookMetadata(BaseModel):
    title: str
    work_url: str
    epub_url: Optional[str] = None
    epub_path: Optional[str] = None
