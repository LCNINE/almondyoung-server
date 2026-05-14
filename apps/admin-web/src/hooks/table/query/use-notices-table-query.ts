import type { NoticeListQuery } from '@/lib/types/dto/products';
import { useQueryParams } from '../../use-query-params';

type UseNoticesTableQueryProps = {
  prefix?: string;
};

const parseBool = (value: string | undefined): boolean | undefined => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

export const useNoticesTableQuery = ({
  prefix,
}: UseNoticesTableQueryProps = {}) => {
  const queryObject = useQueryParams(
    ['category', 'isActive', 'isPinned', 'badge', 'q'],
    prefix
  );

  const { category, isActive, isPinned, badge, q } = queryObject;

  const searchParams: NoticeListQuery = {
    includeInactive: true,
    category: category || undefined,
    isActive: parseBool(isActive),
    isPinned: parseBool(isPinned),
    badge: badge || undefined,
    q: q?.trim() || undefined,
  };

  return { searchParams, raw: queryObject };
};
