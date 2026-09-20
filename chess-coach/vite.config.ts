import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import { coachProxyPlugin } from './server/coachProxyPlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third argument '' means "load every var, not just VITE_-prefixed ones".
  // This only ever touches process.env in this Node-side config file — it
  // never reaches the client bundle, which is the whole point of routing
  // Anthropic calls through server/coachProxyPlugin.ts instead of fetching
  // the API directly from src/.
  const env = loadEnv(mode, process.cwd(), '')
  // Assigning `undefined` to a process.env property coerces it to the
  // *string* "undefined" (a Node quirk) — guard explicitly so a missing key
  // stays genuinely missing instead of becoming a truthy, invalid string.
  if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  }

  return {
    plugins: [react(), tailwindcss(), coachProxyPlugin()],
  }
})
