import { QnaListQuery } from '@/lib/types/dto/qna';
import { useQueryParams } from '../../use-query-params';

type UseQnaTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useQnaTableQuery = ({
  prefix,
  pageSize = 20,
}: UseQnaTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'category', 'status', 'sort', 'order'],
    prefix
  );

  const { page, q, category, status, sort, order } = queryObject;

  const searchParams: QnaListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    category: category as QnaListQuery['category'],
    status: status as QnaListQuery['status'],
    sort: sort as QnaListQuery['sort'],
  };

  return { searchParams, raw: queryObject };
};
