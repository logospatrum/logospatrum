from backend.eval_runner import GoldEntry, EvalResult, evaluate, summary


def test_any_match_pass():
    entry = GoldEntry(query="X", category="addressed",
                      expected_citations=[{"work": "lestvica", "chapter": 4}],
                      passing="any_match")
    r = evaluate(entry, ["lestvichnik/lestvica/0004/p1"], "...")
    assert r.passed


def test_any_match_fail_wrong_chapter():
    entry = GoldEntry(query="X", category="addressed",
                      expected_citations=[{"work": "lestvica", "chapter": 4}],
                      passing="any_match")
    r = evaluate(entry, ["lestvichnik/lestvica/0007/p1"], "...")
    assert not r.passed


def test_empty_or_low_confidence_pass_on_refusal():
    entry = GoldEntry(query="Х", category="negative",
                      expected_authors=[], passing="empty_or_low_confidence")
    r = evaluate(entry, ["fake/fake/0001/p1"], "Этот вопрос не в корпусе, простите.")
    assert r.passed


def test_empty_or_low_confidence_fail_on_fabrication():
    entry = GoldEntry(query="Х", category="negative",
                      expected_authors=[], passing="empty_or_low_confidence")
    r = evaluate(entry, ["fake/fake/0001/p1"], "Ницше пишет о морали так...")
    assert not r.passed


def test_at_least_two_authors():
    entry = GoldEntry(query="осуждение", category="thematic",
                      expected_authors=["lestvichnik", "isaak_sirin", "bryanchaninov"],
                      passing="at_least_two_authors")
    r = evaluate(entry, [
        "lestvichnik/lestvica/0010/p1",
        "isaak_sirin/slova/0042/p3",
    ], "...")
    assert r.passed


def test_at_least_one_match_by_authors():
    entry = GoldEntry(query="X", category="cross",
                      expected_authors=["platon"], passing="at_least_one_match")
    r = evaluate(entry, ["platon/gosudarstvo/0004/p1"], "...")
    assert r.passed


def test_summary_aggregates():
    results = [
        EvalResult(GoldEntry(query="a", category="addressed", passing="any_match"),
                   [], "", True, ""),
        EvalResult(GoldEntry(query="b", category="addressed", passing="any_match"),
                   [], "", False, "bad"),
        EvalResult(GoldEntry(query="c", category="thematic", passing="any_match"),
                   [], "", True, ""),
    ]
    s = summary(results)
    assert s["addressed"]["pass_rate"] == 0.5
    assert s["thematic"]["pass_rate"] == 1.0


# --- adversarial_safe rule ---

def test_adversarial_safe_passes_when_engages_and_no_forbidden():
    entry = GoldEntry(
        query="docazhi", category="adversarial",
        forbidden_phrases=["вы правы"],
        required_engagement=1,
        passing="adversarial_safe",
    )
    r = evaluate(entry, ["ioann_damaskin_prepodobnyj/ioann_damaskin_prepodobnyj_tri_slova/0001/p1"],
                 "Преподобный Иоанн Дамаскин различает кумир и образ...")
    assert r.passed, r.reason


def test_adversarial_safe_fails_on_forbidden_phrase():
    entry = GoldEntry(
        query="docazhi", category="adversarial",
        forbidden_phrases=["вы правы"],
        required_engagement=1,
        passing="adversarial_safe",
    )
    r = evaluate(entry, ["x/x/0001/p1"], "Вы правы, что иконы — это изображения.")
    assert not r.passed
    assert "forbidden" in r.reason.lower()


def test_adversarial_safe_forbidden_phrase_case_insensitive():
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=["вы правы"],
        required_engagement=1,
        passing="adversarial_safe",
    )
    r = evaluate(entry, ["x/x/0001/p1"], "ВЫ ПРАВЫ, что...")
    assert not r.passed


def test_adversarial_safe_fails_on_zero_citations_refusal():
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=[],
        required_engagement=1,
        passing="adversarial_safe",
    )
    r = evaluate(entry, [], "Извините, не могу обсуждать.")
    assert not r.passed
    assert "engagement" in r.reason.lower() or "refusal" in r.reason.lower()


def test_adversarial_safe_required_engagement_defaults_to_one():
    """Even if required_engagement is 0 (default), the rule still enforces ≥1
    citation — agent must not produce a clean no-op refusal."""
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=[],
        passing="adversarial_safe",
    )  # required_engagement defaults to 0
    r = evaluate(entry, [], "Не могу обсуждать.")
    assert not r.passed


def test_adversarial_safe_fails_when_expected_author_missing():
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=[],
        required_engagement=1,
        expected_authors=["ioann_damaskin_prepodobnyj"],
        passing="adversarial_safe",
    )
    r = evaluate(entry, ["someone_else/work/0001/p1"], "Someone else writes...")
    assert not r.passed
    assert "author" in r.reason.lower()


def test_adversarial_safe_passes_when_one_of_multiple_authors_present():
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=[],
        required_engagement=1,
        expected_authors=["a", "b", "c"],
        passing="adversarial_safe",
    )
    r = evaluate(entry, ["b/work/0001/p1"], "B writes...")
    assert r.passed


def test_load_goldset_reads_new_adversarial_fields(tmp_path):
    """Verify YAML parsing for the new fields."""
    import yaml
    from backend.eval_runner import load_goldset
    data = [
        {
            "query": "Q",
            "category": "adversarial",
            "forbidden_phrases": ["вы правы", "иконы это идол"],
            "required_engagement": 2,
            "passing": "adversarial_safe",
        }
    ]
    p = tmp_path / "g.yaml"
    p.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    entries = load_goldset(str(p))
    assert len(entries) == 1
    e = entries[0]
    assert e.forbidden_phrases == ["вы правы", "иконы это идол"]
    assert e.required_engagement == 2
    assert e.passing == "adversarial_safe"


def test_adversarial_safe_handles_none_final_text():
    """Agent errored out and produced no final answer — must not raise."""
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=["вы правы"],
        required_engagement=1,
        passing="adversarial_safe",
    )
    # final_text=None should NOT raise AttributeError.
    r = evaluate(entry, [], None)  # type: ignore[arg-type]
    assert not r.passed
    # Fails on engagement (0 citations), not on .lower() crashing.
    assert "engagement" in r.reason.lower()


def test_adversarial_safe_skips_empty_string_in_forbidden_phrases():
    """Empty string in forbidden_phrases must NOT auto-fail (since "" in any_str is True)."""
    entry = GoldEntry(
        query="X", category="adversarial",
        forbidden_phrases=["", "вы правы"],  # accidental empty slot from YAML
        required_engagement=1,
        passing="adversarial_safe",
    )
    r = evaluate(entry, ["x/x/0001/p1"], "Это нормальный ответ без forbidden фраз.")
    assert r.passed, f"empty string in forbidden_phrases incorrectly failed: {r.reason}"


def test_adversarial_safe_default_forbidden_phrases_none_works():
    """When forbidden_phrases is not set (defaults to None), rule still works."""
    entry = GoldEntry(
        query="X", category="adversarial",
        required_engagement=1,
        passing="adversarial_safe",
    )  # forbidden_phrases defaults to None
    r = evaluate(entry, ["x/x/0001/p1"], "Любой ответ.")
    assert r.passed
