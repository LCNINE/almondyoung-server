import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { WorkRuntime } from '../../core/operations/OperationContext';
import { createOperationStore, type OperationStore } from '../../core/operations/operationStore';
import { applyList, createBoxDraft, setLineQty, toReceiveBody, type BoxDraft } from '../../domains/inbound-shipment/boxDraft';
import type { BoxLine, BoxView, ReceiveBoxResult } from '../../domains/inbound-shipment/types';
import { createTestRuntime } from '../outbound/__fixtures__/outboundServer';
import { flash, press, renderStation, scan, stationPrefs, typeHuman } from '../outbound/__fixtures__/renderStation';
import { InboundBoxesScreen } from './InboundBoxesScreen';

type Req = Parameters<ApiClient['request']>[0];

const UNCERTAIN = '결과를 확인하지 못했어요 — F10 다시 보내기';
const LIST_CHANGED_1 = '관리자가 리스트를 고쳤어요 — 1줄 다시 확인';
const DRAFT_ID = 'scope:draft:inbound-box:b-1';

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

/** 단일 줄 둘 · 범위 줄 하나 · 자유 줄 하나 — 빈칸 4줄로 시작한다 */
const LINES: BoxLine[] = [
  line({
    lineId: 'L1',
    skuId: 'sku-1',
    sku: { code: 'SKU-1023', name: '수강가방M' },
    productName: '수강가방 미디엄',
    option: '블랙',
    expectedQty: 40,
  }),
  line({
    lineId: 'L2',
    skuId: 'sku-2',
    sku: { code: 'SKU-1024', name: '수강가방L' },
    productName: '수강가방 라지',
    option: '블랙',
    expectedQty: 20,
  }),
  line({
    lineId: 'L3',
    skuId: 'sku-3',
    sku: { code: 'SKU-2001', name: '헤어끈' },
    productName: '헤어끈',
    option: '랜덤',
    expectedQty: 1076,
    coversBoxLabels: ['L5', 'L6', 'L7', 'L8', 'L9'],
    alreadyCountedInOtherBoxes: 612,
  }),
  line({ lineId: 'L4', kind: 'free', productName: '박스테이프', expectedQty: 2 }),
];

const view = (over: Partial<BoxView> = {}): BoxView => ({
  shipmentId: 's-1',
  shipmentName: '11월 2차 배편',
  shipmentStatus: 'receiving',
  expectedArrival: '2026-11-20',
  boxId: 'b-1',
  label: 'L7',
  origin: 'list',
  disposition: 'stock',
  status: 'open',
  forwardNote: null,
  receiptId: null,
  receivedAt: null,
  lines: LINES,
  counts: [],
  ...over,
});

const RESULT: ReceiveBoxResult = { boxId: 'b-1', receiptId: 'r-1', shipmentStatus: 'receiving', countIds: ['c-1'] };

interface SkuFixture {
  id: string;
  code: string;
  name: string;
  packingUnit?: number;
}
/** 바코드 → SKU. 880…06 은 입수 6 인 상자 바코드 */
const BARCODES: Record<string, SkuFixture> = {
  '8801001': { id: 'sku-1', code: 'SKU-1023', name: '수강가방M' },
  '880100106': { id: 'sku-1', code: 'SKU-1023', name: '수강가방M', packingUnit: 6 },
  '8809300': { id: 'sku-9', code: 'SKU-3300', name: '손거울' },
};

interface Sent {
  body: Record<string, unknown>;
  key: string | undefined;
}

interface Fake {
  /** 상자 열기 응답 — 부를 때마다 앞에서 하나씩, 마지막은 계속. Error 면 그 읽기가 실패한다. 확정이 한 번 성공한 뒤로는 received 로 */
  boxes: (BoxView | Error)[];
  /** 확정 응답 — 없으면 RESULT. 함수면 부를 때마다 판정 */
  receive?: () => ReceiveBoxResult | Error;
}

