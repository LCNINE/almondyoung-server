import RouteGuard from '@/components/layout/route-guard';
import { MembershipPlansTemplate } from '@/features/membership/plans/template';

export default function MembershipPlansPage() {
  return (
    <RouteGuard screen="/membership/plans">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MembershipPlansTemplate />
      </div>
    </RouteGuard>
  );
}
