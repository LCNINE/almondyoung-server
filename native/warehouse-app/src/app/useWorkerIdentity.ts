import { useEffect, useState } from 'react';
import type { WorkerIdentity } from '../core/auth/oidc';
import { useIsAuthenticated, useSession } from './session-context';

type IdentityState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; identity: WorkerIdentity }
  | { status: 'failed' };

/** 지금 로그인한 작업자. 세션이 로그인마다 한 번만 받아 오므로 여러 곳에서 써도 요청은 하나다. */
export function useWorkerIdentity(): IdentityState & { retry(): void } {
  const session = useSession();
  const authed = useIsAuthenticated();
  const [attempt, setAttempt] = useState(0);
  const [changes, setChanges] = useState(0);
  const [state, setState] = useState<IdentityState>({ status: 'none' });

  useEffect(() => session.subscribe(() => setChanges((n) => n + 1)), [session]);

  useEffect(() => {
    if (!authed || !session.identity) {
      setState({ status: 'none' });
      return;
    }
    let live = true;
    setState((current) =>
      current.status === 'ready' ? current : { status: 'loading' }
    );
    session.identity().then(
      (identity) => live && setState({ status: 'ready', identity }),
      () => live && setState({ status: 'failed' })
    );
    return () => {
      live = false;
    };
  }, [session, authed, attempt, changes]);

  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
