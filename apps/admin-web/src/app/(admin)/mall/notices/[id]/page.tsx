import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import NoticeDetailTemplate from '@/features/mall/notice-detail/template';

export default async function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <NoticeDetailTemplate id={id} />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
