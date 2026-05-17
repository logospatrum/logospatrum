from datetime import datetime, timedelta, timezone

from ..db import conn

MSK = timezone(timedelta(hours=3))


def _today_msk() -> str:
    return datetime.now(MSK).strftime("%Y-%m-%d")


def _this_month_msk() -> str:
    return datetime.now(MSK).strftime("%Y-%m")


async def get_used_rub(subject: str, bucket: str) -> float:
    async with conn() as c:
        cur = await c.execute(
            "SELECT used_rub FROM budget_usage WHERE subject_key=%s AND bucket=%s",
            (subject, bucket),
        )
        row = await cur.fetchone()
        return float(row[0]) if row else 0.0


async def add_usage(subject: str, bucket: str, delta_rub: float) -> float:
    """UPSERT — returns total used_rub for this (subject, bucket) after the add."""
    async with conn() as c:
        cur = await c.execute(
            """
            INSERT INTO budget_usage (subject_key, bucket, used_rub)
            VALUES (%s, %s, %s)
            ON CONFLICT (subject_key, bucket)
            DO UPDATE SET used_rub   = budget_usage.used_rub + EXCLUDED.used_rub,
                          updated_at = now()
            RETURNING used_rub
            """,
            (subject, bucket, delta_rub),
        )
        row = await cur.fetchone()
        await c.commit()
        return float(row[0])
