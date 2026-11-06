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
import { RequirePermission, User } from '@app/authorization';
import {
  BulkShipmentIdsDto,
  OutboundPreparationQueryDto,
  OutboundPreparationSummaryDto,
} from '../dto/outbound-preparation.dto';
import { BulkShipmentResult } from './bulk-shipment-result';
import { OutboundPreparationService } from './outbound-preparation.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

@Controller()
export class OutboundPreparationController {
  constructor(private readonly service: OutboundPreparationService) {}

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-preparation')
  summarize(@Query() query: OutboundPreparationQueryDto): Promise<OutboundPreparationSummaryDto> {
    return this.service.summarize(query.warehouseId);
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('outbound-preparation/plans')
  planMany(
    @Body() dto: BulkShipmentIdsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<BulkShipmentResult> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key 헤더가 필요해요',
      });
    }

    const id = user?.userId ?? user?.id ?? user?.sub;

    if (!id) {
      throw new UnauthorizedException('로그인이 필요해요');
    }

    return this.service.planMany(dto.shipmentIds, idempotencyKey, {
      id,
      roles: Array.isArray(user?.roles) ? user.roles : [],
    });
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('outbound-preparation/batches/:batchId/shipments')
  addManyToBatch(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Body() dto: BulkShipmentIdsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<BulkShipmentResult> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key 헤더가 필요해요',
      });
    }

    const id = user?.userId ?? user?.id ?? user?.sub;

    if (!id) {
      throw new UnauthorizedException('로그인이 필요해요');
    }

    return this.service.addManyToBatch(batchId, dto.shipmentIds, idempotencyKey, {
      id,
      roles: Array.isArray(user?.roles) ? user.roles : [],
    });
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('outbound-preparation/unreserved-splits')
  splitManyUnreserved(
    @Body() dto: BulkShipmentIdsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<BulkShipmentResult> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException({
        code: 'FULFILLMENT_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key 헤더가 필요해요',
      });
    }

    const id = user?.userId ?? user?.id ?? user?.sub;

    if (!id) {
      throw new UnauthorizedException('로그인이 필요해요');
    }

    return this.service.splitManyUnreserved(dto.shipmentIds, idempotencyKey, {
      id,
      roles: Array.isArray(user?.roles) ? user.roles : [],
    });
  }
}
