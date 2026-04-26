import RouteGuard from '@/components/layout/route-guard';
import TransferJobsTemplate from '@/features/inventory/transfers/template';

export default function InventoryTransfersPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <TransferJobsTemplate />
      </div>
    </RouteGuard>
  );
}
