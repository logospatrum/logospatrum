import logging
from functools import wraps
from typing import Callable

import psycopg

from database import db_conn

logger = logging.getLogger("migration")


def migration(migration_name: str):
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper():
            async with db_conn.conn() as conn:
                async with conn.transaction():
                    if await register_migration(migration_name, conn):
                        logger.info(f"migration {migration_name} already exist, skipped")
                        return

                    logger.info(f"Running '{migration_name}'...")
                    await func(conn)
                    logger.info(f"Migration '{migration_name}' success.")

        return wrapper
    return decorator


async def create_migration_table():
    async with db_conn.conn() as conn:
        async with conn.transaction():
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS migrations (
                    id SERIAL PRIMARY KEY,
                    name TEXT UNIQUE NOT NULL,
                    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)


async def register_migration(migration_name: str, conn: psycopg.AsyncConnection) -> bool:
    cursor = await conn.execute("""
        INSERT INTO migrations (name)
        VALUES (%s)
        ON CONFLICT DO NOTHING
        RETURNING id;
    """, [migration_name])

    row = await cursor.fetchone()
    return row is None


async def migrate_db():
    await create_migration_table()
    await initialize_db()
    await create_books_table()
    await create_chunks_table()


@migration('init db')
async def initialize_db(conn):
    await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")


@migration('create books table')
async def create_books_table(conn):
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS books (
            id SERIAL PRIMARY KEY,
            author TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            date TEXT,
            link TEXT,
            metadata JSONB,
            summary_embedding vector(1024),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(author, title)
        );
    """)

    await conn.execute('CREATE INDEX IF NOT EXISTS books_author_title_idx ON books (author, title);')
    await conn.execute('CREATE INDEX IF NOT EXISTS books_summary_embedding_idx ON books USING ivfflat (summary_embedding vector_cosine_ops);')


@migration('create chunks table')
async def create_chunks_table(conn):
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            id SERIAL PRIMARY KEY,
            book_author TEXT NOT NULL,
            book_title TEXT NOT NULL,
            content TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            embedding vector(1024),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (book_author, book_title) REFERENCES books (author, title) ON DELETE CASCADE
        );
    """)

    await conn.execute('CREATE INDEX IF NOT EXISTS chunks_book_idx ON chunks (book_author, book_title);')
    await conn.execute('CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops);')
