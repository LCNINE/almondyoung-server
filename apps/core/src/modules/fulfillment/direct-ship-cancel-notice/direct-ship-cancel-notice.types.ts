export type DirectShipCancelNotice = {
  id: string;
  companyName: string;
  salesOrderId: string;
  channelOrderId: string | null;
  salesOrderLineId: string | null;
  orderCancellationId: string | null;
  fulfillmentOrderId: string;
  skuName: string;
  supplierSku: string | null;
  canceledQty: number;
  cancellationScope: 'full' | 'partial';
  /** sales_order_cancellations.occurred_at */
  cancelledAt: Date;
  createdAt: Date;
  notifiedAt: Date | null;
  notifiedBy: string | null;
};

/**
 * 상자 후 취소가 가리키는 판매주문 취소(K3 PR6). 취소 id 는 판매주문이 쓰기 전에 정해 넘긴다 —
 * 알릴 취소 행이 취소 기록보다 먼저 들어간다(같은 tx, ADR-0049 PR5).
 */
export type SalesOrderCancellationOrigin = { orderCancellationId: string; scope: 'full' | 'partial' };
