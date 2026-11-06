import type { TopNoticeListQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

const parseBool = (value: string | undefined): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return undefined;
};

export const useTopNoticesTableQuery = ({ prefix }: { prefix?: string } = {}) => {
  const queryObject = useQueryParams(['isActive', 'q'], prefix);

  const { isActive, q } = queryObject;

  const searchParams: TopNoticeListQuery = {
    includeInactive: true,
    isActive: parseBool(isActive),
    q: q?.trim() || undefined,
  };

  return { searchParams, raw: queryObject };
};
