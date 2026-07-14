import { useMemo } from 'react';
import type { Filter } from '@/components/data-table';
import { useCategoryTree } from '@/lib/services/products/queries';
import { flattenCategoryTree } from '@/features/mall/products-detail/components/general/basic-information-model';
import { toCategoryFilterOptions } from './category-filter-options';

export function useProductsListTableFilters(): Filter[] {
  const { data: categoryTree } = useCategoryTree({ includeInactive: true });

  const categoryOptions = useMemo(
    () =>
      toCategoryFilterOptions(
        flattenCategoryTree(categoryTree?.categories ?? [])
      ),
    [categoryTree?.categories]
  );

  return [
    // GET /masters 는 status 필터 대신 mode 를 노출한다.
    {
      key: 'mode',
      label: '판매 상태',
      type: 'select',
      options: [
        { label: '판매중', value: 'active' },
        { label: '판매중단 포함', value: 'active-or-inactive' },
        { label: '작성중(임시) 포함', value: 'all' },
      ],
    },
    {
      key: 'categoryId',
      label: '카테고리',
      type: 'select',
      searchable: true,
      options: categoryOptions,
    },
    {
      key: 'brand',
      label: '브랜드',
      type: 'string',
    },
    {
      key: 'productType',
      label: '상품 유형',
      type: 'select',
      options: [
        { label: '정상판매', value: 'regular_sale' },
        { label: '한정판', value: 'limited_edition' },
      ],
    },
    {
      key: 'approvalStatus',
      label: '승인 상태',
      type: 'select',
      options: [
        { label: '임시저장', value: 'draft' },
        { label: '승인대기', value: 'pending' },
        { label: '승인완료', value: 'approved' },
        { label: '반려', value: 'rejected' },
      ],
    },
    {
      key: 'createdAt',
      label: '등록일',
      type: 'date',
    },
  ];
}
