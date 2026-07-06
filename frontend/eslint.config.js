import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Consistent with backend/eslint.config.js — flag `any` for cleanup, don't hard-fail CI on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // eslint-plugin-react-hooks 7.x's new React-Compiler-safety rules (set-state-in-effect,
      // refs) predate this codebase and would require a careful, file-by-file behavioral review
      // to fix correctly — not a mechanical rename. Downgraded to warn so CI reflects real
      // regressions instead of failing on pre-existing patterns; tighten incrementally as each
      // file gets touched.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      // The shadcn/ui primitives in components/ui and lib/session.tsx intentionally export a
      // hook/helper alongside a component (e.g. `useSession` + `SessionProvider`) — standard for
      // this pattern, not worth restructuring for Fast Refresh DX alone.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
