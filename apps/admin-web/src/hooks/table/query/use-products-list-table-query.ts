import type { MastersQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';
import { parseDateRangeParam } from './date-range-param';

type UseProductsListTableQueryProps = {
  pageSize?: number;
};

export const useProductsListTableQuery = ({
  pageSize = 20,
}: UseProductsListTableQueryProps = {}) => {
  const queryObject = useQueryParams([
    'page',
    'q',
    'categoryId',
    'brand',
    'status',
    'mode',
    'productType',
    'approvalStatus',
    'createdAt',
    'sort',
    'order',
    'stock',
  ]);

  const {
    page,
    q,
    categoryId,
    brand,
    status,
    mode,
    productType,
    approvalStatus,
    createdAt,
    sort,
    order,
    stock,
  } = queryObject;

  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

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
    approvalStatus:
      approvalStatus === 'draft' ||
      approvalStatus === 'pending' ||
      approvalStatus === 'approved' ||
      approvalStatus === 'rejected'
        ? approvalStatus
        : undefined,
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

  return { searchParams, raw: queryObject };
};
