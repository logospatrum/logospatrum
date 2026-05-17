from typing import TypedDict


class Tariff(TypedDict):
    input_per_mtok: float
    output_per_mtok: float


TARIFF_RUB: dict[str, Tariff] = {
    "claude-sonnet-4-6": {"input_per_mtok": 405.0, "output_per_mtok": 2025.0},
    "claude-haiku-4-5":  {"input_per_mtok": 108.0, "output_per_mtok": 540.0},
    # Pessimistic fallback: a misconfigured model registers as expensive, not free.
    "__default__":       {"input_per_mtok": 500.0, "output_per_mtok": 2500.0},
}


def cost_rub(model: str, input_tokens: int, output_tokens: int) -> float:
    t = TARIFF_RUB.get(_normalize_model(model)) or TARIFF_RUB["__default__"]
    return (
        input_tokens  * t["input_per_mtok"]  / 1_000_000
        + output_tokens * t["output_per_mtok"] / 1_000_000
    )


def _normalize_model(model: str) -> str:
    # Anthropic returns "anthropic/claude-sonnet-4-6" or just "claude-sonnet-4-6".
    return model.split("/")[-1]
