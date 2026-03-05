/** @format */

import { ShippingBatch } from '@/features/order/print-invoices-by-order/schemas/print-invoices-by-order-filter.schema';
import PrintInvoicesByOrderTemplate from '@/features/order/print-invoices-by-order/template/PrintInvoicesByOrder';
import CustomDialog from './(components)/CustomDialog';
import RouteGuard from '@/components/layout/route-guard';

// 주문별 송장출력페이지
export default async function OrderPrintInvoicesByOrderPage({
  searchParams,
}: {
  searchParams: Promise<{
    shippingBatch: ShippingBatch;
    orderId: string;
    modal: string;
  }>;
}) {
  const params = await searchParams;

  const isModal = params.modal === 'true';

  if (isModal) {
    return (
      <RouteGuard
        requireRole={['admin', 'master']}
        requiredScope={['admin:access', 'master']}
      >
        <CustomDialog params={params} />
      </RouteGuard>
    );
  }

  return (
    <RouteGuard
      requireRole={['admin', 'master']}
      requiredScope={['admin:access', 'master']}
    >
      <PrintInvoicesByOrderTemplate params={params} />
    </RouteGuard>
  );
}
