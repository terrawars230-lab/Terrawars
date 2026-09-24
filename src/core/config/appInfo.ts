import appJson from '../../../app.json';

/**
 * The release identity of this build.
 *
 * app.json is the single source: android/app/build.gradle reads `version` and
 * `buildNumber` from it for versionName/versionCode, and this module reads the
 * same file for the settings footer and support emails. iOS keeps its own
 * MARKETING_VERSION / CURRENT_PROJECT_VERSION in the Xcode project — the
 * release checklist (docs/RELEASE.md) covers bumping both together.
 */
export const appInfo = {
  name: appJson.displayName,
  version: appJson.version,
  buildNumber: appJson.buildNumber,
} as const;
