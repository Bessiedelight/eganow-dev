# Next.js template

This is a Next.js template with shadcn/ui.

## GitHub installation linking

Installation ownership and organization rosters are persisted by the GitHub
webhook handlers after signature verification with `GITHUB_WEBHOOK_SECRET`.
These handlers use the existing Convex admin client to call internal mutations.
Configure `CONVEX_DEPLOY_KEY` or `CONVEX_ADMIN_KEY` on the Next.js server for
deployments without authenticated Convex CLI access. Keep these keys server only.

Browser linking requires an active installation whose recorded installer matches
the signed-in GitHub account. The installation webhook must be delivered before
linking; browser callbacks cannot create installation records or supply rosters.

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
