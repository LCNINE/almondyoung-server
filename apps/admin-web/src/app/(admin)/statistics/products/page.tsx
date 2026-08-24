import RouteGuard from '@/components/layout/route-guard';
import ProductStatisticsTemplate from '@/features/statistics/template/products';

export default function StatisticsProductsPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProductStatisticsTemplate />
      </div>
    </RouteGuard>
  );
}
