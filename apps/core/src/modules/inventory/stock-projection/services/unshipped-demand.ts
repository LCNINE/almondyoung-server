import { and, gt, ne, notInArray, sql } from 'drizzle-orm';
import { fulfillmentOrderItems, fulfillmentOrders, skus } from '../../schema/inventory.schema';

export const remainingUnshippedQuantity =
  sql<number>`greatest(${fulfillmentOrderItems.qty} - ${fulfillmentOrderItems.shippedQty} - ${fulfillmentOrderItems.canceledQty}, 0)`.mapWith(
    Number,
  );

// 그룹 집계와 미발송 상세는 recovery_required를 포함한 같은 열린 수요를 읽는다.
export const unshippedDemandPredicate = and(
  notInArray(fulfillmentOrders.status, ['shipped', 'completed', 'canceled']),
  ne(fulfillmentOrderItems.status, 'canceled'),
  gt(remainingUnshippedQuantity, 0),
  // 직배(입점사가 직접 보내는) SKU 는 창고에서 보낼 일이 없다 — 섞인 주문이면 FO 창고를 물려받아 창고 수요로 잘못 잡힌다.
  sql`not exists (select 1 from ${skus} where ${skus.id} = ${fulfillmentOrderItems.skuId} and ${skus.stockType} = 'drop_shipped')`,
);
