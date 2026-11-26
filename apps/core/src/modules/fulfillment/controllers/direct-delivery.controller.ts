import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OPEN_WITH_RECIPIENT, PiiResponse, RequirePermission, User } from '@app/authorization';
import {
  DirectDeliveryAwaitingDto,
  DirectDeliveryDispatchResultDto,
  DirectDeliveryPreviewDto,
  DirectDeliveryReturnDto,
  DirectDeliveryReturnResultDto,
  DirectDeliveryTakeoverDto,
  DirectDeliveryTakeoverResultDto,
  DirectDeliveryDispatchDto,
} from '../dto/one-order-direct.dto';
import type { ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { OneOrderDirectService } from '../supplier-shipment/one-order-direct/one-order-direct.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

const IDEMPOTENCY_HEADER = { name: 'Idempotency-Key', required: true } as const;

/** 한 주문만 공급처가 고객에게 바로 보낸다 — 맡기기·송장 입력·창고로 되돌리기. */
@ApiTags('Direct Ship')
@Controller('direct-delivery')
export class DirectDeliveryController {
  constructor(private readonly directDelivery: OneOrderDirectService) {}

  @PiiResponse({
    fields: {
      'recipient.name': 'name',
      'recipient.phone': 'phone',
      'recipient.address': 'address',
      'recipient.memo': 'text',
      'recipient.entrancePassword': 'secret',
    },
    subjects: [{ path: 'shipmentId', type: 'shipment' }],
    rawWithByField: {
      'recipient.name': OPEN_WITH_RECIPIENT,
      'recipient.phone': OPEN_WITH_RECIPIENT,
      'recipient.address': OPEN_WITH_RECIPIENT,
      'recipient.memo': OPEN_WITH_RECIPIENT,
      'recipient.entrancePassword': OPEN_WITH_RECIPIENT,
    },
  })
  @RequirePermission('fulfillment.order.read')
  @Get('shipments/:id')
  @ApiOperation({ summary: '공급처에 맡기기·창고로 되돌리기 전에 상자·공급처 후보·받는 분·막는 것을 본다' })
  @ApiOkResponse({ type: DirectDeliveryPreviewDto })
  preview(@Param('id', ParseUUIDPipe) shipmentId: string): Promise<DirectDeliveryPreviewDto> {
    return this.directDelivery.preview(shipmentId);
  }

  @RequirePermission('fulfillment.order.read')
  @Get('awaiting-tracking')
  @ApiOperation({ summary: '공급처에 맡겼지만 송장이 아직 없는 상자(그 창고 주문), 오래 기다린 것부터' })
  @ApiOkResponse({ type: DirectDeliveryAwaitingDto })
  awaitingTracking(@Query('warehouseId', ParseUUIDPipe) warehouseId: string): Promise<DirectDeliveryAwaitingDto> {
    return this.directDelivery.awaitingTracking(warehouseId);
  }

  @RequirePermission('fulfillment.order.write')
  @Post('shipments/:id/takeover')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: DirectDeliveryTakeoverResultDto })
  takeover(
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: DirectDeliveryTakeoverDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<DirectDeliveryTakeoverResultDto> {
    if ((dto.carrier === undefined) !== (dto.trackingNo === undefined)) {
      throw new BadRequestException('carrier and trackingNo go together');
    }
    return this.directDelivery.takeover(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.order.write')
  @Post('shipments/:id/dispatch')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: DirectDeliveryDispatchResultDto })
  dispatch(
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: DirectDeliveryDispatchDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<DirectDeliveryDispatchResultDto> {
    return this.directDelivery.dispatch(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.order.write')
  @Post('shipments/:id/return')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOkResponse({ type: DirectDeliveryReturnResultDto })
  returnToWarehouse(
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: DirectDeliveryReturnDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<DirectDeliveryReturnResultDto> {
    return this.directDelivery.returnToWarehouse(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  private actor(user: AuthenticatedUser | undefined): ShipmentPlanningActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
