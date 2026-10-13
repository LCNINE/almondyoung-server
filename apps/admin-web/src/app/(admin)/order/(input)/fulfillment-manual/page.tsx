import RouteGuard from '@/components/layout/route-guard';
import { ManualCreateForm } from '@/features/order/fulfillments/components/manual-create-form';

export default function FulfillmentManualPage() {
  return (
    <RouteGuard screen="/order/fulfillment-manual">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <ManualCreateForm />
      </div>
    </RouteGuard>
  );
}
