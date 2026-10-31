# ISOFORM POS: Feature list from the old app

Stages 1 to 8 are approved and built, with the differences listed below. Stages 9 to 11 are not built.

Source: https://isoform-cafe.netlify.app/app, reviewed on 31 October 2026. Main screens were opened in the demo café. Sign-up, onboarding, checkout and pop-ups were read from the site's public code and not clicked through.

Every feature below comes from the old app. Nothing has been added.

**Today** means our POS as it stands: **Have**, **Part** (a weaker version exists) or **No**.

**Size** is the build effort: **S** is mainly a screen, **M** is a screen plus server rules, **L** needs new database tables as well.

To approve, reply with the stages you want and the numbers to skip, for example "Approve stages 1 to 3, skip 14 and 22".

## What changed from this list in stages 1 to 3

- **2, notification bell:** shows live counts of what needs attention. Saved notifications and their settings stay in stage 11.
- **5, quick search:** covers orders, bills, customers, menu and staff. Stock comes with stage 8.
- **9, choose table:** a typed table name and guest count until the floor plan in stage 4.
- **14, cashier discounts:** cashiers can discount up to a limit the owner sets, 20% by default. Set it to 0 to turn this off. Billing checks the limit again.
- **24, PDF bills:** the built-in PDF fonts have no ₹ sign and no Indian scripts, so PDFs read "Rs." and names in Tamil or Hindi won't print correctly. Print, then Save as PDF, has neither problem.
- **26, bill prefix:** left out. A GST series must stay in sequence, so numbers keep the branch code.
- **26, tax split on or off:** left out. GST bills must show CGST and SGST separately, so it stays on.
- **26, GSTIN:** shown but can't be edited, because it is on legal bills. It is set at activation.
- **Decision A:** settled in stage 5 with two buttons. Send to kitchen goes round by round, so a table can order more. Confirm order locks everything before the bill and sends anything still unsent.

## What changed from this list in stages 4 and 5

- **27 to 33, tables:** a table's state comes from its order, so the two can't disagree. Billing means the order is confirmed. The table frees when the bill is issued, not when it's paid.
- **31, reservations:** a table shows as Reserved from 2 hours before a booking until 30 minutes after it. Two bookings on one table must be 2 hours apart.
- **33, merge:** moves the items to the other table's order and closes the first order. Confirmed orders can't be merged, and an order with a discount must have it removed first.
- **34, sent items:** once with the kitchen, an item's quantity can't change. To add more, add a new line. Only owners and managers can remove a sent item, which was the rule planned in stage 2.
- **40, live updates:** screens update on their own within about a second of a change. If the connection drops, they fall back to refreshing every 10 to 20 seconds.
- **Added setting:** Use the kitchen display can be turned off in Settings, for cafés with no kitchen screen. It wasn't in the list.

## What changed from this list in stages 6 to 8

- **41 to 44, customers:** spend counts issued bills less credit notes, so it matches the books. The profile shows the latest 20 orders. Allergies go in the notes box.
- **45, expenses:** an expense can't be deleted. Voiding keeps it on record, and a voided cash expense puts the money back in the drawer. Paying from the drawer needs an open cash session.
- **46, receipt photo:** JPEG, up to 5 MB, kept private. It opens through a short-lived link.
- **49 to 53, stock:** ingredients and suppliers are shared across branches. Stock levels and history are kept per branch.
- **54, recipes:** a recipe belongs to the menu item, not its size, so Regular and Large take off the same amount.
- **54, sales and stock:** stock comes off when the bill is issued. A sale is never blocked by low stock, so a level can go below zero until it is corrected. A credit note doesn't return stock, because the food has usually been made.
- **Access:** cashiers can't see inventory or expenses. Accountants can view both, kitchen staff can view stock, and changes need an owner or manager.

## Stage 1: Look and layout

| # | Feature | Today | Size |
|---|---|---|---|
| 1 | Sidebar grouped into Operate, Manage and Insights, with count badges | Part | S |
| 2 | Top bar with New order button and notification bell | No | S |
| 3 | Phone layout with bottom navigation | Part | S |
| 4 | The old app's cards, tables, badges and empty screens across every page | No | M |
| 5 | Quick search across orders, customers, menu, stock and staff (Ctrl K) | No | M |

