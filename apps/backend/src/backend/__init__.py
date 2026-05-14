"""Patristic chat backend: LangGraph + deepagents."""
__version__ = "0.1.0"

# Windows: psycopg-pool requires Selector event loop; default is Proactor.
import sys
if sys.platform == "win32":
    import asyncio
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except RuntimeError:
        # already in a running loop — skip
        pass
