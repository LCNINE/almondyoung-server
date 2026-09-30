import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { readReturnBin } from './returnBin';
import { ReturnBinSettings } from './ReturnBinSettings';

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
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={prefs}>
        <QueryClientProvider client={new QueryClient()}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<ReturnBinSettings prefs={prefs} />, { wrapper });
  return { user: userEvent.setup(), prefs };
}

describe('ReturnBinSettings', () => {
  it('등록된 바구니면 바로 이 기기의 바구니로 지정한다', async () => {
    const { user, prefs } = mount({
      request: async (o) => {
        if (o.path === '/return-bins/RB-001?warehouseId=wh') return { id: 'b', barcode: 'RB-001', warehouseId: 'wh', items: [] };
        throw new Error(`unexpected ${o.path}`);
      },
    });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-001');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    expect(await screen.findByRole('status')).toHaveTextContent('RB-001 을 이 기기의 되돌림 바구니로 지정했어요.');
    expect(readReturnBin(prefs, 'wh')).toBe('RB-001');
  });

  it('등록되지 않은 바구니면 등록 버튼을 보이고, 누르면 등록한 뒤 지정한다', async () => {
    const calls: string[] = [];
    const { user, prefs } = mount({
      request: async (o) => {
        calls.push(`${o.method ?? 'GET'} ${o.path}`);
        if (o.method === 'POST' && o.path === '/return-bins') return { id: 'b', barcode: 'RB-NEW', warehouseId: 'wh' };
        throw new ApiError('GET /return-bins/RB-NEW → 404', 404, 'RETURN_BIN_UNKNOWN');
      },
    });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-NEW');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    await user.click(await screen.findByRole('button', { name: '새 바구니로 등록' }));
    expect(await screen.findByRole('status')).toHaveTextContent('RB-NEW 을 등록하고 이 기기의 되돌림 바구니로 지정했어요.');
    expect(calls).toContain('POST /return-bins');
    expect(readReturnBin(prefs, 'wh')).toBe('RB-NEW');
  });

  it('RB- 가 아니면 보내지 않는다', async () => {
    const { user } = mount({ request: async () => { throw new Error('should not call'); } });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'TOTE-1');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('되돌림 바구니 바코드는 RB- 로 시작해요.');
  });
});
