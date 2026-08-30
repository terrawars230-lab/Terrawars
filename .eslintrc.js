module.exports = {
  root: true,
  extends: ['@react-native', 'plugin:import/recommended', 'plugin:import/typescript'],
  plugins: ['import'],
  settings: {
    'import/resolver': {
      typescript: {alwaysTryTypes: true, project: './tsconfig.json'},
    },
  },
  rules: {
    // Import hygiene — a predictable import block is the cheapest readability win
    // in a codebase several people touch.
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        pathGroups: [
          {pattern: 'react', group: 'external', position: 'before'},
          {pattern: 'react-native', group: 'external', position: 'before'},
          {
            pattern: '@{core,components,features,geo,navigation,services,app}/**',
            group: 'internal',
          },
        ],
        pathGroupsExcludedImportTypes: ['react', 'react-native'],
        'newlines-between': 'always',
        alphabetize: {order: 'asc', caseInsensitive: true},
      },
    ],
    'import/no-unresolved': 'error',
    'import/no-duplicates': 'error',
    'no-console': ['warn', {allow: ['warn', 'error']}],
    // `void somePromise()` is how we mark a deliberately un-awaited promise.
    // Without this the codebase would either float promises silently or wrap
    // every fire-and-forget call in a pointless `.catch(() => {})`.
    'no-void': ['error', {allowAsStatement: true}],
    // Noisy against libraries that export both a default object and matching
    // named members (NetInfo, i18next). The default import is intended.
    'import/no-named-as-default-member': 'off',
    'react-native/no-inline-styles': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
    ],
    'react-hooks/exhaustive-deps': 'error',
  },
  overrides: [
    {
      files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
      env: {jest: true},
      rules: {'no-console': 'off'},
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'android/',
    'ios/',
    'coverage/',
    'supabase/',
    '*.config.js',
    '.eslintrc.js',
  ],
};
