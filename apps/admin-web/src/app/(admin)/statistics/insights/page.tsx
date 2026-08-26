import RouteGuard from '@/components/layout/route-guard';
import CustomerInsightsTemplate from '@/features/statistics/template/insights';

export default function StatisticsInsightsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CustomerInsightsTemplate />
      </div>
    </RouteGuard>
  );
}
