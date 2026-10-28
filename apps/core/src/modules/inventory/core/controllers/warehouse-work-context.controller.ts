import { Controller, Get, HttpCode } from '@nestjs/common';
import { PermissionCheckpoints, User, RequirePermission } from '@app/authorization';
import { authenticatedWarehouseActor, WarehouseActor } from '../services/warehouse-operation-contract';

@Controller('inventory')
export class WarehouseWorkContextController {
  constructor(private readonly checkpoints: PermissionCheckpoints) {}

  @RequirePermission('inventory.stock.read')
  @Get('work-context')
  workContext(@User() user: WarehouseActor & { roles?: string[] }) {
    const actorId = authenticatedWarehouseActor(user);
    const subject = { roles: user.roles ?? [] };
    const forceDispatch = this.checkpoints.check('inventory.work_context', subject, ['fulfillment.dispatch.force']);
    const stationForceDispatch = this.checkpoints.check('inventory.work_context', subject, [
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.station_force',
    ]);
    const shortPick = this.checkpoints.check('inventory.work_context', subject, [
      'fulfillment.shipment.reopen',
      'fulfillment.shipment.short_pick',
    ]);
    return {
      actorId,
      operationContractVersion: 2 as const,
      // 각 값은 그 라우트가 요구하는 권한과 같은 «하나라도» 집합이다 — 미리보기가 실제 판정과 어긋나면 버튼이 403 을 낸다.
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
  diagnosticsAccess(@User() user: WarehouseActor): void {
    authenticatedWarehouseActor(user);
  }
}
