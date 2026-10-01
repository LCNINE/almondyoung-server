import RouteGuard from '@/components/layout/route-guard';
import GrowthStatisticsTemplate from '@/features/statistics/template/growth';

export default function StatisticsGrowthPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <GrowthStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
