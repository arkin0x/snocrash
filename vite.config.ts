import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Which build this is, for the line at the foot of the menu.
 *
 * ONOSENDAI counts merged pull requests and asks GitHub for the number. This
 * repo commits straight to main, so the honest equivalent is the commit
 * itself: the day it was made and its short hash, which is enough to tell
 * whether what is deployed is what you just pushed. Vercel hands the hash over
 * in the environment because it builds from a shallow checkout where git may
 * not be able to answer.
 */
function version(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA
  const ask = (cmd: string): string | null => {
    try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null } catch { return null }
  }
  const day = ask('git log -1 --format=%cs') ?? new Date().toISOString().slice(0, 10)
  const hash = sha?.slice(0, 7) ?? ask('git rev-parse --short=7 HEAD')
  return hash ? `${day}.${hash}` : 'dev'
}

export default defineConfig({
  plugins: [react()],
  define: {
    // Tests never need a number, and asking git for one on every run is waste.
    __SNOCRASH_VERSION__: JSON.stringify(process.env.VITEST ? 'test' : version()),
  },
})
