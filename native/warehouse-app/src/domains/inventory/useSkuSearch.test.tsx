import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useSkuSearch } from './useSkuSearch';

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

describe('useSkuSearch', () => {
  it('requests advanced search with pagination + sort params', async () => {
    // 선언된 파라미터로 mock.calls[0][0] 타입을 얻는다.
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    // vi.fn 반환 타입은 ApiClient.request의 제네릭 <T>를 만족 못 하므로 캐스트(httpClient.test.ts의 `doFetch as never`와 같은 패턴).
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(
      () => useSkuSearch({ search: '코튼', limit: 20, offset: 20, sortBy: 'name', sortOrder: 'asc' }),
      { wrapper: wrapperFor(client) }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/inventory/skus/search/advanced?');
    expect(path).toContain('limit=20');
    expect(path).toContain('offset=20');
    expect(path).toContain('sortBy=name');
    expect(path).toContain('sortOrder=asc');
  });

  it('is disabled for an empty search term', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(
      () => useSkuSearch({ search: '   ', limit: 20, offset: 0 }),
      { wrapper: wrapperFor(client) }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
