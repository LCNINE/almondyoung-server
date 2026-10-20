import RouteGuard from '@/components/layout/route-guard';
import InventoryStatusTemplate from '@/features/inventory/status/template';

export default function InventoryStatusPage() {
  return (
    <RouteGuard screen="/inventory/status">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <InventoryStatusTemplate />
      </div>
    </RouteGuard>
  );
}
