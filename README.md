# ISOFORM POS

Multi-tenant billing, payment recording and restaurant management platform.
ISOFORM POS records payments. It does not process them.

## Current state

| Part | Status |
|---|---|
| `docs/` | Stages 1 and 2 approved, Stage 3 awaiting approval |
| `docs/schema` | First-release schema draft and its checks (`npm run verify:schema`) |
| `apps/site` | Marketing site built, not deployed |
| `apps/pos`, `apps/api` | Not started. Blocked until the database design is approved |

## Marketing site

```bash
npm install
npm run dev:site
```

Opens at http://localhost:5173.

```bash
npm run build:site
npm test
```

`npm run build:site` type-checks, builds and pre-renders every page into `apps/site/dist`.

`vite preview` serves the home page for `/pricing`. Use `/pricing/` when testing a build locally. Vercel serves the right file for both.

### Before going live

1. Create the Supabase project in Mumbai (`ap-south-1`) and run `supabase/migrations`.
2. Create a Vercel project with `apps/site` as the root directory.
3. Set the variables listed in `apps/site/.env.example`.
4. Replace the draft pricing, and have the Privacy and Terms pages reviewed.

## Documentation

- [Stage 1: Architecture discovery](docs/01-architecture-discovery.md)
- [Stage 2: System architecture](docs/02-system-architecture.md)
- [Stage 3: Database design](docs/03-database-design.md)
