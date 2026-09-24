import {useCallback, useEffect, useState} from 'react';

/**
 * A countdown that disables an action for a while after it is used.
 *
 * For "send the email again" buttons: Supabase's mailer is rate-limited per
 * address and per project, and a user tapping resend five times in ten seconds
 * burns that limit and then gets EMAIL_RATE_LIMITED for an hour.
 */
export function useCooldown(seconds: number): {remaining: number; start: () => void} {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null) {
      return;
    }
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) {
        setEndsAt(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  const start = useCallback(() => {
    const current = Date.now();
    setNow(current);
    setEndsAt(current + seconds * 1000);
  }, [seconds]);

  const remaining = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  return {remaining, start};
}
