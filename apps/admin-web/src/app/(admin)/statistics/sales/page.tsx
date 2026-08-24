import RouteGuard from '@/components/layout/route-guard';
import SalesStatisticsTemplate from '@/features/statistics/template/sales';

export default function StatisticsSalesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <SalesStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
