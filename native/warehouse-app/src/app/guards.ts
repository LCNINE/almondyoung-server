import { redirect } from '@tanstack/react-router';

type SessionLike = { isAuthenticated(): boolean };

/** Route guard for the authenticated area: bounce anonymous users to /login. */
export function requireAuth(session: SessionLike): void {
  if (!session.isAuthenticated()) throw redirect({ to: '/login' });
}

/** Reverse guard for /login: send already-authenticated users to the home. */
export function requireAnon(session: SessionLike): void {
  if (session.isAuthenticated()) throw redirect({ to: '/' });
}
