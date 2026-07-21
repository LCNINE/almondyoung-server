import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useIsAuthenticated } from '../session-context';
import { LoginScreen } from './LoginScreen';

export function LoginRoute() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  useEffect(() => {
    if (authed) navigate({ to: '/' });
  }, [authed, navigate]);
  return <LoginScreen />;
}
