import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useLocationContents } from './useLocationContents';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useLocationContents', () => {
  it('locationId 로 GET 경로를 만들고 응답을 준다', async () => {
    const request = vi.fn(async (_o: { path: string }) => ({
      locationId: 'l-1',
      locationCode: 'A-01-02',
      warehouseId: 'w-1',
      items: [{ skuId: 's1', skuCode: 'C1', skuName: '상품1', stockState: 'ON_HAND', quantity: 12 }],
    }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => useLocationContents('l-1'), { wrapper: wrapperWith(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/stocks/location/l-1');
    expect(result.current.data?.items[0].skuCode).toBe('C1');
  });

  it('locationId 가 없으면 요청하지 않는다', () => {
    const request = vi.fn(async () => ({}));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    renderHook(() => useLocationContents(undefined), { wrapper: wrapperWith(client) });
    expect(request).not.toHaveBeenCalled();
  });
});
