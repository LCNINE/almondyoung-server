import RouteGuard from '@/components/layout/route-guard';
import SkuGroupsTemplate from '@/features/inventory/sku-groups/template';

export default function InventorySkuGroupsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SkuGroupsTemplate />
      </div>
    </RouteGuard>
  );
}
