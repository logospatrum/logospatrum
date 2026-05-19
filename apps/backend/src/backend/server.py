"""Custom FastAPI server replacing the langgraph-api production runtime.

Frontend uses stateless runs (full message history in body, no thread_id,
no server-side checkpoint). MCP plugin hits /mcp. That's the entire
backend surface — no Postgres-backed worker queue, no Redis pubsub, no
schema_migrations conflict.
"""
from __future__ import annotations

import json
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.load.dump import dumpd
from pydantic import BaseModel

from . import __version__
from .budget import storage
from .config import settings
from .db import close_pool, conn, init_pool
from .graph import agent
from .tools.expand_concept import expand_concept
from .tools.lexical_search import lexical_search
from .tools.list_authors import list_authors
from .tools.list_works import list_works
from .tools.read_passage import read_passage
from .tools.semantic_search import semantic_search

log = logging.getLogger(__name__)


def _build_mcp():
    """Construct FastMCP + register tools. Returns (mcp, sub_app) or (None, None)."""
    try:
        from mcp.server.fastmcp import FastMCP
    except Exception:
        log.warning("mcp package not installed — /mcp endpoint disabled")
        return None, None

    # streamable_http_path="/" so the sub-app's route lives at its root;
    # mounted under "/mcp", external URL is exactly /mcp.
    mcp = FastMCP("logospatrum", streamable_http_path="/")
    # Default transport_security only allows localhost Host headers. In prod
    # the Host is logospatrum.com (or the internal backend:8000), so the
    # check would 421 every request. nginx enforces Origin/UA upstream.
    mcp.settings.transport_security.enable_dns_rebinding_protection = False

    @mcp.tool()
    async def semantic_search_tool(
        query: str,
        author_slug: list[str] | str | None = None,
        work_slug: list[str] | str | None = None,
        section: str | None = None,
        limit: int = 10,
    ) -> dict:
        """Cosine-similarity ANN over bge-m3 embeddings of the patristic corpus."""
        return await semantic_search.ainvoke({
            "query": query, "author_slug": author_slug, "work_slug": work_slug,
            "section": section, "limit": limit,
        })

    @mcp.tool()
    async def lexical_search_tool(
        query: str,
        author_slug: list[str] | str | None = None,
        work_slug: list[str] | str | None = None,
        section: str | None = None,
        limit: int = 10,
    ) -> dict:
        """Postgres tsvector + ts_rank lexical search."""
        return await lexical_search.ainvoke({
            "query": query, "author_slug": author_slug, "work_slug": work_slug,
            "section": section, "limit": limit,
        })

    @mcp.tool()
    async def read_passage_tool(citation: str, context_n: int = 2) -> dict:
        """Read a passage by canonical citation `author_slug/work_slug/NNNN/pX[-Y]`."""
        return await read_passage.ainvoke({"citation": citation, "context_n": context_n})

    @mcp.tool()
    async def list_authors_tool(q: str | None = None, limit: int = 20) -> dict:
        """List authors, optionally filtered by display-name substring."""
        return await list_authors.ainvoke({"q": q, "limit": limit})

    @mcp.tool()
    async def list_works_tool(author_slug: str, q: str | None = None, limit: int = 30) -> dict:
        """List works for a given author_slug."""
        return await list_works.ainvoke({"author_slug": author_slug, "q": q, "limit": limit})

    @mcp.tool()
    async def expand_concept_tool(term: str) -> dict:
        """Look up a Russian Orthodox theological term in the glossary."""
        return await expand_concept.ainvoke({"term": term})

    # streamable_http_app() lazily creates mcp.session_manager — call it now
    # so we can wire its run() into our lifespan.
    sub_app = mcp.streamable_http_app()
    return mcp, sub_app


_MCP, _MCP_APP = _build_mcp()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await init_pool()
    try:
        if _MCP is not None:
            # FastMCP session manager owns a task group used by streaming
            # handlers; without entering its run() context the handler raises
            # "Task group is not initialized" on every request.
            async with _MCP.session_manager.run():
                yield
        else:
            yield
    finally:
        await close_pool()


app = FastAPI(title="patristic-backend", version=__version__, lifespan=lifespan)
if _MCP_APP is not None:
    # MCP sub-app's internal route lives at "/", mounted under "/mcp". A bare
    # external "/mcp" would normally provoke Starlette's slash-redirect (307
    # to "/mcp/" with an *absolute* internal Location), which downstream
    # proxies cannot follow. Rewrite the ASGI scope so the mount always sees
    # the trailing-slash form — both /mcp and /mcp/ reach the handler with
    # zero redirects. Must run BEFORE the mount registration so the rewritten
    # path is what the router sees.
    @app.middleware("http")
    async def _mcp_path_normalize(request: Request, call_next):
        if request.url.path == "/mcp":
            request.scope["path"] = "/mcp/"
            request.scope["raw_path"] = b"/mcp/"
        return await call_next(request)

    app.mount("/mcp", _MCP_APP)

