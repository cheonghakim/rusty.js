import * as espree from "espree";
import * as eslintScope from "eslint-scope";
import type { AnyNode } from "./ast-utils.js";

export function parseAndAnalyzeScope(sourceText: string): {
  ast: AnyNode;
  scopeManager: eslintScope.ScopeManager;
} {
  const ast = espree.parse(sourceText, {
    ecmaVersion: 2022,
    sourceType: "module",
    range: true,
    loc: true,
  }) as AnyNode;

  const scopeManager = eslintScope.analyze(ast, {
    ecmaVersion: 2022,
    sourceType: "module",
    optimistic: false,
    ignoreEval: true,
  });

  return { ast, scopeManager };
}

/** Maps every Identifier node — both reference sites and declaration sites — to the
 *  eslint-scope Variable it resolves to. Unresolved globals (console, Object, ...) are
 *  simply absent, which is exactly what makes them fall through to "not tracked". */
export function buildIdentifierVariableMap(
  scopeManager: eslintScope.ScopeManager,
): WeakMap<AnyNode, eslintScope.Variable> {
  const map = new WeakMap<AnyNode, eslintScope.Variable>();

  for (const scope of scopeManager.scopes) {
    for (const ref of scope.references) {
      if (ref.resolved) {
        map.set(ref.identifier as AnyNode, ref.resolved);
      }
    }
    for (const variable of scope.variables) {
      for (const def of variable.defs) {
        if (def.name) {
          map.set(def.name as AnyNode, variable);
        }
      }
    }
  }

  return map;
}
