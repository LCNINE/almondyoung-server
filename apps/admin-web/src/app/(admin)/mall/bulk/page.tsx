import RouteGuard from '@/components/layout/route-guard';
import BulkTemplate from '@/features/mall/bulk/template';

export default function BulkPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <BulkTemplate />
      </div>
    </RouteGuard>
  );
}