## Stage 2: POS and orders

| # | Feature | Today | Size |
|---|---|---|---|
| 6 | Split POS screen: menu grid on the left, order on the right | Part | S |
| 7 | Menu search, category tabs with counts, press / to search | Part | S |
| 8 | Veg and non-veg markers on items | Part | S |
| 9 | Choose table, guest count and customer from the order panel | Part | M |
| 10 | Delivery address on delivery orders | No | S |
| 11 | Order note and per-item kitchen note | Part | S |
| 12 | Hold an order and bring it back | No | M |
| 13 | Open orders list inside the POS | Part | S |
| 14 | Quick discount buttons, percent or amount, with a cashier limit | Part | M |
| 15 | Orders page with Running, On hold, Completed and Cancelled tabs | No | M |
| 16 | Order search by number, customer, phone, bill or table | No | M |
| 17 | Order details panel with timeline | No | M |
| 18 | Export orders to CSV | No | S |

## Stage 3: Checkout and bills

| # | Feature | Today | Size |
|---|---|---|---|
| 19 | Full checkout screen with payment success page | Part | S |
| 20 | Cash received and change to return | No | S |
| 21 | UPI QR code on screen from the café's UPI ID | No | M |
| 22 | Split one bill across several payment methods | Part | S |
| 23 | Card approval code and UPI reference fields | Have | S |
| 24 | Download bill as PDF | No | S |
| 25 | A4 bills as well as 80mm | No | M |
| 26 | Bill settings with live preview: prefix, footer, GSTIN, FSSAI, tax split | Part | M |

## Stage 4: Tables

| # | Feature | Today | Size |
|---|---|---|---|
| 27 | Tables with name, seats, shape and area such as Indoor or Outdoor | No | L |
| 28 | Floor plan you can drag and edit, plus a card view | No | M |
| 29 | Live table states: Available, Occupied, Reserved, Waiting, Billing | No | L |
| 30 | Running amount and time shown on each table | No | S |
| 31 | Reservations with guest name, phone and time | No | L |
| 32 | Move an order to another table | No | M |
| 33 | Merge tables | No | M |

## Stage 5: Kitchen display

| # | Feature | Today | Size |
|---|---|---|---|
| 34 | Send to kitchen | No | M |
| 35 | Board with New, Preparing, Ready and Completed columns | No | L |
| 36 | Filter by dine-in, takeaway or delivery | No | S |
| 37 | Tick off single items | No | M |
| 38 | Timers and delay warnings, 15 minutes by default | No | S |
| 39 | Full-screen mode | No | S |
| 40 | Live board updates. The old app only did this between tabs on one device, so ours must work between tablets | No | M |

## Stage 6: Customers

| # | Feature | Today | Size |
|---|---|---|---|
| 41 | Customers page with search and sorting | Part | M |
| 42 | Customer profile: address, notes, allergies | Part | M |
| 43 | Order history, total spend, average order, usual items | No | M |
| 44 | Summary: repeat customers, visited in 30 days, lifetime spend | No | S |

## Stage 7: Expenses

| # | Feature | Today | Size |
|---|---|---|---|
| 45 | Record expenses with category, date, method and reference | No | L |
| 46 | Receipt photo | No | M |
| 47 | Filter by category and period, totals, expenses against sales | No | S |
| 48 | Export expenses | No | S |

## Stage 8: Inventory

| # | Feature | Today | Size |
|---|---|---|---|
| 49 | Ingredients with unit, category, cost and minimum stock | No | L |
| 50 | Stock in and stock out, with reason | No | L |
| 51 | Stock count and stock value | No | M |
| 52 | Stock history showing who changed what and when | No | M |
| 53 | Suppliers | No | M |
| 54 | Recipes on menu items, so each sale deducts stock | No | L |
| 55 | Low stock and out-of-stock alerts | No | M |
| 56 | Record a stock purchase as an expense | No | S |

## Stage 9: Dashboard and reports

These use data from the stages above, so they come late.

