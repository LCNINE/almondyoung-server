import 'fake-indexeddb/auto';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STATION_FORCE_REASON, STATION_WITHDRAW_REASON } from './useInspectionBox';
import { openBox, press, scan, setupInspection, stationPrefs, typeHuman } from './__fixtures__/renderStation';

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const SLOW = { timeout: 4000 };
const big = (name: string) => screen.getByRole('status', { name });
/** 키가 켜질 때까지 — 꺼진 키에 누르면 아무 일도 안 일어나 «무장» 이 검증되지 않는다 */
const enabledKey = (name: RegExp) => waitFor(() => expect(bar().getByRole('button', { name })).toBeEnabled());

describe('검수 중 기능키(스펙 §6.3)', () => {
  it('F7 수량 → 키보드 숫자 → 다음 스캔 한 번에 그 수량, 그 뒤엔 1', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    press('F7');
    await typeHuman(['2']);
    expect(big('수량')).toHaveTextContent('2');
    scan('8801002');
    await waitFor(() => expect(server.scans).toEqual([expect.objectContaining({ barcode: '8801002', quantity: 2 })]), SLOW);
    await waitFor(() => expect(big('진행')).toHaveTextContent('2 / 4'), SLOW);
    scan('8801002');
    await waitFor(() => expect(server.scans[1]).toMatchObject({ barcode: '8801002', quantity: 1 }));
  });

  it('F7 수량은 숫자 명령(%91%N)으로도 넣고 Backspace 로 지운다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    press('F7');
    scan('%91%3');
    scan('%91%1');
    expect(big('수량')).toHaveTextContent('31');
    await typeHuman(['Backspace']);
    expect(big('수량')).toHaveTextContent('3');
    scan('8801002');
    await waitFor(() => expect(server.scans[0]).toMatchObject({ quantity: 3 }));
  });

  it('Esc 는 수량 입력만 먼저 취소한다 — 박스는 그대로', async () => {
    await setupInspection();
    await openBox('421033881907');
    press('F7');
    expect(bar().getByRole('button', { name: /수량 취소/ })).toBeInTheDocument();
    press('Escape');
    expect(big('진행')).toHaveTextContent('0 / 4');
    expect(screen.getByRole('heading', { name: '4210-3388-1907' })).toBeInTheDocument();
  });

  it('F8 이 상품 전량 — 직전에 찍은 줄의 남은 수량을 그 바코드로 한 번에(직전 스캔이 없으면 꺼짐)', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    expect(bar().queryByRole('button', { name: /이 상품 전량/ })).toBeNull();
    scan('8801002');
    await enabledKey(/이 상품 전량/);
    press('F8');
    await waitFor(() => expect(server.scans[1]).toMatchObject({ barcode: '8801002', quantity: 2 }));
    await waitFor(() => expect(big('진행')).toHaveTextContent('3 / 4'));
  });

  it('F10 강제출고는 한 번 더 눌러야 나간다 — 고정 사유', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    // 권한 미리보기(work-context)가 도착해야 F10 이 선언된다
    await enabledKey(/강제출고/);
    press('F10');
    await enabledKey(/강제출고 확정/);
    expect(screen.getByText('강제출고')).toBeInTheDocument();
    expect(server.forces).toEqual([]);
    press('F10');
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    expect(server.forces).toEqual([{ shipmentId: 's-1', reason: STATION_FORCE_REASON }]);
  });

  it('무장은 스캔·다른 키로 풀린다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    await enabledKey(/강제출고/);
    press('F10');
    await enabledKey(/강제출고 확정/);
    scan('8801001');
    await waitFor(() => expect(big('진행')).toHaveTextContent('1 / 4'));
    await enabledKey(/강제출고$/);
    press('F10');
    await enabledKey(/강제출고 확정/);
    press('F7');
    await enabledKey(/강제출고$/);
    press('F10');
    await enabledKey(/강제출고 확정/);
    expect(server.forces).toEqual([]);
  });

  it('강제출고 권한이 없으면 F10 을 그리지 않는다', async () => {
    await setupInspection({ permissions: { shortPick: true } });
    await openBox('421033881907');
    await waitFor(() => expect(bar().getByRole('button', { name: /박스 빼기/ })).toBeInTheDocument());
    expect(bar().queryByRole('button', { name: /강제출고/ })).toBeNull();
  });

  it('F11 박스 빼기 — 한 번 더 누르면 고정 사유로 빼고, 담은 상품이 있으면 뺄 상품으로', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    await enabledKey(/박스 빼기/);
    press('F11');
    await enabledKey(/박스 빼기 확정/);
    expect(server.excludes).toEqual([]);
    press('F11');
    expect(await screen.findByText('뺄 상품')).toBeInTheDocument();
    expect(server.excludes).toEqual([{ batchId: 'b-1', shipmentId: 's-1', reason: STATION_WITHDRAW_REASON }]);
  });

  it('F11 — 담은 상품이 없으면 바로 빠진 박스', async () => {
    const { server } = await setupInspection();
    server.config.excludeOutcome = 'removed';
    await openBox('421033881907');
    await enabledKey(/박스 빼기/);
    press('F11');
    await enabledKey(/박스 빼기 확정/);
    press('F11');
    expect(await screen.findByText('빠진 박스')).toBeInTheDocument();
  });

  it('F12 송장 재출력 — 프린터로 다시 보낸다', async () => {
    const { print } = await setupInspection();
    await openBox('421033881907');
    press('F12');
    await waitFor(() => expect(print).toHaveBeenCalledWith('spooler://XP-DT108B', '^XA421033881907^XZ'));
  });

  it('프린터가 없으면 F12 를 그리지 않는다', async () => {
    await setupInspection({ prefs: stationPrefs({}, false) });
    await openBox('421033881907');
    expect(bar().queryByRole('button', { name: /송장 재출력/ })).toBeNull();
  });
});
