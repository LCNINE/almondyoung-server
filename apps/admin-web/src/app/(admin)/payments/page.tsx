import RouteGuard from '@/components/layout/route-guard';
import PaymentListTemplate from '@/features/payments/template';

export default function PaymentsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PaymentListTemplate />
      </div>
    </RouteGuard>
  );
}
