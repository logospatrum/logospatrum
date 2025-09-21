import psycopg
from psycopg_pool import AsyncConnectionPool
from config import settings


class DatabaseConnection:
    def __init__(self):
        self.pool = None

    async def init_pool(self):
        self.pool = AsyncConnectionPool(
            settings.database_url,
            min_size=1,
            max_size=10
        )

    async def close_pool(self):
        if self.pool:
            await self.pool.close()

    def conn(self):
        return self.pool.connection()


db_conn = DatabaseConnection()
