import { useEffect, useState } from 'react';
import type { Session } from '../core/auth/session';

/** Runs the one-time silent session restore behind a splash before children
 * (the router) mount, so route guards read a settled auth state. */
export function Bootstrap({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    session.bootstrap().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [session]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Almond WMS…
      </div>
    );
  }
  return <>{children}</>;
}
