import { getTokenPayload } from '@/lib/auth/get-token-payload';
import { redirect } from 'next/navigation';

export default async function RouteGuard({
  children,
  requireRole,
}: {
  children: React.ReactNode;
  requireRole: string[];
}) {
  if (process.env.BYPASS_AUTH === 'true') {
    return <>{children}</>;
  }

  const payload = await getTokenPayload();

  if (!payload) {
    redirect('/login');
  }

  const hasRole = payload.roles.some((r) => requireRole.includes(r));

  if (!hasRole) {
    redirect('/unauthorized');
  }

  return <>{children}</>;
}
