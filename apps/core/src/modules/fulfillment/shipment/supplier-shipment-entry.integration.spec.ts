import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  receiveStock,
  seedHolder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../services/__support__';
import {
  seedBox,
  seedDirectSupplier,
  seedFo,
  seedOrder,
  World,
} from '../order-progress/__support__/order-progress.fixtures';
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import { CarrierTrackingPoller } from '../services/carrier-tracking.poller';
import { SupplierShipmentInWarehouseFlowError } from './shipment-owner';

/**
 * K3 PR 2 — 창고 흐름은 입점사 상자를 받지 않는다(스펙 §4.8). 진입 함수 목록은 supplier-shipment-entry.guard.spec.ts 가 지키고,
 * 여기서는 DB 를 타는 길목(예약·예약 재시도·원장 역분개·배송 추적 폴러)을 실제로 돌린다. 실행:
 * DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<scratch> npx jest --runInBand --runTestsByPath <이 파일>
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('창고 흐름은 입점사 상자를 받지 않는다 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  /** 같은 SKU 의 창고 draft 상자와 입점사 draft 상자, 창고에 재고 5. 창고 상자는 «안 고르는 것»이 의미 있게 하는 대조군이다. */
  async function seed(tx: DbTx) {
    const wired = wireLogistics(makeDbService(db));
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(wired.command, tx, { skuId, warehouseId, locationId, quantity: 5 });
    const w: World = { warehouseId, skuId, holderId };
    const warehouseFo = await seedFo(tx, w, await seedOrder(tx));
    const warehouseBox = await seedBox(tx, w, [warehouseFo.foItemId], { status: 'draft' });
    const supplierId = await seedDirectSupplier(tx);
    const supplierFo = await seedFo(tx, w, await seedOrder(tx));
    const supplierBox = await seedBox(tx, w, [supplierFo.foItemId], { status: 'draft', supplierId });
    return { wired, w, supplierId, warehouseBox, supplierBox };
  }

  async function seedSupplierAttempt(tx: DbTx, shipmentId: string): Promise<string> {
    const [attempt] = await tx
      .insert(wmsTables.dispatchAttempts)
      .values({
        shipmentId,
        attemptNo: 1,
        idempotencyKey: `it-${randomUUID()}`,
        kind: 'supplier',
        status: 'dispatched',
        dispatchedAt: new Date('2026-10-25T00:00:00Z'),
      })
      .returning();
    return attempt.id;
  }

  it('예약은 입점사 상자 라인을 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const lineId = f.supplierBox.lineIds[0];
      await expect(f.wired.shipmentReservations.reservePartial(lineId, 1, tx)).rejects.toBeInstanceOf(
        SupplierShipmentInWarehouseFlowError,
      );
      const [line] = await tx
        .select({ reservedQty: wmsTables.shipmentLines.reservedQty })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, lineId));
      expect(line.reservedQty).toBe(0);
    });
  });

  it('예약 재시도 워커는 입점사 상자 라인을 고르지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const ids = (await f.wired.retryWorker.findCandidates(10_000, tx)).map((row) => row.id);
      expect(ids).toContain(f.warehouseBox.lineIds[0]);
      expect(ids).not.toContain(f.supplierBox.lineIds[0]);
    });
  });

  it('원장 역분개는 입점사 시도를 거부한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const attemptId = await seedSupplierAttempt(tx, f.supplierBox.shipmentId);
      const recallOperationId = randomUUID();
      const actorId = randomUUID();
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'SHIPMENT_RECALL',
          sourceId: recallOperationId,
          actorId,
          idempotencyKey: `it-${randomUUID()}`,
        })
        .returning();
      await expect(
        f.wired.command.reverseShipmentDispatch(
          { dispatchAttemptId: attemptId, reversalJournalId: journal.id, recallOperationId, actorId, reason: 'it' },
          tx,
        ),
      ).rejects.toBeInstanceOf(SupplierShipmentInWarehouseFlowError);
    });
  });

  it('배송 추적 폴러는 입점사 상자를 고르지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      // 스크래치 DB 의 다른 행과 섞이지 않게 먼 미래 시각으로 창을 좁힌다(폴러는 since 이후·배치 한도만큼 고른다)
      const dispatchedAt = new Date('2099-01-01T00:00:00Z');
      const shipBox = async (
        shipmentId: string,
        kind: 'warehouse' | 'supplier',
        trackingNo: string,
      ): Promise<string> => {
        await tx
          .update(wmsTables.shipments)
          .set({ status: 'shipped', shippedAt: dispatchedAt })
          .where(eq(wmsTables.shipments.id, shipmentId));
        const [waybill] = await tx
          .insert(wmsTables.waybills)
          .values({
            shipmentId,
            source: 'manual',
            carrier: 'HANJIN',
            status: 'used',
            trackingNo,
            manifestVersion: 1,
            recipientHash: 'x'.repeat(64),
          })
          .returning();
        const [journal] =
          kind === 'warehouse'
            ? await tx
                .insert(wmsTables.stockJournals)
                .values({ idempotencyKey: `it-${randomUUID()}` })
                .returning()
            : [undefined];
        const [attempt] = await tx
          .insert(wmsTables.dispatchAttempts)
          .values({
            shipmentId,
            attemptNo: 1,
            idempotencyKey: `it-${randomUUID()}`,
            kind,
            status: 'dispatched',
            dispatchedAt,
            waybillId: waybill.id,
            stockJournalId: journal?.id ?? null,
          })
          .returning();
        return attempt.id;
      };
      const warehouseAttempt = await shipBox(f.warehouseBox.shipmentId, 'warehouse', `W${randomUUID().slice(0, 12)}`);
      const supplierAttempt = await shipBox(f.supplierBox.shipmentId, 'supplier', `S${randomUUID().slice(0, 12)}`);
      const poller = new CarrierTrackingPoller(
        makeDbService(db),
        new CarrierGatewayRegistry([]),
        {} as never,
        {} as never,
      );
      const targets = await poller.findTargets(['HANJIN'], dispatchedAt, tx);
      const attemptIds = targets.map((target) => target.dispatchAttemptId);
      expect(attemptIds).toContain(warehouseAttempt);
      expect(attemptIds).not.toContain(supplierAttempt);
    });
  });
});
