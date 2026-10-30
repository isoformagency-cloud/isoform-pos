import { CtaBand } from '../components/CtaBand'
import { PageIntro } from '../components/PageIntro'
import { Reveal } from '../components/Reveal'

const RULES = [
  ['A record is not proof.', 'If someone typed an amount, the system says exactly that. Confirmed means someone checked.'],
  ['History stays.', 'Issued invoices and payments are never quietly edited. A correction is a new record, with a name and a reason.'],
  ['One business never sees another.', 'Separation is enforced in the database itself, not only on the screen, and tested on every release.'],
  ['Each role sees its own work.', 'A cashier, a kitchen and an owner need different things. Access follows role and branch.'],
  ['Claims match what is built.', 'If a feature isn’t ready, we say so. You have already seen that on our features page.'],
]

export function About() {
  return (
    <>
      <PageIntro
        eyebrow="About"
        title={
          <>
            A restaurant system that tells the <span className="accent">truth</span> about money
          </>
        }
      >
        <p>
          ISOFORM POS is built by ISOFORM, a digital design and experience studio. It brings billing,
          payment records and cash control into one place for food businesses, starting in India.
        </p>
      </PageIntro>

      <section className="section">
        <div className="wrap grid gap-10 lg:grid-cols-[1fr_1.45fr] lg:gap-16">
          <Reveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">Principles</p>
            <h2 className="heading mt-3">The rules we’re building to</h2>
          </Reveal>
          <ol className="space-y-4">
            {RULES.map(([title, text], index) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-line p-5 sm:p-6">
                <span className="numbers pt-0.5 text-sm text-brand">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="title">{title}</h3>
                  <p className="mt-1.5 text-ink-soft">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section border-t border-line bg-paper-soft">
        <div className="wrap max-w-3xl">
          <p className="eyebrow">Status</p>
          <h2 className="heading mt-3">Where the project stands</h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-soft">
            ISOFORM POS is in development and has not launched. The architecture is being finalised, and
            the first release will focus on the counter: billing, payment records, cash and daily reports.
          </p>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
