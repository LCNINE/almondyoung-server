import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import WarehouseCreateTemplate from '@/features/inventory/warehouses/template/create';

export default function WarehouseCreatePage() {
  return (
    <RouteGuard screen="/inventory/warehouses/new">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <WarehouseCreateTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
