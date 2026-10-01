import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const apiTarget = process.env.API_URL ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy api-server in dev so the client can use same-origin paths (no CORS).
    proxy: {
      '/api': { target: apiTarget, rewrite: (path) => path.replace(/^\/api/, '') },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    // Placeholders, so tests run without a .env and never point at a real Supabase project.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
    coverage: { include: ['src/**'], exclude: ['src/test/**'], reporter: ['text', 'html'] },
  },
})
