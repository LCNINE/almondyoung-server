import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useMoveStock } from './useMoveStock';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function harness() {
  const request = vi.fn(
    async (_o: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => ({})
  );
  const client: ApiClient = { request: request as unknown as ApiClient['request'] };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { request, invalidate, wrapper };
}

describe('useMoveStock', () => {
  it('라인 1개 배치와 멱등 헤더를 보내고 캐시를 무효화한다', async () => {
    const { request, invalidate, wrapper } = harness();
    const { result } = renderHook(() => useMoveStock(), { wrapper });

    await result.current.mutateAsync({
      warehouseId: 'w-1',
      skuId: 's1',
      fromLocationId: 'l-1',
      toLocationId: 'l-2',
      quantity: 5,
      reason: '재배치',
      idempotencyKey: 'k1',
    });

    const call = request.mock.calls[0][0];
    expect(call.path).toBe('/movement/move');
    expect(call.method).toBe('POST');
    expect(call.idempotencyKey).toBe('k1');
    expect(call.body).toEqual({
      warehouseId: 'w-1',
      idempotencyKey: 'k1',
      lines: [
        { skuId: 's1', fromLocationId: 'l-1', toLocationId: 'l-2', quantity: 5, memo: '재배치' },
      ],
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('location-contents'))).toBe(true);
    expect(keys.some((k) => k.includes('sku-warehouse-stock'))).toBe(true);
    expect(keys.some((k) => k.includes('sku-stock-summary'))).toBe(true);
  });

  it('사유가 없으면 memo 를 보내지 않는다', async () => {
    const { request, wrapper } = harness();
    const { result } = renderHook(() => useMoveStock(), { wrapper });

    await result.current.mutateAsync({
      warehouseId: 'w-1',
      skuId: 's1',
      fromLocationId: 'l-1',
      toLocationId: 'l-2',
      quantity: 3,
      idempotencyKey: 'k2',
    });

    const call = request.mock.calls[0][0] as { body: { lines: Array<{ memo?: string }> } };
    expect(call.body.lines[0].memo).toBeUndefined();
  });
});
