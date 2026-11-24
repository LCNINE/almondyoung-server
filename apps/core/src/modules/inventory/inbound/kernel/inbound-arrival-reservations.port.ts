import { DbTx } from '../../schema/inventory.schema';

/**
 * 입고가 커밋된 뒤, 들어온 상품을 기다리던 출고 줄의 예약을 바로 잡는다.
 *
 * 예약 재시도 크론(10초)을 기다리면 입고 응답이 돌아온 화면에 «미발송 주문»이 아직 비어 있다. 예약의 주인은
 * 출고라 구현은 출고 쪽에 있다(재고 모듈은 FulfillmentModule 을 물 수 없다 — `InboundReservationRelease` 와 같은 꼴).
 */
export abstract class InboundArrivalReservations {
  /** 방금 들어온 상품을 기다리던 draft 줄의 예약을 대기 순번대로 다시 잡는다. 재고가 바닥나면 멈춘다. */
  abstract retryForSkus(warehouseId: string, skuIds: readonly string[], tx?: DbTx): Promise<void>;
}

/** Nest 밖(스크립트·스펙)에서 입고 서비스를 세울 때 — 바로 잡지 않고 예약 재시도 크론에 맡긴다. */
export class DeferredArrivalReservations extends InboundArrivalReservations {
  async retryForSkus(): Promise<void> {}
}
