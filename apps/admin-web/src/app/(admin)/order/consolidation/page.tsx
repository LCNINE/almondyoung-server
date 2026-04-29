import RouteGuard from '@/components/layout/route-guard';
import ConsolidationTemplate from '@/features/order/consolidation/template';

export default function ConsolidationPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ConsolidationTemplate />
      </div>
    </RouteGuard>
  );
}
