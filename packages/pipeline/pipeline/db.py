from contextlib import asynccontextmanager
from typing import AsyncIterator

import psycopg
from psycopg_pool import AsyncConnectionPool

from .config import settings

_pool: AsyncConnectionPool | None = None


async def init_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(settings.postgres_dsn, min_size=1, max_size=8, open=False)
        await _pool.open()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def conn() -> AsyncIterator[psycopg.AsyncConnection]:
    pool = await init_pool()
    async with pool.connection() as c:
        yield c
