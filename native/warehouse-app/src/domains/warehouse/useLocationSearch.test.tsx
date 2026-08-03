import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useLocationSearch } from './useLocationSearch';

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

describe('useLocationSearch', () => {
  it('창고 경로 + search 파라미터로 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => ({
      items: [{ id: 'l-1', code: 'A-01-02', displayName: 'A-01-02' }],
      total: 1,
    }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useLocationSearch('w-1', 'A-01'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/locations/warehouses/w-1?');
    expect(path).toContain('search=A-01');
    expect(path).toContain('limit=20');
  });

  it('창고가 없으면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useLocationSearch(null, 'A-01'), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });

  it('검색어가 공백이면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useLocationSearch('w-1', '   '), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
