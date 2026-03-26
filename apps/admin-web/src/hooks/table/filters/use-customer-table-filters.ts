import type { Filter } from '@/components/data-table';

export function useCustomerTableFilters(): Filter[] {
  // 현재 백엔드에서 hasShop 필터를 지원하지 않음
  // 추후 백엔드 지원 시 필터 추가 가능
  return [];
}
