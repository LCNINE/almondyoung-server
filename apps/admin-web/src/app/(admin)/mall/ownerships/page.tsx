import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import OwnershipsTemplate from '@/features/mall/ownerships/template';

export default function OwnershipsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <OwnershipsTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
