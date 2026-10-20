import RouteGuard from '@/components/layout/route-guard';
import SuppliersTemplate from '@/features/inventory/suppliers/template';

export default function InventorySuppliersPage() {
  return (
    <RouteGuard screen="/inventory/suppliers">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SuppliersTemplate />
      </div>
    </RouteGuard>
  );
}
