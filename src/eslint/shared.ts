import { analyze, type Diagnostic } from "../core/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuleContext = any;

/** Both rules ("certain" -> error, "likely" -> warning) analyze the same file; caching by the
 *  shared SourceCode instance means a single ESLint run only parses/analyzes each file once. */
const cache = new WeakMap<object, Diagnostic[]>();

export function getDiagnostics(context: RuleContext): Diagnostic[] {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  const cached = cache.get(sourceCode);
  if (cached) return cached;

  const text = sourceCode.getText();
  const filename = context.filename ?? context.getFilename();
  let diagnostics: Diagnostic[] = [];
  try {
    ({ diagnostics } = analyze(text, filename));
  } catch {
    // Our internal parser only understands plain ES2022 — TSX, decorators, and other syntax
    // it can't handle are routine, not exceptional, so this stays silent rather than logging
    // on every non-plain-JS file in the project (see design doc: unknown -> stay silent).
  }
  cache.set(sourceCode, diagnostics);
  return diagnostics;
}

export function formatMessage(d: Diagnostic): string {
  const related = d.relatedSpans
    .map((r) => ` (${r.label} @ ${r.span.line}:${r.span.column + 1})`)
    .join("");
  const fixes = d.fixes.length
    ? " — " + d.fixes.map((f) => f.title).join(" / ")
    : "";
  return `${d.message}${related}${fixes}`;
}
