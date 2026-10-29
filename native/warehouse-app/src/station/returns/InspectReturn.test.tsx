import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flash, press, scan, typeHuman } from '../outbound/__fixtures__/renderStation';
import { READY, listed, orderNos, setupReturns } from './__fixtures__/renderReturns';
import type { FakeReturn, InspectionBody, ReturnsServer } from './__fixtures__/returnsServer';

const COMPLETE_HZ = 1568;
const REFUND_PROMPT = '한 번 더 누르면 환불을 요청해요';
const CS_PROMPT = '한 번 더 누르면 CS 확인으로 넘겨요';
const UNCERTAIN = '결과를 확인하지 못했어요 — F10 다시 보내기';
const DISCARD_PROMPT = '한 번 더 누르면 입력을 버려요';
const NOT_IN_RETURN = '이 반품에 없는 상품이에요';

type Col = 'arrived' | 'accepted' | 'rejected' | 'held';

const bar = () => within(screen.getByRole('toolbar', { name: '기능키' }));
const region = () => screen.getByRole('region', { name: '검수' });
const confirmKey = () => bar().queryByRole('button', { name: /F10\s*검수 확정/ });
function itemRow(itemId: string): HTMLElement {
  const found = region().querySelector<HTMLElement>(`tr[data-item-id="${itemId}"]`);
  if (!found) throw new Error(`row ${itemId} not found`);
  return found;
}
const cellEl = (itemId: string, col: Col) => itemRow(itemId).querySelector<HTMLElement>(`[data-col="${col}"]`);
const cell = (itemId: string, col: Col) => cellEl(itemId, col)?.textContent ?? '';
/** 숫자가 들어갈 칸 — 선택 줄의 불량 또는 보류 */
const activeCell = () => region().querySelector<HTMLElement>('[data-active="true"]');
/** 서버에 닿은 검수 요청 본문 — 응답 전에 끊긴 것(failNext)도 센다 */
const inspectionPosts = (server: ReturnsServer) =>
  server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/inspection')).map((r) => r.body as InspectionBody);

/** 두 줄이 다 왔다 */
const TWO: FakeReturn = {
  id: 'cr-5',
  orderNo: 'O-1005',
  customerName: '한도윤',
  status: 'arrived',
  requestedAt: '2026-10-25T01:00:00.000Z',
  lines: [
    { id: 'crl-5a', productName: '헤어밴드', items: [{ id: 'cri-5a', skuName: '헤어밴드', expectedQty: 3, arrivedQty: 3, barcodes: ['8805001'] }] },
    { id: 'crl-5b', productName: '빗', items: [{ id: 'cri-5b', skuName: '빗', expectedQty: 2, arrivedQty: 2, barcodes: ['8805002'] }] },
  ],
};

/** CS 가 미도착으로 닫았다 — 한 줄은 일부만, 한 줄은 하나도 안 왔다 */
const MISSING_CLOSED: FakeReturn = {
  id: 'cr-4',
  orderNo: 'O-1004',
  customerName: '오세린',
  status: 'arrived',
  missingClosed: true,
  requestedAt: '2026-10-25T02:00:00.000Z',
  lines: [
    { id: 'crl-4a', productName: '컬러크림 8N', items: [{ id: 'cri-4a', skuName: '컬러크림 8N', expectedQty: 2, arrivedQty: 1, barcodes: ['8804001'] }] },
    { id: 'crl-4b', productName: '샴푸 퍼퓸', items: [{ id: 'cri-4b', skuName: '샴푸 퍼퓸', expectedQty: 1, barcodes: ['8804002'] }] },
  ],
};

/** 목록에서 상품을 찍어 그 반품의 검수를 연다 — 기능키가 등록될 때까지 기다린다 */
async function openByScan(barcode: string) {
  await listed();
  scan(barcode);
  await screen.findByRole('region', { name: '검수' });
  await waitFor(() => expect(confirmKey()).toBeInTheDocument());
}

