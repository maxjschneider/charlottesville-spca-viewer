import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// On GitHub Actions GITHUB_REPOSITORY is "owner/repo"; serve under "/repo/".
// Locally (no env var) this stays "/".
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  base: repoName ? `/${repoName}/` : '/',
  plugins: [svelte()],
})
