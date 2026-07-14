import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DbService } from '@app/db';
import {
  FulfillmentProgressedPayload,
  FulfillmentReopenedPayload,
  ShipmentDeliveredPayload,
  ShipmentDispatchRecalledPayload,
  ShipmentEventOrder,
  ShipmentShippedPayload,
} from '@packages/event-contracts/streams';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { ChannelAdapterFactory } from '../adapters/channel-adapter.factory';
import { MedusaClient } from '../adapters/medusa/medusa.client';
import { channelDispatchOperations, inboxEvents } from '../schema';
import type { ChannelAdapterSchema, ChannelCommand, ChannelDispatchOperation } from '../types';
import { getChannelFulfillmentCapabilities, ShipmentSalesChannel } from './channel-fulfillment-capabilities';

const OUTBOUND_INBOX_EVENT_TYPES = [
  'ShipmentShipped',
  'ShipmentDelivered',
  'ShipmentDispatchRecalled',
  'FulfillmentProgressed',
  'FulfillmentReopened',
] as const;
type OutboundInboxEventType = (typeof OUTBOUND_INBOX_EVENT_TYPES)[number];
type ShipmentInboxEventType = Extract<OutboundInboxEventType, `Shipment${string}`>;
type DispatchOperationType = 'dispatch' | 'delivery' | 'recall';
type ClaimedInboxEvent =
  | {
      id: string;
      eventType: ShipmentInboxEventType;
      payload: ShipmentShippedPayload | ShipmentDeliveredPayload | ShipmentDispatchRecalledPayload;
    }
  | {
      id: string;
      eventType: 'FulfillmentProgressed' | 'FulfillmentReopened';
      payload: FulfillmentProgressedPayload | FulfillmentReopenedPayload;
    };

@Injectable()
export class ShipmentDispatchInboxWorker {
  private readonly logger = new Logger(ShipmentDispatchInboxWorker.name);
  private running = false;
  private readonly processingLeaseMs = 5 * 60 * 1000;
  private readonly operationLeaseMs = 5 * 60 * 1000;

  constructor(
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly channelAdapterFactory: ChannelAdapterFactory,
    private readonly medusaClient: MedusaClient,
  ) {}

