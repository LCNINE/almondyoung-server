import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
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

function wrapperFor(
  client: ApiClient,
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
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
      items: [
        {
          id: 'l-1',
          code: 'A-01-02',
          displayName: 'A-01-02',
          isActive: true,
          isSystem: false,
        },
      ],
      total: 1,
    }));
    const client: ApiClient = {
      request: request as unknown as ApiClient['request'],
    };

    const { result } = renderHook(() => useLocationSearch('w-1', 'A-01'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/locations/warehouses/w-1?');
    expect(path).toContain('search=A-01');
    expect(path).toContain('limit=20');
    expect(
      new URL(`http://test${path}`).searchParams.get('isActive')
    ).toBeNull();
    expect(
      new URL(`http://test${path}`).searchParams.get('isSystem')
    ).toBeNull();
  });

  it.each([
    ['movement-source', null, null],
    ['movement-destination', 'true', null],
    ['putaway-destination', 'true', 'false'],
  ] as const)(
    '%s 목적에 맞는 서버 필터를 보낸다',
    async (purpose, isActive, isSystem) => {
      const request = vi.fn(async (_opts: { path: string }) => ({
        items: [],
        total: 0,
      }));
      const client: ApiClient = {
        request: request as unknown as ApiClient['request'],
      };

      const { result } = renderHook(
        () => useLocationSearch('w-1', 'A-01', purpose),
        {
          wrapper: wrapperFor(client),
        }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const url = new URL(`http://test${request.mock.calls[0][0].path}`);
      expect(url.searchParams.get('isActive')).toBe(isActive);
      expect(url.searchParams.get('isSystem')).toBe(isSystem);
    }
  );

  it('purpose가 바뀌는 동안 이전 목적의 후보를 placeholder로 노출하지 않는다', async () => {
    let resolveDestination!: (value: { items: []; total: 0 }) => void;
    const destination = new Promise<{ items: []; total: 0 }>((resolve) => {
      resolveDestination = resolve;
    });
    const request = vi.fn(async (opts: { path: string }) => {
      const params = new URL(`http://test${opts.path}`).searchParams;
      if (params.get('isActive') === 'true') return destination;
      return {
        items: [
          {
            id: 'l-old',
            code: 'OLD',
            displayName: 'OLD',
            isActive: false,
            isSystem: false,
          },
        ],
        total: 1,
      };
    });
    const client: ApiClient = {
      request: request as unknown as ApiClient['request'],
    };
    const props = {
      purpose: 'movement-source' as 'movement-source' | 'movement-destination',
    };
    const { result, rerender } = renderHook(
      () => useLocationSearch('w-1', 'A-01', props.purpose),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() =>
      expect(result.current.data?.items[0]?.id).toBe('l-old')
    );

    props.purpose = 'movement-destination';
    rerender();

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual({ items: [], total: 0 });
    await act(async () => resolveDestination({ items: [], total: 0 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('창고 전환 뒤 이전 창고 응답이 늦게 와도 현재 후보를 바꾸지 않는다', async () => {
    type Result = {
      items: Array<{
        id: string;
        code: string;
        displayName: string;
        isActive: boolean;
        isSystem: boolean;
      }>;
      total: number;
    };
    const resolvers = new Map<string, (value: Result) => void>();
    const request = vi.fn(
      (opts: { path: string }) =>
        new Promise<Result>((resolve) => {
          const warehouseId = opts.path.split('/')[3]?.split('?')[0] ?? '';
          resolvers.set(warehouseId, resolve);
        })
    );
    const client: ApiClient = {
      request: request as unknown as ApiClient['request'],
    };
    const props = { warehouseId: 'w-1' };
    const { result, rerender } = renderHook(
      () => useLocationSearch(props.warehouseId, 'A-01'),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(resolvers.has('w-1')).toBe(true));

    props.warehouseId = 'w-2';
    rerender();
    await waitFor(() => expect(resolvers.has('w-2')).toBe(true));
    await act(async () => {
      resolvers.get('w-2')?.({
        items: [
          {
            id: 'l-w2',
            code: 'W2-A-01',
            displayName: 'W2-A-01',
            isActive: true,
            isSystem: false,
          },
        ],
        total: 1,
      });
    });
    await waitFor(() => expect(result.current.data?.items[0]?.id).toBe('l-w2'));

    await act(async () => {
      resolvers.get('w-1')?.({
        items: [
          {
            id: 'l-w1',
            code: 'W1-A-01',
            displayName: 'W1-A-01',
            isActive: true,
            isSystem: false,
          },
        ],
        total: 1,
      });
    });
    expect(result.current.data?.items[0]?.id).toBe('l-w2');
  });

  it('창고가 없으면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({
      items: [],
      total: 0,
    }));
    const client: ApiClient = {
      request: request as unknown as ApiClient['request'],
    };

    const { result } = renderHook(() => useLocationSearch(null, 'A-01'), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });

  it('검색어가 공백이면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({
      items: [],
      total: 0,
    }));
    const client: ApiClient = {
      request: request as unknown as ApiClient['request'],
    };

    const { result } = renderHook(() => useLocationSearch('w-1', '   '), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
