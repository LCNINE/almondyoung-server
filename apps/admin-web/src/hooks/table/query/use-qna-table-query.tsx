import { QnaListQuery } from '@/lib/types/dto/qna';
import { useQueryParams } from '../../use-query-params';
import { parseDateRangeParam } from './date-range-param';

type UseQnaTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useQnaTableQuery = ({
  prefix,
  pageSize = 20,
}: UseQnaTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'category', 'status', 'sort', 'order', 'createdAt'],
    prefix
  );

  const { page, q, category, status, sort, createdAt } = queryObject;
  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const searchParams: QnaListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    category: category as QnaListQuery['category'],
    status: status as QnaListQuery['status'],
    sort: sort as QnaListQuery['sort'],
    createdFrom,
    createdTo,
  };

  return { searchParams, raw: queryObject };
};
