import { useQueryParams } from '../../use-query-params';
import type { LocationFiltersDto, LocationType } from '@/lib/types/dto/inventory';

type UseLocationsTableQueryProps = {
  pageSize?: number;
};

export const useLocationsTableQuery = ({ pageSize = 20 }: UseLocationsTableQueryProps = {}) => {
  const queryObject = useQueryParams([
    'page',
    'search',
    'type',
    'columnName',
    'rackNumber',
    'isActive',
    'sortBy',
    'sortOrder',
    'warehouseId',
  ]);

  const { page, search, type, columnName, rackNumber, isActive, sortBy, sortOrder, warehouseId } =
    queryObject;

  const searchParams: LocationFiltersDto = {
    limit: pageSize,
    page: page ? Number(page) : 1,
    search: search || undefined,
    type: (type as LocationType) || undefined,
    columnName: columnName || undefined,
    rackNumber: rackNumber ? Number(rackNumber) : undefined,
    isActive: isActive !== undefined && isActive !== '' ? isActive === 'true' : undefined,
    sortBy: sortBy || undefined,
    sortOrder: (sortOrder as 'asc' | 'desc') || undefined,
  };

  return { searchParams, raw: queryObject, warehouseId: warehouseId ?? '' };
};
