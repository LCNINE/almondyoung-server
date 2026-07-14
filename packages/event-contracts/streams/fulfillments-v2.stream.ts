/**
 * Fulfillment V2 Stream
 *
 * Cumulative fulfillment-order demand progress. Shipment delivery remains on the
 * shipment stream and is deliberately separate from FO demand settlement.
 */

import { z } from 'zod';
import { event, stream } from '../types';
import { FULFILLMENT_STREAM, type FulfillmentShippedPayload } from './fulfillments.stream';

const CoreUuidSchema = z.string().uuid();
const SettledQuantitySchema = z.number().int().nonnegative();

const FulfillmentProgressSummarySchema = z
  .object({
    fulfillmentOrderId: CoreUuidSchema,
    salesOrderId: CoreUuidSchema,
    dispatchAttemptId: CoreUuidSchema,
    progressedAt: z.string().datetime(),
    shippedQty: SettledQuantitySchema,
    canceledQty: SettledQuantitySchema,
    outstandingQty: SettledQuantitySchema,
  })
  .strict();

const FulfillmentReopenedSchema = z
  .object({
    fulfillmentOrderId: CoreUuidSchema,
    salesOrderId: CoreUuidSchema,
    dispatchAttemptId: CoreUuidSchema,
    recallOperationId: CoreUuidSchema,
    reopenedAt: z.string().datetime(),
    shippedQty: SettledQuantitySchema,
    canceledQty: SettledQuantitySchema,
    outstandingQty: z.number().int().positive(),
  })
  .strict();

export type FulfillmentProgressedPayload = z.infer<typeof FulfillmentProgressSummarySchema>;
export type FulfillmentReopenedPayload = z.infer<typeof FulfillmentReopenedSchema>;

export interface FulfillmentV1CompletionSummary {
  fulfillmentOrderId: string;
  salesOrderId: string;
  shippedQty: number;
  canceledQty: number;
  outstandingQty: number;
}

/**
 * The V1 FulfillmentShipped event remains a full-completion compatibility projection.
 * Producers must use this constructor so a partial or cancellation-settled FO cannot
 * be mislabeled as fully shipped.
 */
export function createFulfillmentShippedV1Projection(
  payload: FulfillmentShippedPayload,
  completion: FulfillmentV1CompletionSummary,
): FulfillmentShippedPayload {
  const quantities = [completion.shippedQty, completion.canceledQty, completion.outstandingQty];
  if (quantities.some((quantity) => !Number.isSafeInteger(quantity) || quantity < 0)) {
    throw new Error('FulfillmentShipped v1 full-completion quantities must be non-negative integers');
  }

  const projectedShippedQty = payload.shippedItems.reduce((sum, item) => sum + item.shippedQty, 0);
  const isFullCompletion =
    completion.fulfillmentOrderId === payload.fulfillmentId &&
    completion.salesOrderId === payload.orderId &&
    completion.shippedQty > 0 &&
    completion.canceledQty === 0 &&
    completion.outstandingQty === 0 &&
    projectedShippedQty === completion.shippedQty;

  if (!isFullCompletion) {
    throw new Error('FulfillmentShipped v1 can only be constructed as a full-completion projection');
  }

  return FULFILLMENT_STREAM.events.FulfillmentShipped.schema!.parse(payload);
}

export function fulfillmentV2EventPartitionKey<TPayload extends { fulfillmentOrderId: string }>(
  payload: TPayload,
): string {
  return payload.fulfillmentOrderId;
}

export const FULFILLMENT_V2_STREAM = stream({
  topic: 'fulfillments.events.v2',
  partitions: 6,
  aggregateType: 'FulfillmentOrder',
  events: {
    FulfillmentProgressed: event('FulfillmentProgressed', FulfillmentProgressSummarySchema),
    FulfillmentReopened: event('FulfillmentReopened', FulfillmentReopenedSchema),
  },
  partitionKey: fulfillmentV2EventPartitionKey,
});

export type FulfillmentV2Events = typeof FULFILLMENT_V2_STREAM.events;

export const FulfillmentV2EventTypes = {
  PROGRESSED: 'FulfillmentProgressed',
  REOPENED: 'FulfillmentReopened',
} as const;
