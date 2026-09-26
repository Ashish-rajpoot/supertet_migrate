import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This app is a local-first PWA: every page hydrates its client state
      // (localStorage bank, settings, results) inside a mount effect, because
      // none of it exists during SSR. Reading it during render would break
      // hydration, and useSyncExternalStore is not worth the indirection for
      // a handful of one-shot reads. The rule is off for that reason only.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
