import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../data/ApiClientProvider';
import { useWorkRuntime, type WorkCapabilities } from './OperationContext';
export function useCapabilityReader() {
  const runtime = useWorkRuntime();
  const api = useApiClient();
  return async (): Promise<WorkCapabilities> => {
    if (runtime)
      return runtime.getCapabilities ? runtime.getCapabilities() : {};
    const context = await api.request<{ capabilities?: WorkCapabilities }>({
      path: '/inventory/work-context',
    });
    return context.capabilities ?? {};
  };
}
export function useWorkCapabilities() {
  const read = useCapabilityReader();
  return useQuery({
    queryKey: ['work-capabilities'],
    queryFn: read,
    staleTime: 0,
    retry: false,
  });
}
