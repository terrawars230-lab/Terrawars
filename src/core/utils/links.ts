import {Linking, Platform} from 'react-native';

import {appInfo} from '@core/config/appInfo';
import {env} from '@core/config/env';
import {createLogger} from '@core/logger/logger';

const logger = createLogger('links');

/**
 * Opens a URL outside the app, reporting failure instead of throwing.
 *
 * `Linking.openURL` rejects when nothing can handle the URL — no browser, no
 * mail app — and an unhandled rejection from a settings row is a crash report
 * for something the user can do nothing about.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch (error) {
    logger.warn('Could not open an external URL', {error: String(error)});
    return false;
  }
}

/**
 * A `mailto:` link to support, pre-filled with the app version and platform so
 * a report arrives with the two facts every first reply would ask for.
 */
export function supportMailto(subject: string, body = ''): string {
  const diagnostics = `\n\n—\n${appInfo.name} ${appInfo.version} (${appInfo.buildNumber}) · ${Platform.OS} ${String(Platform.Version)}`;
  return (
    `mailto:${env.links.supportEmail}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body + diagnostics)}`
  );
}
