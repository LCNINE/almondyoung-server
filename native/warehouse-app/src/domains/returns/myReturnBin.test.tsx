import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import { SessionProvider } from '../../app/session-context';
import type { Session } from '../../core/auth/session';
import { useMyReturnBin } from './myReturnBin';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function BinCount() {
  const bin = useMyReturnBin('wh');

  return <p>{bin.data ? `대기 ${bin.data.items.length}건` : '읽는 중'}</p>;
}

describe('useMyReturnBin', () => {
  it('캐시가 아직 신선해도 보드가 다시 열리면 서버에서 다시 읽는다', async () => {
    let calls = 0;
    const responses = [
      { id: 'b', barcode: 'RB-1', warehouseId: 'wh', items: [{ skuId: 's', skuCode: 'C', skuName: '볼펜', sourceLocationId: 'l', locationCode: 'A-01', qty: 1 }] },
      { id: 'b', barcode: 'RB-1', warehouseId: 'wh', items: [] },
    ];
    const client: ApiClient = {
      request: (async () => responses[Math.min(calls++, responses.length - 1)]) as unknown as ApiClient['request'],
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    const first = render(<BinCount />, { wrapper });
    expect(await screen.findByText('대기 1건')).toBeInTheDocument();
    first.unmount();

    render(<BinCount />, { wrapper });
    expect(await screen.findByText('대기 0건')).toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
