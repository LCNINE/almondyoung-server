import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useOutboundBatches, useShipmentByWaybill } from './queries';

// ApiClientProvider always calls useSession() (even when a mock client is
// injected directly), so every test needs a SessionProvider ancestor —
// same stub as domains/inbound/queries.test.tsx.
const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrap(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useShipmentByWaybill', () => {
  it('운송장번호를 쿼리스트링으로 넘긴다', async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return { shipmentId: 's-1', trackingNo: 'T-1', carrier: 'HANJIN', lines: [] };
      }) as unknown as ApiClient['request'],
    };
    const { result } = renderHook(() => useShipmentByWaybill(), { wrapper: wrap(client) });

    const found = await result.current.mutateAsync('T-1');

    expect(found.shipmentId).toBe('s-1');
    expect(paths).toEqual(['/shipments/by-waybill?trackingNo=T-1']);
  });
});

describe('useOutboundBatches', () => {
  it('창고가 없으면 호출하지 않는다', async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return [];
      }) as unknown as ApiClient['request'],
    };
    const { result } = renderHook(() => useOutboundBatches(null, 'picking'), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(paths).toEqual([]);
  });

  it('창고·상태를 쿼리스트링으로 넘긴다', async () => {
    const paths: string[] = [];
    const client: ApiClient = {
      request: (async (o: { path: string }) => {
        paths.push(o.path);
        return [{ id: 'b-1', batchNumber: 'OB-1', name: '오전', status: 'picking', totalItems: 3, totalQty: 7 }];
      }) as unknown as ApiClient['request'],
    };
    const { result } = renderHook(() => useOutboundBatches('w-1', 'picking'), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(paths).toEqual(['/outbound-batches/v2?warehouseId=w-1&status=picking']);
  });
});
