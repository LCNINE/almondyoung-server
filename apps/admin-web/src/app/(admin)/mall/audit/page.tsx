import RouteGuard from '@/components/layout/route-guard';
import AuditTemplate from '@/features/mall/audit/template';

export default function AuditPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <AuditTemplate />
      </div>
    </RouteGuard>
  );
}
