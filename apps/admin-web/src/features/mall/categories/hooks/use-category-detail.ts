'use client';

import { useQuery } from '@tanstack/react-query';
import { products } from '@/lib/api/domains';
import { productQueryKeys } from '@/lib/services/products/query-keys';
import type { CategoryDetailDto } from '../types';

/**
 * `GET /categories/:id` 의 detail 응답을 로컬 타입으로 받는다.
 * 글로벌 `CategoryDto` 가 `productCount` / `totalProductCount` 를 누락하고 있어서
 * 본 feature 안에서만 정밀 타입을 부여한다.
 */
export function useCategoryDetail(id: string | null) {
  return useQuery({
    queryKey: productQueryKeys.category(id ?? ''),
    queryFn: async () => {
      const res = await products.categories.get(id!);
      return res as unknown as CategoryDetailDto;
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}
