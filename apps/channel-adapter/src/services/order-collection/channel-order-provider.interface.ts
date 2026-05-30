import { OrderCreatedPayload, OrderItem, ShippingAddress } from '@packages/event-contracts/streams';

export const CHANNEL_ORDER_PROVIDER = Symbol('CHANNEL_ORDER_PROVIDER');
export const CHANNEL_PRODUCT_IDENTIFICATION_FAILED = 'channel_product_identification_failed' as const;
export const COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED = 'collected_order_modification_not_accepted' as const;

export type OrderCollectionFailureReason =
  | typeof CHANNEL_PRODUCT_IDENTIFICATION_FAILED
  | typeof COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED;

export interface OrderCollectionFailureItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  reason: OrderCollectionFailureReason;
  affectedLineIds: string[];
  rawOrder: Record<string, unknown>;
}

export interface OrderFetchItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  createPayload: OrderCreatedPayload;
  changes: {
    items: OrderItem[];
    shippingAddress: ShippingAddress;
    totalAmount: number;
  };
  modifiedAt: string;
}

export interface FetchOrdersResult {
  orders: OrderFetchItem[];
  failures: OrderCollectionFailureItem[];
}

export type OrderFetchOutcome =
  | { kind: 'order'; order: OrderFetchItem }
  | { kind: 'failure'; failure: OrderCollectionFailureItem };

export interface ReplayableChannelOrderProvider extends ChannelOrderProvider {
  fetchOrder(externalOrderId: string): Promise<OrderFetchOutcome | null>;
}

export interface ChannelOrderProvider {
  readonly channel: string;
  fetchOrders(since: Date | null): Promise<FetchOrdersResult>;
}
