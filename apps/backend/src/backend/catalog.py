"""FastAPI app: catalog endpoint mounted under LangGraph Server."""
import json
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .budget import storage
from .config import settings
from .db import conn

app = FastAPI(title="Patristic Catalog")

# NOTE: ALLOWED_ORIGIN must be explicit comma-separated origins, not "*".
# Starlette rejects allow_credentials=True with wildcard origins (silently
# drops Access-Control-Allow-Credentials), which breaks the auth cookie path.
_origins = [o.strip() for o in settings.allowed_origin.split(",") if o.strip() and o.strip() != "*"]
if not _origins:
    # Defensive default: localhost dev. Production must set ALLOWED_ORIGIN.
    _origins = ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.get("/catalog")
async def get_catalog() -> dict:
    """Return the full catalog: authors with nested works."""
    sql = """
        SELECT a.slug, a.name_display, a.years, a.century, a.global_section,
               COALESCE(
                   json_agg(
                       json_build_object(
                           'slug', w.slug,
                           'title', w.title_display,
                           'creation_date', w.creation_date,
                           'section', w.section,
                           'source_url', w.source_url,
                           'topics', w.topics,
                           'paragraph_count', w.paragraph_count
                       ) ORDER BY w.title_display
                   ) FILTER (WHERE w.slug IS NOT NULL),
                   '[]'::json
               ) AS works
        FROM authors a
        LEFT JOIN works w ON w.author_slug = a.slug
        GROUP BY a.slug, a.name_display, a.years, a.century, a.global_section
        ORDER BY a.name_display
    """
    async with conn() as c:
        cur = await c.execute(sql)
        rows = await cur.fetchall()

    authors = [
        {
            "slug": r[0],
            "name": r[1],
            "years": r[2],
            "century": r[3],
            "global_section": r[4],
            "works": r[5] if isinstance(r[5], list) else json.loads(r[5] or "[]"),
        }
        for r in rows
    ]
    return {"authors": authors}


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def _tomorrow_msk_iso() -> str:
    today = datetime.strptime(storage._today_msk(), "%Y-%m-%d").replace(tzinfo=storage.MSK)
    return (today + timedelta(days=1)).isoformat()


def _next_month_msk_iso() -> str:
    month = datetime.strptime(storage._this_month_msk() + "-01", "%Y-%m-%d").replace(tzinfo=storage.MSK)
    if month.month == 12:
        nxt = month.replace(year=month.year + 1, month=1)
    else:
        nxt = month.replace(month=month.month + 1)
    return nxt.isoformat()


@app.get("/budget/check")
async def budget_check(subject: str) -> dict:
    """Pre-run budget gate. subject: 'cookie:<uuid>' | 'ip:<addr>' | '__global_month'."""
    # Rollback knob — when BUDGET_GUARD_ENABLED=false, the gate is fully open.
    # Symmetric with the post-run accounting node (Task 3.1) which also no-ops
    # when the flag is off. Together they make the env flag a clean kill-switch.
    if not settings.budget_guard_enabled:
        if subject == "__global_month":
            return {
                "allowed": True, "used_rub": 0.0,
                "limit_rub": settings.global_monthly_kill_rub,
                "warn": False, "reset_at": _next_month_msk_iso(),
            }
        limit = (settings.daily_rub_per_cookie if subject.startswith("cookie:")
                 else settings.daily_rub_per_ip)
        return {
            "allowed": True, "used_rub": 0.0, "limit_rub": limit,
            "warn": False, "reset_at": _tomorrow_msk_iso(),
        }
    if subject == "__global_month":
        used = await storage.get_used_rub(subject, storage._this_month_msk())
        limit = settings.global_monthly_kill_rub
        return {
            "allowed": used < limit,
            "used_rub": used,
            "limit_rub": limit,
            "warn": used >= settings.soft_warn_ratio * limit,
            "reset_at": _next_month_msk_iso(),
        }
    limit = (
        settings.daily_rub_per_cookie
        if subject.startswith("cookie:")
        else settings.daily_rub_per_ip
    )
    used = await storage.get_used_rub(subject, storage._today_msk())
    return {
        "allowed": used < limit,
        "used_rub": used,
        "limit_rub": limit,
        "warn": used >= settings.soft_warn_ratio * limit,
        "reset_at": _tomorrow_msk_iso(),
    }
