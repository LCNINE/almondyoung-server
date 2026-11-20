import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flash, press, scan, typeHuman } from '../outbound/__fixtures__/renderStation';
import { AWAITING, PARTIAL, READY, listed, orderNos, setupReturns } from './__fixtures__/renderReturns';
import type { ArrivalBody, FakeReturn, ReturnsServer } from './__fixtures__/returnsServer';

const SUCCESS_HZ = 1760;
const COMPLETE_HZ = 1568;

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const region = () => screen.getByRole('region', { name: '소포 세기' });
const arrivalKey = () => bar().queryByRole('button', { name: /F10\s*도착 확정/ });
const inspectKey = () => bar().queryByRole('button', { name: /F11\s*불량·보류 검수/ });
const allGoodKey = () => bar().queryByRole('button', { name: /F10\s*모두 양품 확정/ });
function itemRow(itemId: string): HTMLElement {
  const found = region().querySelector<HTMLElement>(`tr[data-item-id="${itemId}"]`);
  if (!found) throw new Error(`row ${itemId} not found`);
  return found;
}
const cell = (itemId: string, col: 'remaining' | 'parcel' | 'shelf') =>
  itemRow(itemId).querySelector(`[data-col="${col}"]`)?.textContent ?? '';
const parcelOf = (itemId: string) => cell(itemId, 'parcel');
const bigCount = () => screen.getByRole('status', { name: '이번 소포' });
/** 서버에 닿은 도착 요청 본문 — 응답 전에 끊긴 것(failNext)도 센다 */
const arrivalPosts = (server: ReturnsServer) =>
  server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/arrivals')).map((r) => r.body as ArrivalBody);
const byItem = (items: ArrivalBody['items']) =>
  [...items].sort((a, b) => a.customerReturnItemId.localeCompare(b.customerReturnItemId));

/** 목록에서 상품을 찍어 그 반품의 소포 세기를 연다 — 찍은 한 개가 이번 소포에 든다 */
async function openByScan(barcode: string) {
  await listed();
  scan(barcode);
  return screen.findByRole('region', { name: '소포 세기' });
}

/** 목록 행을 눌러 연다 — 아무것도 세지 않은 채로 */
async function openReturn(orderNo: string) {
  await listed();
  const row = screen.getAllByRole('option').find((option) => option.getAttribute('data-order-no') === orderNo);
  if (!row) throw new Error(`row ${orderNo} not found`);
  fireEvent.click(within(row).getByRole('button'));
  return screen.findByRole('region', { name: '소포 세기' });
}

/** 같은 SKU 가 두 줄에 — 세트 구성품과 낱개 */
const TWIN_SKU: FakeReturn = {
  id: 'cr-7',
  orderNo: 'O-1007',
  customerName: '정하늘',
  status: 'expected',
  requestedAt: '2026-10-24T01:00:00.000Z',
  lines: [
    { id: 'crl-7a', productName: '염색 세트', items: [{ id: 'cri-7a', skuName: '컬러크림 5N', expectedQty: 1, barcodes: ['8807005'] }] },
    { id: 'crl-7b', productName: '컬러크림 5N', items: [{ id: 'cri-7b', skuName: '컬러크림 5N', expectedQty: 1, barcodes: ['8807005'] }] },
  ],
};

/** 손으로 칠 만큼 많이 — 두 줄 */
const BULK: FakeReturn = {
  id: 'cr-6',
  orderNo: 'O-1006',
  customerName: '최유나',
  status: 'expected',
  requestedAt: '2026-10-23T01:00:00.000Z',
  lines: [
    { id: 'crl-6a', productName: '헤어밴드', items: [{ id: 'cri-6a', skuName: '헤어밴드', expectedQty: 12, barcodes: ['8806001'] }] },
    { id: 'crl-6b', productName: '빗', items: [{ id: 'cri-6b', skuName: '빗', expectedQty: 5, barcodes: ['8806002'] }] },
  ],
};

