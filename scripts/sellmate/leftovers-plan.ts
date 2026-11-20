/**
 * 셀메이트 시기 자사몰 잔재(#1243) — 판매주문 하나를 어떻게 닫을지 정하는 순수 함수.
 * DB 를 읽지 않는다. 적용은 close-sellmate-leftovers.ts.
 *
 * 경계는 판매주문 상태다. core 코드는 판매주문을 shipped·delivered 로 올리지 않고(orderStatusEnum 주석),
 * 그 값을 쓰는 건 셀메이트 스크립트뿐이라 «셀메이트로 나갔다»의 증거가 된다. 그래서 시각으로 자르지 않는다
 * (설계 §4 — 시각으로 자르면 T 뒤 입금된 주문·늦게 들어온 주문이 틀린다).
 */

export type LeftoverOrder = {
  salesOrderId: string;
  channelOrderId: string;
  salesChannel: string;
  soStatus: string;
  /** 판매주문:FO 는 0..1 (uq_fulfillment_orders_sales_order). FO 가 없으면 null */
  foStatus: string | null;
  /** pending·failed·processing·awaiting_matching */
  openBacklogs: number;
  /** draft·planned·recovery_required */
  openShipments: number;
  /**
   * 앱이 이 주문에 출고를 붙였다 — 교환품을 보냈거나(customer_returns kind=exchange, exchange_released_at) 열린 입점사 상자가 있다.
   * 교환 FOI 는 셀메이트로 나간 옛 FO 에 붙으므로 FO 째 닫으면 교환품이 송장 없이 «발송됨»이 된다.
   */
  appWork: boolean;
};

export type LeftoverAction = {
  closeFo: boolean;
  closeShipments: boolean;
  closeBacklogs: boolean;
  report: null | 'human-fo' | 'app-work' | 'cancelled-open';
};

export const FO_CLOSABLE: readonly string[] = ['created', 'partially_reserved', 'ready'];
/** 작업이 걸렸을 수 있는 상태 — 스크립트가 덮지 않고 사람이 본다 */
export const FO_HUMAN: readonly string[] = ['processing', 'partially_shipped', 'recovery_required'];
const FO_TERMINAL: readonly string[] = ['shipped', 'completed', 'canceled'];
const EXTERNALLY_SHIPPED: readonly string[] = ['shipped', 'delivered'];

const NOTHING: LeftoverAction = { closeFo: false, closeShipments: false, closeBacklogs: false, report: null };

export function classifyLeftover(o: LeftoverOrder): LeftoverAction {
  if (o.salesChannel !== 'medusa') return NOTHING;

  if (EXTERNALLY_SHIPPED.includes(o.soStatus)) {
    if (o.appWork) return { ...NOTHING, report: 'app-work' };
    if (o.foStatus !== null && FO_HUMAN.includes(o.foStatus)) return { ...NOTHING, report: 'human-fo' };
    return {
      closeFo: o.foStatus !== null && FO_CLOSABLE.includes(o.foStatus),
      closeShipments: o.openShipments > 0,
      closeBacklogs: o.openBacklogs > 0,
      report: null,
    };
  }

  if (o.soStatus === 'cancelled') {
    // 취소 주문의 FO·상자는 리컨실러(30번) 몫이다. 대기열 닫기는 취소 경로가 부르는 바로 그 명령이라 여기서 한다.
    const foOpen = o.foStatus !== null && !FO_TERMINAL.includes(o.foStatus);
    return {
      ...NOTHING,
      closeBacklogs: o.openBacklogs > 0,
      report: foOpen || o.openShipments > 0 ? 'cancelled-open' : null,
    };
  }

  return NOTHING;
}