function createServer(fake: Fake) {
  const calls: string[] = [];
  const sent: Sent[] = [];
  let opened = 0;
  let received = false;
  const request = (async (o: Req) => {
    calls.push(`${o.method ?? 'GET'} ${o.path}`);
    if (o.path.startsWith('/inventory/inbound-shipment-boxes?')) return [];
    if (o.path.startsWith('/inventory/inbound-shipments?')) return [];
    if (o.path.startsWith('/inventory/skus?barcode=')) {
      const code = decodeURIComponent(o.path.split('=')[1]);
      const sku = BARCODES[code];
      return sku
        ? [{ id: sku.id, code: sku.code, name: sku.name, currentStock: 0, safetyStock: 0, barcodes: [{ id: `bc-${code}`, barcode: code, isPrimary: true, packingUnit: sku.packingUnit ?? null }] }]
        : [];
    }
    if (o.path.startsWith('/inventory/skus/search/advanced?')) {
      return { items: [{ id: 'sku-9', code: 'SKU-3300', name: '손거울', currentStock: 0, safetyStock: 0 }], total: 1 };
    }
    if (/\/boxes\/b-1\/receive$/.test(o.path)) {
      sent.push({ body: o.body as Record<string, unknown>, key: o.idempotencyKey });
      const outcome = fake.receive?.() ?? RESULT;
      if (outcome instanceof Error) throw outcome;
      received = true;
      return outcome;
    }
    if (/^\/inventory\/inbound-shipments\/s-1\/boxes\/b-1$/.test(o.path)) {
      const box = fake.boxes[Math.min(opened, fake.boxes.length - 1)];
      opened++;
      if (box instanceof Error) throw box;
      return received ? { ...box, status: 'received', receiptId: 'r-1' } : box;
    }
    throw new Error(`unexpected ${o.path}`);
  }) as ApiClient['request'];
  return { request, calls, sent, opens: () => opened };
}


function mount(runtime: WorkRuntime) {
  return renderStation(() => <InboundBoxesScreen initial={{ shipmentId: 's-1', boxId: 'b-1' }} />, {
    runtime,
    prefs: stationPrefs(),
    path: '/inbound',
  });
}

async function setup(
  fake: Partial<Fake> = {},
  opts: { operate?: boolean; store?: OperationStore; seed?: (runtime: WorkRuntime) => Promise<void> } = {}
) {
  const server = createServer({ boxes: [view()], ...fake });
  const runtime = createTestRuntime({ request: server.request }, { inboundShipmentOperate: opts.operate ?? true }, opts.store);
  await opts.seed?.(runtime);
  const rendered = mount(runtime);
  await ready();
  return { server, runtime, ...rendered };
}

/** 상자 작업이 뜨고 초안을 읽고 기능키가 걸릴 때까지 */
async function ready() {
  await screen.findByRole('region', { name: '상자 작업' });
  await screen.findByRole('table', { name: '상자 줄' });
  await waitFor(() => expect(bar().queryByRole('button', { name: /Esc/ })).not.toBeNull());
  await act(async () => {});
}

const region = () => screen.getByRole('region', { name: '상자 작업' });
const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const keyButton = (re: RegExp) => bar().queryByRole('button', { name: re });
function row(key: string): HTMLElement {
  const found = region().querySelector<HTMLElement>(`tr[data-row="${key}"]`);
  if (!found) throw new Error(`row ${key} not found`);
  return found;
}
const qtyCell = (key: string) => row(key).querySelector<HTMLElement>('[data-col="qty"]')!;
const qty = (key: string) => qtyCell(key).getAttribute('data-qty');
const cellState = (key: string) => qtyCell(key).getAttribute('data-state');
const selectedRow = () => region().querySelector<HTMLElement>('tr[aria-selected="true"]')?.getAttribute('data-row') ?? null;
const savedDraft = (runtime: WorkRuntime) => runtime.store.draft<BoxDraft | null>(DRAFT_ID);
const RECEIVE_PATH = '/inventory/inbound-shipments/s-1/boxes/b-1/receive';
const DONE = 'L7 확정 — 적치 대기로 갔어요';
const STALE = '앞서 보낸 확정이 취소됐어요 — 다시 세 주세요';

