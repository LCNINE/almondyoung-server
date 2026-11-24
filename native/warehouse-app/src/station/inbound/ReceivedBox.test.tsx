import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { WorkRuntime } from '../../core/operations/OperationContext';
import { createOperationStore, type OperationStore } from '../../core/operations/operationStore';
import { createBoxDraft, setLineQty, type BoxDraft } from '../../domains/inbound-shipment/boxDraft';
import type { BoxCandidate, BoxCount, BoxLine, BoxView, CancelBoxReceiptResult } from '../../domains/inbound-shipment/types';
import { createTestRuntime } from '../outbound/__fixtures__/outboundServer';
import { flash, press, renderStation, stationPrefs, typeHuman } from '../outbound/__fixtures__/renderStation';
import { InboundBoxesScreen } from './InboundBoxesScreen';

type Req = Parameters<ApiClient['request']>[0];

const UNCERTAIN = '결과를 확인하지 못했어요 — F11 다시 보내기';
const ARMED = '한 번 더 누르면 취소';
const DONE = 'L7 확정 — 적치 대기로 갔어요';
const CANCEL_PATH = '/inventory/inbound-shipments/s-1/boxes/b-1/receive/cancel';

const line = (over: Partial<BoxLine> & { lineId: string }): BoxLine => ({
  kind: 'sku',
  skuId: null,
  sku: null,
  productName: '',
  option: '',
  expectedQty: null,
  coversBoxLabels: ['L7'],
  alreadyCountedInOtherBoxes: 0,
  remark: '',
  ...over,
});

const LINES: BoxLine[] = [
  line({ lineId: 'L1', skuId: 'sku-1', sku: { code: 'SKU-1023', name: '수강가방M' }, productName: '수강가방 미디엄', expectedQty: 40 }),
  line({ lineId: 'L2', kind: 'free', productName: '박스테이프', expectedQty: 2 }),
];

const count = (over: Partial<BoxCount> & { id: string }): BoxCount => ({
  lineId: null,
  skuId: null,
  skuCode: null,
  skuName: null,
  countedQty: 0,
  method: 'counted',
  ...over,
});

const COUNTS: BoxCount[] = [
  count({ id: 'c-1', lineId: 'L1', skuId: 'sku-1', countedQty: 38 }),
  count({ id: 'c-2', lineId: 'L2', countedQty: 2, method: 'list' }),
  count({ id: 'c-3', skuId: 'sku-9', skuCode: 'SKU-3300', skuName: '손거울', countedQty: 3 }),
];

const base = (over: Partial<BoxView> = {}): BoxView => ({
  shipmentId: 's-1',
  shipmentName: '11월 2차 배편',
  shipmentStatus: 'receiving',
  expectedArrival: '2026-11-20',
  boxId: 'b-1',
  label: 'L7',
  origin: 'list',
  disposition: 'stock',
  status: 'received',
  forwardNote: null,
  receiptId: 'r-1',
  receivedAt: '2026-11-16T01:00:00.000Z',
  lines: LINES,
  counts: COUNTS,
  ...over,
});

interface Sent {
  path: string;
  body: Record<string, unknown>;
  key: string | undefined;
}

interface Fake {
  box?: BoxView;
  found?: BoxCandidate[];
  /** 확정 취소 응답 — 없으면 성공 */
  cancel?: () => Error | null;
  /** 다른 곳이 먼저 취소했다 — 상자는 열리고 이 취소는 409 */
  canceledElsewhere?: boolean;
  /** 확정이 돌려줄 선적 상태 */
  receiveShipmentStatus?: BoxView['shipmentStatus'];
}

