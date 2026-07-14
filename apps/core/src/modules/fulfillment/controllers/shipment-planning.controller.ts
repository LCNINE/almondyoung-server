import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { ApiOkResponse } from '@nestjs/swagger';
import {
  CancelShipmentOutstandingDto,
  PlanShipmentDto,
  ReviseShipmentRecipientDto,
  ShipmentPlanningActor,
  ShipmentDetailResponseDto,
  SplitShipmentDto,
} from '../dto/shipment-planning.dto';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

@Controller('shipments')
@UseGuards(ScopeGuard)
export class ShipmentPlanningController {
  constructor(private readonly planning: ShipmentPlanningService) {}

  @Post(':id/splits')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  split(
    @Param('id') shipmentId: string,
    @Body() dto: SplitShipmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.split(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Patch(':id/recipient')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  reviseRecipient(
    @Param('id') shipmentId: string,
    @Body() dto: ReviseShipmentRecipientDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.reviseRecipient(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post(':id/plan')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  plan(
    @Param('id') shipmentId: string,
    @Body() dto: PlanShipmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.plan(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post(':id/cancellations')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  cancelOutstanding(
    @Param('id') shipmentId: string,
    @Body() dto: CancelShipmentOutstandingDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.planning.cancelOutstanding(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Get(':id')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
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