_origins = [o.strip() for o in settings.allowed_origin.split(",") if o.strip() and o.strip() != "*"]
if not _origins:
    _origins = ["http://localhost:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ---------- /info ----------
# LangGraph JS SDK probes this once at startup to confirm the server is
# reachable. It only checks `res.ok`, so any 200 with a JSON body is fine.
@app.get("/info")
async def info() -> dict:
    return {
        "flags": {"assistants": False, "crons": False, "threads": False},
        "version": __version__,
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ---------- /catalog ----------
@app.get("/catalog")
async def get_catalog() -> dict:
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


# ---------- /budget/check ----------
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


def _limit_for(subject: str) -> float:
    if subject.startswith("cookie:"):
        return settings.daily_rub_per_cookie
    if subject.startswith("fp:"):
        return settings.daily_rub_per_fp
    return settings.daily_rub_per_ip


@app.get("/budget/check")
async def budget_check(subject: str) -> dict:
    if not settings.budget_guard_enabled:
        if subject == "__global_month":
            return {
                "allowed": True, "used_rub": 0.0,
                "limit_rub": settings.global_monthly_kill_rub,
                "warn": False, "reset_at": _next_month_msk_iso(),
            }
        return {
            "allowed": True, "used_rub": 0.0, "limit_rub": _limit_for(subject),
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
    limit = _limit_for(subject)
    used = await storage.get_used_rub(subject, storage._today_msk())
    return {
        "allowed": used < limit,
        "used_rub": used,
        "limit_rub": limit,
        "warn": used >= settings.soft_warn_ratio * limit,
        "reset_at": _tomorrow_msk_iso(),
    }


# ---------- /runs/stream + /threads/{id}/runs/stream ----------
class RunRequest(BaseModel):
    assistant_id: str = "patristic"
    input: dict[str, Any]
    stream_mode: list[str] | str = ["values"]
    stream_subgraphs: bool = False
    config: dict[str, Any] = {}


def _jsonable(obj: Any) -> Any:
    """Recursively convert LangChain messages + pydantic models to JSON."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    try:
        return dumpd(obj)
    except Exception:
        return str(obj)


def _sse(event: str, data: Any) -> str:
    payload = json.dumps(_jsonable(data), ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


async def _run_stream(req: RunRequest, request: Request) -> StreamingResponse:
    stream_mode = req.stream_mode if isinstance(req.stream_mode, list) else [req.stream_mode]

    incoming_cfg = req.config or {}
    incoming_configurable = (incoming_cfg.get("configurable") or {})
    config = {
        "configurable": {
            # LangGraph requires thread_id for checkpointer compat even when
            # we don't persist — generate a throwaway one. budget_record reads
            # subject_key from configurable; preserve whatever the proxy injected.
            "thread_id": f"stateless-{uuid.uuid4()}",
            **incoming_configurable,
        },
        "recursion_limit": 50,
    }

    async def gen() -> AsyncIterator[str]:
        try:
            async for chunk in agent.astream(
                req.input,
                config=config,
                stream_mode=stream_mode,
                subgraphs=req.stream_subgraphs,
            ):
                if req.stream_subgraphs:
                    # (namespace_tuple, mode, data) when multi-mode
                    # (namespace_tuple, data) when single-mode
                    if len(chunk) == 3:
                        namespace, mode, data = chunk
                    else:
                        namespace, data = chunk
                        mode = stream_mode[0]
                else:
                    if isinstance(chunk, tuple) and len(chunk) == 2:
                        mode, data = chunk
                    else:
                        mode, data = stream_mode[0], chunk
                    namespace = ()

                event_name = f"{mode}|{'/'.join(namespace)}" if namespace else mode
                yield _sse(event_name, data)

                if await request.is_disconnected():
                    break
        except Exception as e:  # noqa: BLE001
            log.exception("run stream failed")
            yield _sse("error", {"error": type(e).__name__, "message": str(e)})
        finally:
            yield _sse("end", {})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # tell nginx not to buffer the SSE stream
            "Connection": "keep-alive",
        },
    )


@app.post("/runs/stream")
async def runs_stream(req: RunRequest, request: Request) -> StreamingResponse:
    return await _run_stream(req, request)


@app.post("/threads/{thread_id}/runs/stream")
async def thread_runs_stream(thread_id: str, req: RunRequest, request: Request) -> StreamingResponse:  # noqa: ARG001
    # thread_id is accepted for SDK compatibility but ignored — we are stateless.
    return await _run_stream(req, request)


# MCP setup happens at module load above (_build_mcp). The sub-app is
# already mounted at /mcp and its lifespan is folded into the parent.
