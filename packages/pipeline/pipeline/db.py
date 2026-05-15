from contextlib import asynccontextmanager
from typing import AsyncIterator

import psycopg
from psycopg_pool import AsyncConnectionPool

from .config import settings

_pool: AsyncConnectionPool | None = None


async def init_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        # NOTE: Explicit connect_timeout kwarg is REQUIRED on Windows+Python 3.13.
        # Without it, psycopg-pool 3.3.x's worker task hangs forever inside
        # connection_class.connect(...) and pool.open() raises PoolTimeout with
        # an empty underlying error. With it, connection succeeds normally.
        _pool = AsyncConnectionPool(
            settings.postgres_dsn,
            min_size=1,
            max_size=8,
            open=False,
            kwargs={"connect_timeout": 10},
        )
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
