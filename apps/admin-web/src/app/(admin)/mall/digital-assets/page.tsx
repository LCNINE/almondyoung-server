import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import DigitalAssetsTemplate from '@/features/mall/digital-assets/template';

export default function DigitalAssetsPage() {
  return (
    <RouteGuard screen="/mall/digital-assets">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <DigitalAssetsTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
