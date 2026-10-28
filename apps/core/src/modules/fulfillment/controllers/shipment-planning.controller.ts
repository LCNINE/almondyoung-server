import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { User, RequirePermission, PiiResponse, PiiWrite, OPEN_WITH_RECIPIENT } from '@app/authorization';
import { ApiOkResponse } from '@nestjs/swagger';
import {
  PlanShipmentDto,
  ReviseShipmentRecipientDto,
  ShipmentPlanningActor,
  ShipmentDetailResponseDto,
  FulfillmentOperationResponseDto,
  SplitShipmentDto,
  SplitUnreservedShipmentDto,
} from '../dto/shipment-planning.dto';
import { ShipmentPlanningService } from '../services/shipment-planning.service';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

@Controller('shipments')
export class ShipmentPlanningController {
  constructor(private readonly planning: ShipmentPlanningService) {}

  @PiiResponse({
    fields: {
      'shipment.recipientSnapshot.recipientName': 'name',
      'shipment.recipientSnapshot.phone': 'phone',
      'shipment.recipientSnapshot.postalCode': 'postal',
      'shipment.recipientSnapshot.roadAddress': 'address',
      'shipment.recipientSnapshot.detailAddress': 'text',
      'shipment.recipientSnapshot.deliveryNote': 'text',
      'shipment.recipientSnapshot.personalCustomsCode': 'secret',
    },
    subjects: [
      { param: 'id', type: 'shipment' },
    ],
    rawWithByField: {
      'shipment.recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':id/splits')
  split(
    @Param('id') shipmentId: string,
    @Body() dto: SplitShipmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.split(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @PiiResponse({
    fields: {
      'shipment.recipientSnapshot.recipientName': 'name',
      'shipment.recipientSnapshot.phone': 'phone',
      'shipment.recipientSnapshot.postalCode': 'postal',
      'shipment.recipientSnapshot.roadAddress': 'address',
      'shipment.recipientSnapshot.detailAddress': 'text',
      'shipment.recipientSnapshot.deliveryNote': 'text',
      'shipment.recipientSnapshot.personalCustomsCode': 'secret',
    },
    subjects: [
      { param: 'id', type: 'shipment' },
    ],
    rawWithByField: {
      'shipment.recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':id/split-unreserved')
  splitUnreserved(
    @Param('id') shipmentId: string,
    @Body() dto: SplitUnreservedShipmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.splitUnreserved(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @PiiResponse({
    fields: {
      'shipment.recipientSnapshot.recipientName': 'name',
      'shipment.recipientSnapshot.phone': 'phone',
      'shipment.recipientSnapshot.postalCode': 'postal',
      'shipment.recipientSnapshot.roadAddress': 'address',
      'shipment.recipientSnapshot.detailAddress': 'text',
      'shipment.recipientSnapshot.deliveryNote': 'text',
      'shipment.recipientSnapshot.personalCustomsCode': 'secret',
    },
    subjects: [
      { param: 'id', type: 'shipment' },
    ],
    rawWithByField: {
      'shipment.recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @PiiWrite({ fields: ['recipientSnapshot', 'entrancePassword'], rawWith: OPEN_WITH_RECIPIENT })
  @RequirePermission('fulfillment.shipment.override_recipient')
  @Patch(':id/recipient')
  reviseRecipient(
    @Param('id') shipmentId: string,
    @Body() dto: ReviseShipmentRecipientDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.reviseRecipient(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @PiiResponse({
    fields: {
      'shipment.recipientSnapshot.recipientName': 'name',
      'shipment.recipientSnapshot.phone': 'phone',
      'shipment.recipientSnapshot.postalCode': 'postal',
      'shipment.recipientSnapshot.roadAddress': 'address',
      'shipment.recipientSnapshot.detailAddress': 'text',
      'shipment.recipientSnapshot.deliveryNote': 'text',
      'shipment.recipientSnapshot.personalCustomsCode': 'secret',
    },
    subjects: [
      { param: 'id', type: 'shipment' },
    ],
    rawWithByField: {
      'shipment.recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'shipment.recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':id/plan')
  plan(
    @Param('id') shipmentId: string,
    @Body() dto: PlanShipmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.plan(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @PiiResponse({
    fields: {
      'recipientSnapshot.recipientName': 'name',
      'recipientSnapshot.phone': 'phone',
      'recipientSnapshot.postalCode': 'postal',
      'recipientSnapshot.roadAddress': 'address',
      'recipientSnapshot.detailAddress': 'text',
      'recipientSnapshot.deliveryNote': 'text',
      'recipientSnapshot.personalCustomsCode': 'secret',
      'entrancePassword': 'secret',
    },
    subjects: [
      { path: 'id', type: 'shipment' },
    ],
    reveal: true,
    rawWithByField: {
      'recipientSnapshot.recipientName': OPEN_WITH_RECIPIENT,
      'recipientSnapshot.phone': OPEN_WITH_RECIPIENT,
      'recipientSnapshot.postalCode': OPEN_WITH_RECIPIENT,
      'recipientSnapshot.roadAddress': OPEN_WITH_RECIPIENT,
      'recipientSnapshot.detailAddress': OPEN_WITH_RECIPIENT,
      'recipientSnapshot.deliveryNote': OPEN_WITH_RECIPIENT,
      'recipientSnapshot.personalCustomsCode': OPEN_WITH_RECIPIENT,
      'entrancePassword': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.shipment.read')
  @Get(':id')
  @ApiOkResponse({ type: ShipmentDetailResponseDto })
  detail(@Param('id') shipmentId: string): Promise<ShipmentDetailResponseDto> {
    return this.planning.getShipmentDetail(shipmentId);
  }

  private actor(user: AuthenticatedUser | undefined): ShipmentPlanningActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}

@Controller('fulfillment-operations')
export class FulfillmentOperationController {
  constructor(private readonly planning: ShipmentPlanningService) {}

  @PiiResponse({
    fields: {
      'responseSnapshot': 'redact',
    },
    subjects: [
      { param: 'operationId', type: 'fulfillment_operation' },
    ],
    rawWithByField: {
      'responseSnapshot': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.shipment.read')
  @Get(':operationId')
  @ApiOkResponse({ type: FulfillmentOperationResponseDto })
  get(@Param('operationId') operationId: string): Promise<FulfillmentOperationResponseDto> {
    return this.planning.getOperation(operationId);
  }
}