/** 네 줄을 다 채우고 보낸 초안 — 앱이 꺼지기 전에 F10 두 번까지 간 상태 */
function sentDraft(key: string): BoxDraft {
  let d = createBoxDraft(view(), key);
  d = applyList(d, LINES[0]);
  d = setLineQty(d, 'L2', 18);
  d = setLineQty(d, 'L3', 400);
  d = applyList(d, LINES[3]);
  return { ...d, sentBody: toReceiveBody(d, view()) };
}

/** 기기에 그 초안과, 같은 키의 끝난 작업(확정 또는 거절)을 남긴다 */
function seedSent(draft: BoxDraft, outcome: 'confirmed' | 'rejected') {
  return async (runtime: WorkRuntime) => {
    await runtime.store.draft<BoxDraft | null>(DRAFT_ID, () => draft);
    await runtime.store.begin({
      id: draft.key,
      scope: 'scope',
      resource: 'inbound-shipment-box:b-1',
      path: RECEIVE_PATH,
      method: 'POST',
      bodyJson: JSON.stringify({ ...draft.sentBody, contractVersion: 2, idempotencyKey: draft.key }),
      createdAt: Date.now(),
    });
    if (outcome === 'confirmed') await runtime.store.finish(draft.key, 'confirmed', RESULT);
    else await runtime.store.finish(draft.key, 'rejected', undefined, 'BAD_REQUEST', undefined, undefined, undefined, 400);
  };
}
const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 30));
});

/** 네 줄을 다 채운다 — L1 리스트대로 40, L2 18, L3 400, L4 리스트대로 2 */
async function fillAll() {
  press('F8');
  await typeHuman(['ArrowDown', '1', '8', 'Enter', '4', '0', '0', 'Enter']);
  press('F8');
  await settle();
}

async function confirmTwice() {
  press('F10');
  await screen.findByText(/L7 확정 — /);
  press('F10');
}

describe('상자 작업 — 칸', () => {
  it('처음엔 모든 칸이 빈칸이고 F10 → 오류음 + «빈칸 4줄», 커서가 첫 빈칸으로', async () => {
    await setup();
    expect(screen.getByText('11월 2차 배편 · 상자 L7 · 11-20 도착')).toBeInTheDocument();
    for (const id of ['L1', 'L2', 'L3', 'L4']) expect(cellState(`line:${id}`)).toBe('blank');
    await typeHuman(['ArrowDown', 'ArrowDown']);
    expect(selectedRow()).toBe('line:L3');
    press('F10');
    expect(await screen.findByText('빈칸 4줄')).toBeInTheDocument();
    expect(flash()).toBe('error');
    expect(selectedRow()).toBe('line:L1');
  });

  it('숫자 3·8 → 38(덮어쓰기 후 이어 치기), Enter 다음 줄, ↑↓ 이동, Esc 그 칸 되돌림', async () => {
    await setup();
    await typeHuman(['3', '8']);
    expect(qty('line:L1')).toBe('38');
    await typeHuman(['Enter']);
    expect(selectedRow()).toBe('line:L2');
    await typeHuman(['ArrowUp']);
    expect(selectedRow()).toBe('line:L1');
    // 줄을 옮긴 뒤 첫 숫자는 덮어쓴다
    await typeHuman(['5']);
    expect(qty('line:L1')).toBe('5');
    await waitFor(() => expect(keyButton(/Esc\s*되돌림/)).toBeInTheDocument());
    press('Escape');
    await waitFor(() => expect(qty('line:L1')).toBe('38'));
    // 되돌릴 것이 없으면 Esc 는 대기
    await waitFor(() => expect(keyButton(/Esc\s*대기/)).toBeInTheDocument());
    // 새로 넣은 칸을 되돌리면 빈칸으로
    await typeHuman(['ArrowDown', '7']);
    expect(qty('line:L2')).toBe('7');
    press('Escape');
    await waitFor(() => expect(cellState('line:L2')).toBe('blank'));
  });

  it('0 을 넣은 칸과 빈칸은 다른 모양이다', async () => {
    await setup();
    await typeHuman(['0']);
    expect(cellState('line:L1')).toBe('counted');
    expect(qty('line:L1')).toBe('0');
    expect(cellState('line:L2')).toBe('blank');
    expect(qtyCell('line:L1').className).not.toBe(qtyCell('line:L2').className);
  });

  it('Esc(되돌릴 것 없음)는 대기로 — 넣은 수량은 기기에 남아 다시 열면 이어진다', async () => {
    const { runtime } = await setup();
    await typeHuman(['ArrowDown', '9', 'ArrowDown']);
    press('Escape');
    expect(await screen.findByText('상자 이름을 입력하거나 스캔하세요')).toBeInTheDocument();
    expect((await savedDraft(runtime))?.cells.L2).toEqual({ qty: 9, method: 'counted' });
  });
});

