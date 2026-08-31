import RouteGuard from '@/components/layout/route-guard';
import ProductDiagnosisTemplate from '@/features/statistics/template/product-diagnosis';

export default async function StatisticsProductDiagnosisPage({
  params,
}: {
  params: Promise<{ masterId: string }>;
}) {
  const { masterId } = await params;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProductDiagnosisTemplate masterId={decodeURIComponent(masterId)} />
      </div>
    </RouteGuard>
  );
}