describe('반품 사유와 메모', () => {
  it('판매자 부담 밴드와 고객 메모를 보여 준다', async () => {
    setupReturns({ returns: [PARTIAL] });
    await openReturn('O-1002');

    expect(within(region()).getByText('오배송 · 판매자 부담')).toHaveClass(
      'bg-[#FFF1C7]',
      'text-[#5E3B00]'
    );
    expect(
      within(region()).getByText(`메모: ${PARTIAL.note}`)
    ).toBeInTheDocument();
  });

  it.each([null, ''])(
    '고객 부담이고 메모가 %p이면 메모 줄이 없다',
    async (note) => {
      setupReturns({
        returns: [
          { ...PARTIAL, reason: 'change_of_mind', feeBearer: 'customer', note },
        ],
      });
      await openReturn('O-1002');

      expect(within(region()).getByText('단순 변심 · 고객 부담')).toHaveClass(
        'bg-[#EDEEF0]',
        'text-[#3F4450]'
      );
      expect(within(region()).queryByText(/^메모:/)).toBeNull();
    }
  );
});

describe('소포 세기 — 화면', () => {
  it('표 `상품 | 남은 수량 | 이번 소포`, 남은 수량 = 기대 − 이미 도착, 큰 숫자 «이번 소포 0», F10 은 없다', async () => {
    setupReturns();
    await openReturn('O-1002');
    const headers = within(region()).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['상품', '남은 수량', '이번 소포']);
    expect(cell('cri-2', 'remaining')).toBe('2');
    expect(cell('cri-3', 'remaining')).toBe('1');
    expect(cell('cri-2', 'shelf')).toBe('선반 A-01-4');
    expect(cell('cri-3', 'shelf')).toBe('선반 미지정');
    expect(parcelOf('cri-2')).toBe('0');
    expect(bigCount()).toHaveTextContent('이번 소포0');
    expect(screen.getByText('이미 받은 소포가 있어요')).toBeInTheDocument();
    await waitFor(() => expect(bar().getByRole('button', { name: /Esc\s*목록/ })).toBeInTheDocument());
    expect(arrivalKey()).toBeNull();
  });

  it('기능키 바에 바코드 없이 세는 키를 알려 주고, 목록으로 나가면 지운다', async () => {
    setupReturns();
    await openReturn('O-1002');
    const hints = await waitFor(() => bar().getByLabelText('키 안내'));
    expect(hints).toHaveTextContent('↑↓상품 고르기0-9수량⌫지우기');
    press('Escape');
    await waitFor(() => expect(bar().queryByLabelText('키 안내')).toBeNull());
  });

  it('아직 아무것도 안 온 반품엔 «이미 받은 소포» 줄이 없다', async () => {
    setupReturns();
    await openReturn('O-1001');
    expect(screen.queryByText('이미 받은 소포가 있어요')).toBeNull();
  });
});

