import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { ACTIVE_WORK_ITEM_STATUSES } from '../services/work-item-status';
import { BulkShipmentResult, runPerShipment } from './bulk-shipment-result';
import { resolvePlanProfileId } from './outbound-preparation-classify';

@Injectable()
export class OutboundPreparationManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly planning: ShipmentPlanningService,
    private readonly batches: OutboundBatchOrchestrator,
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