describe('상자 작업 — 리스트대로', () => {
  it('F8: 단일 줄에 예정 수량 + 리스트대로 표시, 범위 줄에서는 기능키 바에 F8 이 없다', async () => {
    await setup();
    press('F8');
    await waitFor(() => expect(cellState('line:L1')).toBe('list'));
    expect(qty('line:L1')).toBe('40');
    await typeHuman(['ArrowDown', 'ArrowDown']);
    expect(selectedRow()).toBe('line:L3');
    await waitFor(() => expect(keyButton(/F8/)).toBeNull());
    await typeHuman(['ArrowDown']);
    await waitFor(() => expect(keyButton(/F8\s*리스트대로/)).toBeInTheDocument());
    // 숫자로 고친 «리스트대로» 칸은 센 것이 된다
    await typeHuman(['ArrowUp', 'ArrowUp', 'ArrowUp', '3']);
    expect(cellState('line:L1')).toBe('counted');
  });
});

describe('상자 작업 — 스캔', () => {
  it('상품 바코드 → 그 줄 +입수(입수 6 이면 +6), 다시 찍으면 더한다', async () => {
    const { server } = await setup();
    await typeHuman(['ArrowDown']);
    scan('880100106');
    await waitFor(() => expect(qty('line:L1')).toBe('6'));
    expect(server.calls).toContain('GET /inventory/skus?barcode=880100106');
    expect(selectedRow()).toBe('line:L1');
    expect(cellState('line:L1')).toBe('counted');
    scan('8801001');
    await waitFor(() => expect(qty('line:L1')).toBe('7'));
  });

  it('상자에 없는 SKU → «리스트에 없던 물건» 줄 + 주의음', async () => {
    await setup();
    scan('8809300');
    await waitFor(() => expect(region().querySelector('tr[data-row="unplanned:sku-9"]')).not.toBeNull());
    expect(row('unplanned:sku-9')).toHaveTextContent('리스트에 없던 물건');
    expect(row('unplanned:sku-9')).toHaveTextContent('손거울');
    expect(qty('unplanned:sku-9')).toBe('1');
    expect(flash()).toBe('attention');
    expect(selectedRow()).toBe('unplanned:sku-9');
    // 리스트에 없던 물건 줄에서는 F8 이 없다
    await waitFor(() => expect(keyButton(/F8/)).toBeNull());
    // 0 으로 만들면 줄을 지운다
    await typeHuman(['0']);
    await waitFor(() => expect(region().querySelector('tr[data-row="unplanned:sku-9"]')).toBeNull());
  });

  it('모르는 바코드 → 오류음 + «등록되지 않은 바코드예요»', async () => {
    await setup();
    scan('0000000');
    expect(await screen.findByText('등록되지 않은 바코드예요')).toBeInTheDocument();
    expect(flash()).toBe('error');
    expect(cellState('line:L1')).toBe('blank');
  });
});

