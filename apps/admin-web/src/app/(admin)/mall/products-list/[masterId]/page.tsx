import RouteGuard from '@/components/layout/route-guard';
import ProductsDetailTemplate from '@/features/mall/products-detail/template';

export default async function ProductsDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ masterId: string }>;
  searchParams: Promise<{ versionId?: string }>;
}) {
  const { masterId } = await params;
  const { versionId } = await searchParams;
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProductsDetailTemplate
          masterId={masterId}
          versionId={versionId ?? null}
        />
      </div>
    </RouteGuard>
  );
}
