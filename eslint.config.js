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
    /*
     * The component/Convex boundary, ENFORCED rather than reviewed.
     *
     * Nothing under src/components may reach for a Convex write or a Convex
     * function reference. Writes arrive as props (see `TimerBarActions` in
     * src/components/timer/timer-bar.tsx for the canonical shape) and the
     * hooks in src/hooks and the routes in src/routes are what supply them.
     *
     * This began as a bug: a design harness rendered the timer bar against
     * fixtures while the bar reached for live mutations internally, so it
     * fired real writes carrying fixture ids — and had that page been opened
     * while signed in, its start button would have stopped a real timer. The
     * invariant that fix forced is the more valuable half, because it is what
     * makes "render this with no backend" expressible; every test in
     * `timer-bar.test.tsx` depends on it.
     *
     * It was stated only in prose, in four separate comments, and checked only
     * by whoever was reading the diff. The boundary was intact when this rule
     * was added — the run was green — so this pins it rather than repairing
     * it.
     */
    files: ["src/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "convex/react",
              importNames: ["useMutation"],
              message:
                "Components take their writes as props — see `TimerBarActions` in src/components/timer/timer-bar.tsx. Call this from src/hooks or src/routes and pass the result down.",
            },
            {
              name: "@convex-dev/react-query",
              importNames: ["useConvexMutation", "convexQuery"],
              message:
                "Components take their data and their writes as props — see `TimerBarActions` in src/components/timer/timer-bar.tsx. Call this from src/hooks or src/routes and pass the result down.",
            },
          ],
          patterns: [
            {
              // Relative from anywhere under src/components, so matched by
              // suffix rather than by an exact specifier.
              group: ["**/convex/_generated/api", "**/convex/_generated/api.js"],
              message:
                "A component must not know the Convex function surface — see `TimerBarActions` in src/components/timer/timer-bar.tsx. Import `api` in src/hooks or src/routes and pass what it produces down as props.",
            },
          ],
        },
      ],
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
