import { Controller, Get, HttpCode, Inject, UseGuards } from '@nestjs/common';
import { PermissionCheckpoints, RequireScopes, ScopeGuard, User, RequirePermission } from '@app/authorization';
import {
  FULFILLMENT_SCOPE,
  SHORT_PICK_REPORT_SCOPES,
  SIMPLE_OUTBOUND_FORCE_SCOPES,
} from '../../../../platform/auth/fulfillment-scopes';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { authenticatedWarehouseActor, WarehouseActor } from '../services/warehouse-operation-contract';

@Controller('inventory')
@UseGuards(ScopeGuard)
export class WarehouseWorkContextController {
  constructor(
    @Inject(ScopeGuard) private readonly scopes: Pick<ScopeGuard, 'getGrantedScopes'>,
    private readonly checkpoints: PermissionCheckpoints,
  ) {}

  @RequirePermission('inventory.stock.read')
  @Get('work-context')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  async workContext(@User() user: WarehouseActor & { roles?: string[] }) {
    const actorId = authenticatedWarehouseActor(user);
    const granted = new Set(
      await this.scopes.getGrantedScopes(user, [...SIMPLE_OUTBOUND_FORCE_SCOPES, ...SHORT_PICK_REPORT_SCOPES]),
    );
    // 미리보기 값은 옛 판정 그대로 — 권한 판정은 나란히 비교만 한다.
    const subject = { roles: user.roles ?? [] };
    const forceDispatch = this.checkpoints.compare(
      'inventory.work_context',
      granted.has(FULFILLMENT_SCOPE.DISPATCH_FORCE),
      subject,
      ['fulfillment.dispatch.force'],
    );
    const stationForceDispatch = this.checkpoints.compare(
      'inventory.work_context',
      SIMPLE_OUTBOUND_FORCE_SCOPES.some((scope) => granted.has(scope)),
      subject,
      ['fulfillment.dispatch.force', 'fulfillment.dispatch.station_force'],
    );
    const shortPick = this.checkpoints.compare(
      'inventory.work_context',
      SHORT_PICK_REPORT_SCOPES.some((scope) => granted.has(scope)),
      subject,
      ['fulfillment.shipment.reopen', 'fulfillment.shipment.short_pick'],
    );
    return {
      actorId,
      operationContractVersion: 2 as const,
      // 각 값은 그 라우트의 @RequireScopes 와 같은 «하나라도» 집합이다 — 미리보기가 실제 가드와 어긋나면 버튼이 403 을 낸다.
      permissions: {
        // 위치 확인 출고 강제(location-outbound-forces)·관리자 강제 발송 — dispatch.force 전용. 뜻을 바꾸지 않는다(배포된 앱이 쓴다)
        forceDispatch,
        // 단순출고 강제완료(simple-outbound-forces) — 스테이션 F10
        stationForceDispatch,
        // 결품 보고(short-picks) — 스테이션 F9
        shortPick,
      },
      capabilities: {
        stocktakingAddCountItem: true as const,
        locationOutbound: true as const,
        inboundWorkflowConsistency: true as const,
      },
    };
  }

  @RequirePermission('inventory.master.read')
  @Get('diagnostics-access')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  diagnosticsAccess(@User() user: WarehouseActor): void {
    authenticatedWarehouseActor(user);
  }
}
