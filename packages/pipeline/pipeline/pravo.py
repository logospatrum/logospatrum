"""Orchestrator: scrape /pravo/ and emit one markdown file per rule.

Resumable by filesystem: skips a rule if the target md file already exists.
"""
from __future__ import annotations
import time
from dataclasses import replace
from pathlib import Path

import httpx

from .config import settings
from .pravo_index import (
    IndexEntry,
    parse_apostolic_index,
    parse_grouped_index,
)
from .pravo_markdown import CANON_ROOT_DIR, build_work_meta, render_rule
from .pravo_rule import ParsedRule, parse_rule_html

# (collection_id, index_url, parser)
_INDEXES: list[tuple[str, str, callable]] = [
    ("apostolskie",       "https://azbyka.ru/pravo/apostolskie/",       parse_apostolic_index),
    ("vselenskih-soborov","https://azbyka.ru/pravo/vselenskih-soborov/", parse_grouped_index),
    ("pomestnyh-soborov", "https://azbyka.ru/pravo/pomestnyh-soborov/",  parse_grouped_index),
    ("svyatootecheskie",  "https://azbyka.ru/pravo/svyatootecheskie/",   parse_grouped_index),
]


class PravoCollector:
    def __init__(self, output_dir: Path | None = None, throttle_ms: int = 200):
        self.output_dir = (output_dir or settings.output_dir).resolve()
        self.throttle_s = throttle_ms / 1000.0
        self.client = httpx.Client(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (christian_rag /pravo/ collector)"},
        )

    def close(self): self.client.close()
    def __enter__(self): return self
    def __exit__(self, *args): self.close()

    def _fetch(self, url: str) -> str:
        r = self.client.get(url)
        r.raise_for_status()
        return r.text

    def _collect_entries(self) -> list[IndexEntry]:
        all_entries: list[IndexEntry] = []
        for collection, url, parser in _INDEXES:
            print(f"[index] {url}")
            html = self._fetch(url)
            entries = parser(html, collection=collection)
            print(f"           → {len(entries)} rules")
            all_entries.extend(entries)
        return all_entries

    def _write_rule(self, entry: IndexEntry) -> Path | None:
        meta = build_work_meta(entry.collection, entry.group_title)
        # Pre-compute the target path so we can skip without fetching.
        # Use rule_num + a placeholder title — final md path doesn't depend
        # on parsed content, only on (author, work, rule_num).
        stub = ParsedRule(rule_num=entry.rule_num, h1="", short_content="", ru_text="")
        rel_path_preview, _ = render_rule(stub, meta, entry.rule_url)
        target = self.output_dir / rel_path_preview

        if target.exists():
            return None  # resume: already done

        html = self._fetch(entry.rule_url)
        rule = parse_rule_html(html)
        if rule.rule_num != entry.rule_num:
            # Defensive: if h1 misparse, force the number from the index.
            print(f"  [warn] {entry.rule_url}: h1 parsed rule_num={rule.rule_num}, "
                  f"index says {entry.rule_num}; using index")
            rule = replace(rule, rule_num=entry.rule_num)
        rel_path, content = render_rule(rule, meta, entry.rule_url)
        out = self.output_dir / rel_path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(content, encoding="utf-8")
        return out

    def run(self) -> dict[str, int]:
        entries = self._collect_entries()
        print(f"[total] {len(entries)} rules across {len(_INDEXES)} collections")

        stats = {"written": 0, "skipped": 0, "errors": 0}
        for i, entry in enumerate(entries, 1):
            label = f"{entry.collection}/{entry.rule_num} ({entry.rule_url})"
            try:
                out = self._write_rule(entry)
                if out is None:
                    stats["skipped"] += 1
                    print(f"  [{i}/{len(entries)}] skip  {label}")
                else:
                    stats["written"] += 1
                    print(f"  [{i}/{len(entries)}] write {out.relative_to(self.output_dir)}")
                    time.sleep(self.throttle_s)
            except httpx.HTTPStatusError as e:
                stats["errors"] += 1
                code = e.response.status_code
                print(f"  [{i}/{len(entries)}] ERR   {label}: HTTP {code}")
                if code == 429:
                    # Soft rate-limit cooldown; we don't retry the current rule (it'll
                    # be picked up on the next run by the resume-by-Path.exists() check),
                    # but we slow the rest of the loop.
                    print(f"  [warn] 429 received — sleeping 60s to respect rate limit")
                    time.sleep(60)
            except Exception as e:
                stats["errors"] += 1
                print(f"  [{i}/{len(entries)}] ERR   {label}: {type(e).__name__}: {e}")
        print(f"[done] written={stats['written']} skipped={stats['skipped']} errors={stats['errors']}")
        return stats
