const path = require('node:path');

const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration.
 * https://reactnative.dev/docs/metro
 *
 * ── Path aliases ──────────────────────────────────────────────────────────
 *
 * The `@core/…`, `@features/…` etc. aliases are declared in THREE places, and
 * this is the third: tsconfig.json for the compiler, babel.config.js for the
 * transform, and here for Metro's resolver.
 *
 * Metro resolution is deliberately duplicated rather than left to
 * babel-plugin-module-resolver alone. That plugin rewrites the import specifier
 * during the Babel transform, and Metro caches transform output — so after
 * babel.config.js changes, a stale cache entry can still hold the ORIGINAL
 * unrewritten specifier and Metro fails with:
 *
 *     Unable to resolve module @app/providers/AppProviders
 *
 * even though the config is correct. The fix is then `--reset-cache`, which is
 * a miserable thing to have to know. Resolving here as well means Metro
 * understands the alias natively and the build works with a cold or a stale
 * cache either way.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */

const ALIASES = {
  '@app': path.resolve(__dirname, 'src/app'),
  '@core': path.resolve(__dirname, 'src/core'),
  '@components': path.resolve(__dirname, 'src/components'),
  '@features': path.resolve(__dirname, 'src/features'),
  '@geo': path.resolve(__dirname, 'src/geo'),
  '@navigation': path.resolve(__dirname, 'src/navigation'),
  '@services': path.resolve(__dirname, 'src/services'),
  // Listed last: `@/` is a prefix of nothing else, but keeping it at the end
  // makes the longest-match-first intent obvious to the next reader.
  '@': path.resolve(__dirname, 'src'),
};

const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      for (const [alias, target] of Object.entries(ALIASES)) {
        // Match `@core/foo` and bare `@core`, but never `@core-utils` — an npm
        // package whose name merely starts with an alias must still resolve to
        // node_modules.
        if (moduleName === alias || moduleName.startsWith(`${alias}/`)) {
          const rest = moduleName.slice(alias.length);
          return context.resolveRequest(context, path.join(target, rest), platform);
        }
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
