// Mapping from canonical Bible work_slug (as ingested by the pipeline) to
// azbyka.ru/biblia/?<code>.X:Y reference codes + short ru/en labels.
//
// The pipeline stores Bible works under slugs like `bible_evangelie_ot_matfeja`
// with `chapter_num` = Bible chapter and `para_num` = verse number; see
// `pipeline/paragraphs.py::_ingest_bible`. `source_url` is NULL for Bible
// works, so the frontend builds the azbyka link from this map.

export interface BibleBook {
  /** azbyka.ru/biblia query code, e.g. "Mt" for Matthew. */
  azbykaCode: string;
  /** Short Russian display label, e.g. "Мф". */
  ruShort: string;
  /** Short English display label, e.g. "Mt". */
  enShort: string;
}

export const BIBLE_BOOKS: Record<string, BibleBook> = {
  // New Testament
  bible_evangelie_ot_matfeja:                                 { azbykaCode: "Mt",    ruShort: "Мф",    enShort: "Mt" },
  bible_evangelie_ot_marka:                                   { azbykaCode: "Mk",    ruShort: "Мк",    enShort: "Mk" },
  bible_evangelie_ot_luki:                                    { azbykaCode: "Lk",    ruShort: "Лк",    enShort: "Lk" },
  bible_evangelie_ot_ioanna:                                  { azbykaCode: "Jn",    ruShort: "Ин",    enShort: "Jn" },
  bible_dejanija_svjatyh_apostolov:                           { azbykaCode: "Act",   ruShort: "Деян",  enShort: "Acts" },
  bible_sobornoe_poslanie_svjatogo_apostola_iakova:           { azbykaCode: "Jac",   ruShort: "Иак",   enShort: "Jas" },
  bible_1_e_sobornoe_poslanie_svjatogo_apostola_petra:        { azbykaCode: "1Pet",  ruShort: "1 Пет", enShort: "1 Pet" },
  bible_2_e_sobornoe_poslanie_svjatogo_apostola_petra:        { azbykaCode: "2Pet",  ruShort: "2 Пет", enShort: "2 Pet" },
  bible_1_e_sobornoe_poslanie_apostola_ioanna_bogoslova:      { azbykaCode: "1Jn",   ruShort: "1 Ин",  enShort: "1 Jn" },
  bible_2_e_sobornoe_poslanie_apostola_ioanna_bogoslova:      { azbykaCode: "2Jn",   ruShort: "2 Ин",  enShort: "2 Jn" },
  bible_3_e_sobornoe_poslanie_apostola_ioanna_bogoslova:      { azbykaCode: "3Jn",   ruShort: "3 Ин",  enShort: "3 Jn" },
  bible_sobornoe_poslanie_svjatogo_apostola_iudy:             { azbykaCode: "Juda",  ruShort: "Иуд",   enShort: "Jude" },
  bible_poslanie_svjatogo_apostola_pavla_k_rimljanam:         { azbykaCode: "Rom",   ruShort: "Рим",   enShort: "Rom" },
  bible_1_e_poslanie_svjatogo_apostola_pavla_k_korinfjanam:   { azbykaCode: "1Cor",  ruShort: "1 Кор", enShort: "1 Cor" },
  bible_2_e_poslanie_svjatogo_apostola_pavla_k_korinfjanam:   { azbykaCode: "2Cor",  ruShort: "2 Кор", enShort: "2 Cor" },
  bible_poslanie_svjatogo_apostola_pavla_k_galatam:           { azbykaCode: "Gal",   ruShort: "Гал",   enShort: "Gal" },
  bible_poslanie_svjatogo_apostola_pavla_k_efesjanam:         { azbykaCode: "Eph",   ruShort: "Еф",    enShort: "Eph" },
  bible_poslanie_svjatogo_apostola_pavla_k_filippijcam:       { azbykaCode: "Phil",  ruShort: "Флп",   enShort: "Phil" },
  bible_poslanie_svjatogo_apostola_pavla_k_kolosjanam:        { azbykaCode: "Col",   ruShort: "Кол",   enShort: "Col" },
  bible_1_e_poslanie_svjatogo_apostola_pavla_k_fessalonikij:  { azbykaCode: "1Thes", ruShort: "1 Фес", enShort: "1 Thess" },
  bible_2_e_poslanie_svjatogo_apostola_pavla_k_fessalonikij:  { azbykaCode: "2Thes", ruShort: "2 Фес", enShort: "2 Thess" },
  bible_1_e_poslanie_svjatogo_apostola_pavla_k_timofeju:      { azbykaCode: "1Tim",  ruShort: "1 Тим", enShort: "1 Tim" },
  bible_2_e_poslanie_svjatogo_apostola_pavla_k_timofeju:      { azbykaCode: "2Tim",  ruShort: "2 Тим", enShort: "2 Tim" },
  bible_poslanie_svjatogo_apostola_pavla_k_titu:              { azbykaCode: "Tit",   ruShort: "Тит",   enShort: "Tit" },
  bible_poslanie_svjatogo_apostola_pavla_k_filimonu:          { azbykaCode: "Phlm",  ruShort: "Флм",   enShort: "Phlm" },
  bible_poslanie_svjatogo_apostola_pavla_k_evrejam:           { azbykaCode: "Hebr",  ruShort: "Евр",   enShort: "Heb" },
  bible_otkrovenie_ioanna_bogoslova:                          { azbykaCode: "Apok",  ruShort: "Откр",  enShort: "Rev" },

  // Old Testament
  bible_bytie:                                                { azbykaCode: "Gen",    ruShort: "Быт",   enShort: "Gen" },
  bible_ishod:                                                { azbykaCode: "Ex",     ruShort: "Исх",   enShort: "Ex" },
  bible_levit:                                                { azbykaCode: "Lev",    ruShort: "Лев",   enShort: "Lev" },
  bible_chisla:                                               { azbykaCode: "Num",    ruShort: "Чис",   enShort: "Num" },
  bible_vtorozakonie:                                         { azbykaCode: "Deut",   ruShort: "Втор",  enShort: "Deut" },
  bible_kniga_iisusa_navina:                                  { azbykaCode: "Nav",    ruShort: "Нав",   enShort: "Josh" },
  bible_kniga_sudej_izrailevyh:                               { azbykaCode: "Judg",   ruShort: "Суд",   enShort: "Judg" },
  bible_kniga_rufi:                                           { azbykaCode: "Rth",    ruShort: "Руф",   enShort: "Ruth" },
  bible_knigi_carstv_1_ja:                                    { azbykaCode: "1Sam",   ruShort: "1 Цар", enShort: "1 Sam" },
  bible_knigi_carstv_2_ja:                                    { azbykaCode: "2Sam",   ruShort: "2 Цар", enShort: "2 Sam" },
  bible_knigi_carstv_3_ja:                                    { azbykaCode: "1King",  ruShort: "3 Цар", enShort: "1 Kgs" },
  bible_knigi_carstv_4_ja:                                    { azbykaCode: "2King",  ruShort: "4 Цар", enShort: "2 Kgs" },
  bible_knigi_paralipomenon_hronik_1_ja:                      { azbykaCode: "1Chron", ruShort: "1 Пар", enShort: "1 Chron" },
  bible_knigi_paralipomenon_hronik_2_ja:                      { azbykaCode: "2Chron", ruShort: "2 Пар", enShort: "2 Chron" },
  bible_kniga_ezdry_1_ja:                                     { azbykaCode: "Ezr",    ruShort: "1 Езд", enShort: "Ezra" },
  bible_kniga_ezdry_2_ja:                                     { azbykaCode: "2Ezr",   ruShort: "2 Езд", enShort: "2 Ezra" },
  bible_kniga_ezdry_3_ja:                                     { azbykaCode: "3Ezr",   ruShort: "3 Езд", enShort: "3 Ezra" },
  bible_kniga_tovita:                                         { azbykaCode: "Tov",    ruShort: "Тов",   enShort: "Tob" },
  bible_kniga_iudifi:                                         { azbykaCode: "Judf",   ruShort: "Иудиф", enShort: "Jdt" },
  bible_kniga_neemii:                                         { azbykaCode: "Nehem",  ruShort: "Неем",  enShort: "Neh" },
  bible_kniga_esfiri:                                         { azbykaCode: "Est",    ruShort: "Есф",   enShort: "Esth" },
  bible_tolkovanie_na_1_ju_knigu_makkavejskuju:               { azbykaCode: "1Mac",   ruShort: "1 Мак", enShort: "1 Macc" },
  bible_tolkovanie_na_2_ju_knigu_makkavejskuju:               { azbykaCode: "2Mac",   ruShort: "2 Мак", enShort: "2 Macc" },
  bible_tolkovanie_na_3_ju_knigu_makkavejskuju:               { azbykaCode: "3Mac",   ruShort: "3 Мак", enShort: "3 Macc" },
  bible_kniga_iova:                                           { azbykaCode: "Job",    ruShort: "Иов",   enShort: "Job" },
  bible_psaltir:                                              { azbykaCode: "Ps",     ruShort: "Пс",    enShort: "Ps" },
  bible_kniga_pritchej_solomonovyh:                           { azbykaCode: "Prov",   ruShort: "Притч", enShort: "Prov" },
  bible_kniga_ekkleziasta_ili_propovednika:                   { azbykaCode: "Eccl",   ruShort: "Еккл",  enShort: "Eccl" },
  bible_pesn_pesnej_solomona:                                 { azbykaCode: "Song",   ruShort: "Песн",  enShort: "Song" },
  bible_kniga_premudrosti_solomona:                           { azbykaCode: "Solom",  ruShort: "Прем",  enShort: "Wis" },
  bible_kniga_premudrosti_iisusa_syna_sirahova:               { azbykaCode: "Sir",    ruShort: "Сир",   enShort: "Sir" },
  bible_isaii:                                                { azbykaCode: "Is",     ruShort: "Ис",    enShort: "Isa" },
  bible_ieremii:                                              { azbykaCode: "Jer",    ruShort: "Иер",   enShort: "Jer" },
  bible_plach_ieremii:                                        { azbykaCode: "Lam",    ruShort: "Плач",  enShort: "Lam" },
  bible_poslanie_ieremii:                                     { azbykaCode: "pJer",   ruShort: "Посл Иер", enShort: "Let Jer" },
  bible_varuha:                                               { azbykaCode: "Bar",    ruShort: "Вар",   enShort: "Bar" },
  bible_iezekiilja:                                           { azbykaCode: "Ezek",   ruShort: "Иез",   enShort: "Ezek" },
  bible_daniila:                                              { azbykaCode: "Dan",    ruShort: "Дан",   enShort: "Dan" },
  bible_osii:                                                 { azbykaCode: "Hos",    ruShort: "Ос",    enShort: "Hos" },
  bible_ioilja:                                               { azbykaCode: "Joel",   ruShort: "Иоиль", enShort: "Joel" },
  bible_amosa:                                                { azbykaCode: "Am",     ruShort: "Ам",    enShort: "Am" },
  bible_avdija:                                               { azbykaCode: "Avd",    ruShort: "Авд",   enShort: "Obad" },
  bible_iony:                                                 { azbykaCode: "Jona",   ruShort: "Иона",  enShort: "Jon" },
  bible_miheja:                                               { azbykaCode: "Mic",    ruShort: "Мих",   enShort: "Mic" },
  bible_nauma:                                                { azbykaCode: "Naum",   ruShort: "Наум",  enShort: "Nah" },
  bible_avvakuma:                                             { azbykaCode: "Habak",  ruShort: "Авв",   enShort: "Hab" },
  bible_sofonii:                                              { azbykaCode: "Sofon",  ruShort: "Соф",   enShort: "Zeph" },
  bible_aggeja:                                               { azbykaCode: "Hag",    ruShort: "Агг",   enShort: "Hag" },
  bible_zaharii:                                              { azbykaCode: "Zah",    ruShort: "Зах",   enShort: "Zech" },
  bible_malahii:                                              { azbykaCode: "Mal",    ruShort: "Мал",   enShort: "Mal" },
};

