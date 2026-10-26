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
    ['page', 'q', 'source', 'category', 'status', 'sort', 'order', 'createdAt'],
    prefix
  );

  const { page, q, source, category, status, sort, order, createdAt } =
    queryObject;
  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const searchParams: QnaListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    source: source as QnaListQuery['source'],
    category: category as QnaListQuery['category'],
    status: status as QnaListQuery['status'],
    // 정렬을 고르지 않으면 답변 대기 먼저, 고르면 작성일 order(asc/desc)를 latest/oldest 로 옮긴다
    sort: !sort ? 'pending_first' : order === 'asc' ? 'oldest' : 'latest',
    createdFrom,
    createdTo,
  };

  return { searchParams, raw: queryObject };
};
