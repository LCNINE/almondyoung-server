import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WaybillService } from './waybill.service';
import {
  BatchResultItemDto,
  IssueBatchWaybillDto,
  IssueWaybillDto,
  RegisterManualWaybillDto,
  VoidWaybillDto,
  WaybillResponseDto,
  type WaybillActor,
} from './dto/waybill.dto';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

@Controller()
@UseGuards(ScopeGuard)
export class WaybillController {
  constructor(private readonly waybills: WaybillService) {}

  @Post('shipments/:shipmentId/waybills')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: WaybillResponseDto })
  issue(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: IssueWaybillDto,
    @Headers('idempotency-key') idem: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.waybills.issueForShipment(
      shipmentId,
      { carrier: dto.carrier, expectedManifestVersion: dto.expectedManifestVersion },
      idem ?? '',
      this.actor(user),
    );
  }

  @Post('shipments/:shipmentId/waybills/manual')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: WaybillResponseDto })
  manual(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: RegisterManualWaybillDto,
    @Headers('idempotency-key') idem: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.waybills.registerManual(shipmentId, dto, idem ?? '', this.actor(user));
  }

  @Post('waybills:batch')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: BatchResultItemDto, isArray: true })
  batch(
    @Body() dto: IssueBatchWaybillDto,
    @Headers('idempotency-key') idem: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.waybills.issueBatch(dto.shipmentIds, { carrier: dto.carrier }, idem ?? '', this.actor(user));
  }

  @Post('waybills/:waybillId/void')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)
  @ApiOkResponse({ type: WaybillResponseDto })
  void(
    @Param('waybillId') waybillId: string,
    @Body() dto: VoidWaybillDto,
    @Headers('idempotency-key') idem: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.waybills.void(waybillId, dto, idem ?? '', this.actor(user));
  }

  @Post('shipments/:shipmentId/waybills/reissue')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: WaybillResponseDto })
  reissue(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: IssueWaybillDto,
    @Headers('idempotency-key') idem: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.waybills.reissue(
      shipmentId,
      { carrier: dto.carrier, expectedManifestVersion: dto.expectedManifestVersion },
      idem ?? '',
      this.actor(user),
    );
  }

  @Get('shipments/:shipmentId/waybill')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: WaybillResponseDto })
  active(@Param('shipmentId') shipmentId: string) {
    return this.waybills.getActiveWaybill(shipmentId);
  }

  private actor(user: AuthenticatedUser | undefined): WaybillActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
