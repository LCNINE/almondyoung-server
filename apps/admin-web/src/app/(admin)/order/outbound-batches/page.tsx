import RouteGuard from '@/components/layout/route-guard';
import OutboundBatchesTemplate from '@/features/order/outbound-batches/template';

export default function OutboundBatchesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <OutboundBatchesTemplate />
      </div>
    </RouteGuard>
  );
}
