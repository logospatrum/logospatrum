from pipeline.lexical_preprocess import preprocess


def test_lowercase() -> None:
    assert preprocess("МОЛИТВА Иисусова") == "молитва иисусова"


def test_punctuation_stripped() -> None:
    assert preprocess("Послушание, есть отречение!") == "послушание есть отречение"


def test_cs_substitution_basic() -> None:
    out = preprocess("молитися о брате аще согрешит")
    assert "молиться" in out
    assert "молитися" not in out
    assert "если" in out
    assert "аще" not in out


def test_multiple_substitutions() -> None:
    out = preprocess("аще убо паки помыслил еси")
    assert "если" in out
    assert "итак" in out
    assert "снова" in out
    assert "аще" not in out
    assert "убо" not in out
    assert "паки" not in out


def test_substitution_only_whole_words() -> None:
    out = preprocess("пакибытие")
    assert out == "пакибытие"


def test_preserves_word_order() -> None:
    out = preprocess("Чесо ради сие глаголет?")
    parts = out.split()
    assert parts.index("что") < parts.index("говорит")


def test_empty_input() -> None:
    assert preprocess("") == ""
    assert preprocess("   \n  ") == ""