/** 상자 하나를 상태로 들고 있는 가짜 core — 취소하면 열리고(집계는 사라진다) 확정하면 새 집계 id 로 확정된다 */
function createServer(fake: Fake = {}) {
  let box = fake.box ?? base();
  let nextCount = 100;
  const sent: Sent[] = [];
  const request = (async (o: Req) => {
    if (o.path.startsWith('/inventory/inbound-shipment-boxes?')) return fake.found ?? [];
    if (o.path.startsWith('/inventory/inbound-shipments?')) return [];
    if (o.path === CANCEL_PATH) {
      sent.push({ path: o.path, body: o.body as Record<string, unknown>, key: o.idempotencyKey });
      if (fake.canceledElsewhere) {
        box = { ...box, status: 'open', receiptId: null, receivedAt: null, counts: [] };
        throw new ConflictError('확정되지 않은 상자입니다: L7', 'CONFLICT');
      }
      const failure = fake.cancel?.();
      if (failure) throw failure;
      const result: CancelBoxReceiptResult = { boxId: 'b-1', shipmentStatus: 'receiving', canceledCountIds: box.counts.map((c) => c.id) };
      box = { ...box, status: 'open', receiptId: null, receivedAt: null, counts: [], shipmentStatus: 'receiving' };
      return result;
    }
    if (o.path === '/inventory/inbound-shipments/s-1/boxes/b-1/receive') {
      sent.push({ path: o.path, body: o.body as Record<string, unknown>, key: o.idempotencyKey });
      const body = o.body as { counts: { lineId: string; countedQty: number; method: 'counted' | 'list' }[] };
      const counts = body.counts.map((c) => count({ id: `c-${++nextCount}`, lineId: c.lineId, countedQty: c.countedQty, method: c.method }));
      const shipmentStatus = fake.receiveShipmentStatus ?? 'receiving';
      box = { ...box, status: 'received', counts, shipmentStatus };
      return { boxId: 'b-1', receiptId: box.receiptId, shipmentStatus, countIds: counts.map((c) => c.id) };
    }
    if (o.path === '/inventory/inbound-shipments/s-1/boxes/b-1') return box;
    throw new Error(`unexpected ${o.path}`);
  }) as ApiClient['request'];
  return { request, sent, cancels: () => sent.filter((s) => s.path === CANCEL_PATH) };
}

function mount(runtime: WorkRuntime, initial = true) {
  return renderStation(() => <InboundBoxesScreen initial={initial ? { shipmentId: 's-1', boxId: 'b-1' } : undefined} />, {
    runtime,
    prefs: stationPrefs(),
    path: '/inbound',
  });
}

async function setup(fake: Fake = {}, opts: { operate?: boolean; initial?: boolean; store?: OperationStore } = {}) {
  const server = createServer(fake);
  const runtime = createTestRuntime({ request: server.request }, { inboundShipmentOperate: opts.operate ?? true }, opts.store);
  const rendered = mount(runtime, opts.initial ?? true);
  return { server, runtime, ...rendered };
}

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const keyButton = (re: RegExp) => bar().queryByRole('button', { name: re });
const receivedRegion = () => screen.findByRole('region', { name: '확정된 상자' });
function row(regionName: string, key: string): HTMLElement {
  const found = screen.getByRole('region', { name: regionName }).querySelector<HTMLElement>(`tr[data-row="${key}"]`);
  if (!found) throw new Error(`row ${key} not found`);
  return found;
}
const qtyCell = (regionName: string, key: string) => row(regionName, key).querySelector<HTMLElement>('[data-col="qty"]')!;
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

/** 확정된 상자가 뜨고 F11 이 걸릴 때까지 */
async function readyReceived() {
  await receivedRegion();
  await waitFor(() => expect(keyButton(/F11\s*확정 취소/)).toBeInTheDocument());
  await act(async () => {});
}

async function cancelTwice() {
  press('F11');
  expect(await screen.findByText(ARMED)).toBeInTheDocument();
  press('F11');
}

