import { ConfigService } from '@nestjs/config';
import type { DbService } from '@app/db';
import type { Wired } from '../../../apps/core/src/modules/fulfillment/services/__support__/logistics-wiring';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { AuditService } from '../../../apps/core/src/modules/inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';
import { FULFILLMENT_SCOPES } from '../../../apps/core/src/platform/auth/fulfillment-scopes';

/**
 * ShipmentPlanningService 는 wireLogistics 의 Wired 밖이라 (다른 BC 조합에서는 안 쓰이는
 * 협력자라) 시드가 직접 조립한다. dev_core 리셋과 한진 검수 샘플(`seed-hanjin-samples.ts`)이
 * 같은 조립을 쓴다.
 */
export function buildShipmentPlanning(dbService: DbService<typeof wmsSchema>, wired: Wired): ShipmentPlanningService {
  return new ShipmentPlanningService(
    dbService,
    new FulfillmentCommandService(dbService),
    wired.shipmentReservations,
    new FulfillmentInvariantService(),
    new AuditService(dbService),
    // plan() 경로는 scope 를 보지 않지만 생성자가 요구한다. 시드 액터는 master 이므로
    // 전 scope 를 가진 stub 으로 채운다 (통합 스펙과 동일한 관용구).
    { getScopesByRoles: () => Promise.resolve(new Set(FULFILLMENT_SCOPES.map((scope) => scope.key))) } as never,
    new FulfillmentWorkflowGate(
      new ConfigService({
        FULFILLMENT_WORKFLOW_MODE: 'v2',
        FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
      }),
    ),
  );
}