describe('상자 작업 — F9 리스트에 없던 물건', () => {
  it('SKU 검색에서 고르면 리스트에 없던 물건 줄이 생기고 커서가 그 줄로 — 다음 숫자는 덮어쓴다', async () => {
    await setup();
    press('F9');
    const input = await screen.findByPlaceholderText('상품명·코드 검색');
    fireEvent.change(input, { target: { value: '손거울' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.click(await screen.findByRole('button', { name: '손거울 선택' }));
    await waitFor(() => expect(region().querySelector('tr[data-row="unplanned:sku-9"]')).not.toBeNull());
    expect(selectedRow()).toBe('unplanned:sku-9');
    expect(screen.queryByPlaceholderText('상품명·코드 검색')).toBeNull();
    await typeHuman(['3']);
    expect(qty('unplanned:sku-9')).toBe('3');
  });
});

describe('상자 작업 — 확정', () => {
  it('빈칸이 없으면 F10 → 확인 화면, 다시 F10 → 상자를 다시 읽고 lines 순서 전부 + method 를 초안 키로 보낸다', async () => {
    const { server, runtime } = await setup();
    await fillAll();
    scan('8809300');
    await waitFor(() => expect(region().querySelector('tr[data-row="unplanned:sku-9"]')).not.toBeNull());
    await waitFor(() => expect(keyButton(/F10\s*확정/)).toBeInTheDocument());
    press('F10');
    const review = await screen.findByRole('region', { name: '확정 확인' });
    expect(within(review).getByText('L7 확정 — 리스트와 다른 줄')).toBeInTheDocument();
    expect(within(review).getByText('리스트 20 → 18')).toBeInTheDocument();
    expect(within(review).getByText('이 상자 400 (합계 1,076 · 다른 상자 612)')).toBeInTheDocument();
    expect(within(review).getByText('손거울 (리스트에 없던 물건)')).toBeInTheDocument();
    // 같은 줄은 안 보인다
    expect(within(review).queryByText(/수강가방 미디엄/)).toBeNull();
    expect(server.sent).toHaveLength(0);

    const key = (await savedDraft(runtime))?.key;
    expect(key).toBeTruthy();
    const opensBefore = server.opens();
    press('F10');
    expect(await screen.findByText('L7 확정 — 적치 대기로 갔어요')).toBeInTheDocument();
    // 확정 직전 한 번, 확정 뒤 결과 확인 한 번
    expect(server.opens()).toBe(opensBefore + 2);
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0].key).toBe(key);
    expect(server.sent[0].body).toMatchObject({
      counts: [
        { lineId: 'L1', countedQty: 40, method: 'list' },
        { lineId: 'L2', countedQty: 18, method: 'counted' },
        { lineId: 'L3', countedQty: 400, method: 'counted' },
        { lineId: 'L4', countedQty: 2, method: 'list' },
      ],
      unplanned: [{ skuId: 'sku-9', quantity: 1 }],
    });
    // 계약 v2 봉투는 러너가 붙인다 — 같은 키가 본문에도 실린다
    expect(server.sent[0].body).toMatchObject({ contractVersion: 2, idempotencyKey: key });
    await waitFor(async () => expect(await savedDraft(runtime)).toBeNull());
  });

  it('다 맞으면 «리스트와 같아요», Esc 는 작업으로 돌아간다', async () => {
    await setup({ boxes: [view({ lines: [LINES[0]] })] });
    press('F8');
    await settle();
    press('F10');
    expect(await screen.findByText('리스트와 같아요')).toBeInTheDocument();
    await waitFor(() => expect(keyButton(/Esc\s*돌아가기/)).toBeInTheDocument());
    press('Escape');
    await waitFor(() => expect(screen.queryByRole('region', { name: '확정 확인' })).toBeNull());
    expect(qty('line:L1')).toBe('40');
  });

  it('두 번째 F10 에서 예정 수량이 바뀐 리스트대로 칸이 있으면 보내지 않고 «관리자가 리스트를 고쳤어요 — 1줄 다시 확인»', async () => {
    const changed = view({ lines: [{ ...LINES[0], expectedQty: 45 }, ...LINES.slice(1)] });
    const { server } = await setup({ boxes: [view(), changed] });
    await fillAll();
    await confirmTwice();
    expect(await screen.findByText(LIST_CHANGED_1)).toBeInTheDocument();
    expect(server.sent).toHaveLength(0);
    expect(screen.queryByRole('region', { name: '확정 확인' })).toBeNull();
    // 리스트대로 칸은 빈칸으로 되돌아갔고, 커서는 첫 줄
    expect(cellState('line:L1')).toBe('blank');
    expect(selectedRow()).toBe('line:L1');
    expect(qty('line:L2')).toBe('18');
  });

  it('두 번째 F10 에서 다시 읽은 상자가 이미 확정됐으면 보내지 않고 «다른 곳에서 이미 확정했어요» 후 다시 연다', async () => {
    const received = view({ status: 'received', receiptId: 'r-9' });
    const { server, runtime } = await setup({ boxes: [view(), received] });
    await fillAll();
    await confirmTwice();
    expect(await screen.findByText('다른 곳에서 이미 확정했어요')).toBeInTheDocument();
    expect(server.sent).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole('region', { name: '상자 작업' })).toBeNull());
    // 늦은 쪽이 넣던 수량은 버린다(§5.9)
    expect(await savedDraft(runtime)).toBeNull();
  });

  it('리스트에 없던 상자에 리스트에 없던 물건이 없으면 막는다', async () => {
    await setup({ boxes: [view({ origin: 'added', lines: [] })] });
    press('F10');
    expect(await screen.findByText('리스트에 없던 물건을 하나 이상 넣어 주세요')).toBeInTheDocument();
  });
});

