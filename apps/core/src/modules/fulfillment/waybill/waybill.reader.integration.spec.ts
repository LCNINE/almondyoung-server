import { createCheckpointsForTesting } from '@app/authorization';
import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { makeDb, makeDbService, wireLogistics, type Wired } from '../services/__support__';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from '../services/shipment-planning.service';
import { seedPlannedShipmentForWaybill, type SeedDeps } from './__support__/waybill-fixtures';
import { WaybillReader } from './waybill.reader';
import { assembleBoxWithdrawal } from '../services/__support__/box-withdrawal-wiring';

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
      workflowGate,
      assembleBoxWithdrawal(svc),
      createCheckpointsForTesting(),
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
        expect(ctx.lines).toEqual([
          { productName: '아몬드유 30입', skuName: 'it-sku', quantity: 2, skuId: seed.skuId },
        ]);
        expect(reader.recipientHashOf(ctx.recipientSnapshot)).toHaveLength(64);
        throw new Error('rollback');
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'rollback') throw e;
      });
  });

  it('상자 배송 프로필의 보내는 분·출고지를 싣는다', async () => {
    await db
      .transaction(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx as never, deps);
        const [shipment] = await tx
          .select({ profileId: wmsTables.shipments.shippingProfileId })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, seed.shipmentId));
        await tx
          .update(wmsTables.deliveryProfiles)
          .set({
            originAddressSnapshot: {
              postalCode: '14521',
              roadAddress: '부천시 평천로832번길 42',
              detailAddress: '4층',
            },
          })
          .where(eq(wmsTables.deliveryProfiles.id, shipment.profileId as string));

        const ctx = await reader.loadIssueContext(tx as never, seed.shipmentId);
        expect(ctx.profileSender).toEqual({
          name: 'Sender',
          phone: '02-0000-0000',
          zip: '14521',
          baseAddress: '부천시 평천로832번길 42',
          detailAddress: '4층',
        });
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
  describe('loadSenderPreviewInputs — 발급이 볼 보내는 분 재료', () => {
    const rollback = (fn: (tx: DbTx) => Promise<void>) =>
      db
        .transaction(async (tx) => {
          await fn(tx as never);
          throw new Error('rollback');
        })
        .catch((e: unknown) => {
          if (!(e instanceof Error) || e.message !== 'rollback') throw e;
        });
    const newProfile = async (tx: DbTx, senderName: string) => {
      const [profile] = await tx
        .insert(wmsTables.deliveryProfiles)
        .values({
          name: `preview-profile-${randomUUID()}`,
          sourceType: 'in_house',
          senderSnapshot: { name: senderName, phone: '02-1111-1111' },
          originAddressSnapshot: { address: 'Origin' },
          returnAddressSnapshot: { address: 'Return' },
          carrierAccountRef: 'n/a',
          supportedFulfillmentModes: ['in_house'],
        })
        .returning();
      return profile.id;
    };

    it('확정된 상자는 상자의 배송 프로필을 읽는다', () =>
      rollback(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx, deps);
        const [input] = await reader.loadSenderPreviewInputs(tx, [seed.shipmentId]);
        expect(input).toMatchObject({ found: true, beforePlan: false, profileIncompatible: false });
        expect(input.profileSender?.name).toBe('Sender');
        expect('storedSender' in input).toBe(false);
      }));

    it('활성 송장이 있으면 그 행의 sender_snapshot 을 함께 준다', () =>
      rollback(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx, deps);
        const stored = { name: '이미 찍힌 이름', zip: '1', baseAddress: '주소', detailAddress: '', tel: '' };
        await tx.insert(wmsTables.waybills).values({
          shipmentId: seed.shipmentId,
          source: 'carrier',
          carrier: 'HANJIN',
          status: 'allocated',
          trackingNo: `T-${randomUUID().slice(0, 8)}`,
          manifestVersion: seed.manifestVersion,
          recipientHash: 'a'.repeat(64),
          senderSnapshot: stored,
        });
        const [input] = await reader.loadSenderPreviewInputs(tx, [seed.shipmentId]);
        expect(input.storedSender).toEqual(stored);
        expect(input).toMatchObject({ manualWaybill: false, activeStatus: 'allocated' });
      }));

    it('확정 전 상자는 확정(planMany)처럼 담긴 SKU 의 배송 프로필로 정한다', () =>
      rollback(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx, deps);
        const other = await newProfile(tx, '위탁업체');
        await tx
          .update(wmsTables.shipments)
          .set({ status: 'draft' })
          .where(eq(wmsTables.shipments.id, seed.shipmentId));
        await tx.update(wmsTables.skus).set({ deliveryProfileId: other }).where(eq(wmsTables.skus.id, seed.skuId));
        const [input] = await reader.loadSenderPreviewInputs(tx, [seed.shipmentId]);
        expect(input).toMatchObject({ beforePlan: true, profileIncompatible: false });
        expect(input.profileSender?.name).toBe('위탁업체');
      }));

    it('확정 전 상자의 SKU 에 배송 프로필이 없으면 확정이 막히는 상자로 본다', () =>
      rollback(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx, deps);
        await tx
          .update(wmsTables.shipments)
          .set({ status: 'draft' })
          .where(eq(wmsTables.shipments.id, seed.shipmentId));
        await tx.update(wmsTables.skus).set({ deliveryProfileId: null }).where(eq(wmsTables.skus.id, seed.skuId));
        const [input] = await reader.loadSenderPreviewInputs(tx, [seed.shipmentId]);
        expect(input).toMatchObject({ beforePlan: true, profileIncompatible: true, profileSender: null });
      }));

    it('없는 상자는 found=false 로 같은 순서에 둔다', () =>
      rollback(async (tx) => {
        const seed = await seedPlannedShipmentForWaybill(tx, deps);
        const missing = randomUUID();
        const inputs = await reader.loadSenderPreviewInputs(tx, [missing, seed.shipmentId]);
        expect(inputs.map((i) => [i.shipmentId, i.found])).toEqual([
          [missing, false],
          [seed.shipmentId, true],
        ]);
      }));
  });
});
