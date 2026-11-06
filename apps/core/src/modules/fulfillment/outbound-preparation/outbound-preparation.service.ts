import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { OutboundPreparationSummaryDto } from '../dto/outbound-preparation.dto';
import { ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { BulkShipmentResult } from './bulk-shipment-result';
import { OutboundPreparationManager } from './outbound-preparation.manager';
import { OutboundPreparationReader } from './outbound-preparation.reader';

@Injectable()
export class OutboundPreparationService {
  constructor(
    private readonly reader: OutboundPreparationReader,
    private readonly manager: OutboundPreparationManager,
  ) {}

  summarize(warehouseId: string, tx?: DbTx): Promise<OutboundPreparationSummaryDto> {
    return this.reader.summarize(warehouseId, tx);
  }

  planMany(shipmentIds: string[], idempotencyKey: string, actor: ShipmentPlanningActor): Promise<BulkShipmentResult> {
    return this.manager.planMany(shipmentIds, idempotencyKey, actor);
  }

  addManyToBatch(
    batchId: string,
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<BulkShipmentResult> {
    return this.manager.addManyToBatch(batchId, shipmentIds, idempotencyKey, actor);
  }

  splitManyUnreserved(
    shipmentIds: string[],
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<BulkShipmentResult> {
    return this.manager.splitManyUnreserved(shipmentIds, idempotencyKey, actor);
  }
}
