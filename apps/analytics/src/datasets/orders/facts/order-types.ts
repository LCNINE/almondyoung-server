export type OrderAggregateSeed = {
  masterId: string;
  salesChannel: string;
  occurredDate: string;
  orderCount: number;
  quantitySold: number;
  revenue: number;
};

export type VariantAggregateSeed = {
  variantId: string;
  masterId: string;
  salesChannel: string;
  occurredDate: string;
  quantitySold: number;
  revenue: number;
};

export type ChannelAggregateSeed = {
  salesChannel: string;
  occurredDate: string;
  ordersCount: number;
  grossRevenue: number;
};

export type CustomerLifetimeSeed = {
  customerId: string;
  occurredAt: Date;
  revenue: number;
};
