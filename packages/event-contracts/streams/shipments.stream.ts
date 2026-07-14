/**
 * Shipment Stream
 *
 * Shipment/dispatch-attempt facts. These events intentionally exclude recipient,
 * address and contact data; channel dispatch only needs external order identities.
 */

import { z } from 'zod';
import { event, stream } from '../types';

const NonEmptyIdSchema = z.string().trim().min(1);
const CoreUuidSchema = z.string().uuid();
const PositiveQuantitySchema = z.number().int().positive();
const AttemptNoSchema = z.number().int().positive();
const SalesChannelSchema = z.enum(['medusa', 'naver', 'coupang', '3pl']);
const ShipmentCarrierSchema = z.enum(['CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS']);

const ShipmentInvoiceSchema = z
  .object({
    invoiceId: CoreUuidSchema,
    carrier: ShipmentCarrierSchema,
    trackingNo: NonEmptyIdSchema,
  })
  .strict();

const ShipmentEventLineSchema = z
  .object({
    shipmentLineId: CoreUuidSchema,
    fulfillmentOrderItemId: CoreUuidSchema,
    salesOrderLineId: CoreUuidSchema,
    channelOrderItemId: NonEmptyIdSchema,
    skuId: CoreUuidSchema,
    qty: PositiveQuantitySchema,
    /** True only when this attempt ships less than the remaining quantity of this line. */
    isPartialQuantity: z.boolean(),
  })
  .strict();

const ShipmentEventOrderSchema = z
  .object({
    salesOrderId: CoreUuidSchema,
    fulfillmentOrderId: CoreUuidSchema,
    salesChannel: SalesChannelSchema,
    channelOrderId: NonEmptyIdSchema,
    /**
     * True when this dispatch does not fully ship the channel order. Consumers use
     * this explicit signal instead of guessing from the subset of lines in the event.
     */
    isPartial: z.boolean(),
    lines: z.array(ShipmentEventLineSchema).min(1),
  })
  .strict();

const ShipmentShippedSchema = z
  .object({
    shipmentId: CoreUuidSchema,
    dispatchAttemptId: CoreUuidSchema,
    attemptNo: AttemptNoSchema,
    warehouseId: CoreUuidSchema,
    dispatchedAt: z.string().datetime(),
    invoice: ShipmentInvoiceSchema,
    orders: z.array(ShipmentEventOrderSchema).min(1),
  })
  .strict()
  .superRefine((payload, context) => {
    const orderGroupKeys = new Set<string>();
    const shipmentLineIds = new Set<string>();
    const fulfillmentOrderItemIds = new Set<string>();
    const salesOrderLineIds = new Set<string>();

    payload.orders.forEach((order, orderIndex) => {
      const orderGroupKey = `${order.salesChannel}\u0000${order.channelOrderId}`;
      if (orderGroupKeys.has(orderGroupKey)) {
        context.addIssue({
          code: 'custom',
          message: 'salesChannel/channelOrderId groups must be unique within a shipment event',
          path: ['orders', orderIndex, 'channelOrderId'],
        });
      }
      orderGroupKeys.add(orderGroupKey);
      const channelOrderItemIds = new Set<string>();

      order.lines.forEach((line, lineIndex) => {
        if (shipmentLineIds.has(line.shipmentLineId)) {
          context.addIssue({
            code: 'custom',
            message: 'shipmentLineId must be unique within a shipment event',
            path: ['orders', orderIndex, 'lines', lineIndex, 'shipmentLineId'],
          });
        }
        shipmentLineIds.add(line.shipmentLineId);

        if (fulfillmentOrderItemIds.has(line.fulfillmentOrderItemId)) {
          context.addIssue({
            code: 'custom',
            message: 'fulfillmentOrderItemId must be unique within a shipment event',
            path: ['orders', orderIndex, 'lines', lineIndex, 'fulfillmentOrderItemId'],
          });
        }
        fulfillmentOrderItemIds.add(line.fulfillmentOrderItemId);

        if (salesOrderLineIds.has(line.salesOrderLineId)) {
          context.addIssue({
            code: 'custom',
            message: 'salesOrderLineId must be unique within a shipment event',
            path: ['orders', orderIndex, 'lines', lineIndex, 'salesOrderLineId'],
          });
        }
        salesOrderLineIds.add(line.salesOrderLineId);

        if (channelOrderItemIds.has(line.channelOrderItemId)) {
          context.addIssue({
            code: 'custom',
            message: 'channelOrderItemId must be unique within a channel-order group',
            path: ['orders', orderIndex, 'lines', lineIndex, 'channelOrderItemId'],
          });
        }
        channelOrderItemIds.add(line.channelOrderItemId);
      });
    });
  });

const ShipmentDeliveredSchema = z
  .object({
    shipmentId: CoreUuidSchema,
    dispatchAttemptId: CoreUuidSchema,
    attemptNo: AttemptNoSchema,
    providerEventId: NonEmptyIdSchema,
    deliveredAt: z.string().datetime(),
  })
  .strict();

const ShipmentDispatchRecalledSchema = z
  .object({
    shipmentId: CoreUuidSchema,
    dispatchAttemptId: CoreUuidSchema,
    attemptNo: AttemptNoSchema,
    recallOperationId: CoreUuidSchema,
    recalledAt: z.string().datetime(),
  })
  .strict();

export type ShipmentCarrier = z.infer<typeof ShipmentCarrierSchema>;
export type ShipmentInvoice = z.infer<typeof ShipmentInvoiceSchema>;
export type ShipmentEventLine = z.infer<typeof ShipmentEventLineSchema>;
export type ShipmentEventOrder = z.infer<typeof ShipmentEventOrderSchema>;
export type ShipmentShippedPayload = z.infer<typeof ShipmentShippedSchema>;
export type ShipmentDeliveredPayload = z.infer<typeof ShipmentDeliveredSchema>;
export type ShipmentDispatchRecalledPayload = z.infer<typeof ShipmentDispatchRecalledSchema>;

export function shipmentEventPartitionKey<TPayload extends { shipmentId: string }>(payload: TPayload): string {
  return payload.shipmentId;
}

export const SHIPMENT_STREAM = stream({
  topic: 'shipments.events.v1',
  partitions: 6,
  aggregateType: 'Shipment',
  events: {
    ShipmentShipped: event('ShipmentShipped', ShipmentShippedSchema),
    ShipmentDelivered: event('ShipmentDelivered', ShipmentDeliveredSchema),
    ShipmentDispatchRecalled: event('ShipmentDispatchRecalled', ShipmentDispatchRecalledSchema),
  },
  partitionKey: shipmentEventPartitionKey,
});

export type ShipmentEvents = typeof SHIPMENT_STREAM.events;

export const ShipmentEventTypes = {
  SHIPPED: 'ShipmentShipped',
  DELIVERED: 'ShipmentDelivered',
  DISPATCH_RECALLED: 'ShipmentDispatchRecalled',
} as const;
