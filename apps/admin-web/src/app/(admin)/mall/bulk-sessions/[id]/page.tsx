import RouteGuard from '@/components/layout/route-guard';
import BulkSessionDetail from '@/features/mall/bulk-sessions/session-detail';

export default async function BulkSessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <RouteGuard screen="/mall/bulk-sessions/[id]">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BulkSessionDetail sessionId={id} />
      </div>
    </RouteGuard>
  );
}
