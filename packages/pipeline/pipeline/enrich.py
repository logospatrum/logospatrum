import re
from pathlib import Path
from typing import Generator, List

from openai import OpenAI

from .config import Config

TOPIC_EXTRACTION_PROMPT = """Проанализируй следующий православный текст и выдели из него от 3 до 7 ключевых тем.
Ответ дай в формате списка через запятую, без лишнего текста.
Например: Евангелие, Покаяние, Молитва, Пост

Текст:
{text}

Темы:"""


class Enricher:
    def __init__(self, config: Config):
        self.config = config
        self.client = OpenAI(
            api_key="dummy",
            base_url=config.api_url
        ) if config.api_url else None

    def iter_markdown_files(self) -> Generator[Path, None, None]:
        output_dir = self.config.output_dir
        if not output_dir.exists():
            return
        for md_path in output_dir.rglob("*.md"):
            yield md_path

    def read_markdown(self, path: Path) -> tuple[str, str, str]:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        match = re.match(r"^---\n(.*?)\n---\n(.*)$", content, re.DOTALL)
        if match:
            frontmatter = match.group(1)
            body = match.group(2)
        else:
            frontmatter = ""
            body = content

        return content, frontmatter, body

    def extract_topics(self, text: str) -> List[str]:
        if not self.client:
            return []

        truncated = text[:4000]

        try:
            response = self.client.chat.completions.create(
                model=self.config.model_name or "gpt-4",
                messages=[
                    {"role": "user", "content": TOPIC_EXTRACTION_PROMPT.format(text=truncated)}
                ],
                max_tokens=100,
                temperature=0.3
            )
            topics_str = response.choices[0].message.content.strip()
            topics = [t.strip() for t in topics_str.split(",") if t.strip()]
            return topics[:7]
        except Exception as e:
            print(f"Error extracting topics: {e}")
            return []

    def add_topics_to_frontmatter(self, frontmatter: str, topics: List[str]) -> str:
        if "topics:" in frontmatter:
            frontmatter = re.sub(r"topics:.*?\n", "", frontmatter)

        topics_line = f"topics: [{', '.join(topics)}]\n"

        if frontmatter and not frontmatter.endswith("\n"):
            frontmatter += "\n"

        return frontmatter + topics_line

    def update_markdown(self, path: Path, frontmatter: str, body: str):
        content = f"---\n{frontmatter}---\n{body}"
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    def run(self):
        if not self.client:
            print("Error: API URL and model name required for enrichment")
            return

        for md_path in self.iter_markdown_files():
            print(f"Enriching: {md_path.name}")

            content, frontmatter, body = self.read_markdown(md_path)

            if "topics:" in frontmatter:
                print(f"  Already enriched, skipping")
                continue

            topics = self.extract_topics(body)
            if topics:
                print(f"  Topics: {topics}")
                frontmatter = self.add_topics_to_frontmatter(frontmatter, topics)
                self.update_markdown(md_path, frontmatter, body)

        print("Enrichment completed!")
