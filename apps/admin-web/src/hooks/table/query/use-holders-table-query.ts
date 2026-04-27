import { useQueryParams } from '../../use-query-params';
import type { HolderFiltersDto } from '@/lib/types/dto/inventory';

type UseHoldersTableQueryProps = {
  pageSize?: number;
};

export const useHoldersTableQuery = ({ pageSize = 20 }: UseHoldersTableQueryProps = {}) => {
  const queryObject = useQueryParams(['page', 'search', 'isOurAsset']);

  const { page, search, isOurAsset } = queryObject;

  const searchParams: HolderFiltersDto = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    search: search || undefined,
    isOurAsset: isOurAsset !== undefined ? isOurAsset === 'true' : undefined,
  };

  return { searchParams, raw: queryObject };
};