describe('상자 작업 — 결과를 모를 때', () => {
  it('응답이 끊기면 칸이 잠기고 F10 은 같은 키·같은 본문으로 다시 — 다시 마운트해도 초안이 남는다', async () => {
    let offline = true;
    const fake: Partial<Fake> = { receive: () => (offline ? new Error('network down') : RESULT) };
    const first = await setup(fake);
    await fillAll();
    await confirmTwice();
    expect(await screen.findByText(UNCERTAIN)).toBeInTheDocument();
    await waitFor(() => expect(keyButton(/F10\s*다시 보내기/)).toBeInTheDocument());
    const firstKey = first.server.sent[0].key;
    expect(first.server.sent.every((s) => s.key === firstKey)).toBe(true);
    // 잠김 — 숫자 → 오류음, 칸 그대로
    await typeHuman(['ArrowUp', '5']);
    expect(flash()).toBe('error');
    expect(qty('line:L3')).toBe('400');

    // 앱 재시작 흉내 — 같은 기기 저장소로 다시 그린다
    first.unmount();
    const saved = await savedDraft(first.runtime);
    expect(saved?.key).toBe(firstKey);
    expect(saved?.cells.L2).toEqual({ qty: 18, method: 'counted' });
    const before = first.server.sent.length;
    mount(first.runtime);
    await ready();
    expect(await screen.findByText(UNCERTAIN)).toBeInTheDocument();
    expect(qty('line:L2')).toBe('18');
    await typeHuman(['7']);
    expect(flash()).toBe('error');
    expect(qty('line:L1')).toBe('40');

    offline = false;
    press('F10');
    expect(await screen.findByText('L7 확정 — 적치 대기로 갔어요')).toBeInTheDocument();
    const resent = first.server.sent.slice(before);
    expect(resent.length).toBeGreaterThan(0);
    for (const s of resent) {
      expect(s.key).toBe(firstKey);
      expect(s.body).toEqual(first.server.sent[0].body);
    }
    await waitFor(async () => expect(await savedDraft(first.runtime)).toBeNull());
  });

  it('4xx 거절 → 수량은 남고 새 키로 바뀐다(다음 전송의 키가 다르다)', async () => {
    let reject = true;
    const { server, runtime } = await setup({
      receive: () => (reject ? new ApiError('POST → 400', 400, 'BAD_REQUEST') : RESULT),
    });
    await fillAll();
    await confirmTwice();
    await waitFor(() => expect(server.sent).toHaveLength(1));
    await waitFor(() => expect(flash()).toBe('error'));
    expect(screen.queryByText(UNCERTAIN)).toBeNull();
    expect(qty('line:L2')).toBe('18');
    await waitFor(async () => expect((await savedDraft(runtime))?.key).not.toBe(server.sent[0].key));
    const draft = await savedDraft(runtime);
    expect(draft?.sentBody ?? null).toBeNull();
    // 잠기지 않았다 — 고칠 수 있다
    await typeHuman(['ArrowUp', 'ArrowUp', '1', '9']);
    expect(qty('line:L2')).toBe('19');

    reject = false;
    await confirmTwice();
    expect(await screen.findByText('L7 확정 — 적치 대기로 갔어요')).toBeInTheDocument();
    expect(server.sent).toHaveLength(2);
    expect(server.sent[1].key).not.toBe(server.sent[0].key);
    expect(server.sent[1].key).toBe(draft?.key);
  });

  it('409(다른 곳에서 확정) → «다른 곳에서 이미 확정했어요» 후 상자를 다시 읽는다, 넣던 수량은 버린다', async () => {
    const { server, runtime } = await setup({
      boxes: [view(), view(), view({ status: 'received', receiptId: 'r-9' })],
      receive: () => new ConflictError('이미 확정된 상자', 'CONFLICT'),
    });
    await fillAll();
    await confirmTwice();
    expect(await screen.findByText('다른 곳에서 이미 확정했어요')).toBeInTheDocument();
    // 처음 · 확정 직전 · 409 뒤 다시 읽기 · 확정된 상자로 다시 열기
    await waitFor(() => expect(server.opens()).toBe(4));
    await waitFor(() => expect(screen.queryByRole('region', { name: '상자 작업' })).toBeNull());
    expect(await savedDraft(runtime)).toBeNull();
  });
});

