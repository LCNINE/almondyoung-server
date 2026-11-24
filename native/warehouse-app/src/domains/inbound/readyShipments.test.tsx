import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useReadyShipments, type ReadyShipment } from './readyShipments';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const box = (id: string): ReadyShipment => ({
  shipmentId: id,
  status: 'draft',
  orderNos: ['3900'],
  recipientMasked: '홍**',
  skuCount: 1,
  totalQty: 2,
  readiness: 'ready',
});

function setup(
  answer: (ids: string[]) => unknown,
  initial: { warehouseId: string | null; ids: string[] }
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const request = vi.fn(async (o: { path: string }) => {
    const params = new URL(o.path, 'http://localhost').searchParams;
    return answer((params.get('receiptLineIds') ?? '').split(','));
  });
  const client: ApiClient = { request: request as unknown as ApiClient['request'] };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const view = renderHook(({ warehouseId, ids }) => useReadyShipments(warehouseId, ids), {
    wrapper,
    initialProps: initial,
  });
  return { ...view, request, qc };
}

describe('useReadyShipments', () => {
  it('입고 줄이 100개를 넘으면 앞의 100개로 한 번만 부른다', async () => {
    // 화면에 보인 순서 그대로 — 정렬하면 앞의 100개가 화면 앞쪽이 아니게 된다
    const ids = Array.from({ length: 150 }, (_, i) => `r${String(149 - i).padStart(3, '0')}`);
    const { result, request } = setup(
      () => ({ items: [box('b1')], waitingOnOtherSkus: 2 }),
      { warehouseId: 'w-1', ids }
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(1);
    const sent = new URL(request.mock.calls[0][0].path, 'http://localhost').searchParams;
    expect((sent.get('receiptLineIds') ?? '').split(',')).toEqual(ids.slice(0, 100));
    expect(result.current.waitingOnOtherSkus).toBe(2);
    expect(result.current.failed).toBe(false);
  });

  it('같은 입고 줄은 한 번만 보낸다', async () => {
    const { result, request } = setup(
      () => ({ items: [box('b1')], waitingOnOtherSkus: 0 }),
      { warehouseId: 'w-1', ids: ['r2', 'r1', 'r2', 'r1'] }
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(1);
    const sent = new URL(request.mock.calls[0][0].path, 'http://localhost').searchParams;
    expect(sent.get('receiptLineIds')).toBe('r2,r1');
  });

  it('404 면 빈 목록', async () => {
    const { result, request } = setup(
      () => {
        throw new ApiError('Not Found', 404);
      },
      { warehouseId: 'w-1', ids: ['r1'] }
    );
    await waitFor(() => expect(request).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.failed).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.waitingOnOtherSkus).toBe(0);
  });

  it('다시 읽기 실패면 failed 이고 옛 목록을 보이지 않는다', async () => {
    let down = false;
    const { result, qc } = setup(
      () => {
        if (down) throw new ApiError('down', 500);
        return { items: [box('b1')], waitingOnOtherSkus: 1 };
      },
      { warehouseId: 'w-1', ids: ['r1'] }
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    down = true;
    await act(() => qc.refetchQueries());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.items).toEqual([]);
    expect(result.current.waitingOnOtherSkus).toBe(0);
  });

  it('창고가 없거나 입고 줄이 없으면 부르지 않는다', () => {
    const none = setup(() => ({ items: [], waitingOnOtherSkus: 0 }), { warehouseId: null, ids: ['r1'] });
    expect(none.request).not.toHaveBeenCalled();
    const empty = setup(() => ({ items: [], waitingOnOtherSkus: 0 }), { warehouseId: 'w-1', ids: [] });
    expect(empty.request).not.toHaveBeenCalled();
  });
});
