import {
  Body,
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
  ClaimBatchWorkItemDto,
  CreateOutboundBatchV2Dto,
  CreateOutboundBatchV2ResponseDto,
  EligibleShipmentResponseDto,
  ExcludeShipmentFromBatchDto,
  HandoffBatchWorkItemDto,
  OutboundBatchActor,
  OutboundBatchCommandResponseDto,
  OutboundBatchV2DetailDto,
  OutboundBatchV2ListItemDto,
  OutboundBatchWorkItemResponseDto,
} from '../dto/outbound-batch-v2.dto';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

@Controller()
@UseGuards(ScopeGuard)
export class OutboundBatchV2Controller {
  constructor(private readonly batches: OutboundBatchOrchestrator) {}

  @Post('outbound-batches/v2')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: CreateOutboundBatchV2ResponseDto })
  create(
    @Body() dto: CreateOutboundBatchV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.createBatch(dto, idempotencyKey ?? '', this.actor(user));
  }

  @Get('outbound-batches/v2')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: [OutboundBatchV2ListItemDto] })
  list(@Query('warehouseId') warehouseId?: string, @Query('status') status?: string) {
    if (status && !['created', 'picking', 'completed', 'canceled'].includes(status)) {
      throw new BadRequestException(`Unsupported outbound batch status: ${status}`);
    }
    return this.batches.listBatches({ warehouseId, status });
  }

  @Post('outbound-batches/:batchId/shipments/:shipmentId')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  addShipment(
    @Param('batchId') batchId: string,
    @Param('shipmentId') shipmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.addShipment(batchId, shipmentId, idempotencyKey ?? '', this.actor(user));
  }

  @Delete('outbound-batches/:batchId/shipments/:shipmentId')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: OutboundBatchCommandResponseDto })
  excludeShipment(
    @Param('batchId') batchId: string,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ExcludeShipmentFromBatchDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.excludeShipment(batchId, shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post('batch-work-items/:workItemId/picker-claims')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  claimPicker(
    @Param('workItemId') workItemId: string,
    @Body() dto: ClaimBatchWorkItemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.claimPicker(workItemId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post('batch-work-items/:workItemId/packer-claims')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  claimPacker(
    @Param('workItemId') workItemId: string,
    @Body() dto: ClaimBatchWorkItemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.claimPacker(workItemId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post('batch-work-items/:workItemId/handoffs')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  handoff(
    @Param('workItemId') workItemId: string,
    @Body() dto: HandoffBatchWorkItemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    const actor = this.actor(user);
    if (dto.claimType === 'picker') {
      throw new ConflictException({
        code: 'PICKER_HANDOFF_REQUIRES_STRATEGY_CONTEXT',
        message: 'Picker handoff must use the picking strategy flow with plan and inventory-session custody context',
      });
    }
    return this.batches.handoff(workItemId, dto, idempotencyKey ?? '', actor);
  }

  @Get('outbound-batches/:batchId/eligible-shipments')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: [EligibleShipmentResponseDto] })
  eligibleShipments(@Param('batchId') batchId: string) {
    return this.batches.getEligibleShipments(batchId);
  }

  @Get('outbound-batches/:batchId/work-items')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: [OutboundBatchWorkItemResponseDto] })
  workItems(@Param('batchId') batchId: string) {
    return this.batches.getWorkItems(batchId);
  }

  @Get('outbound-batches/:batchId/v2')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: OutboundBatchV2DetailDto })
  detail(@Param('batchId') batchId: string) {
    return this.batches.getBatch(batchId);
  }

  private actor(user: AuthenticatedUser | undefined): OutboundBatchActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
