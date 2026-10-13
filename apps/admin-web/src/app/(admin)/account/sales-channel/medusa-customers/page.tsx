import RouteGuard from '@/components/layout/route-guard';
import MedusaCustomerListTemplate from '@/features/medusa-customers/template';

export default function MedusaCustomersPage() {
  return (
    <RouteGuard screen="/account/sales-channel/medusa-customers">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <MedusaCustomerListTemplate />
      </div>
    </RouteGuard>
  );
}
