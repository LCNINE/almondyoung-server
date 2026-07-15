import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { ShipmentTrackingEventDto } from '../dto/shipment-tracking-event.dto';
import { FULFILLMENT_EVENTS, fulfillmentDeliveredV1OutboxEvent, shipmentDeliveredOutboxEvent } from '../events';
import { OutboxService } from '../outbox/outbox.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';

export interface ShipmentTrackingEventResult {
  shipmentId: string;
  dispatchAttemptId: string;
  providerEventId: string;
  status: 'in_transit' | 'delivered';
  replayed: boolean;
}

type ExistingTracking = typeof wmsTables.shipmentTracking.$inferSelect;

@Injectable()
export class ShipmentDeliveryTrackingService {
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly outbox: OutboxService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly shipmentReservations: ShipmentReservationService,
  ) {}

  async recordProviderEvent(
    dispatchAttemptId: string,
    input: ShipmentTrackingEventDto,
    tx?: DbTx,
  ): Promise<ShipmentTrackingEventResult> {
    this.workflowGate.assertV2MutationAllowed('shipment.tracking.record');
    const providerEventId = input.providerEventId.trim();
    const location = input.location?.trim() || null;
    const occurredAt = new Date(input.occurredAt);
    if (!providerEventId) throw new BadRequestException('providerEventId must contain a visible character');
    if (!Number.isFinite(occurredAt.getTime())) throw new BadRequestException('occurredAt must be a valid timestamp');

    return this.db.run(async (trx) => {
      const initialExisting = await this.findProviderEvent(dispatchAttemptId, providerEventId, trx);
      if (initialExisting)
        return this.exactReplay(initialExisting, dispatchAttemptId, input.status, occurredAt, location);

      const [initialAttempt] = await trx
        .select({ shipmentId: wmsTables.dispatchAttempts.shipmentId })
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, dispatchAttemptId))
        .limit(1);
      if (!initialAttempt) throw new NotFoundException(`Dispatch attempt ${dispatchAttemptId} not found`);

      await this.shipmentReservations.lockShipmentGraphForDispatch(initialAttempt.shipmentId, trx);
      await trx.execute(
        sql`SELECT id FROM ${wmsTables.dispatchAttempts} WHERE ${wmsTables.dispatchAttempts.id} = ${dispatchAttemptId} FOR UPDATE`,
      );
      const [attempt] = await trx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, dispatchAttemptId))
        .limit(1);
      if (!attempt) throw new NotFoundException(`Dispatch attempt ${dispatchAttemptId} not found`);
      if (attempt.shipmentId !== initialAttempt.shipmentId) {
        throw this.conflict(
          'DISPATCH_ATTEMPT_CHANGED',
          `Dispatch attempt ${dispatchAttemptId} changed shipment ownership`,
        );
      }
      if (attempt.status !== 'dispatched') {
        throw this.conflict(
          'DISPATCH_ATTEMPT_NOT_TRACKABLE',
          `Dispatch attempt ${dispatchAttemptId} is '${attempt.status}', expected 'dispatched'`,
        );
      }
      if (!attempt.dispatchedAt || occurredAt.getTime() < attempt.dispatchedAt.getTime()) {
        throw this.conflict(
          'TRACKING_EVENT_BEFORE_DISPATCH',
          `Tracking event ${providerEventId} occurred before dispatch attempt ${dispatchAttemptId}`,
        );
      }

      const [shipment] = await trx
        .select({ status: wmsTables.shipments.status })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, attempt.shipmentId))
        .limit(1);
      if (!shipment || !['shipped', 'in_transit', 'delivered'].includes(shipment.status)) {
        throw this.conflict(
          'SHIPMENT_NOT_TRACKABLE',
          `Shipment ${attempt.shipmentId} is '${shipment?.status ?? 'missing'}' and cannot accept carrier tracking`,
        );
      }
      const [activeAttempt] = await trx
        .select({ id: wmsTables.dispatchAttempts.id })
        .from(wmsTables.dispatchAttempts)
        .where(
          and(
            eq(wmsTables.dispatchAttempts.shipmentId, attempt.shipmentId),
            ne(wmsTables.dispatchAttempts.status, 'recalled'),
          ),
        )
        .orderBy(desc(wmsTables.dispatchAttempts.attemptNo))
        .limit(1);
      if (activeAttempt?.id !== attempt.id) {
        throw this.conflict(
          'DISPATCH_ATTEMPT_NOT_ACTIVE',
          `Dispatch attempt ${dispatchAttemptId} is not the latest non-recalled attempt`,
        );
      }

      if (!attempt.carrierAcceptedAt || occurredAt.getTime() < attempt.carrierAcceptedAt.getTime()) {
        await trx
          .update(wmsTables.dispatchAttempts)
          .set({ carrierAcceptedAt: occurredAt, updatedAt: new Date() })
          .where(
            and(eq(wmsTables.dispatchAttempts.id, attempt.id), eq(wmsTables.dispatchAttempts.status, 'dispatched')),
          );
      }

      const [inserted] = await trx
        .insert(wmsTables.shipmentTracking)
        .values({
          shipmentId: attempt.shipmentId,
          dispatchAttemptId: attempt.id,
          providerEventId,
          status: input.status,
          location,
          timestamp: occurredAt,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const concurrentExisting = await this.findProviderEvent(dispatchAttemptId, providerEventId, trx);
        if (!concurrentExisting) throw new Error('Provider event conflict did not resolve to an existing row');
        return this.exactReplay(concurrentExisting, dispatchAttemptId, input.status, occurredAt, location);
      }

      if (input.status === 'in_transit') {
        await trx
          .update(wmsTables.shipments)
          .set({ status: 'in_transit', lastUpdated: occurredAt })
          .where(and(eq(wmsTables.shipments.id, attempt.shipmentId), eq(wmsTables.shipments.status, 'shipped')));
      } else {
        await trx
          .update(wmsTables.shipments)
          .set({ status: 'delivered', deliveredAt: occurredAt, lastUpdated: occurredAt })
          .where(
            and(
              eq(wmsTables.shipments.id, attempt.shipmentId),
              inArray(wmsTables.shipments.status, ['shipped', 'in_transit']),
            ),
          );
        await this.emitDeliveredProjections(attempt, providerEventId, occurredAt, trx);
      }

      return {
        shipmentId: attempt.shipmentId,
        dispatchAttemptId: attempt.id,
        providerEventId,
        status: input.status,
        replayed: false,
      };
    }, tx);
  }

  private async emitDeliveredProjections(
    attempt: typeof wmsTables.dispatchAttempts.$inferSelect,
    providerEventId: string,
    deliveredAt: Date,
    tx: DbTx,
  ): Promise<void> {
    await this.outbox.enqueue(
      shipmentDeliveredOutboxEvent({
        shipmentId: attempt.shipmentId,
        dispatchAttemptId: attempt.id,
        attemptNo: attempt.attemptNo,
        providerEventId,
        deliveredAt: deliveredAt.toISOString(),
      }),
      tx,
    );

    const affectedOrders = await tx
      .selectDistinct({ fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempt.id));

    const fulfillmentOrderIds = [...new Set(affectedOrders.map((row) => row.fulfillmentOrderId))].sort();
    // Different shipments can complete the same FO concurrently. Canonical row locks
    // ensure the waiter observes the winner's committed tracking evidence before eligibility.
    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      await tx.execute(
        sql`SELECT id FROM ${wmsTables.fulfillmentOrders} WHERE ${wmsTables.fulfillmentOrders.id} = ${fulfillmentOrderId} FOR UPDATE`,
      );
    }

    for (const fulfillmentOrderId of fulfillmentOrderIds) {
      const v1DeliveredAt = await this.v1DeliveryTimestamp(fulfillmentOrderId, tx);
      if (!v1DeliveredAt) continue;

      const [identity] = await tx
        .select({
          salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
          channelOrderId: wmsTables.salesOrders.channelOrderId,
        })
        .from(wmsTables.fulfillmentOrders)
        .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!identity?.salesOrderId) continue;

      await this.outbox.enqueue(
        fulfillmentDeliveredV1OutboxEvent({
          fulfillmentId: fulfillmentOrderId,
          orderId: identity.salesOrderId,
          ...(identity.channelOrderId ? { channelOrderId: identity.channelOrderId } : {}),
          deliveredAt: v1DeliveredAt.toISOString(),
        }),
        tx,
      );
    }
  }

  private async v1DeliveryTimestamp(fulfillmentOrderId: string, tx: DbTx): Promise<Date | null> {
    const [fullShippedProjection] = await tx
      .select({ id: wmsTables.outboxEvents.id })
      .from(wmsTables.outboxEvents)
      .where(
        and(
          eq(wmsTables.outboxEvents.topic, FULFILLMENT_STREAM.topic.topic),
          eq(wmsTables.outboxEvents.eventType, FULFILLMENT_EVENTS.SHIPPED),
          eq(wmsTables.outboxEvents.idempotencyKey, `${fulfillmentOrderId}:fully-shipped`),
        ),
      )
      .limit(1);
    if (!fullShippedProjection) return null;

    const attempts = await tx
      .selectDistinct({
        id: wmsTables.dispatchAttempts.id,
        status: wmsTables.dispatchAttempts.status,
      })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.dispatchAttempts,
        eq(wmsTables.dispatchAttempts.id, wmsTables.dispatchAttemptSources.dispatchAttemptId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(
        and(
          eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId),
          ne(wmsTables.dispatchAttempts.status, 'recalled'),
        ),
      );
    if (attempts.length === 0 || attempts.some((row) => row.status !== 'dispatched')) return null;

    const delivered = await tx
      .select({
        dispatchAttemptId: wmsTables.shipmentTracking.dispatchAttemptId,
        timestamp: wmsTables.shipmentTracking.timestamp,
      })
      .from(wmsTables.shipmentTracking)
      .where(
        and(
          inArray(
            wmsTables.shipmentTracking.dispatchAttemptId,
            attempts.map((row) => row.id),
          ),
          eq(wmsTables.shipmentTracking.status, 'delivered'),
        ),
      );
    const deliveredIds = new Set(delivered.map((row) => row.dispatchAttemptId));
    if (!attempts.every((row) => deliveredIds.has(row.id))) return null;
    return new Date(Math.max(...delivered.map((row) => row.timestamp.getTime())));
  }

  private async findProviderEvent(
    dispatchAttemptId: string,
    providerEventId: string,
    tx: DbTx,
  ): Promise<ExistingTracking | undefined> {
    const [row] = await tx
      .select()
      .from(wmsTables.shipmentTracking)
      .where(
        and(
          eq(wmsTables.shipmentTracking.dispatchAttemptId, dispatchAttemptId),
          eq(wmsTables.shipmentTracking.providerEventId, providerEventId),
        ),
      )
      .limit(1);
    return row;
  }

  private exactReplay(
    existing: ExistingTracking,
    dispatchAttemptId: string,
    status: 'in_transit' | 'delivered',
    occurredAt: Date,
    location: string | null,
  ): ShipmentTrackingEventResult {
    if (
      existing.dispatchAttemptId !== dispatchAttemptId ||
      existing.status !== status ||
      existing.timestamp.getTime() !== occurredAt.getTime() ||
      (existing.location ?? null) !== location
    ) {
      throw this.conflict(
        'PROVIDER_EVENT_ID_CONFLICT',
        `Provider event ${existing.providerEventId} was already recorded with a different payload`,
      );
    }
    return {
      shipmentId: existing.shipmentId,
      dispatchAttemptId,
      providerEventId: existing.providerEventId!,
      status,
      replayed: true,
    };
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
