import { rules } from "./rules.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const plugin: any = {
  meta: { name: "rusty.js/eslint", version: "0.1.0" },
  rules,
  configs: {},
};

// Flat-config self-reference pattern: the recommended config points back at this same plugin
// object, so `import rusty from "rusty.js/eslint"` + spreading `rusty.configs.recommended`
// is all a consumer needs.
plugin.configs.recommended = {
  plugins: { rusty: plugin },
  rules: {
    "rusty/borrow-check": "error",
    "rusty/maybe-borrow-check": "warn",
  },
};

export default plugin;
export { rules };
