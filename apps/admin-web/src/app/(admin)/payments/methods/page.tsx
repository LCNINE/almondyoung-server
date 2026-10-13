import RouteGuard from '@/components/layout/route-guard';
import PaymentMethodCatalogTemplate from '@/features/payment-config/catalog-template';

export default function PaymentMethodsPage() {
  return (
    <RouteGuard screen="/payments/methods">
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PaymentMethodCatalogTemplate />
      </div>
    </RouteGuard>
  );
}
