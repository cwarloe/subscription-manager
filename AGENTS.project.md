# Project instructions: subscription-manager

`AGENTS.md` is the App Builder platform contract and is left as shipped. Its
"Project instructions" section points here. This file covers what is specific to
this repo. Follow both. Where they differ, this file describes the repo.

## Outside the builder sandbox

- `.grok/` is gitignored and not in this repo. Every `.grok/skills/...` and
  `.grok/references/...` link in `AGENTS.md` resolves only inside the builder
  workspace. In a plain clone, skip them; don't recreate them.
- `/workspace` in `AGENTS.md` means the repo root. `startup.sh` is the builder's
  revive script; it `cd`s to `/workspace`, so don't run it in a normal clone.
  Locally, use `npm run dev` (port 8080).
- Use Node 22 (CI does). On Node 20, `npm test` fails right away: its
  `scripts/**/*.test.mjs` glob needs Node 22's `node --test`.

## Checks (same as `.github/workflows/ci.yml`)

```bash
npm ci
npm run typecheck
npm run lint          # 0 errors expected; 1 existing warning (useLedger fast-refresh)
npm run format:check
npm test              # 4 brand-check tests skip without .grok/ (expected)
npm run build         # DATABASE_URL empty here, so migrate skips; PGLite covers preview
```

- `npm run check:auth` is not part of CI. It compares the **running** dev
  server's `VITE_AUTH_ENABLED` with the next build's. Start `npm run dev` first.
  Exit 0 = agree, 1 = diverged, 2 = could not reach the dev server. Its logic is
  unit-tested in `scripts/check-auth-invariant.test.mjs`, which `npm test` runs.
- Formatting: Prettier is enforced in CI via `format:check` (added in #6/#7).
  Prefer formatting only the files you touch (`npx prettier --write <files>`).
  A whole-repo `npm run format` is fine when intentional; keep it in step with
  the private sibling `subscription-benefits` when you sync.

## Ledger rules (details in README)

These rules are product behaviour. Changing one is a product decision, not a
cleanup. See README → "What it does", "Honest data" and "Refresh".

- Money is integer cents. An unknown price is shown as Unknown, never `$0`.
- A price is *verified* only when the model's excerpt appears in the fetched
  official page and contains that amount. On failure the last amount stays,
  and if it was verified it becomes *stale*.
- Refresh is user-initiated, capped at 8 official pages per pass, and spends
  the app owner's `XAI_API_KEY`. Never call it on page load, and never mock it.
- Every ledger call needs the session and is scoped to the verified user id.

## Repos

This repo is **public**. `cwarloe/subscription-benefits` is the private sibling
(see README → "Repositories"). Sync between them on purpose. Never commit
`.env` files, database files, screenshots or keys here.
