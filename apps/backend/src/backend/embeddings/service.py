"""Async embedding service with micro-batching."""
import asyncio
from typing import Any

from ..config import settings


class EmbeddingService:
    def __init__(self, model: Any, batch_size: int = 16, window_ms: int = 50) -> None:
        self._model = model
        self._batch_size = batch_size
        self._window_s = window_ms / 1000.0
        self._queue: asyncio.Queue[tuple[str, asyncio.Future]] = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._worker())

    async def stop(self) -> None:
        if self._worker_task is not None:
            # Signal shutdown via sentinel
            sentinel_fut: asyncio.Future = asyncio.get_event_loop().create_future()
            await self._queue.put(("__SHUTDOWN__", sentinel_fut))
            await self._worker_task
            self._worker_task = None

    async def embed(self, text: str) -> list[float]:
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        await self._queue.put((text, fut))
        return await fut

    async def _worker(self) -> None:
        while True:
            first = await self._queue.get()
            if first[0] == "__SHUTDOWN__":
                first[1].cancel()
                return
            batch: list[tuple[str, asyncio.Future]] = [first]

            deadline = asyncio.get_event_loop().time() + self._window_s
            while len(batch) < self._batch_size:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                try:
                    item = await asyncio.wait_for(self._queue.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                if item[0] == "__SHUTDOWN__":
                    item[1].cancel()
                    await self._process(batch)
                    # Drain any remaining items quickly
                    while True:
                        try:
                            extra = self._queue.get_nowait()
                            if extra[0] == "__SHUTDOWN__":
                                extra[1].cancel()
                                continue
                            await self._process([extra])
                        except asyncio.QueueEmpty:
                            break
                    return
                batch.append(item)

            await self._process(batch)

    async def _process(self, batch: list[tuple[str, asyncio.Future]]) -> None:
        texts = [t for t, _ in batch]
        try:
            vectors = await asyncio.to_thread(
                self._model.encode, texts, normalize_embeddings=True
            )
        except Exception as e:
            for _, fut in batch:
                if not fut.done():
                    fut.set_exception(e)
            return
        for (_, fut), vec in zip(batch, vectors):
            if not fut.done():
                fut.set_result(vec.tolist())


_svc: EmbeddingService | None = None
_svc_lock = asyncio.Lock()


def _create_service_sync() -> EmbeddingService:
    """Pure sync constructor; called only via asyncio.to_thread.

    SentenceTransformer's constructor scans the HF cache directory
    (`ScandirIterator.__next__`) and reads weight files — blocking I/O
    that will trip blockbuster if invoked on the main event loop.
    """
    from sentence_transformers import SentenceTransformer

    model = SentenceTransformer(settings.embedding_model, device=settings.embedding_device)
    return EmbeddingService(
        model=model,
        batch_size=settings.embedding_batch_size,
        window_ms=settings.embedding_batch_window_ms,
    )


async def get_service() -> EmbeddingService:
    """Async singleton accessor. First call loads bge-m3 in a worker thread;
    subsequent calls hit the cache without await overhead."""
    global _svc
    if _svc is not None:
        return _svc
    async with _svc_lock:
        if _svc is not None:
            return _svc
        _svc = await asyncio.to_thread(_create_service_sync)
    return _svc
