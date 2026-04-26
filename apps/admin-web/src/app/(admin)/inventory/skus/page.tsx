import RouteGuard from '@/components/layout/route-guard';
import SkusTemplate from '@/features/inventory/skus/template';

export default function InventorySkusPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SkusTemplate />
      </div>
    </RouteGuard>
  );
}
