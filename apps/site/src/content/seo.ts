export const siteUrl = (import.meta.env.VITE_SITE_URL ?? 'https://isoform.example').replace(/\/$/, '')

/** Until the POS exists, Log in opens a holding page instead of a dead link. */
export const appUrl: string = import.meta.env.VITE_APP_URL ?? '/login'

export interface Page {
  path: string
  title: string
  description: string
  noindex?: boolean
}

export const pages: Page[] = [
  {
    path: '/',
    title: 'ISOFORM POS | Billing and money tracking for restaurants',
    description:
      'Billing, GST and payment records for cafes, restaurants and bakeries. Keep your own card terminal, UPI QR and cash drawer. ISOFORM keeps the record.',
  },
  {
    path: '/features',
    title: 'Features | ISOFORM POS',
    description:
      'What ISOFORM POS covers at launch and what comes next: billing, split payments, cash sessions, branches, tables, kitchen, inventory and expenses.',
  },
  {
    path: '/pricing',
    title: 'Pricing | ISOFORM POS',
    description:
      'Draft ISOFORM POS plans for single cafes, full-service restaurants and multi-branch groups. Final prices are being set.',
  },
  {
    path: '/about',
    title: 'About | ISOFORM POS',
    description:
      'Why ISOFORM is building a restaurant platform that records money honestly, and the rules it follows.',
  },
  {
    path: '/contact',
    title: 'Book a demo | ISOFORM POS',
    description:
      'Tell us about your restaurant, cafe or bakery and request a demo of ISOFORM POS.',
  },
  {
    path: '/privacy',
    title: 'Privacy | ISOFORM POS',
    description: 'How ISOFORM handles the details you send through this website.',
    noindex: true,
  },
  {
    path: '/terms',
    title: 'Terms | ISOFORM POS',
    description: 'Terms for using the ISOFORM POS website.',
    noindex: true,
  },
  {
    path: '/login',
    title: 'Log in | ISOFORM POS',
    description: 'The ISOFORM POS application is not open yet.',
    noindex: true,
  },
  {
    path: '/404',
    title: 'Page not found | ISOFORM POS',
    description: 'This page does not exist.',
    noindex: true,
  },
]

export const findPage = (path: string) =>
  pages.find((page) => page.path === path) ?? pages[pages.length - 1]

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const organization = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'ISOFORM',
  url: siteUrl,
  logo: `${siteUrl}/og-image.png`,
}).replace(/</g, '\\u003c')

export function headTags(page: Page) {
  const url = `${siteUrl}${page.path === '/' ? '' : page.path}`
  return [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}" />`,
    page.noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ISOFORM POS" />`,
    `<meta property="og:title" content="${escape(page.title)}" />`,
    `<meta property="og:description" content="${escape(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${siteUrl}/og-image.png" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    page.path === '/' ? `<script type="application/ld+json">${organization}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ')
}
