import { sql } from 'drizzle-orm';
import type { DbService } from '@app/db';
import type { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { parcelClaimEligibilitySql } from './parcel-claim-eligibility.sql';

/** 배송완료 소포(출고 시도 × 상자 라인) 하나의 청구 자격 — 칸의 뜻은 `parcelClaimEligibilitySql` 이 정한다. */
export type ParcelClaimEligibility = {
  salesOrderLineId: string;
  skuId: string;
  shipmentId: string;
  shipmentLineId: string;
  dispatchAttemptId: string;
  deliveredAt: Date;
  deliveredQty: number;
  claimedQty: number;
  skuClaimable: number;
  /** 이 소포에서 더 반품·교환할 수 있는 SKU 수량. 음수일 수 있다 — 표시는 소비자가 클램프한다. */
  claimable: number;
};

type ParcelRow = {
  sales_order_line_id: string;
  sku_id: string;
  shipment_id: string;
  shipment_line_id: string;
  dispatch_attempt_id: string;
  /** raw execute 는 드라이버 설정에 따라 timestamptz 를 문자열로 줄 수 있다 — Date 로 옮긴다. */
  delivered_at: string | Date;
  delivered_qty: number;
  claimed_qty: number;
  sku_claimable: number;
  claimable: number;
};

/**
 * 판매주문 하나의 배송완료 소포별 청구 자격 (K6 PR3a). 배송완료 시각, 출고 시도, 상자 라인 순.
 * 트랜잭션 밖 고객 actions 도 부르므로 첫 인자는 트랜잭션이나 DB 다(`readOrderFulfillmentPhases` 와 같다).
 * 칸은 SQL 이 낸 그대로 옮긴다 — 여기서 산술하지 않는다.
 */
export async function readParcelClaimEligibility(
  db: DbTx | DbService<typeof wmsSchema>['db'],
  salesOrderId: string,
): Promise<ParcelClaimEligibility[]> {
  const rows = await db.execute<ParcelRow>(sql`
    select parcel.*
      from (${parcelClaimEligibilitySql(sql`select ${salesOrderId}::uuid`)}) as parcel
     order by parcel.delivered_at, parcel.dispatch_attempt_id, parcel.shipment_line_id
  `);
  return rows.map((row) => ({
    salesOrderLineId: row.sales_order_line_id,
    skuId: row.sku_id,
    shipmentId: row.shipment_id,
    shipmentLineId: row.shipment_line_id,
    dispatchAttemptId: row.dispatch_attempt_id,
    deliveredAt: new Date(row.delivered_at),
    deliveredQty: row.delivered_qty,
    claimedQty: row.claimed_qty,
    skuClaimable: row.sku_claimable,
    claimable: row.claimable,
  }));
}
