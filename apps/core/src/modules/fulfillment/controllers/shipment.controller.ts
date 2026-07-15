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
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  getScopeAuthorizationDecision,
  RequireScopes,
  RolesGuard,
  ScopeAuthorizationDecision,
  ScopeGuard,
  User,
} from '@app/authorization';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
  ForceShipmentDispatchDto,
  ShipmentDispatchActor,
  ShipmentInspectionScanDto,
} from '../dto/shipment-dispatch.dto';
import { ShipmentDispatchService } from '../services/shipment-dispatch.service';
import { ShipmentService } from '../services/shipment.service';
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
      authorization: ScopeAuthorizationDecision | undefined;
    },
  ): Promise<unknown>;
}

const ScanSchema = z.object({ trackingNo: z.string().min(1) });
const InspectScanSchema = z.object({ barcode: z.string().min(1), quantity: z.number().int().positive().optional() });
const ForceSchema = z.object({ foiId: z.string().uuid().optional() });

/**
 * 박스(shipment) 작업자 동작 진입점 (Cluster A, EU3/EU5).
 * - POST /shipments/scan            송장 스캔으로 박스 lazy open
 * - POST /shipments/:id/inspect-scan 박스 라인 검수 스캔(전 라인 완료 시 consumeShipment 자동발사)
 * - POST /shipments/:id/force        강제출고(자동완료 override)
 */
@ApiTags('Shipments')
@Controller('shipments')
export class ShipmentController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    @Inject(ShipmentDispatchService)
    private readonly shipmentDispatch: ShipmentDispatchCommandAdapter,
  ) {}

  @Post(':id/inspection-scans')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
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

  @Post(':id/force-dispatch')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_FORCE)
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
    return this.shipmentDispatch.forceDispatch(id, {
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
      authorization: getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_FORCE),
    });
  }

  @Post('scan')
  @ApiOperation({ summary: '송장 스캔으로 박스 open' })
  async scan(
    @Body(new ZodValidationPipe(ScanSchema)) dto: z.infer<typeof ScanSchema>,
    @User() user?: AuthenticatedUser,
  ) {
    this.workflowGate.assertMutationAllowed('shipment.open');
    return this.shipments.openBoxByScan(dto.trackingNo, this.userId(user));
  }

  @Post(':id/inspect-scan')
  @ApiOperation({ summary: '박스 라인 검수 스캔' })
  @ApiParam({ name: 'id', description: '박스(shipment) ID' })
  async inspect(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InspectScanSchema)) dto: z.infer<typeof InspectScanSchema>,
    @User() user?: AuthenticatedUser,
  ) {
    this.workflowGate.assertMutationAllowed('shipment.inspect');
    await this.shipments.inspectScan(id, dto.barcode, dto.quantity ?? 1, this.userId(user));
    return { ok: true };
  }

  @Post(':id/force')
  @UseGuards(RolesGuard('master', 'admin'))
  @ApiOperation({ summary: '강제출고 (자동완료 override)' })
  @ApiParam({ name: 'id', description: '박스(shipment) ID' })
  async force(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ForceSchema)) dto: z.infer<typeof ForceSchema>,
    @User() user?: AuthenticatedUser,
  ) {
    this.workflowGate.assertMutationAllowed('shipment.force');
    await this.shipments.forceShipment(id, dto.foiId, this.userId(user));
    return { ok: true };
  }

  private userId(user?: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
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
