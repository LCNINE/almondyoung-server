import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import PurchaseOrdersTemplate from '@/features/inventory/purchase-orders/template';

export default function InventoryPurchaseOrdersPage() {
  return (
    <RouteGuard screen="/inventory/purchase-orders">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <PurchaseOrdersTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
