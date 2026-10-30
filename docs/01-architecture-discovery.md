# ISOFORM POS: Stage 1, Architecture Discovery

Status: **Complete. Recommended defaults accepted for Q1 to Q5 on 30 October 2026. Domain still to be chosen.**
Date: 30 October 2026
No application code has been written. Prices and legal points were checked on this date. Sources are listed at the end, and items marked "confirm" still need a final check.

---

## 1. What we are building

ISOFORM POS is a subscription product for cafes, restaurants and bakeries. Every business logs in to the same application and sees only its own data.

It does four jobs:

1. **Run the floor:** menu, orders, tables, kitchen.
2. **Produce correct bills:** tax, discounts, numbering, corrections.
3. **Keep a truthful record of money:** payments taken on the restaurant's own terminal, UPI QR or cash drawer, plus expenses, cash and reconciliation.
4. **Report honestly:** sales, recorded payments, verified payments and settlements are never treated as the same number.

ISOFORM never moves money. No Razorpay or Stripe in the customer payment flow, no ecommerce checkout, and no claim that a payment is verified unless someone or something actually verified it.

**Added by the product owner:** this ships as a website first, with a mobile app later. Visitors arrive on a public 4 to 5 page marketing site, not directly in the POS. The theme follows the ISOFORM logo.

---

## 2. The most important architectural decisions

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| 1 | How tenants are separated | One shared Postgres database, `tenant_id` on every business record, enforced by RLS | Cheapest to run and to update, and strong if enforced at database level |
| 2 | Where business logic lives | Our own TypeScript API. The frontend never writes to tables directly | The mobile app can reuse it, and all billing rules stay in one trusted place |
| 3 | Website and POS | Two separate frontends sharing a design system | The marketing site needs SEO, the POS needs speed. Their needs conflict |
| 4 | How money records change | Append-only. Corrections are new records, never edits | Keeps a full history and supports credit notes |
| 5 | Offline behaviour | **Needs your decision** (Q1) | Hardest thing to add later. Affects invoice numbering and sync |
| 6 | How staff log in | **Needs your decision** (Q2) | Many cashiers have no email and share one tablet |
| 7 | Where tax details live | Under a "tax registration", not on the business | One business with branches in two states has two GSTINs |
| 8 | When a bill gets its number | Only when finalised. Draft bills have no invoice number | Abandoned orders must not leave holes in the invoice series |

---

## 3. Recommended technology stack

Your proposed stack is sound. I recommend keeping it, with four refinements.

### Frontend

- **React, TypeScript, Vite, Tailwind CSS v4** for both frontends.
- **Marketing site:** adds GSAP and React Bits for motion, and is pre-rendered to static pages so Google can read it.
- **POS app:** a single-page app, installable as a PWA. Uses TanStack Query for data. React Bits only where it helps. Heavy animation stays out, because a cashier needs speed rather than motion.

**Considered and not chosen: Next.js for everything.** It would give one codebase for site and app. But it pulls the logic toward its own server features, which a future mobile app cannot call, and the POS screen gains little from server rendering.

### Backend

- **Hono (TypeScript)** as the API framework. It is small and runs on Vercel, Cloudflare or plain Node, so hosting can change without a rewrite.
- **Zod** for checking every incoming request.
- **Drizzle** for type-safe queries, with the Supabase CLI owning migrations as plain SQL files.

### Data and infrastructure

- **Supabase in Mumbai (`ap-south-1`)** for Postgres, Auth, Storage and Realtime.
- The frontend talks to Supabase for **login and live updates only**. Everything else goes through our API.

### Hosting

| | Vercel Pro | Cloudflare Workers + Hyperdrive | Long-running Node server |
|---|---|---|---|
| Runs next to the database | Yes. `bom1` is the same AWS region as Supabase Mumbai | Runs near the user by default, so database distance needs managing | Depends on provider |
| Database connections | Through Supabase's transaction pooler | Hyperdrive supports Supabase | Simplest |
| Our tenant-security pattern | Works with `SET LOCAL` inside transactions | **Not confirmed** with Hyperdrive and transaction pooling. Must be tested | Works |
| Cost to start | About $20 per seat per month. Free tier is non-commercial only | About $5 per month and usage-based, cheapest | Varies |
| Effort | Lowest | Medium | Highest (we run the server) |

