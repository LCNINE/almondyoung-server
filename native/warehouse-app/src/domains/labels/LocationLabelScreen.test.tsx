import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { BARCODE_LABEL_PRINTER_KEY } from '../../core/hardware/print/labelPrinter';
import { LocationLabelScreen } from './LocationLabelScreen';
import type { LabelBatch } from './labelApi';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const RACKS = [
  { id: 'r-1', rackNumber: 7, column: { columnName: 'A' } },
  { id: 'r-2', rackNumber: 8, column: { columnName: 'B' } },
];
const FOUND = {
  items: [
    { id: 'l-1', code: 'M-07-01', displayName: '', isActive: true, isSystem: false },
    { id: 'l-2', code: 'M-07-꼭대기', displayName: '', isActive: true, isSystem: false },
  ],
  total: 2,
};
const OK: LabelBatch = { format: 'zpl', data: '^XA^XZ', labels: 4, skipped: [] };

let lastSearchPath = '';
let busEmit: (code: string) => void = () => {};
function BusProbe() {
  const bus = useScanBus();
  busEmit = (code) => bus.emit({ code, source: 'hid', at: 1 });
  return null;
}

function setup(batch: LabelBatch = OK) {
  const labelCalls: unknown[] = [];
  const request = vi.fn(async (o: { path: string; body?: unknown }) => {
    if (o.path.startsWith('/locations/warehouses/w-1/racks')) return RACKS;
    if (o.path.startsWith('/locations/warehouses/w-1?')) {
      lastSearchPath = o.path;
      return FOUND;
    }
    if (o.path === '/inventory/labels/locations') {
      labelCalls.push(o.body);
      return batch;
    }
    throw new Error(`unexpected ${o.path}`);
  });
  const client = { request } as unknown as ApiClient;
  const prefs = createMemoryPrefs({
    [BARCODE_LABEL_PRINTER_KEY]: 'spooler://TX400',
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }),
  });
  const print = vi.fn(async () => {});
  const rootRoute = createRootRoute();
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <LocationLabelScreen prefs={prefs} print={print} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider session={session}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>
              <BusProbe />
              <RouterProvider router={router as never} />
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { labelCalls, print };
}

async function pickRack() {
  await screen.findByRole('option', { name: 'A-07' });
  await userEvent.selectOptions(await screen.findByLabelText('랙'), 'r-1');
}

async function find(term: string) {
  await userEvent.type(await screen.findByLabelText('로케이션 코드'), `${term}{Enter}`);
}

describe('LocationLabelScreen', () => {
  it('랙을 골라 출력하면 요청이 { rackId } 다', async () => {
    const { labelCalls, print } = setup();
    await pickRack();
    await userEvent.click(screen.getByRole('button', { name: '랙 전체 출력' }));
    expect(await screen.findByText('라벨 4장을 보냈어요')).toBeInTheDocument();
    expect(labelCalls).toEqual([{ rackId: 'r-1' }]);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('랙 표시는 열-두 자리 번호다', async () => {
    setup();
    expect(await screen.findByRole('option', { name: 'A-07' })).toBeInTheDocument();
  });

  it('찍을 수 없는 칸만 있으면 프린터를 부르지 않고 코드와 사유를 보인다', async () => {
    const { print } = setup({
      format: 'zpl',
      data: '',
      labels: 0,
      skipped: [{ ref: 'l-2', code: 'M-07-꼭대기', reason: 'UNSUPPORTED_CODE' }],
    });
    await pickRack();
    await userEvent.click(screen.getByRole('button', { name: '랙 전체 출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('M-07-꼭대기 — 이 값은 아직 바코드로 찍을 수 없어요');
    expect(print).not.toHaveBeenCalled();
  });

  it('같은 칸을 두 번 담아도 목록에 하나다', async () => {
    setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-01 담기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 담기' }));
    expect(screen.getAllByRole('button', { name: 'M-07-01 빼기' })).toHaveLength(1);
  });

  it('담은 칸으로 출력하면 요청이 { locationIds } 이고 담은 순서로 보낸다(인쇄 순서는 core 가 코드순)', async () => {
    const { labelCalls } = setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-꼭대기 담기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 담기' }));
    await userEvent.click(screen.getByRole('button', { name: '담은 칸 출력' }));
    await screen.findByText('라벨 4장을 보냈어요');
    expect(labelCalls).toEqual([{ locationIds: ['l-2', 'l-1'] }]);
    expect(screen.getByText('코드 순서로 나와요')).toBeInTheDocument();
  });

  it('스캔 버스로 온 코드가 검색어가 되고 활성·비시스템 칸만 묻는다', async () => {
    setup();
    await screen.findByRole('option', { name: 'A-07' });
    act(() => busEmit('M-07'));
    expect(await screen.findByRole('button', { name: 'M-07-01 담기' })).toBeInTheDocument();
    expect(lastSearchPath).toContain('search=M-07');
    expect(lastSearchPath).toContain('isActive=true');
    expect(lastSearchPath).toContain('isSystem=false');
  });

  it('코드 없이 온 건너뜀은 고른 칸 목록에서 코드를 되찾아 보인다', async () => {
    setup({
      format: 'zpl',
      data: '',
      labels: 0,
      skipped: [{ ref: 'l-1', code: null, reason: 'NOT_FOUND' }],
    });
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-01 담기' }));
    await userEvent.click(screen.getByRole('button', { name: '담은 칸 출력' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('M-07-01 — 찾을 수 없어요');
  });

  it('바코드가 넓어 못 찍은 칸은 3×5 를 권하지 않는다', async () => {
    setup({
      format: 'zpl',
      data: '',
      labels: 0,
      skipped: [{ ref: 'l-1', code: 'M-07-01', reason: 'BARCODE_TOO_WIDE' }],
    });
    await pickRack();
    await userEvent.click(screen.getByRole('button', { name: '랙 전체 출력' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('바코드가 길어 라벨에 안 들어가요');
    expect(alert).not.toHaveTextContent('3×5');
  });

  it('담은 칸을 뺄 수 있고 비면 출력할 수 없다', async () => {
    setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-01 담기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 빼기' }));
    expect(screen.queryByRole('button', { name: 'M-07-01 빼기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '담은 칸 출력' })).toBeDisabled();
  });

  it('연타해도 인쇄는 한 번이다', async () => {
    const { print } = setup();
    await pickRack();
    const button = screen.getByRole('button', { name: '랙 전체 출력' });
    button.click();
    button.click();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await screen.findByText('라벨 4장을 보냈어요');
    expect(print).toHaveBeenCalledTimes(1);
  });
});
