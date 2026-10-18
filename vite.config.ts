import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// GitHub Pages serves the app from /<repo-name>/
export default defineConfig({ plugins: [react()], base: process.env.BASE_PATH || '/banii-la-virgula/' })
