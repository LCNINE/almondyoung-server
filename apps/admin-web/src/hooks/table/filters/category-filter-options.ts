import type { SelectableCategory } from '@/features/mall/products-detail/components/general/basic-information-model';
import type { FilterOption } from '@/components/data-table/data-table-filter/types';

/**
 * 평탄화된 카테고리 목록을 select 필터 옵션으로 변환한다.
 * label 은 `대분류 > 중분류` 형태의 전체 경로 — 카테고리명 자체에 `/` 가 들어가는
 * 경우가 있어 pathLabel 문자열을 쪼개지 않고 pathSegments 로 다시 잇는다.
 */
export function toCategoryFilterOptions(
  categories: SelectableCategory[]
): FilterOption[] {
  return categories.map((category) => ({
    label: category.pathSegments.join(' > '),
    value: category.id,
  }));
}
