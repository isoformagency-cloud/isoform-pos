import { Link } from 'react-router'
import { PageIntro } from '../components/PageIntro'

export function Login() {
  return (
    <PageIntro eyebrow="Log in" title="The POS isn’t open yet.">
      <p>Staff and owner login will appear here when ISOFORM POS launches.</p>
      <Link to="/contact" className="btn btn-primary mt-6">
        Book a demo
      </Link>
    </PageIntro>
  )
}
