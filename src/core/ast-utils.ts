import * as evk from "eslint-visitor-keys";
import type { SourceSpan } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNode = any;

const NON_KEY_FIELDS = new Set(["type", "loc", "range", "parent", "start", "end"]);

export function getVisitorKeys(node: AnyNode): string[] {
  return (evk as AnyNode).KEYS[node.type] ?? Object.keys(node).filter((k) => !NON_KEY_FIELDS.has(k));
}

/** Mutates every node in the tree to carry a `.parent` pointer, mirroring what a real
 *  traversal library gives you for free — needed to determine write-position / call-argument
 *  context without threading parent references through every recursive call. */
export function attachParents(root: AnyNode): void {
  const visit = (node: AnyNode, parent: AnyNode | null) => {
    if (!node || typeof node.type !== "string") return;
    node.parent = parent;
    for (const key of getVisitorKeys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child, node);
      } else if (value && typeof value.type === "string") {
        visit(value, node);
      }
    }
  };
  visit(root, null);
}

export function toSpan(node: AnyNode): SourceSpan {
  return {
    start: node.range[0],
    end: node.range[1],
    line: node.loc.start.line,
    column: node.loc.start.column,
  };
}

/** Walks a MemberExpression chain (`a.b.c`, `a[0].c`) down to its root Identifier.
 *  Rusty tracks ownership per root object — `r.profile.name = x` is treated as a write
 *  to whatever `r` refers to, which is enough to catch the required nested-mutation cases
 *  without a full path-sensitive alias graph (deferred — see design doc §5/§15). */
export function getRootIdentifierFromExpr(node: AnyNode): AnyNode | null {
  let current = node;
  while (current) {
    if (current.type === "Identifier") return current;
    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }
    return null;
  }
  return null;
}

export function isWritePosition(memberExpr: AnyNode): boolean {
  const parent = memberExpr.parent;
  if (!parent) return false;
  if (parent.type === "AssignmentExpression" && parent.left === memberExpr) return true;
  if (parent.type === "UpdateExpression" && parent.argument === memberExpr) return true;
  if (parent.type === "UnaryExpression" && parent.operator === "delete" && parent.argument === memberExpr) {
    return true;
  }
  return false;
}

/** True when a `ref/mut/move/clone` call's result is stored into a binding
 *  (`const r = ref(x)` / `r = ref(x)`) rather than used inline (`send(ref(x))`). */
export function isBoundToVariable(callExpr: AnyNode): boolean {
  const parent = callExpr.parent;
  if (!parent) return false;
  if (parent.type === "VariableDeclarator" && parent.init === callExpr) return true;
  if (parent.type === "AssignmentExpression" && parent.operator === "=" && parent.right === callExpr) return true;
  return false;
}

const WRAPPER_NAMES = new Set(["ref", "mut", "move", "clone"]);

export function isWrapperCall(node: AnyNode): boolean {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    WRAPPER_NAMES.has(node.callee.name) &&
    node.arguments.length >= 1
  );
}

/** True when `idNode` is the direct `x` in `ref(x)/mut(x)/move(x)/clone(x)` — such reads are
 *  handled by the wrapper-call logic itself and must be excluded from last-use (NLL) tracking,
 *  otherwise a borrow would look "already consumed" the moment it's created. */
export function isWrapperArgument(idNode: AnyNode): boolean {
  const parent = idNode.parent;
  return !!(
    parent &&
    parent.type === "CallExpression" &&
    parent.callee.type === "Identifier" &&
    WRAPPER_NAMES.has(parent.callee.name) &&
    parent.arguments[0] === idNode
  );
}

export const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);
