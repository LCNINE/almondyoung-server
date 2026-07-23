import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useSkuDetail, useSkuStockSummary, useSkuWarehouseStock } from './useSkuDetail';

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

function stubClient() {
  const request = vi.fn(async (_opts: { path: string }) => ({}));
  return { request, client: { request: request as unknown as ApiClient['request'] } };
}

describe('inventory detail hooks', () => {
  it('useSkuDetail 은 SKU 상세 경로를 부른다', async () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuDetail('sku-1'), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/skus/sku-1');
  });

  it('useSkuStockSummary 는 stock-summary 경로를 부른다', async () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuStockSummary('sku-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/skus/sku-1/stock-summary');
  });

  it('useSkuWarehouseStock 은 sku×창고 경로를 부른다', async () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuWarehouseStock('sku-1', 'w-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/stocks/sku/sku-1/warehouse/w-1');
  });

  it('useSkuWarehouseStock 은 창고가 없으면 호출하지 않는다', () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuWarehouseStock('sku-1', null), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
