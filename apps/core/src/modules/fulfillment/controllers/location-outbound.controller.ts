import { unwrapPreparedOutbound } from './outbound-preparation-http';
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
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { adminForceDispatchDecisionFrom } from '../../../platform/auth/force-dispatch-authorization';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { PermissionCheckpoints, User, RequirePermission } from '@app/authorization';
import {
  LocationOutboundConfirmDto,
  LocationOutboundScanDto,
  StartLocationOutboundDto,
} from '../dto/location-outbound.dto';
import { LocationOutboundService } from '../services/location-outbound.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

@ApiTags('Shipments')
@Controller('shipments')
export class LocationOutboundController {
  constructor(
    private readonly outbound: LocationOutboundService,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':shipmentId/location-outbound-starts')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async start(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: StartLocationOutboundDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return unwrapPreparedOutbound(await this.outbound.start(shipmentId, dto, this.actor(user), this.key(key)));
  }

  @RequirePermission('fulfillment.shipment.read')
  @Get(':shipmentId/location-outbound-state')
  state(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Query() query: StartLocationOutboundDto,
    @User() user: AuthenticatedUser,
  ) {
    this.actor(user);
    return this.outbound.getState(shipmentId, query.warehouseId);
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':shipmentId/location-outbound-scans')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async scan(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: LocationOutboundScanDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return unwrapPreparedOutbound(await this.outbound.scan(shipmentId, dto, this.actor(user), this.key(key)));
  }

  @RequirePermission('fulfillment.dispatch.force')
  @Post(':shipmentId/location-outbound-forces')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async force(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: LocationOutboundConfirmDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
    @Req() request: unknown,
  ) {
    const authorization = adminForceDispatchDecisionFrom(request);
    // 판정 지점 집계만 남긴다 — 결과는 위 낙인을 받은 서비스가 정한다.
    this.checkpoints.checkRoute('fulfillment.force_dispatch_decision', request, ['fulfillment.dispatch.force']);
    return unwrapPreparedOutbound(
      await this.outbound.force(shipmentId, dto, this.actor(user), this.key(key), authorization),
    );
  }

  @RequirePermission('fulfillment.warehouse.operate')
  @Post(':shipmentId/location-outbound-force-resolutions')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  resolveForce(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: LocationOutboundConfirmDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.outbound.resolveForce(shipmentId, dto, this.actor(user), this.key(key));
  }

  private actor(user: AuthenticatedUser) {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: user?.roles ?? [] };
  }
  private key(value: string | undefined) {
    const key = value?.trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return key;
  }
}
