import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrintRaw } from '../../core/hardware/print/labelPrinter';
import type { OutboundBatchSummary } from '../../domains/outbound/types';
import { batchSummary, createOutboundServer, createTestRuntime, type FakeBox } from '../outbound/__fixtures__/outboundServer';
import { BOX1, BOX2, renderStation, stationPrefs } from '../outbound/__fixtures__/renderStation';
import { BatchStatusScreen } from './BatchStatusScreen';

const BOX3: FakeBox = {
  shipmentId: 's-3',
  trackingNo: '421033881923',
  batchId: 'b-3',
  recipient: '정*호',
  lines: [{ id: 'l-30', skuId: 'sku-30', name: '빗', qty: 1, barcode: '8801030' }],
};

const UNPRINTED_BOX3: FakeBox = { ...BOX3, labelState: 'never_printed' };

/** 관리자가 막 만든 시작 전 배치 */
const NEW_B3 = batchSummary({ id: 'b-3', batchNumber: 'B-1004', status: 'created', startedAt: null, totalItems: 1, totalBoxes: 1 });

function setupBatches(
  opts: {
    boxes?: FakeBox[];
    picking?: OutboundBatchSummary[];
    created?: OutboundBatchSummary[];
    legacy?: boolean;
    fail?: boolean;
    refills?: unknown[];
    since?: OutboundBatchSummary[];
    sinceFail?: boolean;
    print?: PrintRaw;
  } = {}
) {
  const server = createOutboundServer({ boxes: opts.boxes ?? [BOX1, { ...BOX2, shipped: true }, BOX3] });
  server.config.refills = opts.refills ?? [];
  server.config.batchesSince = opts.since ?? null;
  server.config.batchesSinceFail = opts.sinceFail ?? false;
  server.config.batches.picking = opts.picking ?? [batchSummary({ id: 'b-1', batchNumber: 'B-1002' })];
  server.config.batches.created = opts.created ?? [];
  server.config.legacyBatchStates = opts.legacy ?? false;
  server.config.batchesFail = opts.fail ?? false;
  const runtime = createTestRuntime(server);
  const prefs = stationPrefs();
  const print = vi.fn<PrintRaw>(opts.print ?? (async () => {}));
  const view = renderStation(() => <BatchStatusScreen prefs={prefs} print={print} />, { runtime, prefs, path: '/outbound/batches' });
  return { server, prefs, print, ...view };
}

function gatedPrint() {
  const releases: Array<() => void> = [];
  const print: PrintRaw = () => new Promise<void>((resolve) => releases.push(resolve));

  return { print, releaseNext: () => releases.shift()?.() };
}

const detail = () => screen.getByRole('region', { name: '배치 상세' });
/** 카드 머리의 배치 코드 줄 — 어느 배치를 보는지 */
const viewing = (code: string) => within(detail()).getByText(new RegExp(`^${code} · `));

