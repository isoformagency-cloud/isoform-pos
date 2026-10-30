import { serve } from '@hono/node-server'
import { app } from './app.js'

serve({ fetch: app.fetch, port: 8787 }, (info) => console.log(`API on http://localhost:${info.port}`))
