// eslint.config.ts
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/** Size limits from guidelines/coding-standards.md › Size limits — shared by Node and Deno code. */
const SIZE_RULES = {
  'max-depth': ['error', 4],
  'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-params': ['error', 3],
} as const;

/** Edge Functions: `deno lint` owns style/import rules; ESLint only checks the size limits. */
const EDGE_FUNCTION_FILES = ['supabase/functions/**/*.ts'];

/** Test files and test fakes may be longer per function (describe blocks, in-memory fakes). */
const TEST_FILES = [
  '**/*.test.ts',
  '**/*.test.tsx',
  'supabase/functions/_shared/db/fake-repository.ts',
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: EDGE_FUNCTION_FILES,
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...SIZE_RULES,
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: EDGE_FUNCTION_FILES,
    languageOptions: { parser: tseslint.parser, globals: { ...globals.denoBuiltin } },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: SIZE_RULES,
  },
  {
    files: ['web/**/*.tsx', 'web/**/*.ts'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Owner rule: no anonymous inline JSX handlers — use named function declarations.
      'react/jsx-no-bind': [
        'error',
        { allowArrowFunctions: false, allowFunctions: true, allowBind: false },
      ],
      'react/no-danger': 'error',
    },
  },
  {
    files: TEST_FILES,
    rules: { 'max-lines-per-function': 'off' },
  },
  prettier,
);
