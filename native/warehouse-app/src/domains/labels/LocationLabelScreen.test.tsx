import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
const RACK_CELLS = {
  items: [
    { id: 'c-2', code: 'A-07-02' },
    { id: 'c-1', code: 'A-07-01' },
    { id: 'c-3', code: 'A-07-03' },
  ],
  total: 3,
};
let rackTotal = 3;
const OK: LabelBatch = { format: 'zpl', data: '^XA^XZ', labels: 4, skipped: [] };

let lastSearchPath = '';
const rackQueryPaths: string[] = [];
const commandCodes: string[] = [];
let busEmit: (code: string) => void = () => {};
function BusProbe() {
  const bus = useScanBus();
  busEmit = (code) => bus.emit({ code, source: 'hid', at: 1 });
  useEffect(() => bus.setCommandHandler((code) => commandCodes.push(code)), [bus]);
  return null;
}

function setup(batch: LabelBatch = OK) {
  const labelCalls: unknown[] = [];
  const request = vi.fn(async (o: { path: string; body?: unknown }) => {
    if (o.path.startsWith('/locations/warehouses/w-1/racks')) return RACKS;
    if (o.path.startsWith('/locations/warehouses/w-1?')) {
      if (o.path.includes('rackNumber=')) {
        rackQueryPaths.push(o.path);
        return { ...RACK_CELLS, total: rackTotal };
      }
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
  await userEvent.selectOptions(await screen.findByLabelText('출력할 랙'), 'r-1');
}

async function find(term: string) {
  await userEvent.click(await screen.findByRole('button', { name: '칸 선택' }));
  await userEvent.type(await screen.findByLabelText('로케이션 코드'), `${term}{Enter}`);
}

describe('LocationLabelScreen', () => {
  it('랙 전체와 칸 선택을 오가는 세그먼트가 있고 기본은 랙 전체다', async () => {
    setup();
    expect(await screen.findByRole('button', { name: '랙 전체' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '칸 선택' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '랙 전체 출력' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '칸 선택' }));
    expect(screen.getByRole('button', { name: '칸 선택' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '고른 칸 출력' })).toBeDisabled();
    expect(screen.getByLabelText('로케이션 코드')).toBeInTheDocument();
  });

  it('랙을 고르면 그 랙의 칸 코드와 총 장수를 미리보고 그 랙만 요청한다', async () => {
    rackQueryPaths.length = 0;
    const { labelCalls } = setup();
    await pickRack();
    expect((await screen.findAllByText('A-07-03')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1장')).toHaveLength(3);
    expect(screen.getByText('총 3장')).toBeInTheDocument();
    expect(rackQueryPaths).toHaveLength(1);
    expect(rackQueryPaths[0]).toContain('columnName=A');
    expect(rackQueryPaths[0]).toContain('rackNumber=7');
    await userEvent.click(screen.getByRole('button', { name: '랙 전체 출력' }));
    await screen.findByText('라벨 4장을 보냈어요');
    expect(labelCalls).toEqual([{ rackId: 'r-1' }]);
  });

  it('입력칸에 친 명령 바코드는 검색이 아니라 셸 명령으로 간다', async () => {
    commandCodes.length = 0;
    setup();
    await find('%90%03');
    expect(commandCodes).toEqual(['%90%03']);
    expect(lastSearchPath).not.toContain('%90');
  });

  it('랙 칸이 100개를 넘으면 미리보기가 일부임을 알린다', async () => {
    rackTotal = 150;
    setup();
    await pickRack();
    expect(await screen.findByText('전체 150칸 중 3칸 미리보기')).toBeInTheDocument();
    expect(screen.getByText('총 150장')).toBeInTheDocument();
    rackTotal = 3;
  });

  it('헤더에 라벨 프린터 이름을 보인다', async () => {
    setup();
    expect(await screen.findByText('라벨 프린터 · TX400')).toBeInTheDocument();
  });

  it('칸 선택은 중복 없이 코드순 미리보기와 총 장수를 보인다', async () => {
    setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-꼭대기 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 고르기' }));
    expect(screen.getByText('고른 칸 2개')).toBeInTheDocument();
    expect(screen.getByText('총 2장')).toBeInTheDocument();
    const preview = within(screen.getByRole('region', { name: '출력 미리보기' }));
    const codes = preview.getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent);
    expect(codes).toEqual(['M-07-01', 'M-07-꼭대기']);
  });

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
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-01 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 고르기' }));
    expect(screen.getAllByRole('button', { name: 'M-07-01 빼기' })).toHaveLength(1);
  });

  it('고른 칸으로 출력하면 요청이 { locationIds } 이고 고른 순서로 보낸다(인쇄 순서는 core 가 코드순)', async () => {
    const { labelCalls } = setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-꼭대기 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: '고른 칸 출력' }));
    await screen.findByText('라벨 4장을 보냈어요');
    expect(labelCalls).toEqual([{ locationIds: ['l-2', 'l-1'] }]);
    expect(screen.getByText('코드 순서로 나와요')).toBeInTheDocument();
  });

  it('스캔 버스로 온 코드가 검색어가 되고 활성·비시스템 칸만 묻는다', async () => {
    setup();
    await screen.findByRole('option', { name: 'A-07' });
    act(() => busEmit('M-07'));
    expect(await screen.findByRole('button', { name: 'M-07-01 고르기' })).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-01 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: '고른 칸 출력' }));
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

  it('고른 칸을 뺄 수 있고 비면 출력할 수 없다', async () => {
    setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-01 고르기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 빼기' }));
    expect(screen.queryByRole('button', { name: 'M-07-01 빼기' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '고른 칸 출력' })).toBeDisabled();
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
