import { describe, it, expect } from "vitest";
import {
  bibleBookFor,
  bibleAzbykaUrl,
  bibleShortRef,
  workSlugFromCitation,
  BIBLE_BOOKS,
} from "../bible-books";

describe("bibleBookFor", () => {
  it("returns the entry for a known Bible slug", () => {
    expect(bibleBookFor("bible_evangelie_ot_matfeja")).toEqual({
      azbykaCode: "Mt",
      ruShort: "Мф",
      enShort: "Mt",
    });
  });

  it("returns null for a non-Bible slug", () => {
    expect(
      bibleBookFor(
        "sokolov_tihon_zadonskij_svjatitel/sokolov_tihon_zadonskij_svjatitel_simfonija",
      ),
    ).toBeNull();
  });

  it("covers all five canonical groups (Gospels, Acts, Catholic Epistles, Pauline, Apocalypse)", () => {
    expect(bibleBookFor("bible_evangelie_ot_marka")?.azbykaCode).toBe("Mk");
    expect(bibleBookFor("bible_dejanija_svjatyh_apostolov")?.azbykaCode).toBe("Act");
    expect(bibleBookFor("bible_sobornoe_poslanie_svjatogo_apostola_iakova")?.azbykaCode).toBe("Jac");
    expect(bibleBookFor("bible_1_e_poslanie_svjatogo_apostola_pavla_k_korinfjanam")?.azbykaCode).toBe("1Cor");
    expect(bibleBookFor("bible_otkrovenie_ioanna_bogoslova")?.azbykaCode).toBe("Apok");
  });

  it("ships a full OT mapping (Genesis, Psalms, Isaiah, Maccabees-as-tolkovanie)", () => {
    expect(bibleBookFor("bible_bytie")?.azbykaCode).toBe("Gen");
    expect(bibleBookFor("bible_psaltir")?.azbykaCode).toBe("Ps");
    expect(bibleBookFor("bible_isaii")?.azbykaCode).toBe("Is");
    expect(bibleBookFor("bible_tolkovanie_na_1_ju_knigu_makkavejskuju")?.azbykaCode).toBe("1Mac");
  });
});

describe("bibleAzbykaUrl", () => {
  it("builds a single-verse URL", () => {
    expect(bibleAzbykaUrl("bible_evangelie_ot_matfeja", 1, 2, 1)).toBe(
      "https://azbyka.ru/biblia/?Mt.1:2",
    );
  });

  it("builds a verse-range URL with hyphen separator", () => {
    expect(bibleAzbykaUrl("bible_evangelie_ot_matfeja", 1, 2, 3)).toBe(
      "https://azbyka.ru/biblia/?Mt.1:2-4",
    );
  });

  it("returns null for non-Bible slugs", () => {
    expect(bibleAzbykaUrl("palama/triady/0001", 1, 1, 1)).toBeNull();
  });
});

describe("bibleShortRef", () => {
  it("renders Russian single-verse ref", () => {
    expect(bibleShortRef("bible_evangelie_ot_matfeja", "ru", 1, 2, 1)).toBe("Мф 1:2");
  });

  it("renders English single-verse ref", () => {
    expect(bibleShortRef("bible_evangelie_ot_matfeja", "en", 1, 2, 1)).toBe("Mt 1:2");
  });

  it("uses en-dash for verse ranges", () => {
    expect(bibleShortRef("bible_evangelie_ot_matfeja", "ru", 1, 2, 3)).toBe("Мф 1:2–4");
    expect(bibleShortRef("bible_evangelie_ot_matfeja", "en", 1, 2, 3)).toBe("Mt 1:2–4");
  });

  it("returns null for non-Bible slugs", () => {
    expect(bibleShortRef("palama/triady/0001", "ru", 1, 1, 1)).toBeNull();
  });
});

describe("workSlugFromCitation", () => {
  it("extracts the work slug from a canonical citation", () => {
    expect(
      workSlugFromCitation(
        "svjashhennoe_pisanie/bible_evangelie_ot_matfeja/0001/p2",
      ),
    ).toBe("bible_evangelie_ot_matfeja");
  });

  it("works for patristic slugs", () => {
    expect(
      workSlugFromCitation("palama_grigorij/triady/0003/p11"),
    ).toBe("triady");
  });

  it("returns null for malformed citations", () => {
    expect(workSlugFromCitation("bad/citation")).toBeNull();
    expect(workSlugFromCitation("")).toBeNull();
  });
});

describe("BIBLE_BOOKS coverage", () => {
  it("includes 77 entries (full DB snapshot)", () => {
    expect(Object.keys(BIBLE_BOOKS).length).toBe(77);
  });
});
