import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
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
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      // SPO-241: framer's `motion` statically links the whole animation engine
      // into whichever route chunk imports it — that is how the Dashboard went
      // 6.4 kB -> 152 kB. `@/lib/motion` re-exports the lazy `m` under the same
      // name, and MotionProvider loads the feature bundle once at the app shell.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "framer-motion",
              message:
                "Import { motion } from '@/lib/motion' instead — it is framer's lazy `m`, which keeps the animation engine in one shared chunk (SPO-241). See lib/motion.ts and components/MotionProvider.tsx.",
            },
          ],
        },
      ],
    },
  },
  {
    // The only two files allowed to reach framer-motion directly: the house
    // re-export of `m`, and the provider that supplies it with its features.
    files: ["src/lib/motion.ts", "src/components/MotionProvider.tsx"],
    rules: { "no-restricted-imports": "off" },
  }
);
