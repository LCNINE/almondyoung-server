import { ReviewListQuery } from '@/lib/types/dto/review';
import { useQueryParams } from '../../use-query-params';
import { parseDateRangeParam } from './date-range-param';

type UseReviewTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useReviewTableQuery = ({
  prefix,
  pageSize = 20,
}: UseReviewTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'status', 'rating', 'hasComment', 'productId', 'sort', 'order', 'createdAt'],
    prefix
  );

  const { page, q, status, rating, hasComment, productId, sort, createdAt } = queryObject;
  const { from: createdFrom, to: createdTo } = parseDateRangeParam(createdAt);

  const searchParams: ReviewListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    status: status as ReviewListQuery['status'],
    rating: rating as ReviewListQuery['rating'],
    hasComment: hasComment as ReviewListQuery['hasComment'],
    productId,
    sort: sort as ReviewListQuery['sort'],
    createdFrom,
    createdTo,
  };

  return { searchParams, raw: queryObject };
};
