import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import { JOIN_BLOCKER_TEXT } from '../outbound/batchJoin';
import type { Session } from '../../core/auth/session';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import { ReadyShipmentsSection } from './ReadyShipmentsSection';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Req = { path: string; method?: string; body?: unknown };

const ready = (id: string, orderNo: string, extra: Record<string, unknown> = {}) => ({
  shipmentId: id, status: 'planned', orderNos: [orderNo], recipientMasked: '김*영', skuCount: 3, totalQty: 5, readiness: 'ready', ...extra,
});
const batch = (id: string, startedAt: string | null) => ({
  id, batchNumber: `OB-${id}`, name: `Batch ${id}`, status: 'picking', totalItems: 4, totalBoxes: 3, totalQty: 6, startedAt, withdrawingItems: 0,
});
const candidate = (shipmentId: string) => ({
  shipmentId, shipmentStatus: 'planned', manifestVersion: 1, orderNos: ['A-1'], recipientMasked: '김*영', totalQty: 5,
  lines: [], issue: null, waybillIssue: null,
  waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'carrier', carrier: 'HANJIN', printable: false },
});

function mount(opts: {
  items?: unknown[]; waiting?: number;
  picking?: unknown[]; created?: unknown[];
  handler?: (o: Req) => Promise<unknown> | unknown;
  failBatches?: boolean;
  batchesDown?: { down: boolean };
  station?: boolean;
  print?: () => Promise<void>;
}) {
  const calls: Req[] = [];
  const request = async (o: Req) => {
    calls.push(o);
    if (o.path.startsWith('/ready-shipments')) return { items: opts.items ?? [], waitingOnOtherSkus: opts.waiting ?? 0 };
    if ((opts.failBatches || opts.batchesDown?.down) && o.path.includes('/outbound-batches/v2')) throw new Error('down');
    if (o.path.includes('status=picking')) return opts.picking ?? [];
    if (o.path.includes('status=created')) return opts.created ?? [];
    return opts.handler ? opts.handler(o) : {};
  };
  const client: ApiClient = { request: request as unknown as ApiClient['request'] };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const prefs = { get: () => 'printer-1', set: () => {}, remove: () => {} } as unknown as DevicePrefs;
  const view = render(
    <ReadyShipmentsSection warehouseId="w-1" receiptLineIds={['l-1']} labelPrinting={opts.station ?? false} prefs={prefs} print={opts.print} />,
    { wrapper },
  );
  return { calls, user: userEvent.setup(), container: view.container };
}

const writes = (calls: Req[]) => calls.filter((c) => c.method === 'POST');
const readyReads = (calls: Req[]) => calls.filter((c) => c.path.startsWith('/ready-shipments'));

