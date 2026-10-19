import RouteGuard from '@/components/layout/route-guard';
import { IamTabs } from '@/features/iam/components/iam-tabs';
import { RoleEditor } from '@/features/iam/roles/role-editor';

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard screen="/users/roles/[id]">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <IamTabs current="roles" />
        <RoleEditor roleId={id} />
      </div>
    </RouteGuard>
  );
}
