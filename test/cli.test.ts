import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectFiles, main, runCheck } from "../src/cli/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");

describe("collectFiles", () => {
  it("walks a directory and only picks up .js files", () => {
    const files = collectFiles([join(FIXTURES, "valid")]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".js"))).toBe(true);
  });

  it("reports a path that doesn't exist without throwing", () => {
    expect(() => collectFiles([join(FIXTURES, "does-not-exist")])).not.toThrow();
  });
});

describe("runCheck", () => {
  it("finds zero issues across the valid fixture directory", () => {
    const result = runCheck([join(FIXTURES, "valid")]);
    expect(result.filesChecked).toBeGreaterThan(0);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.output).toContain("no issues found");
  });

  it("finds exactly one error per file across the invalid fixture directory", () => {
    const result = runCheck([join(FIXTURES, "invalid")]);
    expect(result.errorCount).toBe(result.filesChecked);
    expect(result.warningCount).toBe(0);
  });

  it("finds exactly one warning per file across the warnings fixture directory", () => {
    const result = runCheck([join(FIXTURES, "warnings")]);
    expect(result.warningCount).toBe(result.filesChecked);
    expect(result.errorCount).toBe(0);
  });
});

describe("main (CLI exit code semantics)", () => {
  it("exits 1 on unknown/missing subcommand", () => {
    expect(main(undefined, [])).toBe(1);
    expect(main("lint", [])).toBe(1);
  });

  it("exits 0 for a clean directory, 1 when errors are present", () => {
    expect(main("check", [join(FIXTURES, "valid")])).toBe(0);
    expect(main("check", [join(FIXTURES, "invalid")])).toBe(1);
  });

  it("exits 0 for warnings alone (they don't fail CI by default)", () => {
    expect(main("check", [join(FIXTURES, "warnings")])).toBe(0);
  });
});
