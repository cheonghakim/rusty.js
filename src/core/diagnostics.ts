import type { AnyNode } from "./ast-utils.js";
import { toSpan } from "./ast-utils.js";
import type { Diagnostic, DiagnosticCode, OwnershipState } from "./types.js";

export interface DiagnosticSink {
  diagnostics: Diagnostic[];
  reportEnabled: boolean;
}

/** Korean particle selector based on final consonant.
 * Detects Korean Hangul; for non-Korean text returns empty string (no particle).
 * 받침이 있으면: 이, 은, 을, 과
 * 받침이 없으면: 가, 는, 를, 와
 */
export function koreanParticle(
  word: string,
  type: "subject" | "object" | "topic" | "and",
): string {
  if (!word) return "";
  const lastChar = word[word.length - 1];
  const code = lastChar.charCodeAt(0);
  // Korean character range: 0xAC00-0xD7A3
  if (code >= 0xac00 && code <= 0xd7a3) {
    const offset = code - 0xac00;
    const hasJongseong = offset % 28 !== 0;
    switch (type) {
      case "subject":
        return hasJongseong ? "이" : "가";
      case "topic":
        return hasJongseong ? "은" : "는";
      case "object":
        return hasJongseong ? "을" : "를";
      case "and":
        return hasJongseong ? "과" : "와";
    }
  }
  // Non-Korean text (e.g., English identifiers): no particle
  return "";
}

function lastBorrowSpan(state: OwnershipState) {
  if (state.kind === "BorrowedWrite") return state.borrow.span;
  if (state.kind === "BorrowedRead")
    return state.borrows[state.borrows.length - 1].span;
  return undefined;
}

/** Builds and records a Diagnostic. `subjectNode` is the identifier whose name should be
 *  quoted in the message; `relatedState` is the prior ownership state that makes the current
 *  access invalid, used to point at *where* the conflicting borrow/move began. */
export function report(
  sink: DiagnosticSink,
  code: DiagnosticCode,
  node: AnyNode,
  relatedState: OwnershipState,
  subjectNode: AnyNode | null,
): void {
  if (!sink.reportEnabled) return;

  const name = subjectNode?.name ?? "value";
  const primarySpan = toSpan(node);
  const relatedSpans: Diagnostic["relatedSpans"] = [];
  let message = "";
  let severity: Diagnostic["severity"] = "error";
  const fixes: Diagnostic["fixes"] = [];

  switch (code) {
    case "rusty/use-after-move":
    case "rusty/maybe-use-after-move": {
      if (relatedState.kind === "Moved") {
        const particleGa = koreanParticle(name, "subject");
        relatedSpans.push({
          span: relatedState.movedAt,
          label: `\`${name}\`${particleGa} 이동된 지점`,
        });
      }
      const conditional = code === "rusty/maybe-use-after-move";
      severity = conditional ? "warning" : "error";
      const particleEun = koreanParticle(name, "topic");
      message = conditional
        ? `\`${name}\`${particleEun} 조건부 경로에서 이동되었을 수 있습니다. 모든 실행 경로가 안전한지 확인하세요.`
        : `\`${name}\`${particleEun} 이미 이동되어 더 이상 사용할 수 없습니다.`;
      fixes.push(
        { title: `읽기만 한다면: ref(${name})로 전달하세요` },
        { title: `일시적으로 수정한다면: mut(${name})로 전달하세요` },
        {
          title: `소유권이 꼭 필요하다면: move(clone(${name}))으로 전달하세요`,
        },
      );
      break;
    }
    case "rusty/double-mut-borrow": {
      const span = lastBorrowSpan(relatedState);
      if (span) relatedSpans.push({ span, label: `기존 mut 빌림 시작 지점` });
      const particleEun = koreanParticle(name, "topic");
      message = `\`${name}\`${particleEun} 이미 mut 상태로 빌려진 상태입니다. 동시에 두 개의 mut 빌림을 가질 수 없습니다.`;
      break;
    }
    case "rusty/mut-while-ref": {
      const span = lastBorrowSpan(relatedState);
      if (span) relatedSpans.push({ span, label: `활성 ref 빌림 시작 지점` });
      const particleEul = koreanParticle(name, "object");
      message = `ref 빌림이 활성 상태인 동안 \`${name}\`${particleEul} mut로 빌릴 수 없습니다.`;
      break;
    }
    case "rusty/ref-while-mut": {
      const span = lastBorrowSpan(relatedState);
      if (span) relatedSpans.push({ span, label: `활성 mut 빌림 시작 지점` });
      const particleEul = koreanParticle(name, "object");
      message = `mut 빌림이 활성 상태인 동안 \`${name}\`${particleEul} 다시 빌릴 수 없습니다.`;
      break;
    }
    case "rusty/move-while-borrowed": {
      const span = lastBorrowSpan(relatedState);
      if (span) relatedSpans.push({ span, label: `활성 빌림 시작 지점` });
      const particleGa = koreanParticle(name, "subject");
      message = `\`${name}\`${particleGa} 빌려진 상태에서 이동할 수 없습니다.`;
      break;
    }
    case "rusty/mutation-through-ref": {
      const span = lastBorrowSpan(relatedState);
      const particleEul = koreanParticle(name, "object");
      if (span)
        relatedSpans.push({
          span,
          label: `\`${name}\`${particleEul} ref()로 빌린 지점`,
        });
      const particleEun = koreanParticle(name, "topic");
      message = `\`${name}\`${particleEun} 현재 읽기 전용으로 빌려진 상태라 수정할 수 없습니다.`;
      break;
    }
  }

  sink.diagnostics.push({
    code,
    severity,
    message,
    primarySpan,
    relatedSpans,
    fixes,
    confidence: code === "rusty/maybe-use-after-move" ? "likely" : "certain",
  });
}
