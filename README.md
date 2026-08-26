# Chroneli

A time tracker that records what was accomplished, not only how long it took.
Built with TanStack Start, React and Convex, and deployed to Cloudflare Workers.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```

## Deploying

Convex functions and the frontend ship separately — Convex deploys on its own,
the frontend ships via wrangler — and **Convex must be deployed first, every
time.** Deploy with:

```bash
npx convex deploy --cmd "npm run build"
```

This deploys the Convex functions, then runs the frontend build against that
now-live deployment, which is the order the Convex docs recommend for exactly
this reason: the frontend calls functions like `entries.updateMany` by name,
so a frontend built or shipped against a Convex deployment that doesn't yet
have that function will fail every call it makes to it — as of this branch,
that includes the note field's only save path, which is the product's core
action, not just the sitting feature that introduced it. Do not simplify this
to "deploy either order" or split it into two unordered commands.
