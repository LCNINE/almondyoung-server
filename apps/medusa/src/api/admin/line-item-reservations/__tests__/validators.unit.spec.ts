import { AdminListLineItemReservations, AdminSetLineItemReservations } from '../validators';

const item = (line_item_id: string, quantity = 1) => ({ line_item_id, quantity, allow_decrease: true });

describe('AdminSetLineItemReservations', () => {
  it('정상 묶음을 받는다', () => {
    expect(AdminSetLineItemReservations.safeParse({ items: [item('li_1', 0), item('li_2', 3)] }).success).toBe(true);
  });

  it('같은 줄이 두 번 오면 거절한다 — 어느 값이 이길지 순서에 달린다', () => {
    expect(AdminSetLineItemReservations.safeParse({ items: [item('li_1', 1), item('li_1', 2)] }).success).toBe(false);
  });

  it('200줄을 넘으면 거절한다', () => {
    const items = Array.from({ length: 201 }, (_, i) => item(`li_${i}`));
    expect(AdminSetLineItemReservations.safeParse({ items }).success).toBe(false);
  });

  it('음수·소수 수량과 allow_decrease 누락을 거절한다', () => {
    expect(AdminSetLineItemReservations.safeParse({ items: [item('li_1', -1)] }).success).toBe(false);
    expect(AdminSetLineItemReservations.safeParse({ items: [item('li_1', 1.5)] }).success).toBe(false);
    expect(AdminSetLineItemReservations.safeParse({ items: [{ line_item_id: 'li_1', quantity: 1 }] }).success).toBe(
      false,
    );
  });
});

describe('AdminListLineItemReservations', () => {
  it('limit 이 없으면 500, 문자열 limit 은 숫자로 읽는다', () => {
    expect(AdminListLineItemReservations.parse({ order_created_from: '2026-11-09T00:00:00Z' }).limit).toBe(500);
    expect(
      AdminListLineItemReservations.parse({ order_created_from: '2026-11-09T00:00:00+09:00', limit: '20' }).limit,
    ).toBe(20);
  });

  it('500 을 넘는 limit 과 ISO 가 아닌 시각을 거절한다', () => {
    expect(
      AdminListLineItemReservations.safeParse({ order_created_from: '2026-11-09T00:00:00Z', limit: '501' }).success,
    ).toBe(false);
    expect(AdminListLineItemReservations.safeParse({ order_created_from: 'yesterday' }).success).toBe(false);
  });
});
