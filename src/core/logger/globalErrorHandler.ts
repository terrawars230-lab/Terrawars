import {createLogger} from './logger';

/**
 * Routes errors nothing else caught into the logger — and through it, into
 * whatever crash reporter is attached (`setCrashReporter`).
 *
 * Two holes this closes:
 *
 *  - an exception thrown outside React's render (a timer, an event handler, a
 *    native callback) skips every ErrorBoundary. React Native's own handler
 *    still decides what happens next — a fatal error still ends the process, as
 *    it must — but it is recorded first;
 *  - in a release build a rejected promise nobody awaited vanishes without a
 *    trace. Hermes can report those; this asks it to.
 */

const logger = createLogger('global');

let installed = false;

interface HermesPromiseTracker {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

export function installGlobalErrorHandler(): void {
  if (installed) {
    return;
  }
  installed = true;

  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    logger.error(isFatal ? 'Fatal JavaScript error' : 'Unhandled JavaScript error', error, {
      isFatal: Boolean(isFatal),
    });
    previous(error, isFatal);
  });

  // Development already has LogBox watching promise rejections; replacing its
  // tracker would silence it. Release builds have nothing, so we add ours.
  const hermes = (globalThis as {HermesInternal?: HermesPromiseTracker}).HermesInternal;
  if (!__DEV__ && hermes?.enablePromiseRejectionTracker) {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, rejection) => {
        logger.error('Unhandled promise rejection', rejection);
      },
      onHandled: () => undefined,
    });
  }
}
