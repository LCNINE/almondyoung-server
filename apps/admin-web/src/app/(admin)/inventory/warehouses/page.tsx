import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import WarehousesTemplate from '@/features/inventory/warehouses/template';

export default function Page() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <WarehousesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
