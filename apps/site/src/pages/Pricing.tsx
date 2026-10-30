import { Link } from 'react-router'
import { CtaBand } from '../components/CtaBand'
import { PageIntro } from '../components/PageIntro'

const PLANS = [
  {
    name: 'Counter',
    audience: 'For one cafe, bakery or quick-service outlet.',
    points: ['Billing and GST', 'Payment records', 'Cash sessions', 'Daily reports', 'One branch'],
  },
  {
    name: 'Restaurant',
    audience: 'For one dine-in restaurant with a kitchen.',
    points: ['Everything in Counter', 'Tables', 'Kitchen display', 'Inventory', 'Expenses'],
  },
  {
    name: 'Group',
    audience: 'For businesses with more than one branch.',
    points: ['Everything in Restaurant', 'Multiple branches', 'Branch-level staff access', 'Consolidated reports', 'Stock transfers'],
  },
]

const FAQ = [
  {
    question: 'Does ISOFORM take a share of my sales?',
    answer:
      'ISOFORM does not process your payments, so customer money never passes through it. Final subscription pricing is still being set.',
  },
  {
    question: 'Do I need to change my card machine or UPI QR?',
    answer: 'No. You keep them. Your team records each payment in ISOFORM after it happens.',
  },
  {
    question: 'What equipment will I need?',
    answer:
      'The first release is planned to run in a web browser on a tablet or computer. Printer support will be confirmed before launch.',
  },
  {
    question: 'Will it handle my GST setup?',
    answer:
      'GST is being built as a setting for each tax registration, not a fixed rate. Please check your treatment with your accountant, and we will review the invoice format with a qualified accountant before launch.',
  },
  {
    question: 'How do I pay for ISOFORM?',
    answer: 'This has not been finalised. We will confirm it with you during the demo.',
  },
]

export function Pricing() {
  return (
    <>
      <PageIntro
        eyebrow="Pricing"
        title={
          <>
            Plans that fit the <span className="accent">size</span> of your business
          </>
        }
      >
        <p>These plans are drafts, and prices haven’t been set. Book a demo and we’ll talk through what fits.</p>
      </PageIntro>

      <section className="section bg-paper-soft">
        <div className="wrap grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <article key={plan.name} className="flex flex-col rounded-2xl border border-line bg-white p-5 sm:p-6">
              <h2 className="title">{plan.name}</h2>
              <p className="mt-1 text-[0.9375rem] text-ink-soft">{plan.audience}</p>
              <p className="mt-5 font-display text-2xl font-semibold tracking-tight">Price to be announced</p>
              <ul className="mt-5 flex-1 space-y-2 border-t border-line pt-5 text-[0.9375rem]">
                {plan.points.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                    {point}
                  </li>
                ))}
              </ul>
              <Link to="/contact" className="btn btn-secondary mt-6">
                Ask about {plan.name}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section border-t border-line">
        <div className="wrap max-w-3xl">
          <p className="eyebrow">FAQ</p>
          <h2 className="heading mt-3">Common questions</h2>
          <div className="mt-8 space-y-2.5">
            {FAQ.map((item) => (
              <details key={item.question} className="group rounded-xl border border-line px-4">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-3 font-medium [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span aria-hidden="true" className="text-xl text-brand transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-4 text-ink-soft">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
