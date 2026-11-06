import { ConflictError } from '@app/shared';
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';
import { WAYBILL, WAYBILL_DISPATCHABLE_STATUSES } from '../waybill/waybill.constants';
import { toView, WaybillService } from '../waybill/waybill.service';
import {
  bulkShipmentFailure,
  BulkShipmentResult,
  PreparationWaybillResult,
  runPerShipment,
} from './bulk-shipment-result';
import { resolvePlanProfileId } from './outbound-preparation-classify';

@Injectable()
export class OutboundPreparationManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly planning: ShipmentPlanningService,
    private readonly batches: OutboundBatchOrchestrator,
    private readonly waybills: WaybillService,
  ) {}

  planMany(shipmentIds: string[], idempotencyKey: string, actor: ShipmentPlanningActor): Promise<BulkShipmentResult> {
    return runPerShipment(shipmentIds, async (shipmentId) => {
      const db = this.dbService.db;
      const [shipment] = await db
        .select({
          status: wmsTables.shipments.status,
          manifestVersion: wmsTables.shipments.manifestVersion,
          reservationVersion: wmsTables.shipments.reservationVersion,
        })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);

      if (!shipment) {
        throw new NotFoundException('상자를 찾을 수 없어요');
      }

      if (shipment.status === 'planned') {
        return 'already';
      }

      const lines = await loadShipmentLines(db, [shipmentId]);
      const shippingProfileId = resolvePlanProfileId(lines.map((line) => line.skuProfileId));

      if (shippingProfileId === null) {
        throw new ConflictException({ code: 'SHIPMENT_PROFILE_INCOMPATIBLE' });
      }

      await this.planning.plan(
        shipmentId,
        {
          shippingProfileId,
          expectedManifestVersion: shipment.manifestVersion,
          expectedReservationVersion: shipment.reservationVersion,
        },
        `${idempotencyKey}:${shipmentId}`,
        actor,
      );

      return 'done';
    });
  }

  async issueWaybills(
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<PreparationWaybillResult[]> {
    const deadline = Date.now() + WAYBILL.BATCH_TIME_BUDGET_MS;
    const queue = shipmentIds.entries();
    const results: PreparationWaybillResult[] = [];

    await Promise.all(
      Array.from({ length: Math.min(WAYBILL.BATCH_CONCURRENCY, shipmentIds.length) }, async () => {
        for (const [index, shipmentId] of queue) {
          if (Date.now() >= deadline) {
            results[index] = {
              shipmentId,
              status: 'pending',
              trackingNo: null,
              reason: 'time-budget-exceeded',
              nextAttemptAt: null,
            };
            continue;
          }

          try {
            let waybill = await this.waybills.getActiveWaybill(shipmentId);

            if (waybill && WAYBILL_DISPATCHABLE_STATUSES.some((status) => status === waybill?.status)) {
              waybill = toView(await this.waybills.assertDispatchable(shipmentId));
            } else {
              const [shipment] = await this.dbService.db
                .select({ manifestVersion: wmsTables.shipments.manifestVersion })
                .from(wmsTables.shipments)
                .where(eq(wmsTables.shipments.id, shipmentId))
                .limit(1);

              if (!shipment) {
                throw new NotFoundException('상자를 찾을 수 없어요');
              }

              try {
                waybill = await this.waybills.issueForShipment(
                  shipmentId,
                  { carrier: 'HANJIN', expectedManifestVersion: shipment.manifestVersion },
                  `${idempotencyKey}:${shipmentId}`,
                  actor,
                );
              } catch (error) {
                if (error instanceof ConflictError && error.message.startsWith(`${WAYBILL.ERROR.ACTIVE_EXISTS}:`)) {
                  throw new ServiceUnavailableException({ code: 'WAYBILL_ISSUE_IN_PROGRESS' });
                }

                throw error;
              }
            }

            results[index] = {
              shipmentId,
              status: waybill.status,
              trackingNo: waybill.trackingNo,
              reason: waybill.lastError,
              nextAttemptAt: waybill.nextAttemptAt,
            };
          } catch (error) {
            const failure = bulkShipmentFailure(shipmentId, error);

            results[index] = {
              shipmentId,
              status: 'failed',
              trackingNo: null,
              reason: failure.message,
              nextAttemptAt: null,
              transient: failure.transient,
            };
          }
        }
      }),
    );

    return results;
  }

  addManyToBatch(
    batchId: string,
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<BulkShipmentResult> {
    return runPerShipment(shipmentIds, async (shipmentId) => {
      const [workItem] = await this.dbService.db
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
            eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
            inArray(
              wmsTables.outboundBatchWorkItems.status,
              ACTIVE_WORK_ITEM_STATUSES.filter((status) => status !== 'withdrawing'),
            ),
          ),
        )
        .limit(1);

      if (workItem) {
        return 'already';
      }

      await this.batches.addShipment(batchId, shipmentId, `${idempotencyKey}:${shipmentId}`, actor);

      return 'done';
    });
  }

  splitManyUnreserved(
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<BulkShipmentResult> {
    return runPerShipment(shipmentIds, async (shipmentId) => {
      const [shipment] = await this.dbService.db
        .select({ manifestVersion: wmsTables.shipments.manifestVersion })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);

      if (!shipment) {
        throw new NotFoundException('상자를 찾을 수 없어요');
      }

      const lines = await this.dbService.db
        .select({
          qty: wmsTables.shipmentLines.qty,
          confirmedQty: sql`coalesce(sum(${wmsTables.stockReservations.quantity}), 0)`.mapWith(Number),
        })
        .from(wmsTables.shipmentLines)
        .leftJoin(
          wmsTables.stockReservations,
          and(
            eq(wmsTables.stockReservations.targetId, wmsTables.shipmentLines.id),
            eq(wmsTables.stockReservations.targetType, 'SHIPMENT_LINE'),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        )
        .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
        .groupBy(wmsTables.shipmentLines.id, wmsTables.shipmentLines.qty);

      if (!lines.some((line) => line.confirmedQty < line.qty)) {
        return 'already';
      }

      await this.planning.splitUnreserved(
        shipmentId,
        { reason: '출고 준비: 있는 것만 먼저 보내기', expectedManifestVersion: shipment.manifestVersion },
        `${idempotencyKey}:${shipmentId}`,
        actor,
      );

      return 'done';
    });
  }
}
