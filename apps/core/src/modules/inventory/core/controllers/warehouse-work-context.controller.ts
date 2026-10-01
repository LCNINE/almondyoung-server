import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../../platform/auth/fulfillment-scopes';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { authenticatedWarehouseActor, WarehouseActor } from '../services/warehouse-operation-contract';

@Controller('inventory')
@UseGuards(ScopeGuard)
export class WarehouseWorkContextController {
  constructor(private readonly scopes: ScopeGuard) {}

  @Get('work-context')
  @RequireScopes(INVENTORY_SCOPE.OPERATE)
  async workContext(@User() user: WarehouseActor & { roles?: string[] }) {
    const actorId = authenticatedWarehouseActor(user);
    const granted = new Set(
      await this.scopes.getGrantedScopes(user, [
        FULFILLMENT_SCOPE.DISPATCH_FORCE,
        FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE,
        FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
        FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK,
      ]),
    );
    return {
      actorId,
      operationContractVersion: 2 as const,
      // 각 값은 그 라우트의 @RequireScopes 와 같은 «하나라도» 집합이다 — 미리보기가 실제 가드와 어긋나면 버튼이 403 을 낸다.
      permissions: {
        // 위치 확인 출고 강제(location-outbound-forces)·관리자 강제 발송 — dispatch.force 전용. 뜻을 바꾸지 않는다(배포된 앱이 쓴다)
        forceDispatch: granted.has(FULFILLMENT_SCOPE.DISPATCH_FORCE),
        // 단순출고 강제완료(simple-outbound-forces) — 스테이션 F10
        stationForceDispatch:
          granted.has(FULFILLMENT_SCOPE.DISPATCH_FORCE) || granted.has(FULFILLMENT_SCOPE.DISPATCH_STATION_FORCE),
        // 결품 보고(short-picks) — 스테이션 F9
        shortPick: granted.has(FULFILLMENT_SCOPE.SHIPMENT_REOPEN) || granted.has(FULFILLMENT_SCOPE.SHIPMENT_SHORT_PICK),
      },
      capabilities: {
        stocktakingAddCountItem: true as const,
        locationOutbound: true as const,
        inboundWorkflowConsistency: true as const,
      },
    };
  }

  @Get('diagnostics-access')
  @HttpCode(204)
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  diagnosticsAccess(@User() user: WarehouseActor): void {
    authenticatedWarehouseActor(user);
  }
}
