import { AdminRecurringBillingListQuery } from '@/lib/types/dto/wallet';
import { useQueryParams } from '../../use-query-params';

export const useRecurringBillingTableQuery = (pageSize = 20) => {
  const {
    page,
    view,
    dateType,
    dateFrom,
    dateTo,
    cmsMemberStatus,
    withdrawalStatus,
    userId,
    contractId,
    cmsMemberId,
    transactionId,
    paymentIntentId,
  } = useQueryParams([
    'page',
    'view',
    'dateType',
    'dateFrom',
    'dateTo',
    'cmsMemberStatus',
    'withdrawalStatus',
    'userId',
    'contractId',
    'cmsMemberId',
    'transactionId',
    'paymentIntentId',
  ]);

  const query: AdminRecurringBillingListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    view: (view as AdminRecurringBillingListQuery['view']) ?? 'needs-action',
    dateType: (dateType as AdminRecurringBillingListQuery['dateType']) ?? 'updatedAt',
    dateFrom,
    dateTo,
    cmsMemberStatus: cmsMemberStatus as AdminRecurringBillingListQuery['cmsMemberStatus'],
    withdrawalStatus: withdrawalStatus as AdminRecurringBillingListQuery['withdrawalStatus'],
    userId,
    contractId,
    cmsMemberId,
    transactionId,
    paymentIntentId,
  };

  return query;
};
