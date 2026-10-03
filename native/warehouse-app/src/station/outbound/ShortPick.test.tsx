import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PRINTER_FAILURE_MESSAGE, PrinterError, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import type { WorkPermissions } from '../../core/operations/OperationContext';
import { SHORT_PICK_UNCERTAIN_MESSAGE } from '../../domains/outbound/shortPick';
import type { FakeBox } from './__fixtures__/outboundServer';
import { BOX1, flash, openBox, press, scan, setupInspection, typeHuman } from './__fixtures__/renderStation';

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const dialog = () => screen.getByRole('dialog', { name: '결품' });
const cell = (name: string) => within(dialog()).getByLabelText(`${name} 결품`);

/** 박스를 열고 한 개(집게핀)를 찍은 뒤 F9 — 남은 수량: 집게핀 2, 컬러크림 1 */
async function openShortPick(opts: Parameters<typeof setupInspection>[0] = {}) {
  const setup = await setupInspection(opts);
  await openBox('421033881907');
  scan('8801002');
  await waitFor(() => expect(setup.server.scans).toHaveLength(1));
  await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
  press('F9');
  await screen.findByRole('dialog', { name: '결품' });
  return setup;
}

describe('F9 결품(스펙 §7.1·§7.2)', () => {
  it('덜 찍힌 줄을 남은 수량으로 채워 열고, Enter·Enter 로 재고 부족 결품을 보낸다 — 버전은 보내기 직전 조회 값', async () => {
    const { server } = await openShortPick();
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    expect(cell('컬러크림 6N')).toHaveTextContent('1');
    await typeHuman(['Enter', 'Enter']);
    await waitFor(() => expect(server.shortPicks).toHaveLength(1));
    expect(server.shortPicks[0].body).toEqual({
      workItemId: 'wi-s-1',
      expectedWorkItemLeaseVersion: 3,
      sessionId: 'ses-b-1',
      expectedSessionVersion: 5,
      expectedManifestVersion: 2,
      lines: [
        { shipmentLineId: 'l-2', sourceLocationId: 'loc-B-11-1', expectedLineVersion: 2, shortQty: 2 },
        { shipmentLineId: 'l-1', sourceLocationId: 'loc-A-03-2', expectedLineVersion: 2, shortQty: 1 },
      ],
      reason: 'inventory_shortage',
    });
  });

  it('숫자로 줄이고(상한 = 남은 수량), 사유 2 를 고르면 파손으로 보낸다', async () => {
    const { server } = await openShortPick();
    await typeHuman(['9']);
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    await typeHuman(['Backspace', '1', 'ArrowDown', '0']);
    expect(cell('헤어클립 집게핀')).toHaveTextContent('1');
    expect(cell('컬러크림 6N')).toHaveTextContent('0');
    await typeHuman(['Enter', '2', 'Enter']);
    await waitFor(() => expect(server.shortPicks).toHaveLength(1));
    expect(server.shortPicks[0].body).toMatchObject({
      lines: [{ shipmentLineId: 'l-2', sourceLocationId: 'loc-B-11-1', shortQty: 1 }],
      reason: 'item_damaged',
    });
  });

  it('숫자 명령(%91%N)도 같은 칸에 들어가고, 명령 바코드의 Enter 로는 넘어가지 않는다', async () => {
    const { server } = await openShortPick();
    scan('%91%1');
    expect(cell('헤어클립 집게핀')).toHaveTextContent('1');
    expect(cell('컬러크림 6N')).toHaveTextContent('1');
    await typeHuman(['Enter']);
    scan('%91%2');
    expect(within(dialog()).getByText('파손').closest('li')).toHaveAttribute('data-selected', 'true');
    expect(server.shortPicks).toHaveLength(0);
    await typeHuman(['Enter']);
    await waitFor(() => expect(server.shortPicks).toHaveLength(1));
    expect(server.shortPicks[0].body).toMatchObject({ reason: 'item_damaged' });
  });

  it('Esc 는 한 단계 뒤로 — 사유에서 수량으로, 수량에서 닫기(박스는 그대로)', async () => {
    await openShortPick();
    await typeHuman(['Enter']);
    expect(within(dialog()).getByRole('list', { name: '사유' })).toBeInTheDocument();
    await typeHuman(['Escape']);
    expect(cell('헤어클립 집게핀')).toBeInTheDocument();
    await typeHuman(['Escape']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('결품 창이 열린 채 상품을 찍으면 오류음만 — 창·수량이 그대로이고 스캐너 Enter 로 확정되지 않는다', async () => {
    const { server } = await openShortPick();
    scan('8801002');
    expect(flash()).toBe('error');
    expect(dialog()).toBeInTheDocument();
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    expect(server.shortPicks).toHaveLength(0);
    expect(server.scans).toHaveLength(1);
  });

  it('보내기 직전 다시 조회해 남은 수량이 줄었으면 보내지 않는다(다른 스테이션이 더 찍음)', async () => {
    const { server } = await openShortPick();
    server.pick('421033881907', 'l-2', 1);
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByRole('alert')).toHaveTextContent('박스 상태가 바뀌었어요');
    expect(server.shortPicks).toHaveLength(0);
  });

  it('«다시 F9» 는 새로 조회한 박스로 연다 — 같은 낡은 수량으로 다시 실패하지 않는다', async () => {
    const { server } = await openShortPick();
    server.pick('421033881907', 'l-2', 1);
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByRole('alert')).toHaveTextContent('박스 상태가 바뀌었어요');
    await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
    press('F9');
    await screen.findByRole('dialog', { name: '결품' });
    expect(cell('헤어클립 집게핀')).toHaveTextContent('1');
    await typeHuman(['Enter', 'Enter']);
    await waitFor(() => expect(server.shortPicks).toHaveLength(1));
    expect(server.shortPicks[0].body).toMatchObject({
      lines: [
        { shipmentLineId: 'l-2', sourceLocationId: 'loc-B-11-1', expectedLineVersion: 3, shortQty: 1 },
        { shipmentLineId: 'l-1', sourceLocationId: 'loc-A-03-2', expectedLineVersion: 3, shortQty: 1 },
      ],
    });
  });

  it('응답을 잃은 결품은 다시 F9 에서 같은 키·같은 본문으로 보낸다 — 서버에는 한 번만 반영된다', async () => {
    const { server } = await openShortPick();
    server.loseNextShortPick();
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByRole('alert')).toHaveTextContent(SHORT_PICK_UNCERTAIN_MESSAGE);
    expect(server.shortPicks).toHaveLength(1);
    await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
    press('F9');
    await screen.findByRole('dialog', { name: '결품' });
    // 보낸 것을 그대로 다시 보낸다 — 창에서 바꿀 수 없다
    await typeHuman(['1']);
    expect(cell('헤어클립 집게핀')).toHaveTextContent('2');
    const lookups = server.requests.filter((r) => r.path.startsWith('/shipments/by-waybill')).length;
    await typeHuman(['Enter', 'Enter']);
    await waitFor(() => expect(server.shortPickCalls).toHaveLength(2));
    expect(server.shortPickCalls[1]).toEqual(server.shortPickCalls[0]);
    expect(server.shortPicks).toHaveLength(1);
    expect(await screen.findByText('보충 대기')).toBeInTheDocument();
    // 다시 보낼 때는 조회하지 않는다(채움 뒤 다시 조회는 송장 대기 화면이 하지 않는다)
    expect(server.requests.filter((r) => r.path.startsWith('/shipments/by-waybill')).length).toBe(lookups);
  });

  it('화면이 다른 일을 하는 동안(F12 출력 중)에는 F9 가 꺼져 있다', async () => {
    let release!: () => void;
    const print = vi.fn<PrintRaw>(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await setupInspection({ print });
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
    press('F12');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bar().queryByRole('button', { name: /결품/ })).toBeNull());
    press('F9');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(flash()).toBe('error');
    await act(async () => release());
    await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
  });

  it('결품을 보내는 사이 다른 박스가 열렸으면 그 화면을 뺏지 않는다 — 알리고 새 송장은 뽑는다', async () => {
    const { server, print } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(bar().getByRole('button', { name: /결품/ })).toBeInTheDocument());
    const releaseLookups = server.holdLookups();
    const releaseShortPick = server.holdShortPicks();
    // 다른 송장 조회가 떠 있는 같은 틱에 F9 — 화면이 아직 그 조회를 그리지 못했다
    act(() => {
      for (const key of [...'421033881915', 'Enter']) window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      fireEvent.keyDown(window, { key: 'F9' });
    });
    await screen.findByRole('dialog', { name: '결품' });
    await typeHuman(['Enter', 'Enter']);
    await act(async () => releaseLookups());
    expect(await screen.findByRole('heading', { name: '4210-3388-1915' })).toBeInTheDocument();
    await waitFor(() => expect(server.shortPickCalls).toHaveLength(1));
    await act(async () => releaseShortPick());
    expect(await screen.findByRole('alert')).toHaveTextContent('421033881907');
    expect(screen.getByRole('heading', { name: '4210-3388-1915' })).toBeInTheDocument();
    expect(screen.queryByText('보충 대기')).toBeNull();
    await waitFor(() => expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ'));
  });

  it('채움(refilled) — 새 송장을 자동 출력하고 송장 대기에 가져올 것을 보인다', async () => {
    const { server, print } = await openShortPick();
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText('보충 대기')).toBeInTheDocument();
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
    expect(screen.getAllByText('[C-07-1]').length).toBeGreaterThan(0);
    await waitFor(() => expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ'));
    expect(server.confirmedPrints).toEqual(['s-1']);
  });

  it('채움 뒤 자동 출력이 실패하면 송장 대기의 F12 가 그 송장을 다시 뽑는다', async () => {
    const print = vi
      .fn<PrintRaw>()
      .mockRejectedValueOnce(new PrinterError('offline'))
      .mockResolvedValue(undefined);
    await openShortPick({ print });
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText(PRINTER_FAILURE_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(bar().getByRole('button', { name: /송장 재출력/ })).toBeInTheDocument());
    press('F12');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(PRINTER_FAILURE_MESSAGE)).toBeNull());
  });

  it('빼는 중(withdrawing) — 다시 조회해 뺄 상품으로', async () => {
    const { server } = await openShortPick();
    server.config.shortPickOutcome = 'withdrawing';
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText('뺄 상품')).toBeInTheDocument();
  });

  it('빠짐(exited) — 빠진 박스', async () => {
    const { server } = await openShortPick();
    server.config.shortPickOutcome = 'exited';
    await typeHuman(['Enter', 'Enter']);
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
    // 결과로 다시 그리기만 한다 — 송장 줄은 처음 찍었을 때 한 줄뿐
    const recent = screen.getByRole('list', { name: '최근 스캔' });
    expect(within(recent).getAllByText('4210-3388-1907')).toHaveLength(1);
  });

  const hidden: Array<[string, { permissions?: WorkPermissions; boxes?: FakeBox[] }]> = [
    ['결품 권한 없음', { permissions: { stationForceDispatch: true } }],
    ['옛 core(버전 없음)', { boxes: [{ ...BOX1, legacy: true }] }],
  ];
  it.each(hidden)('%s 이면 F9 를 그리지 않는다', async (_name, opts) => {
    await setupInspection(opts);
    await openBox('421033881907');
    await waitFor(() => expect(bar().getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    expect(bar().queryByRole('button', { name: /결품/ })).toBeNull();
  });
});
