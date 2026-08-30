import React, {Component, type ErrorInfo, type PropsWithChildren, type ReactNode} from 'react';

import {View} from 'react-native';

import {createLogger} from '@core/logger/logger';
import {makeStyles} from '@core/theme/ThemeProvider';

import {Button} from './Button';
import {Text} from './Text';

const logger = createLogger('error-boundary');

interface Props extends PropsWithChildren {
  /** Shown instead of the default recovery UI. */
  fallback?: (reset: () => void) => ReactNode;
  /** Identifies which boundary tripped, e.g. "map" or "walk". */
  scope?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-phase crashes and offers a way back.
 *
 * Placed around the whole app AND around the map and walk subtrees
 * individually. That granularity matters here: a crash in the map renderer
 * during an active walk must not take down the walk recorder with it. The
 * recording lives in a store and on disk (FR-15), so remounting the map is a
 * recoverable event rather than a lost walk.
 *
 * Class component because React still offers no hook equivalent of
 * `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Render error', error, {
      scope: this.props.scope ?? 'root',
      componentStack: info.componentStack,
    });
  }

  private reset = (): void => {
    this.setState({error: null});
  };

  override render(): ReactNode {
    const {error} = this.state;
    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(this.reset);
    }

    return <DefaultErrorFallback onReset={this.reset} />;
  }
}

/**
 * The fallback deliberately shows no error text.
 *
 * A stack trace tells the user nothing and can leak internals; the detail is in
 * the log and the crash reporter. Copy is hardcoded English here on purpose —
 * this is the one place that must render even if i18n is what failed to
 * initialise.
 */
function DefaultErrorFallback({onReset}: {onReset: () => void}): React.JSX.Element {
  const styles = useStyles();

  return (
    <View style={styles.root}>
      <Text variant="title2" align="center">
        Something went wrong
      </Text>
      <Text variant="body" color="textSecondary" align="center">
        Your walks and territory are safe. Try again.
      </Text>
      <Button label="Try again" onPress={onReset} fullWidth={false} />
    </View>
  );
}

const useStyles = makeStyles(theme => ({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.background,
  },
}));
