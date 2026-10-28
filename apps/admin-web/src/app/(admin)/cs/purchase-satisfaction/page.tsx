import RouteGuard from '@/components/layout/route-guard';
import PurchaseSatisfactionTemplate from '@/features/cs/purchase-satisfaction/template';

export default function PurchaseSatisfactionPage() {
  return (
    <RouteGuard screen="/cs/purchase-satisfaction">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PurchaseSatisfactionTemplate />
      </div>
    </RouteGuard>
  );
}
