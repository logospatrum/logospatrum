import pytest
from backend.budget.pricing import cost_rub, TARIFF_RUB


def test_sonnet_known_cost():
    # 1M input + 1M output of Sonnet 4.6 = 405 + 2025 = 2430 ₽
    assert cost_rub("claude-sonnet-4-6", 1_000_000, 1_000_000) == pytest.approx(2430.0)


def test_haiku_known_cost():
    # 1M input + 1M output of Haiku 4.5 = 108 + 540 = 648 ₽
    assert cost_rub("claude-haiku-4-5", 1_000_000, 1_000_000) == pytest.approx(648.0)


def test_anthropic_prefix_stripped():
    # Anthropic SDK puts the provider prefix; pricing must normalize.
    assert cost_rub("anthropic/claude-sonnet-4-6", 1000, 0) == pytest.approx(0.405)


def test_unknown_model_falls_back_to_default_pessimistically():
    # Unknown ≠ free. Default tariff is pessimistic.
    cost = cost_rub("some-future-model-x", 1000, 1000)
    assert cost == pytest.approx(0.5 + 2.5)  # 500 + 2500 per Mtok
    assert "__default__" in TARIFF_RUB


def test_zero_tokens_zero_cost():
    assert cost_rub("claude-sonnet-4-6", 0, 0) == 0.0
