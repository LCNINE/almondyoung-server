/** @format */

'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShippingBatch } from '@/features/order/print-invoices-by-order/schemas/print-invoices-by-order-filter.schema';
import PrintInvoicesByOrderTemplate from '@/features/order/print-invoices-by-order/template/PrintInvoicesByOrder';
import { useRouter } from 'next/navigation';

export default function CustomDialog({
  params,
}: {
  params: { shippingBatch: ShippingBatch; orderId: string };
}) {
  const router = useRouter();
  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogTitle>주문별 송장출력</DialogTitle>
      <DialogDescription>
        선택한 주문의 송장을 출력할 수 있습니다.
      </DialogDescription>

      <DialogContent className="!max-w-[95vw] !w-full !h-[90vh] p-4 overflow-hidden">
        <div className="h-full overflow-auto">
          <PrintInvoicesByOrderTemplate params={params} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