**Recommendation: Vercel Pro in `bom1`, with Supabase in Mumbai.** Reliability beats a small monthly saving here, and it is the only option where I have confirmed both region and security pattern. Because Hono is portable, we can move to Cloudflare later if cost justifies it.

### Starting cost

| Item | Monthly | Note |
|---|---|---|
| Supabase Pro | About $25 | Includes one Micro compute instance, 100,000 monthly users and 8 GB database. Figures from third-party sources, confirm at signup |
| Vercel Pro | About $20 | Per seat |
| **Development and pilot** | **About $45** | |
| Point-in-Time Recovery | About $100 extra | Requires a Small compute add-on. See risk 8 |

### Future mobile app

The API stays independent of the frontend, and the POS is a PWA from day one, so it can be installed on a tablet immediately. When the app is needed, **Capacitor** can wrap the same React code and add native printer access. That is much cheaper than rewriting the UI. We decide this when we get there.

---

## 4. Multi-tenant and multi-branch architecture

```
ISOFORM platform
└── Tenant (the business, e.g. ABC Restaurants)
    ├── Staff: membership (role in the business)
    ├── Menu (shared, with per-branch price and availability overrides)
    └── Tax registration (GSTIN, one per state)
        └── Branch (Coimbatore, Tiruppur, Erode)
            ├── Branch access: which staff work here
            ├── Registers, tables, stock, cash sessions
            └── Orders, invoices, payments, expenses
```

A new business automatically gets one branch, one tax registration and an Owner role. Single-branch owners never see branch management unless they add a second branch.

### Four layers of protection

Think of it as four locked doors. Each must fail before one business could see another's data.

1. **Login check:** the API confirms who you are from your session token.
2. **Membership check:** the API looks up your tenant, role and branches **in the database on every request**. The tenant is never accepted from the browser. Because this is checked live, removing an employee takes effect at once.
3. **Row Level Security (RLS):** the database itself filters every row. Even a bug in our code cannot return another tenant's records. The API connects as a restricted database role and sets the tenant for that transaction only (`SET LOCAL`).
4. **Composite foreign keys:** an order item must reference a product with the **same** `tenant_id`, so a record physically cannot point at another tenant's data.

The all-powerful `service_role` key bypasses RLS. It is never used for normal requests and never reaches a browser.

Automated tests will attempt cross-tenant and cross-branch access on every important operation, and a failure blocks deployment.

### Roles

Start with fixed roles: **Owner, Manager, Cashier, Waiter, Kitchen, Accountant**. Each maps to a list of permissions, such as `payment.verify`. Custom roles can be added later without a redesign, because code checks permissions rather than role names.

ISOFORM's own platform admins are a separate kind of user, not members of any tenant. Any support access to a tenant's data is logged.

---

## 5. Backend risks

| # | Risk | What could go wrong | How we prevent it |
|---|---|---|---|
| 1 | RLS bypass | Using the `service_role` key in normal code silently disables tenant protection | Restricted database role, isolation tests in CI |
| 2 | Tenant context leak | Connections are shared, so one request's tenant could carry into another's | `SET LOCAL` inside a transaction only, with a test that proves it |
| 3 | Duplicate invoice numbers | Two cashiers finalise at the same moment | One counter row per series, locked inside the transaction |
| 4 | Duplicate records | Double tap or a network retry records a payment twice | Idempotency key on every important write, enforced by a unique constraint |
| 5 | Conflicting edits | Two employees change the same order | Version number on the order. The second save is rejected and shown the latest state |
| 6 | Wrong cash totals | A running total drifts from reality | Expected cash is always calculated from the movement list, never stored as a running total |
| 7 | Kitchen misses an order | Realtime connection drops on a weak network | Realtime is only a signal. The screen refetches on reconnect and polls as a fallback |
| 8 | Data loss | Supabase Pro backs up daily, so up to 24 hours of bills could be lost | Turn on Point-in-Time Recovery before real financial data is stored |
| 9 | Slow reports | One owner's yearly report slows everyone's billing | Pre-computed daily summaries, report queries kept off the billing path |
| 10 | Realtime load | Postgres Changes checks permissions per subscriber on a single thread | Keep subscriptions narrow and filtered. Use Broadcast for high-volume kitchen events |
| 11 | Scope | 17 modules at once means none is properly tested | Pilot-first release (Q3) |

