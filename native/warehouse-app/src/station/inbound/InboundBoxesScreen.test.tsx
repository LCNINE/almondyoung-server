import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import type { AddBoxResult, BoxCandidate, BoxView, ShipmentSummary } from '../../domains/inbound-shipment/types';
import { createTestRuntime } from '../outbound/__fixtures__/outboundServer';
import { press, renderStation, stationPrefs, typeHuman } from '../outbound/__fixtures__/renderStation';
import { InboundBoxesScreen } from './InboundBoxesScreen';
import { addableShipments } from './inboundBoxTypes';

type Req = Parameters<ApiClient['request']>[0];

const candidate = (over: Partial<BoxCandidate> = {}): BoxCandidate => ({
  shipmentId: 's-1',
  shipmentName: '11월 2차 배편',
  expectedArrival: '2026-11-20',
  boxId: 'b-1',
  label: 'L7',
  disposition: 'stock',
  status: 'open',
  shipmentStatus: 'expected',
  previewItems: ['수강가방 미디엄', '헤어끈'],
  ...over,
});

const view = (over: Partial<BoxView> = {}): BoxView => ({
  shipmentId: 's-1',
  shipmentName: '11월 2차 배편',
  shipmentStatus: 'expected',
  expectedArrival: '2026-11-20',
  boxId: 'b-1',
  label: 'L7',
  origin: 'list',
  disposition: 'stock',
  status: 'open',
  forwardNote: null,
  receiptId: null,
  receivedAt: null,
  lines: [],
  counts: [],
  ...over,
});

const summary = (over: Partial<ShipmentSummary> = {}): ShipmentSummary => ({
  id: 's-1',
  warehouseId: 'w-1',
  status: 'expected',
  name: '11월 2차 배편',
  expectedArrival: '2026-11-20',
  boxCount: 40,
  lineCount: 90,
  createdAt: '2026-11-01T00:00:00.000Z',
  closedAt: null,
  closedManually: false,
  ...over,
});

interface Fake {
  found?: BoxCandidate[] | ApiError;
  boxes?: Record<string, BoxView>;
  shipments?: ShipmentSummary[];
  /** 리스트에 없는 상자 더하기 응답 — 없으면 b-new. Error 면 던진다 */
  add?: () => AddBoxResult | Error;
}

interface Post {
  path: string;
  body: Record<string, unknown>;
  key: string | undefined;
}

