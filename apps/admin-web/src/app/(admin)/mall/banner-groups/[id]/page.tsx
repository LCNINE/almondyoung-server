import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import BannerGroupDetailTemplate from '@/features/mall/banner-group-detail/template';

export default async function BannerGroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RouteGuard screen="/mall/banner-groups/[id]">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <BannerGroupDetailTemplate id={id} />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