describe('ReadyShipmentsSection', () => {
  it('갖춰진 상자가 없으면 칸을 그리지 않는다', async () => {
    const { calls, container } = mount({});
    await waitFor(() => expect(readyReads(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('다른 상품을 기다리는 주문만 있으면 그 한 줄만 보인다', async () => {
    mount({ waiting: 2 });
    expect(await screen.findByText('다른 상품을 기다리는 주문 2건')).toBeInTheDocument();
    expect(screen.queryByText('미발송 주문')).not.toBeInTheDocument();
  });

  it('적치 필요 상자는 안내만 있고 버튼이 없다', async () => {
    mount({ items: [ready('s-1', 'A-1', { readiness: 'putaway_required' })] });
    expect(await screen.findByText('적치하면 나갈 수 있어요')).toBeInTheDocument();
    expect(screen.getByText('미발송 주문')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '송장 출력' })).not.toBeInTheDocument();
  });

  it('[송장 출력]을 누르면 시작한 배치만 고를 수 있다', async () => {
    const { user } = mount({
      items: [ready('s-1', 'A-1')],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
      created: [batch('c1', '2026-11-25T02:00:00Z'), batch('c2', null)],
    });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    const list = await screen.findByRole('list', { name: '배치 고르기' });
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(2));
    expect(within(list).getByText(/p1/)).toBeInTheDocument();
    expect(within(list).getByText(/c1/)).toBeInTheDocument();
    expect(within(list).queryByText(/c2/)).not.toBeInTheDocument();
  });

  it('진행 중인 배치가 없으면 안내만 보이고 아무 요청도 보내지 않는다', async () => {
    const { user, calls } = mount({ items: [ready('s-1', 'A-1')], created: [batch('c2', null)] });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    expect(await screen.findByText('진행 중인 배치가 없어요. 출고작업에서 배치를 시작해 주세요.')).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);
  });

  it('배치를 고르기 전에는 쓰기 요청이 없다', async () => {
    const { user, calls } = mount({ items: [ready('s-1', 'A-1')], picking: [batch('p1', '2026-11-25T01:00:00Z')] });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    await screen.findByRole('list', { name: '배치 고르기' });
    expect(writes(calls)).toHaveLength(0);
  });

  it('고르면 출력 결과 문구를 보이고 목록을 다시 읽는다', async () => {
    const { user, calls } = mount({
      items: [ready('s-1', 'A-1')],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
      handler: (o) => (o.path.includes('join-candidates') ? [candidate('s-1')] : {}),
    });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    await user.click(await within(await screen.findByRole('list', { name: '배치 고르기' })).findByRole('button'));
    expect(await screen.findByRole('status')).toHaveTextContent('배치에 넣었어요');
    await waitFor(() => expect(readyReads(calls)).toHaveLength(2));
  });

  it('막히면 사유를 보이고 목록을 다시 읽는다', async () => {
    const { user, calls } = mount({
      items: [ready('s-1', 'A-1')],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
      handler: (o) => {
        if (o.path.includes('join-candidates')) return [candidate('s-1')];
        if (o.path === '/outbound-batches/p1/shipments/s-1')
          return Promise.reject(new ConflictError('blocked', 'BATCH_JOIN_BLOCKED', undefined, [{ shipmentId: 's-1', reason: 'INBOUND_PENDING' }]));
        return {};
      },
    });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    await user.click(await within(await screen.findByRole('list', { name: '배치 고르기' })).findByRole('button'));
    await waitFor(() => expect(readyReads(calls)).toHaveLength(2));
    expect(await screen.findByText(JOIN_BLOCKER_TEXT.INBOUND_PENDING.title)).toBeInTheDocument();
  });

  it('처리 중에는 두 번째 선택이 아무것도 보내지 않는다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { user, calls } = mount({
      items: [ready('s-1', 'A-1', { status: 'draft' })],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
      handler: async (o) => {
        if (o.path === '/outbound-preparation/plans') {
          await gate;
          return { succeeded: ['s-1'], failed: [] };
        }
        return o.path.includes('join-candidates') ? [candidate('s-1')] : {};
      },
    });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    const pick = await within(await screen.findByRole('list', { name: '배치 고르기' })).findByRole('button');
    await user.click(pick);
    await user.click(pick);
    release();
    await screen.findByRole('status');
    expect(calls.filter((c) => c.path === '/outbound-preparation/plans')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/outbound-batches/p1/shipments/s-1')).toHaveLength(1);
  });

  it('한 상자를 처리하는 동안 다른 상자의 [송장 출력]은 눌리지 않는다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { user } = mount({
      items: [ready('s-1', 'A-1', { status: 'draft' }), ready('s-2', 'A-2')],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
      handler: async (o) => {
        if (o.path === '/outbound-preparation/plans') {
          await gate;
          return { succeeded: ['s-1'], failed: [] };
        }
        return o.path.includes('join-candidates') ? [candidate('s-1')] : {};
      },
    });
    const buttons = await screen.findAllByRole('button', { name: '송장 출력' });
    await user.click(buttons[0]);
    await user.click(await within(await screen.findByRole('list', { name: '배치 고르기' })).findByRole('button'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '송장 출력' })[1]).toBeDisabled());
    release();
    await screen.findByRole('status');
  });

  it('배치 목록을 못 읽으면 배치가 없다고 하지 않는다', async () => {
    const { user } = mount({ items: [ready('s-1', 'A-1')], failBatches: true });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    expect(await screen.findByText('배치 목록을 불러오지 못했어요.')).toBeInTheDocument();
    expect(screen.queryByText(/진행 중인 배치가 없어요/)).not.toBeInTheDocument();
  });

  it('배치 고르기 위에 고른 주문 번호를 보인다', async () => {
    const { user } = mount({
      items: [ready('s-1', 'A-1'), ready('s-2', 'A-2')],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
    });
    const buttons = await screen.findAllByRole('button', { name: '송장 출력' });
    await user.click(buttons[1]);
    expect(await screen.findByText('#A-2 — 배치 고르기')).toBeInTheDocument();
    expect(screen.queryByText('#A-1 — 배치 고르기')).not.toBeInTheDocument();
  });

  it('[닫기]는 아무 요청 없이 배치 고르기를 닫는다', async () => {
    const { user, calls } = mount({ items: [ready('s-1', 'A-1')], picking: [batch('p1', '2026-11-25T01:00:00Z')] });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    await screen.findByRole('list', { name: '배치 고르기' });
    const before = calls.length;
    await user.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: '배치 고르기' })).not.toBeInTheDocument());
    expect(screen.queryByText('#A-1 — 배치 고르기')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(before);
    expect(writes(calls)).toHaveLength(0);
  });

  it('배치 목록을 못 읽었으면 [송장 출력]을 다시 눌러 다시 읽는다', async () => {
    const batchesDown = { down: true };
    const { user } = mount({ items: [ready('s-1', 'A-1')], picking: [batch('p1', '2026-11-25T01:00:00Z')], batchesDown });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    expect(await screen.findByText('배치 목록을 불러오지 못했어요.')).toBeInTheDocument();
    batchesDown.down = false;
    await user.click(screen.getByRole('button', { name: '송장 출력' }));
    const list = await screen.findByRole('list', { name: '배치 고르기' });
    expect(within(list).getByText(/p1/)).toBeInTheDocument();
    expect(screen.queryByText('배치 목록을 불러오지 못했어요.')).not.toBeInTheDocument();
  });

  it('출력이 실패하면 다시 출력 버튼을 보인다', async () => {
    const { user } = mount({
      items: [ready('s-1', 'A-1')],
      picking: [batch('p1', '2026-11-25T01:00:00Z')],
      station: true,
      print: async () => {
        throw new Error('printer down');
      },
      handler: (o) => {
        if (o.path.includes('join-candidates')) return [{ ...candidate('s-1'), waybill: { ...candidate('s-1').waybill, printable: true } }];
        if (o.path.includes('/label')) return { trackingNo: '1', zpl: '^XA^XZ', fingerprint: 'f' };
        return {};
      },
    });
    await user.click(await screen.findByRole('button', { name: '송장 출력' }));
    await user.click(await within(await screen.findByRole('list', { name: '배치 고르기' })).findByRole('button'));
    expect(await screen.findByRole('status')).toHaveTextContent('다시 출력');
    expect(screen.getByRole('button', { name: '송장 재출력' })).toBeInTheDocument();
  });
});