function setup(fake: Fake = {}, opts: { operate?: boolean; initial?: { shipmentId: string; boxId: string } } = {}) {
  const calls: string[] = [];
  const posts: Post[] = [];
  const request = (async (o: Req) => {
    calls.push(o.path);
    if (o.path.startsWith('/inventory/inbound-shipment-boxes?')) {
      if (fake.found instanceof ApiError) throw fake.found;
      return fake.found ?? [];
    }
    if (o.path.startsWith('/inventory/inbound-shipments?')) {
      const statuses = (new URL(`http://x${o.path}`).searchParams.get('status') ?? '').split(',');
      return (fake.shipments ?? [summary()]).filter((s) => statuses.includes(s.status));
    }
    const add = /^\/inventory\/inbound-shipments\/([^/]+)\/boxes$/.exec(o.path);
    if (add && o.method === 'POST') {
      posts.push({ path: o.path, body: o.body as Record<string, unknown>, key: o.idempotencyKey });
      const outcome = fake.add?.() ?? { boxId: 'b-new', label: 'ZZ9', shipmentStatus: 'receiving' };
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
    const open = /^\/inventory\/inbound-shipments\/([^/]+)\/boxes\/([^/]+)$/.exec(o.path);
    if (open) {
      const box = fake.boxes?.[open[2]];
      if (!box) throw new ApiError(`GET ${o.path} → 404`, 404, 'NOT_FOUND');
      return box;
    }
    throw new Error(`unexpected ${o.path}`);
  }) as ApiClient['request'];
  const runtime = createTestRuntime({ request }, { inboundShipmentOperate: opts.operate ?? true });
  const rendered = renderStation(() => <InboundBoxesScreen initial={opts.initial} />, {
    runtime,
    prefs: stationPrefs(),
    path: '/inbound',
  });
  return { calls, posts, ...rendered };
}

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const searchBox = () => screen.findByRole('searchbox', { name: '상자 이름' });

async function search(label: string) {
  await typeHuman([label[0]]);
  const box = await searchBox();
  fireEvent.change(box, { target: { value: label } });
  const form = box.closest('form');
  if (!form) throw new Error('search form not found');
  fireEvent.submit(form);
}

describe('대기', () => {
  it('열린 선적을 안내한다 — 이름·도착일·상자 수', async () => {
    setup();
    expect(await screen.findByText('11월 2차 배편 · 11-20 도착 · 상자 40')).toBeInTheDocument();
  });

  it('친 그대로 label 로 찾는다 — 화면이 정규화하지 않는다', async () => {
    const { calls } = setup({ found: [candidate()], boxes: { 'b-1': view() } });
    await search('l7');
    await waitFor(() => expect(calls.some((p) => p.includes('inbound-shipment-boxes?'))).toBe(true));
    const find = calls.find((p) => p.includes('inbound-shipment-boxes?'));
    expect(new URL(`http://x${find}`).searchParams.get('label')).toBe('l7');
    expect(new URL(`http://x${find}`).searchParams.get('warehouseId')).toBe('w-1');
  });

  it('후보 1개면 바로 열린다 — 헤더에 선적 이름', async () => {
    setup({ found: [candidate()], boxes: { 'b-1': view() } });
    await search('l7');
    expect(await screen.findByText('11월 2차 배편 · 상자 L7 · 11-20 도착')).toBeInTheDocument();
  });

  it('후보 0개면 안내, 권한이 있으면 F12', async () => {
    setup({ found: [] }, { operate: true });
    await search('zz9');
    expect(await screen.findByText('이 이름의 상자가 열린 선적에 없어요')).toBeInTheDocument();
    // 기능키 바는 권한을 읽고 다음 렌더에 그린다
    await waitFor(() => expect(bar().getByText('리스트에 없는 상자로 받기')).toBeInTheDocument());
  });

  it('후보 0개 + 권한이 없으면 F12 가 없다', async () => {
    setup({ found: [] }, { operate: false });
    await search('zz9');
    expect(await screen.findByText('이 이름의 상자가 열린 선적에 없어요')).toBeInTheDocument();
    expect(bar().queryByText('리스트에 없는 상자로 받기')).toBeNull();
  });

  it('서버 400 문구를 그대로 띄운다', async () => {
    const error = new ApiError('GET /x → 400', 400, 'BAD_REQUEST', undefined, undefined, undefined, '범위 표기는 쓸 수 없어요: L5-L9');
    setup({ found: error });
    await search('L5-L9');
    expect(await screen.findByText('범위 표기는 쓸 수 없어요: L5-L9')).toBeInTheDocument();
  });
});

describe('고르기', () => {
  const two = [
    candidate(),
    candidate({
      shipmentId: 's-2',
      shipmentName: '11월 1차 배편',
      expectedArrival: '2026-11-12',
      boxId: 'b-2',
      previewItems: ['박스테이프', '용기 50ml'],
    }),
  ];
  const boxes = {
    'b-1': view(),
    'b-2': view({ shipmentId: 's-2', shipmentName: '11월 1차 배편', expectedArrival: '2026-11-12', boxId: 'b-2' }),
  };

  it('후보마다 선적 이름·도착일·미리보기를 보이고, Enter 만으로는 열리지 않는다', async () => {
    setup({ found: two, boxes });
    await search('L7');
    expect(await screen.findByText(/L7 이 선적 2곳에 있어요/)).toBeInTheDocument();
    expect(screen.getByText('11월 2차 배편 · 11-20 도착')).toBeInTheDocument();
    expect(screen.getByText('11월 1차 배편 · 11-12 도착')).toBeInTheDocument();
    expect(screen.getByText('수강가방 미디엄, 헤어끈')).toBeInTheDocument();
    expect(screen.getByText('박스테이프, 용기 50ml')).toBeInTheDocument();
    press('Enter');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/상자 L7 · /)).toBeNull();
  });

  it('끝난 선적 후보엔 «끝남», 확정된 상자 후보엔 «확정됨»', async () => {
    setup({
      found: [
        candidate({ shipmentStatus: 'closed', status: 'received' }),
        candidate({ shipmentId: 's-2', shipmentName: '11월 1차 배편', boxId: 'b-2', shipmentStatus: 'receiving', status: 'received' }),
        candidate({ shipmentId: 's-3', shipmentName: '11월 3차 배편', boxId: 'b-3' }),
      ],
    });
    await search('L7');
    await screen.findByText(/L7 이 선적 3곳에 있어요/);
    const options = screen.getAllByRole('option');
    expect(within(options[0]).getByText('끝남')).toBeInTheDocument();
    expect(within(options[0]).getByText('확정됨')).toBeInTheDocument();
    expect(within(options[1]).queryByText('끝남')).toBeNull();
    expect(within(options[1]).getByText('확정됨')).toBeInTheDocument();
    expect(within(options[2]).queryByText('끝남')).toBeNull();
    expect(within(options[2]).queryByText('확정됨')).toBeNull();
  });

  it('2 를 누르면 둘째가 열린다', async () => {
    setup({ found: two, boxes });
    await search('L7');
    await screen.findByText(/L7 이 선적 2곳에 있어요/);
    await typeHuman(['2']);
    expect(await screen.findByText('11월 1차 배편 · 상자 L7 · 11-12 도착')).toBeInTheDocument();
  });

  it('↓ + Enter 로도 고른다, Esc 는 대기로', async () => {
    setup({ found: two, boxes });
    await search('L7');
    await screen.findByText(/L7 이 선적 2곳에 있어요/);
    press('ArrowDown');
    press('Enter');
    expect(await screen.findByText('11월 2차 배편 · 상자 L7 · 11-20 도착')).toBeInTheDocument();
  });

  it('Esc 는 대기로 돌아간다', async () => {
    setup({ found: two, boxes });
    await search('L7');
    await screen.findByText(/L7 이 선적 2곳에 있어요/);
    press('Escape');
    expect(await screen.findByText('열린 선적')).toBeInTheDocument();
    expect(screen.queryByText(/L7 이 선적 2곳에 있어요/)).toBeNull();
  });
});

