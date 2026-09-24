import {makeStyles} from '@core/theme/ThemeProvider';

/** The shared shape of every auth form: centred column, field, action stack. */
export const useAuthFormStyles = makeStyles(theme => ({
  container: {
    flex: 1,
    justifyContent: 'center',
    gap: theme.spacing.xl,
  },
  form: {
    gap: theme.spacing.md,
  },
  input: {
    minHeight: theme.layout.minTouchTarget,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    color: theme.colors.textPrimary,
    fontSize: theme.typography.body.fontSize,
  },
  actions: {
    gap: theme.spacing.sm,
  },
}));
