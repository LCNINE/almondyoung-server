import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import type { FreshLine } from './types';
import { PutawaySheet } from './PutawaySheet';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const LINE: FreshLine = {
  lineId: 'ln-1',
  skuId: 's1',
  skuCode: 'CT-001',
  skuName: '코튼셔츠',
  quantity: 20,
  putawayDone: false,
};

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

function makeClient(calls: Call[]): ApiClient {
  return {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/locations/warehouses/')) {
        if (o.path.includes('B-05')) {
          return { items: [{ id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' }], total: 1 };
        }
        return { items: [], total: 0 };
      }
      if (o.path === '/inbound/putaway') return { success: true };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderSheet(props: Partial<ComponentProps<typeof PutawaySheet>> = {}, calls: Call[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={makeClient(calls)}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const onDone = props.onDone ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  render(
    <PutawaySheet
      line={props.line ?? LINE}
      warehouseId={props.warehouseId ?? 'w-1'}
      lastDest={props.lastDest ?? null}
      onDone={onDone}
      onCancel={onCancel}
    />,
    { wrapper }
  );
  return { onDone, onCancel };
}

describe('PutawaySheet', () => {
  it('코드 완전일치 단건이면 대상지를 자동 선택한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'B-05-03');

    await waitFor(() => expect(screen.getByText('B-05-03')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
  });

  it('직전 대상지 버튼으로 한 번에 고른다', async () => {
    const user = userEvent.setup();
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } });

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
  });

  it('적치하면 lineId·대상지·수량을 보내고 onDone 을 부른다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    const { onDone } = renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } }, calls);

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'l-prev', code: 'A-01-01' }));
    const putaway = calls.find((c) => c.path === '/inbound/putaway');
    expect(putaway?.body).toMatchObject({ lineId: 'ln-1', toLocationId: 'l-prev', quantity: 20 });
  });

  it('대상지를 안 고르면 적치할 수 없다', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });
});
