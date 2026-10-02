import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { RemoveBoxPanel } from './RemoveBoxPanel';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function mount(opts: { request: (o: { method?: string; path: string; body?: unknown }) => Promise<unknown> }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const qc = new QueryClient();
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={prefs}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<RemoveBoxPanel batchId="b-1" onClose={() => {}} />, { wrapper });
  return { user: userEvent.setup() };
}

describe('RemoveBoxPanel', () => {
  it('사유가 비면 「빼기」가 꺼져 있고, 채우면 DELETE 를 보내 성공 문구를 보인다', async () => {
    const calls: Array<{ method?: string; path: string }> = [];
    const { user } = mount({
      request: async (o) => {
        calls.push({ method: o.method, path: o.path });
        return o.path.startsWith('/shipments/by-waybill') ? { shipmentId: 's-1', batchId: 'b-1', workItemId: 'wi' } : {};
      },
    });
    await user.type(screen.getByLabelText('송장번호'), '452716978431');
    expect(screen.getByRole('button', { name: '빼기' })).toBeDisabled();
    await user.type(screen.getByLabelText('빼는 이유'), '고객 요청');
    await user.click(screen.getByRole('button', { name: '빼기' }));
    expect(await screen.findByRole('status')).toHaveTextContent('박스를 뺐어요');
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/outbound-batches/b-1/shipments/s-1' });
  });
});
