// ESLint flat config (ESLint v9). Vite-React-TS preset, scoped to src/.
// Tests get loosened rules because they intentionally use `any`,
// `@ts-expect-error`, and ad-hoc mock shapes.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src/test/**"],
  },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
    ],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // s28 v2.7: react-refresh only-export-components is a HMR
      // optimization warning, not a bug-finder. Turn it off — the
      // codebase legitimately co-locates context providers,
      // small icon constants, and shared types alongside their
      // owning component, and refactoring all of those into
      // separate files just to silence Fast Refresh would explode
      // the file count for no runtime benefit.
      "react-refresh/only-export-components": "off",
      // s28 (2026-04-29 v2.7): pragmatic relaxations for an existing
      // codebase that has been growing without ESLint. We want the
      // bug-finding rules (react-hooks/*, no-floating-promises is too
      // chatty without project tsconfig wiring) on, but we don't want
      // a thousand stylistic warnings on day 1.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-control-regex": "off",
      "no-useless-escape": "warn",
      "no-misleading-character-class": "warn",
      "prefer-const": "warn",
    },
  },
  // Test files: intentionally loose. They use ts-expect-error,
  // any-typed mocks, etc.
  {
    files: ["src/**/__tests__/**/*.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
);
