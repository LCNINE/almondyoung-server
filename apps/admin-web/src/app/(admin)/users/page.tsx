import RouteGuard from '@/components/layout/route-guard';
import UserListTemplate from '@/features/users/template';

export default function UsersPage() {
  return (
    <RouteGuard
      requireRole={['admin', 'master']}
      requiredScope={['admin:users:read']}
    >
      <UserListTemplate />
    </RouteGuard>
  );
}