describe('소포 세기 — 스캔', () => {
  it('찍으면 그 줄 +1·선택·성공음, 다 찬 줄은 «더 받을 수 없어요», 없는 바코드는 «이 반품에 없는 상품이에요» — 수량 그대로', async () => {
    const { beeps } = setupReturns({ returns: [BULK, PARTIAL] });
    await openReturn('O-1006');
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('1'));
    expect(itemRow('cri-6b')).toHaveAttribute('aria-selected', 'true');
    expect(itemRow('cri-6a')).toHaveAttribute('aria-selected', 'false');
    expect(beeps.at(-1)?.frequency).toBe(SUCCESS_HZ);
    expect(bigCount()).toHaveTextContent('이번 소포1');
    await waitFor(() => expect(arrivalKey()).toBeInTheDocument());

    scan('8801002');
    expect(await screen.findByRole('alert')).toHaveTextContent('이 반품에 없는 상품이에요');
    expect(flash()).toBe('error');
    expect(parcelOf('cri-6b')).toBe('1');

    for (let i = 0; i < 4; i += 1) scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('5'));
    scan('8806002');
    expect(await screen.findByRole('alert')).toHaveTextContent('더 받을 수 없어요');
    expect(flash()).toBe('error');
    expect(parcelOf('cri-6b')).toBe('5');
  });

  it('같은 SKU 가 두 줄 — 남은 첫 줄로, 그 줄이 차면 다음 줄, 둘 다 차면 오류음', async () => {
    setupReturns({ returns: [TWIN_SKU] });
    await openReturn('O-1007');
    scan('8807005');
    await waitFor(() => expect(parcelOf('cri-7a')).toBe('1'));
    expect(parcelOf('cri-7b')).toBe('0');
    scan('8807005');
    await waitFor(() => expect(parcelOf('cri-7b')).toBe('1'));
    expect(itemRow('cri-7b')).toHaveAttribute('aria-selected', 'true');
    scan('8807005');
    expect(await screen.findByRole('alert')).toHaveTextContent('더 받을 수 없어요');
    expect(parcelOf('cri-7a')).toBe('1');
    expect(parcelOf('cri-7b')).toBe('1');
  });
});

describe('소포 세기 — 손 입력', () => {
  it('↑↓ 줄 선택, 숫자는 선택 줄 «이번 소포» 덮어쓰기·이어 치기, Backspace 지움, 상한 넘김은 오류음·그대로', async () => {
    setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    expect(itemRow('cri-6a')).toHaveAttribute('aria-selected', 'true');
    await typeHuman(['1', '2']);
    expect(parcelOf('cri-6a')).toBe('12');
    await typeHuman(['3']);
    expect(flash()).toBe('error');
    expect(parcelOf('cri-6a')).toBe('12');

    await typeHuman(['ArrowDown', '3']);
    expect(itemRow('cri-6b')).toHaveAttribute('aria-selected', 'true');
    expect(parcelOf('cri-6b')).toBe('3');
    await typeHuman(['ArrowDown', '4']);
    expect(itemRow('cri-6b')).toHaveAttribute('aria-selected', 'true');
    expect(parcelOf('cri-6b')).toBe('4');
    await typeHuman(['Backspace']);
    expect(parcelOf('cri-6b')).toBe('0');

    await typeHuman(['ArrowUp', '7']);
    expect(parcelOf('cri-6a')).toBe('7');
    await typeHuman(['Backspace']);
    expect(parcelOf('cri-6a')).toBe('0');
    expect(bigCount()).toHaveTextContent('이번 소포0');
  });

  it('스캔 뒤 첫 숫자는 그 줄을 덮어쓴다', async () => {
    setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('1'));
    await typeHuman(['4']);
    expect(parcelOf('cri-6b')).toBe('4');
  });
});

