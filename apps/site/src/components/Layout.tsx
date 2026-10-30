import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { appUrl, findPage } from '../content/seo'
import { Logo, Mark } from './Logo'

const NAV = [
  { to: '/features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
]

function Header() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (!open) return
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('keydown', close)
      document.body.style.overflow = ''
    }
  }, [open])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:text-ink ${isActive ? 'text-ink' : 'text-ink-soft'}`

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper">
      <div className="wrap flex h-16 items-center justify-between gap-6">
        <Link to="/" aria-label="ISOFORM POS home" className="shrink-0">
          <Logo className="h-7 w-auto" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <a href={appUrl} className="btn btn-sm text-ink-mid hover:bg-line/50">
            Log in
          </a>
          <Link to="/contact" className="btn btn-primary btn-sm">
            Book a demo
          </Link>
        </div>

        <button
          type="button"
          className="-mr-2 flex size-12 items-center justify-center lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen(!open)}
        >
          <span className="relative block h-3.5 w-7" aria-hidden="true">
            <span
              className={`absolute inset-x-0 h-0.5 bg-ink transition-transform ${open ? 'top-1.5 rotate-45' : 'top-0'}`}
            />
            <span
              className={`absolute inset-x-0 h-0.5 bg-ink transition-transform ${open ? 'top-1.5 -rotate-45' : 'top-3'}`}
            />
          </span>
        </button>
      </div>

      {open && (
        <nav
          id="mobile-menu"
          aria-label="Mobile"
          className="fixed inset-x-0 top-[65px] bottom-0 flex flex-col gap-1 overflow-y-auto bg-paper px-4 py-6 sm:px-6 lg:hidden"
        >
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `border-b border-line py-4 font-display text-xl font-semibold ${isActive ? 'text-brand' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <a href={appUrl} className="border-b border-line py-4 font-display text-xl font-semibold">
            Log in
          </a>
          <Link to="/contact" className="btn btn-primary mt-6 self-start">
            Book a demo
          </Link>
        </nav>
      )}
    </header>
  )
}

function Footer() {
  return (
    <footer className="bg-night text-white">
      <div className="wrap grid gap-10 py-14 text-[0.9375rem] md:grid-cols-[1fr_auto]">
        <div className="max-w-sm">
          <Mark className="h-10 w-auto text-white" />
          <p className="mt-5 font-display font-semibold">ISOFORM POS</p>
          <p className="mt-1 text-white/75">Digital. Design. Experience.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-16 gap-y-3 sm:grid-cols-[auto_auto]">
          <ul className="space-y-3">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="space-y-3">
            <li>
              <a href={appUrl} className="hover:underline">
                Log in
              </a>
            </li>
            <li>
              <Link to="/privacy" className="hover:underline">
                Privacy
              </Link>
            </li>
            <li>
              <Link to="/terms" className="hover:underline">
                Terms
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15">
        <p className="wrap py-5 text-sm text-white/70" suppressHydrationWarning>
          © {new Date().getFullYear()} ISOFORM. ISOFORM POS records payments. It does not process them.
        </p>
      </div>
    </footer>
  )
}

export function Layout() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
    document.title = findPage(pathname.replace(/(.)\/$/, '$1')).title
  }, [pathname, hash])

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-4 focus:py-3 focus:text-white"
      >
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
