"""Bootstrap glossary.json by querying an LLM per seed concept."""
import json

from openai import OpenAI
from pydantic import BaseModel, ValidationError
from rich.progress import Progress

from .config import settings
from .models import ConceptEntry


PROMPT_TEMPLATE = """Ты помогаешь составить словарь патристических концептов на русском языке.

Для концепта «{term}» верни строгий JSON со следующими полями:
- canonical: каноническая форма (обычно совпадает с входом)
- synonyms: список русских синонимов и архаичных вариантов
- related: список тематически связанных понятий
- antonyms: список антонимов
- greek: список греческих святоотеческих терминов

Только JSON, без префиксов и комментариев. Все поля обязательны (пустой список если ничего нет)."""


class ConceptDict(BaseModel):
    concepts: dict[str, ConceptEntry]


def _load_existing() -> ConceptDict:
    if settings.glossary_path.exists():
        return ConceptDict.model_validate(
            json.loads(settings.glossary_path.read_text(encoding="utf-8"))
        )
    return ConceptDict(concepts={})


def _save(d: ConceptDict) -> None:
    settings.glossary_path.write_text(
        json.dumps(d.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


async def run() -> None:
    seed: list[str] = json.loads(settings.seed_concepts_path.read_text(encoding="utf-8"))
    existing = _load_existing()
    client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)

    with Progress() as progress:
        task = progress.add_task("Concepts", total=len(seed))
        for term in seed:
            progress.update(task, advance=1)
            if term in existing.concepts:
                continue
            resp = client.chat.completions.create(
                model=settings.enrich_model,
                messages=[{"role": "user", "content": PROMPT_TEMPLATE.format(term=term)}],
                temperature=0.2,
                max_tokens=500,
            )
            raw = resp.choices[0].message.content.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            try:
                entry = ConceptEntry.model_validate(json.loads(raw))
            except (json.JSONDecodeError, ValidationError) as e:
                print(f"  [skip] {term}: {e}")
                continue
            existing.concepts[term] = entry
            _save(existing)

    print(f"glossary.json now has {len(existing.concepts)} concepts.")
