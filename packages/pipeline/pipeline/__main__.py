import asyncio
import sys

# Windows: psycopg-pool requires Selector event loop; default is Proactor.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def diagnose() -> None:
    """Сканит output/ и data/, печатает отчёт о пробелах."""
    from .diagnose import run as _run
    asyncio.run(_run())


@app.command()
def paragraphs() -> None:
    """Парсит md → абзацы, пишет в БД."""
    from .paragraphs import run as _run
    asyncio.run(_run())


@app.command()
def embed(
    device: str | None = None,
    batch_size: int | None = None,
    from_scratch: bool = False,
    db_workers: int = 4,
    queue_size: int = 8,
) -> None:
    """Эмбеддит окна 1-3 абзацев и пишет в БД. По умолчанию resume; --from-scratch для полной переиндексации."""
    from .embed import run as _run
    asyncio.run(_run(
        device=device, batch_size=batch_size,
        from_scratch=from_scratch,
        db_workers=db_workers, queue_size=queue_size,
    ))


@app.command(name="concepts-bootstrap")
def concepts_bootstrap() -> None:
    """Генерирует glossary.json через Haiku по seed_concepts.json."""
    from .concepts_bootstrap import run as _run
    asyncio.run(_run())


@app.command()
def enrich() -> None:
    """Добавляет topics в md frontmatter и works.topics через LLM."""
    from .enrich import run as _run
    asyncio.run(_run())


if __name__ == "__main__":
    app()
