import RouteGuard from '@/components/layout/route-guard';
import { IamTabs } from '@/features/iam/components/iam-tabs';
import { RoleList } from '@/features/iam/roles/role-list';

export default function RolesPage() {
  return (
    <RouteGuard screen="/users/roles">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <IamTabs current="roles" />
        <RoleList />
      </div>
    </RouteGuard>
  );
}
