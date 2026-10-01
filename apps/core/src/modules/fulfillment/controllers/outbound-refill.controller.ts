import { Controller, Get, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { RefillPendingBox, RefillPendingReader } from '../reader/refill-pending.reader';

/**
 * 스테이션 «보충 대기»(스펙 §7.3). `shipments` 아래에 두지 않는다 — 그 프리픽스엔 `:id` 라우트가 있어
 * 등록 순서에 기대야 한다(`simple-outbound.route-order.spec.ts`).
 */
@ApiTags('Outbound refills')
@Controller('outbound-refills')
@UseGuards(ScopeGuard)
export class OutboundRefillController {
  constructor(private readonly refills: RefillPendingReader) {}

  @Get('pending')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOperation({ summary: '결품을 다른 위치에서 채웠고 그 몫을 아직 안 집은 박스 (창고별)' })
  pending(@Query('warehouseId', new ParseUUIDPipe()) warehouseId: string): Promise<RefillPendingBox[]> {
    return this.refills.pending(warehouseId);
  }
}
