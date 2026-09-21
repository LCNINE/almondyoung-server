import RouteGuard from '@/components/layout/route-guard';
import SmsBulkTemplate from '@/features/messages/bulk/template';

export default function SmsBulkPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SmsBulkTemplate />
      </div>
    </RouteGuard>
  );
}
