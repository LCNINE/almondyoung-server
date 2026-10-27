import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  fetchReturn,
  recordArrival,
  recordInspection,
  useReceivingReturns,
} from './api';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function fakeClient() {
  const request = vi.fn(
    async (_o: { path: string; method?: string; body?: unknown }) => ({
      items: [],
      total: 0,
    })
  );
  return { request, client: { request } as unknown as ApiClient };
}

describe('useReceivingReturns', () => {
  it('빈 문자열은 쿼리스트링에서 뺀다', async () => {
    const { request, client } = fakeClient();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    const { result } = renderHook(
      () => useReceivingReturns('w-1', { q: '', barcode: '880' }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe(
      '/admin/customer-return-receiving?warehouseId=w-1&barcode=880'
    );
    expect(qc.getQueryCache().getAll()[0].queryKey).toEqual([
      'customer-return-receiving',
      'w-1',
      '',
      '880',
    ]);
  });
});

describe('writes', () => {
  it('fetchReturn 은 창고용 읽기 라우트를 부른다', async () => {
    const { request, client } = fakeClient();
    await fetchReturn(client, 'r1');
    expect(request.mock.calls[0][0].path).toBe(
      '/admin/customer-return-receiving/r1'
    );
  });
  it('recordArrival 은 본문 그대로 POST', async () => {
    const { request, client } = fakeClient();
    const body = {
      warehouseId: 'w-1',
      items: [{ customerReturnItemId: 'i1', quantity: 1 }],
      idempotencyKey: 'k',
    };
    await recordArrival(client, 'r1', body);
    expect(request.mock.calls[0][0]).toMatchObject({
      path: '/admin/customer-returns/r1/arrivals',
      method: 'POST',
      body,
    });
  });
  it('recordInspection 은 본문 그대로 POST', async () => {
    const { request, client } = fakeClient();
    const body = {
      items: [
        { customerReturnItemId: 'i1', accepted: 1, rejected: 0, held: 0 },
      ],
    };
    await recordInspection(client, 'r1', body);
    expect(request.mock.calls[0][0]).toMatchObject({
      path: '/admin/customer-returns/r1/inspection',
      method: 'POST',
      body,
    });
  });
});
