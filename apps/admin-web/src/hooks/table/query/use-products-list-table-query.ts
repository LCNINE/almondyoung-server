import type { MastersQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';
import { parseDateRangeParam } from './date-range-param';
import {
  parsePageSize,
  DEFAULT_PAGE_SIZE,
} from '@/features/mall/products-list/components/table/products-list-page-size-model';

type UseProductsListTableQueryProps = {
  /** URL 에 size 가 없을 때 쓰는 기본값. URL 값이 있으면 그게 이긴다. */
  pageSize?: number;
};

export const useProductsListTableQuery = ({
  pageSize: fallbackPageSize = DEFAULT_PAGE_SIZE,
}: UseProductsListTableQueryProps = {}) => {
  const queryObject = useQueryParams([
    'page',
    'q',
    'categoryId',
    'brand',
    'status',
    'mode',
    'productType',
    'createdAt',
    'createdBy',
    'supplierId',
    'sort',
    'order',
    'stock',
    'size',
  ]);

  const {
    page,
    q,
    categoryId,
    brand,
    status,
    mode,
    productType,
    createdAt,
    createdBy,
    supplierId,
    sort,
    order,
    stock,
    size,
  } = queryObject;

  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const pageSize = size ? parsePageSize(size) : fallbackPageSize;

  const searchParams: MastersQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q: q?.trim() || undefined,
    categoryId,
    brand,
    status:
      status === 'active' || status === 'inactive' || status === 'draft'
        ? status
        : undefined,
    mode:
      status === 'inactive'
        ? 'active-or-inactive'
        : status === 'draft'
          ? 'all'
          : mode === 'active' || mode === 'active-or-inactive' || mode === 'all'
            ? mode
            : undefined,
    productType:
      productType === 'regular_sale' || productType === 'limited_edition'
        ? productType
        : undefined,
    createdBy: createdBy || undefined,
    supplierId: supplierId || undefined,
    createdFrom,
    createdTo,
    sort:
      sort === 'createdAt' || sort === 'name' || sort === 'updatedAt'
        ? sort
        : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
    stock:
      stock === 'in_stock' || stock === 'partial' || stock === 'sold_out'
        ? stock
        : undefined,
  };

  return { searchParams, pageSize, raw: queryObject };
};
