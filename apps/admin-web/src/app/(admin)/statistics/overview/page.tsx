import RouteGuard from '@/components/layout/route-guard';
import OverviewStatisticsTemplate from '@/features/statistics/template/overview';

export default function StatisticsOverviewPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <OverviewStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
