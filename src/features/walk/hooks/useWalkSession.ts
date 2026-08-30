import {useCallback, useEffect, useRef, useState} from 'react';

import {useQuery} from '@tanstack/react-query';

import {queryKeys} from '@core/constants/queryKeys';
import {createLogger} from '@core/logger/logger';
import {cachedGameConfig, fetchGameConfig} from '@features/settings/api/gameConfigApi';

import {adoptRestoredWalk, useWalkStore, type PersistedWalk} from '../store/walkStore';

/**
 * Owns the lifecycle of the walk screen: start a new walk, or offer to resume
 * an interrupted one.
 *
 * This exists because FR-15 makes crash recovery a requirement, not a nicety:
 * "On relaunch the user is offered to resume or discard the interrupted walk."
 * The store already persists every sample; this is the piece that reads it back
 * and asks.
 *
 * It also pulls the live `game_config` before recording begins, so the advisory
 * preview is measured against the server's current tunables rather than the
 * launch defaults compiled into the app (CLAUDE.md rule 7).
 */

const logger = createLogger('walk-session');

export type SessionState =
  /** Checking storage for an interrupted walk. */
  | {status: 'checking'}
  /** FR-15: an interrupted walk was found; the user must resume or discard. */
  | {status: 'recovery-offer'; startedAt: number; sampleCount: number}
  /** Starting a fresh walk on the server. */
  | {status: 'starting'}
  | {status: 'recording'}
  | {status: 'failed'; error: unknown};

export interface UseWalkSession {
  state: SessionState;
  /** Adopts the interrupted walk and continues recording it. */
  resumeInterrupted: () => Promise<void>;
  /** Discards the interrupted walk and starts a fresh one. */
  discardAndStartFresh: () => Promise<void>;
  /** Retries after a failed start. */
  retry: () => Promise<void>;
}

export function useWalkSession(start: () => Promise<void>): UseWalkSession {
  const [state, setState] = useState<SessionState>({status: 'checking'});
  const interrupted = useRef<PersistedWalk | null>(null);

  // The live tunables. `cachedGameConfig()` gives the previous successful fetch
  // (or the launch defaults) so a cold offline start still previews sensibly.
  const {data: config} = useQuery({
    queryKey: queryKeys.gameConfig,
    queryFn: fetchGameConfig,
    staleTime: 5 * 60_000,
    initialData: cachedGameConfig,
  });

  const setConfig = useWalkStore(store => store.setConfig);
  useEffect(() => {
    if (config) {
      setConfig(config);
    }
  }, [config, setConfig]);

  const beginFresh = useCallback(async () => {
    setState({status: 'starting'});
    try {
      await start();
      setState({status: 'recording'});
    } catch (error) {
      logger.error('Could not start the walk', error);
      setState({status: 'failed', error});
    }
  }, [start]);

  // Runs once on mount. Either there is an interrupted walk to offer, or we
  // start a new one immediately — the user already pressed "Start walk" and
  // granted permission, so a second confirmation would be friction.
  const hasRun = useRef(false);
  useEffect(() => {
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    // Already recording (a remount from a rotation or a navigation) — do not
    // start a second walk on top of the running one.
    const {phase} = useWalkStore.getState();
    if (phase === 'recording' || phase === 'paused') {
      setState({status: 'recording'});
      return;
    }

    const restored = useWalkStore.getState().restoreFromDisk();
    if (restored && restored.samples.length > 0) {
      interrupted.current = restored;
      logger.info('Found an interrupted walk', {sampleCount: restored.samples.length});
      setState({
        status: 'recovery-offer',
        startedAt: restored.startedAt,
        sampleCount: restored.samples.length,
      });
      return;
    }

    void beginFresh();
  }, [beginFresh]);

  const resumeInterrupted = useCallback(async () => {
    const restored = interrupted.current;
    if (!restored) {
      await beginFresh();
      return;
    }

    // Adopted in the PAUSED phase: the user has to press resume, which is what
    // re-arms the native tracker. Silently resuming would start recording
    // before they have looked at the screen.
    adoptRestoredWalk(restored, config ?? cachedGameConfig());
    interrupted.current = null;
    setState({status: 'recording'});
  }, [beginFresh, config]);

  const discardAndStartFresh = useCallback(async () => {
    useWalkStore.getState().reset();
    interrupted.current = null;
    await beginFresh();
  }, [beginFresh]);

  return {state, resumeInterrupted, discardAndStartFresh, retry: beginFresh};
}
