import { describe, expect, it } from "vitest";
import { koreanParticle } from "../src/core/diagnostics.js";

describe("koreanParticle", () => {
  it("picks the with-batchim form for a Korean word ending in a consonant", () => {
    // "사용자" ends in 자 (no final consonant) -- use a word that *does* have 받침 instead.
    expect(koreanParticle("가방", "subject")).toBe("이"); // 가방 ends in 방 (ㅇ batchim)
    expect(koreanParticle("가방", "topic")).toBe("은");
    expect(koreanParticle("가방", "object")).toBe("을");
    expect(koreanParticle("가방", "and")).toBe("과");
  });

  it("picks the no-batchim form for a Korean word ending in a vowel", () => {
    expect(koreanParticle("사과", "subject")).toBe("가"); // 사과 ends in 과 (no batchim)
    expect(koreanParticle("사과", "topic")).toBe("는");
    expect(koreanParticle("사과", "object")).toBe("를");
    expect(koreanParticle("사과", "and")).toBe("와");
  });

  it("returns no particle for non-Hangul identifiers (the common case: JS variable names)", () => {
    for (const word of ["user", "cart", "r", "config123", "_private"]) {
      for (const type of ["subject", "topic", "object", "and"] as const) {
        expect(koreanParticle(word, type)).toBe("");
      }
    }
  });

  it("returns empty string for an empty word instead of throwing", () => {
    expect(koreanParticle("", "subject")).toBe("");
  });
});
