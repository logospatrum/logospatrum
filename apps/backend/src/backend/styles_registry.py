"""Style registry: scan markdown style preset files with YAML frontmatter.

Mirrors `skills_registry.py` but for response-style presets. Each style is a
markdown file with `name` + `description` frontmatter; the body (everything
after the second `---`) is the SystemMessage content injected by
`StyleMiddleware` before each LLM call. An empty body means "no extra
framing" — this is the case for `normal.md`.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Style:
    name: str
    description: str
    body: str
    path: Path


_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n?(.*)", re.DOTALL)


def scan_styles(styles_dir: Path) -> dict[str, Style]:
    """Scan a directory for *.md files with `name`/`description` frontmatter.

    Returns a dict keyed by `name`. Files without valid frontmatter or missing
    either key are silently skipped — one malformed file shouldn't break boot.
    """
    out: dict[str, Style] = {}
    for md in sorted(styles_dir.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        m = _FRONTMATTER.match(text)
        if not m:
            continue
        meta_block, body = m.group(1), m.group(2)
        meta = _parse_meta(meta_block)
        if "name" not in meta or "description" not in meta:
            continue
        out[meta["name"]] = Style(
            name=meta["name"],
            description=meta["description"],
            body=body,
            path=md,
        )
    return out


def _parse_meta(block: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in block.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out
