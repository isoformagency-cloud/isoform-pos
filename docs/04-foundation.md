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

## POS rebuild, stages 1 to 3 (31 October 2026)

Rebuilt from the feature list in docs/06-feature-list.md. Built: a new look across every page, grouped sidebar, top bar, phone navigation, search, a split POS screen, hold and resume, guests, delivery address, order and item notes, a full Orders page with search, filters, timeline and CSV export, a checkout screen with cash change, UPI QR and split payments, PDF bills, A4 bills, and bill settings with a live preview.

The first tap on an item now creates the order, so staff no longer choose a type first. The Orders page moved to the new POS screen at /pos, and /orders is now the list.

Decisions made while building: cashiers can discount up to an owner-set limit, 20% by default, and billing checks it again in case items were removed afterwards. The discount reason is now optional. Exports need report access, because they include customer phone numbers. Bill footer and FSSAI number are copied onto each bill, so later changes leave issued bills alone. UPI QR codes pay the café directly, so nothing passes through ISOFORM.

Known limits: UPI QR codes have not been scanned with a real UPI app. Cash received and change are shown but not stored. A4 and 80mm printing have not been tested on real printers. Requests were slow during the on-screen check because tests were running against the same database from this PC, so speed needs checking on the live site.

Tests: 192 API tests passed, 94 of 94 database rules. The full run took 41 minutes. The report tests' setup hit its 2 minute limit there and on one solo rerun, so 18 were skipped, then passed 18 of 18 alone with a longer limit. The setup makes over 50 calls to Mumbai at about 100 to 140 ms for each database trip, so the limit is now 5 minutes. The last two POS fixes came after these runs and only passed the build.

## Tables and kitchen, stages 4 and 5 (31 October 2026)

Built: areas and tables with a floor plan you can drag, a card view, live table states, reservations, moving and merging, Send to kitchen by rounds, a kitchen board with item ticks, timers, delay warnings, type filters and full screen, and live updates between screens.

Decisions: a table's state is worked out from its order and is never stored. Each table holds one open order, enforced in the database. Kitchen ticks are stored apart from order items, because a confirmed order's items can't change. Live signals carry no data, so each screen refetches through the API and permissions still apply. Item edits send no signal, to keep a busy till fast.

The live signal was proved on two tabs: the second screen began refreshing 0.3 seconds after the save finished, about 5 seconds before its regular refresh was due. Kitchen staff can move tickets but can't start orders, and the Kitchen page can be turned off in Settings.

Known limits: delivery app orders appear under Delivery on the board. Full screen was not clicked on screen. The floor plan was dragged with a mouse, not on a real touch screen. Reservations don't send reminders. Requests took 4 to 5 seconds during the on-screen check, because tests were running against the same database from this PC, so speed needs checking on the live site.

Tests: 229 of 229 API tests in one clean full run of 50 minutes, 94 of 94 database rules.

## Locked checkout amount (31 October 2026)

The owner asked that the amount can't change at checkout. On a single payment it is now fixed to the bill. Only Split payment asks for an amount, and the last payment always takes the rest, so payments add up to the bill. Part-paying a bill at checkout is no longer offered. This is a rule on the screen: the API still accepts a smaller payment, because split payments are saved one at a time.

## Branch picker (31 October 2026)

Adding a second branch left the POS asking for a branch with no easy way to choose one. The branch selector now sits in the top bar on every screen, screens update as soon as it changes, and POS, Tables and Cash ask on the page when no branch is chosen. Adding a branch refreshes the session straight away. Changing branch closes any open order on the POS screen. The Cash page now sends the chosen branch, which it did not before.

The same check found a loop in how New order cleared the screen, which could clear an order just started. It is fixed. Tested on screen with two branches. The API did not change, so no API tests ran.

## Customers, expenses and inventory, stages 6 to 8 (31 October 2026)

Built: a Customers page with search, sorting, a summary and profiles. An Expenses page with categories, receipt photos, totals against sales, export and voiding. An Inventory page with ingredients, stock in and out, stock counts, history, suppliers, recipes and low stock alerts. A stock purchase can be recorded as an expense in the same step.

Decisions: `stock_moves` is append-only and a trigger keeps each level in step, so a level can't drift from its history. Stock is deducted when the bill is issued, inside the same transaction, and never blocks a sale. Expenses are voided, not deleted. Receipts sit in the private `receipts` bucket and open through signed links, so the POS security policy now allows images from Supabase. Run `scripts/create-receipts-bucket.mjs` once on any new environment.

Two platform faults turned up during the on-screen check and are fixed:

- Each router ran the sign-in check again, so one request checked up to 13 times. Inventory took 8 seconds locally and now takes about 1. The check runs once per request.
- A failed fetch of Supabase's signing keys reported "Please sign in again" during a network drop, even though the sign-in was fine. It now returns a 503 that the POS retries.

Checked on screen: selling a Dosa with a recipe took coffee beans from 4 kg to 3.5 kg, marked them Low, lowered stock value and logged the sale against the order. Receipt upload and viewing worked, and the new pages had no sideways scroll at 375px wide.

Tests: 262 of 262 API tests in one full run of 36 minutes, down from 50 despite 33 more tests, because of the sign-in fix. 94 of 94 database rules, though those checks don't yet attack the new tables. The API tests cover them: other businesses' customers, expenses and stock stay hidden. Vitest warned once that the billing test worker was slow to exit, and every test still passed.

Known limits: a recipe can't vary by size. The receipt image under the live security policy and the speed gain on the live site still need checking after deployment.

