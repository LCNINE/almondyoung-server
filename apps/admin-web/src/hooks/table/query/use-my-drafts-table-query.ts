import type { MyDraftsQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseMyDraftsTableQueryProps = {
  pageSize?: number;
};

export const useMyDraftsTableQuery = ({
  pageSize = 20,
}: UseMyDraftsTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'q', 'sort', 'order']);
  const { page, q, sort, order } = queryObject;

  const searchParams: MyDraftsQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q: q?.trim() || undefined,
    sort: sort === 'updatedAt' || sort === 'createdAt' ? sort : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
  };

  return { searchParams, raw: queryObject };
};
