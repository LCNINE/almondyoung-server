import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { adminForceDispatchDecisionFrom } from '../../../platform/auth/force-dispatch-authorization';
import { ApiCreatedResponse, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { User, RequirePermission, PermissionCheckpoints, type PermissionDecision } from '@app/authorization';
import {
  ForceShipmentDispatchDto,
  ShipmentDispatchActor,
  ShipmentInspectionScanDto,
} from '../dto/shipment-dispatch.dto';
import { ShipmentDispatchService } from '../services/shipment-dispatch.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

interface ShipmentDispatchCommandAdapter {
  inspectionScan(
    shipmentId: string,
    input: ShipmentInspectionScanDto & { actor: ShipmentDispatchActor; idempotencyKey: string },
  ): Promise<unknown>;
  forceDispatch(
    shipmentId: string,
    input: ForceShipmentDispatchDto & {
      actor: ShipmentDispatchActor;
      idempotencyKey: string;
      authorization: PermissionDecision | undefined;
    },
  ): Promise<unknown>;
}

/**
 * 박스(shipment) 작업자 동작 진입점 — V2 검수 스캔과 강제 dispatch.
 * V1 라우트(scan/inspect-scan/force)는 V1 출고 경로와 함께 Task 25 에서 제거됐다.
 */
@ApiTags('Shipments')
@Controller('shipments')
export class ShipmentController {
  constructor(
    private readonly workflowGate: FulfillmentWorkflowGate,
    @Inject(ShipmentDispatchService)
    private readonly shipmentDispatch: ShipmentDispatchCommandAdapter,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':id/inspection-scans')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Shipment inspection progress or the atomically-created dispatch attempt' })
  @ApiOperation({ summary: 'V2 shipment inspection scan' })
  @ApiParam({ name: 'id', description: 'Shipment ID' })
  inspectionScan(
    @Param('id') id: string,
    @Body() dto: ShipmentInspectionScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user?: AuthenticatedUser,
  ) {
    this.workflowGate.assertV2MutationAllowed('shipment.inspection.scan');
    return this.shipmentDispatch.inspectionScan(id, {
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
    });
  }

  @RequirePermission('fulfillment.dispatch.force')
  @Post(':id/force-dispatch')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Forced shipment dispatch attempt' })
  @ApiOperation({ summary: 'Force a V2 shipment dispatch with durable reason evidence' })
  @ApiParam({ name: 'id', description: 'Shipment ID' })
  forceDispatch(
    @Param('id') id: string,
    @Body() dto: ForceShipmentDispatchDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user?: AuthenticatedUser,
    @Req() request?: unknown,
  ) {
    this.workflowGate.assertV2MutationAllowed('shipment.dispatch.force');
    const authorization = adminForceDispatchDecisionFrom(request);
    // 판정 지점 집계만 남긴다 — 결과는 위 낙인을 받은 서비스가 정한다.
    this.checkpoints.checkRoute('fulfillment.force_dispatch_decision', request, ['fulfillment.dispatch.force']);
    return this.shipmentDispatch.forceDispatch(id, {
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
      authorization,
    });
  }

  private actor(user?: AuthenticatedUser): ShipmentDispatchActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }

  private requiredIdempotencyKey(value: string | undefined): string {
    const isVisibleAscii =
      typeof value === 'string' &&
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 33 && code <= 126;
      });
    if (!value || value.length > 200 || !isVisibleAscii) {
      throw new BadRequestException('A visible ASCII Idempotency-Key of at most 200 characters is required');
    }
    return value;
  }
}
