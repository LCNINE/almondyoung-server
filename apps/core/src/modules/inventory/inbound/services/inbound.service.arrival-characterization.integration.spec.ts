import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 입고 커널 추출(PR-A)의 동작 보존 기준선.
 *
 * 커널로 옮기기 **전** 코드에서 초록이어야 하고, 옮긴 뒤에도 **단언을 고치지 않고** 초록이어야 한다.
 * 보존 대상은 계획서 Global Constraints — 회차·라인·원장 이벤트(키·reason)·작업 로그·HTTP 예외.
 * 스펙: docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md §11 PR-A
 *
 *   npm run test:core:integration:local -- arrival-characterization
 */
describeIfDb('InboundService 입고 경로 동작 기준선 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
  });

  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `char-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [otherWarehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `char-wh2-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `char-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [skuA] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'char sku A', code: `CHAR-A-${suffix}`, holderId: holder.id })
      .returning();
    const [skuB] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'char sku B', code: `CHAR-B-${suffix}`, holderId: holder.id })
      .returning();
    const [shelf] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId: warehouse.id,
        code: `CH-${suffix.slice(0, 6)}`,
        locationType: 'zone',
        isSystem: false,
        systemRole: null,
        isActive: true,
      })
      .returning();
    const [foreignShelf] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId: otherWarehouse.id,
        code: `CF-${suffix.slice(0, 6)}`,
        locationType: 'zone',
        isSystem: false,
        systemRole: null,
        isActive: true,
      })
      .returning();
    return { warehouse, skuA, skuB, shelf, foreignShelf };
  }

  async function inboundZoneId(tx: DbTx, warehouseId: string): Promise<string> {
    const [zone] = await tx
      .select({ id: wmsTables.locations.id })
      .from(wmsTables.locations)
      .where(
        and(eq(wmsTables.locations.warehouseId, warehouseId), eq(wmsTables.locations.systemRole, 'inbound_default')),
      )
      .limit(1);
    return zone?.id ?? '';
  }

  async function onHand(tx: DbTx, skuId: string, warehouseId: string, locationId: string): Promise<number> {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    return row?.qty ?? 0;
  }

  async function eventByKey(tx: DbTx, key: string) {
    const [event] = await tx
      .select()
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.idempotencyKey, key))
      .limit(1);
    return event;
  }

  async function workLogs(tx: DbTx, receiptId: string) {
    return tx.select().from(wmsTables.inboundWorkLogs).where(eq(wmsTables.inboundWorkLogs.receiptId, receiptId));
  }

  async function lineRow(tx: DbTx, lineId: string) {
    const [line] = await tx
      .select()
      .from(wmsTables.inboundReceiptLines)
      .where(eq(wmsTables.inboundReceiptLines.id, lineId))
      .limit(1);
    return line;
  }

  async function receiptRow(tx: DbTx, receiptId: string) {
    const [receipt] = await tx
      .select()
      .from(wmsTables.inboundReceipts)
      .where(eq(wmsTables.inboundReceipts.id, receiptId))
      .limit(1);
    return receipt;
  }

  /** 거절을 한 번만 실행해 타입과 메시지를 함께 본다 — 두 번 await 하면 부작용이 두 번 난다. */
  async function expectRejection(
    promise: Promise<unknown>,
    type: abstract new (...args: never[]) => Error,
    message: string,
  ) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(type);
    expect(error).toHaveProperty('message', message);
  }

  describe('도착 기록', () => {
    it('간편입고: 입고기본존에 저널 1·회차 1·라인 N·RECEIVE N·작업 로그 1 을 남긴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, skuB } = await seed(tx);
        const key = randomUUID();

        const result = await svc.simpleInbound(
          {
            warehouseId: warehouse.id,
            items: [
              { skuId: skuA.id, quantity: 3, memo: '첫 줄' },
              { skuId: skuB.id, quantity: 2 },
            ],
            idempotencyKey: key,
          },
          tx,
        );
        const zoneId = await inboundZoneId(tx, warehouse.id);

        expect(result.receipt).toMatchObject({
          method: 'simple',
          warehouseId: warehouse.id,
          locationId: zoneId,
          status: 'posted',
          totalQuantity: 5,
        });
        expect(
          result.lines.map((l) => ({
            skuId: l.skuId,
            quantity: l.quantity,
            originLocationId: l.originLocationId,
            memo: l.memo,
          })),
        ).toEqual([
          { skuId: skuA.id, quantity: 3, originLocationId: zoneId, memo: '첫 줄' },
          { skuId: skuB.id, quantity: 2, originLocationId: zoneId, memo: null },
        ]);
        // PR-A 부터 회차 라인은 출처를 든다. 간편입고는 문서에 묶이지 않는다.
        expect(result.lines.map((l) => l.source)).toEqual(['direct', 'direct']);

        const journalId = result.receipt.journalId ?? '';
        const [journal] = await tx
          .select()
          .from(wmsTables.stockJournals)
          .where(eq(wmsTables.stockJournals.id, journalId))
          .limit(1);
        expect(journal?.sourceType).toBe('inbound');

        const e0 = await eventByKey(tx, `inbound.simple:${key}:0`);
        const e1 = await eventByKey(tx, `inbound.simple:${key}:1`);
        expect(e0).toMatchObject({
          transitionType: 'RECEIVE',
          reason: 'simple_inbound',
          quantity: 3,
          journalId,
          toLocationId: zoneId,
        });
        expect(e1).toMatchObject({
          transitionType: 'RECEIVE',
          reason: 'simple_inbound',
          quantity: 2,
          journalId,
          toLocationId: zoneId,
        });
        expect(result.lines.map((l) => l.eventId)).toEqual([e0?.id, e1?.id]);

        expect(await onHand(tx, skuA.id, warehouse.id, zoneId)).toBe(3);
        expect(await onHand(tx, skuB.id, warehouse.id, zoneId)).toBe(2);

        const logs = await workLogs(tx, result.receipt.id);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          type: 'INBOUND',
          warehouseId: warehouse.id,
          toLocationId: zoneId,
          quantity: 5,
          method: 'simple',
          reason: 'simple_inbound',
          skuId: null,
          lineId: null,
        });
      });
    });

    it('전수조사 간편입고: 방식·reason·이벤트 키만 다르다', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA } = await seed(tx);
        const key = randomUUID();

        const result = await svc.simpleInboundFullscan(
          { warehouseId: warehouse.id, items: [{ skuId: skuA.id, quantity: 4 }], idempotencyKey: key },
          tx,
        );

        expect(result.receipt).toMatchObject({ method: 'simple_fullscan', totalQuantity: 4 });
        const event = await eventByKey(tx, `inbound.simple-fullscan:${key}:0`);
        expect(event).toMatchObject({ transitionType: 'RECEIVE', reason: 'simple_inbound_fullscan', quantity: 4 });
        const logs = await workLogs(tx, result.receipt.id);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ method: 'simple_fullscan', reason: 'simple_inbound_fullscan', quantity: 4 });
      });
    });

    it('개별입고: 지정 로케이션을 그대로 쓰고 이벤트 키에 순번이 없다', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, shelf } = await seed(tx);
        const key = randomUUID();

        const result = await svc.individualInbound(
          {
            warehouseId: warehouse.id,
            skuId: skuA.id,
            quantity: 4,
            locationId: shelf.id,
            memo: '개별',
            idempotencyKey: key,
          },
          tx,
        );

        // 응답의 receipt.totalQuantity 는 기준선에서 제외한다 — PR-A 가 의도적으로 0 → 4 로 바꾼다(계획서 Global Constraints 2).
        expect(result.receipt).toMatchObject({ method: 'individual', warehouseId: warehouse.id, locationId: shelf.id });
        expect(result.line).toMatchObject({ skuId: skuA.id, quantity: 4, originLocationId: shelf.id, memo: '개별' });
        expect((await receiptRow(tx, result.receipt.id))?.totalQuantity).toBe(4);

        const event = await eventByKey(tx, `inbound.individual:${key}`);
        expect(event).toMatchObject({
          transitionType: 'RECEIVE',
          reason: 'individual_inbound',
          quantity: 4,
          toLocationId: shelf.id,
        });
        expect(result.line.eventId).toBe(event?.id);
        expect(await onHand(tx, skuA.id, warehouse.id, shelf.id)).toBe(4);

        const logs = await workLogs(tx, result.receipt.id);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          type: 'INBOUND',
          toLocationId: shelf.id,
          quantity: 4,
          method: 'individual',
          reason: 'individual_inbound',
        });
      });
    });

    it('개별입고: 로케이션을 비우면 입고기본존으로 간다', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA } = await seed(tx);

        const result = await svc.individualInbound(
          { warehouseId: warehouse.id, skuId: skuA.id, quantity: 1, idempotencyKey: randomUUID() },
          tx,
        );

        const zoneId = await inboundZoneId(tx, warehouse.id);
        expect(result.receipt.locationId).toBe(zoneId);
        expect(result.line.originLocationId).toBe(zoneId);
      });
    });

    it('없는 SKU 는 간편입고·개별입고 모두 404 NotFoundException', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse } = await seed(tx);
        const missing = randomUUID();

        await expectRejection(
          svc.simpleInbound(
            { warehouseId: warehouse.id, items: [{ skuId: missing, quantity: 1 }], idempotencyKey: randomUUID() },
            tx,
          ),
          NotFoundException,
          `SKU ${missing} not found`,
        );
        await expectRejection(
          svc.individualInbound(
            { warehouseId: warehouse.id, skuId: missing, quantity: 1, idempotencyKey: randomUUID() },
            tx,
          ),
          NotFoundException,
          `SKU ${missing} not found`,
        );
      });
    });
  });

  describe('사후 현장 처리', () => {
    async function receiveFive(tx: DbTx, warehouseId: string, skuId: string) {
      const result = await svc.simpleInbound(
        { warehouseId, items: [{ skuId, quantity: 5 }], idempotencyKey: randomUUID() },
        tx,
      );
      return {
        receiptId: result.receipt.id,
        lineId: result.lines[0]?.id ?? '',
        zoneId: result.receipt.locationId ?? '',
      };
    }

    it('적치: 카운터·원장·이벤트 키·작업 로그', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, shelf } = await seed(tx);
        const { receiptId, lineId, zoneId } = await receiveFive(tx, warehouse.id, skuA.id);
        const key = randomUUID();

        await expect(
          svc.putawayFromOrigin({ lineId, toLocationId: shelf.id, quantity: 2, idempotencyKey: key }, tx),
        ).resolves.toEqual({ success: true });

        expect((await lineRow(tx, lineId))?.putawayFromOriginQty).toBe(2);
        expect(await onHand(tx, skuA.id, warehouse.id, zoneId)).toBe(3);
        expect(await onHand(tx, skuA.id, warehouse.id, shelf.id)).toBe(2);
        const event = await eventByKey(tx, `inbound.putaway:${key}`);
        expect(event).toMatchObject({ quantity: 2, reason: 'putaway_internal_move' });

        const logs = (await workLogs(tx, receiptId)).filter((l) => l.type === 'PUTAWAY');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          lineId,
          skuId: skuA.id,
          warehouseId: warehouse.id,
          fromLocationId: zoneId,
          toLocationId: shelf.id,
          quantity: 2,
          eventId: event?.id,
        });
      });
    });

    it('적치 거절: 다른 창고 로케이션 · 잔량 초과', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, foreignShelf, shelf } = await seed(tx);
        const { lineId } = await receiveFive(tx, warehouse.id, skuA.id);

        await expectRejection(
          svc.putawayFromOrigin(
            { lineId, toLocationId: foreignShelf.id, quantity: 1, idempotencyKey: randomUUID() },
            tx,
          ),
          BadRequestException,
          'destination location must be in the same warehouse',
        );
        await expectRejection(
          svc.putawayFromOrigin({ lineId, toLocationId: shelf.id, quantity: 6, idempotencyKey: randomUUID() }, tx),
          BadRequestException,
          'quantity exceeds origin available',
        );
      });
    });

    it('회송: 카운터·ADJUST_DOWN 이벤트·작업 로그', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA } = await seed(tx);
        const { receiptId, lineId, zoneId } = await receiveFive(tx, warehouse.id, skuA.id);
        const key = randomUUID();

        await expect(
          svc.returnInbound({ lineId, quantity: 1, reason: '불량', idempotencyKey: key }, tx),
        ).resolves.toEqual({ success: true });

        expect((await lineRow(tx, lineId))?.returnedQty).toBe(1);
        expect(await onHand(tx, skuA.id, warehouse.id, zoneId)).toBe(4);
        const event = await eventByKey(tx, `inbound.return:${key}`);
        expect(event).toMatchObject({
          transitionType: 'ADJUST_DOWN',
          reason: 'RETURN',
          quantity: 1,
          fromLocationId: zoneId,
        });

        const logs = (await workLogs(tx, receiptId)).filter((l) => l.type === 'RETURN');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          lineId,
          skuId: skuA.id,
          fromLocationId: zoneId,
          quantity: 1,
          reason: '불량',
          eventId: event?.id,
        });
      });
    });

    it('회송 거절: 적치가 있으면', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, shelf } = await seed(tx);
        const { lineId } = await receiveFive(tx, warehouse.id, skuA.id);
        await svc.putawayFromOrigin({ lineId, toLocationId: shelf.id, quantity: 1, idempotencyKey: randomUUID() }, tx);

        await expectRejection(
          svc.returnInbound({ lineId, quantity: 1, idempotencyKey: randomUUID() }, tx),
          BadRequestException,
          'cannot return: putaway exists; move all back to origin first',
        );
      });
    });

    it('당일 취소: 역분개·카운터·작업 로그, 회차의 모든 라인이 취소되면 voided', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA } = await seed(tx);
        const { receiptId, lineId, zoneId } = await receiveFive(tx, warehouse.id, skuA.id);
        const originalEventId = (await lineRow(tx, lineId))?.eventId ?? '';

        await expect(svc.cancelInbound({ lineId, quantity: 5, idempotencyKey: randomUUID() }, tx)).resolves.toEqual({
          success: true,
        });

        expect((await lineRow(tx, lineId))?.canceledQty).toBe(5);
        expect(await onHand(tx, skuA.id, warehouse.id, zoneId)).toBe(0);
        const [reversal] = await tx
          .select()
          .from(wmsTables.stockEvents)
          .where(eq(wmsTables.stockEvents.reversalOfEventId, originalEventId))
          .limit(1);
        expect(reversal).toBeDefined();

        const logs = (await workLogs(tx, receiptId)).filter((l) => l.type === 'CANCEL');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          lineId,
          skuId: skuA.id,
          fromLocationId: zoneId,
          quantity: 5,
          reason: 'CANCEL',
          eventId: reversal?.id,
        });
        expect(await receiptRow(tx, receiptId)).toMatchObject({ status: 'voided', totalQuantity: 0 });
      });
    });

    it('당일 취소: 두 라인 중 하나만 취소하면 회차는 posted 로 남는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, skuB } = await seed(tx);
        const result = await svc.simpleInbound(
          {
            warehouseId: warehouse.id,
            items: [
              { skuId: skuA.id, quantity: 2 },
              { skuId: skuB.id, quantity: 3 },
            ],
            idempotencyKey: randomUUID(),
          },
          tx,
        );

        await svc.cancelInbound({ lineId: result.lines[0]?.id ?? '', quantity: 2, idempotencyKey: randomUUID() }, tx);

        expect(await receiptRow(tx, result.receipt.id)).toMatchObject({ status: 'posted', totalQuantity: 5 });
      });
    });

    it('당일 취소 거절: 부분 수량 · 적치 존재 · 이미 취소', async () => {
      await inRollbackTx(db, async (tx) => {
        const { warehouse, skuA, skuB, shelf } = await seed(tx);
        const first = await receiveFive(tx, warehouse.id, skuA.id);
        const second = await receiveFive(tx, warehouse.id, skuB.id);

        await expectRejection(
          svc.cancelInbound({ lineId: first.lineId, quantity: 4, idempotencyKey: randomUUID() }, tx),
          BadRequestException,
          'must cancel the full received quantity of the line',
        );

        await svc.putawayFromOrigin(
          { lineId: first.lineId, toLocationId: shelf.id, quantity: 1, idempotencyKey: randomUUID() },
          tx,
        );
        await expectRejection(
          svc.cancelInbound({ lineId: first.lineId, quantity: 5, idempotencyKey: randomUUID() }, tx),
          BadRequestException,
          'cannot cancel: putaway exists; move all back to origin first',
        );

        await svc.cancelInbound({ lineId: second.lineId, quantity: 5, idempotencyKey: randomUUID() }, tx);
        await expectRejection(
          svc.cancelInbound({ lineId: second.lineId, quantity: 5, idempotencyKey: randomUUID() }, tx),
          BadRequestException,
          'already canceled',
        );
      });
    });
  });
});
