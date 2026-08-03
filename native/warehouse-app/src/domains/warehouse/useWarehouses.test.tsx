import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useWarehouses } from './useWarehouses';

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

describe('useWarehouses', () => {
  it('창고 목록을 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => [
      { id: 'w-1', name: '본창고', location: '김포' },
    ]);
    const client: ApiClient = {
      request: request as unknown as ApiClient['request'],
    };

    const { result } = renderHook(() => useWarehouses(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/warehouses');
    expect(result.current.data).toEqual([
      { id: 'w-1', name: '본창고', location: '김포' },
    ]);
  });
});
