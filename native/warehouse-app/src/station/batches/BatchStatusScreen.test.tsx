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

function setupBatches(
  opts: { boxes?: FakeBox[]; picking?: OutboundBatchSummary[]; created?: OutboundBatchSummary[]; legacy?: boolean } = {}
) {
  const server = createOutboundServer({ boxes: opts.boxes ?? [BOX1, { ...BOX2, shipped: true }, BOX3] });
  server.config.batches.picking = opts.picking ?? [batchSummary({ id: 'b-1', batchNumber: 'B-1002' })];
  server.config.batches.created = opts.created ?? [
    batchSummary({ id: 'b-3', batchNumber: 'B-1004', status: 'created', startedAt: null, totalItems: 1 }),
  ];
  server.config.legacyBatchStates = opts.legacy ?? false;
  const runtime = createTestRuntime(server);
  const prefs = stationPrefs();
  const print = vi.fn<PrintRaw>(async () => {});
  const view = renderStation(() => <BatchStatusScreen prefs={prefs} print={print} />, { runtime, prefs, path: '/outbound/batches' });
  return { server, ...view };
}

const detail = () => screen.getByRole('region', { name: '배치 상세' });

describe('F2 배치 현황(스펙 §8, 목업 ⑤)', () => {
  it('배치 표 — 진행 중 먼저, 시작 전 다음, 진행 완료/전체', async () => {
    setupBatches();
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('B-1002');
    expect(first).toHaveTextContent('진행 중');
    await waitFor(() => expect(first).toHaveTextContent('1/2'));
    expect(second).toHaveTextContent('B-1004');
    expect(second).toHaveTextContent('시작 전');
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

  it('송장을 손볼 박스가 위로 — «재출력»', async () => {
    setupBatches({ boxes: [BOX2, { ...BOX1, labelState: 'reprint_required' }, BOX3] });
    const boxes = await screen.findByRole('list', { name: '박스' });
    await waitFor(() => expect(within(boxes).getAllByRole('listitem')).toHaveLength(2));
    const [first, second] = within(boxes).getAllByRole('listitem');
    expect(first).toHaveTextContent('4210-3388-1907');
    expect(first).toHaveTextContent('재출력');
    expect(second).toHaveTextContent('4210-3388-1915');
  });

  it('배치를 누르면 그 배치를 본다 — 시작 전 배치엔 「작업 시작」만', async () => {
    setupBatches();
    fireEvent.click(await screen.findByRole('button', { name: 'B-1004' }));
    await waitFor(() => expect(within(detail()).getByRole('heading', { name: 'B-1004' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '박스 넣기' })).toBeNull();
  });

  it('시작된 배치엔 송장 인쇄·박스 넣기·박스 빼기 — 박스 빼기 패널이 열린다', async () => {
    setupBatches();
    expect(await screen.findByRole('button', { name: '송장 인쇄' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '박스 넣기' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '박스 빼기' }));
    expect(await screen.findByText('이 배치에서 박스 빼기')).toBeInTheDocument();
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
});
