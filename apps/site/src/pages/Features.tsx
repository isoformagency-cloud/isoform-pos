import { CtaBand } from '../components/CtaBand'
import { PageIntro } from '../components/PageIntro'
import { Reveal } from '../components/Reveal'
import { modules, type Stage } from '../content/modules'

const STAGES: { stage: Stage; note: string; tone: string }[] = [
  { stage: 'First release', note: 'What the pilot is built around.', tone: 'bg-brand-tint text-brand-deep' },
  { stage: 'Next', note: 'Follows once the counter is proven.', tone: 'bg-wait-tint text-wait' },
  { stage: 'Later', note: 'Planned after that.', tone: 'bg-line/60 text-ink-mid' },
]

export function Features() {
  return (
    <>
      <PageIntro
        eyebrow="Features"
        title={
          <>
            What ISOFORM POS will do, and <span className="accent">when</span>
          </>
        }
      >
        <p>Nothing here is live yet. Each module shows the release it’s planned for, so you know what to expect.</p>
      </PageIntro>

      {STAGES.map(({ stage, note, tone }) => (
        <section key={stage} className="wrap pt-14 first-of-type:pt-14 md:pt-20">
          <Reveal className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="heading">{stage}</h2>
            <p className="text-ink-soft">{note}</p>
          </Reveal>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {modules
              .filter((module) => module.stage === stage)
              .map((module) => (
                <article key={module.name} className="rounded-2xl border border-line p-5 sm:p-6">
                  <p className={`numbers inline-block rounded-md px-2 py-0.5 text-[0.6875rem] font-medium ${tone}`}>
                    {module.stage}
                  </p>
                  <h3 className="title mt-3">{module.name}</h3>
                  <p className="mt-1.5 text-[0.9375rem] text-ink-soft">{module.summary}</p>
                  <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
                    {module.points.map((point) => (
                      <li key={point} className="flex gap-2.5">
                        <span aria-hidden="true" className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-brand" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
          </div>
        </section>
      ))}

      <section className="section mt-14 border-t border-line bg-paper-soft md:mt-20">
        <div className="wrap max-w-3xl">
          <p className="eyebrow">Clear limits</p>
          <h2 className="heading mt-3">What ISOFORM POS won’t do</h2>
          <ul className="mt-6 space-y-2.5 text-lg text-ink-soft">
            <li>It won’t process card or UPI payments.</li>
            <li>It won’t detect a UPI or card payment by itself.</li>
            <li>It won’t initiate refunds. Your team does that, then records it.</li>
            <li>It won’t mark money as received unless someone has checked it.</li>
          </ul>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
