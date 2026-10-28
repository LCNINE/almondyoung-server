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
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { User, RequirePermission } from '@app/authorization';
import {
  ClaimBatchWorkItemDto,
  CreateOutboundBatchV2Dto,
  CreateOutboundBatchV2ResponseDto,
  EligibleShipmentResponseDto,
  ExcludeShipmentFromBatchDto,
  HandoffBatchWorkItemDto,
  JoinCandidateResponseDto,
  OutboundBatchActor,
  OutboundBatchCommandResponseDto,
  OutboundBatchV2DetailDto,
  OutboundBatchV2ListItemDto,
  OutboundBatchWorkItemResponseDto,
} from '../dto/outbound-batch-v2.dto';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

@Controller()
export class OutboundBatchV2Controller {
  constructor(private readonly batches: OutboundBatchOrchestrator) {}

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('outbound-batches/v2')
  @ApiCreatedResponse({ type: CreateOutboundBatchV2ResponseDto })
  create(
    @Body() dto: CreateOutboundBatchV2Dto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.createBatch(dto, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-batches/v2')
  @ApiOkResponse({ type: [OutboundBatchV2ListItemDto] })
  list(@Query('warehouseId') warehouseId?: string, @Query('status') status?: string) {
    if (status && !['created', 'picking', 'completed', 'canceled'].includes(status)) {
      throw new BadRequestException(`Unsupported outbound batch status: ${status}`);
    }
    return this.batches.listBatches({ warehouseId, status });
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('outbound-batches/:batchId/shipments/:shipmentId')
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  addShipment(
    @Param('batchId') batchId: string,
    @Param('shipmentId') shipmentId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.addShipment(batchId, shipmentId, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Delete('outbound-batches/:batchId/shipments/:shipmentId')
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

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('batch-work-items/:workItemId/picker-claims')
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  claimPicker(
    @Param('workItemId') workItemId: string,
    @Body() dto: ClaimBatchWorkItemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.claimPicker(workItemId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('batch-work-items/:workItemId/packer-claims')
  @ApiCreatedResponse({ type: OutboundBatchCommandResponseDto })
  claimPacker(
    @Param('workItemId') workItemId: string,
    @Body() dto: ClaimBatchWorkItemDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.batches.claimPacker(workItemId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post('batch-work-items/:workItemId/handoffs')
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

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-batches/:batchId/eligible-shipments')
  @ApiOkResponse({ type: [EligibleShipmentResponseDto] })
  eligibleShipments(@Param('batchId') batchId: string) {
    return this.batches.getEligibleShipments(batchId);
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-batches/:batchId/join-candidates')
  @ApiOkResponse({ type: [JoinCandidateResponseDto] })
  findJoinCandidates(@Param('batchId') batchId: string, @Query('code') code: string | undefined) {
    if (!code?.trim()) throw new BadRequestException('code is required');
    return this.batches.findJoinCandidates(batchId, code);
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-batches/:batchId/work-items')
  @ApiOkResponse({ type: [OutboundBatchWorkItemResponseDto] })
  workItems(@Param('batchId') batchId: string) {
    return this.batches.getWorkItems(batchId);
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get('outbound-batches/:batchId/v2')
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
