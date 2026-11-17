import type { RefundDto } from '@/lib/types/dto/wallet';
import { BankRefundButton } from '@/features/payments/components/refund-table/bank-refund-button';
import { RefundConfirmCell } from '@/features/payments/components/refund-table/confirm-cell';
import { isPendingBankRefund } from '@/features/payments/components/refund-table/bank-refund';

export function OrderBankRefundCard({ refund }: { refund: RefundDto }) {
  const pending = isPendingBankRefund(refund);

  if (
    !pending &&
    !(
      refund.paymentMethodType === 'BANK_TRANSFER' &&
      refund.status === 'SUCCEEDED'
    )
  )
    return null;

  return (
    <div className="rounded border border-gray-200 p-2 space-y-2 min-w-36">
      <div className="flex justify-between gap-2 text-xs">
        <span>환불</span>
        <strong>{refund.amount.toLocaleString('ko-KR')}원</strong>
      </div>
      <span
        className={`inline-flex rounded px-2 py-1 text-xs ${pending ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'}`}
      >
        {pending ? '환불 계좌 필요' : '환불 완료'}
      </span>
      {pending && (
        <div className="flex flex-col items-center gap-1">
          <BankRefundButton refund={refund} primary />
          {refund.manualConfirmable && (
            <RefundConfirmCell refund={refund} label="직접 송금했어요" />
          )}
        </div>
      )}
    </div>
  );
}
