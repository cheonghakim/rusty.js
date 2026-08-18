import { attachParents } from "./ast-utils.js";
import { resolveAliases } from "./aliasing.js";
import { runAnalysis } from "./analyzer.js";
import { buildIdentifierVariableMap, parseAndAnalyzeScope } from "./scope.js";
import type { AnalyzeResult } from "./types.js";

export * from "./types.js";

/**
 * Analyzes a single JavaScript source file for ownership/borrow violations.
 *
 * Pipeline: parse (espree) -> scope analysis (eslint-scope) -> static alias resolution
 * -> flow-sensitive ownership tracking -> diagnostics. See the Rusty architecture doc, §17.
 */
export function analyze(sourceText: string, _filePath = "input.js"): AnalyzeResult {
  const { ast, scopeManager } = parseAndAnalyzeScope(sourceText);
  attachParents(ast);

  const identifierToVariable = buildIdentifierVariableMap(scopeManager);
  const { variableToOwnerId, lastReadPosition } = resolveAliases(ast, identifierToVariable);

  return runAnalysis(ast, scopeManager, identifierToVariable, variableToOwnerId, lastReadPosition);
}
