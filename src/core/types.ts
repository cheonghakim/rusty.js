export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

/** Identity token shared by every binding that refers to the same conceptual value. */
export type OwnerId = symbol;

export interface BorrowSite {
  span: SourceSpan;
  kind: "ref" | "mut";
  /** true when the borrow was never bound to a variable (e.g. `send(mut(x))`) and therefore
   *  dies at the end of the statement that created it, rather than at last-use / block-exit. */
  transient: boolean;
}

export type EscapeReason = "returned" | "closure-capture";

export type OwnershipState =
  | { kind: "Owned" }
  | { kind: "BorrowedRead"; borrows: BorrowSite[] }
  | { kind: "BorrowedWrite"; borrow: BorrowSite }
  | { kind: "Moved"; movedAt: SourceSpan; conditional?: boolean }
  | { kind: "Escaped"; reason: EscapeReason; at: SourceSpan };

export type DiagnosticCode =
  | "rusty/use-after-move"
  | "rusty/maybe-use-after-move"
  | "rusty/double-mut-borrow"
  | "rusty/mut-while-ref"
  | "rusty/ref-while-mut"
  | "rusty/move-while-borrowed"
  | "rusty/mutation-through-ref";

export interface RelatedSpan {
  span: SourceSpan;
  label: string;
}

export interface FixSuggestion {
  title: string;
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: "error" | "warning";
  message: string;
  primarySpan: SourceSpan;
  relatedSpans: RelatedSpan[];
  fixes: FixSuggestion[];
  confidence: "certain" | "likely";
}

export interface AnalyzeResult {
  diagnostics: Diagnostic[];
}
