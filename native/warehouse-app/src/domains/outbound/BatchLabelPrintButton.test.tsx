import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { LABEL_PRINTER_KEY, PrinterError } from '../../core/hardware/print/labelPrinter';
import { BatchLabelPrintButton } from './BatchLabelPrintButton';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BATCH_KEY = 'almondwms.labelPrinter.batch.b-1';
const NOW = new Date('2026-09-27T01:00:00.000Z');

type Item = { id: string; shipmentId: string; status: string };

function mount(opts: {
  workItems?: Item[] | (() => Promise<Item[]>);
  label?: (shipmentId: string) => Promise<unknown>;
  print?: (target: string, text: string) => Promise<void>;
  prefs?: DevicePrefs;
  onRunningChange?: (running: boolean) => void;
}) {
  const paths: string[] = [];
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      paths.push(o.path);
      if (o.path === '/outbound-batches/b-1/work-items') {
        const w = opts.workItems ?? [];
        return typeof w === 'function' ? w() : w;
      }
      const m = /^\/shipments\/([^/]+)\/waybill\/label$/.exec(o.path);
      if (m) {
        return opts.label
          ? opts.label(m[1])
          : { waybillId: `w-${m[1]}`, trackingNo: `T-${m[1]}`, format: 'zpl', data: `^XA${m[1]}^XZ` };
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = opts.prefs ?? createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });
  const print = vi.fn(opts.print ?? (async () => {}));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={new QueryClient()}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(
    <BatchLabelPrintButton
      batchId="b-1"
      prefs={prefs}
      print={print}
      now={() => NOW}
      onRunningChange={opts.onRunningChange}
    />,
    { wrapper }
  );
  return { paths, print, prefs };
}

const items: Item[] = [
  { id: '1', shipmentId: 'a', status: 'queued' },
  { id: '2', shipmentId: 'b', status: 'completed' },
  { id: '3', shipmentId: 'c', status: 'picking' },
  { id: '4', shipmentId: 'd', status: 'excluded' },
];

