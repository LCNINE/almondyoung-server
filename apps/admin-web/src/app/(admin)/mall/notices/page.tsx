import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import NoticesTemplate from '@/features/mall/notices/template';

export default function NoticesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <NoticesTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