describe('반품 사유와 메모', () => {
  it('판매자 부담 밴드와 고객 메모를 보여 준다', async () => {
    setupReturns({ returns: [READY] });
    await openByScan('8801004');

    expect(within(region()).getByText('상품 하자 · 판매자 부담')).toHaveClass(
      'bg-[#FFF1C7]',
      'text-[#5E3B00]'
    );
    expect(
      within(region()).getByText(`메모: ${READY.note}`)
    ).toBeInTheDocument();
  });

  it.each([null, ''])(
    '고객 부담이고 메모가 %p이면 메모 줄이 없다',
    async (note) => {
      setupReturns({
        returns: [
          { ...READY, reason: 'change_of_mind', feeBearer: 'customer', note },
        ],
      });
      await openByScan('8801004');

      expect(within(region()).getByText('단순 변심 · 고객 부담')).toHaveClass(
        'bg-[#EDEEF0]',
        'text-[#3F4450]'
      );
      expect(within(region()).queryByText(/^메모:/)).toBeNull();
    }
  );
});

describe('검수 — 화면', () => {
  it('표 `상품 | 도착 | 양품 | 불량 | 보류` — 기본은 전부 양품(불량·보류 0), 양품은 입력칸이 아니다', async () => {
    setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    expect(screen.getByRole('heading', { name: 'O-1005' })).toBeInTheDocument();
    const headers = within(region()).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['상품', '도착', '양품', '불량', '보류']);
    expect(cell('cri-5a', 'arrived')).toBe('3');
    expect(cell('cri-5a', 'accepted')).toBe('3');
    expect(cell('cri-5a', 'rejected')).toBe('0');
    expect(cell('cri-5a', 'held')).toBe('0');
    expect(cell('cri-5b', 'accepted')).toBe('2');
    // 숫자가 들어갈 칸은 첫 줄의 불량 — 양품 칸은 어느 때도 입력 칸이 되지 않는다
    expect(itemRow('cri-5a')).toHaveAttribute('aria-selected', 'true');
    expect(activeCell()).toBe(cellEl('cri-5a', 'rejected'));
    expect(within(region()).queryByRole('textbox')).toBeNull();
    expect(bar().getByRole('button', { name: /Esc\s*목록/ })).toBeInTheDocument();
  });
});

describe('검수 — 입력', () => {
  it('↑↓ 줄, ←→ 불량↔보류, 숫자 덮어쓰기·이어 치기 — 불량 + 보류 > 도착이면 오류음·그대로, 양품이 따라 바뀐다', async () => {
    setupReturns({ returns: [TWO] });
    await openByScan('8805001');

    await typeHuman(['1']);
    expect(cell('cri-5a', 'rejected')).toBe('1');
    expect(cell('cri-5a', 'accepted')).toBe('2');
    // 이어 치면 12 — 도착 3 을 넘는다
    await typeHuman(['2']);
    expect(flash()).toBe('error');
    expect(cell('cri-5a', 'rejected')).toBe('1');

    await typeHuman(['ArrowRight']);
    expect(activeCell()).toBe(cellEl('cri-5a', 'held'));
    // 불량 1 + 보류 3 > 도착 3
    await typeHuman(['3']);
    expect(flash()).toBe('error');
    expect(cell('cri-5a', 'held')).toBe('0');
    await typeHuman(['2']);
    expect(cell('cri-5a', 'held')).toBe('2');
    expect(cell('cri-5a', 'accepted')).toBe('0');
    // 오른쪽 끝에서 → 는 그대로
    await typeHuman(['ArrowRight']);
    expect(activeCell()).toBe(cellEl('cri-5a', 'held'));

    await typeHuman(['ArrowLeft', '0']);
    expect(activeCell()).toBe(cellEl('cri-5a', 'rejected'));
    expect(cell('cri-5a', 'rejected')).toBe('0');
    expect(cell('cri-5a', 'accepted')).toBe('1');

    await typeHuman(['ArrowDown', '2']);
    expect(itemRow('cri-5b')).toHaveAttribute('aria-selected', 'true');
    expect(activeCell()).toBe(cellEl('cri-5b', 'rejected'));
    expect(cell('cri-5b', 'rejected')).toBe('2');
    expect(cell('cri-5b', 'accepted')).toBe('0');
    await typeHuman(['Backspace']);
    expect(cell('cri-5b', 'rejected')).toBe('0');
    expect(cell('cri-5b', 'accepted')).toBe('2');

    await typeHuman(['ArrowUp', 'ArrowRight', 'Backspace']);
    expect(cell('cri-5a', 'held')).toBe('0');
    expect(cell('cri-5a', 'accepted')).toBe('3');
  });
});

