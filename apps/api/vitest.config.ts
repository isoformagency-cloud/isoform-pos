import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig({
  test: {
    env: loadEnv('', fileURLToPath(new URL('../..', import.meta.url)), ''),
    testTimeout: 180000,
    hookTimeout: 120000,
    // Every file creates businesses on the one shared Supabase project.
    fileParallelism: false,
  },
})
