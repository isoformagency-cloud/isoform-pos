import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

export function CtaBand() {
  return (
    <section className="section border-t border-line">
      <div className="wrap text-center">
        <h2 className="display mx-auto max-w-2xl">
          Show us how your counter runs <span className="accent">today</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-lg text-ink-soft">
          ISOFORM POS is in development. Tell us about your business and we’ll walk you through it.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/contact" className="btn btn-primary">
            Book a demo <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link to="/features" className="btn btn-secondary">
            See features
          </Link>
        </div>
      </div>
    </section>
  )
}
