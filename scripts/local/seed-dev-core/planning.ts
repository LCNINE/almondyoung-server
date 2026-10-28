import { createCheckpointsForTesting } from '@app/authorization';
import { ConfigService } from '@nestjs/config';
import type { DbService } from '@app/db';
import type { Wired } from '../../../apps/core/src/modules/fulfillment/services/__support__/logistics-wiring';
import { assembleBoxWithdrawal } from '../../../apps/core/src/modules/fulfillment/services/__support__/box-withdrawal-wiring';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { AuditService } from '../../../apps/core/src/modules/inventory/shared/services/audit.service';
import { FulfillmentCommandService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../../apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../../../apps/core/src/modules/fulfillment/services/shipment-planning.service';

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
    new FulfillmentWorkflowGate(
      new ConfigService({
        FULFILLMENT_WORKFLOW_MODE: 'v2',
        FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z',
      }),
    ),
    // 전체 취소 연결(E10)의 협력자 — plan() 경로는 부르지 않지만 생성자가 요구한다.
    assembleBoxWithdrawal(dbService),
    createCheckpointsForTesting(),
  );
}
