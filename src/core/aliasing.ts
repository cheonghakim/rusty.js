import type eslintScope from "eslint-scope";
import { getVisitorKeys, isWrapperArgument, type AnyNode } from "./ast-utils.js";
import type { OwnerId } from "./types.js";

export interface AliasInfo {
  variableToOwnerId: Map<eslintScope.Variable, OwnerId>;
  lastReadPosition: Map<OwnerId, number>;
}

/** Static (control-flow independent) pass: decides which variables share an owner id.
 *
 *  `const a = b`            -> a aliases b's owner (plain JS aliasing, always allowed)
 *  `const a = ref(b)/mut(b)` -> a aliases b's owner (a is just a borrow handle onto it)
 *  `const a = move(b)`      -> a gets a *fresh* owner (b is left in the Moved state)
 *  `const a = clone(b)`     -> a gets a *fresh*, independent owner
 *  anything else            -> a gets a fresh owner (new object/array/literal identity)
 */
export function resolveAliases(
  root: AnyNode,
  identifierToVariable: WeakMap<AnyNode, eslintScope.Variable>,
): AliasInfo {
  const variableToOwnerId = new Map<eslintScope.Variable, OwnerId>();

  const getOrCreate = (variable: eslintScope.Variable): OwnerId => {
    let id = variableToOwnerId.get(variable);
    if (!id) {
      id = Symbol(variable.name);
      variableToOwnerId.set(variable, id);
    }
    return id;
  };

  const applyAlias = (targetVar: eslintScope.Variable, initNode: AnyNode) => {
    if (initNode.type === "Identifier") {
      const srcVar = identifierToVariable.get(initNode);
      if (srcVar) {
        variableToOwnerId.set(targetVar, getOrCreate(srcVar));
        return;
      }
    }
    if (initNode.type === "CallExpression" && initNode.callee.type === "Identifier") {
      const fnName = initNode.callee.name;
      const arg0 = initNode.arguments[0];
      if ((fnName === "ref" || fnName === "mut") && arg0?.type === "Identifier") {
        const srcVar = identifierToVariable.get(arg0);
        if (srcVar) {
          variableToOwnerId.set(targetVar, getOrCreate(srcVar));
          return;
        }
      }
      if (fnName === "move" && arg0?.type === "Identifier") {
        const srcVar = identifierToVariable.get(arg0);
        if (srcVar) getOrCreate(srcVar); // ensure the moved-from owner still exists
        variableToOwnerId.set(targetVar, Symbol(targetVar.name));
        return;
      }
      if (fnName === "clone") {
        variableToOwnerId.set(targetVar, Symbol(targetVar.name));
        return;
      }
    }
    // default: a fresh, independent identity (object/array literal, `new X()`, unknown call, ...)
    variableToOwnerId.set(targetVar, Symbol(targetVar.name));
  };

  const visit = (node: AnyNode) => {
    if (!node || typeof node.type !== "string") return;

    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
      const targetVar = identifierToVariable.get(node.id);
      if (targetVar) applyAlias(targetVar, node.init);
    } else if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.left.type === "Identifier"
    ) {
      const targetVar = identifierToVariable.get(node.left);
      if (targetVar) applyAlias(targetVar, node.right);
    }

    for (const key of getVisitorKeys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (value && typeof value.type === "string") {
        visit(value);
      }
    }
  };
  visit(root);

  const lastReadPosition = computeLastReadPositions(variableToOwnerId);
  return { variableToOwnerId, lastReadPosition };
}

/** Non-lexical lifetime support: for every owner id, find the source position of the last
 *  *consuming* read across every binding that shares it. Reads that only exist to create a
 *  borrow (`ref(x)`'s `x`) are excluded — they open a borrow, they don't end one. */
function computeLastReadPositions(
  variableToOwnerId: Map<eslintScope.Variable, OwnerId>,
): Map<OwnerId, number> {
  const groups = new Map<OwnerId, eslintScope.Variable[]>();
  for (const [variable, ownerId] of variableToOwnerId) {
    const list = groups.get(ownerId);
    if (list) list.push(variable);
    else groups.set(ownerId, [variable]);
  }

  const result = new Map<OwnerId, number>();
  for (const [ownerId, variables] of groups) {
    let last: number | null = null;
    for (const variable of variables) {
      for (const ref of variable.references) {
        if (!ref.isRead()) continue;
        const idNode = ref.identifier as AnyNode;
        if (isWrapperArgument(idNode)) continue;
        const pos = idNode.range[1];
        if (last === null || pos > last) last = pos;
      }
    }
    if (last !== null) result.set(ownerId, last);
  }
  return result;
}
