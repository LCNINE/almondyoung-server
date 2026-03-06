import { serverUserApi } from '@/lib/api/domains/users/server-user';
import { UserScope } from '@/lib/types/dto/scopes';
import { redirect } from 'next/navigation';

export default async function RouteGuard({
  children,
  requireRole,
  requiredScope,
}: {
  children: React.ReactNode;
  requireRole: string[];
  requiredScope: UserScope[];
}) {
  // const user = await serverUserApi.getMe();
  // const roles = await serverUserApi.getMyRoles();

  // const hasRole = roles?.roles.some((r) => requireRole?.includes(r.role.name));

  // const hasScope = roles?.roles.some((r) =>
  //   requiredScope.includes(r.scopes.scope_name as UserScope)
  // );

  // 권한이 없으면 unauthorized 페이지로 리다이렉트
  // if (!hasRole || !hasScope) {
  //   redirect('/unauthorized');
  // }

  return <>{children}</>;
}
