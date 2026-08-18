import type eslintScope from "eslint-scope";
import {
  getRootIdentifierFromExpr,
  getVisitorKeys,
  isBoundToVariable,
  isWritePosition,
  MUTATING_METHODS,
  toSpan,
  type AnyNode,
} from "./ast-utils.js";
import { report, type DiagnosticSink } from "./diagnostics.js";
import type { AnalyzeResult, OwnerId, OwnershipState } from "./types.js";

type StateMap = Map<OwnerId, OwnershipState>;

interface Ctx extends DiagnosticSink {
  scopeManager: eslintScope.ScopeManager;
  identifierToVariable: WeakMap<AnyNode, eslintScope.Variable>;
  variableToOwnerId: Map<eslintScope.Variable, OwnerId>;
  lastReadPosition: Map<OwnerId, number>;
  /** most recent block a *bound* borrow was declared in, for the block-exit release rule */
  declaringBlock: Map<OwnerId, AnyNode>;
}

export function runAnalysis(
  ast: AnyNode,
  scopeManager: eslintScope.ScopeManager,
  identifierToVariable: WeakMap<AnyNode, eslintScope.Variable>,
  variableToOwnerId: Map<eslintScope.Variable, OwnerId>,
  lastReadPosition: Map<OwnerId, number>,
): AnalyzeResult {
  const ctx: Ctx = {
    scopeManager,
    identifierToVariable,
    variableToOwnerId,
    lastReadPosition,
    declaringBlock: new Map(),
    diagnostics: [],
    reportEnabled: true,
  };

  analyzeBlock(ast.body, new Map(), ctx, ast);
  return { diagnostics: ctx.diagnostics };
}

function resolveOwnerId(idNode: AnyNode | null, ctx: Ctx): OwnerId | null {
  if (!idNode) return null;
  const variable = ctx.identifierToVariable.get(idNode);
  if (!variable) return null; // unresolved global — never tracked
  return ctx.variableToOwnerId.get(variable) ?? null;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function analyzeBlock(statements: AnyNode[], state: StateMap, ctx: Ctx, blockNode: AnyNode): void {
  for (const stmt of statements) {
    analyzeStatement(stmt, state, ctx, blockNode);
    revertTransientBorrows(state);
  }
  releaseBlockScopedBorrows(state, ctx, blockNode);
}

function releaseBlockScopedBorrows(state: StateMap, ctx: Ctx, blockNode: AnyNode): void {
  for (const [ownerId, s] of state) {
    if ((s.kind === "BorrowedRead" || s.kind === "BorrowedWrite") && ctx.declaringBlock.get(ownerId) === blockNode) {
      state.set(ownerId, { kind: "Owned" });
      ctx.declaringBlock.delete(ownerId);
    }
  }
}

/** Transient borrows (`update(mut(x))` — never bound to a variable) die at the end of the
 *  statement that created them, since nothing could possibly hold onto them any longer. */
function revertTransientBorrows(state: StateMap): void {
  for (const [ownerId, s] of state) {
    if (s.kind === "BorrowedRead") {
      const remaining = s.borrows.filter((b) => !b.transient);
      if (remaining.length === 0) state.set(ownerId, { kind: "Owned" });
      else if (remaining.length !== s.borrows.length) state.set(ownerId, { kind: "BorrowedRead", borrows: remaining });
    } else if (s.kind === "BorrowedWrite" && s.borrow.transient) {
      state.set(ownerId, { kind: "Owned" });
    }
  }
}

function analyzeBlockOrStatement(node: AnyNode, state: StateMap, ctx: Ctx): void {
  if (node.type === "BlockStatement") {
    analyzeBlock(node.body, state, ctx, node);
  } else {
    analyzeBlock([node], state, ctx, node);
  }
}

function analyzeStatement(node: AnyNode, state: StateMap, ctx: Ctx, blockNode: AnyNode): void {
  switch (node.type) {
    case "VariableDeclaration":
      for (const decl of node.declarations) {
        if (decl.init) walkExpression(decl.init, state, ctx, blockNode);
      }
      return;

    case "ExpressionStatement":
      walkExpression(node.expression, state, ctx, blockNode);
      return;

    case "BlockStatement":
      analyzeBlock(node.body, state, ctx, node);
      return;

    case "IfStatement": {
      walkExpression(node.test, state, ctx, blockNode);
      const preState = new Map(state);

      const consequentState = new Map(preState);
      analyzeBlockOrStatement(node.consequent, consequentState, ctx);

      let alternateState: StateMap;
      if (node.alternate) {
        alternateState = new Map(preState);
        analyzeBlockOrStatement(node.alternate, alternateState, ctx);
      } else {
        alternateState = preState;
      }

      const merged = mergeStateMaps(consequentState, alternateState);
      state.clear();
      for (const [k, v] of merged) state.set(k, v);
      return;
    }

    case "WhileStatement":
    case "DoWhileStatement": {
      walkExpression(node.test, state, ctx, blockNode);
      runLoopFixedPoint(node.body, state, ctx);
      return;
    }

    case "ForStatement": {
      if (node.init) {
        if (node.init.type === "VariableDeclaration") analyzeStatement(node.init, state, ctx, blockNode);
        else walkExpression(node.init, state, ctx, blockNode);
      }
      if (node.test) walkExpression(node.test, state, ctx, blockNode);
      runLoopFixedPoint(node.body, state, ctx, node.update);
      return;
    }

    case "ForOfStatement":
    case "ForInStatement": {
      walkExpression(node.right, state, ctx, blockNode);
      runLoopFixedPoint(node.body, state, ctx);
      return;
    }

    case "ReturnStatement": {
      if (node.argument) {
        walkExpression(node.argument, state, ctx, blockNode);
        const root = getRootIdentifierFromExpr(node.argument);
        const ownerId = resolveOwnerId(root, ctx);
        if (ownerId) state.set(ownerId, { kind: "Escaped", reason: "returned", at: toSpan(node) });
      }
      return;
    }

    case "FunctionDeclaration": {
      // Independent, top-level-style analysis: no interprocedural contract propagation in the MVP.
      analyzeBlock(node.body.body, new Map(), ctx, node.body);
      return;
    }

    default:
      genericStatementFallback(node, state, ctx, blockNode);
  }
}

function genericStatementFallback(node: AnyNode, state: StateMap, ctx: Ctx, blockNode: AnyNode): void {
  for (const key of getVisitorKeys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") walkExpression(child, state, ctx, blockNode);
      }
    } else if (value && typeof value.type === "string") {
      walkExpression(value, state, ctx, blockNode);
    }
  }
}

