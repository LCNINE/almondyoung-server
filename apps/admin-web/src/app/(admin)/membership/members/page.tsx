import RouteGuard from '@/components/layout/route-guard';
import MembershipMemberListTemplate from '@/features/membership/members/template';

export default function MembershipMembersPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MembershipMemberListTemplate />
      </div>
    </RouteGuard>
  );
}
