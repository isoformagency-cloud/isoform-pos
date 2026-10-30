import { Link } from 'react-router'
import { PageIntro } from '../components/PageIntro'

export function NotFound() {
  return (
    <PageIntro eyebrow="404" title="This page isn’t on the bill.">
      <p>The link may be out of date, or the address may have a typo.</p>
      <Link to="/" className="btn btn-primary mt-6">
        Back to home
      </Link>
    </PageIntro>
  )
}
