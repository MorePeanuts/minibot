// Shared ESLint flat config building blocks.
// - Workspace packages use the default export below.
// - apps/web combines Next.js' presets with `sharedRules` (see apps/web/eslint.config.js).
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

export const ignores = {
  ignores: [
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/next-env.d.ts",
    "packages/db/drizzle/**",
  ],
};

export const sharedRules = {
  rules: {
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
    ],
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    // pi's AgentTool generics are invariant; `AgentTool<any>` is the idiomatic escape hatch.
    "@typescript-eslint/no-explicit-any": "off",
    eqeqeq: ["error", "smart"],
    "no-console": ["warn", { allow: ["warn", "error", "info"] }],
  },
};

export { prettier };

export default tseslint.config(
  ignores,
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  sharedRules,
  prettier,
);
