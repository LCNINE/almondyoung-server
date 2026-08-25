import RouteGuard from '@/components/layout/route-guard';
import TrafficStatisticsTemplate from '@/features/statistics/template/traffic';

export default function StatisticsTrafficPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <TrafficStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
