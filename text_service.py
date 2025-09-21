import httpx
import asyncio
from typing import List
from config import settings
from pathlib import Path
from urllib.parse import urlparse, unquote


class TextService:
    def __init__(self):
        self.chunk_size = settings.chunk_size
        self.chunk_overlap = settings.chunk_overlap

    async def download_text(self, url: str) -> str:
        parsed = urlparse(url)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()
                return response.text

        name = unquote(url)
        repo_dir = Path(__file__).resolve().parent
        texts_dir = (repo_dir / "texts").resolve()

        candidate = (texts_dir / name)
        try:
            candidate_resolved = candidate.resolve()
        except Exception:
            raise ValueError("Invalid filename")

        if not str(candidate_resolved).startswith(str(texts_dir)):
            raise ValueError("Invalid filename")

        if not candidate_resolved.exists() or not candidate_resolved.is_file():
            raise FileNotFoundError(f"Text file not found: {name}")

        content = await asyncio.to_thread(candidate_resolved.read_text, encoding="utf-8")
        return content

    def create_chunks(self, text: str) -> List[str]:
        chunks = []
        start = 0

        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]

            if end < len(text):
                last_space = chunk.rfind(' ')
                if last_space > self.chunk_size // 2:
                    chunk = chunk[:last_space]
                    end = start + last_space

            chunks.append(chunk.strip())
            start = end - self.chunk_overlap

            if start >= len(text):
                break

        return [chunk for chunk in chunks if chunk.strip()]


text_service = TextService()
