import { formatMessage, getDiagnostics } from "./shared.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuleModule = any;

/** Two rules, not one — ESLint fixes a rule's severity from config ("error" | "warn"), it can't
 *  vary per reported message. Splitting on diagnostic confidence is how a single analysis run
 *  ends up producing both error- and warning-level ESLint messages (see design doc §8's
 *  strictness matrix: confirmed violations -> error, conditional/branch-dependent -> warning). */
function makeRule(confidence: "certain" | "likely"): RuleModule {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Rusty ownership/borrow analysis (${confidence} findings)`,
      },
      schema: [],
    },
    create(context: RuleModule) {
      return {
        "Program:exit"() {
          for (const d of getDiagnostics(context)) {
            if (d.confidence !== confidence) continue;
            context.report({
              loc: { line: d.primarySpan.line, column: d.primarySpan.column },
              message: formatMessage(d),
            });
          }
        },
      };
    },
  };
}

export const rules = {
  "borrow-check": makeRule("certain"),
  "maybe-borrow-check": makeRule("likely"),
};
