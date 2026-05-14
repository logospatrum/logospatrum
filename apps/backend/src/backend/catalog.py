"""FastAPI app: catalog endpoint mounted under LangGraph Server."""
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import conn

app = FastAPI(title="Patristic Catalog")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
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
