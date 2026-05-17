"""Skills registry: scan markdown skill files with YAML frontmatter."""
from __future__ import annotations
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    body: str
    path: Path


_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n(.*)", re.DOTALL)


def scan_skills(skills_dir: Path) -> list[Skill]:
    """Scan a directory for *.md files with `name`/`description` frontmatter.

    Returns skills sorted by path. Files without a `---`-delimited frontmatter
    block, or missing either `name` or `description`, are silently skipped —
    we don't want one malformed file to break boot.
    """
    skills: list[Skill] = []
    for md in sorted(skills_dir.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        m = _FRONTMATTER.match(text)
        if not m:
            continue
        meta_block, body = m.group(1), m.group(2)
        meta = _parse_meta(meta_block)
        if "name" not in meta or "description" not in meta:
            continue
        skills.append(Skill(
            name=meta["name"],
            description=meta["description"],
            body=body,
            path=md,
        ))
    return skills


def _parse_meta(block: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in block.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def render_skills_registry_for_prompt(skills: list[Skill]) -> str:
    """Compact 'available skills' block for system-prompt injection.

    Returns empty string when no skills — caller substitutes it in via
    str.replace so an empty registry leaves no trace.
    """
    if not skills:
        return ""
    lines = ["# Available skills (call invoke_skill(name) for full content)"]
    for s in skills:
        lines.append(f"- {s.name}: {s.description}")
    return "\n".join(lines)
