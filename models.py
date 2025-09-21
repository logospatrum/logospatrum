from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from dataclasses import dataclass


class BookMetadata(BaseModel):
    author: str
    title: str
    summary: str
    date: str
    link: str


class RAGRequest(BaseModel):
    query: str
    max_results: int = 5
    include_metadata: bool = True


class RAGResult(BaseModel):
    metadata: Dict[str, Any]
    content: str
    score: float


class RAGResponse(BaseModel):
    results: List[RAGResult]


class BookInfo(BaseModel):
    id: int
    author: str
    title: str
    summary: str
    date: str
    link: str
    metadata: Optional[Dict[str, Any]]
    chunks_count: int
    created_at: str


@dataclass
class SimilarBook:
    author: str
    title: str
    similarity: float


@dataclass
class BookFilter:
    author: str
    title: str


@dataclass
class EmbeddingVector:
    values: List[float]

    def to_list(self) -> List[float]:
        return self.values


@dataclass
class ChunkData:
    content: str
    book_author: str
    book_title: str
    date: str
    link: str
    metadata: Optional[Dict[str, Any]]
    similarity: float
