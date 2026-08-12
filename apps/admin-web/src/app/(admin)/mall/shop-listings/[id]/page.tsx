import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import ShopListingEditorTemplate from '@/features/mall/shop-listings/template/editor';

export default async function ShopListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <ShopListingEditorTemplate id={id} />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
