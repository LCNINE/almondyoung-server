import { useQueryParams } from '../../use-query-params';
import type { MatchingsQuery, MatchingStatus } from '@/lib/types/dto/matching';

const PAGE_SIZE = 20;

type UseVariantsMatchingTableQueryProps = {
  pageSize?: number;
};

export const useVariantsMatchingTableQuery = ({
  pageSize = PAGE_SIZE,
}: UseVariantsMatchingTableQueryProps = {}) => {
  const raw = useQueryParams(['page', 'status']);

  const { page, status } = raw;

  const searchParams: MatchingsQuery = {
    limit: pageSize,
    offset: page ? (Number(page) - 1) * pageSize : 0,
    status: (status as MatchingStatus) || undefined,
  };

  return { searchParams, raw, pageSize };
};
