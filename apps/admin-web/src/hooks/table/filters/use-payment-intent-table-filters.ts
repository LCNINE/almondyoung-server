import type { Filter } from '@/components/data-table';

export function usePaymentIntentTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: [
        { label: '생성', value: 'CREATED' },
        { label: '처리중', value: 'PROCESSING' },
        { label: '액션필요', value: 'REQUIRES_ACTION' },
        { label: '승인', value: 'AUTHORIZED' },
        { label: '성공', value: 'SUCCEEDED' },
        { label: '매입', value: 'CAPTURED' },
        { label: '취소', value: 'CANCELED' },
        { label: '실패', value: 'FAILED' },
        { label: '만료', value: 'EXPIRED' },
        { label: '정산대기', value: 'PENDING_SETTLEMENT' },
      ],
    },
    {
      key: 'paymentMethodType',
      label: '결제수단',
      type: 'select',
      options: [
        { label: '토스페이먼츠', value: 'TOSS' },
        { label: '토스 빌링', value: 'TOSS_BILLING' },
        { label: 'CMS 자동이체', value: 'CMS_BATCH' },
        { label: '포인트', value: 'POINTS' },
        { label: '무통장입금', value: 'BANK_TRANSFER' },
      ],
    },
  ];
}