| # | Feature | Today | Size |
|---|---|---|---|
| 57 | Dashboard: sales, orders, average order, each against yesterday | No | M |
| 58 | Sales chart for today, this week and this month | No | M |
| 59 | Order type and payment breakdowns | Part | S |
| 60 | Recent orders, kitchen status, stock alerts, expenses on the dashboard | No | S |
| 61 | Date ranges with comparison to the previous period | Part | M |
| 62 | Busiest hours chart | No | S |
| 63 | Product report: best sellers, slow movers, by category | Part | M |
| 64 | Payments and order type reports | Part | S |
| 65 | Expense and profit reports | No | M |
| 66 | Staff report | No | M |
| 67 | Print reports and export to CSV | No | S |

## Stage 10: Menu improvements

| # | Feature | Today | Size |
|---|---|---|---|
| 68 | Item photos | No | M |
| 69 | Item description, shown in the POS | Part | S |
| 70 | Duplicate an item | No | S |
| 71 | Reorder categories, with icons | Part | S |
| 72 | Filter by available, out of stock, disabled and food type | No | S |
| 73 | Screen for linking add-ons to items | Part | S |

## Stage 11: Staff, settings and setup

| # | Feature | Today | Size |
|---|---|---|---|
| 74 | Admin role | No | M |
| 75 | Permissions grid the owner can edit: No access, View, Manage | No | L |
| 76 | Switch user on a shared device | Part | S |
| 77 | Activity log screen: discounts, cancellations, stock and menu edits | Part | M |
| 78 | Staff page showing orders today and last active | Part | S |
| 79 | Notifications: low stock, kitchen delay, payment issues | No | L |
| 80 | Choose which notifications appear | No | S |
| 81 | Turn order types and payment methods on or off | Part | M |
| 82 | Default seats, delay time, item photos and veg marker settings | No | S |
| 83 | Download a backup of the business's data | No | M |
| 84 | Setup guide for a new café: details, menu, tables, staff | No | M |
| 85 | Sample café menu during setup | No | S |
| 86 | Sample data with a Clear button | No | M |
| 87 | Public demo café with no login | No | L |
| 88 | Public sign-up with a 14-day trial | No | L |
| 89 | Plans with limits on staff, tables and locations | No | L |
| 90 | Subscription page, renewal reminders and billing pause | No | L |
| 91 | Delete account | No | M |

## Keep from our POS

The old app does not have these, or does not have them safely. They stay.

- Separate data for each business, shared across every device
- Bills that can't be edited or deleted, with credit notes for corrections
- Refunds, failed and voided payments
- Cash sessions with blind counting, movements and shortfall tracking
- Tips
- Delivery app orders
- Multiple branches with their own prices and sold-out status
- Registered devices, hashed PINs and PIN lockout
- Accountant role
- Confirm order lock from 31 October

## Do not copy

These are how the old app works, and they would be unsafe for real cafés.

- Keeping accounts, orders and bills only in the browser
- Storing PINs in readable form
- A default owner PIN of 1234
- Changing plans with no payment
- Deleting customers and expenses outright

## Decisions needed

**A. Confirm order and Send to kitchen.** The old app has Send to kitchen, and yours has Confirm order, which locks the items. If they become the same button, a table can't order a second round on that order. Options:
1. One button, and extra items go on a new order.
2. One button, and new items can be added but sent items are locked. This changes your rule that nothing changes after confirming.
3. Two buttons: Send to kitchen for each round, and Confirm order locks everything before the bill.

**B. Cashier discounts.** The old app lets cashiers give discounts up to a limit, 20% by default. Yours is owners and managers only. Feature 14 needs your choice.

**C. Old app roles.** The old app has Admin. Ours has Accountant. The list keeps both.

**D. Sign-up.** You chose demo-led joining earlier, so a person activates each business. Features 87 to 90 reverse that with public sign-up and trials. They should wait until the rest is done.

**E. Charging cafés.** Feature 90 can't take real money without a payment service for your subscription fees. This is separate from your no-gateway rule for customer bills, but it is your call.

**F. Friend's permission.** Get your friend's OK before this work starts, as the design and feature set are theirs.
