import RouteGuard from '@/components/layout/route-guard';
import PickingListTemplate from '@/features/order/picking-list/template';

export default function OrderPickingListPage() {
  return (
    <RouteGuard screen="/order/picking-list">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PickingListTemplate />
      </div>
    </RouteGuard>
  );
}
