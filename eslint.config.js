// Flat ESLint config. Type-checked rules (projectService): the repo is small
// enough that the slower type-aware pass is free, and it is where the real
// catches live (floating promises, bad template interpolations, dead checks).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Settings/Scheme narrowing from <select> values needs `as` casts by
      // design (readScheme etc.). Don't fight the pattern, but keep casts
      // honest: no `any`, no non-null `!` (main.ts excepted below).
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Catch `${object}` in the SVG-string templates: it silently renders
      // "[object Object]" into the output, which tests may not notice.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true }],
      // a `default:` counts as covering the tail of a union: dataset reads are
      // string | undefined and permalink enums arrive from unvalidated JSON, so
      // a defensive default is the honest branch, not a missed case.
      '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
      // `_`-prefixed params mark deliberate ignores (back-compat shims keep an
      // old signature; regex replacer callbacks skip the full match).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // async DOM listeners are idiomatic here; every awaited path either
      // catches internally (the loaders, the export handlers' try/finally)
      // or cannot reject. Don't force void-wrappers on them.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
      eqeqeq: 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // main.ts is DOM plumbing over our own static index.html: `!` on dataset/
    // getElementById reads is the file's deliberate trust-the-DOM stance (the
    // `$` helper itself asserts non-null). Keep the rule strict in the pure cores.
    files: ['src/main.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // Tests: assert-based self-checks log their ok-line by design; `match()!`
    // just fails the test loudly; `${array}` in assert messages reads fine.
    files: ['src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true, allowBoolean: true, allowArray: true }],
    },
  },
  {
    // Plain-JS files outside the TS project: this config, the node self-tests.
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // public/: plain non-module browser scripts served as-is (p5 comes from a
    // CDN <script> tag). Declare the runtime globals instead of importing them.
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', matchMedia: 'readonly',
        setTimeout: 'readonly', location: 'readonly', console: 'readonly', p5: 'readonly',
      },
    },
  },
  {
    // test/: node-run self-checks (npm test), console output is the point.
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
