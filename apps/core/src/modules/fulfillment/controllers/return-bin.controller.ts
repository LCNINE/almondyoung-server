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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
  RegisterReturnBinDto,
  ReturnBinContentsDto,
  ReturnBinDto,
  ReturnBinPutawayDto,
  ReturnBinPutawayResponseDto,
  ReturnBinRemovalDto,
  ReturnBinRemovalResponseDto,
} from '../dto/return-bin.dto';
import { BoxReturnService } from '../services/box-return.service';
import { ReturnBinService } from '../services/return-bin.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

/**
 * 되돌림 바구니(스펙 §8). `shipments/…` 경로도 이 컨트롤러가 갖는다(Task 8) — `ShipmentController` 의 `:id` 에
 * 가려지지 않게 모듈의 controllers 배열에서 그보다 먼저 등록한다.
 */
@ApiTags('Return bins')
@Controller()
@UseGuards(ScopeGuard)
export class ReturnBinController {
  constructor(
    private readonly returnBins: ReturnBinService,
    private readonly returns: BoxReturnService,
  ) {}

  @Post('return-bins')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: ReturnBinDto })
  register(@Body() dto: RegisterReturnBinDto, @User() user: AuthenticatedUser): Promise<ReturnBinDto> {
    return this.returnBins.register(dto, this.actor(user));
  }

  @Get('return-bins/:barcode')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: ReturnBinContentsDto })
  lookup(
    @Param('barcode') barcode: string,
    @Query('warehouseId', new ParseUUIDPipe()) warehouseId: string,
  ): Promise<ReturnBinContentsDto> {
    if (!barcode.trim()) throw new BadRequestException('barcode is required');
    return this.returnBins.lookup(barcode, warehouseId);
  }

  @Post('shipments/:shipmentId/return-bin-removals')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ReturnBinRemovalResponseDto })
  removeFromBox(
    @Param('shipmentId', new ParseUUIDPipe()) shipmentId: string,
    @Body() dto: ReturnBinRemovalDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<ReturnBinRemovalResponseDto> {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key is required');
    return this.returns.removeToReturnBin(shipmentId, dto, this.actor(user), idempotencyKey);
  }

  @Post('return-bins/:barcode/putaways')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ReturnBinPutawayResponseDto })
  putaway(
    @Param('barcode') barcode: string,
    @Body() dto: ReturnBinPutawayDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<ReturnBinPutawayResponseDto> {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key is required');
    return this.returnBins.putaway(barcode, dto, this.actor(user), idempotencyKey);
  }

  private actor(user: AuthenticatedUser): { id: string; roles: string[] } {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
