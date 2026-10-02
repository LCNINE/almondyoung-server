import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RETURN_BIN_KEY } from '../../domains/returns/returnBin';
import type { FakeBox } from './__fixtures__/outboundServer';
import { BOX1, BOX2, flash, openBox, press, scan, setupInspection, stationPrefs } from './__fixtures__/renderStation';

const withBin = () => stationPrefs({ [RETURN_BIN_KEY]: JSON.stringify({ warehouseId: 'w-1', barcode: 'RB-01' }) });
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
const list = () => screen.getByRole('list', { name: '뺄 상품' });

describe('뺄 상품(스펙 §6.2 withdrawing)', () => {
  it('빼는 중인 박스 송장이면 뺄 목록 — 상품을 찍으면 바구니로, 다 빼면 «빠진 박스»', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    await openBox('421033881907');
    expect(await screen.findByText('뺄 상품')).toBeInTheDocument();
    expect(within(list()).getByText('[B-11-1] 헤어클립 집게핀')).toBeInTheDocument();
    expect(within(list()).getByText('2')).toBeInTheDocument();
    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    scan('8801002');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(server.box('421033881907')?.withdrawn).toBe(true);
  });

  it('되돌림 바구니가 없으면 알리고 상품을 받지 않는다', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING] });
    scan('421033881907');
    expect(await screen.findByText('설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.')).toBeInTheDocument();
    scan('8801002');
    expect(flash()).toBe('error');
    expect(server.requests.some((r) => r.path.endsWith('/return-bin-removals'))).toBe(false);
  });

  it('바구니 바코드를 찍으면 «뺄 상품을 찍어 주세요»', async () => {
    await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    await openBox('421033881907');
    await screen.findByText('뺄 상품');
    scan('RB-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('바구니 바코드예요');
  });

  it('F11 로 뺀 박스는 그 자리에서 뺄 상품으로 이어 간다', async () => {
    const { server } = await setupInspection({ prefs: withBin() });
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    press('F11');
    press('F11');
    await screen.findByText('뺄 상품');
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    scan('8801002');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
  });

  it('Esc 는 뺄 상품을 내려놓는다', async () => {
    await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    scan('421033881907');
    await screen.findByText('뺄 상품');
    press('Escape');
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  });

  it('빠진 박스 화면에서 다른 송장은 새 박스로 열고, 상품은 앞 스캔 확인 중이라고 하지 않는다', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING, BOX2], prefs: withBin() });
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(within(list()).getByText('1')).toBeInTheDocument());
    scan('8801002');
    await screen.findByText('빠진 박스');
    scan('8801002');
    await waitFor(() => expect(flash()).toBe('error'));
    expect(screen.queryByText('앞 스캔을 확인하고 있어요. 확인이 끝난 뒤 다시 찍어 주세요.')).toBeNull();
    scan('421033881915');
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    expect(screen.queryByText('빠진 박스')).toBeNull();
    expect(server.requests.some((r) => r.path.endsWith('/return-bin-removals') && r.path.includes('421033881915'))).toBe(false);
  });

  it('스캔 큐가 준비되기 전에 찍은 상품은 받지 않고 이유를 보인다', async () => {
    const { server } = await setupInspection({ boxes: [WITHDRAWING], prefs: withBin() });
    scan('421033881907');
    await screen.findByText('뺄 상품');
    expect(document.querySelector('[data-intake="blocked"]')).not.toBeNull();
    scan('8801002');
    expect(await screen.findByRole('alert')).toHaveTextContent('앞 스캔을 확인하고 있어요');
    expect(flash()).toBe('error');
    expect(server.requests.some((r) => r.path.endsWith('/return-bin-removals'))).toBe(false);
  });
});
