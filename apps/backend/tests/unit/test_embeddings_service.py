import asyncio
import pytest

from backend.embeddings.service import EmbeddingService


@pytest.mark.asyncio
async def test_single_embedding_returns_vector(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=20)
    await svc.start()
    try:
        vec = await svc.embed("hello world")
        assert len(vec) == 1024
        assert vec[0] == pytest.approx(11.0 / 1000.0)
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_parallel_calls_batched(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=8, window_ms=20)
    await svc.start()
    try:
        results = await asyncio.gather(*[svc.embed(f"q{i}") for i in range(8)])
        assert len(results) == 8
        assert len(fake_model.encode_calls) <= 2
        total = sum(len(b) for b in fake_model.encode_calls)
        assert total == 8
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_batch_filled_to_max(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=500)
    await svc.start()
    try:
        results = await asyncio.gather(*[svc.embed(f"x{i}") for i in range(8)])
        assert len(results) == 8
        assert len(fake_model.encode_calls) == 2
        assert all(len(b) == 4 for b in fake_model.encode_calls)
    finally:
        await svc.stop()


@pytest.mark.asyncio
async def test_stop_drains_queue(fake_model):
    svc = EmbeddingService(model=fake_model, batch_size=4, window_ms=50)
    await svc.start()
    tasks = [asyncio.create_task(svc.embed(f"t{i}")) for i in range(3)]
    await asyncio.sleep(0.01)
    await svc.stop()
    results = await asyncio.gather(*tasks)
    assert len(results) == 3
