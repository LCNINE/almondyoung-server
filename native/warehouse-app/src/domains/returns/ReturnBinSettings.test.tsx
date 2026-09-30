import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider, useWarehouse } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { readReturnBin, writeReturnBin } from './returnBin';
import { ReturnBinSettings } from './ReturnBinSettings';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function SwitchTo({ id }: { id: string }) {
  const { setWarehouse } = useWarehouse();
  return <button onClick={() => setWarehouse({ id, name: id })}>창고 바꾸기 {id}</button>;
}

function mount(opts: { request: (o: { method?: string; path: string; body?: unknown }) => Promise<unknown>; seed?: (prefs: ReturnType<typeof createMemoryPrefs>) => void }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  opts.seed?.(prefs);
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
  render(<><SwitchTo id="wh2" /><ReturnBinSettings prefs={prefs} /></>, { wrapper });
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

  it('조회가 UNKNOWN 이 아닌 이유로 실패하면 등록을 제안하지 않고 아무것도 저장하지 않는다', async () => {
    const calls: string[] = [];
    const { user, prefs } = mount({
      request: async (o) => {
        calls.push(`${o.method ?? 'GET'} ${o.path}`);
        throw new ApiError('mismatch', 409, 'RETURN_BIN_WAREHOUSE_MISMATCH');
      },
    });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-X');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls.every((c) => c.startsWith('GET'))).toBe(true);
    expect(screen.queryByRole('button', { name: '새 바구니로 등록' })).toBeNull();
    expect(readReturnBin(prefs, 'wh')).toBeNull();
  });

  it('등록이 실패하면 저장하지 않는다', async () => {
    const { user, prefs } = mount({
      request: async (o) => {
        if (o.method === 'POST') throw new ApiError('boom', 400, 'BAD_REQUEST');
        throw new ApiError('404', 404, 'RETURN_BIN_UNKNOWN');
      },
    });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-NEW');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    await user.click(await screen.findByRole('button', { name: '새 바구니로 등록' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(readReturnBin(prefs, 'wh')).toBeNull();
  });

  it('입력을 고치면 등록 제안이 사라진다', async () => {
    const { user } = mount({ request: async () => { throw new ApiError('404', 404, 'RETURN_BIN_UNKNOWN'); } });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-A');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    await screen.findByRole('button', { name: '새 바구니로 등록' });
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'B');
    expect(screen.queryByRole('button', { name: '새 바구니로 등록' })).toBeNull();
  });

  it('창고를 바꾸면 그 창고의 상태로 다시 시작한다', async () => {
    const { user } = mount({
      request: async () => { throw new ApiError('404', 404, 'RETURN_BIN_UNKNOWN'); },
      seed: (p) => writeReturnBin(p, { warehouseId: 'wh', barcode: 'RB-001' }),
    });
    expect(screen.getByText('지금 바구니: RB-001')).toBeInTheDocument();
    await user.type(screen.getByLabelText('되돌림 바구니 바코드'), 'RB-Z');
    await user.click(screen.getByRole('button', { name: '이 기기의 바구니로 지정' }));
    await screen.findByRole('button', { name: '새 바구니로 등록' });
    await user.click(screen.getByRole('button', { name: '창고 바꾸기 wh2' }));
    expect(screen.getByText('지정한 바구니가 없어요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '지정 풀기' })).toBeNull();
    expect(screen.queryByRole('button', { name: '새 바구니로 등록' })).toBeNull();
  });
});