describe('도착 확정 F10', () => {
  it('보낸 본문 = { warehouseId, items(0 제외), idempotencyKey } — 다 오는 소포를 F11 로 보내면 검수 화면', async () => {
    const { server } = setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    await typeHuman(['1', '2', 'ArrowDown', '5']);
    await waitFor(() => expect(inspectKey()).toBeInTheDocument());
    press('F11');
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'O-1006' })).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(1);
    const body = server.arrivalCalls[0].body;
    expect(body).toEqual({
      warehouseId: 'w-1',
      items: [
        { customerReturnItemId: 'cri-6a', quantity: 12 },
        { customerReturnItemId: 'cri-6b', quantity: 5 },
      ],
      idempotencyKey: expect.any(String),
    });
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('도착 확정이 성공하면 완료음 — 다 오면 검수로, 덜 오면 목록으로 가는 두 길 모두', async () => {
    const full = setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    await typeHuman(['1', '2', 'ArrowDown', '5']);
    await waitFor(() => expect(inspectKey()).toBeInTheDocument());
    press('F11');
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(full.beeps.at(-1)?.frequency).toBe(COMPLETE_HZ);
    expect(flash()).toBe('complete');
  });

  it('덜 와도 도착 확정이 성공하면 완료음', async () => {
    const { beeps } = setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('1'));
    press('F10');
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
    expect(beeps.at(-1)?.frequency).toBe(COMPLETE_HZ);
  });

  it('덜 오면 «남은 물건은 CS 가 정해요» 뒤 목록 — 0 인 줄은 보내지 않는다', async () => {
    const { server } = setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('1'));
    press('F10');
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '소포 세기' })).toBeNull();
    expect(await listed()).toEqual(['O-1006']);
    expect(server.arrivalCalls[0].body.items).toEqual([{ customerReturnItemId: 'cri-6b', quantity: 1 }]);
  });

  it('F10 이 렌더 전에 두 번 와도 한 번만 보낸다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    await waitFor(() => expect(arrivalKey()).toBeInTheDocument());
    const release = server.holdWrites();
    act(() => {
      fireEvent.keyDown(window, { key: 'F10' });
      fireEvent.keyDown(window, { key: 'F10' });
    });
    await act(async () => {});
    release();
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
    expect(arrivalPosts(server)).toHaveLength(1);
  });

  it('보내는 중엔 스캔·입력이 오류음이고 수량 그대로', async () => {
    const { server } = setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('1'));
    const release = server.holdWrites();
    press('F10');
    await waitFor(() => expect(arrivalPosts(server)).toHaveLength(1));
    scan('8806002');
    await waitFor(() => expect(flash()).toBe('error'));
    expect(parcelOf('cri-6b')).toBe('1');
    release();
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
  });
});

describe('이미 받은 소포가 있는 반품', () => {
  it('첫 F10 은 «새 소포면 F10 한 번 더», 두 번째에 보낸다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1002');
    scan('8801003');
    await waitFor(() => expect(parcelOf('cri-3')).toBe('1'));
    press('F10');
    expect(await screen.findByText('새 소포면 F10 한 번 더')).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(0);
    press('F10');
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(1);
    expect(server.arrivalCalls[0].body.items).toEqual([{ customerReturnItemId: 'cri-3', quantity: 1 }]);
  });

  it('사이에 스캔·입력하면 첫 누름이 풀린다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1002');
    scan('8801003');
    await waitFor(() => expect(parcelOf('cri-3')).toBe('1'));
    press('F10');
    expect(await screen.findByText('새 소포면 F10 한 번 더')).toBeInTheDocument();
    scan('8801002');
    await waitFor(() => expect(parcelOf('cri-2')).toBe('1'));
    expect(screen.queryByText('새 소포면 F10 한 번 더')).toBeNull();
    press('F10');
    expect(await screen.findByText('새 소포면 F10 한 번 더')).toBeInTheDocument();
    await typeHuman(['1']);
    expect(parcelOf('cri-2')).toBe('1');
    expect(screen.queryByText('새 소포면 F10 한 번 더')).toBeNull();
    press('F10');
    expect(await screen.findByText('새 소포면 F10 한 번 더')).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(0);
    press('F10');
    await waitFor(() => expect(server.arrivalCalls).toHaveLength(1));
    expect(byItem(server.arrivalCalls[0].body.items)).toEqual([
      { customerReturnItemId: 'cri-2', quantity: 1 },
      { customerReturnItemId: 'cri-3', quantity: 1 },
    ]);
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
  });
});

