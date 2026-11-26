import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';

/** LocationRackResponseDto 중 라벨 화면이 쓰는 필드만. */
interface RackDto {
  id: string;
  rackNumber: number;
  column: { columnName: string };
}

export interface Rack {
  id: string;
  columnName: string;
  rackNumber: number;
}

/** 랙 표시 — `{열}-{랙 두 자리}` (예: A-07). */
export function rackLabelOf(rack: Rack): string {
  return `${rack.columnName}-${String(rack.rackNumber).padStart(2, '0')}`;
}

/** GET /locations/warehouses/:warehouseId/racks?isActive=true */
export function useRacks(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['racks', warehouseId],
    enabled: warehouseId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Rack[]> => {
      const racks = await api.request<RackDto[]>({
        path: `/locations/warehouses/${warehouseId}/racks?isActive=true`,
      });
      return racks.map((r) => ({ id: r.id, columnName: r.column.columnName, rackNumber: r.rackNumber }));
    },
  });
}

export interface RackLocations {
  codes: string[];
  total: number;
}

export function useRackLocations(warehouseId: string | null, rack: Rack | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['rack-locations', warehouseId, rack?.id],
    enabled: warehouseId !== null && rack !== undefined,
    queryFn: async (): Promise<RackLocations> => {
      const qs = new URLSearchParams({
        columnName: rack?.columnName ?? '',
        rackNumber: String(rack?.rackNumber ?? ''),
        isActive: 'true',
        isSystem: 'false',
        limit: '100',
      });
      const found = await api.request<{ items: { code: string }[]; total: number }>({
        path: `/locations/warehouses/${warehouseId}?${qs.toString()}`,
      });

      return { codes: found.items.map((i) => i.code), total: found.total };
    },
  });
}
