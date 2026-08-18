import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../src/core/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");

function load(category: string, name: string): string {
  return readFileSync(join(FIXTURES, category, name), "utf8");
}

describe("valid fixtures produce no diagnostics", () => {
  for (const file of readdirSync(join(FIXTURES, "valid"))) {
    it(file, () => {
      const result = analyze(load("valid", file), file);
      expect(result.diagnostics).toEqual([]);
    });
  }
});

const invalidExpectations: Record<string, string> = {
  "use_after_move.js": "rusty/use-after-move",
  "double_mut_borrow.js": "rusty/double-mut-borrow",
  "mut_while_ref.js": "rusty/mut-while-ref",
  "ref_while_mut.js": "rusty/ref-while-mut",
  "move_while_borrowed.js": "rusty/move-while-borrowed",
  "mutation_through_ref.js": "rusty/mutation-through-ref",
  "mutation_through_ref_nested.js": "rusty/mutation-through-ref",
};

describe("invalid fixtures produce exactly the expected error diagnostic", () => {
  for (const [file, code] of Object.entries(invalidExpectations)) {
    it(file, () => {
      const result = analyze(load("invalid", file), file);
      expect(result.diagnostics.map((d) => d.code)).toEqual([code]);
      expect(result.diagnostics[0].severity).toBe("error");
      expect(result.diagnostics[0].confidence).toBe("certain");
      expect(result.diagnostics[0].relatedSpans.length).toBeGreaterThan(0);
    });
  }
});

describe("warning fixtures produce a conditional diagnostic", () => {
  it("maybe_use_after_move.js", () => {
    const result = analyze(load("warnings", "maybe_use_after_move.js"), "maybe_use_after_move.js");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["rusty/maybe-use-after-move"]);
    expect(result.diagnostics[0].severity).toBe("warning");
    expect(result.diagnostics[0].confidence).toBe("likely");
  });
});

it("prints a formatted diagnostic, matching the design doc's UX example", () => {
  const result = analyze(load("invalid", "use_after_move.js"), "use_after_move.js");
  const d = result.diagnostics[0];
  const lines = [
    `${d.code}`,
    "",
    d.message,
    "",
    "Possible fixes:",
    ...d.fixes.map((f, i) => `  ${i + 1}. ${f.title}`),
  ].join("\n");
  // eslint-disable-next-line no-console
  console.log("\n" + lines + "\n");
  expect(lines).toContain("rusty/use-after-move");
});
