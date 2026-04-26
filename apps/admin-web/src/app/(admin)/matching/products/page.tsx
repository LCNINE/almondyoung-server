import RouteGuard from '@/components/layout/route-guard';
import ProductsMatchingTemplate from '@/features/matching/products/template';

export default function ProductsMatchingPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProductsMatchingTemplate />
      </div>
    </RouteGuard>
  );
}
