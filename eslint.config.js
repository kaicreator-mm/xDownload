import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      '**/out/**',
      'docs/**',
      '.agent/**',
      '.dev-standard/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // #95: the shipped extension popup is a plain-JS browser page (packaged
    // verbatim); its browser globals are real by design.
    files: ['apps/browser-extension/src/popup/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        Date: 'readonly',
        String: 'readonly',
        Number: 'readonly',
        Math: 'readonly',
      },
    },
  },
);