describe('검수 — 상품 스캔', () => {
  it('찍은 상품의 줄을 고른다 — 그다음 숫자는 그 줄을 덮어쓴다. 없는 상품은 «이 반품에 없는 상품이에요»·오류음·선택 그대로', async () => {
    setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    scan('8805002');
    await waitFor(() => expect(itemRow('cri-5b')).toHaveAttribute('aria-selected', 'true'));
    expect(itemRow('cri-5a')).toHaveAttribute('aria-selected', 'false');
    await typeHuman(['1']);
    expect(cell('cri-5b', 'rejected')).toBe('1');
    expect(cell('cri-5a', 'rejected')).toBe('0');

    scan('8801004');
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_IN_RETURN);
    expect(flash()).toBe('error');
    expect(itemRow('cri-5b')).toHaveAttribute('aria-selected', 'true');
    expect(cell('cri-5b', 'rejected')).toBe('1');
    // 손대면 그 한 줄이 지워진다
    await typeHuman(['ArrowUp']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(itemRow('cri-5a')).toHaveAttribute('aria-selected', 'true');
  });

  it('스캔도 첫 누름을 푼다', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    scan('8805002');
    await waitFor(() => expect(screen.queryByText(REFUND_PROMPT)).toBeNull());
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    expect(inspectionPosts(server)).toHaveLength(0);
  });
});

describe('검수 — Esc', () => {
  it('입력한 게 있으면 «한 번 더 누르면 입력을 버려요» — 사이에 입력하면 풀리고, 두 번 연달아 눌러야 목록', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    await typeHuman(['1']);
    press('Escape');
    expect(await screen.findByText(DISCARD_PROMPT)).toBeInTheDocument();
    expect(region()).toBeInTheDocument();
    await typeHuman(['ArrowRight']);
    expect(screen.queryByText(DISCARD_PROMPT)).toBeNull();
    press('Escape');
    expect(await screen.findByText(DISCARD_PROMPT)).toBeInTheDocument();
    press('Escape');
    expect(await listed()).toEqual(['O-1005']);
    expect(inspectionPosts(server)).toHaveLength(0);
  });

  it('Esc 가 확정 대기를 풀면 알림 줄도 걷는다', async () => {
    setupReturns({ returns: [TWO, READY] });
    await openByScan('8805001');
    await typeHuman(['1']);
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    press('Escape');
    await waitFor(() => expect(screen.queryByText(REFUND_PROMPT)).toBeNull());
    expect(region()).toBeInTheDocument();
  });

  it('결과를 모른 채 서버가 정산까지 넘겼어도 같은 결과 재전송은 성공 — 목록으로, 409 없음', async () => {
    const { server } = setupReturns({ returns: [TWO, READY] });
    await openByScan('8805001');
    await typeHuman(['1']);
    server.failNext({ method: 'POST', applied: true });
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent(UNCERTAIN);
    server.setStatus(TWO.id, 'settled');
    press('F10');
    await waitFor(() => expect(orderNos()).toEqual(['O-1003']));
    expect(screen.queryByRole('region', { name: '검수' })).toBeNull();
  });

  it('결과를 모르면 입력이 없어도 두 번 — 첫 Esc 는 «한 번 더 누르면 입력을 버려요»', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    server.failNext({ method: 'POST' });
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent(UNCERTAIN);
    press('Escape');
    expect(await screen.findByText(DISCARD_PROMPT)).toBeInTheDocument();
    expect(region()).toBeInTheDocument();
    press('Escape');
    expect(await listed()).toEqual(['O-1005']);
  });
});

