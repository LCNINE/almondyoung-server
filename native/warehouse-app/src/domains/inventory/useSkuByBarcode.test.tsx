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
  it('barcode 쿼리로 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => []);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode('8801234567890'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/skus?barcode=8801234567890');
  });

  it('바코드가 없으면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => []);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode(null), { wrapper: wrapperFor(client) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