**Repository issue found:** `D:\Isoform POS` currently sits inside a git repository rooted at `D:\`, whose remote is an unrelated project (`rsvp.git`). This code must not be pushed there. At Stage 4 the project gets its own private repository.

---

## 6. Payment recording without a gateway

Money moves outside ISOFORM. ISOFORM keeps a record of what staff say happened, and of who later confirmed it.

```
Order → Draft bill → Invoice issued → Payment recorded → Verified → Reconciled
(editable) (no number)  (numbered, locked)  (employee)     (manager)   (against bank statement)
```

**Key rule:** a payment and its allocation are separate records. One payment can cover several bills, and one bill can take several payments. That handles ₹300 cash + ₹500 UPI + ₹200 card, partial payments and outstanding balances. Database checks stop allocations from exceeding the payment or the bill balance.

### Proposed statuses

| Status | Meaning |
|---|---|
| Pending | Expected, not yet recorded as received |
| Recorded | An employee says it was received. **Not proof** |
| Confirmed | An authorised person checked it against the terminal, UPI app or bank |
| Failed | Checked and did not arrive |

**Recommended change to your list:** "Refunded" and "Partially refunded" should not be stored statuses. They should be **calculated** from refund records. Otherwise a payment's status and its refund history can disagree. A refund is its own record linked to the original payment, and the original payment stays untouched.

Cash can be confirmed by the session closing count. UPI and card can be confirmed manually, one by one or in a batch against a statement. The person who recorded a payment should not be the one who verifies it, except in very small businesses where the owner does everything, which is a setting.

**Reconciliation** in version 1 is manual, with file import of bank or terminal statements as a later step. **Settlement** is tracked separately, because a recorded card payment has not necessarily reached the bank account.

---

## 7. Expense and cash management

### Expenses

- Each expense has category, amount, date, branch, payment method, vendor, who recorded it, approval status and optional receipt.
- Receipts live in private storage and open only through short-lived links.
- Corrections create a reversal plus a new record, so the history stays intact.

**Avoiding double counting:** inventory purchases are stored separately from operating expenses. Buying ₹5,000 of flour is stock (it becomes a cost when consumed), while paying rent is an expense. Reports show them on separate lines, and each payment appears only once.

### Cash

Each branch has one or more **registers**. Each register has **cash sessions**, and each session is a list of **cash movements**.

```
Expected cash = opening balance
              + cash sales
              + deposits into the drawer
              − cash refunds
              − cash expenses
              − withdrawals
