import { DemandLine, waitingTotal } from './waiting-orders.calc';

const line = (over: Partial<DemandLine>): DemandLine => ({
  orderKey: 'order-a',
  qty: 1,
  reservedQty: 0,
  startedQty: 0,
  counted: true,
  ...over,
});
const stock = (pickableQty: number, unreservedQty = pickableQty) => ({ pickableQty, unreservedQty });

describe('waitingTotal', () => {
  it('집을 재고가 있으면 기다리는 주문이 없다', () => {
    expect(waitingTotal([line({ qty: 2, reservedQty: 2 })], stock(2, 0))).toEqual({ orders: 0, qty: 0 });
  });

  it('입고 뒤 예약이 잡혀도 선반에 없는 만큼은 계속 기다린다', () => {
    const first = line({ qty: 2, reservedQty: 2 });
    const before = waitingTotal([first, line({ orderKey: 'order-b', qty: 3 })], stock(2, 0));
    const received = waitingTotal([first, line({ orderKey: 'order-b', qty: 3 })], stock(2, 3));
    const reserved = waitingTotal([first, line({ orderKey: 'order-b', qty: 3, reservedQty: 3 })], stock(2, 0));
    expect(before).toEqual({ orders: 1, qty: 3 });
    expect(received).toEqual(before);
    expect(reserved).toEqual(before);
  });

  it('적치한 재고는 예약이 잡히기 전이라도 기다리는 몫을 줄인다', () => {
    expect(waitingTotal([line({ qty: 3 })], stock(3, 3))).toEqual({ orders: 0, qty: 0 });
  });

  it('예약이 잡힌 몫이 앞 순번의 예약 없는 몫보다 먼저 재고를 쓴다', () => {
    expect(
      waitingTotal(
        [line({ orderKey: 'old', qty: 2 }), line({ orderKey: 'reserved', qty: 2, reservedQty: 2 })],
        stock(2, 0),
      ),
    ).toEqual({ orders: 1, qty: 2 });
  });

  it('남은 재고는 순번대로 쓰고, 모자란 몫만 센다', () => {
    expect(
      waitingTotal(
        [line({ qty: 2 }), line({ orderKey: 'order-b', qty: 2 }), line({ orderKey: 'order-c', qty: 2 })],
        stock(3),
      ),
    ).toEqual({ orders: 2, qty: 3 });
  });

  it('다른 상자가 예약한 재고로는 예약 없는 몫이 나가지 못한다', () => {
    expect(waitingTotal([line({ qty: 2 })], stock(4, 1))).toEqual({ orders: 1, qty: 1 });
  });

  it('다른 상자의 예약은 이미 예약한 몫을 막지 않는다', () => {
    expect(waitingTotal([line({ qty: 5, reservedQty: 5 })], stock(5, 0))).toEqual({ orders: 0, qty: 0 });
  });

  it('시작한 배치가 잡아 둔 몫은 기다리는 것이 아니다', () => {
    expect(waitingTotal([line({ qty: 3, reservedQty: 3, startedQty: 3 })], stock(0))).toEqual({ orders: 0, qty: 0 });
    expect(waitingTotal([line({ qty: 3, reservedQty: 3, startedQty: 1 })], stock(1, 0))).toEqual({ orders: 1, qty: 1 });
  });

  it('우리가 내보내지 않는 상자는 세지 않고, 그 예약이 우리가 예약한 몫을 막지 않는다', () => {
    const handedOver = line({ orderKey: 'handed-over', qty: 3, reservedQty: 3, counted: false });
    expect(waitingTotal([handedOver, line({ qty: 5, reservedQty: 5 })], stock(5, 0))).toEqual({ orders: 0, qty: 0 });
  });

  it('우리가 내보내지 않는 상자의 예약 없는 몫은 순번대로 재고를 쓴다', () => {
    const handedOver = line({ orderKey: 'handed-over', qty: 2, counted: false });
    expect(waitingTotal([handedOver, line({ qty: 1 })], stock(2))).toEqual({ orders: 1, qty: 1 });
  });

  it('같은 주문의 여러 줄은 한 건이다', () => {
    expect(waitingTotal([line({ qty: 1 }), line({ qty: 2 })], stock(0))).toEqual({ orders: 1, qty: 3 });
  });

  it('재고가 음수로 계산돼도 수요보다 많이 세지 않는다', () => {
    expect(waitingTotal([line({ qty: 2 })], stock(-5, -5))).toEqual({ orders: 1, qty: 2 });
  });
});
