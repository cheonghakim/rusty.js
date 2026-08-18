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
  const { diagnostics } = analyze(text, filename);
  cache.set(sourceCode, diagnostics);
  return diagnostics;
}

export function formatMessage(d: Diagnostic): string {
  const related = d.relatedSpans.map((r) => ` (${r.label} @ ${r.span.line}:${r.span.column + 1})`).join("");
  const fixes = d.fixes.length ? " — " + d.fixes.map((f) => f.title).join(" / ") : "";
  return `${d.message}${related}${fixes}`;
}
