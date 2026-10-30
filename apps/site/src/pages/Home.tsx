import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { CtaBand } from '../components/CtaBand'
import { FeatureTabs } from '../components/FeatureTabs'
import { MoneyLadder } from '../components/MoneyLadder'
import { ProductPreview } from '../components/ProductPreview'
import { Reveal } from '../components/Reveal'
import { modules } from '../content/modules'

const FLOW = [
  ['Order', 'Add items, sizes and notes from the counter screen.'],
  ['Bill', 'GST, discounts and round-off are worked out on the server.'],
  ['Invoice', 'A finalised bill gets a consecutive number and is locked.'],
  ['Payment', 'Staff record cash, UPI, card or a split, with references.'],
  ['Verification', 'A manager checks recorded payments against the evidence.'],
  ['Cash close', 'The drawer is counted against every recorded movement.'],
  ['Reconciliation', 'Records are compared with statements, step by step.'],
  ['Reports', 'Sales, payments and cash stay as separate, defined figures.'],
]

const STEPS = [
  ['Bill the way you do now', 'Take the order and generate the bill in ISOFORM. It calculates what the customer owes.'],
  ['Take payment your way', 'Your card terminal, UPI QR and cash drawer stay exactly as they are. ISOFORM never touches the money.'],
  ['Record what happened', 'Staff note the amount, method and reference. One bill can take several payments.'],
  ['Check it and close the day', 'A manager confirms the payments and the drawer is counted. Any difference stays on record.'],
]

const CASH = [
  ['Opening cash', '5,000.00'],
  ['Cash sales', '+ 12,480.00'],
  ['Refunds', '− 200.00'],
  ['Cash expenses', '− 1,150.00'],
  ['Moved to safe', '− 5,000.00'],
]

const AUDIENCE = [
  ['Cafes', 'Quick counter billing, sizes and add-ons, with UPI and cash recorded in seconds.'],
  ['Restaurants', 'Dine-in orders and split bills now, with tables and a kitchen display coming next.'],
  ['Bakeries', 'Fast takeaway billing, simple menus and a clean cash count at closing.'],
  ['Multi-branch groups', 'Each branch has its own staff, registers and reports, with one view for the owner.'],
]

const STAGES = ['First release', 'Next', 'Later'] as const

export function Home() {
  return (
    <>
      <section>
        <div className="wrap pt-16 pb-14 text-center md:pt-24">
          <p className="eyebrow">Restaurant billing &amp; money tracking</p>
          <h1 className="display mx-auto mt-5 max-w-3xl">
            Every bill.
            <br />
            Every <span className="accent">rupee</span> on record.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            Billing, payment records and cash control for cafes, restaurants and bakeries. Keep your own
            card terminal, UPI QR and cash drawer. ISOFORM keeps the record.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/contact" className="btn btn-primary">
              Book a demo <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link to="/features" className="btn btn-secondary">
              See features
            </Link>
          </div>
          <p className="mt-5 text-[0.8125rem] text-ink-soft">In development · Not a payment gateway · Built for India</p>
        </div>
        <div className="wrap pb-16 md:pb-20">
          <ProductPreview />
        </div>
      </section>

      <section className="section border-y border-line bg-paper-soft">
        <div className="wrap">
          <Reveal className="grid gap-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="eyebrow">Product overview</p>
              <h2 className="heading mt-3 max-w-md">One record, from first order to last rupee</h2>
            </div>
            <p className="text-lg leading-relaxed text-ink-soft lg:pt-7">
              Most restaurants keep bills in one place, payments in another and cash in a notebook. In
              ISOFORM each step hands off to the next, so the numbers can be traced and nobody types
              them twice.
            </p>
          </Reveal>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map(([title, text], index) => (
              <li key={title} className="bg-white p-5">
                <div className="flex items-center gap-3">
                  <span className="step">{String(index + 1).padStart(2, '0')}</span>
                  <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-ink-soft">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="features" className="section">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">Core features</p>
            <h2 className="heading mt-3 max-w-xl">Everything the first release is built to do</h2>
            <p className="mt-3 text-lg text-ink-soft">Pick a feature to see what it covers.</p>
          </Reveal>
          <div className="mt-10">
            <FeatureTabs />
          </div>
        </div>
      </section>

      <section className="section border-t border-line">
        <div className="wrap grid gap-10 lg:grid-cols-[1fr_1.45fr] lg:gap-16">
          <Reveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">How it works</p>
            <h2 className="heading mt-3">We don’t touch your money. We make sure it adds up.</h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-soft">
              ISOFORM POS is not a payment gateway. Payments stay with the setup you already trust, and
              your team records what happened.
            </p>
            <Link to="/contact" className="btn btn-primary mt-7">
              Book a demo <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Reveal>
          <ol className="space-y-4">
            {STEPS.map(([title, text], index) => (
              <Reveal key={title}>
                <li className="flex gap-4 rounded-2xl border border-line p-5 sm:p-6">
                  <span className="numbers pt-0.5 text-sm text-brand">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="title">{title}</h3>
                    <p className="mt-1.5 text-ink-soft">{text}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="section bg-night text-white">
        <div className="wrap">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow !text-white/70">Money, honestly</p>
            <h2 className="heading mt-3">
              “Recorded” isn’t the same as <span className="accent">in the bank</span>
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-white/75">
              A figure on a screen doesn’t prove money arrived. ISOFORM keeps each stage apart, and when
              the drawer doesn’t match, the record says so.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <MoneyLadder />
            <div className="numbers rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-sm sm:p-6">
              <p className="font-sans font-medium">Cash session, closing count</p>
              <dl className="mt-4 space-y-2">
                {CASH.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-white/65">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-4 border-t border-white/15 pt-2">
                  <dt>Expected</dt>
                  <dd>11,130.00</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Counted</dt>
                  <dd>11,060.00</dd>
                </div>
                <div className="flex justify-between gap-4 rounded-lg bg-wait-tint px-2 py-1 font-medium text-wait">
                  <dt>Short, for review</dt>
                  <dd>70.00</dd>
                </div>
              </dl>
            </div>
          </div>
          <p className="eyebrow mt-4 text-right !text-[0.6875rem] !text-white/65">Concept preview · Sample data</p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">Who it’s for</p>
            <h2 className="heading mt-3">Built for one counter, ready for more</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIENCE.map(([title, text]) => (
              <div key={title} className="rounded-2xl border border-line p-5">
                <h3 className="title">{title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section border-t border-line bg-paper-soft">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">Roadmap</p>
            <h2 className="heading mt-3 max-w-xl">Built in the order a restaurant needs it</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STAGES.map((stage) => (
              <div key={stage} className="rounded-2xl border border-line bg-white p-5">
                <h3 className="title">{stage}</h3>
                <ul className="mt-3 space-y-1.5 text-[0.9375rem] text-ink-soft">
                  {modules
                    .filter((module) => module.stage === stage)
                    .map((module) => (
                      <li key={module.name}>{module.name}</li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          <Link to="/features" className="link mt-8 inline-block">
            See every feature
          </Link>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
