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

  const { page, q, source, category, status, order, createdAt } = queryObject;
  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const searchParams: QnaListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    source: source as QnaListQuery['source'],
    category: category as QnaListQuery['category'],
    status: status as QnaListQuery['status'],
    // ugc 는 작성일 정렬만 latest/oldest 로 받는다 — 테이블의 order(asc/desc)를 옮긴다
    sort: order === 'asc' ? 'oldest' : 'latest',
    createdFrom,
    createdTo,
  };

  return { searchParams, raw: queryObject };
};
