# Logospatrum — Λόγος Πατρῶν

![Logospatrum main screen](docs/screenshots/main-screen.png)

Theological research assistant over a ~2,100-work patristic corpus.
Ask in any language; the agent retrieves and quotes the Fathers
verbatim with full citation provenance.

**Live:** https://logospatrum.com

## What it does

Logospatrum is an agentic RAG over the patristic corpus mirrored from
[azbyka.ru](https://azbyka.ru) — 86 authors, ~2,100 works, 726K paragraphs
indexed both semantically (multilingual bge-m3 + pgvector) and lexically
(Postgres tsvector). The agent answers three kinds of questions well:

- **Addressed** — "what does Climacus say about obedience", "Palamas
  on the Tabor Light". Find what a specific Father wrote on a topic.
- **Thematic** — "patristic teaching on nepsis", "what is theosis".
  Pull across multiple authors.
- **Cross-author** — "compare Chrysostom and Augustine on free will".
  Contrast positions.

Quoted passages are returned in the corpus language (Russian
translation); the agent reads and replies in whatever language you
write to it.

The contract is strict: the search subagent (Haiku 4.5) returns
candidate citations only; the main agent (Sonnet 4.6) quotes verbatim
via a dedicated `read_passage` tool. The model never paraphrases the
Fathers in its own words — every quoted line is a real paragraph from
the corpus, addressable by an immutable citation slug. A 53-query
goldset gates regressions before each release.

## Use it from your own agent (MCP)

Logospatrum exposes its search and citation tools over MCP at
`https://logospatrum.com/api/mcp` (public, no auth, rate-limited per
IP). Any MCP-capable client can use it.

**Claude Code** — install the plugin (recommended, ships a focused
subagent + skill that enforces the search-then-quote pattern):

```
/plugin marketplace add https://github.com/logospatrum/patristic-plugin
/plugin install patristic
```

Or just register the MCP server without the plugin:

```
claude mcp add --transport http patristic https://logospatrum.com/api/mcp
```

**Cursor / Cline / langchain-mcp-adapters / custom agent** — paste into
your `mcpServers` config:

```json
{
  "patristic": {
    "type": "http",
    "url": "https://logospatrum.com/api/mcp"
  }
}
```

**Six tools** exposed: `read_passage` (verbatim paragraph by citation
slug), `lexical_search` (tsvector), `semantic_search` (pgvector
cosine), `list_authors`, `list_works`, `expand_concept` (Church-Slavonic
/ archaic synonym resolver). Full reference and the "why a subagent +
skill" rationale: [plugins/patristic-plugin/README.md](plugins/patristic-plugin/README.md).

## Limitations

- Snapshot of azbyka.ru taken in spring 2026 — not auto-refreshed.
- Quoted passages are in their published Russian translation. The agent
  understands and answers in other languages, but the source text stays
  as published.
- The agent retrieves and cites; it does not adjudicate theology. Treat
  output as a research aid, not a magisterial answer.
- Public chat at logospatrum.com runs on a tight per-IP / per-cookie
  daily budget. Heavy users should self-host or use the MCP from their
  own LLM account.

## Repo layout

- `apps/backend/` — LangGraph graph + FastAPI catalog/budget endpoints.
- `apps/frontend/` — Next.js 15 chat UI ("Logos" shell).
- `packages/pipeline/` — corpus ingest CLI.
- `plugins/patristic-plugin/` — git submodule →
  [logospatrum/patristic-plugin](https://github.com/logospatrum/patristic-plugin).
- `infra/` — docker-compose, nginx, SQL migrations.
- `tests/eval/gold.yaml` — 53-query acceptance set.
- `docs/superpowers/{specs,plans}/` — design docs.

## Local development

See [docs/local-dev.md](docs/local-dev.md). Day-to-day repo notes for
contributors: [CLAUDE.md](CLAUDE.md), with deeper guides at
[apps/backend/CLAUDE.md](apps/backend/CLAUDE.md) and
[apps/frontend/CLAUDE.md](apps/frontend/CLAUDE.md).

## Tech stack

LangGraph Server with [deepagents](https://github.com/langchain-ai/deepagents)
two-tier graph (Claude Sonnet 4.6 main + Haiku 4.5 search subagent) ·
Postgres 16 + pgvector (HNSW) + tsvector ·
[bge-m3](https://huggingface.co/BAAI/bge-m3) embeddings · Next.js 15
frontend forked from [agent-chat-ui](https://github.com/langchain-ai/agent-chat-ui)
· MCP server bundled into the LangGraph app.

## Corpus credit

All patristic texts are sourced from **[azbyka.ru](https://azbyka.ru)**.
Logospatrum is an independent research tool and is not affiliated with,
endorsed by, or maintained by Azbuka Very. The corpus is reproduced for
study and citation; copyright on the underlying translations rests with
their respective publishers.

## License

MIT.
