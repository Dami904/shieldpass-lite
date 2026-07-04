import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The SDK prover does `require('@aztec/bb.js')`, which resolves to bb.js's NODE build in the
// browser bundle — and that build calls `fileURLToPath`, crashing with
// "(0 , r.fileURLToPath) is not a function". Force bb.js's BROWSER build instead.
// We point at the SDK's own bb.js (5.0.0-nightly) — NOT the frontend's 4.3.1 — so the proofs the
// browser generates match the version the backend verifies with. Same version on both sides is
// required for UltraHonk proofs to verify.
const bbBrowser = path.resolve(
  import.meta.dirname,
  '../SDK/node_modules/@aztec/bb.js/dest/browser/index.js',
)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      { find: '@aztec/bb.js', replacement: bbBrowser },
      { find: /^@shieldpass\/sdk$/, replacement: path.resolve(import.meta.dirname, '../SDK/src/index.ts') },
      {
        find: /^@shieldpass\/sdk\/dist\/(.+)$/,
        replacement: path.resolve(import.meta.dirname, '../SDK/src/$1.ts'),
      },
      { find: /^crypto$/, replacement: path.resolve(import.meta.dirname, './crypto-mock.js') },
    ],
    dedupe: ['@aztec/bb.js'],
  },
  // Cross-origin isolation so barretenberg (bb.js) can use SharedArrayBuffer for in-browser ZK
  // proving. credentialless (not require-corp) keeps the jsdelivr Geist fonts working.
  server: {
    host: 'localhost',
    port: 5173,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    host: 'localhost',
    port: 4173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@aztec/bb.js'],
  },
  worker: {
    format: 'es',
  },
})
