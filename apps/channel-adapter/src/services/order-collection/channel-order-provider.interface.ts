import { OrderCreatedPayload, OrderItem, ShippingAddress } from '@packages/event-contracts/streams';

export const CHANNEL_ORDER_PROVIDER = Symbol('CHANNEL_ORDER_PROVIDER');

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
  skipped: number;
}

export interface ChannelOrderProvider {
  readonly channel: string;
  fetchOrders(since: Date | null): Promise<FetchOrdersResult>;
}
