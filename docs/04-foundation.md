# ISOFORM POS: Stage 4, Foundation

Status: **Built and tested locally. Not deployed.**
Date: 31 October 2026

## What exists

| Part | State |
|---|---|
| Database | All tables, policies and roles live, managed by migrations, on Supabase (Mumbai) |
| API (`apps/api`) | Sessions, business settings, branches, tax registrations, staff, devices, PIN login |
| POS (`apps/pos`) | Sign-in, password setup, PIN login, Home, Branches, Staff, Devices, Settings |
| Activation | `npm run provision -w @isoform/api -- ./business.json` |

## Running locally

```bash
npm run dev -w @isoform/api
```

```bash
npm run dev -w @isoform/pos
```

The POS opens at http://localhost:5174.

## Activating a business

Create a JSON file with `displayName`, `legalName`, `scheme`, `gstin` (unless unregistered), `stateCode`, `address`, `branchName`, `branchCode`, `ownerName` and `ownerEmail`, then run the provision command. It prints a private link for the owner to set a password. Keep that file out of git.

## How PIN sessions work

Each PIN staff member has a hidden Supabase Auth account on the reserved `.invalid` domain, so no email is ever sent. The API checks the device credential, branch assignment, attempt limit and PIN, then creates a normal Supabase session. The rest of the system therefore treats every user the same way.

## Live updates

Private Broadcast channels named `branch:<id>`. `app.can_listen` decides access, and the API sends signals through the Realtime REST endpoint. Proof: `npm run prove:realtime -w @isoform/api`.

## Test results (31 October 2026)

| Test | Result |
|---|---|
| Database rule checks | 94 of 94 |
| API security tests on real Supabase | 28 of 28 |
| Realtime and PIN proof | Assigned staff received the signal, an outsider was refused |
| Browser flow | Sign-in, add staff, register device, PIN login |
| POS bundle | Contains no service key or database URL |

`npm run verify:concurrency` is for a spare empty project and now refuses to run on the live one. Its 19 of 19 result was recorded before the migrations were applied.

## Known limits

- **Rate limiting is not built.** PIN attempts are locked per device, but `/auth/*` and the demo form have no request limit yet. Required before going live.
- **Database TLS** uses `rejectUnauthorized: false`. Traffic is encrypted but the certificate is not pinned. Add Supabase's CA certificate before going live.
- **Supabase public sign-up is on.** Strangers could create an empty account, which gets no access. It should be turned off.
- **Device credentials live in `localStorage`.** Fine for the web version. Native secure storage comes with the mobile app.
- **Email invitations** use Supabase's built-in mail, which is heavily rate limited. Set up custom SMTP before real use.
- **API integration tests run on the one Supabase project** and clean up after themselves. A separate staging project is advisable before real customers.
- **Offline-ready rules** (device-created IDs) start with the orders module.
- **The API is not yet deployed.** The POS and API need a Vercel project, which comes with the first deployment.

## Menu module (Stage 5)

Built: tax rates, categories, products with variants, add-ons, branch prices and sold-out status, with deactivation instead of deletion. API tests: 47 of 47 on two consecutive runs. One earlier run had a staff-creation test return 409 while test files ran in parallel. It did not repeat, the cause is unknown, and the API now logs the Supabase status if it recurs.

Not built yet: product images, a POS screen for linking add-ons to items, and a button to remove a branch price. The API supports the last two.

## Orders module (Stage 5)

Built: order types including delivery apps, per-branch daily numbering, server-side price snapshots, sizes and add-ons, version checks, item removal with a reason, discounts, cancellation, and the POS counter screen. API tests: 69 of 69. An earlier run failed on network errors (ENOTFOUND, ECONNRESET) and passed unchanged on rerun.

Decisions to review:

- Cashiers can lower quantities and remove items on an open order, with the removal reason and quantity changes logged. Stage 2 said voids need a manager. Manager approval will apply once items are sent to the kitchen, because a cashier fixing a mistake before that is routine.
- Discounts are limited to owners and managers. A cashier cannot request one yet, because on-the-spot manager approval is not built.
- Service charge is stored on the order, defaults to 0 and is never added automatically. There is no POS control yet.

Known limits: a tap took about 2 seconds from this PC to the Mumbai database, with tests running. Speed must be measured from a server in Mumbai. Orders update on other tills every 15 seconds, not instantly. Connection failures return a generic error, and POS offline handling is not built.
