import { useQuery } from '@tanstack/react-query';
import { usePermissionCheck } from '@/hooks/use-permission';
import { walletQueryKeys } from '@/lib/services/wallet';
import type { RefundDto } from '@/lib/types/dto/wallet';
import {
  isPendingBankRefund,
  listBankRefunds,
} from '@/features/payments/components/refund-table/bank-refund';
import type { OrderLineRow } from './use-order-rows';

export function bankRefundsForRow(row: OrderLineRow, refunds: RefundDto[]) {
  if (
    !row.isFirstOfOrder ||
    row.channel !== 'medusa' ||
    (row.orderStatus !== 'cancelled' && !row.cancelRequest)
  )
    return [];

  return refunds.filter(
    (refund) =>
      refund.intentId === row.walletIntentId &&
      refund.paymentMethodType === 'BANK_TRANSFER' &&
      (isPendingBankRefund(refund) || refund.status === 'SUCCEEDED')
  );
}

export function useOrderBankRefunds(rows: OrderLineRow[]) {
  const { can } = usePermissionCheck();
  const intentIds = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.isFirstOfOrder &&
            row.channel === 'medusa' &&
            (row.orderStatus === 'cancelled' || row.cancelRequest)
        )
        .flatMap((row) => (row.walletIntentId ? [row.walletIntentId] : []))
    ),
  ].sort();
  const requestIds = rows
    .filter((row) => row.isFirstOfOrder && row.cancelRequest)
    .map((row) => row.cancelRequest!.id)
    .sort();
  const query = { intentIds };

  return useQuery({
    queryKey: [
      ...walletQueryKeys.refundList(query),
      'bank-account',
      requestIds,
    ],
    queryFn: () => listBankRefunds(query),
    enabled: intentIds.length > 0 && can(['payment.refund.read']),
    retry: false,
    refetchInterval: (query) =>
      query.state.dataUpdateCount + query.state.errorUpdateCount < 5
        ? 1500
        : 60_000,
  });
}
