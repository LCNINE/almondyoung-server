import RouteGuard from '@/components/layout/route-guard';
import { IamTabs } from '@/features/iam/components/iam-tabs';
import { StaffList } from '@/features/iam/staff/staff-list';

export default function UsersPage() {
  return (
    <RouteGuard screen="/users">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <IamTabs current="staff" />
        <StaffList />
      </div>
    </RouteGuard>
  );
}
