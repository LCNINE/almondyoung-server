import 'fake-indexeddb/auto';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createOperationStore } from '../../core/operations/operationStore';
import type { FakeBox } from './__fixtures__/outboundServer';
import { BOX1, BOX2, flash, openBox, press, scan, setupInspection } from './__fixtures__/renderStation';

const WITHDRAWING: FakeBox = {
  ...BOX1,
  labelState: 'withdrawing',
  removals: [
    {
      shipmentLineId: 'l-2',
      skuId: 'sku-2',
      skuCode: 'sku-2',
      skuName: '헤어클립 집게핀',
      sourceLocationId: 'loc-B-11-1',
      locationCode: 'B-11-1',
      boxQty: 2,
      cartQty: 0,
    },
  ],
};
const SLOW = { timeout: 4000 };
const list = () => screen.getByRole('list', { name: '뺄 상품' });
const recent = () => screen.getByRole('list', { name: '최근 스캔' });
const batchReads = (server: { requests: Array<{ path: string }> }) =>
  server.requests.filter((r) => /^\/outbound-batches\/[^/]+\/work-items$/.test(r.path)).length;

describe('뺄 상품(스펙 §6.2 withdrawing)', () => {
  it('빼는 중인 박스 송장이면 뺄 목록 — 상품을 찍으면 바구니로, 다 빼면 «빠진 박스»', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING] });
    await openBox('421033881907');
    expect(await screen.findByText('뺄 상품을 찍어 주세요')).toBeInTheDocument();
    expect(within(list()).getByText('[B-11-1] 헤어클립 집게핀')).toBeInTheDocument();
    expect(within(list()).getByText('2')).toBeInTheDocument();
    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    // 최근 목록은 바코드 숫자가 아니라 서버가 알려 준 뺀 상품 이름(removedSkuName)
    expect(within(recent()).getByText('헤어클립 집게핀')).toBeInTheDocument();
    expect(within(recent()).queryByText('8801002')).toBeNull();
    const before = batchReads(server);
    scan('8801002');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(server.box('421033881907')?.withdrawn).toBe(true);
    // 박스가 빠지면 상태바 배치 분모가 바로 줄도록 배치 항목을 다시 읽는다
    await waitFor(() => expect(batchReads(server)).toBeGreaterThan(before));
  });

  it('응답에 뺀 상품 이름이 없으면(옛 core) 바코드를 적는다', async () => {
    await setupInspection({ boxes: [{ ...WITHDRAWING, omitRemovedName: true }] });
    await openBox('421033881907');
    await screen.findByText('뺄 상품을 찍어 주세요');
    scan('8801002');
    await waitFor(() => expect(within(recent()).getByText('8801002')).toBeInTheDocument());
  });

  it('바구니 설정 없이 상품을 받는다', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING] });
    await openBox('421033881907');
    await screen.findByText('뺄 상품을 찍어 주세요');
    expect(screen.queryByRole('link', { name: '설정 열기' })).not.toBeInTheDocument();

    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    expect(server.requests.find((r) => r.path.endsWith('/return-bin-removals'))?.body).toEqual({
      barcode: '8801002',
      quantity: 1,
    });
  });

  it('바구니 바코드를 찍으면 «뺄 상품을 찍어 주세요»', async () => {
    await setupInspection({ boxes: [WITHDRAWING] });
    await openBox('421033881907');
    await screen.findByText('뺄 상품을 찍어 주세요');
    scan('RB-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('바구니 바코드예요');
  });

  it('F11 로 뺀 박스는 그 자리에서 뺄 상품으로 이어 간다', async () => {
    const { server } = await setupInspection({});
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    press('F11');
    press('F11');
    // F11 두 번 → 빼기 → 송장 재조회 → 뺄 상품, 다시 빼기 → 빠진 박스까지 왕복이 길다. CI 부하에서 기본 1초를 넘긴다
    await screen.findByText('뺄 상품을 찍어 주세요', undefined, SLOW);
    // 다시 그린 화면이 송장 줄을 한 번 더 남기지 않는다(처음 찍었을 때 한 줄뿐)
    expect(within(recent()).getAllByText('4210-3388-1907')).toHaveLength(1);
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    scan('8801002');
    expect(await screen.findByText('빠진 박스', undefined, SLOW)).toBeInTheDocument();
  });

  it('Esc 는 뺄 상품을 내려놓는다', async () => {
    await setupInspection({ boxes: [WITHDRAWING] });
    // 스캔 큐가 준비되고 Esc 가 등록될 때까지 — 준비 전 내려놓기는 «확인 못 한 스캔» 거절이 맞다
    await openBox('421033881907');
    await screen.findByText('뺄 상품을 찍어 주세요');
    press('Escape');
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  });

  it('빠진 박스 화면에서 다른 송장은 새 박스로 열고, 상품은 앞 스캔 확인 중이라고 하지 않는다', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING, BOX2] });
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    scan('8801002');
    await screen.findByText('빠진 박스');
    scan('8801002');
    await waitFor(() => expect(flash()).toBe('error'));
    expect(screen.queryByText('앞 스캔을 확인하고 있어요. 확인이 끝난 뒤 다시 찍어 주세요.')).toBeNull();
    expect(await screen.findByText('이미 다 뺀 상자예요. 다음 송장을 찍어 주세요.')).toBeInTheDocument();
    expect(screen.getByText('빠진 박스')).toBeInTheDocument();
    scan('421033881915');
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    expect(screen.queryByText('빠진 박스')).toBeNull();
    expect(server.requests.some((r) => r.path.endsWith('/return-bin-removals') && r.path.includes('421033881915'))).toBe(false);
  });

  it('스캔 큐가 준비되기 전에 찍은 상품은 받지 않고 이유를 보인다', async () => {
    // 이 박스의 저장된 스캔 읽기를 붙잡는다 — 복구가 끝나기 전(큐 준비 전)을 시간에 맡기지 않고 만든다
    const store = createOperationStore(crypto.randomUUID());
    const draft = store.draft;
    let releaseRestore!: () => void;
    const restoreHeld = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
      if (!update && id.includes(':scan:withdraw:')) await restoreHeld;
      return draft(id, update);
    });
    const { server } = await setupInspection({ boxes: [WITHDRAWING], store });
    scan('421033881907');
    await screen.findByText('뺄 상품을 찍어 주세요');
    expect(document.querySelector('[data-intake="blocked"]')).not.toBeNull();
    scan('8801002');
    expect(await screen.findByRole('alert')).toHaveTextContent('앞 스캔을 확인하고 있어요');
    expect(flash()).toBe('error');
    expect(server.requests.some((r) => r.path.endsWith('/return-bin-removals'))).toBe(false);
    // 복구가 끝나면 받는다
    await act(async () => releaseRestore());
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    expect(server.requests.filter((r) => r.path.endsWith('/return-bin-removals'))).toHaveLength(1);
  });
});
