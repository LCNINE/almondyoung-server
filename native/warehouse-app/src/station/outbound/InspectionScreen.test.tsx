import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
  it('송장을 찍으면 박스가 열린다 — 송장번호·받는 분·배송메모, 송장 순서 품목 표', async () => {
    await setupInspection();
    await openBox('421033881907');
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    expect(screen.getByText('김*영')).toBeInTheDocument();
    expect(screen.getByText('문 앞에 놓아주세요')).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1) as HTMLTableRowElement[];
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(['A-03-2', 'B-11-1']);
    expect(progress()).toHaveTextContent('0 / 4');
  });

  it('상품을 찍으면 그 줄이 오르고, 마지막 상품이면 출고되어 송장 대기로 — 직전 박스 완료를 보인다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    for (const code of ['8801002', '8801002', '8801001']) scan(code);
    expect(await screen.findByText('출고 완료')).toBeInTheDocument();
    expect(screen.getByText('송장 바코드')).toBeInTheDocument();
    expect(flash()).toBe('complete');
    expect(server.box('421033881907')?.shipped).toBe(true);
  });

  it('박스에 없는 상품은 빨간 칸·오류로 알리고 진행은 그대로', async () => {
    await setupInspection();
    await openBox('421033881907');
    scan('8809999');
    expect(await screen.findByRole('alert')).toHaveTextContent('이 송장에 없는 상품이에요');
    expect(flash()).toBe('error');
    scan('8801001');
    await waitFor(() => expect(progress()).toHaveTextContent('1 / 4'));
    expect(screen.queryByRole('alert')).toBeNull();
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

  it('앞 스캔을 확인 못 한 채로는 다른 송장·Esc 를 받지 않는다 — 박스를 그대로 든다', async () => {
    const { server, runtime } = await setupInspection();
    await openBox('421033881907');
    server.loseResponses(true);
    scan('8801002');
    await waitFor(async () => expect((await runtime.store.pending('scope'))[0]?.status).toBe('uncertain'));
    scan('421033881915');
    expect(await screen.findByRole('alert')).toHaveTextContent('앞 스캔이 처리됐는지 확인하지 못했어요');
    press('Escape');
    await act(async () => {
      await sleep(30);
    });
    expect(heading('4210-3388-1907')).toBeInTheDocument();
    expect(flash()).toBe('error');
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
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
  });

  it('Esc 는 박스를 내려놓는다 — 찍은 수량은 서버에 남아 다시 열면 이어진다', async () => {
    const { server } = await setupInspection();
    await openBox('421033881907');
    scan('8801002');
    await waitFor(() => expect(server.scans).toHaveLength(1));
    press('Escape');
    expect(await screen.findByText('송장 바코드')).toBeInTheDocument();
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