```

- A cash payment and its cash movement are written in the same transaction, so they cannot disagree.
- A cash payment needs an open session, so no cash sits outside the record.
- At closing, the employee counts the drawer. The system stores expected, actual and the difference.
- Discrepancies are **never adjusted away**. They stay visible for review, and a closed session is locked.
- Cash expenses made from the drawer appear in that session automatically.

---

## 8. Database design considerations

These become the formal schema at Stage 3.

1. **Money:** fixed-precision `numeric`, never floating point, with the rounding rule stored per tenant.
2. **Tax snapshots:** every invoice line stores the name, price, tax rate and tax amount as they were at the time. Later menu or rate changes do not touch old invoices.
3. **Invoice series:** per tax registration and financial year, consecutive, 16 characters at most.
4. **Corrections:** an issued invoice is never edited or deleted. Corrections use credit notes or cancellation records.
5. **Immutable tables:** the API's database role has no `UPDATE` or `DELETE` rights on financial records.
6. **Business day:** a bill at 12:30 AM belongs to the previous trading day. Branches store a timezone and day cut-off, and reports use the business date.
7. **Soft deletion for catalogue data only:** products are deactivated, and history keeps its references. Financial records are never soft-deleted.
8. **Indexing:** indexes begin with `tenant_id` and `branch_id`, which also keeps RLS fast.
9. **Stock and cash are ledgers:** the current quantity comes from recorded movements, so every change has a reason and a person.
10. **Audit log:** who, what, when, and before and after values, for financial and admin actions.
11. **Customers:** an "outstanding balance" implies someone owes it, and your list has no customer table. See section 10.
12. **Retention:** financial records must survive a cancelled subscription, so ending a subscription cannot delete invoices.

---

## 9. Where I challenge the brief

1. **Service charge must be voluntary.** The brief lists service charges in the billing engine. In India, restaurants cannot add one automatically. The Delhi High Court upheld the consumer authority's guidelines in March 2025, and the authority has acted against restaurants since. So it should be off by default, removable on any bill and never automatic. A lawyer or accountant should confirm the wording.
2. **GST is not one rate.** Most restaurants charge 5% without input tax credit, while restaurants in "specified premises" (hotels over the ₹7,500 room tariff test) charge 18% with credit. Composition-scheme businesses issue a **bill of supply** and charge the customer no GST. So the tax rule is a setting per registration, not a product field alone.
3. **Multi-state means multiple GSTINs.** This is why section 4 puts tax registration under the business.
4. **Build order.** Move **cash management to directly after payments**. A cash payment needs an open session, so building them apart means rework.
5. **Two frontends.** The brief says one common frontend. That still holds for the application: every restaurant shares one POS. The marketing site is a separate small app, which is a deliberate exception.
6. **E-invoicing.** Most sources put the mandatory threshold at ₹5 crore annual turnover, which larger customers may cross. We should not build this now, but invoices must carry the data it needs. Confirm the threshold with an accountant.

**An accountant must review** tax rules, invoice format, credit notes, rounding and record retention before any live use. I can research these, but I am not a substitute for a qualified CA.

---

## 10. Unanswered product questions

### Answer now (see section 11)

Q1 Offline, Q2 Staff login, Q3 First release scope, Q4 Signup and pricing, Q5 Domain and site timing.

### Next round, during Stage 2

- **Printing:** which printers will customers use? Thermal printers from a browser are a known difficulty, so this needs a decision.
- **Customers and credit:** do you need customer records, running tabs or loyalty?
- **Aggregators:** will Swiggy and Zomato orders be entered? Tax and settlement work differently there.
- **Tips:** recorded or ignored?
- **Advance payments:** for catering or table deposits?
- **Language:** English only at first, or Tamil and others on the POS?
- **Devices:** tablets, desktops, or phones for waiters?
- **Subscription collection:** how will ISOFORM itself be paid (invoice and bank transfer at first)?
- **Data export:** what does a business get if it leaves?

### Privacy

India's DPDP Rules were notified in November 2025, with the main duties starting around May 2027. ISOFORM will hold staff and possibly customer data, so we collect the minimum, host in Mumbai and plan for this during Stage 7.

---

## 11. Questions for the product owner

Each has a recommended default. Replying "use defaults" is a valid answer.

**Q1. What happens when the internet goes down during service?**
- A. Online only. Billing stops when the connection drops. Simplest, but risky in a dinner rush.
- **B (recommended).** Build the foundations for offline now, ship online-first, and add offline billing before wider rollout. Costs a little now and avoids a rewrite.
- C. Full offline billing in the first release. Safest for customers, but adds a lot of time and complexity.

**Q2. How do cashiers and kitchen staff log in?**
- **A (recommended).** Owners and managers use email and password. Other staff use a short PIN on a device a manager has registered, with fast switching between staff.
- B. Every employee has their own email login.
- C. Phone number and OTP. Convenient, but every login costs SMS money.

**Q3. What goes into the first release?**
- **A (recommended).** A pilot core: registration, staff, branches, menu, orders, billing, payments, cash, basic reports. Then tables and kitchen, then inventory, purchases, expenses and advanced reports.
- B. Everything in the brief before anyone uses it.

Also: do you have a pilot restaurant? La Pausa Caffè could be a natural candidate if they would agree.

**Q4. How do businesses join, and is pricing public?**
- **A (recommended).** Visitors request a demo, and you approve and activate them. Pricing is shown as plans on the site. This fits having no payment gateway.
- B. Self-service signup with a free trial. Faster growth, but it needs abuse protection and a way to collect fees afterwards.

Please share your plan names and prices if you have them. Until then the pricing page uses clearly marked placeholders.

**Q5. Domain, and when do we build the website?**
- What domain will you use? Recommended layout: the marketing site on the main domain and the POS on `app.yourdomain`.
- **Timing (recommended):** build the marketing site once Q1 to Q5 are answered. It does not touch the database, so it is safe to start early, and it gives you something to show customers while the backend is designed.

---

## 12. Marketing site and brand direction

**Pages:** Home, Features, Pricing, About, Contact. **Log in** and **Book a demo** appear in the navigation. Privacy and Terms pages are added as legal footer pages. Log in goes to the POS, never the other way round.

**Honesty rule:** no invented customer counts, testimonials, ratings or logos. Feature claims must match what is actually built, and the site must say clearly that ISOFORM records payments rather than processing them.

**Brand (updated 30 October 2026 to follow the style of isoform-cafe.netlify.app):**
- Primary violet sampled from the logo: `#571BF3`. It has about 7.3:1 contrast on white, so it is safe for text and buttons.
- Fonts: Inter (body), Inter Tight (headings), Instrument Serif italic (one accent word), JetBrains Mono (labels and figures).
- White and soft grey surfaces, rounded cards with hairline borders, dark primary buttons and one dark section.
- The mark is rebuilt as a clean, transparent SVG at `brand/isoform-mark.svg`. The source is saved at `brand/isoform-logo-source.png`.
- In the POS, green, amber and red are reserved for status, and violet for the main action, so financial states stay easy to read.

