import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { RecallShipmentDispatchDto, ShipmentRecallActor, ShipmentRecallResponseDto } from '../dto/shipment-recall.dto';
import { ShipmentRecallService } from '../services/shipment-recall.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

@ApiTags('Shipment recall')
@Controller('shipments')
export class ShipmentRecallController {
  constructor(private readonly recall: ShipmentRecallService) {}

  @Post(':shipmentId/recalls')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_RECALL)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Recall one exact dispatch attempt after physical recovery' })
  @ApiParam({ name: 'shipmentId' })
  @ApiAcceptedResponse({ description: 'Durable shipment recall saga status', type: ShipmentRecallResponseDto })
  report(
    @Param('shipmentId', new ParseUUIDPipe()) shipmentId: string,
    @Body() dto: RecallShipmentDispatchDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user?: AuthenticatedUser,
  ): Promise<ShipmentRecallResponseDto> {
    return this.recall.report(
      shipmentId,
      dto.dispatchAttemptId,
      dto,
      this.requiredIdempotencyKey(idempotencyKey),
      this.actor(user),
    );
  }

  private actor(user?: AuthenticatedUser): ShipmentRecallActor {
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

@ApiTags('Shipment recall')
@Controller('shipment-recall-operations')
export class ShipmentRecallOperationController {
  constructor(private readonly recall: ShipmentRecallService) {}

  @Get(':operationId')
  @UseGuards(ScopeGuard)
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_RECALL)
  @ApiOperation({ summary: 'Read a durable shipment recall saga status' })
  @ApiParam({ name: 'operationId' })
  @ApiOkResponse({ description: 'Durable shipment recall saga status', type: ShipmentRecallResponseDto })
  get(@Param('operationId', new ParseUUIDPipe()) operationId: string): Promise<ShipmentRecallResponseDto> {
    return this.recall.getOperation(operationId);
  }
}
