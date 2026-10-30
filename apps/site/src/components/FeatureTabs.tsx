import { useRef, useState, type KeyboardEvent } from 'react'
import { modules } from '../content/modules'

const featured = modules.filter((module) => module.preview)

export function FeatureTabs() {
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const module = featured[active]

  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = (active + step + featured.length) % featured.length
    setActive(next)
    tabs.current[next]?.focus()
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr] lg:gap-12">
      <div role="tablist" aria-label="Features" aria-orientation="vertical" onKeyDown={onKeyDown} className="grid gap-1.5 sm:grid-cols-2 lg:block lg:space-y-1.5">
        {featured.map((item, index) => (
          <button
            key={item.name}
            ref={(element) => {
              tabs.current[index] = element
            }}
            id={`tab-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls="feature-panel"
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={`block min-h-11 w-full rounded-xl border px-3.5 py-2.5 text-left text-[0.9375rem] transition-colors ${
              index === active
                ? 'border-ink bg-ink text-white'
                : 'border-line text-ink-soft hover:border-ink-soft hover:text-ink'
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>

      <div
        id="feature-panel"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        tabIndex={0}
        className="grid gap-6 rounded-2xl border border-line bg-paper-soft p-5 md:grid-cols-2 md:p-8"
      >
        <div>
          <h3 className="title">{module.name}</h3>
          <p className="mt-2 text-ink-soft">{module.summary}</p>
          <ul className="mt-5 space-y-2 text-[0.9375rem]">
            {module.points.map((point) => (
              <li key={point} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {module.preview && (
          <div className="self-start rounded-xl border border-line bg-white p-4 shadow-float">
            <p className="text-sm font-semibold">{module.preview.title}</p>
            <dl className="mt-3 space-y-2 text-[0.8125rem]">
              {module.preview.rows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd className="numbers text-right">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="eyebrow mt-4 !text-[0.625rem] !text-ink-soft">Sample data</p>
          </div>
        )}
      </div>
    </div>
  )
}