describe('상자 작업 — 다시 열기', () => {
  it('저장된 초안과 서버 줄이 어긋나면 «관리자가 리스트를 고쳤어요 — 1줄 다시 확인»', async () => {
    const server = createServer({ boxes: [view({ lines: [{ ...LINES[0], expectedQty: 45 }, ...LINES.slice(1)] })] });
    const runtime = createTestRuntime({ request: server.request }, { inboundShipmentOperate: true });
    const old = setLineQty(createBoxDraft(view(), 'k-old'), 'L2', 18);
    await runtime.store.draft<BoxDraft | null>(DRAFT_ID, () => ({ ...old, cells: { ...old.cells, L1: { qty: 40, method: 'list' } } }));
    mount(runtime);
    await ready();
    expect(await screen.findByText(LIST_CHANGED_1)).toBeInTheDocument();
    expect(cellState('line:L1')).toBe('blank');
    expect(qty('line:L2')).toBe('18');
    expect((await savedDraft(runtime))?.key).toBe('k-old');
  });
});

describe('상자 작업 — 고침 라운드', () => {
  it('Backspace 로 한 자리 칸을 지우면 빈칸이다(센 0 이 아니다)', async () => {
    await setup();
    await typeHuman(['4', '2', 'Backspace']);
    expect(qty('line:L1')).toBe('4');
    expect(cellState('line:L1')).toBe('counted');
    await typeHuman(['Backspace']);
    expect(cellState('line:L1')).toBe('blank');
  });

  it('스캔이 상한을 넘기면 오류음 · 그대로', async () => {
    await setup();
    await typeHuman(['1', '0', '0', '0', '0', '0', '0']);
    expect(qty('line:L1')).toBe('1000000');
    scan('8801001');
    await waitFor(() => expect(flash()).toBe('error'));
    expect(qty('line:L1')).toBe('1000000');
  });

  it('두 번째 F10 의 다시 읽기가 실패하면 보내지 않는다', async () => {
    const { server } = await setup({ boxes: [view(), new Error('network down')] });
    await fillAll();
    await confirmTwice();
    await waitFor(() => expect(flash()).toBe('error'));
    expect(server.sent).toHaveLength(0);
    expect(screen.queryByRole('region', { name: '확정 확인' })).toBeNull();
    expect(qty('line:L2')).toBe('18');
  });

  it('409 인데 다시 읽은 상자가 열려 있으면 수량은 남고 새 키로', async () => {
    const { server, runtime } = await setup({ receive: () => new ConflictError('선적이 닫혔어요', 'CONFLICT') });
    await fillAll();
    await confirmTwice();
    await waitFor(() => expect(server.sent).toHaveLength(1));
    await waitFor(async () => expect((await savedDraft(runtime))?.key).not.toBe(server.sent[0].key));
    expect(screen.queryByText('다른 곳에서 이미 확정했어요')).toBeNull();
    expect(screen.getByRole('region', { name: '상자 작업' })).toBeInTheDocument();
    expect(qty('line:L2')).toBe('18');
    expect((await savedDraft(runtime))?.sentBody ?? null).toBeNull();
  });

  it('기기의 확정 결과가 남았는데 상자가 다시 열려 있으면(그 사이 취소) «확정» 이 아니라 새 빈 초안', async () => {
    const draft = sentDraft('k-sent');
    const { server, runtime } = await setup({}, { seed: seedSent(draft, 'confirmed') });
    expect(await screen.findByText(STALE)).toBeInTheDocument();
    expect(screen.queryByText(DONE)).toBeNull();
    for (const id of ['L1', 'L2', 'L3', 'L4']) expect(cellState(`line:${id}`)).toBe('blank');
    const fresh = await savedDraft(runtime);
    expect(fresh?.key).toBeTruthy();
    expect(fresh?.key).not.toBe('k-sent');
    expect(fresh?.sentBody ?? null).toBeNull();
    expect(server.sent).toHaveLength(0);
    // 잠기지 않았다
    await typeHuman(['5']);
    expect(qty('line:L1')).toBe('5');
  });

  it('기기의 확정 결과가 남았고 상자가 확정돼 있으면 끝', async () => {
    const draft = sentDraft('k-sent');
    const { server, runtime } = await setup(
      { boxes: [view(), view({ status: 'received', receiptId: 'r-1' })] },
      { seed: seedSent(draft, 'confirmed') }
    );
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(server.sent).toHaveLength(0);
    await waitFor(async () => expect(await savedDraft(runtime)).toBeNull());
  });

  it('기기의 거절 결과가 남았으면 잠김이 풀리고 수량은 남고 새 키로', async () => {
    const draft = sentDraft('k-sent');
    const { server, runtime } = await setup({}, { seed: seedSent(draft, 'rejected') });
    await waitFor(async () => expect((await savedDraft(runtime))?.key).not.toBe('k-sent'));
    const now = await savedDraft(runtime);
    expect(now?.sentBody ?? null).toBeNull();
    expect(now?.cells.L2).toEqual({ qty: 18, method: 'counted' });
    expect(server.sent).toHaveLength(0);
    await waitFor(() => expect(screen.queryByText(UNCERTAIN)).toBeNull());
    await typeHuman(['ArrowDown', '9']);
    expect(qty('line:L2')).toBe('9');
  });

  it('열 때 작업 기록을 못 읽으면 잠긴 채 «결과를 확인하지 못했어요»', async () => {
    const base = createOperationStore(crypto.randomUUID());
    let failGet = true;
    const store: OperationStore = {
      ...base,
      get: async (id) => {
        if (failGet && id === 'k-sent') {
          failGet = false;
          throw new Error('idb read failed');
        }
        return base.get(id);
      },
    };
    await setup({}, { store, seed: seedSent(sentDraft('k-sent'), 'confirmed') });
    expect(await screen.findByText(UNCERTAIN)).toBeInTheDocument();
    await typeHuman(['7']);
    expect(flash()).toBe('error');
    expect(qty('line:L1')).toBe('40');
  });

  it('확정 뒤 초안 지우기가 실패해도 끝으로 간다', async () => {
    const base = createOperationStore(crypto.randomUUID());
    let failDelete = true;
    const store: OperationStore = {
      ...base,
      draft: async <T,>(id: string, update?: (previous: T | undefined) => T) => {
        if (update && failDelete && update(undefined) === null) {
          failDelete = false;
          throw new Error('idb write failed');
        }
        return base.draft<T>(id, update);
      },
    };
    const { server } = await setup({}, { store });
    await fillAll();
    await confirmTwice();
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(server.sent).toHaveLength(1);
    expect(failDelete).toBe(false);
  });
});

describe('상자 작업 — 권한', () => {
  it('확정 권한이 없으면 F8~F10 이 없고 칸은 읽기 전용', async () => {
    const { queryClient } = await setup({}, { operate: false });
    // 권한을 읽은 뒤에도 — 읽기 전에 숨는 것만으로는 판정이 아니다
    await waitFor(() => expect(queryClient.getQueryState(['work-permissions'])?.status).toBe('success'));
    await waitFor(() => expect(keyButton(/Esc/)).toBeInTheDocument());
    expect(keyButton(/F8/)).toBeNull();
    expect(keyButton(/F9/)).toBeNull();
    expect(keyButton(/F10/)).toBeNull();
    await typeHuman(['3']);
    expect(cellState('line:L1')).toBe('blank');
  });
});
