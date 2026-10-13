import RouteGuard from '@/components/layout/route-guard';
import StoreRegionsTemplate from '@/features/store-regions/store-regions-template';

export default function MallRegionsPage() {
  return (
    <RouteGuard screen="/mall/regions">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <StoreRegionsTemplate />
      </div>
    </RouteGuard>
  );
}