describe('확정된 상자', () => {
  it('줄별 센 수량과 «리스트대로» 표시, 리스트에 없던 물건 이름 — 기능키는 F11 하나(+Esc)', async () => {
    await setup();
    await readyReceived();
    expect(screen.getByText('11월 2차 배편 · 상자 L7 · 11-20 도착')).toBeInTheDocument();
    expect(qtyCell('확정된 상자', 'line:L1').getAttribute('data-qty')).toBe('38');
    expect(qtyCell('확정된 상자', 'line:L1').getAttribute('data-state')).toBe('counted');
    expect(qtyCell('확정된 상자', 'line:L2').getAttribute('data-qty')).toBe('2');
    expect(qtyCell('확정된 상자', 'line:L2').getAttribute('data-state')).toBe('list');
    expect(row('확정된 상자', 'unplanned:sku-9')).toHaveTextContent('손거울');
    expect(qtyCell('확정된 상자', 'unplanned:sku-9').getAttribute('data-qty')).toBe('3');
    for (const re of [/F8/, /F9/, /F10/, /F12/]) expect(keyButton(re)).toBeNull();
    expect(keyButton(/Esc/)).toBeInTheDocument();
  });

  it('F11 한 번 → «한 번 더 누르면 취소», 두 번 → 취소 · 상자가 작업 화면으로 다시 열리고 칸이 전부 빈칸', async () => {
    const { server } = await setup();
    await readyReceived();
    press('F11');
    expect(await screen.findByText(ARMED)).toBeInTheDocument();
    expect(server.cancels()).toHaveLength(0);
    press('F11');
    const work = await screen.findByRole('region', { name: '상자 작업' });
    expect(server.cancels()).toHaveLength(1);
    // 계약 v2 봉투는 러너가 붙인다
    expect(server.cancels()[0].body).toMatchObject({ contractVersion: 2, idempotencyKey: server.cancels()[0].key });
    await within(work).findByRole('table', { name: '상자 줄' });
    for (const id of ['L1', 'L2']) expect(qtyCell('상자 작업', `line:${id}`).getAttribute('data-state')).toBe('blank');
    expect(work.querySelector('tr[data-row^="unplanned:"]')).toBeNull();
  });

  it('취소가 되면 그 상자의 옛 작업 초안을 버린다 — 확정 때 넣던 수량이 다시 채워지지 않는다', async () => {
    const { runtime } = await setup();
    // 다른 곳에서 확정되기 전 이 기기에서 넣던 수량
    const old = setLineQty(createBoxDraft(base({ status: 'open', counts: [] }), 'k-old'), 'L1', 7);
    await runtime.store.draft<BoxDraft | null>('scope:draft:inbound-box:b-1', () => old);
    await readyReceived();
    await cancelTwice();
    const work = await screen.findByRole('region', { name: '상자 작업' });
    await within(work).findByRole('table', { name: '상자 줄' });
    await settle();
    expect(qtyCell('상자 작업', 'line:L1').getAttribute('data-state')).toBe('blank');
  });

  it('Esc 는 한 번 누른 F11 을 거둔다 — 다음 F11 은 다시 한 번', async () => {
    const { server } = await setup();
    await readyReceived();
    press('F11');
    await screen.findByText(ARMED);
    await waitFor(() => expect(keyButton(/Esc\s*돌아가기/)).toBeInTheDocument());
    press('Escape');
    await waitFor(() => expect(screen.queryByText(ARMED)).toBeNull());
    press('F11');
    expect(await screen.findByText(ARMED)).toBeInTheDocument();
    expect(server.cancels()).toHaveLength(0);
  });

  it('서버 거절(적치 시작·이미 취소) 문구를 띄우고 확정된 상자에 남는다 — 다음 취소는 새 키', async () => {
    let reject = true;
    const { server } = await setup({ cancel: () => (reject ? new ApiError('POST → 400', 400, 'BAD_REQUEST') : null) });
    await readyReceived();
    await cancelTwice();
    expect(await screen.findByText('이미 적치했거나 취소된 입고라 취소할 수 없어요. 목록을 다시 확인해 주세요.')).toBeInTheDocument();
    expect(flash()).toBe('error');
    expect(screen.getByRole('region', { name: '확정된 상자' })).toBeInTheDocument();
    reject = false;
    await waitFor(() => expect(keyButton(/F11\s*확정 취소/)).toBeInTheDocument());
    await cancelTwice();
    await screen.findByRole('region', { name: '상자 작업' });
    expect(server.cancels()).toHaveLength(2);
    expect(server.cancels()[1].key).not.toBe(server.cancels()[0].key);
  });

  it('다른 곳에서 먼저 취소했으면(409) 상자를 다시 읽어 작업 화면으로', async () => {
    const { server } = await setup({ canceledElsewhere: true });
    await readyReceived();
    await cancelTwice();
    const work = await screen.findByRole('region', { name: '상자 작업' });
    await within(work).findByRole('table', { name: '상자 줄' });
    expect(server.cancels()).toHaveLength(1);
    expect(qtyCell('상자 작업', 'line:L1').getAttribute('data-state')).toBe('blank');
  });

  it('응답이 끊기면 «결과를 확인하지 못했어요», 다시 그려도 남고 F11 은 같은 키로 다시 보낸다', async () => {
    let offline = true;
    const first = await setup({ cancel: () => (offline ? new Error('network down') : null) });
    await readyReceived();
    await cancelTwice();
    expect(await screen.findByText(UNCERTAIN)).toBeInTheDocument();
    const key = first.server.cancels()[0].key;
    expect(first.server.cancels().every((s) => s.key === key)).toBe(true);

    first.unmount();
    mount(first.runtime);
    expect(await screen.findByText(UNCERTAIN)).toBeInTheDocument();
    await waitFor(() => expect(keyButton(/F11\s*다시 보내기/)).toBeInTheDocument());
    offline = false;
    const before = first.server.cancels().length;
    press('F11');
    await screen.findByRole('region', { name: '상자 작업' });
    const resent = first.server.cancels().slice(before);
    expect(resent.length).toBeGreaterThan(0);
    for (const s of resent) expect(s.key).toBe(key);
  });

  it('같은 상자에 결과를 모르는 다른 쓰기가 있으면 취소는 보내지 않는다 — «처리 여부를 먼저 확인해 주세요», 잠기지 않는다', async () => {
    const { server, runtime } = await setup();
    // 이 상자의 확정이 아직 결과를 모른다(다른 화면·다른 시도) — 러너가 같은 상자의 쓰기를 막는다
    await runtime.store.begin({
      id: 'k-receive',
      scope: 'scope',
      resource: 'inbound-shipment-box:b-1',
      path: '/inventory/inbound-shipments/s-1/boxes/b-1/receive',
      method: 'POST',
      bodyJson: JSON.stringify({ contractVersion: 2, idempotencyKey: 'k-receive' }),
      createdAt: Date.now(),
    });
    await runtime.store.finish('k-receive', 'uncertain');
    await readyReceived();
    await cancelTwice();
    expect(await screen.findByText('처리 여부를 먼저 확인해 주세요.')).toBeInTheDocument();
    expect(flash()).toBe('error');
    expect(server.cancels()).toHaveLength(0);
    expect(screen.queryByText(UNCERTAIN)).toBeNull();
    // 보낸 것이 없으니 «다시 보내기» 가 아니다 — 기기에 남긴 취소 키도 지웠다
    await waitFor(() => expect(keyButton(/F11\s*확정 취소/)).toBeInTheDocument());
    expect(keyButton(/다시 보내기/)).toBeNull();
    expect(await runtime.store.draft<string | null>('scope:draft:inbound-box-cancel:b-1:c-1')).toBeNull();
    expect(screen.getByRole('region', { name: '확정된 상자' })).toBeInTheDocument();
  });

  it('저절로 끝난 선적의 오늘 확정 상자도 찾기로 열려 F11 이 된다', async () => {
    const closed = base({ shipmentStatus: 'closed' });
    const candidate: BoxCandidate = {
      shipmentId: 's-1',
      shipmentName: '11월 2차 배편',
      expectedArrival: '2026-11-20',
      boxId: 'b-1',
      label: 'L7',
      disposition: 'stock',
      status: 'received',
      shipmentStatus: 'closed',
      previewItems: ['수강가방 미디엄'],
    };
    const { server } = await setup({ box: closed, found: [candidate] }, { initial: false });
    await typeHuman(['L']);
    const input = await screen.findByRole('searchbox', { name: '상자 이름' });
    fireEvent.change(input, { target: { value: 'L7' } });
    fireEvent.submit(input.closest('form')!);
    await readyReceived();
    expect(screen.getByText('끝남')).toBeInTheDocument();
    await cancelTwice();
    await screen.findByRole('region', { name: '상자 작업' });
    expect(server.cancels()).toHaveLength(1);
  });

  it('inboundShipmentOperate 가 없으면 F8·F9·F10·F11·F12 가 없다', async () => {
    const { queryClient } = await setup({}, { operate: false });
    await receivedRegion();
    await waitFor(() => expect(queryClient.getQueryState(['work-permissions'])?.status).toBe('success'));
    await waitFor(() => expect(keyButton(/Esc/)).toBeInTheDocument());
    for (const re of [/F8/, /F9/, /F10/, /F11/, /F12/]) expect(keyButton(re)).toBeNull();
    press('F11');
    await settle();
    expect(screen.queryByText(ARMED)).toBeNull();
  });
});

