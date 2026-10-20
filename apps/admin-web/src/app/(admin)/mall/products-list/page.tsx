import RouteGuard from '@/components/layout/route-guard';
import ProductsListTemplate from '@/features/mall/products-list/template';

export default function ProductsListPage() {
  return (
    <RouteGuard screen="/mall/products-list">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ProductsListTemplate />
      </div>
    </RouteGuard>
  );
}