describe('결과를 모르는 도착', () => {
  it('네트워크 실패 — 수량 잠김(스캔·입력 오류음), F10 이 같은 키·같은 본문으로 다시 보낸다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    server.failNext({ method: 'POST' });
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요 — F10 다시 보내기');
    expect(flash()).toBe('error');
    expect(screen.getByRole('region', { name: '소포 세기' })).toBeInTheDocument();

    scan('8801001');
    await waitFor(() => expect(flash()).toBe('error'));
    expect(parcelOf('cri-1')).toBe('1');
    await typeHuman(['2']);
    expect(flash()).toBe('error');
    expect(parcelOf('cri-1')).toBe('1');

    await waitFor(() => expect(bar().getByRole('button', { name: /F10\s*다시 보내기/ })).toBeInTheDocument());
    press('F10');
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
    const posts = arrivalPosts(server);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(server.arrivals).toEqual([{ returnId: 'cr-1', key: posts[0].idempotencyKey, itemId: 'cri-1', quantity: 1 }]);
  });

  it('서버가 받았는데 응답을 잃음 — 다시 보내면 같은 뷰가 돌아와 정상 진행(한 번만 반영)', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('2'));
    server.failNext({ method: 'POST', applied: true });
    press('F11');
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요 — F10 다시 보내기');
    expect(inspectKey()).toBeNull();
    press('F10');
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(2);
    expect(server.arrivalCalls[1].body).toEqual(server.arrivalCalls[0].body);
    expect(server.arrivals).toHaveLength(1);
  });

  it('Esc 의 «버리기» 대기는 다시 보내기를 넘어 살아남지 않는다 — 다시 실패하면 결과 모름이 보이고, Esc 한 번으론 버리지 않는다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    server.failNext({ method: 'POST' });
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요 — F10 다시 보내기');
    press('Escape');
    expect(await screen.findByText('한 번 더 누르면 목록으로 — 보낸 소포는 다시 열어 확인하세요')).toBeInTheDocument();
    server.failNext({ method: 'POST' });
    press('F10');
    await waitFor(() => expect(arrivalPosts(server)).toHaveLength(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요 — F10 다시 보내기');
    expect(screen.queryByText('한 번 더 누르면 목록으로 — 보낸 소포는 다시 열어 확인하세요')).toBeNull();
    press('Escape');
    expect(await screen.findByText('한 번 더 누르면 목록으로 — 보낸 소포는 다시 열어 확인하세요')).toBeInTheDocument();
    expect(region()).toBeInTheDocument();
  });

  it('5xx 도 결과 모름이다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    server.failNext({ method: 'POST', status: 503 });
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요 — F10 다시 보내기');
    press('F10');
    expect(await screen.findByText('남은 물건은 CS 가 정해요')).toBeInTheDocument();
    const posts = arrivalPosts(server);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });
});

describe('서버 거절 — 상세를 다시 읽는다(N10)', () => {
  it('그 사이 취소됐으면(409) «취소된 반품이에요» 뒤 목록', async () => {
    const { server } = setupReturns({ returns: [AWAITING, READY] });
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    server.setStatus(AWAITING.id, 'cancelled');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('취소된 반품이에요');
    await waitFor(() => expect(orderNos()).toEqual(['O-1003']));
    const after = server.requests.slice(server.requests.findIndex((r) => r.method === 'POST'));
    expect(after.some((r) => r.path === '/admin/customer-return-receiving/cr-1')).toBe(true);
  });

  it('다른 스테이션이 다 받았으면(400) 다시 읽은 단계(검수)로 — 오류 한 줄, 옛 뷰로 다시 보내지 않는다', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    server.arrive(AWAITING.id, 'cri-1', 2);
    press('F10');
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(flash()).toBe('error');
    expect(server.arrivalCalls).toHaveLength(1);
  });

  it('일부를 다른 스테이션이 받았으면 새 상세로 소포 세기를 다시 연다 — 센 수량은 비고 키도 새로', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('2'));
    server.arrive(AWAITING.id, 'cri-1', 1);
    press('F10');
    expect(await screen.findByText('모두 양품이면 F10 한 번 더')).toBeInTheDocument();
    press('F10');
    await waitFor(() => expect(cell('cri-1', 'remaining')).toBe('1'));
    expect(parcelOf('cri-1')).toBe('0');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('이미 받은 소포가 있어요')).toBeInTheDocument();
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    expect(screen.queryByRole('alert')).toBeNull();
    press('F10');
    expect(await screen.findByText('새 소포이고 모두 양품이면 F10 한 번 더')).toBeInTheDocument();
    press('F10');
    expect(await screen.findByText('O-1001 검수까지 끝냈어요 — 환불을 요청했어요')).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(2);
    expect(server.arrivalCalls[1].body.idempotencyKey).not.toBe(server.arrivalCalls[0].body.idempotencyKey);
    expect(server.inspections).toHaveLength(1);
  });
});