  @Interval(1_000)
  async processPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const event = await this.claimNextEvent();
      if (event) await this.processClaimedEvent(event);
    } finally {
      this.running = false;
    }
  }

  /** Exposed for deterministic worker/crash tests and operator recovery tooling. */
  async processClaimedEvent(event: ClaimedInboxEvent): Promise<void> {
    if (event.eventType === 'FulfillmentProgressed' || event.eventType === 'FulfillmentReopened') {
      await this.dbService.db
        .update(inboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(inboxEvents.id, event.id));
      return;
    }

    const shipmentEvent = event as Extract<ClaimedInboxEvent, { eventType: ShipmentInboxEventType }>;
    const operation = this.operationForEvent(shipmentEvent.eventType);
    await this.ensureOperations(shipmentEvent.id, shipmentEvent.eventType, shipmentEvent.payload);

    const dispatchAttemptId = shipmentEvent.payload.dispatchAttemptId;
    const operations = await this.dbService.db
      .select()
      .from(channelDispatchOperations)
      .where(
        and(
          eq(channelDispatchOperations.dispatchAttemptId, dispatchAttemptId),
          eq(channelDispatchOperations.operation, operation),
        ),
      )
      .orderBy(channelDispatchOperations.salesOrderId);

    for (const row of operations) {
      await this.processOperation(row);
    }

    const incomplete = await this.dbService.db
      .select({ id: channelDispatchOperations.id })
      .from(channelDispatchOperations)
      .where(
        and(
          eq(channelDispatchOperations.dispatchAttemptId, dispatchAttemptId),
          eq(channelDispatchOperations.operation, operation),
          inArray(channelDispatchOperations.status, ['pending', 'processing', 'failed', 'provider_acknowledged']),
        ),
      )
      .limit(1);

    await this.dbService.db
      .update(inboxEvents)
      .set(
        incomplete.length
          ? {
              status: 'pending',
              nextAttemptAt: new Date(Date.now() + 5_000),
              errorMessage: 'One or more channel operations remain retryable',
            }
          : { status: 'published', publishedAt: new Date(), errorMessage: null },
      )
      .where(eq(inboxEvents.id, event.id));
  }

  private async claimNextEvent(): Promise<ClaimedInboxEvent | null> {
    const eventTypes = sql.join(
      OUTBOUND_INBOX_EVENT_TYPES.map((type) => sql`${type}`),
      sql`, `,
    );
    const rows = await this.dbService.db.execute<ClaimedInboxEvent>(sql`
      UPDATE ${inboxEvents}
      SET
        status = 'processing',
        attempts = attempts + 1,
        next_attempt_at = NOW() + (${this.processingLeaseMs}::integer * interval '1 millisecond'),
        error_message = NULL
      WHERE id = (
        SELECT id
        FROM ${inboxEvents}
        WHERE event_type IN (${eventTypes})
          AND (
            (status = 'pending' AND next_attempt_at <= NOW())
            OR (status = 'processing' AND next_attempt_at <= NOW())
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, event_type AS "eventType", payload
    `);
    return rows[0] ?? null;
  }

  private async ensureOperations(
    inboxEventId: string,
    eventType: ShipmentInboxEventType,
    payload: ShipmentShippedPayload | ShipmentDeliveredPayload | ShipmentDispatchRecalledPayload,
  ): Promise<void> {
    const operation = this.operationForEvent(eventType);
    if (eventType === 'ShipmentShipped') {
      const shipped = payload as ShipmentShippedPayload;
      await this.dbService.db
        .insert(channelDispatchOperations)
        .values(
          shipped.orders.map((order) => ({
            inboxEventId,
            dispatchAttemptId: shipped.dispatchAttemptId,
            shipmentId: shipped.shipmentId,
            salesOrderId: order.salesOrderId,
            operation,
            channel: order.salesChannel,
            externalOrderId: order.channelOrderId,
            providerIdempotencyKey: this.providerIdempotencyKey(
              shipped.dispatchAttemptId,
              order.salesOrderId,
              operation,
            ),
            requestSnapshot: { eventType, payload: shipped, order },
          })),
        )
        .onConflictDoNothing();
      return;
    }

    const previousDispatches = await this.dbService.db
      .select()
      .from(channelDispatchOperations)
      .where(
        and(
          eq(channelDispatchOperations.dispatchAttemptId, payload.dispatchAttemptId),
          eq(channelDispatchOperations.operation, 'dispatch'),
        ),
      );

    if (!previousDispatches.length) {
      throw new Error(`No dispatch operation exists for attempt ${payload.dispatchAttemptId}`);
    }

    await this.dbService.db
      .insert(channelDispatchOperations)
      .values(
        previousDispatches.map((previous) => ({
          inboxEventId,
          dispatchAttemptId: payload.dispatchAttemptId,
          shipmentId: payload.shipmentId,
          salesOrderId: previous.salesOrderId,
          operation,
          channel: previous.channel,
          externalOrderId: previous.externalOrderId,
          providerIdempotencyKey: this.providerIdempotencyKey(
            payload.dispatchAttemptId,
            previous.salesOrderId,
            operation,
          ),
          requestSnapshot: { eventType, payload },
        })),
      )
      .onConflictDoNothing();
  }

  private async processOperation(operation: ChannelDispatchOperation): Promise<void> {
    if (operation.status === 'succeeded' || operation.status === 'manual_adjustment_required') return;
    if (operation.status === 'provider_acknowledged') {
      await this.finalizeProviderAcknowledgement(operation.id);
      return;
    }

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.operationLeaseMs);

    const [claimed] = await this.dbService.db
      .update(channelDispatchOperations)
      .set({
        status: 'processing',
        attempts: sql`${channelDispatchOperations.attempts} + 1`,
        lastAttemptAt: now,
        processingStartedAt: now,
        leaseExpiresAt,
        errorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(channelDispatchOperations.id, operation.id),
          or(
            inArray(channelDispatchOperations.status, ['pending', 'failed']),
            and(eq(channelDispatchOperations.status, 'processing'), lte(channelDispatchOperations.leaseExpiresAt, now)),
          ),
        ),
      )
      .returning();
    if (!claimed) return;

    let outcome: Awaited<ReturnType<ShipmentDispatchInboxWorker['executeOperation']>>;
    try {
      outcome = await this.executeOperation(claimed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.dbService.db
        .update(channelDispatchOperations)
        .set({
          status: 'failed',
          errorMessage: message,
          processingStartedAt: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(channelDispatchOperations.id, claimed.id));
      this.logger.error(`Channel operation failed: ${claimed.id}`, message);
      return;
    }

    if (outcome.manual) {
      await this.dbService.db
        .update(channelDispatchOperations)
        .set({
          status: 'manual_adjustment_required',
          errorMessage: outcome.reason,
          processingStartedAt: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(channelDispatchOperations.id, claimed.id));
      return;
    }

    // Persist the provider acknowledgement before the final terminal transition. A crash
    // after this write resumes by finalizing locally and never repeats the provider call.
    await this.dbService.db
      .update(channelDispatchOperations)
      .set({
        status: 'provider_acknowledged',
        resultSnapshot: {
          ...outcome.result,
          providerAcknowledged: true,
          providerIdempotencyKey: claimed.providerIdempotencyKey,
        },
        providerAcknowledgedAt: new Date(),
        processingStartedAt: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(channelDispatchOperations.id, claimed.id));

    await this.finalizeProviderAcknowledgement(claimed.id);
  }

  private async finalizeProviderAcknowledgement(operationId: string): Promise<void> {
    await this.dbService.db
      .update(channelDispatchOperations)
      .set({ status: 'succeeded', succeededAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(channelDispatchOperations.id, operationId),
          eq(channelDispatchOperations.status, 'provider_acknowledged'),
        ),
      );
  }

  private async executeOperation(
    operation: ChannelDispatchOperation,
  ): Promise<{ manual: true; reason: string; result?: never } | { manual: false; result: Record<string, unknown> }> {
    const channel = operation.channel as ShipmentSalesChannel;
    const capabilities = getChannelFulfillmentCapabilities(channel);
    if (!capabilities) {
      return { manual: true, reason: `No fulfillment capability is registered for ${operation.channel}.` };
    }
    if (capabilities.route.kind === 'manual') {
      return { manual: true, reason: capabilities.route.reason };
    }

    const snapshot = operation.requestSnapshot as {
      eventType: ShipmentInboxEventType;
      payload: ShipmentShippedPayload | ShipmentDeliveredPayload | ShipmentDispatchRecalledPayload;
      order?: ShipmentEventOrder;
    };

    if (operation.operation === 'recall' && !capabilities.automatedRecall) {
      return { manual: true, reason: `${channel} does not support automated shipment recall.` };
    }

    if (operation.operation === 'delivery') {
      if (capabilities.route.kind === 'projection') {
        await this.withMedusaOrderProjectionLock(operation.externalOrderId, () =>
          this.medusaClient.updateOrderShipmentAttemptProjection(operation.externalOrderId, {
            operation: 'delivery',
            payload: snapshot.payload as ShipmentDeliveredPayload,
          }),
        );
      }
      return { manual: false, result: { acknowledged: true } };
    }

    if (operation.operation === 'recall') {
      await this.withMedusaOrderProjectionLock(operation.externalOrderId, () =>
        this.medusaClient.updateOrderShipmentAttemptProjection(operation.externalOrderId, {
          operation: 'recall',
          payload: snapshot.payload as ShipmentDispatchRecalledPayload,
        }),
      );
      return { manual: false, result: { projected: true } };
    }

    const shipped = snapshot.payload as ShipmentShippedPayload;
    const order = snapshot.order;
    if (!order) throw new Error('ShipmentShipped operation is missing its sales-order snapshot');
    if (order.isPartial && !capabilities.multipleTrackingNumbers) {
      return { manual: true, reason: `${channel} does not support multiple tracking numbers.` };
    }
    if (order.lines.some((line) => line.isPartialQuantity) && !capabilities.partialQuantityDispatch) {
      return { manual: true, reason: `${channel} does not support automated partial-quantity dispatch.` };
    }
    if (order.lines.some((line) => !line.channelOrderItemId)) {
      return { manual: true, reason: `${channel} dispatch is missing a channel order-item identifier.` };
    }
    const invalidExternalIdentity = this.invalidExternalIdentityReason(channel, operation.externalOrderId, order);
    if (invalidExternalIdentity) return { manual: true, reason: invalidExternalIdentity };

    if (capabilities.route.kind === 'projection') {
      await this.withMedusaOrderProjectionLock(operation.externalOrderId, () =>
        this.medusaClient.updateOrderShipmentAttemptProjection(operation.externalOrderId, {
          operation: 'dispatch',
          payload: shipped,
          order,
        }),
      );
      return { manual: false, result: { projected: true } };
    }

    const adapter = this.channelAdapterFactory.getAdapter(capabilities.route.adapter);
    const command: Extract<ChannelCommand, { type: 'dispatch.ship' }> = {
      type: 'dispatch.ship',
      idempotencyKey: operation.providerIdempotencyKey,
      orderId: operation.externalOrderId,
      items: order.lines.map((line) => ({ orderItemId: line.channelOrderItemId, quantity: line.qty })),
      tracking: { companyCode: shipped.invoice.carrier, number: shipped.invoice.trackingNo },
      dispatchedAt: shipped.dispatchedAt,
    };

    if (operation.attempts > 1) {
      if (!adapter.reconcileCommand) {
        throw new Error(`${channel} adapter cannot safely reconcile a retried dispatch mutation`);
      }
      const reconciliation = await adapter.reconcileCommand(command);
      if (reconciliation.applied) {
        return {
          manual: false,
          result: { reconciledProviderSuccess: true, evidence: reconciliation.evidence ?? null },
        };
      }
    }

    const result = await adapter.executeCommand(command);
    if (!result.success) {
      throw new Error(result.errors?.map((error) => error.message).join('; ') || `${channel} dispatch failed`);
    }
    return { manual: false, result: { providerResult: result.data ?? null } };
  }

  private providerIdempotencyKey(
    dispatchAttemptId: string,
    salesOrderId: string,
    operation: DispatchOperationType,
  ): string {
    return `shipment:${dispatchAttemptId}:${salesOrderId}:${operation}`;
  }

  private invalidExternalIdentityReason(
    channel: ShipmentSalesChannel,
    externalOrderId: string,
    order: ShipmentEventOrder,
  ): string | null {
    if (channel !== 'naver' && channel !== 'coupang') return null;
    const ids = [externalOrderId, ...order.lines.map((line) => line.channelOrderItemId)];
    if (ids.some((id) => !/^\d+$/.test(id))) {
      return `${channel} dispatch has an invalid external order or order-item identifier.`;
    }
    if (channel === 'coupang' && ids.some((id) => !Number.isSafeInteger(Number(id)))) {
      return 'coupang dispatch has an external identifier outside the safe integer range.';
    }
    return null;
  }

  private async withMedusaOrderProjectionLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
    return this.dbService.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${orderId}, 0))`);
      return work();
    });
  }

  private operationForEvent(eventType: ShipmentInboxEventType): DispatchOperationType {
    switch (eventType) {
      case 'ShipmentShipped':
        return 'dispatch';
      case 'ShipmentDelivered':
        return 'delivery';
      case 'ShipmentDispatchRecalled':
        return 'recall';
    }
  }
}
