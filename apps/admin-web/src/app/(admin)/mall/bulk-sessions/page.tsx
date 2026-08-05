import RouteGuard from '@/components/layout/route-guard';
import BulkSessionsTabs from '@/features/mall/bulk-sessions';

export default function BulkSessionsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BulkSessionsTabs />
      </div>
    </RouteGuard>
  );
}
