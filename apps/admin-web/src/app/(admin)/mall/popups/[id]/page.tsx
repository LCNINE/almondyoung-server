import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import PopupDetailTemplate from '@/features/mall/popup-detail/template';

export default async function PopupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <PopupDetailTemplate id={id} />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
