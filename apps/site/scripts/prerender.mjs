// Turns the built app into one static HTML file per page, so search engines
// and slow connections get real content before any JavaScript runs.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const server = join(root, 'dist-ssr')

const { render, pages, headTags, siteUrl } = await import(
  pathToFileURL(join(server, 'entry-server.js')).href
)
const template = readFileSync(join(dist, 'index.html'), 'utf8')

for (const page of pages) {
  const html = template
    .replace('<!--head-->', headTags(page))
    .replace('<!--app-->', render(page.path))
  const file =
    page.path === '/404'
      ? join(dist, '404.html')
      : join(dist, page.path === '/' ? '' : page.path, 'index.html')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
}

const urls = pages
  .filter((page) => !page.noindex)
  .map((page) => `  <url><loc>${siteUrl}${page.path === '/' ? '' : page.path}</loc></url>`)
  .join('\n')
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
)
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`)

rmSync(server, { recursive: true, force: true })
console.log(`Prerendered ${pages.length} pages`)
