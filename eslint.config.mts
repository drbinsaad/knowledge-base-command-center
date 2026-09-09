import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "dist",
    // Agent worktrees and session scratch space are checkouts of this repo;
    // linting them re-reports every file against the wrong tsconfig root.
    ".claude",
    "main.js",
    "package-lock.json",
    "manifest.json",
    "versions.json",
    "tsconfig.json",
    "tsconfig.eslint.json",
    "**/._*",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mts"],
          defaultProject: "tsconfig.eslint.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    // The browser host implements Obsidian's helpers with native DOM APIs.
    files: ["tests/browser/obsidian-browser.ts"],
    rules: { "obsidianmd/prefer-create-el": "off" },
  },
  {
    files: ["*.mjs", "scripts/**/*.mjs", "tests/**/*.{ts,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.eslint.json",
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/no-global-this": "off",
    },
  },
);
