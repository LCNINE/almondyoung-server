import RouteGuard from '@/components/layout/route-guard';
import StocktakingTemplate from '@/features/inventory/stocktaking/template';

export default function InventoryStocktakingPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <StocktakingTemplate />
      </div>
    </RouteGuard>
  );
}
