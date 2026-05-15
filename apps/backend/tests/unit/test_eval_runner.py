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
