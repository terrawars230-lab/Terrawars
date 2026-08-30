import React from 'react';

import {AppProviders} from '@app/providers/AppProviders';
import {RootNavigator} from '@navigation/RootNavigator';

/**
 * Application root.
 *
 * Deliberately thin: everything with a lifecycle lives in `AppProviders`, and
 * everything with a route lives in `RootNavigator`. Keeping this file trivial
 * is what makes it obvious where new global concerns belong.
 */
export default function App(): React.JSX.Element {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
