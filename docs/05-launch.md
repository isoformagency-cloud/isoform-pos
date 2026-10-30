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
