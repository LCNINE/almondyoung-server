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
  });

  it('상품을 스캔한다 (수량 동반)', async () => {
    const { calls, wrapper } = setup();
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
  });

  it('수량을 절대값으로 세팅한다', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useUpdateCount(), { wrapper });

    await result.current.mutateAsync({ sessionId: 's-1', lineId: 'line-1', countedQuantity: 12 });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/lines/line-1/count',
      method: 'PUT',
      body: { countedQuantity: 12 },
    });
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
