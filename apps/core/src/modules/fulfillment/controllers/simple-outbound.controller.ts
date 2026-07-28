import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { getScopeAuthorizationDecision, RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ForceSimpleOutboundDto, SimpleOutboundScanDto, SimpleOutboundStateDto } from '../dto/simple-outbound.dto';
import { ShipmentWaybillReader, ShipmentByWaybillResult } from '../reader/shipment-waybill.reader';
import { SimpleOutboundService } from '../services/simple-outbound.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] } | undefined;

/**
 * 단순출고 진입점 3종 — 운송장번호 조회, 스캔(피킹+검수+자동출고), 강제완료.
 * 라우트 순서 주의: `by-waybill` 이 `ShipmentController` 의 `:id` 라우트에 가려지지
 * 않도록 이 컨트롤러가 `fulfillment.module.ts` 의 `controllers` 배열에서
 * `ShipmentController` 보다 먼저 등록돼야 한다.
 */
@ApiTags('Shipments')
@Controller('shipments')
@UseGuards(ScopeGuard)
export class SimpleOutboundController {
  constructor(
    private readonly simpleOutbound: SimpleOutboundService,
    private readonly waybills: ShipmentWaybillReader,
  ) {}

  @Get('by-waybill')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '운송장번호로 박스와 라인 진행 조회 (단순출고 진입점)' })
  async byWaybill(@Query('trackingNo') trackingNo?: string): Promise<ShipmentByWaybillResult> {
    if (!trackingNo?.trim()) throw new BadRequestException('trackingNo is required');
    return this.waybills.byTrackingNo(trackingNo);
  }

  @Post(':shipmentId/simple-outbound-scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: '단순출고 스캔 — 피킹·검수·자동 출고를 한 트랜잭션에서 처리' })
  async scan(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: SimpleOutboundScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ): Promise<SimpleOutboundStateDto> {
    return this.simpleOutbound.scan(shipmentId, {
      barcode: dto.barcode,
      quantity: dto.quantity,
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
    });
  }

  @Post(':shipmentId/simple-outbound-forces')
  @RequireScopes(FULFILLMENT_SCOPE.DISPATCH_FORCE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: '단순출고 강제완료 — 미피킹 수량을 채우고 강제 출고' })
  async force(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ForceSimpleOutboundDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
    @Req() request: unknown,
  ): Promise<SimpleOutboundStateDto> {
    return this.simpleOutbound.forceComplete(shipmentId, {
      reason: dto.reason,
      csCaseId: dto.csCaseId,
      note: dto.note,
      actor: this.actor(user),
      idempotencyKey: this.idempotencyKey(idempotencyKey),
      authorization: getScopeAuthorizationDecision(request, FULFILLMENT_SCOPE.DISPATCH_FORCE),
    });
  }

  private actor(user: AuthenticatedUser) {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: user?.roles ?? [] };
  }

  private idempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    return key;
  }
}
