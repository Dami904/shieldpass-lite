import { defineConfig } from 'vitest/config'
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
  // No COOP/COEP headers: they were set for cross-origin isolation so barretenberg (bb.js) can
  // use SharedArrayBuffer for in-browser ZK proving, but COOP isolation depends on BOTH sides —
  // even 'same-origin-allow-popups' on our side can't guarantee Web3Auth's own auth.web3auth.io
  // page (which we don't control) reciprocates, and a mismatch silently breaks the OAuth popup's
  // postMessage back to us (WalletLoginError: wallet popup has been closed by the user). bb.js
  // feature-detects `crossOriginIsolated` (see getSharedMemoryAvailable in
  // barretenberg_wasm/helpers/browser) and falls back to single-threaded proving gracefully when
  // it's unavailable, so dropping these headers only costs proving speed, not correctness.
  server: {
    host: 'localhost',
    port: 5173,
    open: true,
  },
  preview: {
    host: 'localhost',
    port: 4173,
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
  test: {
    // 'jsdom' times out spawning its worker in some sandboxed environments (slow filesystem
    // I/O initializing its dependency tree) — default to 'node' since the current suite is pure
    // logic with no DOM needs. Add `// @vitest-environment jsdom` at the top of an individual
    // test file if a future component test needs a DOM.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
