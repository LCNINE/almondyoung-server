import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { StartBatchButton } from './StartBatchButton';

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
  qc.setQueryData(['outbound-batches', 'wh-1', 'created'], []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<StartBatchButton batchId="b-1" />, { wrapper });
  return { client: qc, user: userEvent.setup() };
}

describe('StartBatchButton', () => {
  it('누르면 POST /picking/v2/starts 를 보내고 배치 목록을 무효화한다', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { client, user } = mount({
      request: async (o) => {
        calls.push({ path: o.path, body: o.body });
        return { state: 'started', batchId: 'b-1', sessionId: 'x' };
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(calls).toEqual([{ path: '/picking/v2/starts', body: { batchId: 'b-1' } }]);
    expect(client.getQueryState(['outbound-batches', 'wh-1', 'created'])?.isInvalidated).toBe(true);
  });

  it('막히면 사유별 묶음과 안내를 보여 주고, 다시 누를 수 있다', async () => {
    const { user } = mount({
      request: async () => {
        throw new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [
          { shipmentId: 's1', reason: 'INBOUND_PENDING', shipmentLineId: 'l1', skuId: 'k', requiredQty: 2, shortQty: 2, detail: null, trackingNo: '452716978431', skuCode: 'K', skuName: '볼펜' },
        ]);
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(await screen.findByText('적치 대기 중인 상품')).toBeInTheDocument();
    expect(screen.getByText('4527-1697-8431 · 볼펜 2개 중 2개 부족')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeEnabled();
  });
});
