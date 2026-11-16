/**
 * 저녁 맞추기 정본 산식 회귀 테스트 (DB 불필요).
 * 설계 문서 «계산» 의 시나리오를 한 줄씩 고정한다.
 */
import { freshState, initState, planApply, sellmateAvail } from './reconcile-math';

describe('sellmateAvail', () => {
  it('셀메이트 가용 = 현재 − 미발송, 음수도 그대로 돌린다', () => {
    expect(sellmateAvail(10, 4)).toBe(6);
    expect(sellmateAvail(2, 5)).toBe(-3);
  });
});

describe('저녁 맞추기 산식 (planApply)', () => {
  it('init 음수 품목은 기준값을 음수 그대로, 같은 양을 이월로 둔다', () => {
    expect(initState(-3)).toEqual({ baseline: -3, carry: 3 });
    expect(initState(6)).toEqual({ baseline: 6, carry: 0 });
  });
  it('init 음수 품목은 변화가 없으면 다음 회에 이월이 두 배가 되지 않는다', () => {
    expect(planApply({ s: -3, baseline: -3, carry: 3, onHand: 0, reservedAll: 0, reservedHandedOver: 0, unshipped: 5 }))
      .toEqual({ delta: 0, carryAfter: 3, uploadAvail: 0, uploadCurrent: 5 });
  });
  it('드레인 중 넘긴 주문 출고는 차이 0이고 넘긴 주문 예약은 가용에서 빼지 않는다', () => {
    expect(planApply({ s: 6, baseline: 6, carry: 0, onHand: 6, reservedAll: 3, reservedHandedOver: 3, unshipped: 1 }))
      .toEqual({ delta: 0, carryAfter: 0, uploadAvail: 6, uploadCurrent: 7 });
  });
  it('마켓 주문 2개는 core 에서 2 빠진다', () => {
    expect(planApply({ s: 4, baseline: 6, carry: 0, onHand: 6, reservedAll: 0, reservedHandedOver: 0, unshipped: 6 }))
      .toEqual({ delta: -2, carryAfter: 0, uploadAvail: 4, uploadCurrent: 10 });
  });
  it('마켓 취소·반품 1개는 core 에 1 더한다', () => {
    expect(planApply({ s: 5, baseline: 4, carry: 0, onHand: 4, reservedAll: 0, reservedHandedOver: 0, unshipped: 0 }).delta).toBe(1);
  });
  it('입고로 여유가 생기면 이월부터 갚고 남는 것만 올린다', () => {
    expect(planApply({ s: 0, baseline: 0, carry: 3, onHand: 5, reservedAll: 0, reservedHandedOver: 0, unshipped: 0 }))
      .toEqual({ delta: -3, carryAfter: 0, uploadAvail: 2, uploadCurrent: 2 });
  });
  it('자사몰 확정 예약은 깎지 않는다 — 여유가 없으면 이월로 간다', () => {
    // onHand 5 = 넘긴 주문 예약 2 + T 뒤 자사몰 예약 3 → A=2, R=0
    expect(planApply({ s: 2, baseline: 4, carry: 0, onHand: 5, reservedAll: 5, reservedHandedOver: 2, unshipped: 0 }))
      .toEqual({ delta: 0, carryAfter: 2, uploadAvail: 0, uploadCurrent: 0 });
  });
  it('정수가 아닌 입력은 throw 한다', () => {
    expect(() => planApply({ s: 1.5, baseline: 0, carry: 0, onHand: 0, reservedAll: 0, reservedHandedOver: 0, unshipped: 0 })).toThrow();
    expect(() => sellmateAvail(NaN, 0)).toThrow();
    expect(() => initState(Infinity)).toThrow();
  });
});


describe('새로 짝지어진 품목 (freshState → planApply)', () => {
  it('시작 상태는 기준값 S, 이월 = 미발송주문수', () => {
    expect(freshState(-1, 3)).toEqual({ baseline: -1, carry: 3 });
    expect(freshState(7, 0)).toEqual({ baseline: 7, carry: 0 });
    expect(() => freshState(1, -1)).toThrow();
  });
  it('같은 회의 planApply 가 미발송만큼 여유 안에서 빼고, 남은 것은 이월로 둔다', () => {
    const start = freshState(-1, 3); // 현재 2, 미발송 3
    expect(planApply({ s: -1, ...start, onHand: 5, reservedAll: 0, reservedHandedOver: 0, unshipped: 3 })).toEqual({
      delta: -3,
      carryAfter: 0,
      uploadAvail: 2,
      uploadCurrent: 5,
    });
    expect(planApply({ s: -1, ...start, onHand: 2, reservedAll: 0, reservedHandedOver: 0, unshipped: 3 })).toEqual({
      delta: -2,
      carryAfter: 1,
      uploadAvail: 0,
      uploadCurrent: 3,
    });
  });
});
