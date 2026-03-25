// src/lib/api/domains/orders/index.ts
// Orders 도메인 통합 클라이언트

import { salesOrders } from './sales-orders.client';
import { fulfillmentOrder } from './fulfillment-order.client';
import { matchingClient } from '../inventory/matching.client';

export const orders = {
  // Sales Orders Management
  salesOrders,

  // Fulfillment Orders Management
  fulfillmentOrder,

  // Matching Management (moved from inventory to orders for compatibility)
  matching: matchingClient,
};

// 기존 호환성을 위한 별도 export
export { salesOrders } from './sales-orders.client';
export { fulfillmentOrder } from './fulfillment-order.client';
