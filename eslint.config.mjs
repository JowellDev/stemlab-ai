// @ts-check
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      // Service worker de developpement, regenere par vite-plugin-pwa.
      '**/dev-dist/**',
      '**/.react-router/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.devservices/**',
      '**/*.tmp.*',
      'packages/database/src/generated/**',
      'apps/ml/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Un `any` doit etre justifie : on force le commentaire via eslint-disable.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Pas de catch silencieux : les erreurs remontent typees (cf. conventions).
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    // `configs.recommended` reste au format eslintrc ; la variante plate est sous `configs.flat`.
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    // Les scripts d'outillage rendent compte sur la sortie standard : c'est leur
    // interface, pas une trace de debogage oubliee.
    files: ['**/scripts/**/*.{mjs,js,ts}'],
    rules: { 'no-console': 'off' },
  },
  prettier,
)
