import { ReviewListQuery } from '@/lib/types/dto/review';
import { useQueryParams } from '../../use-query-params';

type UseReviewTableQueryProps = {
  prefix?: string;
  pageSize?: number;
};

export const useReviewTableQuery = ({
  prefix,
  pageSize = 20,
}: UseReviewTableQueryProps) => {
  const queryObject = useQueryParams(
    ['page', 'q', 'status', 'rating', 'hasComment', 'productId', 'sort', 'order'],
    prefix
  );

  const { page, q, status, rating, hasComment, productId, sort } = queryObject;

  const searchParams: ReviewListQuery = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    q,
    status: status as ReviewListQuery['status'],
    rating: rating as ReviewListQuery['rating'],
    hasComment: hasComment as ReviewListQuery['hasComment'],
    productId,
    sort: sort as ReviewListQuery['sort'],
  };

  return { searchParams, raw: queryObject };
};
