# Subscription Benefits

Private ledger for U.S. subscription prices, student and military offers, bundles, and credit-card benefits. It estimates the lowest eligible out-of-pocket cost without treating missing prices as zero.

## What it does

- Dashboard for one calendar month: known charges, discounts versus list price, credits that reduce the bill, card fees, and confirmed spending.
- Catalog of 50 services. Plan prices start unknown.
- Card families kept apart, including The Platinum Card from American Express and the Delta SkyMiles Platinum card.
- Your subscriptions: plan, paying card, billing frequency, renewal date, and an optional price override.
- Monthly history that does not change when a later refresh updates a price.

Money is integer cents. An annual price is an upfront charge on its renewal month. The monthly equivalent is shown beside it and is not the amount due.

Student and military prices are alternate prices. They are not added together. Card annual fees stay separate from military fee relief. Relief is unconfirmed until you mark it on that card. Statement credits and included memberships can reduce out-of-pocket. Cash back and points stay in rewards. A shared credit cap is spent once per benefit period (month, quarter, half-year, or year). Enrollment-required benefits do nothing until you mark them enrolled.

## Honest data

Nothing in the seed is a current price. A figure is one of:

| State | Meaning |
| --- | --- |
| Unknown | No successful price yet. Shown as Unknown, not $0. |
| Verified | A refresh matched an amount to a quote on the official page. |
| Stale | A later refresh failed. The last saved amount is kept and labeled stale. |
| You entered | You typed the amount. It is not an official check. |

Official pages are linked on each service and card. Last attempt and last success times are stored with the quote.

## Refresh

There is no public price API for these consumer plans that this app can call. Refresh does this instead:

1. You press Refresh. The server fetches that product's stored official HTTPS page (redirects must stay on the same site).
2. If `XAI_API_KEY` is set, one `grok-4.5` chat completion reads that page text and returns JSON. A full pass checks at most 8 pages so a click cannot fan out across the whole catalog. Press Refresh again for the next batch. Subscribed services and cards you hold go first.
3. A price is saved as verified only when the model's excerpt appears in the page text and contains that dollar amount. Other numbers are dropped.
4. If the fetch or the model fails, the previous amount stays and, if it had been verified, becomes stale. The failure is listed on the refresh panel.

Cost: each page is one short chat completion on the app owner's xAI key. There is no call on page load. Without the key, refresh records a clear failure and manual entry still works. This is not a promise of universal live prices. Welcome offers and account-specific card deals are not treated as standing benefits.

## Stack

[TanStack Start](https://tanstack.com/start) (React 19) on the server, Postgres when `DATABASE_URL` is set, and an embedded Postgres fallback for local preview. Sign-in is Google, X, or email and password. Every ledger call requires the session and is scoped to that user.

## Setup

```bash
npm install
npm run dev
```

The dev server listens on port 8080. Copy `.env.example` only if you are deploying yourself. Do not commit filled-in env files.

```bash
npm test
npm run typecheck
npm run build
```

## Deploy

The app is set up for the hosted builder deploy, which injects `DATABASE_URL`, auth secrets, and optionally `XAI_API_KEY`. Schema files in `migrations/` run on build.

For another host:

1. Provision Postgres and set `DATABASE_URL`.
2. Set `BETTER_AUTH_SECRET` and the auth provider values your host documents for this template.
3. Set `XAI_API_KEY` only if you want live extraction.
4. Run `npm run build` and start the built server. Migrations run as part of the build.

## Private GitHub repository

The source is in the private repository [cwarloe/subscription-benefits](https://github.com/cwarloe/subscription-benefits). Later changes:

```bash
git add .
git commit -m "Describe the change"
git push
```

Do not commit `.env`, database files, or screenshots.

## Limits

- Official pages can change markup, block automated fetches, or omit a price. Those runs fail honestly.
- Student and military eligibility is an assumption you can turn off. Qualifying is not the same as a free plan.
- Military annual-fee waivers are account-specific. The app does not assume SCRA or MLA relief.
- Bundle warnings are structural (Apple One versus Apple Music, Prime versus Prime Video, and so on). They are not verified bundle prices.
- Cash-back categories that are not tied to a service in this catalog are not estimated.
- One refresh batch stops at 8 official pages.
