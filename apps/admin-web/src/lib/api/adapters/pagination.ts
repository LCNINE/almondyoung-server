// src/lib/api/adapters/pagination.ts
import type { PaginationProps } from '@/components/common/pagination';

interface PaginationMapping {
  totalKey?: string;
  pageKey?: string;
  limitKey?: string;
}

export function adaptPagination(
  res: any,
  mapping: PaginationMapping = {}
): Omit<PaginationProps, 'onPageChange' | 'onItemsPerPageChange'> {
  const { totalKey = 'total', pageKey = 'page', limitKey = 'limit' } = mapping;

  const totalItems = typeof res?.[totalKey] === 'number' ? res[totalKey] : 0;
  const currentPage = res?.[pageKey] ?? 1;
  const itemsPerPage = res?.[limitKey] ?? 20;
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return {
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
  };
}
