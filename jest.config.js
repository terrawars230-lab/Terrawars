module.exports = {
  preset: '@react-native/jest-preset',
  // Only *.test.* files are suites. Shared fixtures live alongside them in
  // __tests__/ and must not be collected as empty suites.
  testMatch: ['**/*.test.[jt]s?(x)'],
  setupFiles: ['<rootDir>/jest/setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest/setupAfterEnv.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@components/(.*)$': '<rootDir>/src/components/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@geo/(.*)$': '<rootDir>/src/geo/$1',
    '^@navigation/(.*)$': '<rootDir>/src/navigation/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@react-navigation|react-native-.*|@supabase/.*|uuid)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.{ts,tsx}',
    '!src/core/api/supabase/database.types.ts',
  ],
  coverageThreshold: {
    // The geometry engine is the part that must never silently regress
    // (doc 03). Everything else grows into coverage as features land.
    'src/geo/**/*.ts': {statements: 85, branches: 80, functions: 90, lines: 85},
  },
};
