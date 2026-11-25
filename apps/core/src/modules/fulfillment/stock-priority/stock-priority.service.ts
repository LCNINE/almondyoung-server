import { Injectable } from '@nestjs/common';
import { SetStockPriorityDto } from '../dto/stock-priority.dto';
import { ShipmentCommandReasonDto, ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { StockPriorityManager } from './stock-priority.manager';
import { StockPriorityReader } from './stock-priority.reader';

@Injectable()
export class StockPriorityService {
  constructor(
    private readonly reader: StockPriorityReader,
    private readonly manager: StockPriorityManager,
  ) {}

  preview(shipmentId: string) {
    return this.reader.preview(shipmentId);
  }

  prioritize(shipmentId: string, dto: SetStockPriorityDto, idempotencyKey: string, actor: ShipmentPlanningActor) {
    return this.manager.prioritize(shipmentId, dto, idempotencyKey, actor);
  }

  cancel(shipmentId: string, dto: ShipmentCommandReasonDto, idempotencyKey: string, actor: ShipmentPlanningActor) {
    return this.manager.cancel(shipmentId, dto, idempotencyKey, actor);
  }
}
