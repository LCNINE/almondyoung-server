import RouteGuard from '@/components/layout/route-guard';
import PrintInvoicesByOrderTemplate from '@/features/order/print-invoices-by-order/template';

export default function OrderPrintInvoicesByOrderPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <PrintInvoicesByOrderTemplate />
      </div>
    </RouteGuard>
  );
}
