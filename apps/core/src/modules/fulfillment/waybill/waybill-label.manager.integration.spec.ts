import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService } from '../services/__support__';
import {
  fakeCarrierGateway,
  makeSeedDeps,
  seedPlannedShipmentForWaybill,
  WAYBILL_RECIPIENT,
  type SeedDeps,
} from './__support__/waybill-fixtures';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { SvgRasterizer } from './label/svg-rasterizer';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillLabelManager } from './waybill-label.manager';
import { WaybillManager } from './waybill.manager';
import { WaybillReader } from './waybill.reader';
import { WaybillRepository } from './waybill.repository';

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
  sender: {
    name: '보내는이',
    zip: '06236',
    baseAddress: '서울특별시 강남구 테헤란로 1',
    detailAddress: '10층',
    tel: '02-100-2000',
  },
  boxType: 'A',
  payType: 'CD',
};
const LABEL_DATA = {
  hub_cod: 'NX',
  tml_cod: '150',
  dom_mid: 'Z',
  cen_cod: '1050',
  cen_nam: '해운(집)',
  grp_rnk: 'A1',
  es_nam: '권순천',
  es_cod: '888',
  prt_add: '세종대로 1',
  dom_rgn: '1',
  s_tml_cod: '000',
  s_tml_nam: '본사',
};
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('WaybillLabelManager.render (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let deps: SeedDeps;

  // 12자리 숫자 운송장번호를 내는 한진 흉내 게이트웨이 — 기본 fake 는 `WBL-…` 라 ITF 로 못 그린다.
  function build() {
    const trackingNo = String(100_000_000_000 + Math.floor(Math.random() * 899_999_999_999));
    const registry = new CarrierGatewayRegistry([
      fakeCarrierGateway({ allocate: () => Promise.resolve({ waybillNo: trackingNo, labelData: LABEL_DATA }) }),
    ]);
    const svc = makeDbService(db);
    const repo = new WaybillRepository(svc);
    const reader = new WaybillReader(svc);
    const waybills = new WaybillManager(
      reader,
      repo,
      new WaybillIssueMachine(repo, registry, svc),
      registry,
      new FulfillmentCommandService(svc),
      CONFIG,
      svc,
    );
    const labels = new WaybillLabelManager(
      waybills,
      reader,
      new SvgRasterizer(),
      CONFIG,
      svc,
      () => new Date('2026-09-27T01:00:00Z'),
    );
    return { trackingNo, waybills, labels };
  }

  async function issued() {
    const b = build();
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await b.waybills.issueForShipment(
      seed.shipmentId,
      { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    return { ...b, seed };
  }

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    deps = makeSeedDeps(db);
  });
  afterAll(async () => {
    await client.end();
  });

  it('등록된 한진 운송장이면 ZPL 을 돌려준다', async () => {
    const { labels, seed, trackingNo } = await issued();
    const label = await labels.render(seed.shipmentId);
    expect(label).toMatchObject({ trackingNo, format: 'zpl' });
    expect(label.data.startsWith('^XA')).toBe(true);
    expect(label.data).toContain(`^B2R,160,N,N,N^FD${trackingNo}^FS`);
    expect(label.data).toContain('^BCR,64,N,N,N^FD150^FS');
  });

  it('운송장이 없으면 409 WAYBILL_NOT_DISPATCHABLE', async () => {
    const { labels } = build();
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await expect(labels.render(seed.shipmentId)).rejects.toThrow(/WAYBILL_NOT_DISPATCHABLE/);
  });

  it('발급 후 수하인이 바뀌면 409 WAYBILL_STALE (라벨이 한진 등록값과 달라진다)', async () => {
    const { labels, seed } = await issued();
    await db
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: { ...WAYBILL_RECIPIENT, detailAddress: 'CHANGED' } })
      .where(eq(wmsTables.shipments.id, seed.shipmentId));
    await expect(labels.render(seed.shipmentId)).rejects.toThrow(/WAYBILL_STALE/);
  });

  it('수기 등록 운송장은 409 WAYBILL_LABEL_UNAVAILABLE', async () => {
    const { waybills, labels } = build();
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await waybills.registerManual(
      seed.shipmentId,
      { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion },
      `idem-${randomUUID()}`,
      actor,
    );
    await expect(labels.render(seed.shipmentId)).rejects.toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });

  it('없는 shipment 는 404 WAYBILL_SHIPMENT_NOT_FOUND', async () => {
    const { labels } = build();
    await expect(labels.render(randomUUID())).rejects.toThrow(/WAYBILL_SHIPMENT_NOT_FOUND/);
  });
});
