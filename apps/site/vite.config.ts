import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Runs the Vercel function during local development so the form works end to end. */
function demoRequestApi(): Plugin {
  return {
    name: 'demo-request-api',
    configureServer(server) {
      server.middlewares.use('/api/demo-request', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const { POST } = await server.ssrLoadModule('/api/demo-request.ts')
        const response: Response = await POST(
          new Request('http://localhost/api/demo-request', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: Buffer.concat(chunks),
          }),
        )
        res.statusCode = response.status
        res.setHeader('content-type', 'application/json')
        res.end(await response.text())
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), demoRequestApi()],
  ssr: { noExternal: ['gsap', 'react-router'] },
})
