import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import BannerGroupsTemplate from '@/features/mall/banner-groups/template';

export default function BannerGroupsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <BannerGroupsTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
