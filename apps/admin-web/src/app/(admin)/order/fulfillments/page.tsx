import RouteGuard from '@/components/layout/route-guard';
import FulfillmentsTemplate from '@/features/order/fulfillments/template';

export default function FulfillmentsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <FulfillmentsTemplate />
      </div>
    </RouteGuard>
  );
}
