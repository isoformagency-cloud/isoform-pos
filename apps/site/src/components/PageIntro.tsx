import type { ReactNode } from 'react'

export function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="border-b border-line">
      <div className="wrap py-16 text-center md:py-24">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display mx-auto mt-5 max-w-3xl">{title}</h1>
        {children && <div className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">{children}</div>}
      </div>
    </section>
  )
}