describe('검수 확정 F10 — 두 번', () => {
  it('보류 0 — 첫 누름 «한 번 더 누르면 환불을 요청해요», 두 번째에 모든 항목을 보내고 완료음 + 목록', async () => {
    const { server, beeps } = setupReturns({ returns: [TWO, READY] });
    await openByScan('8805001');
    await typeHuman(['1']);
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    expect(inspectionPosts(server)).toHaveLength(0);
    press('F10');
    await waitFor(() => expect(orderNos()).toEqual(['O-1003']));
    expect(screen.queryByRole('region', { name: '검수' })).toBeNull();
    expect(flash()).toBe('complete');
    expect(beeps.at(-1)?.frequency).toBe(COMPLETE_HZ);
    expect(server.inspectionCalls).toHaveLength(1);
    expect(server.inspectionCalls[0].body).toEqual({
      items: [
        { customerReturnItemId: 'cri-5a', accepted: 2, rejected: 1, held: 0 },
        { customerReturnItemId: 'cri-5b', accepted: 2, rejected: 0, held: 0 },
      ],
    });
    expect(server.view(TWO.id).status).toBe('inspected');
  });

  it('보류가 있으면 «한 번 더 누르면 CS 확인으로 넘겨요»', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    await typeHuman(['ArrowDown', 'ArrowRight', '1']);
    press('F10');
    expect(await screen.findByText(CS_PROMPT)).toBeInTheDocument();
    expect(screen.queryByText(REFUND_PROMPT)).toBeNull();
    press('F10');
    await waitFor(() => expect(server.inspectionCalls).toHaveLength(1));
    expect(server.inspectionCalls[0].body.items[1]).toEqual({ customerReturnItemId: 'cri-5b', accepted: 1, rejected: 0, held: 1 });
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
    expect(server.view(TWO.id).status).toBe('held');
  });

  it('사이에 칸을 바꾸면(숫자·Backspace·↑↓·←→) 첫 누름이 풀린다 — 다시 첫 누름부터', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    for (const key of ['1', 'Backspace', 'ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp']) {
      press('F10');
      expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
      await typeHuman([key]);
      expect(screen.queryByText(REFUND_PROMPT)).toBeNull();
    }
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    expect(inspectionPosts(server)).toHaveLength(0);
    press('F10');
    await waitFor(() => expect(server.inspectionCalls).toHaveLength(1));
  });

  it('첫 누름 뒤 Esc 는 누름만 푼다(«Esc 취소») — 화면 그대로, 다음 Esc 가 목록', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    await waitFor(() => expect(bar().getByRole('button', { name: /Esc\s*취소/ })).toBeInTheDocument());
    press('Escape');
    await waitFor(() => expect(screen.queryByText(REFUND_PROMPT)).toBeNull());
    expect(region()).toBeInTheDocument();
    press('Escape');
    expect(await listed()).toEqual(['O-1005']);
    expect(inspectionPosts(server)).toHaveLength(0);
  });

  it('두 번째 F10 이 렌더 전에 두 번 와도 한 번만 보낸다', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    const release = server.holdWrites();
    act(() => {
      fireEvent.keyDown(window, { key: 'F10' });
      fireEvent.keyDown(window, { key: 'F10' });
    });
    await act(async () => {});
    release();
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
    expect(inspectionPosts(server)).toHaveLength(1);
  });

  it('보내는 중엔 입력이 오류음이고 칸 그대로', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    const release = server.holdWrites();
    press('F10');
    await waitFor(() => expect(inspectionPosts(server)).toHaveLength(1));
    await typeHuman(['1']);
    expect(flash()).toBe('error');
    expect(cell('cri-5a', 'rejected')).toBe('0');
    release();
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
  });
});

describe('결과를 모르는 검수', () => {
  it('네트워크 실패 — 칸 잠김(입력·칸 이동 오류음), F10 한 번이 같은 본문으로 다시 보낸다', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    await typeHuman(['1']);
    server.failNext({ method: 'POST' });
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent(UNCERTAIN);
    expect(flash()).toBe('error');
    expect(region()).toBeInTheDocument();

    await typeHuman(['2']);
    expect(flash()).toBe('error');
    expect(cell('cri-5a', 'rejected')).toBe('1');
    await typeHuman(['ArrowRight', '1']);
    expect(cell('cri-5a', 'held')).toBe('0');
    expect(activeCell()).toBe(cellEl('cri-5a', 'rejected'));
    // 스캔도 거절 — 선택 그대로
    scan('8805002');
    await waitFor(() => expect(flash()).toBe('error'));
    expect(itemRow('cri-5a')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(UNCERTAIN);

    await waitFor(() => expect(bar().getByRole('button', { name: /F10\s*다시 보내기/ })).toBeInTheDocument());
    press('F10');
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
    expect(flash()).toBe('complete');
    const posts = inspectionPosts(server);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(server.inspections).toHaveLength(1);
  });

  it('서버가 받았는데 응답을 잃음 — 다시 보내면 같은 결과가 그대로 돌아와 목록(한 번만 반영)', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    server.failNext({ method: 'POST', applied: true });
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent(UNCERTAIN);
    press('F10');
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
    expect(server.inspectionCalls).toHaveLength(2);
    expect(server.inspectionCalls[1].body).toEqual(server.inspectionCalls[0].body);
    expect(server.inspections).toHaveLength(1);
  });

  it('5xx 도 결과 모름이다', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    server.failNext({ method: 'POST', status: 503 });
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent(UNCERTAIN);
    press('F10');
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
    const posts = inspectionPosts(server);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });
});

