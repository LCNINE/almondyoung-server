// src/lib/api/domains/orders/index.ts
// Orders 도메인 통합 클라이언트

import { salesOrders } from './sales-orders.client';
import { fulfillmentOrder } from './fulfillment-order.client';
import { fulfillmentsClient } from './fulfillments.client';
import { pickingClient } from './picking.client';
import { inspectionClient } from './inspection.client';
import { invoicesClient } from './invoices.client';
import { outboundBatchesClient } from './outbound-batches.client';
import { directShipClient } from './direct-ship.client';
import { consolidationClient } from './consolidation.client';
import { locationOptimizationClient } from './location-optimization.client';
import { matchingClient } from '../matching/matching.client';

export const orders = {
  salesOrders,
  fulfillmentOrder,
  fulfillments: fulfillmentsClient,
  picking: pickingClient,
  inspection: inspectionClient,
  invoices: invoicesClient,
  outboundBatches: outboundBatchesClient,
  directShip: directShipClient,
  consolidation: consolidationClient,
  locationOptimization: locationOptimizationClient,
  matching: matchingClient,
};

export { salesOrders } from './sales-orders.client';
export { fulfillmentOrder } from './fulfillment-order.client';
export { fulfillmentsClient } from './fulfillments.client';
export { pickingClient } from './picking.client';
export { inspectionClient } from './inspection.client';
export { invoicesClient } from './invoices.client';
export { outboundBatchesClient } from './outbound-batches.client';
export { directShipClient } from './direct-ship.client';
export { consolidationClient } from './consolidation.client';
export { locationOptimizationClient } from './location-optimization.client';
