import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import ShopListingEditorTemplate from '@/features/mall/shop-listings/template/editor';

export default function ShopListingCreatePage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <ShopListingEditorTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
