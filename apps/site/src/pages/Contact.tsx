import { DemoForm } from '../components/DemoForm'
import { PageIntro } from '../components/PageIntro'

const NEXT = [
  'We read your request.',
  'We call to understand how your counter works today.',
  'We show you the product as it stands and when it could suit you.',
]

export function Contact() {
  return (
    <>
      <PageIntro
        eyebrow="Contact"
        title={
          <>
            Book a <span className="accent">demo</span>
          </>
        }
      >
        <p>Tell us a little about your business. It takes about a minute.</p>
      </PageIntro>

      <section className="section bg-paper-soft">
        <div className="wrap grid gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-12">
          <div className="rounded-2xl border border-line bg-white p-5 sm:p-8">
            <DemoForm />
          </div>
          <aside>
            <p className="eyebrow">What happens next</p>
            <ol className="mt-5 space-y-4">
              {NEXT.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="step">{String(index + 1).padStart(2, '0')}</span>
                  <span className="text-ink-soft">{step}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>
    </>
  )
}
