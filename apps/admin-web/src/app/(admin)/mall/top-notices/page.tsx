import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import TopNoticesTemplate from '@/features/mall/top-notices/template';

export default function TopNoticesPage() {
  return (
    <RouteGuard screen="/mall/top-notices">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <TopNoticesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
