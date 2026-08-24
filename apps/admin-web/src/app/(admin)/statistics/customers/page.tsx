import RouteGuard from '@/components/layout/route-guard';
import CustomerStatisticsTemplate from '@/features/statistics/template/customers';

export default function StatisticsCustomersPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <CustomerStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
