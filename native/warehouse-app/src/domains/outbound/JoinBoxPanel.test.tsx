import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { JoinBoxPanel } from './JoinBoxPanel';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function mount(opts: { request: (o: { path: string; body?: unknown }) => Promise<unknown> }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<JoinBoxPanel batchId="b-1" labelPrinting={false} onClose={() => {}} />, { wrapper });
  return { client: qc, user: userEvent.setup() };
}

describe('JoinBoxPanel', () => {
  const candidate = {
    shipmentId: 's-1', shipmentStatus: 'planned', manifestVersion: 1, orderNos: ['3900'], recipientMasked: '홍**',
    totalQty: 2, lines: [{ skuCode: 'K', skuName: '볼펜', qty: 2 }], issue: null, waybillIssue: null,
    waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'manual', carrier: 'HANJIN', printable: false },
  };

  it('후보가 하나면 바로 넣고 결과 문구를 보여 준다', async () => {
    const calls: string[] = [];
    const { user } = mount({
      request: async (o) => {
        calls.push(o.path);
        return o.path.includes('join-candidates') ? [candidate] : {};
      },
    });
    await user.type(screen.getByLabelText('주문번호 또는 송장번호'), '3900');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByRole('status')).toHaveTextContent('배치에 넣었어요');
    expect(calls).toEqual(['/outbound-batches/b-1/join-candidates?code=3900', '/outbound-batches/b-1/shipments/s-1']);
  });

  it('후보가 없으면 안내한다', async () => {
    const { user } = mount({ request: async () => [] });
    await user.type(screen.getByLabelText('주문번호 또는 송장번호'), 'X');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('찾지 못했어요');
  });

  it('후보가 여럿이면 고른 박스만 넣는다', async () => {
    const calls: string[] = [];
    const { user } = mount({
      request: async (o) => {
        calls.push(o.path);
        return o.path.includes('join-candidates') ? [candidate, { ...candidate, shipmentId: 's-2', recipientMasked: '김**' }] : {};
      },
    });
    await user.type(screen.getByLabelText('주문번호 또는 송장번호'), '3900');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    const buttons = await screen.findAllByRole('button', { name: '이 박스 넣기' });
    await user.click(buttons[1]);
    await screen.findByRole('status');
    expect(calls.at(-1)).toBe('/outbound-batches/b-1/shipments/s-2');
  });
});
