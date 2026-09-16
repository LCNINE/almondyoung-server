import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkRuntime } from './OperationContext';

export type WorkReadiness =
  | { status: 'signed_out' }
  | { status: 'checking_scope' }
  | { status: 'restoring'; scope: string }
  | { status: 'ready'; scope: string }
  | {
      status: 'failed';
      step: 'scope' | 'restore' | 'retry';
      message: string;
    };

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useWorkReadiness(
  runtime: WorkRuntime,
  authenticated: boolean
): {
  state: WorkReadiness;
  recheck(): Promise<void>;
} {
  const owner = useMemo(
    () => ({ runtime, authenticated }),
    [runtime, authenticated]
  );
  const ownerRef = useRef(owner);
  useLayoutEffect(() => {
    ownerRef.current = owner;
  }, [owner]);
  const generationRef = useRef(0);
  const flightRef = useRef<
    | {
        owner: object;
        generation: number;
        promise: Promise<void>;
      }
    | undefined
  >(undefined);
  const [stored, setStored] = useState<{ owner: object; state: WorkReadiness }>(
    () => ({
      owner,
      state: authenticated
        ? { status: 'checking_scope' }
        : { status: 'signed_out' },
    })
  );

  const check = useCallback(
    (retry: boolean): Promise<void> => {
      if (ownerRef.current !== owner) return Promise.resolve();
      if (!authenticated) {
        setStored({ owner, state: { status: 'signed_out' } });
        return Promise.resolve();
      }
      const running = flightRef.current;
      if (running?.owner === owner) return running.promise;

      const generation = ++generationRef.current;
      const current = () =>
        ownerRef.current === owner && generationRef.current === generation;
      let promise!: Promise<void>;
      promise = (async () => {
        let step: 'scope' | 'restore' | 'retry' = 'scope';
        try {
          setStored({ owner, state: { status: 'checking_scope' } });
          const scope = await runtime.getScope();
          if (!current()) return;
          setStored({ owner, state: { status: 'restoring', scope } });
          step = 'restore';
          await runtime.runner.restore();
          if (!current()) return;
          if (retry) {
            step = 'retry';
            await runtime.runner.retryPending();
            if (!current()) return;
          }
          step = 'scope';
          const latestScope = await runtime.getScope();
          if (!current()) return;
          if (latestScope !== scope)
            throw new Error('로그인을 다시 확인해 주세요.');
          setStored({ owner, state: { status: 'ready', scope } });
        } catch (error) {
          if (!current()) return;
          setStored({
            owner,
            state: { status: 'failed', step, message: failureMessage(error) },
          });
        }
      })().finally(() => {
        if (flightRef.current?.promise === promise)
          flightRef.current = undefined;
      });
      flightRef.current = { owner, generation, promise };
      return promise;
    },
    [authenticated, owner, runtime]
  );

  useEffect(() => {
    void check(false);
    return () => {
      if (ownerRef.current === owner) generationRef.current += 1;
      if (flightRef.current?.owner === owner) flightRef.current = undefined;
    };
  }, [check, owner]);

  const recheck = useCallback(() => check(true), [check]);

  return {
    state:
      stored.owner === owner
        ? stored.state
        : authenticated
          ? { status: 'checking_scope' }
          : { status: 'signed_out' },
    recheck,
  };
}