function runLoopFixedPoint(bodyNode: AnyNode, state: StateMap, ctx: Ctx, updateExpr?: AnyNode): void {
  const pre = new Map(state);

  const pass1 = new Map(pre);
  analyzeBlockOrStatement(bodyNode, pass1, ctx);
  if (updateExpr) walkExpression(updateExpr, pass1, ctx, bodyNode);

  const entry2 = mergeStateMaps(pre, pass1);
  const pass2 = new Map(entry2);

  ctx.reportEnabled = false;
  analyzeBlockOrStatement(bodyNode, pass2, ctx);
  if (updateExpr) walkExpression(updateExpr, pass2, ctx, bodyNode);
  ctx.reportEnabled = true;

  const exit = mergeStateMaps(pre, pass2);
  state.clear();
  for (const [k, v] of exit) state.set(k, v);
}

// ---------------------------------------------------------------------------
// State merge (pessimistic join at branch/loop boundaries)
// ---------------------------------------------------------------------------

const OWNED: OwnershipState = { kind: "Owned" };

function mergeStateMaps(a: StateMap, b: StateMap): StateMap {
  const result: StateMap = new Map();
  const keys = new Set<OwnerId>([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    // A key absent from one branch means that branch never touched the owner — implicitly
    // Owned there, *not* "carry the other branch's state through unmerged". Skipping this
    // default was the difference between reporting a confirmed vs. a conditional violation.
    const av = a.get(k) ?? OWNED;
    const bv = b.get(k) ?? OWNED;
    result.set(k, mergeOwnershipState(av, bv));
  }
  return result;
}

function mergeOwnershipState(a: OwnershipState, b: OwnershipState): OwnershipState {
  const aMoved = a.kind === "Moved";
  const bMoved = b.kind === "Moved";
  if (aMoved || bMoved) {
    const bothMoved = aMoved && bMoved;
    const conditional = !bothMoved || Boolean((aMoved && a.conditional) || (bMoved && b.conditional));
    const site = aMoved ? (a as Extract<OwnershipState, { kind: "Moved" }>).movedAt : (b as Extract<OwnershipState, { kind: "Moved" }>).movedAt;
    return { kind: "Moved", movedAt: site, conditional };
  }
  if (a.kind === "Owned") return b;
  if (b.kind === "Owned") return a;
  // both borrowed/escaped in some form — keep the first, conservative MVP simplification
  return a;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

function walkExpression(node: AnyNode, state: StateMap, ctx: Ctx, blockNode: AnyNode): void {
  if (!node) return;

  switch (node.type) {
    case "Identifier":
      handleGenericRead(node, state, ctx);
      return;

    case "CallExpression": {
      const callee = node.callee;

      if (
        callee.type === "Identifier" &&
        (callee.name === "ref" || callee.name === "mut" || callee.name === "move" || callee.name === "clone") &&
        node.arguments[0]?.type === "Identifier"
      ) {
        handleWrapperCall(node, state, ctx, blockNode);
        return;
      }

      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier" &&
        MUTATING_METHODS.has(callee.property.name)
      ) {
        const root = getRootIdentifierFromExpr(callee.object);
        const ownerId = resolveOwnerId(root, ctx);
        if (ownerId) checkWriteConflict(ownerId, node, state, ctx, root);
      }

      walkExpression(callee, state, ctx, blockNode);
      for (const arg of node.arguments) walkExpression(arg, state, ctx, blockNode);
      return;
    }

    case "MemberExpression": {
      const write = isWritePosition(node);
      const root = getRootIdentifierFromExpr(node);
      const ownerId = resolveOwnerId(root, ctx);
      if (ownerId) {
        if (write) checkWriteConflict(ownerId, node, state, ctx, root);
        else handleGenericReadByOwner(ownerId, root, state, ctx);
      } else if (!root) {
        walkExpression(node.object, state, ctx, blockNode);
      }
      if (node.computed) walkExpression(node.property, state, ctx, blockNode);
      return;
    }

    case "AssignmentExpression":
      walkExpression(node.left, state, ctx, blockNode);
      walkExpression(node.right, state, ctx, blockNode);
      return;

    case "UpdateExpression": {
      const root = getRootIdentifierFromExpr(node.argument);
      const ownerId = resolveOwnerId(root, ctx);
      if (ownerId) checkWriteConflict(ownerId, node, state, ctx, root);
      else walkExpression(node.argument, state, ctx, blockNode);
      return;
    }

    case "UnaryExpression": {
      if (node.operator === "delete") {
        const root = getRootIdentifierFromExpr(node.argument);
        const ownerId = resolveOwnerId(root, ctx);
        if (ownerId) checkWriteConflict(ownerId, node, state, ctx, root);
        else walkExpression(node.argument, state, ctx, blockNode);
        return;
      }
      walkExpression(node.argument, state, ctx, blockNode);
      return;
    }

    case "ArrowFunctionExpression":
    case "FunctionExpression":
      handleClosureCapture(node, state, ctx);
      return; // MVP: closures are not analyzed internally, only checked for escape (§5/§15)

    default:
      genericStatementFallback(node, state, ctx, blockNode);
  }
}

function handleGenericRead(idNode: AnyNode, state: StateMap, ctx: Ctx): void {
  const ownerId = resolveOwnerId(idNode, ctx);
  if (ownerId) handleGenericReadByOwner(ownerId, idNode, state, ctx);
}

function handleGenericReadByOwner(ownerId: OwnerId, idNode: AnyNode, state: StateMap, ctx: Ctx): void {
  const current = state.get(ownerId);
  if (!current) return;

  if (current.kind === "Moved") {
    report(ctx, current.conditional ? "rusty/maybe-use-after-move" : "rusty/use-after-move", idNode, current, idNode);
    return;
  }

  if (current.kind === "BorrowedRead" || current.kind === "BorrowedWrite") {
    if (ctx.lastReadPosition.get(ownerId) === idNode.range[1]) {
      state.set(ownerId, { kind: "Owned" });
    }
  }
}

function checkWriteConflict(ownerId: OwnerId, node: AnyNode, state: StateMap, ctx: Ctx, subjectNode: AnyNode | null): void {
  const current = state.get(ownerId);
  if (!current) return;

  if (current.kind === "Moved") {
    report(ctx, current.conditional ? "rusty/maybe-use-after-move" : "rusty/use-after-move", node, current, subjectNode);
    return;
  }
  if (current.kind === "BorrowedRead") {
    report(ctx, "rusty/mutation-through-ref", node, current, subjectNode);
    return;
  }
  if (current.kind === "BorrowedWrite") {
    // A mutable borrow already holds exclusive access — writing through the original binding
    // (or any other alias) while it's active is the same conflict as a second mut(), just
    // reached via direct field access instead of another wrapper call.
    report(ctx, "rusty/double-mut-borrow", node, current, subjectNode);
  }
}

function handleWrapperCall(node: AnyNode, state: StateMap, ctx: Ctx, blockNode: AnyNode): void {
  const kind = node.callee.name as "ref" | "mut" | "move" | "clone";
  const argNode = node.arguments[0];
  const ownerId = resolveOwnerId(argNode, ctx);
  if (!ownerId) return; // untracked value — Rusty stays silent rather than guessing

  const current = state.get(ownerId) ?? { kind: "Owned" as const };
  const bound = isBoundToVariable(node);
  const span = toSpan(node);

  switch (kind) {
    case "move": {
      if (current.kind === "BorrowedRead" || current.kind === "BorrowedWrite") {
        report(ctx, "rusty/move-while-borrowed", node, current, argNode);
      } else if (current.kind === "Moved") {
        report(ctx, current.conditional ? "rusty/maybe-use-after-move" : "rusty/use-after-move", node, current, argNode);
      }
      state.set(ownerId, { kind: "Moved", movedAt: span });
      break;
    }
    case "mut": {
      if (current.kind === "Moved") {
        report(ctx, current.conditional ? "rusty/maybe-use-after-move" : "rusty/use-after-move", node, current, argNode);
      } else if (current.kind === "BorrowedRead") {
        report(ctx, "rusty/mut-while-ref", node, current, argNode);
      } else if (current.kind === "BorrowedWrite") {
        report(ctx, "rusty/double-mut-borrow", node, current, argNode);
      }
      state.set(ownerId, { kind: "BorrowedWrite", borrow: { span, kind: "mut", transient: !bound } });
      if (bound) ctx.declaringBlock.set(ownerId, blockNode);
      break;
    }
    case "ref": {
      if (current.kind === "Moved") {
        report(ctx, current.conditional ? "rusty/maybe-use-after-move" : "rusty/use-after-move", node, current, argNode);
      } else if (current.kind === "BorrowedWrite") {
        report(ctx, "rusty/ref-while-mut", node, current, argNode);
      }
      const borrows = current.kind === "BorrowedRead" ? current.borrows : [];
      state.set(ownerId, { kind: "BorrowedRead", borrows: [...borrows, { span, kind: "ref", transient: !bound }] });
      if (bound) ctx.declaringBlock.set(ownerId, blockNode);
      break;
    }
    case "clone":
      // clone() produces an independent owner at the destination binding (see aliasing.ts);
      // it has no effect on the source owner's flow state.
      break;
  }
}

function handleClosureCapture(fnNode: AnyNode, state: StateMap, ctx: Ctx): void {
  const scope = ctx.scopeManager.acquire(fnNode as never);
  if (!scope) return;

  const seen = new Set<OwnerId>();
  for (const ref of scope.through) {
    const variable = ref.resolved;
    if (!variable) continue;
    const ownerId = ctx.variableToOwnerId.get(variable);
    if (!ownerId || seen.has(ownerId)) continue;
    seen.add(ownerId);

    const current = state.get(ownerId);
    if (current && (current.kind === "BorrowedRead" || current.kind === "BorrowedWrite")) {
      // A deferred closure might outlive the current borrow's lifetime — conservatively treat
      // the owner as having escaped. Recommended profile stays silent here (see design doc §5/§8);
      // this only prevents *false* conflict reports on the remaining local flow.
      state.set(ownerId, { kind: "Escaped", reason: "closure-capture", at: toSpan(fnNode) });
    }
  }
}
