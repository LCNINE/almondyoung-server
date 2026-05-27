import RouteGuard from '@/components/layout/route-guard';
import RecurringBillingTemplate from '@/features/membership/recurring-billing/template';

export default function RecurringBillingPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <RecurringBillingTemplate />
      </div>
    </RouteGuard>
  );
}