describe('서버 거절 — 상세를 다시 읽는다(N10)', () => {
  it('그 사이 취소됐으면(409) «취소된 반품이에요» 뒤 목록', async () => {
    const { server } = setupReturns({ returns: [TWO, READY] });
    await openByScan('8805001');
    server.setStatus(TWO.id, 'cancelled');
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('취소된 반품이에요');
    await waitFor(() => expect(orderNos()).toEqual(['O-1003']));
    const after = server.requests.slice(server.requests.findIndex((r) => r.method === 'POST'));
    expect(after.some((r) => r.path === '/admin/customer-return-receiving/cr-5')).toBe(true);
  });

  it('다른 스테이션이 다른 결과로 먼저 검수했으면(409) «끝난 반품이에요» 뒤 목록', async () => {
    const { server } = setupReturns({ returns: [TWO, READY] });
    await openByScan('8805001');
    server.setStatus(TWO.id, 'held');
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toHaveTextContent('끝난 반품이에요');
    await waitFor(() => expect(orderNos()).toEqual(['O-1003']));
    expect(server.inspections).toHaveLength(0);
  });

  it('그 밖의 거절(400)은 새 상세로 검수를 다시 연다 — 오류 한 줄, 칸은 비고 옛 본문을 다시 보내지 않는다', async () => {
    const { server } = setupReturns({ returns: [TWO] });
    await openByScan('8805001');
    await typeHuman(['1']);
    server.failNext({ method: 'POST', status: 400, code: 'BAD_REQUEST' });
    press('F10');
    press('F10');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(flash()).toBe('error');
    await waitFor(() => expect(cell('cri-5a', 'rejected')).toBe('0'));
    expect(region()).toBeInTheDocument();
    await waitFor(() => expect(confirmKey()).toBeInTheDocument());
    // 다시 F10 은 처음부터 두 번 — 결과 모름처럼 곧장 보내지 않는다
    press('F10');
    expect(await screen.findByText(REFUND_PROMPT)).toBeInTheDocument();
    expect(inspectionPosts(server)).toHaveLength(1);
    // 작업자가 손대면 위 오류 한 줄이 지워진다
    await typeHuman(['1']);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('미도착으로 닫힌 반품', () => {
  it('도착 0 인 항목 줄은 그리지 않되 본문엔 0/0/0 으로 싣는다', async () => {
    const { server } = setupReturns({ returns: [MISSING_CLOSED] });
    await openByScan('8804001');
    expect(region().querySelector('tr[data-item-id="cri-4b"]')).toBeNull();
    expect(cell('cri-4a', 'arrived')).toBe('1');
    // 하나도 안 온 상품은 이 화면에 없는 상품이다
    scan('8804002');
    expect(await screen.findByRole('alert')).toHaveTextContent(NOT_IN_RETURN);
    expect(flash()).toBe('error');
    // ↓ 로 갈 줄이 없다
    await typeHuman(['ArrowDown', '1']);
    expect(cell('cri-4a', 'rejected')).toBe('1');
    expect(cell('cri-4a', 'accepted')).toBe('0');
    press('F10');
    press('F10');
    await waitFor(() => expect(server.inspectionCalls).toHaveLength(1));
    expect(server.inspectionCalls[0].body).toEqual({
      items: [
        { customerReturnItemId: 'cri-4a', accepted: 0, rejected: 1, held: 0 },
        { customerReturnItemId: 'cri-4b', accepted: 0, rejected: 0, held: 0 },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: '검수' })).toBeNull());
    expect(server.view(MISSING_CLOSED.id).status).toBe('inspected');
  });
});
