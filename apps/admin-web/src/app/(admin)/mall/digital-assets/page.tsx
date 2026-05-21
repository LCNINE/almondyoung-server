import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import DigitalAssetsTemplate from '@/features/mall/digital-assets/template';

export default function DigitalAssetsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <DigitalAssetsTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
