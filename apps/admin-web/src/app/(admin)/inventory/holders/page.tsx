import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import HoldersTemplate from '@/features/inventory/holders/template';

export default function Page() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <HoldersTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
