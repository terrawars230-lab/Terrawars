import {ApiError} from '@core/api/ApiError';
import {
  requestAccountDeletion,
  resendConfirmationEmail,
  setUsername,
  signUpWithEmail,
  verifyPasswordResetOtp,
  verifySignUpOtp,
} from '@features/auth/api/authApi';

/**
 * The signup write path (FR-02, FR-01).
 *
 * Two behaviours here are easy to regress and expensive when they go:
 *
 *  - a sign-up that returns no session is a *pending confirmation*, not a
 *    failure. Reporting it as either "signed in" or "error" leaves the user
 *    with no idea the account exists;
 *  - `set_username` returns doc 05 §7 rejections as a 200 carrying an error
 *    envelope. Reading only `error` from the Supabase response treats "that
 *    name is taken" as a success and dismisses the username gate.
 */

jest.mock('@core/api/supabase/client', () => ({
  supabase: {
    auth: {
      signUp: jest.fn(),
      resend: jest.fn(),
      verifyOtp: jest.fn(),
      signOut: jest.fn(),
    },
    rpc: jest.fn(),
  },
}));

const {supabase} = jest.requireMock('@core/api/supabase/client') as {
  supabase: {
    auth: {signUp: jest.Mock; resend: jest.Mock; verifyOtp: jest.Mock; signOut: jest.Mock};
    rpc: jest.Mock;
  };
};

const credentials = {email: '  Walker@Example.com ', password: 'correct-horse'};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('signUpWithEmail', () => {
  it('normalises the address before sending it', async () => {
    supabase.auth.signUp.mockResolvedValue({data: {session: null, user: null}, error: null});

    await signUpWithEmail(credentials);

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'walker@example.com',
      password: 'correct-horse',
    });
  });

  it('reports a missing session as a pending confirmation, not a failure', async () => {
    supabase.auth.signUp.mockResolvedValue({data: {session: null, user: {id: 'u1'}}, error: null});

    await expect(signUpWithEmail(credentials)).resolves.toEqual({
      session: null,
      needsEmailConfirmation: true,
    });
  });

  it('passes a session straight through when confirmation is off', async () => {
    const session = {user: {id: 'u1'}};
    supabase.auth.signUp.mockResolvedValue({data: {session}, error: null});

    await expect(signUpWithEmail(credentials)).resolves.toEqual({
      session,
      needsEmailConfirmation: false,
    });
  });
});

describe('resendConfirmationEmail', () => {
  it('resends against the normalised address', async () => {
    supabase.auth.resend.mockResolvedValue({error: null});

    await resendConfirmationEmail('  Walker@Example.com ');

    expect(supabase.auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'walker@example.com',
    });
  });
});

describe('verifyPasswordResetOtp', () => {
  it('verifies as a recovery code and returns the session', async () => {
    const session = {user: {id: 'u1'}};
    supabase.auth.verifyOtp.mockResolvedValue({data: {session}, error: null});

    await expect(verifyPasswordResetOtp(' Walker@Example.com ', ' 123456 ')).resolves.toBe(session);
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'walker@example.com',
      token: '123456',
      type: 'recovery',
    });
  });

  it('rejects when the code verifies but no session comes back', async () => {
    // A resolved call with no session would otherwise be read as success and
    // send the user to a password form with nothing signed in behind it.
    supabase.auth.verifyOtp.mockResolvedValue({data: {session: null}, error: null});

    await expect(verifyPasswordResetOtp('walker@example.com', '123456')).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});

describe('setUsername', () => {
  it('claims the name through the RPC, never a table write', async () => {
    supabase.rpc.mockResolvedValue({data: {username: 'pathfinder'}, error: null});

    await expect(setUsername(' PathFinder ')).resolves.toBe('pathfinder');
    expect(supabase.rpc).toHaveBeenCalledWith('set_username', {p_username: 'pathfinder'});
  });

  it('throws USERNAME_TAKEN from an error envelope on a 200', async () => {
    supabase.rpc.mockResolvedValue({
      data: {error: {code: 'USERNAME_TAKEN', message: 'That name is taken'}},
      error: null,
    });

    await expect(setUsername('pathfinder')).rejects.toMatchObject({code: 'USERNAME_TAKEN'});
  });

  it('throws USERNAME_ALREADY_SET when the name was chosen on another device', async () => {
    supabase.rpc.mockResolvedValue({
      data: {error: {code: 'USERNAME_ALREADY_SET', message: 'Already chosen'}},
      error: null,
    });

    await expect(setUsername('pathfinder')).rejects.toMatchObject({
      code: 'USERNAME_ALREADY_SET',
    });
  });

  it('surfaces a transport failure as an ApiError', async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: {code: '42501', message: 'permission denied', details: '', hint: ''},
    });

    await expect(setUsername('pathfinder')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('verifySignUpOtp', () => {
  it('confirms the account with the emailed code and returns the session', async () => {
    const session = {user: {id: 'u1'}};
    supabase.auth.verifyOtp.mockResolvedValue({data: {session}, error: null});

    await expect(verifySignUpOtp(' Walker@Example.com ', ' 654321 ')).resolves.toBe(session);
    // 'email' covers sign-up confirmation of an unconfirmed address.
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      email: 'walker@example.com',
      token: '654321',
      type: 'email',
    });
  });

  it('rejects a code that verifies without producing a session', async () => {
    supabase.auth.verifyOtp.mockResolvedValue({data: {session: null}, error: null});

    await expect(verifySignUpOtp('walker@example.com', '654321')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('requestAccountDeletion', () => {
  it('signs out once the deletion is recorded', async () => {
    supabase.rpc.mockResolvedValue({
      data: {status: 'deletion_requested', grace_period_days: 7},
      error: null,
    });
    supabase.auth.signOut.mockResolvedValue({error: null});

    await requestAccountDeletion();

    expect(supabase.rpc).toHaveBeenCalledWith('request_account_deletion');
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('does not report success, or sign out, when the server refused', async () => {
    // FR-06: a user told "deleted" whose data was never queued for deletion is
    // the worst outcome this button can have.
    supabase.rpc.mockResolvedValue({
      data: {error: {code: 'UNAUTHENTICATED', message: 'Sign in required'}},
      error: null,
    });

    await expect(requestAccountDeletion()).rejects.toMatchObject({code: 'UNAUTHENTICATED'});
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
