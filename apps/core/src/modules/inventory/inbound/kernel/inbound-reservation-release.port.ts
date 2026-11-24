import { DbTx } from '../../schema/inventory.schema';

/** 창고에서 빠지는 수량 — 들어온 적이 없거나(입고 취소) 돌려보내는(회송) 물건 */
export interface StockRemoval {
  skuId: string;
  warehouseId: string;
  quantity: number;
}

export interface ReservationHolder {
  orderNo: string | null;
  quantity: number;
}

export interface ReservationReleasePreview {
  /** 예약을 놓고 다시 재고를 기다리게 되는 주문과 수량 */
  orderCount: number;
  quantity: number;
  /** 놓을 수 있는 예약을 다 놓아도 모자라는 수량. 0 보다 크면 지금은 뺄 수 없다 */
  missingQty: number;
  /** 뺄 수 없을 때, 이미 출고 준비에 들어가 예약을 놓지 못하는 주문 */
  heldBy: ReservationHolder[];
}

/**
 * 재고가 빠질 때 남는 재고보다 많이 잡힌 예약을 놓는다.
 *
 * 입고한 물건에는 곧바로 예약이 걸린다(예약 재시도 워커). 예약을 먼저 풀고 취소하라고 하면 그사이 워커가
 * 다시 잡으므로, 빼는 트랜잭션이 예약까지 함께 정리한다. 예약의 주인은 출고라 구현은 출고 쪽에 있다.
 */
export abstract class InboundReservationRelease {
  abstract preview(removal: StockRemoval, tx: DbTx): Promise<ReservationReleasePreview>;

  /** 놓을 수 있는 예약으로 모자라면 409. 놓을 것이 없으면 아무것도 잠그지 않는다. */
  abstract release(removals: readonly StockRemoval[], reason: string, tx: DbTx): Promise<void>;
}
