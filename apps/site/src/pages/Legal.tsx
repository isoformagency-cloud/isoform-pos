import type { ReactNode } from 'react'
import { PageIntro } from '../components/PageIntro'

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <PageIntro eyebrow="Draft, awaiting legal review" title={title} />
      <div className="wrap max-w-3xl space-y-4 py-12 text-ink-soft [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink">{children}</div>
    </>
  )
}

export function Privacy() {
  return (
    <LegalPage title="Privacy">
      <h2>What we collect</h2>
      <p>
        When you request a demo, we collect the details you enter: your name, business name, mobile
        number, city, number of outlets, and any email address or message you choose to add.
      </p>
      <h2>Why we collect it</h2>
      <p>We use these details to reply to your request and arrange a demo.</p>
      <h2>Cookies</h2>
      <p>This website doesn’t set advertising or analytics cookies.</p>
      <h2>Your choices</h2>
      <p>Contact details for privacy requests will be published here before launch.</p>
    </LegalPage>
  )
}

export function Terms() {
  return (
    <LegalPage title="Terms">
      <h2>This website</h2>
      <p>
        This website describes a product in development. Planned features, plans and timing may change
        before launch.
      </p>
      <h2>Payments</h2>
      <p>ISOFORM POS records payments. It does not process, hold or transfer money.</p>
      <h2>Product terms</h2>
      <p>Full terms for using ISOFORM POS will be published before launch.</p>
    </LegalPage>
  )
}
