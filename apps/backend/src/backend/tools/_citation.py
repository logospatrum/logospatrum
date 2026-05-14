"""Canonical citation format helpers."""


def make_citation(author_slug: str, work_slug: str, chapter_num: int,
                  para_start: int, window_size: int = 1) -> str:
    if window_size == 1:
        return f"{author_slug}/{work_slug}/{chapter_num:04d}/p{para_start}"
    para_end = para_start + window_size - 1
    return f"{author_slug}/{work_slug}/{chapter_num:04d}/p{para_start}-{para_end}"


def parse_citation(citation: str) -> dict:
    """Parse 'author/work/chapter/pX[-Y]' back to fields."""
    parts = citation.split("/")
    if len(parts) != 4:
        raise ValueError(f"bad citation: {citation}")
    author, work, chapter, p = parts
    chapter_num = int(chapter)
    if "-" in p:
        a, b = p[1:].split("-")
        para_start = int(a)
        window_size = int(b) - para_start + 1
    else:
        para_start = int(p[1:])
        window_size = 1
    return {
        "author_slug": author,
        "work_slug": work,
        "chapter_num": chapter_num,
        "para_start": para_start,
        "window_size": window_size,
    }
