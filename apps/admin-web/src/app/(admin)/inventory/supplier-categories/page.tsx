import RouteGuard from '@/components/layout/route-guard';
import SupplierCategoriesTemplate from '@/features/inventory/supplier-categories/template';

export default function InventorySupplierCategoriesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SupplierCategoriesTemplate />
      </div>
    </RouteGuard>
  );
}
