import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  useCreateSession,
  useStartSession,
  useCancelSession,
  useScanLocation,
  useScanProduct,
  useUpdateCount,
  useGenerateAdjustments,
  useCompleteSession,
} from './mutations';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

function setup() {
  const calls: Call[] = [];
  const client: ApiClient = {
    request: (async (opts: Call) => {
      calls.push(opts);
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { calls, invalidate, wrapper };
}

function invalidatedKeys(invalidate: ReturnType<typeof vi.spyOn>): string {
  return invalidate.mock.calls.map((c: unknown[]) => JSON.stringify(c[0])).join('|');
}

describe('stocktaking mutations', () => {
  it('세션을 생성한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCreateSession(), { wrapper });

    await result.current.mutateAsync({ warehouseId: 'w-1', sessionName: '2026-07-23 실사' });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/sessions',
      method: 'POST',
      body: { warehouseId: 'w-1', sessionName: '2026-07-23 실사' },
    });
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-sessions');
  });

  it('세션을 시작한다', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useStartSession(), { wrapper });
    await result.current.mutateAsync('s-1');
    expect(calls[0]).toMatchObject({ path: '/stocktaking/sessions/s-1/start', method: 'POST' });
  });

  it('세션을 취소한다', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useCancelSession(), { wrapper });
    await result.current.mutateAsync('s-1');
    expect(calls[0]).toMatchObject({ path: '/stocktaking/sessions/s-1/cancel', method: 'POST' });
  });

  it('로케이션을 스캔한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useScanLocation(), { wrapper });

    await result.current.mutateAsync({ sessionId: 's-1', locationBarcode: 'A-01-02' });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/scan-location',
      method: 'POST',
      body: { sessionId: 's-1', locationBarcode: 'A-01-02' },
    });
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-session');
    // 로케이션 스캔도 그 위치의 라인을 upsert 하므로 차이 목록이 스테일해진다 —
    // VarianceReviewScreen 의 미리보기 게이트가 이 무효화에 기대고 있다(FIX 1).
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-variances');
  });

  it('상품을 스캔한다 (수량 동반)', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useScanProduct(), { wrapper });

    await result.current.mutateAsync({
      sessionId: 's-1',
      locationId: 'l-1',
      productBarcode: '880',
      quantity: 3,
    });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/scan-product',
      method: 'POST',
      body: { sessionId: 's-1', locationId: 'l-1', productBarcode: '880', quantity: 3 },
    });
    // 카운트가 바뀌었으니 캐시된 차이 목록은 더 이상 신뢰할 수 없다 — 무효화해야
    // VarianceReviewScreen 이 재조회 전까지 완료 게이트를 열지 않는다(FIX 1).
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-variances');
  });

  it('scan-product 가 서버에서 커밋되고 응답만 유실돼도(요청 실패) 여전히 무효화한다', async () => {
    // onSuccess 였다면 응답 유실 시 무효화가 아예 안 불려서, 그 stale 윈도우 안에
    // 차이 확인 화면으로 돌아오면 FIX 1 이 막으려던 fail-open 이 그대로
    // 재현된다. onSettled 라면 실패해도 무효화는 반드시 일어난다.
    const client: ApiClient = {
      request: (async () => {
        throw new Error('응답 유실 → 500');
      }) as unknown as ApiClient['request'],
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    const { result } = renderHook(() => useScanProduct(), { wrapper });

    await expect(
      result.current.mutateAsync({ sessionId: 's-1', locationId: 'l-1', productBarcode: '880', quantity: 1 })
    ).rejects.toThrow();

    expect(invalidatedKeys(invalidate)).toContain('stocktaking-variances');
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-session');
  });

  it('수량을 절대값으로 세팅한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUpdateCount(), { wrapper });

    await result.current.mutateAsync({ sessionId: 's-1', lineId: 'line-1', countedQuantity: 12 });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/lines/line-1/count',
      method: 'PUT',
      body: { countedQuantity: 12 },
    });
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-variances');
  });

  it('조정 미리보기는 dry-run 이라 무효화하지 않는다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useGenerateAdjustments(), { wrapper });

    await result.current.mutateAsync('s-1');

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/sessions/s-1/generate-adjustments',
      method: 'POST',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('완료는 원장 관련 쿼리까지 무효화한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCompleteSession(), { wrapper });

    await result.current.mutateAsync('s-1');

    expect(calls[0]).toMatchObject({ path: '/stocktaking/sessions/s-1/complete', method: 'POST' });
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain('stocktaking-variances');
    expect(keys).toContain('sku-warehouse-stock');
    expect(keys).toContain('sku-stock-summary');
  });
});
