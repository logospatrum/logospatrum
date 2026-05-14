"""Deterministic transliteration to ASCII-safe slug.

Uses GOST 7.79-2000 system B style transliteration for Russian Cyrillic.
Idempotent: slugify(slugify(x)) == slugify(x).
"""
import re
import unicodedata

# Russian Cyrillic → ASCII (GOST-flavoured, simplified for slugging)
_RU = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "j", "к": "k",
    "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c",
    "ч": "ch", "ш": "sh", "щ": "shh", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "ju", "я": "ja",
}


def _translit(text: str) -> str:
    out = []
    for ch in text.lower():
        if ch in _RU:
            out.append(_RU[ch])
        elif "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out)


def slugify(text: str, max_length: int = 100) -> str:
    """Return a deterministic ASCII slug for the given (possibly Cyrillic) text."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = _translit(text)
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = text.strip("_")
    if len(text) > max_length:
        text = text[:max_length].rstrip("_")
    return text
