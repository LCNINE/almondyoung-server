import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useSkuByBarcode } from './useSkuByBarcode';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useSkuByBarcode', () => {
  it('mutateAsync 로 바코드를 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => []);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync('8801234567890');

    expect(request.mock.calls[0][0].path).toBe('/inventory/skus?barcode=8801234567890');
  });

  it('스캔마다 독립적으로 요청한다 — 캐시를 공유하지 않는다', async () => {
    // 같은 바코드를 다시 mutate 해도 항상 새 네트워크 요청을 만든다. useQuery
    // 였다면 staleTime/재활성화 시점에 따라 두 번째 호출이 캐시된 결과로
    // 갈음될 수 있었다 — 스캔은 매번 독립적으로 처리돼야 하므로 이 성질이 핵심이다.
    const request = vi.fn(async (_opts: { path: string }) => []);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode(), { wrapper: wrapperFor(client) });

    await result.current.mutateAsync('8801234567890');
    await result.current.mutateAsync('8801234567890');

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('mutate 호출별 onSuccess 콜백에서 그 호출의 결과를 정확히 한 번 받는다', async () => {
    const hit = { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', currentStock: 1, safetyStock: 0 };
    const request = vi.fn(async (_opts: { path: string }) => [hit]);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode(), { wrapper: wrapperFor(client) });

    const onSuccess = vi.fn();
    result.current.mutate('8801234567890', { onSuccess });

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0][0]).toEqual([hit]);
  });
});
