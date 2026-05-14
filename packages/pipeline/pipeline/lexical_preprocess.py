"""Lexical preprocessing for Russian + Church Slavonic substitution.

Same function is used at index time (tsvector building) and at query time
(lexical_search). Must be stable and deterministic.
"""
import json
import re
from functools import lru_cache

from .config import settings


@lru_cache(maxsize=1)
def _cs_dict() -> dict[str, str]:
    if not settings.cs_dict_path.exists():
        return {}
    with settings.cs_dict_path.open("r", encoding="utf-8") as f:
        return json.load(f)


_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")


def preprocess(text: str) -> str:
    """Lowercase, strip punctuation, substitute Church Slavonic forms.

    Substitutions are whole-word only.
    """
    if not text:
        return ""
    text = text.lower()
    text = _PUNCT_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if not text:
        return ""

    cs = _cs_dict()
    if cs:
        tokens = text.split(" ")
        tokens = [cs.get(t, t) for t in tokens]
        text = " ".join(tokens)

    return text
