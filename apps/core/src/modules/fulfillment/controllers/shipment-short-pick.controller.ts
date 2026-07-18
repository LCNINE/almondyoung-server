import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ReportShipmentShortPickDto, ShipmentShortPickActor } from '../dto/shipment-short-pick.dto';
import { ShipmentShortPickService } from '../services/shipment-short-pick.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

@ApiTags('Shipment short pick')
@Controller('shipments')
export class ShipmentShortPickController {
  constructor(private readonly shortPick: ShipmentShortPickService) {}

  @Post(':shipmentId/short-picks')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Isolate and recover an exact V2 shipment short pick' })
  @ApiParam({ name: 'shipmentId', description: 'Shipment ID' })
  @ApiCreatedResponse({ description: 'Durable short-pick saga status' })
  report(
    @Param('shipmentId', new ParseUUIDPipe()) shipmentId: string,
    @Body() dto: ReportShipmentShortPickDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user?: AuthenticatedUser,
  ) {
    return this.shortPick.report(shipmentId, dto, this.requiredIdempotencyKey(idempotencyKey), this.actor(user));
  }

  private actor(user?: AuthenticatedUser): ShipmentShortPickActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }

  private requiredIdempotencyKey(value: string | undefined): string {
    const visibleAscii =
      typeof value === 'string' &&
      value.length <= 200 &&
      [...value].every((character) => character.charCodeAt(0) >= 33 && character.charCodeAt(0) <= 126);
    if (!value || !visibleAscii) {
      throw new BadRequestException('A visible ASCII Idempotency-Key of at most 200 characters is required');
    }
    return value;
  }
}
