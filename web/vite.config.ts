import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

const live = fileURLToPath(new URL('../live', import.meta.url))

// `npm run build` writes ONE self-contained file to ../live/index.html (server.mjs serves it at :4791).
// `npm run dev` serves the page with hot reload and forwards /api to the running server.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: process.env.DECK_OUT ?? live, emptyOutDir: false, assetsInlineLimit: 100_000_000, reportCompressedSize: false },
  server: { port: 4792, proxy: { '/api': 'http://localhost:4791' }, fs: { allow: ['..'] } },
})
