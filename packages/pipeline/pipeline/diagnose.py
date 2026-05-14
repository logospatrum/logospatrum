"""Diagnostic scan: completeness of output/ and data/."""
import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from rich.console import Console
from rich.table import Table

from .config import settings


SINGLE_LONG_THRESHOLD_CHARS = 10000


class Issue(str, Enum):
    MISSING_DATA = "missing_data"
    NO_MD_OUTPUT = "no_md_output"
    SINGLE_CHAPTER_LONG = "single_chapter_long"
    EMPTY_WORK = "empty_work"


@dataclass
class AuthorReport:
    author_dir: str
    work_count: int
    md_count: int
    issues: list[Issue] = field(default_factory=list)
    detail: dict = field(default_factory=dict)


def analyze_corpus(root: Path) -> list[AuthorReport]:
    reports: list[AuthorReport] = []
    if not root.exists():
        return reports
    for author_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        r = AuthorReport(author_dir=author_dir.name, work_count=0, md_count=0)
        for work_dir in sorted(p for p in author_dir.iterdir() if p.is_dir()):
            r.work_count += 1
            md_files = list(work_dir.glob("*.md"))
            r.md_count += len(md_files)
            if not md_files:
                if Issue.EMPTY_WORK not in r.issues:
                    r.issues.append(Issue.EMPTY_WORK)
                r.detail.setdefault("empty_works", []).append(work_dir.name)
            elif len(md_files) == 1 and md_files[0].stat().st_size > SINGLE_LONG_THRESHOLD_CHARS:
                if Issue.SINGLE_CHAPTER_LONG not in r.issues:
                    r.issues.append(Issue.SINGLE_CHAPTER_LONG)
                r.detail.setdefault("single_long", []).append({
                    "work": work_dir.name, "size": md_files[0].stat().st_size,
                })
        reports.append(r)
    return reports


async def run() -> None:
    console = Console()
    out_root = settings.output_dir / "Православная_библиотека_Святых"
    reports = analyze_corpus(out_root)

    data_root = settings.data_dir / "Православная_библиотека_Святых_отцов_и_церковных_писателей"
    if data_root.exists():
        existing = {r.author_dir for r in reports}
        for author_dir in sorted(p for p in data_root.iterdir() if p.is_dir()):
            if author_dir.name not in existing:
                reports.append(AuthorReport(
                    author_dir=author_dir.name, work_count=0, md_count=0,
                    issues=[Issue.MISSING_DATA],
                ))

    table = Table(title="Corpus diagnostic")
    table.add_column("Author")
    table.add_column("Works", justify="right")
    table.add_column("MD files", justify="right")
    table.add_column("Issues", style="yellow")
    for r in reports:
        table.add_row(r.author_dir, str(r.work_count), str(r.md_count),
                      ", ".join(i.value for i in r.issues) if r.issues else "—")
    console.print(table)

    report_path = settings.output_dir.parent / "diagnose_report.json"
    report_path.write_text(json.dumps(
        {"reports": [
            {"author_dir": r.author_dir, "work_count": r.work_count, "md_count": r.md_count,
             "issues": [i.value for i in r.issues], "detail": r.detail}
            for r in reports
        ]},
        ensure_ascii=False, indent=2,
    ), encoding="utf-8")
    console.print(f"\nFull report → {report_path}")
