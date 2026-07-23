import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useAdjustStock } from './useAdjustStock';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

describe('useAdjustStock', () => {
  it('조정 body 와 멱등 헤더를 함께 보낸다', async () => {
    const request = vi.fn(
      async (_opts: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => ({})
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

    const { result } = renderHook(() => useAdjustStock(), { wrapper });

    await result.current.mutateAsync({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
      idempotencyKey: 'key-1',
    });

    const call = request.mock.calls[0][0];
    expect(call.path).toBe('/inventory/stocks/adjust');
    expect(call.method).toBe('POST');
    expect(call.idempotencyKey).toBe('key-1');
    expect(call.body).toEqual({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
      idempotencyKey: 'key-1',
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('sku-warehouse-stock'))).toBe(true);
    expect(keys.some((k) => k.includes('sku-stock-summary'))).toBe(true);
  });
});
