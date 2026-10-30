export type Stage = 'First release' | 'Next' | 'Later'

export interface Module {
  name: string
  stage: Stage
  summary: string
  points: string[]
  preview?: { title: string; rows: [string, string][] }
}

export const modules: Module[] = [
  {
    name: 'Billing',
    stage: 'First release',
    summary: 'Totals are worked out on the server, so a screen cannot change what a bill should be.',
    points: [
      'Configurable GST for each tax registration',
      'Consecutive invoice numbers for each series',
      'Discounts checked against staff permissions',
      'Split bills and credit notes',
      'Old invoices keep the prices they were issued with',
    ],
    preview: {
      title: 'Invoice CBE1-2627-000123',
      rows: [
        ['Subtotal', '₹952.00'],
        ['CGST 2.5%', '₹23.80'],
        ['SGST 2.5%', '₹23.80'],
        ['Round off', '₹0.40'],
        ['Total', '₹1,000.00'],
      ],
    },
  },
  {
    name: 'Payment records',
    stage: 'First release',
    summary: 'Log what your terminal, UPI QR and cash drawer took, then have it checked.',
    points: [
      'Several payment methods on one bill',
      'Partial payments and outstanding balances',
      'Transaction references and who recorded them',
      'Recorded and Confirmed kept as separate states',
      'Refunds tracked against the original payment',
    ],
    preview: {
      title: 'Payments on this bill',
      rows: [
        ['Cash · Confirmed', '₹300.00'],
        ['UPI · Confirmed', '₹500.00'],
        ['Card · Recorded', '₹200.00'],
        ['Balance due', '₹0.00'],
      ],
    },
  },
  {
    name: 'Cash sessions',
    stage: 'First release',
    summary: 'Open the drawer, record every movement, count it at close.',
    points: [
      'Opening balance for each register',
      'Expected cash calculated from every movement',
      'Differences stay on record for review',
      'Reports by cashier and by branch',
    ],
    preview: {
      title: 'Register 1 · Closing count',
      rows: [
        ['Expected', '₹11,130.00'],
        ['Counted', '₹11,060.00'],
        ['Short, for review', '₹70.00'],
      ],
    },
  },
  {
    name: 'Menu and orders',
    stage: 'First release',
    summary: 'A fast counter screen built for the people using it all day.',
    points: [
      'Categories, variants and add-ons',
      'Per-branch prices and availability',
      'Order notes and order status history',
      'Warning when two people edit one order',
    ],
    preview: {
      title: 'Filter coffee',
      rows: [
        ['Regular', '₹84'],
        ['Large', '₹110'],
        ['Extra decoction', '+₹20'],
      ],
    },
  },
  {
    name: 'Branches and staff',
    stage: 'First release',
    summary: 'One business, one branch or many, and each person sees only what their role allows.',
    points: [
      'Owner, Manager, Cashier, Waiter, Kitchen and Accountant roles',
      'Quick PIN login on devices a manager approved',
      'Manager approval for voids and refunds',
      'Separate GSTIN for branches in different states',
    ],
    preview: {
      title: 'Who can do what',
      rows: [
        ['Record a payment', 'Cashier'],
        ['Confirm a payment', 'Manager'],
        ['Record a refund', 'Manager'],
        ['See all branches', 'Owner'],
      ],
    },
  },
  {
    name: 'Daily reports',
    stage: 'First release',
    summary: 'Sales, tax and payments, with every figure clearly defined.',
    points: [
      'Daily sales and tax summaries',
      'Payment breakdown by method',
      'Cash session and variance reports',
      'Late-night bills counted in the right trading day',
    ],
    preview: {
      title: 'Payment breakdown',
      rows: [
        ['UPI', '₹22,540'],
        ['Cash', '₹14,980'],
        ['Card', '₹9,380'],
      ],
    },
  },
  {
    name: 'Tables and kitchen',
    stage: 'Next',
    summary: 'Run the floor and keep the kitchen in step with the counter.',
    points: ['Table status and transfers', 'Kitchen order tickets', 'Live kitchen display'],
  },
  {
    name: 'Offline billing',
    stage: 'Next',
    summary: 'Keep billing through a dropped connection and sync afterwards.',
    points: ['Queued orders and bills', 'Safe sync without duplicates'],
  },
  {
    name: 'Inventory and purchases',
    stage: 'Later',
    summary: 'Know what you have, what it cost and where it went.',
    points: ['Stock movements with reasons', 'Suppliers and purchase records', 'Low-stock alerts', 'Branch transfers'],
  },
  {
    name: 'Expenses',
    stage: 'Later',
    summary: 'Rent, salaries and running costs, recorded without double counting stock.',
    points: ['Categories and approvals', 'Receipt attachments', 'Monthly and yearly reports'],
  },
  {
    name: 'Reconciliation and advanced reports',
    stage: 'Later',
    summary: 'Compare records with statements and see deeper trends.',
    points: ['Statement file imports', 'Product and branch performance', 'Consolidated group reports'],
  },
]
