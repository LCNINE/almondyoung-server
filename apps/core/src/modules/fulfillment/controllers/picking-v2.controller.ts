import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
  AggregateBulkCartScanDto,
  AggregateCartHandoffDto,
  AggregateSortScanDto,
  CompletePickingV2Dto,
  HandoffPickingV2Dto,
  PlanPickingV2Dto,
  ScanPickingV2Dto,
  StartPickingV2Dto,
} from '../dto/picking-v2.dto';
import { PickingProcessService } from '../services/picking-process.service';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

@ApiTags('Picking V2')
@Controller('picking/v2/aggregate-then-sort')
@UseGuards(ScopeGuard)
export class PickingV2Controller {
  constructor(private readonly picking: PickingProcessService) {}

  @Post('bulk-cart-scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Source custody moved into the selected bulk cart' })
  bulkCartScan(
    @Body() dto: AggregateBulkCartScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.aggregateBulkCartScan({
      ...dto,
      strategy: 'aggregate_then_sort',
      stage: 'bulk_collect',
      actor: this.actor(user),
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  @Post('sort-scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Bulk-cart custody assigned to the requested shipment line destination' })
  sortScan(
    @Body() dto: AggregateSortScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.aggregateSortScan({
      ...dto,
      strategy: 'aggregate_then_sort',
      stage: 'sort',
      actor: this.actor(user),
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  @Post('cart-handoffs')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Pooled cart custody handed to the target worker through session events' })
  cartHandoff(
    @Body() dto: AggregateCartHandoffDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.aggregateCartHandoff({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  private actor(user: AuthenticatedUser | undefined) {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}

@ApiTags('Picking V2')
@Controller('picking/v2')
@UseGuards(ScopeGuard)
export class PickingCommandV2Controller {
  constructor(private readonly picking: PickingProcessService) {}

  @Post('plans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  plan(
    @Body() dto: PlanPickingV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.plan(dto.strategy, {
      batchId: dto.batchId,
      shipmentIds: dto.shipmentIds,
      actorId: this.actor(user).id,
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  @Post('starts')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  start(
    @Body() dto: StartPickingV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.start({
      ...dto,
      actorId: this.actor(user).id,
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  @Post('scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  scan(
    @Body() dto: ScanPickingV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.scan({
      ...dto,
      strategy: 'discrete',
      stage: 'source',
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  @Post('handoffs')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  handoff(
    @Body() dto: HandoffPickingV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.handoff({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  @Post('completions')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  complete(
    @Body() dto: CompletePickingV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.completePick({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  private actor(user: AuthenticatedUser | undefined) {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }

  private idempotencyKey(value: string | undefined): string {
    const valid =
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 200 &&
      [...value].every((character) => character.charCodeAt(0) >= 33 && character.charCodeAt(0) <= 126);
    if (!valid) throw new BadRequestException('A visible ASCII Idempotency-Key of at most 200 characters is required');
    return value;
  }
}
