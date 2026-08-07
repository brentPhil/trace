//  @ts-check

import { tanstackConfig } from "@tanstack/eslint-config"

export default [
  ...tanstackConfig,
  {
    rules: {
      "import/no-cycle": "off",
      "import/order": "off",
      "sort-imports": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/require-await": "off",
      "pnpm/json-enforce-catalog": "off",
    },
  },
  {
    // Convex functions are excluded from the root tsconfig because they target
    // the Convex runtime, so the typed-lint project service cannot resolve
    // them. `npx convex dev` typechecks them against convex/tsconfig.json.
    ignores: ["eslint.config.js", ".prettierrc", "convex/**"],
  },
]
