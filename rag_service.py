import json
import logging
from typing import List, Dict, Any
from models import BookMetadata, RAGRequest, RAGResponse, RAGResult, SimilarBook, BookFilter, EmbeddingVector
from embedding_service import embedding_service
from text_service import text_service
from repository import book_repository

logger = logging.getLogger(__name__)


class RAGService:
    async def load_books_from_json(self, json_path: str) -> None:
        with open(json_path, 'r', encoding='utf-8') as f:
            books_data: List[Dict[str, Any]] = json.load(f)

        for book_data in books_data:
            try:
                book: BookMetadata = BookMetadata(**book_data)

                if await book_repository.book_exists(book.author, book.title):
                    logger.info(f"Book {book.author} - {book.title} already exists, skipping")
                    continue

                logger.info(f"Processing book: {book.author} - {book.title}")

                book_text: str = f"{book.summary} {book.title} {book.author} {book.date}"
                summary_embedding: EmbeddingVector = await embedding_service.get_doc_embedding(book_text)

                metadata: Dict[str, Any] = {k: v for k, v in book_data.items()
                           if k not in ['author', 'title', 'summary', 'date', 'link']}

                await book_repository.insert_book(book, summary_embedding.to_list(), metadata)

                try:
                    full_text: str = await text_service.download_text(book.link)
                    chunks: List[str] = text_service.create_chunks(full_text)

                    if chunks:
                        chunk_embeddings: List[EmbeddingVector] = await embedding_service.get_doc_embeddings(chunks)
                        chunk_embeddings_lists: List[List[float]] = [emb.to_list() for emb in chunk_embeddings]
                        await book_repository.insert_chunks(book.author, book.title, chunks, chunk_embeddings_lists)
                        logger.info(f"Created {len(chunks)} chunks for {book.author} - {book.title}")

                except Exception as e:
                    logger.error(f"Failed to process text for {book.author} - {book.title}: {e}")

            except Exception as e:
                logger.error(f"Failed to process book {book_data}: {e}")

    async def search(self, request: RAGRequest) -> RAGResponse:
        query_embedding: EmbeddingVector = await embedding_service.get_query_embedding(request.query)

        similar_books: List[SimilarBook] = await book_repository.search_similar_books(
            query_embedding.to_list(),
            limit=min(10, request.max_results * 2)
        )

        book_filters: List[BookFilter] = [
            BookFilter(author=book.author, title=book.title)
            for book in similar_books
            if book.similarity > 0.3
        ]

        if not book_filters:
            book_filters = [
                BookFilter(author=book.author, title=book.title)
                for book in similar_books[:5]
            ]

        results: List[RAGResult] = await book_repository.search_chunks(
            query_embedding.to_list(),
            book_filters,
            request.max_results
        )

        if not request.include_metadata:
            for result in results:
                result.metadata = {}

        return RAGResponse(results=results)


rag_service: RAGService = RAGService()
