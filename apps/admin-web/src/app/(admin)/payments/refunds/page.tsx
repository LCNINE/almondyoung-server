import RouteGuard from '@/components/layout/route-guard';
import RefundListTemplate from '@/features/payments/template/refund-list-template';

export default function RefundsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <RefundListTemplate />
      </div>
    </RouteGuard>
  );
}
