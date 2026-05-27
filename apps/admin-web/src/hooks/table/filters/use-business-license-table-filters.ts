import type { Filter } from '@/components/data-table';
import {
  BUSINESS_LICENSE_STATUS_LABELS,
  BUSINESS_LICENSE_STATUS_LIST,
} from '@/lib/types/dto/business-licenses';

export function useBusinessLicenseTableFilters(): Filter[] {
  return [
    {
      key: 'status',
      label: '상태',
      type: 'select',
      options: BUSINESS_LICENSE_STATUS_LIST.map((status) => ({
        label: BUSINESS_LICENSE_STATUS_LABELS[status],
        value: status,
      })),
    },
    {
      key: 'hasVerificationFile',
      label: '파일 첨부',
      type: 'select',
      options: [
        { label: '있음', value: 'true' },
        { label: '없음', value: 'false' },
      ],
    },
  ];
}