describe('열린 상자', () => {
  it('전달용 상자는 BigPanel 에 비고만, 기능키는 없다', async () => {
    setup({
      found: [candidate({ disposition: 'forward' })],
      boxes: { 'b-1': view({ disposition: 'forward', forwardNote: '거래처 직접 수령' }) },
    });
    await search('L7');
    expect(await screen.findByText('전달용 상자 — 재고로 받지 않아요')).toBeInTheDocument();
    expect(screen.getByText('거래처 직접 수령')).toBeInTheDocument();
    expect(bar().queryByText('리스트에 없는 상자로 받기')).toBeNull();
  });

  it('전달용 상자에서 Esc 는 대기로', async () => {
    setup({ found: [candidate({ disposition: 'forward' })], boxes: { 'b-1': view({ disposition: 'forward' }) } });
    await search('L7');
    await screen.findByText('전달용 상자 — 재고로 받지 않아요');
    press('Escape');
    expect(await screen.findByText('열린 선적')).toBeInTheDocument();
  });

  it('확정된 상자도 헤더를 그린다', async () => {
    setup({ found: [candidate({ status: 'received' })], boxes: { 'b-1': view({ status: 'received' }) } });
    await search('L7');
    expect(await screen.findByText('11월 2차 배편 · 상자 L7 · 11-20 도착')).toBeInTheDocument();
  });

  it('끝난 선적이면 «끝남» 표시', async () => {
    setup({
      found: [candidate({ shipmentStatus: 'closed' })],
      boxes: { 'b-1': view({ shipmentStatus: 'closed' }) },
    });
    await search('L7');
    expect(await screen.findByText('끝남')).toBeInTheDocument();
  });

  it('입고내역 링크로 들어오면 대기를 건너뛰고 그 상자가 바로 열린다', async () => {
    const { calls } = setup({ boxes: { 'b-1': view() } }, { initial: { shipmentId: 's-1', boxId: 'b-1' } });
    expect(await screen.findByText('11월 2차 배편 · 상자 L7 · 11-20 도착')).toBeInTheDocument();
    expect(calls.some((p) => p.includes('inbound-shipment-boxes?'))).toBe(false);
  });

  it('입고내역 링크의 상자가 없으면(404) 대기로 — 안내가 보인다', async () => {
    setup({ boxes: {} }, { initial: { shipmentId: 's-1', boxId: 'b-gone' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('찾을 수 없어요');
    expect(screen.getByText('상자 이름을 입력하거나 스캔하세요')).toBeInTheDocument();
  });
});

describe('고르기 문구', () => {
  it('선적 수에 맞게 — 세 곳이면 «선적 3곳»', async () => {
    const three = ['s-1', 's-2', 's-3'].map((id, i) => candidate({ shipmentId: id, boxId: `b-${i}`, shipmentName: `11월 ${i + 1}차 배편` }));
    setup({ found: three });
    await search('L7');
    expect(await screen.findByText('L7 이 선적 3곳에 있어요. 고르세요.')).toBeInTheDocument();
  });
});

describe('리스트에 없는 상자로 받기', () => {
  const added = view({ shipmentId: 's-1', boxId: 'b-new', label: 'ZZ9', origin: 'added', lines: [] });
  const shipments = [
    summary({ id: 's-1', status: 'closed', closedAt: new Date(Date.now() - 86_400_000).toISOString() }),
    summary({ id: 's-9', name: '10월 3차 배편', status: 'closed', closedAt: new Date().toISOString(), closedManually: true }),
  ];

  async function startAdd(fake: Fake) {
    const rendered = setup({ found: [], shipments, boxes: { 'b-new': added }, ...fake });
    await search('ZZ9');
    await screen.findByText('이 이름의 상자가 열린 선적에 없어요');
    await waitFor(() => expect(bar().getByText('리스트에 없는 상자로 받기')).toBeInTheDocument());
    press('F12');
    await screen.findByRole('listbox', { name: '선적 고르기' });
    return rendered;
  }

  it('F12 → 선적이 하나여도 고르기(«끝남» 표시, 사람이 닫은 선적은 없음, 기본 선택 없음) → 고르면 그 선적에 더하고 받은 상자를 연다', async () => {
    const { posts } = await startAdd({});
    expect(screen.getByText(/ZZ9 — 리스트에 없는 상자를 더할 선적을 고르세요/)).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(within(options[0]).getByText('끝남')).toBeInTheDocument();
    expect(screen.queryByText(/10월 3차 배편/)).toBeNull();
    // 기본 선택 없음 — Enter 만으로는 더하지 않는다
    press('Enter');
    await new Promise((r) => setTimeout(r, 50));
    expect(posts).toHaveLength(0);
    await typeHuman(['1']);
    const work = await screen.findByRole('region', { name: '상자 작업' });
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/inventory/inbound-shipments/s-1/boxes');
    expect(posts[0].body).toMatchObject({ label: 'ZZ9', contractVersion: 2, idempotencyKey: posts[0].key });
    expect(screen.getByText('11월 2차 배편 · 상자 ZZ9 · 11-20 도착')).toBeInTheDocument();
    await within(work).findByRole('table', { name: '상자 줄' });
    expect(work.querySelectorAll('tbody tr')).toHaveLength(0);
    // 리스트에 없던 물건 없이 확정하면 막는다
    await waitFor(() => expect(bar().queryByRole('button', { name: /F10/ })).toBeInTheDocument());
    press('F10');
    expect(await screen.findByText('리스트에 없던 물건을 하나 이상 넣어 주세요')).toBeInTheDocument();
  });

  it('Esc 는 대기로', async () => {
    const { posts } = await startAdd({});
    press('Escape');
    expect(await screen.findByText('상자 이름을 입력하거나 스캔하세요')).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('결과를 모르면 «결과를 확인하지 못했어요» — 같은 선적·같은 이름으로 다시 F12 하면 같은 키', async () => {
    let offline = true;
    const { posts } = await startAdd({ add: () => (offline ? new Error('network down') : { boxId: 'b-new', label: 'ZZ9', shipmentStatus: 'receiving' }) });
    await typeHuman(['1']);
    expect(await screen.findByText('결과를 확인하지 못했어요 — F12 다시 보내기')).toBeInTheDocument();
    const key = posts[0].key;
    expect(key).toBeTruthy();
    await waitFor(() => expect(bar().queryByRole('button', { name: /Esc/ })).toBeInTheDocument());
    press('Escape');
    await screen.findByText('상자 이름을 입력하거나 스캔하세요');

    offline = false;
    const before = posts.length;
    await search('ZZ9');
    await screen.findByText('이 이름의 상자가 열린 선적에 없어요');
    await waitFor(() => expect(bar().getByText('리스트에 없는 상자로 받기')).toBeInTheDocument());
    press('F12');
    await screen.findByRole('listbox', { name: '선적 고르기' });
    await typeHuman(['1']);
    await screen.findByRole('region', { name: '상자 작업' });
    const again = posts.slice(before);
    expect(again.length).toBeGreaterThan(0);
    for (const p of again) expect(p.key).toBe(key);
  });

  it('거절되면 문구를 띄우고 고르기에 남는다', async () => {
    const { posts } = await startAdd({ add: () => new ApiError('POST → 409', 409, 'CONFLICT') });
    await typeHuman(['1']);
    expect(await screen.findByText('이 선적에는 이 상자를 더할 수 없어요')).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(screen.getByRole('listbox', { name: '선적 고르기' })).toBeInTheDocument();
  });

  it('더할 수 있는 선적이 없으면 안내', async () => {
    setup({ found: [], shipments: [shipments[1]] });
    await search('ZZ9');
    await screen.findByText('이 이름의 상자가 열린 선적에 없어요');
    await waitFor(() => expect(bar().getByText('리스트에 없는 상자로 받기')).toBeInTheDocument());
    press('F12');
    expect(await screen.findByText('상자를 더할 수 있는 선적이 없어요')).toBeInTheDocument();
  });
});

describe('addableShipments', () => {
  const now = new Date('2026-11-16T00:00:00.000Z');
  it('expected·receiving 은 전부, 저절로 끝난 선적은 30일 안만', () => {
    const list = [
      summary({ id: 'a', status: 'expected' }),
      summary({ id: 'b', status: 'receiving' }),
      summary({ id: 'c', status: 'closed', closedAt: '2026-10-20T00:00:00.000Z' }),
      summary({ id: 'd', status: 'closed', closedAt: '2026-10-16T00:00:00.000Z' }),
      summary({ id: 'e', status: 'closed', closedAt: '2026-11-10T00:00:00.000Z', closedManually: true }),
      summary({ id: 'f', status: 'closed', closedAt: null }),
      summary({ id: 'g', status: 'draft' }),
    ];
    expect(addableShipments(list, now).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
