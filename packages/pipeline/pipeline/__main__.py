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
def pravo(throttle_ms: int = 200):
    """Scrape azbyka.ru/pravo/* and emit one markdown file per rule.

    Resumable: skips a rule if its target md file already exists. Run
    `pipeline paragraphs` afterwards to ingest.
    """
    from .pravo import PravoCollector
    with PravoCollector(throttle_ms=throttle_ms) as col:
        col.run()


@app.command(name="bible-markdown")
def bible_markdown() -> None:
    """Конвертит Bible epub'ы → один-стих-один-md в output/Bible/. Skip-if-exists."""
    from .bible_md_convert import run as _run
    _run()


@app.command()
def embed(
    device: str | None = None,
    batch_size: int | None = None,
    from_scratch: bool = False,
    db_workers: int = 2,
    queue_size: int = 8,
    throttle_ms: int = 0,
    cpu_threads: int | None = None,
    sort_buffer: int = 1024,
    max_seq_length: int = 512,
    fp16: bool = True,
) -> None:
    """Эмбеддит окна 1-3 абзацев и пишет в БД. По умолчанию resume; --from-scratch для полной переиндексации.

    Для «низкоимпактного» режима (когда нужно работать параллельно):
        --throttle-ms 100 --cpu-threads 4
    """
    from .embed import run as _run
    asyncio.run(_run(
        device=device, batch_size=batch_size,
        from_scratch=from_scratch,
        db_workers=db_workers, queue_size=queue_size,
        throttle_ms=throttle_ms, cpu_threads=cpu_threads,
        sort_buffer=sort_buffer, max_seq_length=max_seq_length, fp16=fp16,
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
