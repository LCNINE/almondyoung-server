// src/lib/api/domains/orders/index.ts
// Orders 도메인 통합 클라이언트

import { salesOrders } from './sales-orders.client';
import { fulfillmentOrder } from './fulfillment-order.client';
import { pickingClient } from './picking.client';
import { inspectionClient } from './inspection.client';
import { invoicesClient } from './invoices.client';
import { matchingClient } from '../matching/matching.client';

export const orders = {
  // Sales Orders Management
  salesOrders,

  // Fulfillment Orders Management
  fulfillmentOrder,

  // Picking Management
  picking: pickingClient,

  // Inspection Management
  inspection: inspectionClient,

  // Invoice Management
  invoices: invoicesClient,

  // Matching Management (domains/matching 으로 이전됨, 하위 호환성 유지)
  matching: matchingClient,
};

// 기존 호환성을 위한 별도 export
export { salesOrders } from './sales-orders.client';
export { fulfillmentOrder } from './fulfillment-order.client';
export { pickingClient } from './picking.client';
export { inspectionClient } from './inspection.client';
export { invoicesClient } from './invoices.client';
