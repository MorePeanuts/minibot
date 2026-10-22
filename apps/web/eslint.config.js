import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { ignores, prettier, sharedRules } from "../../eslint.config.js";

const config = [
  ignores,
  { ignores: ["src/components/ui/**", "src/hooks/**"] },
  ...nextVitals,
  ...nextTs,
  sharedRules,
  prettier,
];

export default config;
