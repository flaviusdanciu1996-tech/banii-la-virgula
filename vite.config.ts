import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Each build gets an id; the app compares it with dist/version.json to offer "new version, reload".
const BUILD = new Date().toISOString()
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }) },
})

// GitHub Pages serves the app from /<repo-name>/
export default defineConfig({
  plugins: [react(), versionFile()],
  base: process.env.BASE_PATH || '/banii-la-virgula/',
  define: { __BUILD__: JSON.stringify(BUILD) },
})
