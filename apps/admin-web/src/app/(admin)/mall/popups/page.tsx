import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import PopupsTemplate from '@/features/mall/popups/template';

export default function PopupsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <PopupsTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
