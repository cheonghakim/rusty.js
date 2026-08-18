import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import rustyPlugin from "../src/eslint/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");

function load(category: string, name: string): string {
  return readFileSync(join(FIXTURES, category, name), "utf8");
}

const linter = new Linter();

const config = [
  {
    languageOptions: { ecmaVersion: "latest" as const, sourceType: "module" as const },
    plugins: { rusty: rustyPlugin },
    rules: {
      "rusty/borrow-check": "error" as const,
      "rusty/maybe-borrow-check": "warn" as const,
    },
  },
];

describe("rusty.js/eslint against the shared fixture corpus", () => {
  for (const file of readdirSync(join(FIXTURES, "valid"))) {
    it(`valid/${file} -> no messages`, () => {
      const messages = linter.verify(load("valid", file), config);
      expect(messages).toEqual([]);
    });
  }

  for (const file of readdirSync(join(FIXTURES, "invalid"))) {
    it(`invalid/${file} -> one error via rusty/borrow-check`, () => {
      const messages = linter.verify(load("invalid", file), config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe("rusty/borrow-check");
      expect(messages[0].severity).toBe(2);
    });
  }

  for (const file of readdirSync(join(FIXTURES, "warnings"))) {
    it(`warnings/${file} -> one warning via rusty/maybe-borrow-check`, () => {
      const messages = linter.verify(load("warnings", file), config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe("rusty/maybe-borrow-check");
      expect(messages[0].severity).toBe(1);
    });
  }
});