describe('F2 배치 현황(스펙 §8, 목업 ⑤)', () => {
  it('배치 표 — 상자가 있는 시작 전 배치를 «새 배치»로 맨 위에, 진행 중 다음, 진행 완료/전체', async () => {
    setupBatches({ created: [NEW_B3] });
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('B-1004');
    expect(first).toHaveTextContent('새 배치');
    expect(second).toHaveTextContent('B-1002');
    expect(second).toHaveTextContent('진행 중');
    await waitFor(() => expect(second).toHaveTextContent('1/2'));
    expect(viewing('B-1004')).toBeInTheDocument();
  });

  it('상자가 없는 시작 전 배치는 아래에 접어 두고, 누르면 펼친다', async () => {
    const empty = batchSummary({ id: 'b-9', batchNumber: 'B-1009', status: 'created', startedAt: null, totalItems: 0, totalBoxes: 0 });
    setupBatches({ created: [empty, NEW_B3] });
    const table = await screen.findByRole('table');
    await screen.findByRole('button', { name: 'B-1004' });
    expect(within(table).queryByRole('button', { name: 'B-1009' })).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: /빈 배치 1개 보기/ }));
    const last = within(table).getAllByRole('row').at(-1);
    expect(last).toHaveTextContent('B-1009');
    expect(last).toHaveTextContent('빈 배치');
    fireEvent.click(within(table).getByRole('button', { name: '빈 배치 1개 접기' }));
    expect(within(table).queryByRole('button', { name: 'B-1009' })).toBeNull();
  });

  it('고른 빈 배치를 접으면 보이는 맨 위 배치를 본다', async () => {
    const empty = batchSummary({ id: 'b-9', batchNumber: 'B-1009', status: 'created', startedAt: null, totalItems: 0, totalBoxes: 0 });
    setupBatches({ created: [empty] });
    await screen.findByRole('button', { name: 'B-1002' });
    fireEvent.click(screen.getByRole('button', { name: /빈 배치 1개 보기/ }));
    fireEvent.click(screen.getByRole('button', { name: 'B-1009' }));
    await waitFor(() => expect(viewing('B-1009')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '빈 배치 1개 접기' }));
    await waitFor(() => expect(viewing('B-1002')).toBeInTheDocument());
  });

  it('빈 배치만 있을 때 보던 빈 배치는 진행할 배치가 새로 들어와도 그대로 본다', async () => {
    const empty = batchSummary({ id: 'b-9', batchNumber: 'B-1009', status: 'created', startedAt: null, totalItems: 0, totalBoxes: 0 });
    const { server, queryClient } = setupBatches({ picking: [], created: [empty] });
    await waitFor(() => expect(viewing('B-1009')).toBeInTheDocument());
    server.config.batches.created = [empty, NEW_B3];
    await queryClient.refetchQueries({ queryKey: ['outbound-batches'] });
    await screen.findByRole('button', { name: 'B-1004' });
    expect(viewing('B-1009')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B-1009' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '빈 배치 1개 접기' })).toBeInTheDocument();
  });

  it('진행할 배치가 없으면 빈 배치를 접지 않고 그대로 보인다', async () => {
    const empty = batchSummary({ id: 'b-9', batchNumber: 'B-1009', status: 'created', startedAt: null, totalItems: 0, totalBoxes: 0 });
    setupBatches({ picking: [], created: [empty] });
    expect(await screen.findByRole('button', { name: 'B-1009' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /빈 배치 1개/ })).toBeNull();
  });

  it('보던 배치는 새 배치가 맨 위로 들어와도 바뀌지 않는다', async () => {
    const { server, queryClient } = setupBatches();
    await waitFor(() => expect(viewing('B-1002')).toBeInTheDocument());
    server.config.batches.created = [NEW_B3];
    await queryClient.refetchQueries({ queryKey: ['outbound-batches'] });
    await screen.findByRole('button', { name: 'B-1004' });
    expect(viewing('B-1002')).toBeInTheDocument();
  });

  it('상단에 시작 전 배치와 상자 수를 알리고, 누르면 배치 현황으로 간다', async () => {
    setupBatches({ created: [NEW_B3, batchSummary({ id: 'b-4', batchNumber: 'B-1005', status: 'created', startedAt: null, totalItems: 5, totalBoxes: 3 })] });
    const notice = await screen.findByRole('link', { name: /시작 전 배치 2개 · 4상자/ });
    expect(notice).toHaveAttribute('href', '/outbound/batches');
  });

  it('옛 core(상자 수 없음)면 알림에 배치 수만 — 줄 수를 상자로 세지 않는다', async () => {
    setupBatches({ created: [batchSummary({ id: 'b-3', batchNumber: 'B-1004', status: 'created', startedAt: null, totalItems: 2 })] });
    const notice = await screen.findByRole('link', { name: /시작 전 배치 1개/ });
    expect(notice).not.toHaveTextContent('상자');
  });

  it('시작 전 배치가 없으면 알림을 띄우지 않는다', async () => {
    setupBatches();
    await screen.findByRole('button', { name: 'B-1002' });
    expect(screen.queryByRole('link', { name: /시작 전 배치/ })).toBeNull();
  });

  it('배치 코드 옆에 관리자 화면의 배치 이름을 함께 보여 준다', async () => {
    setupBatches({ created: [{ ...NEW_B3, name: '11/12 개별피킹 17:13:48' }] });
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('11/12 개별피킹 17:13:48');
    expect(second).toHaveTextContent('오전');
    fireEvent.click(screen.getByRole('button', { name: 'B-1004' }));
    await waitFor(() => expect(viewing('B-1004')).toBeInTheDocument());
    expect(detail()).toHaveTextContent('11/12 개별피킹 17:13:48');
  });

  it('고른 배치의 건수와 미완료 박스 — 송장번호·받는 분·상태', async () => {
    setupBatches();
    await waitFor(() => expect(within(detail()).getByLabelText('완료')).toHaveTextContent('1'));
    expect(within(detail()).getByLabelText('대기')).toHaveTextContent('1');
    const boxes = await screen.findByRole('list', { name: '박스' });
    expect(within(boxes).getAllByRole('listitem')).toHaveLength(1);
    expect(boxes).toHaveTextContent('4210-3388-1907');
    expect(boxes).toHaveTextContent('김*영');
    expect(boxes).toHaveTextContent('대기');
  });

  it('빠지는 중인 상자가 있으면 F1 에서 송장을 찍어 상품을 꺼내라고 안내한다', async () => {
    setupBatches({ boxes: [{ ...BOX1, labelState: 'withdrawing' }, BOX3] });
    await screen.findByRole('region', { name: '배치 상세' });
    expect(await within(detail()).findByText(/빠지는 중인 상자는 F1 출고 검수에서 송장을 찍고/)).toBeInTheDocument();
  });

  it('빠지는 중인 상자가 없으면 그 안내를 보이지 않는다', async () => {
    setupBatches();
    await screen.findByRole('region', { name: '배치 상세' });
    await waitFor(() => expect(within(detail()).getByLabelText('대기')).toHaveTextContent('1'));
    expect(within(detail()).queryByText(/빠지는 중인 상자는/)).toBeNull();
  });

  it('송장을 손볼 박스가 위로 — «재출력»', async () => {
    setupBatches({ boxes: [BOX2, { ...BOX1, labelState: 'reprint_required' }, BOX3] });
    const boxes = await screen.findByRole('list', { name: '박스' });
    await waitFor(() => expect(within(boxes).getAllByRole('listitem')).toHaveLength(2));
    const [first, second] = within(boxes).getAllByRole('listitem');
    expect(first).toHaveTextContent('4210-3388-1907');
    expect(first).toHaveTextContent('재출력');
    expect(second).toHaveTextContent('4210-3388-1915');
  });

  it('배치를 누르면 그 배치를 본다 — 시작 전 배치엔 시작 단추만', async () => {
    setupBatches({ created: [NEW_B3] });
    fireEvent.click(await screen.findByRole('button', { name: 'B-1002' }));
    await waitFor(() => expect(viewing('B-1002')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'B-1004' }));
    await waitFor(() => expect(viewing('B-1004')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '배치 시작' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '박스 넣기' })).toBeNull();
  });

  it('배치 시작 한 번으로 시작하고 확인창 없이 송장을 뽑아 F1 으로 이어 준다', async () => {
    const { server } = setupBatches({ boxes: [BOX1, UNPRINTED_BOX3], created: [NEW_B3] });
    fireEvent.click(await screen.findByRole('button', { name: '배치 시작' }));
    expect(await screen.findByText('이제 F1 출고 검수에서 송장을 찍으세요.')).toBeInTheDocument();
    expect(server.requests.filter((r) => r.path === '/picking/v2/starts')).toHaveLength(1);
    expect(server.confirmedPrints).toEqual(['s-3']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('이미 나간 송장이 있으면 시작 뒤 인쇄 전에 확인창으로 묻는다', async () => {
    const { server } = setupBatches({ boxes: [BOX1, { ...BOX3, labelState: 'current' }], created: [NEW_B3] });
    fireEvent.click(await screen.findByRole('button', { name: '배치 시작' }));
    expect(await screen.findByText(/이미 인쇄한 송장이 1건 있어요/)).toBeInTheDocument();
    expect(server.confirmedPrints).toEqual([]);
  });

  it('시작해서 뽑은 배치를 다른 배치로 갔다 돌아와도 다시 뽑지 않는다', async () => {
    const { server } = setupBatches({ boxes: [BOX1, UNPRINTED_BOX3], created: [NEW_B3] });
    fireEvent.click(await screen.findByRole('button', { name: '배치 시작' }));
    await screen.findByText('이제 F1 출고 검수에서 송장을 찍으세요.');
    fireEvent.click(screen.getByRole('button', { name: 'B-1002' }));
    await waitFor(() => expect(viewing('B-1002')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'B-1004' }));
    await waitFor(() => expect(viewing('B-1004')).toBeInTheDocument());
    expect(await screen.findByRole('button', { name: '송장 일괄 출력' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(server.confirmedPrints).toEqual(['s-3']);
  });

  it('송장을 인쇄한 배치를 기기에 남긴다 — 출고 검수가 송장을 찍기 전에도 지금 배치를 보인다', async () => {
    const { prefs } = setupBatches();
    fireEvent.click(await screen.findByRole('button', { name: '송장 일괄 출력' }));
    expect(prefs.get('almondwms.outbound.lastBatch')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '인쇄' }));
    await waitFor(() =>
      expect(JSON.parse(prefs.get('almondwms.outbound.lastBatch') ?? 'null')).toEqual({ id: 'b-1', batchNumber: 'B-1002', name: '오전' })
    );
  });

  it('시작된 배치엔 송장 일괄 출력·박스 넣기·박스 빼기 — 박스 빼기 패널이 열린다', async () => {
    setupBatches();
    expect(await screen.findByRole('button', { name: '송장 일괄 출력' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '박스 넣기' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '박스 빼기' }));
    expect(await screen.findByText('이 배치에서 박스 빼기')).toBeInTheDocument();
  });

  it('시작된 배치의 «피킹 목록»(보조)을 누르면 그 배치의 피킹 목록으로 간다', async () => {
    const { router } = setupBatches();
    const button = await screen.findByRole('button', { name: '피킹 목록' });
    expect(button.className).toContain('bg-white');
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound/batches/b-1/pick-list'));
  });

  it('피킹 목록에서 돌아오면 보던 배치를 다시 본다', async () => {
    const { router } = setupBatches({
      picking: [batchSummary({ id: 'b-1', batchNumber: 'B-1002' }), batchSummary({ id: 'b-2', batchNumber: 'B-1003' })],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'B-1003' }));
    await waitFor(() => expect(viewing('B-1003')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '피킹 목록' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound/batches/b-2/pick-list'));
    await router.navigate({ to: '/outbound/batches', state: { batchId: 'b-2' } });
    await waitFor(() => expect(viewing('B-1003')).toBeInTheDocument());
  });

  it('목록을 새로 받는 동안 돌아와도 보던 배치를 놓치지 않는다', async () => {
    const { router, server, queryClient } = setupBatches({
      picking: [batchSummary({ id: 'b-1', batchNumber: 'B-1002' }), batchSummary({ id: 'b-2', batchNumber: 'B-1003' })],
    });
    await screen.findByRole('button', { name: 'B-1003' });
    await router.navigate({ to: '/outbound/batches/$batchId/pick-list', params: { batchId: 'b-2' } });
    queryClient.clear();
    const release = server.holdLists();
    await router.navigate({ to: '/outbound/batches', state: { batchId: 'b-2' } });
    await screen.findByText('배치 목록을 불러오고 있어요.');
    release();
    await waitFor(() => expect(viewing('B-1003')).toBeInTheDocument());
  });

  it('시작 전 목록만 실패해도 보이는 배치를 붙잡는다 — 새 배치가 위로 들어와도 바뀌지 않는다', async () => {
    const { server, queryClient } = setupBatches({
      picking: [batchSummary({ id: 'b-1', batchNumber: 'B-1002' }), batchSummary({ id: 'b-2', batchNumber: 'B-1003' })],
    });
    server.config.batchesFailStatus = 'created';
    queryClient.clear();
    await waitFor(() => expect(viewing('B-1002')).toBeInTheDocument());
    await screen.findByText(/배치 목록을 불러오지 못했어요/);
    server.config.batches.picking = [batchSummary({ id: 'b-0', batchNumber: 'B-1001' }), ...server.config.batches.picking];
    await queryClient.refetchQueries({ queryKey: ['outbound-batches'] });
    await screen.findByRole('button', { name: 'B-1001' });
    expect(viewing('B-1002')).toBeInTheDocument();
  });

  it('시작 전 배치엔 «피킹 목록»이 없다 — 배정은 시작할 때 생긴다', async () => {
    setupBatches({ picking: [], created: [NEW_B3] });
    expect(await screen.findByRole('button', { name: '배치 시작' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '피킹 목록' })).toBeNull();
  });

  it('시작된 배치의 주 버튼 자리는 눌리지 않는 배치 시작됨, 송장 일괄 출력·박스 넣기·빼기는 흰 보조 단추다', async () => {
    setupBatches();
    const printButton = await screen.findByRole('button', { name: '송장 일괄 출력' });
    expect(printButton.className).toContain('bg-white');
    expect(printButton).toBeEnabled();
    const started = screen.getByRole('button', { name: '배치 시작됨' });
    expect(started).toBeDisabled();
    expect(started.className).not.toContain('bg-white');
    expect(screen.queryByRole('button', { name: '배치 시작' })).toBeNull();
    expect(screen.getByRole('button', { name: '박스 넣기' }).className).toContain('bg-white');
    expect(screen.getByRole('button', { name: '박스 빼기' }).className).toContain('bg-white');
  });

  it('시작 전 배치엔 송장 일괄 출력이 꺼져 있고 배치 시작이 주 버튼이다', async () => {
    setupBatches({ picking: [], created: [NEW_B3] });
    const start = await screen.findByRole('button', { name: '배치 시작' });
    expect(start.className).not.toContain('bg-white');
    expect(screen.getByRole('button', { name: '송장 일괄 출력' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '배치 시작됨' })).toBeNull();
  });

  it('머리글은 배치 현황과 설명, 오른쪽에 오늘 만든 배치 수', async () => {
    const today = new Date().toISOString();
    setupBatches({
      picking: [batchSummary({ id: 'b-1', batchNumber: 'B-1002', createdAt: today })],
      created: [{ ...NEW_B3, createdAt: today }, batchSummary({ id: 'b-5', batchNumber: 'B-0990', createdAt: '2026-01-02T00:00:00.000Z' })],
    });
    expect(await screen.findByRole('heading', { level: 1, name: '배치 현황' })).toBeInTheDocument();
    expect(screen.getByText('배치를 선택하고, 송장과 진행 상황을 확인하세요.')).toBeInTheDocument();
    expect(await screen.findByText('오늘 2개 배치')).toBeInTheDocument();
  });

  it('만든 시각을 싣지 않는 옛 core 면 오늘 배치 수를 지어내지 않는다', async () => {
    setupBatches();
    await screen.findByRole('button', { name: 'B-1002' });
    expect(screen.queryByText(/오늘 \d+개 배치/)).toBeNull();
  });

  it('배치 카드 머리 — 이름, 코드·상자 수', async () => {
    setupBatches();
    await screen.findByRole('region', { name: '배치 상세' });
    expect(await within(detail()).findByRole('heading', { level: 2, name: '오전' })).toBeInTheDocument();
    await waitFor(() => expect(viewing('B-1002')).toHaveTextContent('B-1002 · 2상자'));
  });

  it('진행 — 검수 완료 n / N상자 막대와 보충 대기·확인 필요 요약', async () => {
    setupBatches({
      boxes: [{ ...BOX1, labelState: 'never_printed' }, { ...BOX2, shipped: true }, { ...BOX3, batchId: 'b-1' }],
      refills: [{ shipmentId: 's-3', trackingNo: '421033881923', recipientMasked: '정*호', items: [] }],
    });
    await screen.findByRole('region', { name: '배치 상세' });
    const bar = await within(detail()).findByRole('progressbar', { name: '검수 진행' });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '1'));
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(detail()).toHaveTextContent('검수 완료 1 / 3상자');
    await waitFor(() => expect(detail()).toHaveTextContent('보충 대기 1 · 확인 필요 1'));
  });

  it('상자 줄 — 송장번호·받는 분·상태 표시, 보충 대기 상자는 보충 대기로', async () => {
    setupBatches({
      boxes: [{ ...BOX1, labelState: 'never_printed' }, { ...BOX2, workItemStatus: 'picking' }, { ...BOX3, batchId: 'b-1' }],
      refills: [{ shipmentId: 's-3', trackingNo: '421033881923', recipientMasked: '정*호', items: [] }],
    });
    const boxes = await screen.findByRole('list', { name: '박스' });
    await waitFor(() => expect(within(boxes).getAllByRole('listitem')).toHaveLength(3));
    const [first, second, third] = within(boxes).getAllByRole('listitem');
    expect(first).toHaveTextContent('4210-3388-1907');
    expect(first).toHaveTextContent('김*영');
    expect(within(first).getByText('미출력')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: '출력 확인' })).toBeInTheDocument();
    expect(within(first).queryByRole('button', { name: '상자 보기' })).toBeNull();
    await waitFor(() => expect(within(second).getByText('보충 대기')).toBeInTheDocument());
    expect(second).toHaveTextContent('4210-3388-1923');
    expect(within(third).getByText('검수 중')).toBeInTheDocument();
    expect(within(third).getByRole('button', { name: '상자 보기' })).toBeInTheDocument();
  });

  it('출력 확인은 그 상자 송장만 뽑는다', async () => {
    const { server } = setupBatches({ boxes: [{ ...BOX1, labelState: 'never_printed' }, BOX2] });
    const boxes = await screen.findByRole('list', { name: '박스' });
    fireEvent.click(await within(boxes).findByRole('button', { name: '출력 확인' }));
    await waitFor(() => expect(server.confirmedPrints).toEqual(['s-1']));
    await waitFor(() => expect(within(boxes).queryByText('미출력')).toBeNull());
    expect(within(boxes).queryByRole('button', { name: '출력 확인' })).toBeNull();
    expect(within(boxes).getAllByRole('button', { name: '상자 보기' })).toHaveLength(2);
  });

  it('상자 보기는 그 상자를 출고 검수에서 연다', async () => {
    const { router, prefs } = setupBatches();
    const boxes = await screen.findByRole('list', { name: '박스' });
    fireEvent.click(await within(boxes).findByRole('button', { name: '상자 보기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
    expect(JSON.parse(prefs.get('almondwms.outbound.lastBox') ?? 'null')).toMatchObject({ shipmentId: 's-1', trackingNo: '421033881907' });
  });

  it('상자 보기 조회가 실패하면 머물러 알린다', async () => {
    const { router, server, prefs } = setupBatches();
    const boxes = await screen.findByRole('list', { name: '박스' });
    server.config.lookupFail = true;
    fireEvent.click(await within(boxes).findByRole('button', { name: '상자 보기' }));
    expect(await within(detail()).findByRole('alert')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/outbound/batches');
    expect(prefs.get('almondwms.outbound.lastBox')).toBeNull();
  });

  it('송장을 인쇄하면 F1 출고 검수에서 송장을 찍으라고 이어 준다', async () => {
    setupBatches();
    fireEvent.click(await screen.findByRole('button', { name: '송장 일괄 출력' }));
    fireEvent.click(await screen.findByRole('button', { name: '인쇄' }));
    expect(await screen.findByText('이제 F1 출고 검수에서 송장을 찍으세요.')).toBeInTheDocument();
  });

  it('옛 core(송장번호 없음)면 박스 목록 없이 건수만', async () => {
    setupBatches({ legacy: true });
    await waitFor(() => expect(within(detail()).getByLabelText('완료')).toHaveTextContent('1'));
    expect(within(detail()).queryByRole('list', { name: '박스' })).toBeNull();
  });

  it('상태바에 고른 배치의 진행', async () => {
    setupBatches();
    expect(await screen.findByText('B-1002 1/2')).toBeInTheDocument();
  });

  it('배치가 없으면 한 줄', async () => {
    setupBatches({ picking: [], created: [] });
    expect(await screen.findByText('진행 중인 배치가 없어요.')).toBeInTheDocument();
  });

  it('불러오는 동안은 빈 표가 아니라 불러오는 중이라고 보인다', async () => {
    setupBatches();
    expect(await screen.findByText('배치 목록을 불러오고 있어요.')).toBeInTheDocument();
    await screen.findByRole('button', { name: 'B-1002' });
    expect(screen.queryByText('배치 목록을 불러오고 있어요.')).toBeNull();
  });

  it('조회가 실패하면 빈 표 대신 실패를 알리고, 다시 확인하면 배치를 보인다', async () => {
    const { server } = setupBatches({ fail: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('배치 목록을 불러오지 못했어요.');
    expect(screen.queryByText('진행 중인 배치가 없어요.')).toBeNull();

    const release = server.holdLists();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    expect(await screen.findByRole('button', { name: '확인하는 중…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('배치 목록을 불러오지 못했어요.');
    expect(screen.queryByText('배치 목록을 불러오고 있어요.')).toBeNull();

    server.config.batchesFail = false;
    release();
    expect(await screen.findByRole('button', { name: 'B-1002' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('이미 읽은 배치는 갱신이 실패해도 남기고, 마지막으로 불러온 상태라고 알린다', async () => {
    const { server, queryClient } = setupBatches();
    await screen.findByRole('button', { name: 'B-1002' });

    server.config.batchesFail = true;
    await queryClient.refetchQueries({ queryKey: ['outbound-batches'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('마지막으로 불러온');
    expect(screen.getByRole('button', { name: 'B-1002' })).toBeInTheDocument();
  });

  it('오늘 배치 수는 오늘 만든 배치 전체 조회로 센다 — 끝난 배치도 세고 취소한 배치는 뺀다', async () => {
    const today = new Date().toISOString();
    const { server } = setupBatches({
      since: [
        batchSummary({ id: 'b-1', batchNumber: 'B-1002', createdAt: today }),
        batchSummary({ id: 'b-7', batchNumber: 'B-1007', status: 'completed', createdAt: today }),
        batchSummary({ id: 'b-8', batchNumber: 'B-1008', status: 'completed', createdAt: today }),
        batchSummary({ id: 'b-9', batchNumber: 'B-1009', status: 'canceled', createdAt: today }),
      ],
    });
    expect(await screen.findByText('오늘 3개 배치')).toBeInTheDocument();
    const since = server.requests.find((r) => r.path.includes('createdFrom='));
    expect(since?.path).toMatch(/^\/outbound-batches\/v2\?warehouseId=w-1&createdFrom=/);
    expect(since?.path).not.toContain('status=');
  });

  it('오늘 배치 조회가 실패하면 모자란 숫자를 보이지 않는다', async () => {
    setupBatches({ since: [batchSummary({ id: 'b-1', batchNumber: 'B-1002', createdAt: new Date().toISOString() })], sinceFail: true });
    await screen.findByRole('button', { name: 'B-1002' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/오늘 \d+개 배치/)).toBeNull();
  });

  it('상자 줄은 주문 번호를 크게, 택배사·종 수와 송장번호·받는 분을 작게 보인다', async () => {
    setupBatches({ boxes: [{ ...BOX1, orderNos: ['20261126-0001', '20261126-0002'] }, BOX2] });
    const boxes = await screen.findByRole('list', { name: '박스' });
    const first = await within(boxes).findByText('20261126-0001 외 1건');
    const line = first.closest('li');
    expect(line).not.toBeNull();
    expect(line).toHaveTextContent('한진택배 · 2종');
    expect(line).toHaveTextContent('4210-3388-1907 · 김*영');
    expect(within(boxes).getByText('4210-3388-1915')).toBeInTheDocument();
  });

  it('시작 전 배치의 상자엔 상자 보기가 없고 배치를 먼저 시작하라고 알린다', async () => {
    setupBatches({ picking: [], created: [NEW_B3], boxes: [BOX1, { ...BOX3, labelState: 'not_started' }] });
    const boxes = await screen.findByRole('list', { name: '박스' });
    const line = (await within(boxes).findByText('시작 전')).closest('li');
    expect(line).toHaveTextContent('4210-3388-1923');
    expect(within(boxes).queryByRole('button', { name: '상자 보기' })).toBeNull();
    expect(within(detail()).getByText('배치를 시작해야 상자를 출고 검수에서 열 수 있어요.')).toBeInTheDocument();
  });

  it('보충 대기를 못 불러오면 0 이 아니라 확인 못 함과 다시 확인을 보인다', async () => {
    const { server } = setupBatches();
    server.config.refillsFail = true;
    await screen.findByRole('region', { name: '배치 상세' });
    expect(await within(detail()).findByText('보충 대기를 불러오지 못했어요.', { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(detail()).toHaveTextContent('보충 대기 확인 못 함'));
    expect(detail()).not.toHaveTextContent('보충 대기 0');
    server.config.refillsFail = false;
    fireEvent.click(within(detail()).getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(detail()).toHaveTextContent('보충 대기 0'));
    expect(within(detail()).queryByText('보충 대기를 불러오지 못했어요.', { exact: false })).toBeNull();
  });

  it('보충 대기를 다시 받다 실패하면 보이던 숫자를 남기고 마지막으로 불러온 상태라고 알린다', async () => {
    const { server, queryClient } = setupBatches({
      boxes: [BOX1, { ...BOX3, batchId: 'b-1' }],
      refills: [{ shipmentId: 's-3', trackingNo: '421033881923', recipientMasked: '정*호', items: [] }],
    });
    await screen.findByRole('region', { name: '배치 상세' });
    await waitFor(() => expect(detail()).toHaveTextContent('보충 대기 1'));
    server.config.refillsFail = true;
    await queryClient.refetchQueries({ queryKey: ['outbound-refills'] });
    const alert = await within(detail()).findByText('보충 대기를 불러오지 못했어요.', { exact: false });
    expect(alert).toHaveTextContent('마지막으로 불러온');
    expect(detail()).toHaveTextContent('보충 대기 1');
  });

  it('상자 송장 상태를 못 불러오면 확인 필요를 0 으로 보이지 않는다', async () => {
    const { server } = setupBatches();
    server.config.labelStatesFail = true;
    await screen.findByRole('region', { name: '배치 상세' });
    expect(await within(detail()).findByText('상자 송장 상태를 불러오지 못했어요.', { exact: false })).toBeInTheDocument();
    await waitFor(() => expect(detail()).toHaveTextContent('확인 필요 확인 못 함'));
    expect(detail()).not.toHaveTextContent('확인 필요 0');
  });

  it('상자 두 개의 출력 확인은 겹치지 않는다 — 한 장이 끝나야 다음 상자를 뽑고, 그동안 일괄 출력도 막힌다', async () => {
    const gate = gatedPrint();
    const { print } = setupBatches({
      boxes: [{ ...BOX1, labelState: 'never_printed' }, { ...BOX2, labelState: 'never_printed' }],
      print: gate.print,
    });
    const boxes = await screen.findByRole('list', { name: '박스' });
    await waitFor(() => expect(within(boxes).getAllByRole('button', { name: '출력 확인' })).toHaveLength(2));
    const [first, second] = within(boxes).getAllByRole('button', { name: '출력 확인' });
    fireEvent.click(first);
    fireEvent.click(second);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(second).toBeDisabled();
    expect(screen.getByRole('button', { name: '송장 일괄 출력' })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(print).toHaveBeenCalledTimes(1);

    gate.releaseNext();
    await waitFor(() => expect(within(boxes).getAllByRole('button', { name: '출력 확인' })).toHaveLength(1));
    const left = within(boxes).getByRole('button', { name: '출력 확인' });
    await waitFor(() => expect(left).toBeEnabled());
    fireEvent.click(left);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    gate.releaseNext();
  });

  it('상자 출력 확인 중엔 화면을 떠나지 못한다 — 실패 안내와 자물쇠를 잃지 않게', async () => {
    const gate = gatedPrint();
    const { router } = setupBatches({ boxes: [{ ...BOX1, labelState: 'never_printed' }, BOX2], print: gate.print });
    const boxes = await screen.findByRole('list', { name: '박스' });
    fireEvent.click(await within(boxes).findByRole('button', { name: '출력 확인' }));
    await waitFor(() => expect(within(boxes).getByRole('button', { name: '출력 확인' })).toBeDisabled());
    void router.navigate({ to: '/outbound' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe('/outbound/batches');

    gate.releaseNext();
    await waitFor(() => expect(within(boxes).queryByRole('button', { name: '출력 확인' })).toBeNull());
    await router.navigate({ to: '/outbound' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/outbound'));
  });

  it('배치 시작 뒤 자동 인쇄가 판정을 받는 사이 상자 인쇄가 시작되면 일괄 인쇄는 겹쳐 돌지 않고, 끝난 뒤 판정부터 다시 받는다', async () => {
    const gate = gatedPrint();
    const BOX4: FakeBox = { ...UNPRINTED_BOX3, shipmentId: 's-4', trackingNo: '421033881931', lines: [{ id: 'l-40', skuId: 'sku-40', name: '브러시', qty: 1, barcode: '8801040' }] };
    const { server, print } = setupBatches({
      picking: [],
      created: [{ ...NEW_B3, totalItems: 2, totalBoxes: 2 }],
      boxes: [UNPRINTED_BOX3, BOX4],
      print: gate.print,
    });
    let started = false;
    let workItemsSinceStart = 0;
    const items: { release: (() => void) | null } = { release: null };
    server.config.beforeReply = (req) => {
      if (req.path === '/picking/v2/starts') started = true;
      if (!started || req.path !== '/outbound-batches/b-3/work-items') return;
      workItemsSinceStart += 1;
      if (workItemsSinceStart === 2) return new Promise<void>((resolve) => (items.release = resolve));
    };

    fireEvent.click(await screen.findByRole('button', { name: '배치 시작' }));
    await waitFor(() => expect(items.release).not.toBeNull());
    const boxes = screen.getByRole('list', { name: '박스' });
    const [row] = within(boxes).getAllByRole('button', { name: '출력 확인' });
    fireEvent.click(row);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    items.release?.();
    expect(await screen.findByText('다른 송장을 인쇄하고 있어요. 그 인쇄가 끝나면 이어서 인쇄해요.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(print).toHaveBeenCalledTimes(1);
    expect(server.confirmedPrints).toEqual([]);

    gate.releaseNext();
    await waitFor(() => expect(server.confirmedPrints).toEqual(['s-3']));
    expect(await screen.findByText(/이미 인쇄한 송장이 1건 있어요/)).toBeInTheDocument();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('보충 대기·송장 상태를 받는 동안은 숫자 대신 확인 중이라고 보인다', async () => {
    const { server } = setupBatches();
    const held: { release: (() => void) | null } = { release: null };
    server.config.beforeReply = (req) => {
      if (req.path.startsWith('/outbound-refills/pending') || req.path.endsWith('/waybill-label-states'))
        return new Promise<void>((resolve) => {
          const prev = held.release;
          held.release = () => {
            prev?.();
            resolve();
          };
        });
    };
    await screen.findByRole('region', { name: '배치 상세' });
    await waitFor(() => expect(detail()).toHaveTextContent('보충 대기 확인 중 · 확인 필요 확인 중'));
    expect(detail()).not.toHaveTextContent('보충 대기 0');
    server.config.beforeReply = null;
    held.release?.();
    await waitFor(() => expect(detail()).toHaveTextContent('보충 대기 0 · 확인 필요 0'));
  });
});
