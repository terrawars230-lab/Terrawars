/**
 * Babel configuration.
 *
 * `module-resolver` mirrors the `paths` map in tsconfig.json. Keep the two in
 * sync — TypeScript resolves the types, Babel resolves the runtime require.
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],
        extensions: [
          '.ios.ts',
          '.android.ts',
          '.ts',
          '.ios.tsx',
          '.android.tsx',
          '.tsx',
          '.jsx',
          '.js',
          '.json',
        ],
        alias: {
          '@': './src',
          '@app': './src/app',
          '@core': './src/core',
          '@components': './src/components',
          '@features': './src/features',
          '@geo': './src/geo',
          '@navigation': './src/navigation',
          '@services': './src/services',
        },
      },
    ],
  ],
};
