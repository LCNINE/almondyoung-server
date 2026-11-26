import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { DevicePrefs } from '../../core/data/devicePrefs';
import { writeLastBox } from '../../domains/outbound/lastBox';
import type { ShipmentByWaybill } from '../../domains/outbound/types';
import { batchSummary, type FakeBox } from './__fixtures__/outboundServer';
import {
  BOX1,
  BOX2,
  flash,
  openBox,
  press,
  scan,
  setupInspection,
  sleep,
  stationPrefs,
  typeHuman,
} from './__fixtures__/renderStation';

const progress = () => screen.getByRole('status', { name: '진행' });
const heading = (trackingNo: string) => screen.getByRole('heading', { name: trackingNo });

describe('F1 출고 검수 — 송장 스캔 즉시 시작, 상품 스캔 = +1, 마지막 스캔 = 출고(스펙 §6)', () => {
  it('송장을 찍으면 박스가 열린다 — 송장번호·받는 분·택배사, 송장 순서 품목 표. 배송메모는 보이지 않는다', async () => {
    await setupInspection();
    await openBox('421033881907');
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    expect(screen.getByText('김*영')).toBeInTheDocument();
    expect(screen.getByText('한진택배')).toBeInTheDocument();
    expect(screen.queryByText('문 앞에 놓아주세요')).toBeNull();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1) as HTMLTableRowElement[];
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(['A-03-2', 'B-11-1']);
    expect(progress()).toHaveTextContent('0 / 4');
  });

  it('나눈 상자를 찍으면 이 주문의 몇 번째 상자인지와 수량을 보인다 — 나누지 않은 상자는 보이지 않는다', async () => {
    await setupInspection({ boxes: [{ ...BOX1, split: { boxQty: 4, orderQty: 6, boxNo: 1, boxCount: 2 } }, BOX2] });
    await openBox('421033881907');
    const share = screen.getByLabelText('나눈 상자');
    expect(share).toHaveTextContent('이 주문 2상자 중 1');
    expect(share).toHaveTextContent('주문 6개 중 이 상자 4개');

    for (const code of ['8801002', '8801002', '8801002', '8801001']) scan(code);
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    await openBox('421033881915');
    expect(screen.queryByLabelText('나눈 상자')).toBeNull();
  });

  it('새 송장을 출력해야 하는 나눈 상자도 송장 카드에 나눈 상자를 보인다', async () => {
    await setupInspection({
      boxes: [{ ...BOX1, labelState: 'reprint_required', split: { boxQty: 4, orderQty: 6, boxNo: 2, boxCount: 2 } }],
    });
    scan('421033881907');
    expect(await screen.findByLabelText('나눈 상자')).toHaveTextContent('이 주문 2상자 중 2');
  });

  it('상품을 찍으면 그 줄이 오르고, 마지막 상품이면 출고되어 송장 대기로 — 직전 박스 완료를 보인다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    for (const code of ['8801002', '8801002', '8801001']) scan(code);
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    expect(screen.getByText('송장을 찍어 주세요')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(server.box('421033881907')?.shipped).toBe(true);
  });

  it('박스에 없는 상품은 창 없이 송장 카드 아래 빨간 문장으로 알리고 진행은 그대로 — 다음 정상 스캔이 지운다', async () => {
    await setupInspection();
    await openBox('421033881907');
    scan('8809999');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('이 송장에 없는 상품이에요');
    expect(alert).toHaveTextContent('8809999');
    expect(alert).toHaveTextContent('수량 미반영 · 다음 상품을 스캔해 주세요.');
    expect(alert.closest('[data-scan-error]')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(progress()).toHaveTextContent('0 / 4');
    expect(flash()).toBe('error');
    scan('8801001');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('[data-scan-error]')).toBeNull();
    expect(screen.getByText('상품을 모두 확인하면 자동 출고')).toBeInTheDocument();
  });

  it('결과를 모르는 스캔은 반영됐을 수 있어 수량 미반영이라고 하지 않는다', async () => {
    const { server, runtime } = await setupInspection();
    await openBox('421033881907');
    server.loseResponses(true);
    scan('8801002');
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    expect(await screen.findByText('처리 여부를 확인하고 있어요. 이 상품은 다시 찍지 마세요.')).toBeInTheDocument();
    expect(screen.queryByText('수량 미반영 · 다음 상품을 스캔해 주세요.')).toBeNull();
  });

  it('박스에 없는 상품은 서버가 알려 준 상품 이름을 바코드와 함께 보이고 최근 스캔에도 남긴다', async () => {
    const { server } = await setupInspection();
    server.config.skuNames['8801003'] = '샴푸 퍼퓸';
    await openBox('421033881907');
    scan('8801003');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('이 송장에 없는 상품이에요');
    expect(alert).toHaveTextContent('샴푸 퍼퓸');
    expect(alert).toHaveTextContent('8801003');
    const recent = within(screen.getByRole('list', { name: '최근 스캔' }));
    expect(recent.getAllByRole('listitem')[0]).toHaveTextContent('샴푸 퍼퓸 8801003');
  });

  it('상자를 끝낸 마지막 스캔도 최근 스캔에 남긴다', async () => {
    await setupInspection();
    await openBox('421033881915');
    scan('8801003');
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: '최근 스캔' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('4210-3388-1915 출고 완료');
    expect(items[1]).toHaveTextContent('샴푸 퍼퓸+1');
  });

  it('송장 대기에 지금 배치와 남은 상자를 크게 보이고, 출고하면 줄인다', async () => {
    await setupInspection({
      picking: [batchSummary({ id: 'b-1', batchNumber: 'OB-1002' })],
      prefs: stationPrefs({ 'almondwms.outbound.lastBatch': JSON.stringify({ id: 'b-1', batchNumber: 'OB-1002', name: '오전' }) }),
    });
    const now = await screen.findByRole('status', { name: '지금 배치' });
    expect(now).toHaveTextContent('오전OB-1002');
    expect(now).toHaveTextContent('남은 상자 2 / 2');
    await openBox('421033881915');
    scan('8801003');
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status', { name: '지금 배치' })).toHaveTextContent('남은 상자 1 / 2'));
  });

  it('하던 박스를 다시 열지 못하면 그 박스의 배치가 아니라 배치 현황이 남긴 배치를 보인다', async () => {
    await setupInspection({
      boxes: [BOX1, { ...BOX2, batchId: 'b-9', shipped: true }],
      prefs: stationPrefs({
        'almondwms.outbound.lastBox': JSON.stringify({ shipmentId: 's-2', trackingNo: '421033881915', batchId: 'b-9' }),
        'almondwms.outbound.lastBatch': JSON.stringify({ id: 'b-1', batchNumber: 'OB-1002', name: null }),
      }),
    });
    const now = await screen.findByRole('status', { name: '지금 배치' });
    expect(now).toHaveTextContent('OB-1002');
    expect(now).toHaveTextContent('남은 상자 1 / 1');
  });

  it('시작만 하고 아직 아무 상자도 찍지 않은 배치도 배치 현황이 남긴 번호로 보인다', async () => {
    await setupInspection({
      prefs: stationPrefs({ 'almondwms.outbound.lastBatch': JSON.stringify({ id: 'b-1', batchNumber: 'OB-1002', name: null }) }),
    });
    const now = await screen.findByRole('status', { name: '지금 배치' });
    expect(now).toHaveTextContent('OB-1002');
    expect(now).toHaveTextContent('남은 상자 2 / 2');
  });

  it('같은 송장을 다시 찍으면 다시 조회만 한다 — 서버에 쓰지 않고, 방금 보낸 스캔까지 보인다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    const writes = () => server.requests.filter((r) => (r.method ?? 'GET') !== 'GET').length;
    const lookups = () => server.requests.filter((r) => r.path.startsWith('/shipments/by-waybill')).length;
    // 다시 연 박스마다 최근 스캔에 송장 한 줄이 붙는다 — 조회 요청만이 아니라 «다시 연 화면» 을 기다린다
    const reopened = () =>
      within(screen.getByRole('list', { name: '최근 스캔' }))
        .getAllByRole('listitem')
        .filter((li) => li.textContent?.includes('4210-3388-1907')).length;
    const before = writes();
    for (let i = 0; i < 2; i++) {
      const n = lookups();
      const shown = reopened();
      scan('421033881907');
      await waitFor(() => expect(lookups()).toBe(n + 1));
      await waitFor(() => expect(reopened()).toBe(shown + 1));
      await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
      // 다시 연 박스의 진행은 서버가 돌려준 값이다 — 방금 보낸 스캔까지
      expect(progress()).toHaveTextContent('1 / 4');
    }
    expect(writes()).toBe(before);
    expect(server.scanCalls).toHaveLength(1);
  });

  it('검수 중 다른 송장을 찍으면 앞 상품이 옛 박스로 다 간 뒤 그 송장을 연다(U13) — 그 사이 상품은 받지 않는다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    const release = server.holdSends();
    scan('8801002');
    await waitFor(() => expect(server.scanCalls).toHaveLength(1));
    scan('421033881915');
    await act(async () => {
      await sleep(30);
    });
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    scan('8801001');
    expect(await screen.findByRole('alert')).toHaveTextContent('송장을 확인하고 있어요');
    release();
    expect(await screen.findByRole('heading', { name: '4210-3388-1915' })).toBeInTheDocument();
    expect(server.scans).toEqual([expect.objectContaining({ shipmentId: 's-1', barcode: '8801002' })]);
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    scan('8801003');
    await waitFor(() => expect(server.scans.at(-1)).toMatchObject({ shipmentId: 's-2', barcode: '8801003' }));
  });

  it('앞 스캔의 결과를 모르면 그 박스는 확인할 일로 넘기고 내려놓는다 — 다른 송장을 찍고, 다시 열면 같은 키로 맞춘다', async () => {
    const { server, runtime } = await setupInspection();
    await openBox('421033881907');
    server.loseResponses(true);
    scan('8801002');
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    // 확인 중 칸은 찍은 상품을 이름으로 보인다
    expect(await screen.findByText('헤어클립 집게핀 ×1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인할 일 1' })).toBeInTheDocument();
    server.loseResponses(false);
    // 내려놓기가 된다
    press('Escape');
    expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
    expect(screen.getByText(/4210-3388-1907 처리 여부 확인 중/)).toBeInTheDocument();
    // 다른 박스는 그대로 찍힌다
    scan('421033881915');
    expect(await screen.findByRole('heading', { name: '4210-3388-1915' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-intake="open"]')).not.toBeNull());
    scan('8801003');
    await waitFor(() => expect(server.scans.at(-1)).toMatchObject({ shipmentId: 's-2', barcode: '8801003' }));
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    // 다시 열면 저장된 스캔을 같은 키로 보낸다 — 서버는 한 번만 반영한다
    scan('421033881907');
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    expect(server.scans.filter((s) => s.shipmentId === 's-1')).toHaveLength(1);
    await waitFor(async () => expect(await runtime.store.pending('scope')).toHaveLength(0));
    expect(screen.queryByRole('button', { name: /확인할 일/ })).toBeNull();
  });

  it('입고 작업의 결과를 모르는 동안에도 보낸 스캔이 없는 상자는 다른 송장으로 바꾸고 내려놓을 수 있다 — 상품은 받지 않고 그 작업을 알린다', async () => {
    const slow = { timeout: 4000 };
    const { server, runtime } = await setupInspection();
    await runtime.store.begin({
      id: 'inbound',
      scope: 'scope',
      resource: '/inbound/simple:w',
      path: '/inbound/simple',
      method: 'POST',
      createdAt: Date.now(),
      bodyJson: JSON.stringify({ barcode: '8801009', quantity: 1 }),
    });
    await runtime.store.finish('inbound', 'uncertain');
    await act(async () => runtime.runner.restore());
    scan('421033881907');
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' }, slow)).toBeInTheDocument();
    await act(async () => {});
    scan('8801002');
    expect(await screen.findByRole('alert', undefined, slow)).toHaveTextContent(
      '입고 작업의 처리 여부를 확인하고 있어요. 아래 «처리 내역 확인»을 먼저 눌러 주세요.'
    );
    scan('421033881915');
    expect(await screen.findByRole('heading', { name: '4210-3388-1915' }, slow)).toBeInTheDocument();
    await act(async () => {});
    press('Escape');
    expect(await screen.findByText('송장을 찍어 주세요', undefined, slow)).toBeInTheDocument();
    expect(server.scans).toEqual([]);
  });

  it('다시 연 박스가 저장된 스캔을 다시 보내면 최근 목록에 그 상품 이름이 남는다', async () => {
    const { server, runtime } = await setupInspection();
    await openBox('421033881907');
    server.loseResponses(true);
    scan('8801002');
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    press('Escape');
    expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
    server.loseResponses(false);
    scan('421033881907');
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    // 진행은 조회값이 이미 포함해 «오른 줄» 로는 못 찾는다 — 바코드로 상품을 알아본다
    const recent = screen.getByRole('list', { name: '최근 스캔' });
    expect(await within(recent).findByText('헤어클립 집게핀')).toBeInTheDocument();
    expect(server.scans.filter((s) => s.shipmentId === 's-1')).toHaveLength(1);
  });

  it('확인할 일은 송장 대기의 F8 로 열고, 숫자 키로 상자를 골라 다시 확인한다 — 목록은 상품 이름으로 보인다', async () => {
    const { server, runtime } = await setupInspection();
    await openBox('421033881907');
    server.loseResponses(true);
    scan('8801002');
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    press('Escape');
    expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
    await act(async () => {});
    press('F8');
    const dialog = await screen.findByRole('dialog', { name: '확인할 일' });
    expect(await within(dialog).findByText('4210-3388-1907')).toBeInTheDocument();
    expect(within(dialog).getByText(/헤어클립 집게핀 ×1/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /1\s*다시 확인/ })).toBeInTheDocument();
    // 숫자는 창이 받는다(그 상자의 «다시 확인») — 뒤의 송장 직접 입력칸이 열리지 않는다
    await typeHuman(['1']);
    expect(await within(dialog).findByText(/아직 확인하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    server.loseResponses(false);
    await typeHuman(['1']);
    await waitFor(async () => expect(await runtime.store.pending('scope')).toHaveLength(0));
    expect(server.scans.filter((s) => s.shipmentId === 's-1')).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // 확인할 일이 없어지면 송장 대기의 F8 도 빠진다
    await waitFor(() => expect(screen.queryByRole('button', { name: /확인할 일/ })).toBeNull());
  });

  it('송장과 길이가 같은 숫자 상품 바코드는 조회해 보고, 없으면 상품으로 찍는다', async () => {
    const box: FakeBox = {
      ...BOX2,
      lines: [
        { id: 'l-9', skuId: 'sku-9', name: '수입 샴푸', qty: 1, barcode: '012345678905', locations: [{ code: 'E-01-1', qty: 1 }] },
        { id: 'l-10', skuId: 'sku-10', name: '빗', qty: 1, barcode: '8801010', locations: [{ code: 'E-02-1', qty: 1 }] },
      ],
    };
    const { server } = await setupInspection({ boxes: [box] });
    await openBox('421033881915');
    scan('012345678905');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 2'));
    expect(server.requests.some((r) => r.path.includes('trackingNo=012345678905'))).toBe(true);
  });

  describe('연결이 끊겼을 때', () => {
    afterEach(() => onlineManager.setOnline(true));
    const disconnect = (server: { setOffline(v: boolean): void }, off: boolean) => {
      server.setOffline(off);
      act(() => onlineManager.setOnline(!off));
    };

    const connectionDialog = (name: '서버 연결 끊김' | '서버 연결 복구') => screen.findByRole('alertdialog', { name });

    it('찍은 상품은 저장해 두고 연결 끊김 창으로 알린다 — 연결되면 그대로 보내고 복구 창은 다시 찍지 말라고 한다', async () => {
      const { server } = await setupInspection();
      await openBox('421033881907');
      disconnect(server, true);
      scan('8801002');
      const lost = await connectionDialog('서버 연결 끊김');
      expect(lost).toHaveTextContent('스캔이 반영되지 않았습니다.');
      expect(lost).toHaveTextContent('4210-3388-1907');
      expect(lost).toHaveTextContent('0 / 4개유지');
      expect(within(lost).getByText('연결이 끊겨 상품 스캔 1개를 보내지 못하고 있어요. 연결되면 자동으로 보내요. 같은 상품은 다시 찍지 마세요.')).toBeInTheDocument();
      expect(progress()).toHaveTextContent('0 / 4');
      expect(server.scans).toHaveLength(0);
      scan('8801002');
      expect(flash()).toBe('error');
      disconnect(server, false);
      await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
      expect(server.scans).toHaveLength(1);
      expect(screen.queryByText(/연결이 끊겨/)).toBeNull();
      const restored = await connectionDialog('서버 연결 복구');
      expect(restored).toHaveTextContent('보내지 못한 스캔을 보냈어요. 같은 상품은 다시 찍지 마세요.');
      expect(restored).not.toHaveTextContent('다시 스캔해 주세요');
      fireEvent.click(within(restored).getByRole('button', { name: '검수 계속하기' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      scan('8801002');
      await waitFor(() => expect(progress()).toHaveTextContent('2 / 4'));
    });

    it('연결된 뒤 다시 보낸 스캔의 응답을 잃으면 창을 닫고 처리 여부 확인으로 넘긴다 — 반영 안 됨이라고 하지 않는다', async () => {
      const { server, runtime } = await setupInspection();
      await openBox('421033881907');
      disconnect(server, true);
      scan('8801002');
      await connectionDialog('서버 연결 끊김');
      server.loseResponses(true);
      disconnect(server, false);
      await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(screen.queryByText('스캔이 반영되지 않았습니다.')).toBeNull();
      expect(screen.queryByText('수량 미반영 · 다음 상품을 스캔해 주세요.')).toBeNull();
      expect(await screen.findByText('처리 여부를 확인하고 있어요. 이 상품은 다시 찍지 마세요.')).toBeInTheDocument();
      server.loseResponses(false);
      press('Escape');
      expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
      expect(screen.getByText(/4210-3388-1907 처리 여부 확인 중/)).toBeInTheDocument();
    });

    it('다시 연결 확인에 서버가 오류로 답하면 복구라고 하지 않는다', async () => {
      const box: FakeBox = {
        ...BOX2,
        lines: [{ id: 'l-9', skuId: 'sku-9', name: '수입 샴푸', qty: 2, barcode: '012345678905', locations: [{ code: 'E-01-1', qty: 2 }] }],
      };
      const { server } = await setupInspection({ boxes: [box] });
      await openBox('421033881915');
      disconnect(server, true);
      scan('012345678905');
      const lost = await connectionDialog('서버 연결 끊김');
      disconnect(server, false);
      server.config.lookupFail = true;
      fireEvent.click(within(lost).getByRole('button', { name: '다시 연결 확인' }));
      expect(await within(lost).findByText('서버가 아직 정상 응답하지 않습니다. 잠시 뒤 다시 눌러 주세요.')).toBeInTheDocument();
      expect(screen.queryByRole('alertdialog', { name: '서버 연결 복구' })).toBeNull();
      expect(within(lost).getByRole('button', { name: '다시 연결 확인' })).toBeEnabled();
      server.config.lookupFail = false;
      fireEvent.click(within(lost).getByRole('button', { name: '다시 연결 확인' }));
      expect(await connectionDialog('서버 연결 복구')).toHaveTextContent('마지막 상품을 다시 스캔해 주세요.');
    });

    it('연결 끊김 창이 떠 있는 동안 기능키 바를 눌러도 동작하지 않고, 뒤 화면은 inert 다', async () => {
      const box: FakeBox = {
        ...BOX2,
        lines: [{ id: 'l-9', skuId: 'sku-9', name: '수입 샴푸', qty: 2, barcode: '012345678905', locations: [{ code: 'E-01-1', qty: 2 }] }],
      };
      const { server, print } = await setupInspection({ boxes: [box] });
      await openBox('421033881915');
      disconnect(server, true);
      scan('012345678905');
      await connectionDialog('서버 연결 끊김');
      disconnect(server, false);
      const toolbar = screen.getByRole('toolbar', { name: '기능키' });
      expect(toolbar.closest('[inert]') ?? Array.from(document.body.children).find((child) => child.contains(toolbar) && (child as HTMLElement).inert)).toBeTruthy();
      fireEvent.click(within(toolbar).getByRole('button', { name: /송장 재출력/ }));
      await act(async () => {
        await sleep(30);
      });
      expect(print).not.toHaveBeenCalled();
      expect(heading('4210-3388-1915')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog', { name: '서버 연결 끊김' })).toBeInTheDocument();
    });

    it('다시 연결 확인이 실패하면 창을 두고 아직 연결되지 않았다고 한다 — 성공하면 저장해 둔 스캔을 보낸다', async () => {
      const { server } = await setupInspection();
      await openBox('421033881907');
      disconnect(server, true);
      scan('8801002');
      const lost = await connectionDialog('서버 연결 끊김');
      fireEvent.click(within(lost).getByRole('button', { name: '다시 연결 확인' }));
      expect(await within(lost).findByText(/아직 서버에 연결되지 않았습니다/)).toBeInTheDocument();
      expect(server.scans).toHaveLength(0);
      server.setOffline(false);
      fireEvent.click(within(lost).getByRole('button', { name: '다시 연결 확인' }));
      await connectionDialog('서버 연결 복구');
      expect(progress()).toHaveTextContent('1 / 4');
      expect(server.scans).toHaveLength(1);
    });

    it('보내지 못한 스캔이 있으면 Esc 는 기다리지 않고 거절한다 — 연결되면 보내고 내려놓을 수 있다', async () => {
      const { server } = await setupInspection();
      await openBox('421033881907');
      disconnect(server, true);
      scan('8801002');
      await screen.findByText(/연결이 끊겨 상품 스캔 1개를/);
      press('Escape');
      await act(async () => {
        await sleep(30);
      });
      expect(heading('4210-3388-1907')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog', { name: '서버 연결 끊김' })).toBeInTheDocument();
      disconnect(server, false);
      await waitFor(() => expect(server.scans).toHaveLength(1));
      expect(screen.queryByText(/처리됐는지 확인하지 못했어요/)).toBeNull();
      fireEvent.click(within(await screen.findByRole('alertdialog', { name: '서버 연결 복구' })).getByRole('button', { name: '검수 계속하기' }));
      press('Escape');
      expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
    });

    it('보내지 못한 스캔이 있으면 다른 송장은 조회하지 않고 바로 거절한다', async () => {
      const { server } = await setupInspection();
      await openBox('421033881907');
      act(() => onlineManager.setOnline(false));
      scan('8801002');
      await screen.findByText(/연결이 끊겨 상품 스캔 1개를/);
      const release = server.holdLookups();
      scan('421033881915');
      expect(flash()).toBe('error');
      await act(async () => {
        await sleep(30);
      });
      expect(server.requests.some((r) => r.path.includes('trackingNo=421033881915'))).toBe(false);
      expect(heading('4210-3388-1907')).toBeInTheDocument();
      release();
    });

    it('끊긴 직후 찍은 상품 바로 뒤의 송장도 조회하지 않는다 — 대기 안내가 그려지기 전이어도', async () => {
      const { server } = await setupInspection();
      await openBox('421033881907');
      act(() => onlineManager.setOnline(false));
      const release = server.holdLookups();
      // 한 act 안에서 두 번 — 사이에 다시 그리지 않는다
      act(() => {
        scan('8801002');
        scan('421033881915');
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('앞 스캔이 아직 끝나지 않았어요. 연결된 뒤 다시 해 주세요.');
      expect(server.requests.some((r) => r.path.includes('trackingNo=421033881915'))).toBe(false);
      release();
    });

    it('송장인지 확인하지 못한 바코드는 반영하지 않았다고 알리고 다시 찍게 한다', async () => {
      const box: FakeBox = {
        ...BOX2,
        lines: [{ id: 'l-9', skuId: 'sku-9', name: '수입 샴푸', qty: 2, barcode: '012345678905', locations: [{ code: 'E-01-1', qty: 2 }] }],
      };
      const { server } = await setupInspection({ boxes: [box] });
      await openBox('421033881915');
      disconnect(server, true);
      scan('012345678905');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('연결이 끊겨 이 스캔은 반영하지 않았어요. 연결된 뒤 다시 찍어 주세요.');
      expect(alert).toHaveTextContent('012345678905');
      expect(alert).not.toHaveTextContent('알 수 없는 오류');
      expect(server.scans).toHaveLength(0);
      const lost = await connectionDialog('서버 연결 끊김');
      expect(lost).toHaveTextContent('0 / 2개유지');
      expect(progress()).toHaveTextContent('0 / 2');
      disconnect(server, false);
      fireEvent.click(within(lost).getByRole('button', { name: '다시 연결 확인' }));
      const restored = await connectionDialog('서버 연결 복구');
      expect(restored).toHaveTextContent('마지막 상품을 다시 스캔해 주세요.');
      expect(server.scans).toHaveLength(0);
      fireEvent.click(within(restored).getByRole('button', { name: '검수 계속하기' }));
      scan('012345678905');
      await waitFor(() => expect(progress()).toHaveTextContent('1 / 2'));
      expect(server.scans).toHaveLength(1);
    });
  });

  const rejections: Array<[string, FakeBox, string, string]> = [
    ['이미 출고된 송장', { ...BOX1, shipped: true }, '421033881907', '이미 출고된 송장이에요'],
    ['작업 시작 전', { ...BOX1, labelState: 'not_started' }, '421033881907', '배치 현황(F2)에서 「작업 시작」을 먼저 눌러 주세요.'],
    ['없는 송장', BOX1, '999999999999', '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.'],
  ];
  it.each(rejections)('거절: %s — 오류음과 사유 한 줄, 송장 대기 그대로', async (_name, box, code, message) => {
    await setupInspection({ boxes: [box] });
    scan(code);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(flash()).toBe('error');
    // 송장 대기 그대로 — 빨간 칸이 «송장 바코드» 자리를 차지하고(스펙 §6.2), 박스는 열리지 않았다
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('[data-intake]')).toBeNull();
  });

  it('송장이 바뀌었으면 새 송장을 자동 출력하고 바뀐 줄을 보인다 — 새 송장을 찍으면 검수로 간다', async () => {
    const { server, print } = await setupInspection({ boxes: [{ ...BOX1, labelState: 'reprint_required' }] });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ');
    expect(server.confirmedPrints).toEqual(['s-1']);
    expect(within(screen.getByRole('table')).getByText('B-11-1')).toBeInTheDocument();
    await openBox('421033881907');
    expect(progress()).toHaveTextContent('0 / 4');
  });

  it('새 송장 화면에서 송장이 아닌 바코드를 찍으면 새 송장을 먼저 찍으라고 하고 새 송장 안내는 그대로 둔다', async () => {
    await setupInspection({ boxes: [{ ...BOX1, labelState: 'reprint_required' }] });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    scan('8801002');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('새 송장을 먼저 찍어 주세요');
    expect(alert).toHaveTextContent('8801002');
    expect(alert).not.toHaveTextContent('운송장을 찾을 수 없어요');
    expect(screen.getByText('새 송장 출력됨')).toBeInTheDocument();
    expect(screen.getByText('옛 송장은 버리고 새 송장을 찍으세요')).toBeInTheDocument();
    expect(flash()).toBe('error');
    await openBox('421033881907');
    expect(progress()).toHaveTextContent('0 / 4');
  });

  it('송장과 길이가 같은 상품 바코드도 이 상자의 상품이면 새 송장을 먼저 찍으라고 한다', async () => {
    const lines = BOX1.lines.map((line, index) => (index === 0 ? { ...line, barcode: '880100200001' } : line));
    await setupInspection({ boxes: [{ ...BOX1, lines, labelState: 'reprint_required' }] });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    scan('880100200001');
    expect(await screen.findByRole('alert')).toHaveTextContent('새 송장을 먼저 찍어 주세요');
    expect(screen.getByText('새 송장 출력됨')).toBeInTheDocument();
  });

  it('새 송장 출력이 실패했으면 상품을 찍어도 새 송장을 찍으라고 하지 않는다 — 찍을 새 송장이 없다', async () => {
    await setupInspection({
      boxes: [{ ...BOX1, labelState: 'reprint_required' }],
      print: async () => {
        throw new Error('offline');
      },
    });
    scan('421033881907');
    expect(await screen.findByRole('button', { name: /다시 출력/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('새 송장 출력 중')).toBeNull());
    scan('8801002');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('이 운송장을 찾을 수 없어요'));
    expect(screen.queryByText('새 송장을 먼저 찍어 주세요.')).toBeNull();
  });

  it('새 송장을 다시 출력하면 지난 «새 송장을 먼저» 줄은 지운다 — 다시 출력이 실패해도 남기지 않는다', async () => {
    let fail = false;
    await setupInspection({
      boxes: [{ ...BOX1, labelState: 'reprint_required' }],
      print: async () => {
        if (fail) throw new Error('offline');
      },
    });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    scan('8801002');
    expect(await screen.findByText('새 송장을 먼저 찍어 주세요.')).toBeInTheDocument();
    fail = true;
    press('F12');
    // 다시 출력 실패는 큰 칸의 빨간 사유로 바뀐다 — 그 자리에 지난 거절 줄이 함께 남지 않는다
    await waitFor(() => expect(screen.queryByText('새 송장 출력됨')).toBeNull());
    await waitFor(() => expect(screen.queryByText('새 송장 출력 중')).toBeNull());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText('새 송장을 먼저 찍어 주세요.')).toBeNull();
  });

  it('새 송장 화면에서 송장처럼 생겼는데 없는 번호는 지금처럼 운송장을 찾을 수 없다고 한다', async () => {
    await setupInspection({ boxes: [{ ...BOX1, labelState: 'reprint_required' }] });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    scan('421099999999');
    expect(await screen.findByRole('alert')).toHaveTextContent('이 운송장을 찾을 수 없어요');
  });

  it('프린터가 없으면 새 송장 대신 «프린터 있는 자리» 로 거절한다', async () => {
    await setupInspection({ boxes: [{ ...BOX1, labelState: 'never_printed' }], prefs: stationPrefs({}, false) });
    scan('421033881907');
    expect(await screen.findByRole('alert')).toHaveTextContent('프린터 있는 자리에서 출력해 주세요');
  });

  it('새 송장·빠진 박스 화면에서도 거절 사유 한 줄을 보인다', async () => {
    const { server } = await setupInspection({
      boxes: [{ ...BOX1, labelState: 'reprint_required' }, { ...BOX2, shipped: true }],
    });
    scan('421033881907');
    expect(await screen.findByText('새 송장 출력됨')).toBeInTheDocument();
    scan('421033881915');
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 출고된 송장이에요');
    expect(flash()).toBe('error');

    const box = server.box('421033881907');
    if (!box) throw new Error('fixture');
    box.withdrawn = true;
    scan('421033881907');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    scan('421033881915');
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 출고된 송장이에요');
  });

  it('새 박스가 그려지기 전 틈에 찍은 상품은 옛 박스로 가지 않는다 — 받지 않고 알린다', async () => {
    // 전환의 마지막 걸음(새 박스를 기기에 적는 순간)을 잡아, React 가 새 화면을 그리기 전(마이크로태스크 안)에 상품을 찍는다.
    // 두 번 찍는다 — 첫 거절이 부른 동기 렌더가 옛 화면을 다시 커밋해도 두 번째가 옛 박스로 새지 않는지까지 본다
    const base = stationPrefs();
    let armed = false;
    let fired = 0;
    const hops = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    const rawScan = (code: string) => {
      for (const key of [...code, 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fired += 1;
    };
    const prefs: DevicePrefs = {
      get: (key) => base.get(key),
      remove: (key) => base.remove(key),
      set(key, value) {
        base.set(key, value);
        if (!armed || !value.includes('"shipmentId":"s-2"')) return;
        armed = false;
        void (async () => {
          await hops();
          rawScan('8801001');
          await hops();
          rawScan('8801001');
        })();
      },
    };
    const { server } = await setupInspection({ prefs });
    await openBox('421033881907');
    const release = server.holdSends();
    scan('8801002');
    await waitFor(() => expect(server.scanCalls).toHaveLength(1));
    scan('421033881915');
    await act(async () => {
      await sleep(30);
    });
    armed = true;
    release();
    expect(await screen.findByRole('heading', { name: '4210-3388-1915' })).toBeInTheDocument();
    await act(async () => {
      await sleep(50);
    });
    expect(fired).toBe(2);
    expect(screen.getByRole('alert')).toHaveTextContent('앞 스캔을 확인하고 있어요');
    expect(server.scans.filter((s) => s.shipmentId === 's-1').map((s) => s.barcode)).toEqual(['8801002']);
    expect(server.box('421033881907')?.shipped).toBe(false);
  });

  it('빠진 박스의 송장이면 «빠진 박스», Esc 로 송장 대기', async () => {
    const { server } = await setupInspection();
    const box = server.box('421033881907');
    if (!box) throw new Error('fixture');
    box.withdrawn = true;
    scan('421033881907');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    // 화면이 바뀐 커밋의 effect(기능키 등록)까지 돈 뒤에 누른다 — 부하가 크면 Esc 가 앞 렌더의 키 표로 판정된다
    await act(async () => {});
    press('Escape');
    expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
  });

  it('Esc 는 박스를 내려놓는다 — 찍은 수량은 서버에 남아 다시 열면 이어진다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    press('Escape');
    expect(await screen.findByText('송장을 찍어 주세요')).toBeInTheDocument();
    await openBox('421033881907');
    expect(progress()).toHaveTextContent('1 / 4');
  });

  it('송장 대기에서 숫자를 치면 직접 입력칸이 열리고, Enter 로 그 송장을 연다(§5.6)', async () => {
    await setupInspection();
    await typeHuman(['4']);
    const input = await screen.findByLabelText('송장번호');
    expect(input).toHaveValue('4');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '421033881907' } });
    const form = input.closest('form');
    if (!form) throw new Error('form');
    fireEvent.submit(form);
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('하던 박스는 다시 그려질 때 다시 연다(재시작·탭 이동)', async () => {
    const prefs = stationPrefs();
    writeLastBox(prefs, { trackingNo: '421033881907', shipmentId: 's-1', batchId: 'b-1' } as ShipmentByWaybill);
    await setupInspection({ prefs });
    expect(await screen.findByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('상태바에 그 박스 배치의 진행이 뜬다', async () => {
    await setupInspection({ picking: [batchSummary({ id: 'b-1', batchNumber: 'B-1002' })] });
    await openBox('421033881915');
    expect(await screen.findByText('B-1002 0/2')).toBeInTheDocument();
    scan('8801003');
    expect(await screen.findByText('B-1002 1/2')).toBeInTheDocument();
  });
});

describe('열린 검수 상자의 배치 제외 감지', () => {
  it.each(['withdrawing', 'excluded'])(
    '%s 상태를 받으면 다시 조회해 화면을 전환한다',
    async (status) => {
      const { server, queryClient } = await setupInspection();

      await openBox(BOX1.trackingNo);

      const box = server.box(BOX1.trackingNo);

      if (!box) {
        throw new Error('Missing box');
      }

      if (status === 'excluded') {
        box.withdrawn = true;
      } else {
        box.labelState = 'withdrawing';
      }

      await act(async () => {
        await queryClient.refetchQueries({
          queryKey: ['batch-work-items', BOX1.batchId],
        });
      });

      expect(
        status === 'excluded'
          ? await screen.findByText('빠진 박스')
          : await screen.findByRole('list', { name: '뺄 상품' })
      ).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: '진행' })).toBeNull();
      expect(
        server.requests.filter((request) =>
          request.path.startsWith('/shipments/by-waybill')
        )
      ).toHaveLength(2);
    }
  );

  it('진행 중인 상품 스캔을 마친 뒤 뺄 상품으로 전환한다', async () => {
    const { server, queryClient } = await setupInspection();

    await openBox(BOX1.trackingNo);

    const release = server.holdSends();

    scan('8801002');
    await waitFor(() => expect(server.scanCalls).toHaveLength(1));

    const box = server.box(BOX1.trackingNo);

    if (!box) {
      throw new Error('Missing box');
    }

    box.labelState = 'withdrawing';

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ['batch-work-items', BOX1.batchId],
      });
    });

    expect(progress()).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '뺄 상품' })).toBeNull();

    await act(async () => release());

    expect(await screen.findByRole('list', { name: '뺄 상품' })).toBeInTheDocument();
    expect(server.scans).toHaveLength(1);
  });

  it('재조회가 아직 검수 상태여도 같은 배치 응답으로 반복 조회하지 않는다', async () => {
    const { server, queryClient } = await setupInspection();

    await openBox(BOX1.trackingNo);

    const box = server.box(BOX1.trackingNo);

    if (!box) {
      throw new Error('Missing box');
    }

    box.workItemStatus = 'withdrawing';

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ['batch-work-items', BOX1.batchId],
      });
    });

    await waitFor(() => {
      expect(
        server.requests.filter((request) =>
          request.path.startsWith('/shipments/by-waybill')
        )
      ).toHaveLength(2);
    });
    await act(async () => {});

    expect(progress()).toBeInTheDocument();
    expect(
      server.requests.filter((request) =>
        request.path.startsWith('/shipments/by-waybill')
      )
    ).toHaveLength(2);
  });
});
