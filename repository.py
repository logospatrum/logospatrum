import json
from typing import List, Optional, Dict, Any
from database import db_conn
from models import BookMetadata, RAGResult, BookInfo, SimilarBook, BookFilter, ChunkData


class BookRepository:
    async def book_exists(self, author: str, title: str) -> bool:
        async with db_conn.conn() as conn:
            cursor = await conn.execute(
                "SELECT 1 FROM books WHERE author = %s AND title = %s",
                [author, title]
            )
            return await cursor.fetchone() is not None
    
    async def insert_book(
        self,
        book: BookMetadata,
        summary_embedding: List[float],
        metadata: Dict[str, Any]
    ) -> None:
        async with db_conn.conn() as conn:
            await conn.execute("""
                INSERT INTO books (author, title, summary, date, link, metadata, summary_embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (author, title) DO NOTHING
            """, [
                book.author, book.title, book.summary, book.date, book.link,
                json.dumps(metadata), summary_embedding
            ])
    
    async def insert_chunks(
        self,
        author: str,
        title: str,
        chunks: List[str],
        embeddings: List[List[float]]
    ) -> None:
        async with db_conn.conn() as conn:
            async with conn.transaction():
                await conn.execute(
                    "DELETE FROM chunks WHERE book_author = %s AND book_title = %s",
                    [author, title]
                )
                
                for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                    await conn.execute("""
                        INSERT INTO chunks (book_author, book_title, content, chunk_index, embedding)
                        VALUES (%s, %s, %s, %s, %s)
                    """, [author, title, chunk, i, embedding])
    
    async def search_similar_books(
        self,
        query_embedding: List[float],
        limit: int = 10
    ) -> List[SimilarBook]:
        async with db_conn.conn() as conn:
            cursor = await conn.execute("""
                SELECT author, title, 1 - (summary_embedding <=> %s) as similarity
                FROM books
                WHERE summary_embedding IS NOT NULL
                ORDER BY summary_embedding <=> %s
                LIMIT %s
            """, [query_embedding, query_embedding, limit])
            
            results: List[SimilarBook] = []
            async for row in cursor:
                results.append(SimilarBook(
                    author=row[0],
                    title=row[1],
                    similarity=row[2]
                ))
            return results

    async def search_chunks(
        self,
        query_embedding: List[float],
        book_filters: List[BookFilter],
        limit: int = 5
    ) -> List[RAGResult]:
        if not book_filters:
            return []
        
        filter_conditions = " OR ".join(["(book_author = %s AND book_title = %s)"] * len(book_filters))
        filter_params: List[str] = []
        for book_filter in book_filters:
            filter_params.extend([book_filter.author, book_filter.title])

        async with db_conn.conn() as conn:
            cursor = await conn.execute(f"""
                SELECT c.content, c.book_author, c.book_title, b.date, b.link, b.metadata,
                       1 - (c.embedding <=> %s) as similarity
                FROM chunks c
                JOIN books b ON c.book_author = b.author AND c.book_title = b.title
                WHERE ({filter_conditions})
                ORDER BY c.embedding <=> %s
                LIMIT %s
            """, [query_embedding] + filter_params + [query_embedding, limit])
            
            results: List[RAGResult] = []
            async for row in cursor:
                chunk_data = ChunkData(
                    content=row[0],
                    book_author=row[1],
                    book_title=row[2],
                    date=row[3],
                    link=row[4],
                    metadata=json.loads(row[5]) if row[5] else None,
                    similarity=row[6]
                )

                metadata: Dict[str, Any] = {
                    "source": f"{chunk_data.book_author} - {chunk_data.book_title}",
                    "author": chunk_data.book_author,
                    "title": chunk_data.book_title,
                    "date": chunk_data.date,
                    "link": chunk_data.link
                }
                
                if chunk_data.metadata:
                    metadata.update(chunk_data.metadata)

                results.append(RAGResult(
                    metadata=metadata,
                    content=chunk_data.content,
                    score=chunk_data.similarity
                ))
            
            return results
    
    async def get_all_books(self) -> List[BookInfo]:
        async with db_conn.conn() as conn:
            cursor = await conn.execute("""
                SELECT b.id, b.author, b.title, b.summary, b.date, b.link, b.metadata, b.created_at,
                       COUNT(c.id) as chunks_count
                FROM books b
                LEFT JOIN chunks c ON b.author = c.book_author AND b.title = c.book_title
                GROUP BY b.id, b.author, b.title, b.summary, b.date, b.link, b.metadata, b.created_at
                ORDER BY b.created_at DESC
            """)
            
            results: List[BookInfo] = []
            async for row in cursor:
                metadata: Optional[Dict[str, Any]] = json.loads(row[6]) if row[6] else None
                results.append(BookInfo(
                    id=row[0],
                    author=row[1],
                    title=row[2],
                    summary=row[3],
                    date=row[4],
                    link=row[5],
                    metadata=metadata,
                    chunks_count=row[8],
                    created_at=row[7].isoformat()
                ))
            
            return results


book_repository: BookRepository = BookRepository()
