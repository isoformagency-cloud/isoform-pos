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

## Billing module (Stage 5)

Built: whole-number tax calculation in paise, GST bills and bills of supply, database-assigned numbering, automatic series per branch and financial year, split bills, voluntary service charge, credit notes, and an 80mm print layout. API tests: 109 of 109. Database rules: 94 of 94.

Decisions for accountant review: tax is rounded per line, half-up. Service charge is taxed at the bill's highest item rate. Tax is charged only for the regular scheme. Unregistered businesses print 'Bill', and the database stores them as bill_of_supply.

Reliability work: every transaction now has a 20 second statement limit, 10 second lock limit and 30 second abandoned-transaction limit, set inside the transaction because role settings do not apply through the pooler. A connection dying mid-request fails only that request. Connection attempts retry, and the POS retries failed saves with the same idempotency key.

Known limits: opening a new pooler connection sometimes stalled for 9 seconds from this PC, with DNS and TCP both clean, so the stall is in the pooler handshake. Three full test runs failed from connection problems before the final fixes, and only the last run passed in full. Behaviour from a server in Mumbai is unmeasured. Printing has not been tested on a real thermal printer. A tax invoice has not been checked in the browser, only through API tests.

## Payments and cash (Stage 5)

Built: recording cash, UPI, card and bank payments with references and tips, split and partial payments, verification, failed and voided payments that reopen the bill, refunds, simple customers for unpaid bills, and cash sessions with blind counting, movements, review and shortfall tracking. Tests: 135 of 135 on the API, 94 of 94 on database rules.

Decisions to review: only managers and owners can move cash in or out of the drawer or record refunds. Cashiers do not see expected cash, movements or the difference. Accountants can verify payments and review sessions.

Known limits: pending payments are in the database but have no API or POS flow. Several registers in one branch need a register picker in the POS, because the API asks for a register when more than one session is open. Refunds use the original payment's method in the POS, and the API allows another. Reconciliation and settlements are not built. Tests retry 503 responses the way the POS does, because rare connection stalls continue from this PC. One run ended with a Windows crash of the test runner after all its tests passed, and left orphan test logins. Test logins with no business do no harm and can be removed from Supabase Auth.

## Daily reports (Stage 5)

Built: net sales, tax, payments recorded and confirmed, amount awaiting checks, amount still owed, refunds, tips, orders, payments by method, top items, tax by rate, cash sessions and branch totals, for up to 92 trading days. No profit figure is shown. Tests: 153 API tests with 1 failure on the last full run, in staff creation. That failure was traced to Supabase Auth being unreachable (status 0), now returned as a retryable 503. The foundation test file then passed 28 of 28. The full suite has not been rerun since that one-line change.

The pilot core (registration through reports) is complete locally. Top items and tax by rate are before credit notes. Reports run live queries, with no summary tables. Rate limiting, certificate pinning, custom SMTP, a staging project and deployment remain before real use.

## Launch preparation

Added: database-backed request limits, 64 KB request limit, security headers, strict database certificate verification with the Supabase root pinned, file extensions on API imports so compiled code runs on plain Node, and Vercel files for the POS and API. A compiled copy of the API was loaded and answered /health. Last full API run with these changes: 157 of 158. The one failure was a wrong test expectation, corrected, and that file was rerun. Not yet tested on Vercel: the function entry, rewrites, x-real-ip, and speed from Mumbai. Launch steps are in docs/05-launch.md.

## Change after first live use (31 October 2026)

The owner found the second-person rule a waste of time. It is now off by default. Owners, managers and accountants can confirm their own payments and review their own cash sessions, and cashiers still cannot confirm at all. Each action still records who did it. Businesses can turn on two-person checks in Settings. Payments also has a Confirm all button.

Transaction references are also optional by default after first live use. The payment form hides the field behind "Add reference". Without a reference, duplicate detection relies on the idempotency key, so the same customer payment entered twice on purpose cannot be caught, and verification depends on matching amounts.

Order confirmation added after first live use: Confirm order locks items, add-ons and service charge in the database, and only discounts can change the bill afterwards. Empty orders delete in one tap with no reason. Payment methods list cash, UPI, card, then bank. Order types have their own colour and symbol. API tests: 171 passed in the full run, and the orders file then passed 31 of 31 after its cleanup was fixed.