/** Returns the BibleBook entry for a work_slug, or null if it isn't a Bible work. */
export function bibleBookFor(workSlug: string): BibleBook | null {
  return BIBLE_BOOKS[workSlug] ?? null;
}

/** Builds the azbyka.ru/biblia/?Code.Chapter:Verse[-Verse] URL.
 *  Returns null for non-Bible slugs. */
export function bibleAzbykaUrl(
  workSlug: string,
  chapter: number,
  paraStart: number,
  windowSize: number,
): string | null {
  const book = bibleBookFor(workSlug);
  if (!book) return null;
  const end = paraStart + windowSize - 1;
  const range = windowSize > 1 ? `${paraStart}-${end}` : `${paraStart}`;
  return `https://azbyka.ru/biblia/?${book.azbykaCode}.${chapter}:${range}`;
}

/** Short reference label like "Мф 1:2" or "Мф 1:2–4" (en-dash for ranges).
 *  Returns null for non-Bible slugs. */
export function bibleShortRef(
  workSlug: string,
  lang: "ru" | "en",
  chapter: number,
  paraStart: number,
  windowSize: number,
): string | null {
  const book = bibleBookFor(workSlug);
  if (!book) return null;
  const label = lang === "ru" ? book.ruShort : book.enShort;
  const end = paraStart + windowSize - 1;
  const range = windowSize > 1 ? `${paraStart}–${end}` : `${paraStart}`;
  return `${label} ${chapter}:${range}`;
}

/** Parses the work_slug out of a canonical citation
 *  (`author/work/chapter/pX[-Y]`). Returns null on malformed input. */
export function workSlugFromCitation(citation: string): string | null {
  const parts = citation.split("/");
  if (parts.length !== 4) return null;
  return parts[1];
}
