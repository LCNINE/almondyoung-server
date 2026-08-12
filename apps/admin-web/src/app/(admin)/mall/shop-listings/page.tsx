import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import ShopListingsTemplate from '@/features/mall/shop-listings/template';

export default function ShopListingsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <ShopListingsTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
