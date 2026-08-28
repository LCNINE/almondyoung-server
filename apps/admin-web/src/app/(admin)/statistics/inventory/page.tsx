import RouteGuard from '@/components/layout/route-guard';
import InventoryStatisticsTemplate from '@/features/statistics/template/inventory';

export default function StatisticsInventoryPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <InventoryStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
