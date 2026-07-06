import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'src/generated']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // Prisma/Express handlers routinely take untyped request bodies — `any` there is a
      // deliberate boundary, not a slip. Still flags it elsewhere.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]);
