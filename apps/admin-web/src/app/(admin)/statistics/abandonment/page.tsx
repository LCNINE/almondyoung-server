import RouteGuard from '@/components/layout/route-guard';
import AbandonmentStatisticsTemplate from '@/features/statistics/template/abandonment';

export default function StatisticsAbandonmentPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <AbandonmentStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
