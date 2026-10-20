import RouteGuard from '@/components/layout/route-guard';
import ShippingGroupsTemplate from '@/features/mall/shipping-groups/shipping-groups-template';

export default function MallShippingGroupsPage() {
  return (
    <RouteGuard screen="/mall/shipping-groups">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ShippingGroupsTemplate />
      </div>
    </RouteGuard>
  );
}
