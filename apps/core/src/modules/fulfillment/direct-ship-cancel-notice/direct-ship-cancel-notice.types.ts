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