describe('BatchLabelPrintButton', () => {
  it('출고·제외 박스를 빼고 확인 후 순서대로 찍고 기록한다', async () => {
    const { print, prefs } = mount({ workItems: items });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    const dialog = await screen.findByRole('dialog', { name: '라벨 2장을 인쇄할까요?' });
    await userEvent.click(within(dialog).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 2 · 실패 0 · 미인쇄 0');
    // 스풀러가 받았다는 뜻일 뿐 종이가 나왔다는 뜻이 아니다.
    expect(screen.getByText('프린터에서 나온 장수가 맞는지 확인해 주세요.')).toBeInTheDocument();
    // 거절 건이 없으면 사유 목록도 없다.
    expect(screen.queryByRole('list')).toBeNull();
    expect(print.mock.calls).toEqual([
      ['spooler://XP', '^XAa^XZ'],
      ['spooler://XP', '^XAc^XZ'],
    ]);
    expect(prefs.get(BATCH_KEY)).toBe(NOW.toISOString());
  });

  it('이 기기에서 이미 인쇄한 배치면 확인창이 알린다', async () => {
    const prefs = createMemoryPrefs({
      [LABEL_PRINTER_KEY]: 'spooler://XP',
      [BATCH_KEY]: '2026-09-27T00:12:00.000Z',
    });
    mount({ workItems: items, prefs });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('이미 인쇄했어요');
  });

  it('취소하면 아무것도 찍지 않는다', async () => {
    const { print, prefs } = mount({ workItems: items });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '취소' }));
    expect(print).not.toHaveBeenCalled();
    expect(prefs.get(BATCH_KEY)).toBeNull();
  });

  it('거절 건은 사유별로 묶어 보이고, 「실패·미인쇄만 다시」는 그 건만 다시 부른다', async () => {
    let failB = true;
    const { paths } = mount({
      workItems: [
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'queued' },
      ],
      label: async (id) => {
        if (id === 'b' && failB)
          throw new ConflictError('WAYBILL_STALE: waybill w-b changed', 'CONFLICT');
        return { waybillId: `w-${id}`, trackingNo: `T-${id}`, format: 'zpl', data: `^XA${id}^XZ` };
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 1 · 실패 1 · 미인쇄 0');
    expect(screen.getByText(/재발급을 요청해 주세요/)).toHaveTextContent('1건');

    failB = false;
    paths.length = 0;
    await userEvent.click(screen.getByRole('button', { name: '실패·미인쇄만 다시' }));
    // 방금 한 장을 찍어 이 기기 기록이 생겼지만, 다시 보내는 건 안 나온 건뿐이라 중복 경고는 거짓말이다.
    const retryDialog = await screen.findByRole('dialog', { name: '라벨 1장을 인쇄할까요?' });
    expect(retryDialog).toHaveTextContent(
      '인쇄되지 않은 1장만 다시 보내요. 인쇄가 끝날 때까지 이 화면을 떠나지 마세요.'
    );
    expect(retryDialog).not.toHaveTextContent('이미 인쇄했어요');
    await userEvent.click(within(retryDialog).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 1 · 실패 0 · 미인쇄 0');
    expect(paths).toEqual(['/shipments/b/waybill/label']);
  });

  it('프린터 실패면 멈추고 원문과 미인쇄 수를 보인다', async () => {
    mount({
      workItems: [
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'queued' },
      ],
      print: async () => {
        throw new PrinterError('OpenPrinterW failed: 1801');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 0 · 실패 0 · 미인쇄 2');
    expect(screen.queryByText('프린터에서 나온 장수가 맞는지 확인해 주세요.')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('프린터로 보내지 못했어요');
    expect(alert).toHaveTextContent('OpenPrinterW failed: 1801');
  });

  it('한 장도 못 찍었으면 이 기기 인쇄 기록을 남기지 않는다', async () => {
    const { prefs } = mount({
      workItems: [{ id: '1', shipmentId: 'a', status: 'queued' }],
      label: async () => {
        throw new ConflictError('WAYBILL_NOT_DISPATCHABLE: shipment a', 'CONFLICT');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 0 · 실패 1');
    expect(prefs.get(BATCH_KEY)).toBeNull();
  });

  it('인쇄 중 「중지」하면 남은 건을 미인쇄로 두고 다시 이어 찍을 수 있다', async () => {
    let release: (v: unknown) => void = () => {};
    const { print } = mount({
      workItems: [
        { id: '1', shipmentId: 'a', status: 'queued' },
        { id: '2', shipmentId: 'b', status: 'queued' },
      ],
      label: (id) =>
        id === 'a'
          ? new Promise((resolve) => (release = resolve))
          : Promise.resolve({ waybillId: `w-${id}`, trackingNo: `T-${id}`, format: 'zpl', data: `^XA${id}^XZ` }),
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    await userEvent.click(await screen.findByRole('button', { name: '중지' }));
    release({ waybillId: 'w-a', trackingNo: 'T-a', format: 'zpl', data: '^XAa^XZ' });
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 1 · 실패 0 · 미인쇄 1');
    expect(print.mock.calls).toEqual([['spooler://XP', '^XAa^XZ']]);
    expect(screen.queryByRole('button', { name: '중지' })).toBeNull();
    expect(screen.getByRole('button', { name: '실패·미인쇄만 다시' })).toBeEnabled();
  });

  // 인쇄 중 예외가 새면 phase 가 running 에 남아 화면 이동이 영영 막힌다.
  it('인쇄 도중 예상 못 한 예외가 나도 running 에 갇히지 않는다', async () => {
    const base = createMemoryPrefs({ [LABEL_PRINTER_KEY]: 'spooler://XP' });
    const prefs: DevicePrefs = {
      ...base,
      set: (key, value) => {
        if (key === BATCH_KEY) throw new Error('storage broke');
        base.set(key, value);
      },
    };
    const running: boolean[] = [];
    mount({ workItems: items, prefs, onRunningChange: (r) => running.push(r) });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('알 수 없는 오류가 발생했어요.');
    expect(screen.getByRole('button', { name: '라벨 인쇄' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '중지' })).toBeNull();
    expect(running).toEqual([true, false]);
  });

  it('인쇄할 박스가 없으면 확인창 없이 알린다', async () => {
    mount({ workItems: [{ id: '1', shipmentId: 'a', status: 'completed' }] });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('인쇄할 박스가 없어요');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('다시 눌렀는데 인쇄할 박스가 없으면 지난 결과 요약을 남기지 않는다', async () => {
    let current: Item[] = [{ id: '1', shipmentId: 'a', status: 'queued' }];
    mount({ workItems: async () => current });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '인쇄' }));
    await screen.findByRole('status');

    current = [{ id: '1', shipmentId: 'a', status: 'completed' }];
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('인쇄할 박스가 없어요');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('프린터 미설정이면 조회도 하지 않고 안내한다', async () => {
    const { paths } = mount({ workItems: items, prefs: createMemoryPrefs() });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(screen.getByRole('alert')).toHaveTextContent('설정에서 지정해 주세요');
    expect(paths).toEqual([]);
  });

  it('work-items 조회가 실패하면 확인창 없이 안내하고 기록하지 않는다', async () => {
    const { prefs } = mount({
      workItems: async () => {
        throw new Error('GET /outbound-batches/b-1/work-items → 500');
      },
    });
    await userEvent.click(screen.getByRole('button', { name: '라벨 인쇄' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 있어요');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(prefs.get(BATCH_KEY)).toBeNull();
  });

  it('조회 중 연타해도 work-items 를 한 번만 부른다', async () => {
    let release: (v: Item[]) => void = () => {};
    const { paths } = mount({
      workItems: () => new Promise<Item[]>((resolve) => (release = resolve)),
    });
    const button = screen.getByRole('button', { name: '라벨 인쇄' });
    await userEvent.click(button);
    await userEvent.click(button);
    release(items);
    await screen.findByRole('dialog');
    expect(paths.filter((p) => p.endsWith('/work-items'))).toHaveLength(1);
  });
});
