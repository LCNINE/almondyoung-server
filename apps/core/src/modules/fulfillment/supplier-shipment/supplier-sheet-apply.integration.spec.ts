import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { and, eq, inArray } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { ApplicationException } from '@app/shared';
import {
  CORE_ORDER_STREAM,
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { OrderProgressReader } from '../order-progress/order-progress.reader';
import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
  Wired,
} from '../services/__support__';
import { WaybillRepository } from '../waybill/waybill.repository';
import { reportUnfulfillable } from './supplier-line-reports';
import { SupplierHandoffService, type SupplierSheetRow } from './supplier-handoff.service';
import { SupplierSheetApplyService } from './supplier-sheet-apply.service';
import { SUPPLIER_SHEET_COLUMNS } from './supplier-sheet.columns';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const RECIPIENT = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 1',
  detailAddress: '101호',
};
const X_RECIPIENT = { ...RECIPIENT, recipientName: '김철수' };

type Fill = { carrier?: string; trackingNo?: string; reason?: string; qty?: number };

/** 넘김 시트의 줄에 입점사가 채운 칸을 얹어 XLSX 로 — 열은 `SUPPLIER_SHEET_COLUMNS` 그대로(머리글 글자). */
async function xlsxOf(rows: readonly SupplierSheetRow[], fills: ReadonlyMap<string, Fill>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('직배');
  ws.addRow(SUPPLIER_SHEET_COLUMNS.map((c) => c.header));
  for (const row of rows) {
    const fill = fills.get(row.rowKey) ?? {};
    const filled: SupplierSheetRow = {
      ...row,
      carrier: fill.carrier ?? row.carrier,
      trackingNo: fill.trackingNo ?? row.trackingNo,
      unfulfillableReason: fill.reason ?? row.unfulfillableReason,
      qty: fill.qty ?? row.qty,
    };
    ws.addRow(SUPPLIER_SHEET_COLUMNS.map((c) => filled[c.key]));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** K3 PR5 Task 10 — 올리기: 미리보기 토큰으로 묶인 적용, 파일 하나 = 트랜잭션 하나(N6). */
describeIfDb('직배 시트 올리기 — 미리보기·적용 (K3 PR5, PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  let wired: Wired;
  let handoffs: SupplierHandoffService;
  let progress: OrderProgressReader;
  const actorId = randomUUID();

  const makeService = (waybills: WaybillRepository) => {
    const dbService = makeDbService(db);
    return new SupplierSheetApplyService(
      dbService,
      wired.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      waybills,
      outboxPublisherFor(SHIPMENT_STREAM, dbService),
      outboxPublisherFor(FULFILLMENT_V2_STREAM, dbService),
      outboxPublisherFor(FULFILLMENT_STREAM, dbService),
      outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    );
  };
  let service: SupplierSheetApplyService;

  beforeAll(() => {
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService);
    handoffs = new SupplierHandoffService(dbService);
    progress = new OrderProgressReader(dbService);
    service = makeService(new WaybillRepository(dbService));
  });
  afterAll(async () => {
    await client.end();
  });

  async function seedDirectSupplier(tx: DbTx): Promise<string> {
    const [row] = await tx
      .insert(wmsTables.suppliers)
      .values({ name: `it-upload-${randomUUID().slice(0, 8)}`, isDirectDelivery: true })
      .returning();
    return row.id;
  }

  /** 입점사 직배 라인만 있는 주문 하나 — 실제 FO 생성 경로로 상자를 만든다(넘기지는 않는다). */
  async function order(tx: DbTx, supplierId: string, dropQtys: number[], recipient: object) {
    const w = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const skuIds: string[] = [];
    for (let i = 0; i < dropQtys.length; i++) {
      const { skuId } = await seedSku(tx, holderId);
      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, skuId));
      await tx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId, supplierSku: `SUP-${skuId.slice(0, 6)}` });
      skuIds.push(skuId);
    }
    const variants = skuIds.map(() => randomUUID());
    const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
      lines: dropQtys.map((quantity, i) => ({ variantId: variants[i], quantity })),
    });
    for (const lineId of lineIds) {
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: `item-${lineId.slice(0, 8)}` })
        .where(eq(wmsTables.salesOrderLines.id, lineId));
    }
    for (const [i, skuId] of skuIds.entries()) await seedMatching(tx, { variantId: variants[i], skuId });
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId: randomUUID(), customerEmail: 'it@example.com', customerName: '고객' })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    const fo = await wired.fulfillments.create({ salesOrderId, warehouseId: w.warehouseId }, tx);
    if (!fo) throw new Error('expected a fulfillment order');
    const lines = await tx
      .select({
        lineId: wmsTables.shipmentLines.id,
        foiId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        shipmentId: wmsTables.shipmentLines.shipmentId,
        qty: wmsTables.shipmentLines.qty,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id))
      .orderBy(wmsTables.shipmentLines.qty);
    const box = lines[0].shipmentId;
    if (lines.some((l) => l.shipmentId !== box)) throw new Error('expected one supplier box');
    await tx.update(wmsTables.shipments).set({ recipientSnapshot: recipient }).where(eq(wmsTables.shipments.id, box));
    return { salesOrderId, foId: fo.id, box, lines };
  }

  /** 넘긴 입점사 A 상자 셋 — X: 라인 둘, Y·Z: 라인 하나씩, Y·Z 수령인 같음. 시트는 실제 넘김이 돌려준 줄. */
  async function world(tx: DbTx) {
    const supplierId = await seedDirectSupplier(tx);
    const x = await order(tx, supplierId, [1, 2], X_RECIPIENT);
    const y = await order(tx, supplierId, [1], RECIPIENT);
    const z = await order(tx, supplierId, [3], RECIPIENT);
    const sheet = await handoffs.handOff(supplierId, actorId, tx);
    expect(sheet.rows).toHaveLength(4);
    const fills = new Map<string, Fill>([
      [x.lines[0].foiId, { carrier: '우체국', trackingNo: 'T-1' }],
      [x.lines[1].foiId, { reason: '품절' }],
      [y.lines[0].foiId, { carrier: '우체국', trackingNo: 'T-2' }],
      [z.lines[0].foiId, { carrier: '우체국', trackingNo: 'T 2' }],
    ]);
    const file = await xlsxOf(sheet.rows, fills);
    return {
      supplierId,
      x,
      y,
      z,
      sheetRows: sheet.rows,
      file,
      salesOrderIds: [x.salesOrderId, y.salesOrderId, z.salesOrderId],
    };
  }

  const boxesOfFo = (tx: DbTx, foId: string) =>
    tx
      .selectDistinct({
        id: wmsTables.shipments.id,
        status: wmsTables.shipments.status,
        manifestVersion: wmsTables.shipments.manifestVersion,
        supplierHandoffId: wmsTables.shipments.supplierHandoffId,
        shippedAt: wmsTables.shipments.shippedAt,
        supersededAt: wmsTables.shipments.supersededAt,
        openedBy: wmsTables.shipments.openedBy,
        openedAt: wmsTables.shipments.openedAt,
        lastUpdated: wmsTables.shipments.lastUpdated,
      })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, foId))
      .orderBy(wmsTables.shipments.id);
  const linesOfBox = (tx: DbTx, shipmentId: string) =>
    tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(wmsTables.shipmentLines.qty);
  const waybillsOf = (tx: DbTx, shipmentIds: string[]) =>
    tx
      .select({
        shipmentId: wmsTables.waybills.shipmentId,
        trackingNo: wmsTables.waybills.trackingNo,
        status: wmsTables.waybills.status,
      })
      .from(wmsTables.waybills)
      .where(inArray(wmsTables.waybills.shipmentId, shipmentIds));
  const outboxCount = async (tx: DbTx, aggregateIds: string[], eventType: string) =>
    (
      await tx
        .select({ id: outbox_events.id })
        .from(outbox_events)
        .where(and(inArray(outbox_events.aggregateId, aggregateIds), eq(outbox_events.eventType, eventType)))
    ).length;
  const allOutbox = (tx: DbTx, aggregateIds: string[]) =>
    tx.select({ id: outbox_events.id }).from(outbox_events).where(inArray(outbox_events.aggregateId, aggregateIds));

  /** 세 주문의 상자·라인·송장 전부 — 쓰기 0 비교용 */
  async function snapshot(tx: DbTx, w: Awaited<ReturnType<typeof world>>) {
    const boxes = [
      ...(await boxesOfFo(tx, w.x.foId)),
      ...(await boxesOfFo(tx, w.y.foId)),
      ...(await boxesOfFo(tx, w.z.foId)),
    ];
    const ids = boxes.map((b) => b.id);
    const lines = (await Promise.all(ids.map((id) => linesOfBox(tx, id)))).flat();
    return { boxes, lines, waybills: await waybillsOf(tx, ids) };
  }

  const aggregatesOf = async (tx: DbTx, w: Awaited<ReturnType<typeof world>>) => {
    const s = await snapshot(tx, w);
    return [...s.boxes.map((b) => b.id), ...w.salesOrderIds, w.x.foId, w.y.foId, w.z.foId];
  };

  const codeOf = async (p: Promise<unknown>): Promise<{ code: string; status: number }> => {
    try {
      await p;
    } catch (e) {
      if (e instanceof ApplicationException) return { code: e.getErrorCode(), status: e.getHttpStatus() };
      throw e;
    }
    throw new Error('expected a rejection');
  };

  it('미리보기 → 적용: X 는 나뉘어 T1 상자 shipped + 원래 상자 draft(라인2 못 보냄), Y·Z 는 합친 상자 하나가 T2 로 shipped, Y·Z 원래 상자 superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const before = await snapshot(tx, w);

      const preview = await service.preview(w.supplierId, w.file, tx);
      expect(preview.counts).toEqual({
        ship: 1,
        merge: 2,
        unfulfillable: 1,
        waiting: 0,
        correct: 0,
        unchanged: 0,
        error: 0,
      });
      expect(preview.rows).toHaveLength(4);
      // 미리보기는 아무것도 쓰지 않는다
      expect(await snapshot(tx, w)).toEqual(before);

      const result = await service.apply(w.supplierId, w.file, preview.token, actorId, tx);
      expect(result.counts).toEqual(preview.counts);
      expect(result.shippedShipmentIds).toHaveLength(2);

      // X — 라인1 은 새 상자로 나뉘어 T1 으로 발송, 원래 상자는 라인2 를 «못 보냄» 으로 든 채 draft
      const xBoxes = await boxesOfFo(tx, w.x.foId);
      expect(xBoxes).toHaveLength(2);
      const xOriginal = xBoxes.find((b) => b.id === w.x.box);
      const xShipped = xBoxes.find((b) => b.id !== w.x.box);
      expect(xOriginal?.status).toBe('draft');
      expect(xShipped?.status).toBe('shipped');
      expect(xShipped?.supplierHandoffId).toBe(xOriginal?.supplierHandoffId);
      expect(xShipped?.openedBy).toBe(actorId);
      expect(result.shippedShipmentIds).toContain(xShipped?.id);
      expect((await linesOfBox(tx, w.x.box)).map((l) => [l.id, l.unfulfillableReason])).toEqual([
        [w.x.lines[1].lineId, '품절'],
      ]);
      expect((await linesOfBox(tx, xShipped?.id ?? '')).map((l) => l.id)).toEqual([w.x.lines[0].lineId]);
      expect(await waybillsOf(tx, [xShipped?.id ?? ''])).toEqual([
        { shipmentId: xShipped?.id, trackingNo: 'T1', status: 'used' },
      ]);

      // Y·Z — 합친 상자 하나가 T2 로 발송, 원래 상자는 superseded
      const yBoxes = await boxesOfFo(tx, w.y.foId);
      const zBoxes = await boxesOfFo(tx, w.z.foId);
      const merged = yBoxes.find((b) => b.id !== w.y.box);
      expect(merged?.status).toBe('shipped');
      expect(merged?.openedBy).toBe(actorId);
      expect(zBoxes.find((b) => b.id !== w.z.box)?.id).toBe(merged?.id);
      expect(yBoxes.find((b) => b.id === w.y.box)?.status).toBe('superseded');
      expect(zBoxes.find((b) => b.id === w.z.box)?.status).toBe('superseded');
      expect(result.shippedShipmentIds).toContain(merged?.id);
      expect(await waybillsOf(tx, [merged?.id ?? ''])).toEqual([
        { shipmentId: merged?.id, trackingNo: 'T2', status: 'used' },
      ]);

      // 모든 쓰기가 같은 시각 — 묶음 둘의 발송·나누기·합포장·«못 보냄»·송장 발급
      const at = merged?.shippedAt;
      expect(at).toBeInstanceOf(Date);
      expect(xShipped?.shippedAt).toEqual(at);
      expect(xShipped?.lastUpdated).toEqual(at);
      expect(xOriginal?.lastUpdated).toEqual(at); // 나누기의 끝맺음(manifest_version +1)
      // 나눈 상자의 opened_at 은 원래 상자 것을 물려받는다(대기 나이가 나누기로 리셋되지 않게, Task 5)
      expect(xShipped?.openedAt).toEqual(xOriginal?.openedAt);
      expect(merged?.openedAt).toEqual(at);
      expect(merged?.lastUpdated).toEqual(at);
      for (const original of [yBoxes.find((b) => b.id === w.y.box), zBoxes.find((b) => b.id === w.z.box)]) {
        expect(original?.supersededAt).toEqual(at);
        expect(original?.lastUpdated).toEqual(at);
      }
      expect((await linesOfBox(tx, w.x.box))[0].unfulfillableReportedAt).toEqual(at);
      const issued = await tx
        .select({ issuedAt: wmsTables.waybills.issuedAt })
        .from(wmsTables.waybills)
        .where(inArray(wmsTables.waybills.shipmentId, result.shippedShipmentIds));
      expect(issued.map((r) => r.issuedAt)).toEqual([at, at]);
      const foTimes = await tx
        .select({ updatedAt: wmsTables.fulfillmentOrders.updatedAt })
        .from(wmsTables.fulfillmentOrders)
        .where(inArray(wmsTables.fulfillmentOrders.id, [w.x.foId, w.y.foId, w.z.foId]));
      expect(foTimes.map((r) => r.updatedAt)).toEqual([at, at, at]);

      // outbox — 발송 상자마다 ShipmentShipped, 판매주문마다 SalesOrderShipmentDispatched
      const aggregates = await aggregatesOf(tx, w);
      expect(await outboxCount(tx, aggregates, 'ShipmentShipped')).toBe(2);
      expect(await outboxCount(tx, aggregates, 'SalesOrderShipmentDispatched')).toBe(3);

      // 정합성 점검 위반 0, 보드: X 는 창고 상자가 없고 원래 상자가 «못 보냄»
      await expect(
        new FulfillmentInvariantService().assertFulfillmentOrders([w.x.foId, w.y.foId, w.z.foId], tx),
      ).resolves.toBeUndefined();
      expect(await progress.judgeShipment(w.x.box, tx)).toMatchObject({
        stage: 'dispatch',
        state: 'drop_ship_unfulfillable',
      });
    });
  });

  it('같은 파일 다시 apply(새 미리보기 토큰) → 전부 unchanged, 쓰기 0, outbox 새 행 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const first = await service.preview(w.supplierId, w.file, tx);
      await service.apply(w.supplierId, w.file, first.token, actorId, tx);
      const afterFirst = await snapshot(tx, w);
      const aggregates = await aggregatesOf(tx, w);
      const outboxBefore = (await allOutbox(tx, aggregates)).length;

      const again = await service.preview(w.supplierId, w.file, tx);
      expect(again.counts).toEqual({
        ship: 0,
        merge: 0,
        unfulfillable: 0,
        waiting: 0,
        correct: 0,
        unchanged: 4,
        error: 0,
      });
      const result = await service.apply(w.supplierId, w.file, again.token, actorId, tx);

      expect(result).toEqual({ counts: again.counts, shippedShipmentIds: [] });
      expect(await snapshot(tx, w)).toEqual(afterFirst);
      expect((await allOutbox(tx, aggregates)).length).toBe(outboxBefore);
    });
  });

  // 같은 연결(롤백 트랜잭션) 안에서 상태를 바꾼다 — 별도 커밋 트랜잭션으로 바꾸면 픽스처를 커밋하고 지워야 한다.
  // 판정이 읽는 것은 커밋된 결과뿐이라, 미리보기와 적용 사이에 다른 트랜잭션이 커밋한 것과 같은 상태다.
  it('미리보기 뒤 X 라인의 상태가 바뀌면(못 보냄이 먼저 기록됨) apply 는 409 SUPPLIER_UPLOAD_PREVIEW_STALE, 아무것도 안 남음', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const preview = await service.preview(w.supplierId, w.file, tx);
      const rowOf = (rows: typeof preview.rows) => rows.find((r) => r.rowKey === w.x.lines[1].foiId)?.verdict;
      expect(rowOf(preview.rows)).toBe('unfulfillable');

      // 미리보기 뒤 다른 경로가 그 라인에 «못 보냄» 을 먼저 기록한다 — 그 줄의 판정이 바뀐다
      await reportUnfulfillable(tx, {
        shipmentLineId: w.x.lines[1].lineId,
        reason: '품절',
        actorId: 'op-other',
        at: new Date(),
      });
      const changed = await service.preview(w.supplierId, w.file, tx);
      expect(rowOf(changed.rows)).toBe('unchanged');
      expect(changed.token).not.toBe(preview.token);
      const before = await snapshot(tx, w);
      const aggregates = await aggregatesOf(tx, w);

      expect(
        await codeOf(
          tx.transaction((sp) => service.apply(w.supplierId, w.file, preview.token, actorId, sp as unknown as DbTx)),
        ),
      ).toEqual({ code: 'SUPPLIER_UPLOAD_PREVIEW_STALE', status: 409 });
      expect(await snapshot(tx, w)).toEqual(before);
      expect(await outboxCount(tx, aggregates, 'ShipmentShipped')).toBe(0);
    });
  });

  it('오류 줄과 좋은 줄이 섞인 파일 — 좋은 묶음만 적용, 오류 줄의 상자는 그대로, counts 에 오류', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      // X 라인1 = T1(좋음), X 라인2 = 비움(대기), Y = T2 이지만 수량을 고침(QTY_MISMATCH, 혼자인 묶음), Z = 비움
      const file = await xlsxOf(
        w.sheetRows,
        new Map<string, Fill>([
          [w.x.lines[0].foiId, { carrier: '우체국', trackingNo: 'T-1' }],
          [w.y.lines[0].foiId, { carrier: '우체국', trackingNo: 'T-2', qty: 5 }],
        ]),
      );
      const yBefore = await boxesOfFo(tx, w.y.foId);
      const yLinesBefore = await linesOfBox(tx, w.y.box);

      const preview = await service.preview(w.supplierId, file, tx);
      expect(preview.rows.find((r) => r.rowKey === w.y.lines[0].foiId)).toMatchObject({
        verdict: 'error',
        code: 'QTY_MISMATCH',
      });
      const result = await service.apply(w.supplierId, file, preview.token, actorId, tx);

      expect(result.counts).toEqual({
        ship: 1,
        merge: 0,
        unfulfillable: 0,
        waiting: 2,
        correct: 0,
        unchanged: 0,
        error: 1,
      });
      expect(result.shippedShipmentIds).toHaveLength(1);
      const xBoxes = await boxesOfFo(tx, w.x.foId);
      expect(xBoxes.find((b) => b.id === result.shippedShipmentIds[0])?.status).toBe('shipped');
      expect(xBoxes.find((b) => b.id === w.x.box)?.status).toBe('draft');
      // 오류 줄의 상자는 손대지 않았다
      expect(await boxesOfFo(tx, w.y.foId)).toEqual(yBefore);
      expect(await linesOfBox(tx, w.y.box)).toEqual(yLinesBefore);
      expect(await waybillsOf(tx, [w.y.box, w.z.box])).toEqual([]);
    });
  });

  it('적용 중 하나가 실패하면(T2 송장을 경합으로 심어 TRACKING_IN_USE) 먼저 한 T1 발송까지 파일 전체 롤백', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await world(tx);
      const bystander = await order(tx, await seedDirectSupplier(tx), [1], RECIPIENT);
      const inserted: string[] = [];
      /** T2 를 넣기 직전에 다른 상자의 살아 있는 T2 송장을 심는다 — 판정·발송의 «번호 사용 중» 확인을 지난 뒤의 경합 */
      class RacingWaybills extends WaybillRepository {
        override async insertSupplierManualUsed(
          trx: DbTx,
          row: Parameters<WaybillRepository['insertSupplierManualUsed']>[1],
        ): Promise<{ id: string }> {
          inserted.push(row.trackingNo);
          if (row.trackingNo === 'T2') {
            await super.insertSupplierManualUsed(trx, { ...row, shipmentId: bystander.box });
          }
          return super.insertSupplierManualUsed(trx, row);
        }
      }
      const racing = makeService(new RacingWaybills(makeDbService(db)));
      const before = await snapshot(tx, w);
      const aggregates = await aggregatesOf(tx, w);
      const outboxBefore = await allOutbox(tx, aggregates);

      const preview = await racing.preview(w.supplierId, w.file, tx);
      expect(
        await codeOf(
          tx.transaction((sp) => racing.apply(w.supplierId, w.file, preview.token, actorId, sp as unknown as DbTx)),
        ),
      ).toEqual({ code: 'TRACKING_IN_USE', status: 409 });

      expect(inserted).toEqual(['T1', 'T2']); // T1 발송은 실제로 실행됐다
      expect(await snapshot(tx, w)).toEqual(before);
      expect(await waybillsOf(tx, [bystander.box])).toEqual([]);
      expect(await allOutbox(tx, aggregates)).toEqual(outboxBefore);
    });
  });
});
