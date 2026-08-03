import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useForceSimpleOutbound, useSimpleOutboundScan } from './mutations';

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

function wrap(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      return { shipmentId: 's-1', workItemStatus: 'picking', status: 'in_progress', dispatchAttemptId: null, lines: [] };
    }) as unknown as ApiClient['request'],
  };
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useSimpleOutboundScan', () => {
  it('shipmentId 를 경로로, 나머지를 바디로 보낸다', async () => {
    const calls: Call[] = [];
    const { result } = renderHook(() => useSimpleOutboundScan(), { wrapper: wrap(calls) });

    await result.current.mutateAsync({ shipmentId: 's-1', barcode: '8801', quantity: 2, idempotencyKey: 'k-1' });

    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/shipments/s-1/simple-outbound-scans',
        body: { barcode: '8801', quantity: 2 },
        idempotencyKey: 'k-1',
      },
    ]);
  });
});

describe('useForceSimpleOutbound', () => {
  it('reason 만 바디로 보낸다', async () => {
    const calls: Call[] = [];
    const { result } = renderHook(() => useForceSimpleOutbound(), { wrapper: wrap(calls) });

    await result.current.mutateAsync({ shipmentId: 's-1', reason: '스캔 생략', idempotencyKey: 'k-2' });

    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/shipments/s-1/simple-outbound-forces',
        body: { reason: '스캔 생략' },
        idempotencyKey: 'k-2',
      },
    ]);
  });
});
