import { and, gt, ne, notInArray, sql } from 'drizzle-orm';
import { fulfillmentOrderItems, fulfillmentOrders } from '../../schema/inventory.schema';

export const remainingUnshippedQuantity =
  sql<number>`greatest(${fulfillmentOrderItems.qty} - ${fulfillmentOrderItems.shippedQty} - ${fulfillmentOrderItems.canceledQty}, 0)`.mapWith(
    Number,
  );

// 그룹 집계와 미발송 상세는 recovery_required를 포함한 같은 열린 수요를 읽는다.
export const unshippedDemandPredicate = and(
  notInArray(fulfillmentOrders.status, ['shipped', 'completed', 'canceled']),
  ne(fulfillmentOrderItems.status, 'canceled'),
  gt(remainingUnshippedQuantity, 0),
);
