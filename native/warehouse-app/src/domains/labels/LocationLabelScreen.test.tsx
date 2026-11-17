import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function setup(batch: LabelBatch = OK) {
  const labelCalls: unknown[] = [];
  const request = vi.fn(async (o: { path: string; body?: unknown }) => {
    if (o.path.startsWith('/locations/warehouses/w-1/racks')) return RACKS;
    if (o.path.startsWith('/locations/warehouses/w-1?')) return FOUND;
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
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionProvider session={session}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <LocationLabelScreen prefs={prefs} print={print} />
          </WarehouseProvider>
        </ApiClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { labelCalls, print };
}

async function pickRack() {
  await screen.findByRole('option', { name: 'A-07' });
  await userEvent.selectOptions(screen.getByLabelText('랙'), 'r-1');
}

async function find(term: string) {
  await userEvent.type(screen.getByLabelText('로케이션 코드'), `${term}{Enter}`);
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

  it('담은 칸으로 출력하면 요청이 { locationIds } 이고 순서는 담은 순서다', async () => {
    const { labelCalls } = setup();
    await find('M-07');
    await userEvent.click(await screen.findByRole('button', { name: 'M-07-꼭대기 담기' }));
    await userEvent.click(screen.getByRole('button', { name: 'M-07-01 담기' }));
    await userEvent.click(screen.getByRole('button', { name: '담은 칸 출력' }));
    await screen.findByText('라벨 4장을 보냈어요');
    expect(labelCalls).toEqual([{ locationIds: ['l-2', 'l-1'] }]);
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
