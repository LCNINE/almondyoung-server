import RouteGuard from '@/components/layout/route-guard';
import PaymentListCard from '@/features/payments/template';

export default function PaymentsPage() {
  return (
    <RouteGuard screen="/payments">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PaymentListCard />
      </div>
    </RouteGuard>
  );
}
