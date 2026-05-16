"""Static author mapping for /pravo/ corpus.

The pseudo-author for apostolic + council rules, and the 13 fathers on
/pravo/svyatootecheskie/ — 7 reuse existing /otechnik/ authors by slug,
6 introduce new authors.

Mapping is explicit (per §5 of the spec), never inferred at runtime.
"""
from __future__ import annotations
from dataclasses import dataclass

PATRISTIC_SECTION = "Православная библиотека Святых отцов и церковных писателей"


@dataclass(frozen=True)
class AuthorRef:
    slug: str
    name_display: str
    years_of_life: str | None
    global_section: str


KANONICHESKOE_PRAVO = AuthorRef(
    slug="kanonicheskoe_pravo",
    name_display="Каноническое право",
    years_of_life=None,
    global_section="Каноническое право",
)


# group_title (exact match, from /pravo/svyatootecheskie/ index <a title="…">) → AuthorRef
FATHER_GROUP_TO_AUTHOR: dict[str, AuthorRef] = {
    "Правила свт. Дионисия Александрийского (†265)": AuthorRef(
        "dionisij_aleksandrijskij_svjashhennomuchenik",
        "Дионисий Александрийский, священномученик",
        "†265", PATRISTIC_SECTION),
    "Правила свт. Григория Неокесарийского (†270)": AuthorRef(
        "grigorij_chudotvorec_episkop_neokesarijskij_svjatitel",
        "Григорий Чудотворец, епископ Неокесарийский, святитель",
        "†270", PATRISTIC_SECTION),
    "Правила свмч. Петра Александрийского (†311)": AuthorRef(
        "petr_aleksandrijskij_svjashhennomuchenik",
        "Петр Александрийский, священномученик",
        "†311", PATRISTIC_SECTION),
    "Правила свт. Афанасия Великого (†373)": AuthorRef(
        "afanasij_velikij_svjatitel",
        "Афанасий Великий, святитель",
        "†373", PATRISTIC_SECTION),
    "Правила свт. Василия Великого (†379)": AuthorRef(
        "vasilij_velikij_svjatitel",
        "Василий Великий, святитель",
        "†379", PATRISTIC_SECTION),
    "Правила свт. Григория Богослова (†389)": AuthorRef(
        "grigorij_bogoslov_nazianzin_svjatitel",
        "Григорий Богослов (Назианзин), святитель",
        "†389", PATRISTIC_SECTION),
    "Правила свт. Григория Нисского (†395)": AuthorRef(
        "grigorij_nisskij_svjatitel",
        "Григорий Нисский, святитель",
        "†395", PATRISTIC_SECTION),
    "Правила свт. Амфилохия Иконийского (†395)": AuthorRef(
        "amfilohij_ikonijskij_svjatitel",
        "Амфилохий Иконийский, святитель",
        "†395", PATRISTIC_SECTION),
    "Правила Тимофея, епископа Александрийского (†355)": AuthorRef(
        "timofej_aleksandrijskij_episkop",
        "Тимофей Александрийский, епископ",
        "†355", PATRISTIC_SECTION),
    "Правила Феофила, архиепископа Александрийского (†412)": AuthorRef(
        "feofil_aleksandrijskij_arhiepiskop",
        "Феофил Александрийский, архиепископ",
        "†412", PATRISTIC_SECTION),
    "Правила свт. Кирилла Александрийского (†444)": AuthorRef(
        "kirill_aleksandrijskij_svjatitel",
        "Кирилл Александрийский, святитель",
        "†444", PATRISTIC_SECTION),
    "Правила Геннадия Константинопольского (†458–459)": AuthorRef(
        "gennadij_konstantinopolskij_patriarh",
        "Геннадий Константинопольский, патриарх",
        "†458–459", PATRISTIC_SECTION),
    "Правила Тарасия Константинопольского (†809)": AuthorRef(
        "tarasij_konstantinopolskij_patriarh",
        "Тарасий Константинопольский, патриарх",
        "†809", PATRISTIC_SECTION),
}


def resolve_father(group_title: str) -> AuthorRef:
    """Return AuthorRef for a /pravo/svyatootecheskie/ group title.

    Raises KeyError if group is not in the explicit mapping — fail loud
    (azbyka added a new father → require human review of new slug choice).
    """
    return FATHER_GROUP_TO_AUTHOR[group_title]
