import type { Me } from '../App'
import { PageHeader } from '../components/ui'

export function Home({ me }: { me: Me }) {
  return (
    <>
      <PageHeader title={`Hello, ${me.displayName}`} text="Your account is set up." />
      <p className="card p-6 text-ink-soft">
        Menu, orders and billing are the next modules. They will appear here when they’re built.
      </p>
    </>
  )
}
