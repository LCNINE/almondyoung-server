import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  useStocktakingSessions,
  useStocktakingSession,
  useStocktakingVariances,
} from './queries';

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

function stub() {
  const request = vi.fn(async (_opts: { path: string }) => ({ data: [], total: 0 }));
  return { request, client: { request: request as unknown as ApiClient['request'] } };
}

describe('stocktaking queries', () => {
  it('세션 목록은 창고로 필터한다', async () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingSessions('w-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/stocktaking/sessions?');
    expect(path).toContain('warehouseId=w-1');
  });

  it('창고가 없으면 세션 목록을 조회하지 않는다', () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingSessions(null), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });

  it('세션 상세는 sessions/:id 를 부른다', async () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingSession('s-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/stocktaking/sessions/s-1');
  });

  it('차이는 sessions/:id/variances 를 부른다', async () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingVariances('s-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/stocktaking/sessions/s-1/variances');
  });

  it('세션 id 가 없으면 상세/차이를 조회하지 않는다', () => {
    const { request, client } = stub();
    const detail = renderHook(() => useStocktakingSession(null), { wrapper: wrapperFor(client) });
    const variances = renderHook(() => useStocktakingVariances(null), {
      wrapper: wrapperFor(client),
    });
    expect(detail.result.current.fetchStatus).toBe('idle');
    expect(variances.result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
