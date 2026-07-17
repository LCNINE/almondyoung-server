import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService } from '../services/__support__';
import {
  seedPlannedShipmentForWaybill,
  fakeCarrierGateway,
  makeSeedDeps,
  type SeedDeps,
} from './__support__/waybill-fixtures';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { CarrierError } from './carrier/carrier-gateway.interface';
import { WaybillRepository } from './waybill.repository';
import { WaybillReader } from './waybill.reader';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillManager } from './waybill.manager';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const CONFIG: HanjinConfig = {
  clientId: 'CID',
  apiKey: 'AK',
  secretKey: 'SK',
  contractNo: 'CN',
  orderBaseUrl: 'https://o',
  printBaseUrl: 'https://p',
  timeoutMs: 15000,
  sender: { name: '보내는이', zip: '06236', baseAddress: '테헤란로 1', detailAddress: '10층', tel: '02-100-2000' },
  boxType: 'A',
  payType: 'PP',
};
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('WaybillManager.issueForShipment (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let deps: SeedDeps;

  // dbService 는 필수(optional 아님) — issueForShipment 가 commands.execute 밖에서 this.dbService.run(...) 을
  // 호출하므로 생략하면 런타임에 undefined 가 된다. svc 를 마지막 인자로 명시 전달한다.
  function manager(registry: CarrierGatewayRegistry): WaybillManager {
    const svc = makeDbService(db);
    const repo = new WaybillRepository(svc);
    return new WaybillManager(
      new WaybillReader(svc),
      repo,
      new WaybillIssueMachine(repo, registry, svc),
      registry,
      new FulfillmentCommandService(svc),
      CONFIG,
      svc,
    );
  }

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    deps = makeSeedDeps(db);
  });
  afterAll(async () => {
    await client.end();
  });

  it('issues to registered on happy path (durable row + inline drive)', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const wb = await mgr.issueForShipment(
      seed.shipmentId,
      { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    expect(wb.status).toBe('registered');
    expect(wb.trackingNo).toMatch(/^WBL-/);
    expect(wb.custOrdNo).toMatch(/^AY/);
  });

  it('leaves a durable failed row on definitive rejection', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const gw = fakeCarrierGateway({
      allocate: () => {
        throw new CarrierError('x', 'definitive_rejection', { code: 'ERROR-05' });
      },
    });
    const mgr = manager(new CarrierGatewayRegistry([gw]));
    const wb = await mgr.issueForShipment(
      seed.shipmentId,
      { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    expect(wb.status).toBe('failed');
    const [row] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, wb.id));
    expect(row.lastError).toContain('ERROR-05');
  });

  it('rejects a stale manifest version', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    await expect(
      mgr.issueForShipment(
        seed.shipmentId,
        { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion + 1 },
        `idem-${randomUUID()}`,
        actor,
      ),
    ).rejects.toThrow(/WAYBILL_STALE_MANIFEST_VERSION/);
  });

  it('rejects a second active waybill', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    await mgr.issueForShipment(
      seed.shipmentId,
      { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    await expect(
      mgr.issueForShipment(
        seed.shipmentId,
        { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
        `idem-${randomUUID()}`,
        actor,
      ),
    ).rejects.toThrow(/WAYBILL_ACTIVE_EXISTS/);
  });

  describe('registerManual', () => {
    it('registers a manual waybill immediately without carrier calls or profile completeness', async () => {
      const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
      // 게이트웨이가 던지도록 해도 manual 은 호출 안 함을 증명
      const gw = fakeCarrierGateway({
        allocate: () => {
          throw new Error('should not be called');
        },
      });
      const mgr = manager(new CarrierGatewayRegistry([gw]));
      const wb = await mgr.registerManual(
        seed.shipmentId,
        {
          carrier: 'HANJIN',
          trackingNo: `MANUAL-${randomUUID().slice(0, 8)}`,
          expectedManifestVersion: seed.manifestVersion,
        },
        `idem-${randomUUID()}`,
        actor,
      );
      expect(wb.source).toBe('manual');
      expect(wb.status).toBe('registered');
    });

    it('rejects a duplicate live tracking number', async () => {
      const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
      const seed2 = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
      const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
      const tn = `MANUAL-${randomUUID().slice(0, 8)}`;
      await mgr.registerManual(
        seed.shipmentId,
        { carrier: 'HANJIN', trackingNo: tn, expectedManifestVersion: seed.manifestVersion },
        `idem-${randomUUID()}`,
        actor,
      );
      await expect(
        mgr.registerManual(
          seed2.shipmentId,
          { carrier: 'HANJIN', trackingNo: tn, expectedManifestVersion: seed2.manifestVersion },
          `idem-${randomUUID()}`,
          actor,
        ),
      ).rejects.toThrow(/WAYBILL_TRACKING_EXISTS/);
    });
  });

  describe('void + reissue', () => {
    it('voids a registered waybill before dispatch', async () => {
      const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
      const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
      const wb = await mgr.registerManual(
        seed.shipmentId,
        {
          carrier: 'HANJIN',
          trackingNo: `M-${randomUUID().slice(0, 8)}`,
          expectedManifestVersion: seed.manifestVersion,
        },
        `idem-${randomUUID()}`,
        actor,
      );
      const voided = await mgr.void(wb.id, { reason: 'wrong address' }, `idem-${randomUUID()}`, actor);
      expect(voided.status).toBe('voided');
      expect(voided.voidedAt).toBeTruthy();
    });

    it('rejects voiding a used waybill', async () => {
      const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
      const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
      const wb = await mgr.registerManual(
        seed.shipmentId,
        {
          carrier: 'HANJIN',
          trackingNo: `M-${randomUUID().slice(0, 8)}`,
          expectedManifestVersion: seed.manifestVersion,
        },
        `idem-${randomUUID()}`,
        actor,
      );
      await db.update(wmsTables.waybills).set({ status: 'used' }).where(eq(wmsTables.waybills.id, wb.id));
      await expect(mgr.void(wb.id, { reason: 'x' }, `idem-${randomUUID()}`, actor)).rejects.toThrow(
        /WAYBILL_ALREADY_DISPATCHED/,
      );
    });

    it('reissue voids the active waybill and issues a fresh one', async () => {
      const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
      const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
      const first = await mgr.registerManual(
        seed.shipmentId,
        {
          carrier: 'HANJIN',
          trackingNo: `M-${randomUUID().slice(0, 8)}`,
          expectedManifestVersion: seed.manifestVersion,
        },
        `idem-${randomUUID()}`,
        actor,
      );
      const second = await mgr.reissue(
        seed.shipmentId,
        { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
        `idem-${randomUUID()}`,
        actor,
      );
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('registered');
      const [old] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, first.id));
      expect(old.status).toBe('voided');
    });
  });
});
