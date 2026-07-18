import RouteGuard from '@/components/layout/route-guard';
import { SessionDetail } from '@/features/mall/product-imports/session-detail';

export default async function ProductImportSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SessionDetail sessionId={sessionId} />
      </div>
    </RouteGuard>
  );
}
