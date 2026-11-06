import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { loadShipmentLines } from '../services/consolidation-shipment-reads';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { BulkShipmentResult, runPerShipment } from './bulk-shipment-result';
import { resolvePlanProfileId } from './outbound-preparation-classify';

@Injectable()
export class OutboundPreparationManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly planning: ShipmentPlanningService,
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
}
