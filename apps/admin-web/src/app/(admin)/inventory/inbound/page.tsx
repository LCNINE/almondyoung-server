import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import InboundTemplate from '@/features/inventory/inbound/template';

export default function InventoryInboundPage() {
  return (
    <RouteGuard screen="/inventory/inbound">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <InboundTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
