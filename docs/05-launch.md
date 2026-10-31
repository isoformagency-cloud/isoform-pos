# ISOFORM POS: Launch guide

Prepared 30 October 2026. **Nothing is deployed yet.** These steps need your accounts. Don't paste keys or passwords into chat.

## 1. Put the code on GitHub

```bash
git push origin stage-4-foundation
```

On GitHub, open a pull request from `stage-4-foundation` into `main` and merge it. Vercel deploys from `main`.

## 2. Deploy the POS and API

In Vercel, choose **Add New → Project**, then import `isoform-pos`.

| Setting | Value |
|---|---|
| Root Directory | `apps/pos` |
| Framework Preset | Vite |
| Include files outside the root directory | On |

Add these environment variables, using the values from `.env.local`:

| Name | Notes |
|---|---|
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Mark as sensitive |
| `DATABASE_URL_API` | Mark as sensitive |

Never add `DATABASE_URL_DIRECT` to Vercel, and never add a `VITE_` prefix to the sensitive values.

## 3. Deploy the website

Import the same repository a second time.

| Setting | Value |
|---|---|
| Root Directory | `apps/site` |
| Framework Preset | Vite |

| Name | Value |
|---|---|
| `VITE_SITE_URL` | Your website address |
| `VITE_APP_URL` | Your POS address |
| `SUPABASE_URL` | From `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | From `.env.local`, mark as sensitive |

## 4. Connect your domain

Recommended: the main domain on the website project, and `app.yourdomain` on the POS project. Add them under each project's **Settings → Domains**.

Then redeploy the website, because its addresses are built in.

## 5. Supabase settings

Under **Authentication**:

1. Turn off **Allow new users to sign up**. Staff and owners are created by ISOFORM, so this changes nothing for them.
2. Set **Site URL** to your POS address, and add it to **Redirect URLs**.
3. Under **Emails → SMTP**, connect an email service. Supabase's built-in mail is heavily limited, so owner password resets and manager invitations depend on this.

Under **Database → Backups**, upgrade to Pro and turn on Point-in-Time Recovery before real data goes in.

## 6. Tell Claude when it's deployed

Send the POS address. Claude will then check:

- That the API, sign-in, PIN login and printing path work on the real address
- Real speed from Mumbai, including whether the connection stalls happen there
- Security headers and request limits on the live site

## 7. Activate the first restaurant

Create a JSON file outside the repository:

```json
{
  "displayName": "Cafe name",
  "legalName": "Registered name",
  "scheme": "regular",
  "gstin": "33ABCDE1234F1Z5",
  "stateCode": "33",
  "address": "Full address",
  "branchName": "Main",
  "branchCode": "MN",
  "ownerName": "Owner name",
  "ownerEmail": "owner@example.com"
}
```

`scheme` is `regular`, `composition` or `unregistered`. Leave out `gstin` for `unregistered`.

```bash
npm run provision -w @isoform/api -- C:/path/to/business.json
```

It prints a private link for the owner to set a password. The owner then adds tax rates, menu, staff and devices.

## Before a real restaurant relies on it

| Item | Who |
|---|---|
| Accountant review (section 12 of the design document) | You |
| Legal review of Privacy and Terms | You |
| Test on a real 80mm thermal printer | You and Claude |
| Confirm plan prices | You |
| Offline billing, before wider rollout | Claude |
| A second Supabase project for staging | You and Claude |

## What's protected

- **Request limits:** 30 PIN or device requests a minute per address, 5 demo requests an hour. Supabase limits password attempts itself.
- **Database:** connections verify Supabase's certificate. The root is pinned in `apps/api/src/platform/database-ca.ts` and expires on 26 April 2031, so it must be replaced before then.
- **Requests:** 64 KB size limit, and security headers on every response.

## Live check, 30 October 2026

POS and API deployed at isoform-pos-app.vercel.app, website at isoform-pos.vercel.app, both in Mumbai. Run `npx tsx --env-file=../../.env.local scripts/check-live.ts <address> <demo owner email>` from apps/api.

Passed live: session refusal, sign-in through the API, order, tax quote, bill, payment, report, device registration, PIN login, wrong PIN refusal, cashier blocked from reports, and request limits.

Speed from the owner's PC: network 96 ms, adding an item 151 ms typical, issuing a bill 207 ms, recording a payment 425 ms. Occasional requests took 4 to 8 seconds. The cause is unconfirmed; opening new database connections is the likely reason.

## Live check, 31 October 2026, order confirmation

The live check now also covers confirming an order. Passed live through the API: payment methods in the order cash, UPI, card, bank; confirming an order; a new item and a service charge refused afterwards; a discount accepted afterwards; billing a confirmed order; and deleting an empty order with no reason. Everything from the earlier check passed again, and the request limit blocked 3 of 33 requests, as expected at 30 a minute.

Typical speed from the owner's PC: network 154 ms, adding an item 205 ms, issuing a bill 305 ms, recording a payment 310 ms. There were no slow requests in this run.

Clicked through on a local copy as a cashier: colours and symbols, Confirm order, the lock on the order bar, bill preview, Issue bill, and Cash first on the payment form. The Discount button after confirming was not clicked on screen, because cashiers do not have it. It passed through the API.

## Live check, 31 October 2026, POS rebuild

The live site has the new screens. The live check passed in full: POS settings, alerts, order counts, search, hold and resume, confirm, discount, bill, payment, Confirm all, timeline, export, PIN login and role blocks. The request limit blocked 3 of 33 requests, as expected.

Typical speed from the owner's PC: network 169 ms, adding an item 254 ms, issuing a bill 242 ms, recording a payment 215 ms.

The PDF code loaded and made a PDF on the live site with nothing blocked by the security policy. The live screens were only opened as far as the sign-in page, because test logins are not typed into the live site. Signed-in screens were clicked through on a local copy.

One embedded font was blocked by the security policy. It covers only rare Cyrillic characters, so nothing visible was affected, and fonts are no longer embedded.
