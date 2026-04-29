import RouteGuard from '@/components/layout/route-guard';
import DirectShipTemplate from '@/features/order/direct-ship/template';

export default function DirectShipPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <DirectShipTemplate />
      </div>
    </RouteGuard>
  );
}
