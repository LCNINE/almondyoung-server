import RouteGuard from '@/components/layout/route-guard';
import { BillingHistoryTemplate } from '@/features/membership/billing-history/template';

export default function MembershipBillingHistoryPage() {
  return (
    <RouteGuard screen="/membership/billing-history">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BillingHistoryTemplate />
      </div>
    </RouteGuard>
  );
}
