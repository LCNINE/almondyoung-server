import { Injectable } from '@nestjs/common';
import type {
  DirectDeliveryAwaitingDto,
  DirectDeliveryDispatchResultDto,
  DirectDeliveryPreviewDto,
  DirectDeliveryReturnDto,
  DirectDeliveryReturnResultDto,
  DirectDeliveryTakeoverDto,
  DirectDeliveryTakeoverResultDto,
  DirectDeliveryDispatchDto,
} from '../../dto/one-order-direct.dto';
import type { ShipmentPlanningActor } from '../../dto/shipment-planning.dto';
import { OneOrderDirectManager } from './one-order-direct.manager';
import { OneOrderDirectReader } from './one-order-direct.reader';

@Injectable()
export class OneOrderDirectService {
  constructor(
    private readonly reader: OneOrderDirectReader,
    private readonly manager: OneOrderDirectManager,
  ) {}

  preview(shipmentId: string): Promise<DirectDeliveryPreviewDto> {
    return this.reader.preview(shipmentId);
  }

  awaitingTracking(warehouseId: string): Promise<DirectDeliveryAwaitingDto> {
    return this.reader.awaitingTracking(warehouseId);
  }

  takeover(
    shipmentId: string,
    dto: DirectDeliveryTakeoverDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<DirectDeliveryTakeoverResultDto> {
    return this.manager.takeover(shipmentId, dto, idempotencyKey, actor);
  }

  dispatch(
    shipmentId: string,
    dto: DirectDeliveryDispatchDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<DirectDeliveryDispatchResultDto> {
    return this.manager.dispatch(shipmentId, dto, idempotencyKey, actor);
  }

  returnToWarehouse(
    shipmentId: string,
    dto: DirectDeliveryReturnDto,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
  ): Promise<DirectDeliveryReturnResultDto> {
    return this.manager.returnToWarehouse(shipmentId, dto, idempotencyKey, actor);
  }
}
