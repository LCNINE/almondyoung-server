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
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { getScopeAuthorizationDecision, RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
  LocationOutboundConfirmDto,
  LocationOutboundScanDto,
  StartLocationOutboundDto,
} from '../dto/location-outbound.dto';
import { LocationOutboundService } from '../services/location-outbound.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

@ApiTags('Shipments')
@Controller('shipments')
@UseGuards(ScopeGuard)
export class LocationOutboundController {
  constructor(private readonly outbound: LocationOutboundService) {}

  @Post(':shipmentId/location-outbound-starts')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  start(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: StartLocationOutboundDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.outbound.start(shipmentId, dto, this.actor(user), this.key(key));
  }

  @Get(':shipmentId/location-outbound-state')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  state(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Query() query: StartLocationOutboundDto,
    @User() user: AuthenticatedUser,
  ) {
    this.actor(user);
    return this.outbound.getState(shipmentId, query.warehouseId);
  }

  @Post(':shipmentId/location-outbound-scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  scan(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: LocationOutboundScanDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.outbound.scan(shipmentId, dto, this.actor(user), this.key(key));
  }

  @Post(':shipmentId/location-outbound-forces')
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_FORCE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  force(
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: LocationOutboundConfirmDto,
    @Headers('idempotency-key') key: string | undefined,
    @User() user: AuthenticatedUser,
    @Req() request: unknown,
  ) {
    return this.outbound.force(
      shipmentId,
      dto,
      this.actor(user),
      this.key(key),
      getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_FORCE),
    );
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
