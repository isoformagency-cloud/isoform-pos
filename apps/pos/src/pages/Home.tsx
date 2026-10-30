import type { Me } from '../App'
import { PageHeader } from '../components/ui'

export function Home({ me }: { me: Me }) {
  return (
    <>
      <PageHeader title={`Hello, ${me.displayName}`} text="Your account is set up." />
      <p className="card p-6 text-ink-soft">
        Billing and payments are the next modules. Open Orders to start taking orders.
      </p>
    </>
  )
}
