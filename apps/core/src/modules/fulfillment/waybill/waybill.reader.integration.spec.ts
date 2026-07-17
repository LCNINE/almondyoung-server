import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { makeDb, makeDbService, wireLogistics, type Wired } from '../services/__support__';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { seedPlannedShipmentForWaybill, type SeedDeps } from './__support__/waybill-fixtures';
import { WaybillReader } from './waybill.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: WaybillReader;
  let deps: SeedDeps;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const svc = makeDbService(db);
    wired = wireLogistics(svc, 'v2');
    reader = new WaybillReader(svc);
    // Wired 는 planning 을 노출하지 않는다(logistics-wiring.ts 확인됨) — invoice-orchestrator.integration.spec.ts 의
    // services() 헬퍼와 동일하게 ShipmentPlanningService 를 별도로 조립해 deps.plan 에 연결한다.
    const workflowGate = new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
    );
    const commands = new FulfillmentCommandService(svc);
    const invariant = new FulfillmentInvariantService();
    const planning = new ShipmentPlanningService(
      svc,
      commands,
      wired.shipmentReservations,
      invariant,
      new AuditService(svc),
      { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
      workflowGate,
    );
    deps = {
      fulfillments: wired.fulfillments,
      plan: (
        id: string,
        opts: { shippingProfileId: string; expectedManifestVersion: number; expectedReservationVersion: number },
        idem: string,
        actor: { id: string; roles: string[] },
        tx: DbTx,
      ) => planning.plan(id, opts, idem, actor, tx),
    } as unknown as SeedDeps;
  });
  afterAll(async () => {
    await client.end();
  });

  it('loadIssueContext returns manifest lines + recipient snapshot for a planned shipment', async () => {
    await db
      .transaction(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx as never, deps);
        const ctx = await reader.loadIssueContext(tx as never, seed.shipmentId);
        expect(ctx.status).toBe('planned');
        expect(ctx.manifestVersion).toBe(seed.manifestVersion);
        expect(ctx.lines).toEqual([{ productName: '아몬드유 30입', quantity: 2, skuId: seed.skuId }]);
        expect(reader.recipientHashOf(ctx.recipientSnapshot)).toHaveLength(64);
        throw new Error('rollback');
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'rollback') throw e;
      });
  });

  it('getActiveWaybill returns undefined when none', async () => {
    await db
      .transaction(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx as never, deps);
        expect(await reader.getActiveWaybill(tx as never, seed.shipmentId)).toBeUndefined();
        throw new Error('rollback');
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'rollback') throw e;
      });
  });
});
