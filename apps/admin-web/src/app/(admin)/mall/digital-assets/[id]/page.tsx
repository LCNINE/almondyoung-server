import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import DigitalAssetDetailTemplate from '@/features/mall/digital-assets/template/detail';

export default async function DigitalAssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <DigitalAssetDetailTemplate id={id} />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
