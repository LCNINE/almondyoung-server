export type DirectShipCancelNotice = {
  id: string;
  supplierId: string;
  /** 입점사 이름 — 옛 화면이 묶음 머리글로 쓴다. 찾기·거르기는 `supplierId` 로만 한다(K3 PR6 N6) */
  companyName: string;
  salesOrderId: string;
  /** 입점사가 받은 시트의 «주문번호»와 같은 값(`orderNoSql`) */
  orderNo: string;
  channelOrderId: string | null;
  salesOrderLineId: string | null;
  orderCancellationId: string | null;
  fulfillmentOrderId: string;
  /** 입점사가 받은 시트의 «행 키» */
  fulfillmentOrderItemId: string;
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
