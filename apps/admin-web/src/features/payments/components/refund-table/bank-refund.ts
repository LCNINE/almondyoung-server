import { walletApi } from '@/lib/api/domains/wallet';
import type { RefundDto, RefundListQuery } from '@/lib/types/dto/wallet';

export function isPendingBankRefund(refund: RefundDto) {
  return (
    refund.paymentMethodType === 'BANK_TRANSFER' &&
    refund.status === 'PENDING' &&
    refund.execution === 'MANUAL'
  );
}

export function canExecuteBankRefund(refund: RefundDto) {
  return (
    isPendingBankRefund(refund) ||
    (refund.paymentMethodType === 'BANK_TRANSFER' &&
      refund.status === 'FAILED' &&
      refund.execution === 'AUTO' &&
      refund.failureCode === 'PROVIDER_EXCEPTION')
  );
}

export async function listBankRefunds(query: RefundListQuery) {
  const refunds: RefundDto[] = [];
  let page = 1;
  let total: number;

  do {
    const result = await walletApi.listRefunds({ ...query, page, limit: 100 });

    refunds.push(...result.data);
    total = result.total;
    page += 1;

    if (result.data.length === 0) break;
  } while (refunds.length < total);

  return refunds.filter(
    (refund) => refund.paymentMethodType === 'BANK_TRANSFER'
  );
}