describe('Esc', () => {
  it('이번 소포가 0 이면 바로 목록', async () => {
    setupReturns();
    await openReturn('O-1001');
    press('Escape');
    expect(await listed()).toEqual(['O-1003', 'O-1002', 'O-1001']);
  });

  it('센 게 있으면 «한 번 더 누르면 센 수량을 버려요», 두 번째에 목록', async () => {
    const { server } = setupReturns();
    await openReturn('O-1001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('1'));
    press('Escape');
    expect(await screen.findByText('한 번 더 누르면 센 수량을 버려요')).toBeInTheDocument();
    expect(region()).toBeInTheDocument();
    press('Escape');
    expect(await listed()).toEqual(['O-1003', 'O-1002', 'O-1001']);
    expect(server.arrivalCalls).toHaveLength(0);
  });
});

describe('목록에서 찍어 연 첫 스캔', () => {
  it('스캐너로 찍어 열면 그 한 개가 이번 소포에 든다 — 그 줄 선택·성공음', async () => {
    const { beeps } = setupReturns({ returns: [BULK] });
    await openByScan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('1'));
    expect(parcelOf('cri-6a')).toBe('0');
    expect(itemRow('cri-6b')).toHaveAttribute('aria-selected', 'true');
    expect(bigCount()).toHaveTextContent('이번 소포1');
    expect(beeps.at(-1)?.frequency).toBe(SUCCESS_HZ);
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('2'));
  });

  it('검색칸에 친 바코드로 열면 세지 않는다', async () => {
    setupReturns({ returns: [BULK] });
    await listed();
    await typeHuman(['8']);
    const input = await screen.findByRole('searchbox', { name: '반품 검색' });
    fireEvent.change(input, { target: { value: '8806002' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await screen.findByRole('region', { name: '소포 세기' });
    expect(parcelOf('cri-6b')).toBe('0');
    expect(bigCount()).toHaveTextContent('이번 소포0');
  });
});

describe('다 오는 소포 — 모두 양품이면 F10 두 번', () => {
  it('첫 F10 은 확인만, 두 번째에 도착과 검수(모두 양품)를 이어 보내고 목록에 결과 한 줄', async () => {
    const { server, beeps } = setupReturns({ returns: [AWAITING] });
    await openByScan('8801001');
    scan('8801001');
    await waitFor(() => expect(parcelOf('cri-1')).toBe('2'));
    await waitFor(() => expect(allGoodKey()).toBeInTheDocument());
    expect(inspectKey()).toBeInTheDocument();
    press('F10');
    expect(await screen.findByText('모두 양품이면 F10 한 번 더')).toBeInTheDocument();
    expect(screen.getByText('환불을 요청해요 · 불량·보류가 있으면 F11 검수')).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(0);
    press('F10');
    expect(await screen.findByText('O-1001 검수까지 끝냈어요 — 환불을 요청했어요')).toBeInTheDocument();
    expect(server.arrivals).toEqual([
      { returnId: 'cr-1', key: expect.any(String), itemId: 'cri-1', quantity: 2 },
    ]);
    expect(server.inspections).toEqual([
      { returnId: 'cr-1', body: { items: [{ customerReturnItemId: 'cri-1', accepted: 2, rejected: 0, held: 0 }] } },
    ]);
    expect(beeps.at(-1)?.frequency).toBe(COMPLETE_HZ);
  });

  it('교환이면 «교환품 출고를 지시해요»', async () => {
    const { server } = setupReturns({ returns: [{ ...AWAITING, kind: 'exchange' }] });
    await openByScan('8801001');
    scan('8801001');
    await waitFor(() => expect(allGoodKey()).toBeInTheDocument());
    press('F10');
    expect(await screen.findByText('교환품 출고를 지시해요 · 불량·보류가 있으면 F11 검수')).toBeInTheDocument();
    expect(screen.queryByText(/환불/)).toBeNull();
    press('F10');
    expect(await screen.findByText('O-1001 검수까지 끝냈어요 — 교환품 출고를 지시했어요')).toBeInTheDocument();
    expect(server.inspections).toHaveLength(1);
  });

  it('F11 은 도착만 보내고 검수 화면으로 — 검수는 보내지 않는다', async () => {
    const { server } = setupReturns({ returns: [AWAITING] });
    await openByScan('8801001');
    scan('8801001');
    await waitFor(() => expect(inspectKey()).toBeInTheDocument());
    press('F11');
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(server.arrivalCalls).toHaveLength(1);
    expect(server.inspectionCalls).toHaveLength(0);
  });

  it('덜 오는 소포엔 F11 이 없고 F10 은 도착 확정', async () => {
    setupReturns({ returns: [AWAITING] });
    await openByScan('8801001');
    await waitFor(() => expect(arrivalKey()).toBeInTheDocument());
    expect(inspectKey()).toBeNull();
    expect(allGoodKey()).toBeNull();
  });

  it('도착 응답을 잃은 뒤 F10 다시 보내기도 검수(모두 양품)까지 잇는다 — 도착은 한 번만', async () => {
    const { server } = setupReturns({ returns: [AWAITING] });
    await openByScan('8801001');
    scan('8801001');
    await waitFor(() => expect(allGoodKey()).toBeInTheDocument());
    server.failNext({ method: 'POST', write: 'arrivals', applied: true });
    press('F10');
    await screen.findByText('모두 양품이면 F10 한 번 더');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('결과를 확인하지 못했어요 — F10 다시 보내기');
    expect(server.inspectionCalls).toHaveLength(0);
    press('F10');
    expect(await screen.findByText('O-1001 검수까지 끝냈어요 — 환불을 요청했어요')).toBeInTheDocument();
    expect(server.arrivals).toHaveLength(1);
    expect(server.inspections).toHaveLength(1);
  });

  it('검수만 결과를 모르면 상세를 다시 읽어 검수 화면에 사유 — 도착은 한 번만', async () => {
    const { server } = setupReturns({ returns: [AWAITING] });
    await openByScan('8801001');
    scan('8801001');
    await waitFor(() => expect(allGoodKey()).toBeInTheDocument());
    server.failNext({ method: 'POST', write: 'inspection', status: 503 });
    press('F10');
    await screen.findByText('모두 양품이면 F10 한 번 더');
    press('F10');
    expect(await screen.findByRole('region', { name: '검수' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('검수 결과를 확인하지 못했어요 — 다시 열어 확인하세요');
    expect(server.arrivals).toHaveLength(1);
    expect(server.inspections).toHaveLength(0);
  });

  it('확인 대기 중 Esc 는 대기만 풀고, 스캔도 대기를 푼다', async () => {
    const { server } = setupReturns({ returns: [BULK] });
    await openReturn('O-1006');
    await typeHuman(['1', '2', 'ArrowDown', '4']);
    scan('8806002');
    await waitFor(() => expect(parcelOf('cri-6b')).toBe('5'));
    press('F10');
    expect(await screen.findByText('모두 양품이면 F10 한 번 더')).toBeInTheDocument();
    press('Escape');
    await waitFor(() => expect(screen.queryByText('모두 양품이면 F10 한 번 더')).toBeNull());
    expect(region()).toBeInTheDocument();
    press('F10');
    expect(await screen.findByText('모두 양품이면 F10 한 번 더')).toBeInTheDocument();
    scan('8801001');
    await waitFor(() => expect(screen.queryByText('모두 양품이면 F10 한 번 더')).toBeNull());
    expect(server.arrivalCalls).toHaveLength(0);
  });
});
