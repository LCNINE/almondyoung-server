import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import AlmondTemplatesTemplate from '@/features/mall/almond-templates/template';

export default function AlmondTemplatesPage() {
  return (
    <RouteGuard screen="/mall/almond-templates">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <AlmondTemplatesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
