import type { Me } from '../App'
import { PageHeader } from '../components/ui'

export function Home({ me }: { me: Me }) {
  return (
    <>
      <PageHeader title={`Hello, ${me.displayName}`} text="Your account is set up." />
      <p className="card p-6 text-ink-soft">
        Open Cash to start your session, then Orders to take orders and issue bills. Reports are the next module.
      </p>
    </>
  )
}