---

## 13. Roadmap

| Stage | Output | Gate |
|---|---|---|
| 1. Discovery | This document | Your answers to section 11 |
| 2. System architecture | Diagrams, API structure, auth, financial workflows, the next-round questions | Your approval |
| 2A. Marketing site | Five pages, responsive, SEO-ready | Your review |
| 3. Database design | ERD, tables, indexes, RLS policies, migration plan | Your approval |
| 4. Foundation | Own repository, monorepo, Supabase, auth, tenants, branches, roles, tests | Isolation tests pass |
| 5. Core modules | Built and tested one at a time, in the Q3 order | Each module verified |
| 6. Testing | Multi-tenant, concurrency, financial and failure testing | Critical flows pass |
| 7. Production readiness | Backups, monitoring, security review, runbooks | Accountant and security review done |

---

## Sources

- [Supabase backups](https://supabase.com/docs/guides/platform/backups), [regions](https://supabase.com/docs/guides/platform/regions), [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [changelog](https://supabase.co/changelog)
- Supabase pricing (third-party summaries): [Makerkit](https://makerkit.dev/blog/saas/supabase-pricing), [Toolradar](https://toolradar.com/blog/supabase-pricing-2026)
- [Vercel regions](https://vercel.com/docs/regions), [Vercel costs (Costbench)](https://costbench.com/software/developer-tools/vercel/)
- [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/), [Vercel and Cloudflare comparison](https://dev.to/lazydev_oh/vercel-vs-netlify-vs-cloudflare-pages-2026-deep-comparison-with-real-numbers-8pl)
- [CGST Rule 46 (CBIC)](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html), [Invoice numbering (BUSY)](https://busy.in/gst/invoice-numbering-mistakes-under-gst-causes-corrections-and-prevention/)
- [GST on restaurants (TaxAj)](https://www.taxaj.com/learn/?p=497), [Restaurant GST (Razorpay)](https://razorpay.com/learn/gst-on-food-and-restaurants/), [Hotel restaurant rule (Outlook Money)](https://www.outlookmoney.com/tax/18-gst-for-restaurants-in-hotels-with-rs-7500-plus-tariff-industry-calls-for-rollback-ahead-of-tourist-season)
- [GST invoice rules (Tally)](https://www.tallysolutions.com/gst/gst-invoice/), [E-invoicing (Zoho)](https://www.zoho.com/in/books/gst/e-invoicing.html)
- Service charge: [SCC Online](https://www.scconline.com/blog/post/2025/04/01/delhi-high-court-mandatory-service-charge-unlawful-ccpa-guidelines-legal-news/), [Khaitan & Co](https://khaitanco.com/thought-leadership/DHC-validates-CCPA’s-Guidelines-which-prohibit-mandatory-levy-of-a-Service-Charge-by-a-Restaurant-or-Hotel), [The Week, January 2026](https://www.theweek.in/news/biz-tech/2026/01/10/restaurants-cannot-levy-mandatory-service-charge-as-it-violates-consumer-law-ccpa-confirms.amp.html)
- DPDP: [AZB & Partners](https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/), [YourStory](https://yourstory.com/2025/11/digital-personal-data-protection-dpdp-rules-2025-rollout-over-18-months)
