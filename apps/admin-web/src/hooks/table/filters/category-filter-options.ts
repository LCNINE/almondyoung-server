import type { SelectableCategory } from '@/features/mall/products-detail/components/general/basic-information-model';
import type { FilterOption } from '@/components/data-table/data-table-filter/types';

/** 평탄화된 카테고리 목록을 select 필터 옵션으로 변환한다. label 은 전체 경로(pathLabel). */
export function toCategoryFilterOptions(
  categories: SelectableCategory[]
): FilterOption[] {
  return categories.map((category) => ({
    label: category.pathLabel,
    value: category.id,
  }));
}
