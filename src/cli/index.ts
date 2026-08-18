import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { analyze, type Diagnostic } from "../core/index.js";

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git"]);

/** No glob dependency for the MVP — a plain recursive walk covers "check this file / this
 *  directory / the whole project" (the only three ways people actually invoke a linter). */
export function collectFiles(paths: string[]): string[] {
  const roots = paths.length > 0 ? paths : ["."];
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  return files;
}

function walk(path: string, files: string[]): void {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) {
    process.stderr.write(`rusty: path not found: ${path}\n`);
    return;
  }
  if (stat.isDirectory()) {
    const base = path.split(/[\\/]/).pop() ?? "";
    if (IGNORED_DIRS.has(base)) return;
    for (const entry of readdirSync(path)) walk(join(path, entry), files);
    return;
  }
  if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(path))) {
    files.push(path);
  }
}

function formatDiagnostic(displayPath: string, d: Diagnostic): string {
  const loc = `${displayPath}:${d.primarySpan.line}:${d.primarySpan.column + 1}`;
  const lines = [`${loc}  ${d.severity}  ${d.code}`, `  ${d.message}`];
  for (const r of d.relatedSpans) {
    lines.push(`    ↳ ${r.label} (${displayPath}:${r.span.line}:${r.span.column + 1})`);
  }
  for (const f of d.fixes) {
    lines.push(`    fix: ${f.title}`);
  }
  return lines.join("\n");
}

export interface CheckResult {
  filesChecked: number;
  errorCount: number;
  warningCount: number;
  output: string;
}

export function runCheck(paths: string[]): CheckResult {
  const files = collectFiles(paths);
  let errorCount = 0;
  let warningCount = 0;
  const blocks: string[] = [];

  for (const file of files) {
    const displayPath = relative(process.cwd(), file) || file;
    const text = readFileSync(file, "utf8");

    let diagnostics: Diagnostic[];
    try {
      ({ diagnostics } = analyze(text, file));
    } catch (err) {
      blocks.push(`${displayPath}\n  parse error: ${(err as Error).message}`);
      continue;
    }

    for (const d of diagnostics) {
      if (d.severity === "error") errorCount++;
      else warningCount++;
      blocks.push(formatDiagnostic(displayPath, d));
    }
  }

  const summary =
    errorCount === 0 && warningCount === 0
      ? `rusty: checked ${files.length} file(s), no issues found`
      : `rusty: checked ${files.length} file(s) — ${errorCount} error(s), ${warningCount} warning(s)`;

  return {
    filesChecked: files.length,
    errorCount,
    warningCount,
    output: [...blocks, summary].join("\n\n"),
  };
}

/** Returns the process exit code (0 = clean, 1 = errors found or bad usage). */
export function main(command: string | undefined, args: string[]): number {
  if (command !== "check") {
    process.stderr.write("usage: rusty check [files or directories...]\n");
    return 1;
  }
  const result = runCheck(args);
  process.stdout.write(result.output + "\n");
  return result.errorCount > 0 ? 1 : 0;
}
