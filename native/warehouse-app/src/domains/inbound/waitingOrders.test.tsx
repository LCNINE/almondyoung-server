import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useWaitingOrders } from './waitingOrders';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Answer = (skuIds: string[], warehouseId: string) => unknown;

function setup(
  answer: Answer,
  initial: { warehouseId: string | null; skuIds: string[] }
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = vi.fn(async (o: { path: string }) => {
    const params = new URL(o.path, 'http://localhost').searchParams;
    return answer(
      (params.get('skuIds') ?? '').split(','),
      params.get('warehouseId') ?? ''
    );
  });
  const client: ApiClient = {
    request: request as unknown as ApiClient['request'],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = renderHook(
    ({ warehouseId, skuIds }) => useWaitingOrders(warehouseId, skuIds),
    { wrapper, initialProps: initial }
  );
  return { ...view, request, qc };
}

const S1 = { skuId: 's1', orders: 2, qty: 5 };

describe('useWaitingOrders', () => {
  it('상품을 모아 한 번 묻고, 없는 상품은 null 이다', async () => {
    const { result, request } = setup(() => ({ items: [S1] }), {
      warehouseId: 'w-1',
      skuIds: ['s2', 's1', 's1'],
    });
    await waitFor(() => expect(result.current.of('s1')).toEqual(S1));
    expect(result.current.of('s2')).toBeNull();
    expect(result.current.failed).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].path).toBe(
      '/waiting-orders?warehouseId=w-1&skuIds=s1%2Cs2'
    );
  });

  it('창고나 상품이 없으면 묻지 않는다', () => {
    const none = setup(() => ({ items: [] }), {
      warehouseId: null,
      skuIds: ['s1'],
    });
    expect(none.request).not.toHaveBeenCalled();
    const empty = setup(() => ({ items: [] }), {
      warehouseId: 'w-1',
      skuIds: [],
    });
    expect(empty.request).not.toHaveBeenCalled();
  });

  it('백 개가 넘으면 나눠 묻고 합친다', async () => {
    const skuIds = Array.from({ length: 150 }, (_, i) => `s${i}`);
    const { result, request } = setup(
      (ids) => ({
        items: ids
          .filter((id) => id === 's0' || id === 's99')
          .map((skuId) => ({ skuId, orders: 1, qty: 1 })),
      }),
      { warehouseId: 'w-1', skuIds }
    );
    await waitFor(() => expect(result.current.of('s99')).not.toBeNull());
    expect(result.current.of('s0')).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('실패하면 0건이 아니라 실패로 알린다', async () => {
    const { result } = setup(
      () => {
        throw new ApiError('down', 500);
      },
      { warehouseId: 'w-1', skuIds: ['s1'] }
    );
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.of('s1')).toBeNull();
  });

  it('다시 읽다 실패하면 앞서 본 숫자를 지금 숫자로 보이지 않는다', async () => {
    let down = false;
    const { result, qc } = setup(
      () => {
        if (down) throw new ApiError('down', 500);
        return { items: [S1] };
      },
      { warehouseId: 'w-1', skuIds: ['s1'] }
    );
    await waitFor(() => expect(result.current.of('s1')).toEqual(S1));
    down = true;
    await act(() => qc.refetchQueries());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.of('s1')).toBeNull();
  });

  it('이 경로를 모르는 서버에서는 실패로 알리지 않는다', async () => {
    const { result, request } = setup(
      () => {
        throw new ApiError('Not Found', 404);
      },
      { warehouseId: 'w-1', skuIds: ['s1'] }
    );
    await waitFor(() => expect(request).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.failed).toBe(false);
    expect(result.current.of('s1')).toBeNull();
  });

  it('응답 모양이 다르면 실패로 본다', async () => {
    const { result } = setup(() => ({ total: 0 }), {
      warehouseId: 'w-1',
      skuIds: ['s1'],
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it('상품을 더 담는 동안 앞 숫자를 유지하고, 창고를 바꾸면 버린다', async () => {
    let release: (() => void) | undefined;
    let hold = false;
    const { result, rerender } = setup(
      async () => {
        if (hold) await new Promise<void>((resolve) => (release = resolve));
        return { items: [S1] };
      },
      { warehouseId: 'w-1', skuIds: ['s1'] }
    );
    await waitFor(() => expect(result.current.of('s1')).toEqual(S1));

    hold = true;
    rerender({ warehouseId: 'w-1', skuIds: ['s1', 's2'] });
    expect(result.current.of('s1')).toEqual(S1);

    rerender({ warehouseId: 'w-2', skuIds: ['s1'] });
    expect(result.current.of('s1')).toBeNull();
    release?.();
  });
});