describe('끝', () => {
  /** 열린 상자 하나(자유 줄 하나) — F8 로 리스트대로, F10 두 번 */
  const openFree = (over: Partial<BoxView> = {}) =>
    base({ status: 'open', receiptId: null, receivedAt: null, lines: [LINES[1]], counts: [], ...over });

  async function receiveFree() {
    await screen.findByRole('table', { name: '상자 줄' });
    await waitFor(() => expect(keyButton(/F8\s*리스트대로/)).toBeInTheDocument());
    press('F8');
    await settle();
    press('F10');
    await screen.findByText('리스트와 같아요');
    press('F10');
  }

  it('완료음 + «L7 확정 — 적치 대기로 갔어요», 선적이 끝나면 «이 선적의 상자를 다 받았어요» · 다음 이름을 치기 전까지 F11', async () => {
    await setup({ box: openFree(), receiveShipmentStatus: 'closed' });
    await receiveFree();
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(screen.getByText('이 선적의 상자를 다 받았어요')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(screen.getByText('상자 이름을 입력하거나 스캔하세요')).toBeInTheDocument();
    await waitFor(() => expect(keyButton(/F11\s*확정 취소/)).toBeInTheDocument());
    await typeHuman(['L']);
    await screen.findByRole('searchbox', { name: '상자 이름' });
    await waitFor(() => expect(keyButton(/F11/)).toBeNull());
    expect(screen.queryByText(DONE)).toBeNull();
  });

  it('취소 키는 집계 id — receiptId 없는 상자를 확정→(끝에서) 취소→재확정→취소 하면 두 취소의 키가 다르다', async () => {
    // 첫 취소 뒤 키 지우기가 실패해 기기에 옛 키가 남아도 — 다음 확정의 취소는 다른 초안(집계 id)이라 그 키를 쓰지 않는다
    const inner = createOperationStore(crypto.randomUUID());
    let failDrop = true;
    const store: OperationStore = {
      ...inner,
      draft: async <T,>(id: string, update?: (previous: T | undefined) => T) => {
        if (update && failDrop && id.includes(':draft:inbound-box-cancel:') && update(undefined) === null) {
          failDrop = false;
          throw new Error('idb write failed');
        }
        return inner.draft<T>(id, update);
      },
    };
    const { server } = await setup({ box: openFree() }, { store });
    await receiveFree();
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    await waitFor(() => expect(keyButton(/F11\s*확정 취소/)).toBeInTheDocument());
    await cancelTwice();
    // 다시 열린 상자 — 빈칸에서
    await screen.findByRole('region', { name: '상자 작업' });
    await waitFor(() => expect(qtyCell('상자 작업', 'line:L2').getAttribute('data-state')).toBe('blank'));
    await receiveFree();
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    await waitFor(() => expect(keyButton(/F11\s*확정 취소/)).toBeInTheDocument());
    // 남은 옛 키가 이 확정의 취소 초안에 오지 않았다 — 끝에 그대로 있다(옛 결과를 되받아 «아직 확정» 으로 가지 않는다)
    await settle();
    expect(screen.getByText(DONE)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '확정된 상자' })).toBeNull();
    await cancelTwice();
    await screen.findByRole('region', { name: '상자 작업' });
    const cancels = server.cancels();
    expect(cancels).toHaveLength(2);
    expect(cancels[0].key).toBeTruthy();
    expect(cancels[1].key).not.toBe(cancels[0].key);
    expect(failDrop).toBe(false);
  });
});
