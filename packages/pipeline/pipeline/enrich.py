"""Enrich md files with topics extracted by an LLM, write to frontmatter AND works.topics.

Provider switch: ENRICH_PROVIDER=timeweb uses Timeweb proxy (Haiku);
ENRICH_PROVIDER=local uses LM Studio at LMSTUDIO_BASE_URL.
"""
import json
import re
from pathlib import Path

from openai import OpenAI
from rich.progress import Progress

from .config import settings
from .db import init_pool, close_pool, conn
from .slugify import slugify


PROMPT = """Проанализируй следующий православный текст и выдели от 3 до 7 ключевых тем.
Ответ — список через запятую, без пояснений и без префиксов.
Пример: Евангелие, Покаяние, Молитва, Пост

Текст:
{text}

Темы:"""


def _read_md(path: Path) -> tuple[str, str, str]:
    content = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", content, re.DOTALL)
    if m:
        return content, m.group(1), m.group(2)
    return content, "", content


def _add_topics(frontmatter: str, topics: list[str]) -> str:
    frontmatter = re.sub(r"^topics:.*?\n", "", frontmatter, flags=re.MULTILINE)
    line = f"topics: [{', '.join(topics)}]\n"
    if frontmatter and not frontmatter.endswith("\n"):
        frontmatter += "\n"
    return frontmatter + line


def _extract_topics(frontmatter: str) -> list[str] | None:
    m = re.search(r"^topics:\s*\[(.*)\]\s*$", frontmatter, re.MULTILINE)
    if not m:
        return None
    return [t.strip() for t in m.group(1).split(",") if t.strip()]


def _make_client_and_model() -> tuple[OpenAI, str]:
    if settings.enrich_provider == "local":
        return (
            OpenAI(api_key="not-needed", base_url=settings.lmstudio_base_url),
            settings.lmstudio_model,
        )
    return (
        OpenAI(api_key=settings.timeweb_ai_key, base_url=settings.timeweb_base_url),
        settings.enrich_model,
    )


async def run() -> None:
    client, model_name = _make_client_and_model()
    print(f"Using provider={settings.enrich_provider} model={model_name}")

    md_files = list(settings.output_dir.rglob("*.md"))
    work_topics: dict[str, set[str]] = {}

    with Progress() as progress:
        task = progress.add_task("Enriching", total=len(md_files))
        for path in md_files:
            progress.update(task, advance=1)
            content, fm, body = _read_md(path)

            existing = _extract_topics(fm)
            if existing is None:
                resp = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": PROMPT.format(text=body[:4000])}],
                    temperature=0.3,
                    max_tokens=100,
                )
                topics_str = resp.choices[0].message.content.strip()
                topics = [t.strip() for t in topics_str.split(",") if t.strip()][:7]
                if topics:
                    fm_new = _add_topics(fm, topics)
                    path.write_text(f"---\n{fm_new}---\n{body}", encoding="utf-8")
            else:
                topics = existing

            author = re.search(r"^author:\s*(.+)$", fm, re.MULTILINE)
            book = re.search(r"^book_title:\s*(.+)$", fm, re.MULTILINE)
            if author and book:
                ws = slugify(f"{slugify(author.group(1).strip())}_{book.group(1).strip()}")
                work_topics.setdefault(ws, set()).update(topics)

    await init_pool()
    async with conn() as c:
        for ws, topics in work_topics.items():
            await c.execute(
                "UPDATE works SET topics=%s WHERE slug=%s",
                [json.dumps(sorted(topics), ensure_ascii=False), ws],
            )
    await close_pool()
    print(f"Enriched topics for {len(work_topics)} works.")
