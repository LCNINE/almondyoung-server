import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import {
  SetStockPriorityDto,
  StockPriorityCancelResultDto,
  StockPriorityPreviewDto,
  StockPriorityResultDto,
} from '../dto/stock-priority.dto';
import { ShipmentCommandReasonDto, ShipmentPlanningActor } from '../dto/shipment-planning.dto';
import { StockPriorityService } from '../stock-priority/stock-priority.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

@ApiTags('Outbound')
@Controller('shipments')
export class StockPriorityController {
  constructor(private readonly stockPriority: StockPriorityService) {}

  @RequirePermission('fulfillment.shipment.read')
  @Get(':id/stock-priority')
  @ApiOperation({ summary: '우선할당 미리보기 — 어느 주문에서 몇 개를 가져오고 얼마나 모자라는지' })
  @ApiOkResponse({ type: StockPriorityPreviewDto })
  preview(@Param('id', ParseUUIDPipe) shipmentId: string): Promise<StockPriorityPreviewDto> {
    return this.stockPriority.preview(shipmentId);
  }

  @RequirePermission('fulfillment.reservation.transfer')
  @Post(':id/stock-priority')
  @ApiOkResponse({ type: StockPriorityResultDto })
  prioritize(
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: SetStockPriorityDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<StockPriorityResultDto> {
    return this.stockPriority.prioritize(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.reservation.transfer')
  @Post(':id/stock-priority/cancel')
  @ApiOkResponse({ type: StockPriorityCancelResultDto })
  cancel(
    @Param('id', ParseUUIDPipe) shipmentId: string,
    @Body() dto: ShipmentCommandReasonDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<StockPriorityCancelResultDto> {
    return this.stockPriority.cancel(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  private actor(user: AuthenticatedUser | undefined): ShipmentPlanningActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
