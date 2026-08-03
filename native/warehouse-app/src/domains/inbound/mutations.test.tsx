import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useReceiveFromPlan, useSimpleInbound, usePutaway, useCancelInbound } from './mutations';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

interface Call {
  path: string;
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

function setup(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidated: unknown[][] = [];
  const original = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
    invalidated.push((filters as { queryKey?: unknown[] })?.queryKey ?? []);
    return original(filters);
  });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      return { success: true, receiptId: 'r-1', lineId: 'ln-1', id: 'r-1', lines: [] };
    }) as unknown as ApiClient['request'],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { wrapper, invalidated };
}

describe('useReceiveFromPlan', () => {
  it('멱등키를 본문과 헤더 양쪽에 싣는다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => useReceiveFromPlan(), { wrapper });

    result.current.mutate({ planItemId: 'pi-1', quantity: 20, idempotencyKey: 'key-1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/plans/receive');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].idempotencyKey).toBe('key-1');
    expect(calls[0].body).toMatchObject({ planItemId: 'pi-1', quantity: 20, idempotencyKey: 'key-1' });
  });

  it('원장이 움직였으므로 재고 캐시까지 무효화한다', async () => {
    const calls: Call[] = [];
    const { wrapper, invalidated } = setup(calls);
    const { result } = renderHook(() => useReceiveFromPlan(), { wrapper });

    result.current.mutate({ planItemId: 'pi-1', quantity: 1, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidated.map((k) => k[0]);
    expect(keys).toContain('inbound-pending');
    expect(keys).toContain('location-contents');
    expect(keys).toContain('sku-warehouse-stock');
    expect(keys).toContain('sku-stock-summary');
  });

  // onSuccess 가 아니라 onSettled 여야 한다: 서버는 커밋했는데 응답만 유실되면
  // onSuccess 는 영영 안 불리고 stale 캐시가 남는다.
  it('실패해도 무효화한다', async () => {
    const calls: Call[] = [];
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidated: unknown[][] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
      invalidated.push((filters as { queryKey?: unknown[] })?.queryKey ?? []);
      return Promise.resolve();
    });
    const client: ApiClient = {
      request: (async (o: Call) => {
        calls.push(o);
        throw new Error('POST /inbound/plans/receive → 500');
      }) as unknown as ApiClient['request'],
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    const { result } = renderHook(() => useReceiveFromPlan(), { wrapper });

    result.current.mutate({ planItemId: 'pi-1', quantity: 1, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated.map((k) => k[0])).toContain('inbound-pending');
  });
});

describe('나머지 뮤테이션 경로', () => {
  it('useSimpleInbound 는 /inbound/simple 로 간다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => useSimpleInbound(), { wrapper });

    result.current.mutate({
      warehouseId: 'w-1',
      items: [{ skuId: 's1', quantity: 3 }],
      idempotencyKey: 'k',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/simple');
    // 멱등키는 본문과 헤더 옵션 양쪽에 실려야 한다 — 서버는 본문을, 클라이언트 컨벤션은 헤더를 본다.
    expect(calls[0].idempotencyKey).toBe('k');
    expect(calls[0].body).toMatchObject({
      warehouseId: 'w-1',
      items: [{ skuId: 's1', quantity: 3 }],
      idempotencyKey: 'k',
    });
  });

  it('usePutaway 는 /inbound/putaway 로 간다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => usePutaway(), { wrapper });

    result.current.mutate({ lineId: 'ln-1', toLocationId: 'l-9', quantity: 3, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/putaway');
    // 멱등키는 본문과 헤더 옵션 양쪽에 실려야 한다 — 서버는 본문을, 클라이언트 컨벤션은 헤더를 본다.
    expect(calls[0].idempotencyKey).toBe('k');
    expect(calls[0].body).toMatchObject({ lineId: 'ln-1', toLocationId: 'l-9', quantity: 3, idempotencyKey: 'k' });
  });

  it('적치 성공 후 putaway-pending 을 무효화한다', async () => {
    const calls: Call[] = [];
    const { wrapper, invalidated } = setup(calls);
    const { result } = renderHook(() => usePutaway(), { wrapper });

    result.current.mutate({
      lineId: 'ln-1',
      toLocationId: 'loc-1',
      quantity: 3,
      idempotencyKey: 'k-1',
    });

    await waitFor(() => expect(invalidated).toContainEqual(['putaway-pending']));
  });

  it('useCancelInbound 는 /inbound/cancel 로 간다', async () => {
    const calls: Call[] = [];
    const { wrapper } = setup(calls);
    const { result } = renderHook(() => useCancelInbound(), { wrapper });

    result.current.mutate({ lineId: 'ln-1', quantity: 3, idempotencyKey: 'k' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].path).toBe('/inbound/cancel');
    // 멱등키는 본문과 헤더 옵션 양쪽에 실려야 한다 — 서버는 본문을, 클라이언트 컨벤션은 헤더를 본다.
    expect(calls[0].idempotencyKey).toBe('k');
    expect(calls[0].body).toMatchObject({ lineId: 'ln-1', quantity: 3, idempotencyKey: 'k' });
  });
});
