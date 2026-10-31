import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const env = loadEnv('', fileURLToPath(new URL('../..', import.meta.url)), '')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Only these two public values reach the browser. The service key never does.
  define: {
    __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL),
    __SUPABASE_ANON_KEY__: JSON.stringify(env.SUPABASE_ANON_KEY),
  },
  // Small fonts would otherwise be embedded in the CSS, which the live security policy blocks.
  build: { assetsInlineLimit: 0 },
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
})
