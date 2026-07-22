import { useEffect } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useIsAuthenticated } from '../session-context';

export function AuthedLayout() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  // beforeLoad gates entry; this effect handles a live logout / refresh
  // failure while an authenticated screen is already mounted.
  useEffect(() => {
    if (!authed) navigate({ to: '/login' });
  }, [authed, navigate]);
  return <Outlet />;
}
