"""Persistence of agent runs for observability and post-hoc audit."""
import json

from .db import conn


async def write_run(thread_id: str | None, messages: list[dict],
                    citations_used: list[str] | None = None) -> int:
    """Persist a finished agent run. Returns the agent_runs.id."""
    async with conn() as c:
        cur = await c.execute(
            """
            INSERT INTO agent_runs (thread_id, messages, citations_used)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            [thread_id,
             json.dumps(messages, ensure_ascii=False, default=str),
             json.dumps(citations_used or [], ensure_ascii=False)],
        )
        row = await cur.fetchone()
        return int(row[0])
