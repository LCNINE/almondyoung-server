import RouteGuard from '@/components/layout/route-guard';
import ProductVersionsTreeTemplate from '@/features/mall/product-versions-tree/template';

export default async function ProductVersionsTreePage({
  params,
  searchParams,
}: {
  params: Promise<{ masterId: string }>;
  searchParams: Promise<{ versionId?: string }>;
}) {
  const { masterId } = await params;
  const { versionId } = await searchParams;
  return (
    <RouteGuard screen="/mall/products-list/[masterId]/versions">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProductVersionsTreeTemplate
          masterId={masterId}
          currentVersionId={versionId ?? null}
        />
      </div>
    </RouteGuard>
  );
}
