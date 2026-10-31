// eslint.config.ts
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Edge Functions are linted by `deno lint` (different runtime and import rules).
    ignores: ['**/dist/**', '**/coverage/**', 'supabase/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 3],
      'prefer-const': 'error',
    },
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
    // Test files may be longer per function (describe blocks).
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { 'max-lines-per-function': 'off' },
  },
  prettier,
);
