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
    // Convex *functions* are excluded from the root tsconfig because they
    // target the Convex runtime, so the typed-lint project service cannot
    // resolve them. `npx convex dev` typechecks them against
    // convex/tsconfig.json.
    //
    // convex/lib is not ignored: it is pure shared code, it IS in the root
    // tsconfig, and it holds the duration parser and the day-boundary maths —
    // the two places in this product where a bug becomes a wrong invoice.
    // Leaving it unlinted was how it ended up checked by neither tool.
    ignores: [
      "eslint.config.js",
      ".prettierrc",
      "convex/_generated/**",
      "convex/*.ts",
      // Agent worktrees. `git worktree add` puts a full second checkout inside
      // the repo, so a bare `eslint .` lints another branch's working copy and
      // reports failures that have nothing to do with the tree being verified.
      ".claude/**",
      ".superpowers/**",
    ],
  },
]
