import RouteGuard from '@/components/layout/route-guard';
import { BillingHistoryTemplate } from '@/features/membership/billing-history/template';

export default function MembershipBillingHistoryPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BillingHistoryTemplate />
      </div>
    </RouteGuard>
  );
}
