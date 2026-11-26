import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { fetchMyReturnBin } from './returnBinApi';

export const MY_RETURN_BIN_KEY = 'my-return-bin';

export function useMyReturnBin(warehouseId: string | null) {
  const api = useApiClient();

  return useQuery({
    queryKey: [MY_RETURN_BIN_KEY, warehouseId],
    enabled: warehouseId !== null,
    refetchOnMount: 'always',
    queryFn: () => fetchMyReturnBin(api, warehouseId ?? ''),
  });
}
