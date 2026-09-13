# 입고 커널 추출 (PR-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고 모듈에 네 벌 복제된 「저널 → 회차 → 원장 RECEIVE → 회차 라인 → 작업 로그」와 적치·회송·당일 취소를 **입고 커널** 한 클래스로 꺼내고, 기존 간편·전수·개별입고·적치·회송·취소 경로를 동작을 바꾸지 않고 커널 호출로 바꾼다.

**Architecture:** `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts` 에 `InboundReceiptKernel`(Manager 층 역할)을 두고, `InboundService` 의 라우트용 메서드는 멱등 래퍼 안에서 커널을 부르기만 한다. 커널은 트랜잭션을 스스로 열지 않고(`DbService` 미주입) 항상 호출자의 `tx` 안에서 돈다. 예정 입고 경로(`receiveFromPlan`·`closePlanItem`·계획 코드)는 PR-B 에서 통째로 사라지므로 **건드리지 않는다.**

**Tech Stack:** NestJS 11 · drizzle-orm (postgres.js) · Jest(UTC) · 로컬 compose PostgreSQL

**Spec:** `docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md` — 특히 §3(커널 경계) · §7.1(잠금) · §8(커널 인터페이스) · §11 PR-A · §12 #9·#10. 이 계획은 PR-A 만 다룬다. **PR-B·PR-C 계획은 PR-A 가 머지된 뒤** 실제 커널 코드를 근거로 따로 쓴다.

## Global Constraints

- **동작 보존 대상**: 라우트 · 요청 DTO · 응답 모양 · 원장 이벤트(transition type · reason · idempotency key 문자열) · 작업 로그(type · method · reason · 채우는 컬럼) · 멱등 endpoint 이름 · HTTP 상태와 메시지.
- **의도한 차이는 셋뿐이다** (PR 본문에 그대로 적는다):
  1. 적치·회송·당일 취소가 회차 라인을 `FOR UPDATE` 로 잠근다 — 동시 요청이 경합 대신 직렬화된다(스펙 §7.1).
  2. `POST /inbound/individual` 응답의 `receipt.totalQuantity` 가 실제 수량이 된다. 현행은 합계 UPDATE 전 행을 돌려줘 늘 `0` 이었다(`inbound.service.ts:272-283`·`:314-317`·`:329`). 소비자 0곳 확인(admin-web 은 이력 목록의 값을, 창고 앱은 입고 대기 응답의 값을 읽는다).
  3. 회송·취소에서 `originLocationId` 가 null 인 라인은 `400 'origin location missing'` 으로 거절한다. 현행은 non-null 단언(`!`)으로 통과시켰다. 커널이 만든 라인은 늘 값이 있어 도달 불가한 경로다.
- **커널은 현행 Nest 예외(`BadRequestException`·`NotFoundException`)와 메시지를 글자 그대로 옮긴다.** `@app/shared` 도메인 예외로 바꾸면 응답 `error` 필드가 `'Bad Request'` → `'BAD_REQUEST'` 로 바뀐다(`libs/shared/src/filters/http-exception.filter.ts` `getErrorCode`). 예외 통일은 이 PR 범위가 아니다.
- **커널 public 메서드의 `tx` 는 마지막 인자이고 필수다** — CLAUDE.md Transaction Propagation 규약의 예외, 사유는 스펙 §8.
- **커널 파일에서 `db.query.*`/`tx.query.*` 금지** — `select().from().where()` 빌더만(CLAUDE.md Inventory Query Rules).
- **source 가드를 켜지 않는다.** PR-A 동안 옛 예정 입고 라인도 `source='direct'` 로 쌓이므로, `cancelLine` 은 source 를 검사하지 않고 `/inbound/cancel` 은 계획 품목 복원을 계속한다(스펙 §11 PR-A 창).
- 기존 스펙의 **단언은 고치지 않는다.** 바뀌는 것은 `InboundService` 생성자 배선뿐이다(인자 하나 추가).
- 마이그레이션은 additive(enum 생성 + 컬럼 추가). 배포 순서 **`migrate → deploy`**.
- `db:generate` 는 **메인 세션 또는 사람**이 돌린다 — 서브에이전트는 돌리지 못한다.
- 통합 스펙 실행: `npm run test:core:integration:local -- <패턴>` (compose postgres `core` DB, 마이그레이션 자동 적용). **워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 앞에 붙인다.** 스펙 안에서 `dotenv.config()` 를 부르지 않고 `describeIfDb` 가드를 쓴다.
- 게이트: `npm run type-check` 0 · `npx jest --maxWorkers=2` 실패 0.
- 커밋 메시지: 한국어 conventional(`refactor(inbound): …`) + 끝 줄 `Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP`.

## File Structure

| 파일 | 상태 | 책임 |
|---|---|---|
| `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts` | 신규 | 입고 커널 — 도착 기록 · 당일 취소 · 적치 · 회송. 저널·회차·회차 라인·작업 로그·도착 원장 이벤트를 쓴다 |
| `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts` | 신규 | 커널 계약 — 호출자 tx 안에서만 쓰기 · eventKey 그대로 · 회차 라인 행 잠금 |
| `apps/core/src/modules/inventory/inbound/services/inbound.service.arrival-characterization.integration.spec.ts` | 신규 | 동작 기준선 — 추출 **전** 코드에서 초록, 추출 뒤에도 단언 그대로 초록 |
| `apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts` | 신규 | 커널 경계 가드 — import 방향 · `db.query` 금지 · 트랜잭션 자가 개시 금지 |
| `apps/core/src/modules/inventory/arch-spec.helpers.ts` | 신규 | arch 스펙 공용 `collectTsFiles` · `moduleSpecifiers` |
| `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` | 수정 | 헬퍼를 공용 파일에서 import |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 수정 | `inboundReceiptSourceEnum` + `inbound_receipt_lines.source` |
| `apps/core/drizzle/<timestamp>_add-inbound-receipt-source.sql` (+ `meta/`) | 생성 | 위 스키마의 마이그레이션 |
| `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` | 수정 | 간편·전수·개별·적치·회송·취소가 커널 위임. 생성자에 커널 추가 |
| `apps/core/src/modules/inventory/inbound/inbound.module.ts` | 수정 | 커널 provider 등록·export |
| `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts` | 수정 | `makeInboundReceiptKernel` · `InboundService` 배선 |
| 생성자 배선 7곳 | 수정 | `inbound.service.idempotency.spec.ts` · `inbound-plan-port-invariant.integration.spec.ts` · `core/services/inventory-idempotency.integration.spec.ts` · `procurement/services/purchase-order-single-plan.integration.spec.ts` · `procurement/services/purchase-order-line-execution.integration.spec.ts` · `scripts/local/seed-dev-core/index.ts` · `scripts/qa/seed-qa7-dev.ts` |

---

### Task 1: 동작 기준선 스펙 — 추출 전 코드에서 초록

이 태스크는 **특성화(characterization) 테스트**다. 「실패하는 테스트 먼저」가 아니라 **현행 코드에서 통과**해야 한다. 통과하지 않으면 코드가 아니라 스펙의 가정이 틀린 것이다 — 단언을 현행 동작에 맞춰 고친다(이 태스크에서만 허용).

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/services/inbound.service.arrival-characterization.integration.spec.ts`

**Interfaces:**
- Consumes: `makeInboundService(db)`·`inRollbackTx(db, fn)`·`Database` (`__fixtures__/inbound-harness.ts`, 기존)
- Produces: Task 4·5·6 이 「단언 수정 없이 초록」을 확인하는 기준선

- [ ] **Step 1: 스펙 작성**

```ts
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
      .where(and(eq(wmsTables.locations.warehouseId, warehouseId), eq(wmsTables.locations.systemRole, 'inbound_default')))
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
  async function expectRejection(promise: Promise<unknown>, type: abstract new (...args: never[]) => Error, message: string) {
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
          result.lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity, originLocationId: l.originLocationId, memo: l.memo })),
        ).toEqual([
          { skuId: skuA.id, quantity: 3, originLocationId: zoneId, memo: '첫 줄' },
          { skuId: skuB.id, quantity: 2, originLocationId: zoneId, memo: null },
        ]);

        const journalId = result.receipt.journalId ?? '';
        const [journal] = await tx
          .select()
          .from(wmsTables.stockJournals)
          .where(eq(wmsTables.stockJournals.id, journalId))
          .limit(1);
        expect(journal?.sourceType).toBe('inbound');

        const e0 = await eventByKey(tx, `inbound.simple:${key}:0`);
        const e1 = await eventByKey(tx, `inbound.simple:${key}:1`);
        expect(e0).toMatchObject({ transitionType: 'RECEIVE', reason: 'simple_inbound', quantity: 3, journalId, toLocationId: zoneId });
        expect(e1).toMatchObject({ transitionType: 'RECEIVE', reason: 'simple_inbound', quantity: 2, journalId, toLocationId: zoneId });
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
          { warehouseId: warehouse.id, skuId: skuA.id, quantity: 4, locationId: shelf.id, memo: '개별', idempotencyKey: key },
          tx,
        );

        // 응답의 receipt.totalQuantity 는 기준선에서 제외한다 — PR-A 가 의도적으로 0 → 4 로 바꾼다(계획서 Global Constraints 2).
        expect(result.receipt).toMatchObject({ method: 'individual', warehouseId: warehouse.id, locationId: shelf.id });
        expect(result.line).toMatchObject({ skuId: skuA.id, quantity: 4, originLocationId: shelf.id, memo: '개별' });
        expect((await receiptRow(tx, result.receipt.id))?.totalQuantity).toBe(4);

        const event = await eventByKey(tx, `inbound.individual:${key}`);
        expect(event).toMatchObject({ transitionType: 'RECEIVE', reason: 'individual_inbound', quantity: 4, toLocationId: shelf.id });
        expect(result.line.eventId).toBe(event?.id);
        expect(await onHand(tx, skuA.id, warehouse.id, shelf.id)).toBe(4);

        const logs = await workLogs(tx, result.receipt.id);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ type: 'INBOUND', toLocationId: shelf.id, quantity: 4, method: 'individual', reason: 'individual_inbound' });
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
          svc.simpleInbound({ warehouseId: warehouse.id, items: [{ skuId: missing, quantity: 1 }], idempotencyKey: randomUUID() }, tx),
          NotFoundException,
          `SKU ${missing} not found`,
        );
        await expectRejection(
          svc.individualInbound({ warehouseId: warehouse.id, skuId: missing, quantity: 1, idempotencyKey: randomUUID() }, tx),
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
      return { receiptId: result.receipt.id, lineId: result.lines[0]?.id ?? '', zoneId: result.receipt.locationId ?? '' };
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
          svc.putawayFromOrigin({ lineId, toLocationId: foreignShelf.id, quantity: 1, idempotencyKey: randomUUID() }, tx),
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
        expect(event).toMatchObject({ transitionType: 'ADJUST_DOWN', reason: 'RETURN', quantity: 1, fromLocationId: zoneId });

        const logs = (await workLogs(tx, receiptId)).filter((l) => l.type === 'RETURN');
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ lineId, skuId: skuA.id, fromLocationId: zoneId, quantity: 1, reason: '불량', eventId: event?.id });
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

        await expect(
          svc.cancelInbound({ lineId, quantity: 5, idempotencyKey: randomUUID() }, tx),
        ).resolves.toEqual({ success: true });

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
        expect(logs[0]).toMatchObject({ lineId, skuId: skuA.id, fromLocationId: zoneId, quantity: 5, reason: 'CANCEL', eventId: reversal?.id });
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

        await svc.putawayFromOrigin({ lineId: first.lineId, toLocationId: shelf.id, quantity: 1, idempotencyKey: randomUUID() }, tx);
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
```

- [ ] **Step 2: 현행 코드에서 실행해 초록인지 본다**

Run: `npm run test:core:integration:local -- arrival-characterization`
Expected: PASS — 12 tests. 실패하면 **스펙의 가정이 틀린 것**이다. 현행 코드(`inbound.service.ts`)를 읽고 단언을 현행 동작에 맞춘다. 코드를 고치지 않는다.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/inbound.service.arrival-characterization.integration.spec.ts
git commit -m "test(inbound): 입고 경로 동작 기준선 — 커널 추출 전 현행 동작을 고정한다

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 2: 회차 라인 `source` 컬럼 (스키마 + 마이그레이션)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (enum 선언부 `inboundReceiptStatusEnum` 옆 · `inboundReceiptLines` 테이블)
- Create (생성): `apps/core/drizzle/<timestamp>_add-inbound-receipt-source.sql` + `apps/core/drizzle/meta/*`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.arrival-characterization.integration.spec.ts`

**Interfaces:**
- Produces: `inboundReceiptSourceEnum` (`'direct' | 'purchase_order'`), `InboundReceiptLine.source`

- [ ] **Step 1: 실패하는 단언 추가** — 기준선 스펙의 첫 테스트(간편입고)에서 `result.lines.map(...)` 단언 바로 뒤에 넣는다.

```ts
        // PR-A 부터 회차 라인은 출처를 든다. 간편입고는 문서에 묶이지 않는다.
        expect(result.lines.map((l) => l.source)).toEqual(['direct', 'direct']);
```

- [ ] **Step 2: 타입체크가 실패하는지 본다**

Run: `npm run type-check`
Expected: FAIL — `Property 'source' does not exist on type`.

- [ ] **Step 3: 스키마 수정**

`inboundReceiptStatusEnum` 선언 바로 아래에 추가:

```ts
/**
 * 회차 라인이 문서 정산에 묶였는가. 커널은 **어느 문서인지는 모르고** 묶였다는 사실만 안다 —
 * 연결은 문서 쪽 링크 테이블이 든다(스펙 §3.2).
 * 처음부터 두 값으로 만든다: drizzle 마이그레이터는 대기 마이그레이션 전부를 한 트랜잭션으로 돌고,
 * `ALTER TYPE … ADD VALUE` 로 넣은 값은 그 트랜잭션 안에서 쓸 수 없다(스펙 §5.1 D9).
 * `purchase_order` 를 쓰는 코드는 PR-B 에서 생긴다.
 */
export const inboundReceiptSourceEnum = pgEnum('inbound_receipt_source', ['direct', 'purchase_order']);
```

`inboundReceiptLines` 의 `planItemId` 컬럼 바로 위에 추가:

```ts
    source: inboundReceiptSourceEnum('source').notNull().default('direct'),
```

- [ ] **Step 4: 마이그레이션 생성 — 메인 세션 또는 사람이 실행한다(서브에이전트 불가)**

Run: `npm run db:generate:core -- --name add-inbound-receipt-source`
Expected: `apps/core/drizzle/<timestamp>_add-inbound-receipt-source.sql` 이 **정확히 아래 두 문장만** 담는다. 다른 테이블의 diff 가 섞이면 멈추고 스냅샷 체인부터 조사한다(core 스냅샷 체인 복구 전력 `ccd7f6b8c`).

```sql
CREATE TYPE "public"."inbound_receipt_source" AS ENUM('direct', 'purchase_order');--> statement-breakpoint
ALTER TABLE "inbound_receipt_lines" ADD COLUMN "source" "inbound_receipt_source" DEFAULT 'direct' NOT NULL;
```

- [ ] **Step 5: 타입체크와 기준선 스펙이 초록인지 본다**

Run: `npm run type-check && npm run test:core:integration:local -- arrival-characterization`
Expected: type-check 0 에러 · 기준선 12 tests PASS (러너가 `core` DB 에 마이그레이션을 적용한다).

- [ ] **Step 6: dev DB 에도 적용** (스모크용 — 앱의 `apps/core/.env` 는 `dev_core` 를 본다)

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dev_core npx drizzle-kit migrate --config apps/core/drizzle.config.ts`
Expected: 새 마이그레이션 1건 적용.

- [ ] **Step 7: 커밋** — `schema.ts` + SQL + `meta/` 를 **한 커밋에**(CLAUDE.md).

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/ apps/core/src/modules/inventory/inbound/services/inbound.service.arrival-characterization.integration.spec.ts
git commit -m "feat(inbound): 회차 라인 source 컬럼 — 문서 정산에 묶였는지를 커널이 알게 한다

additive 마이그레이션(enum 생성 + 기본값 direct 컬럼). 배포 순서 migrate → deploy.

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 3: 커널 `recordArrival`

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`
- Create: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts`
- Modify: `apps/core/src/modules/inventory/inbound/inbound.module.ts`

**Interfaces:**
- Consumes: `InventoryCommandService.receive(input, tx) → { eventId }` · `LocationService.ensureSystemLocations(warehouseId, tx)` · `LocationService.getSystemLocationByRole(warehouseId, 'inbound_default', tx)` · `StockEventStore`
- Produces:

```ts
export type DirectArrivalMethod = 'simple' | 'simple_fullscan' | 'individual';
export interface ArrivalLineInput { skuId: string; quantity: number; memo?: string; eventKey: string }
export interface RecordArrivalInput {
  source: 'direct';
  method: DirectArrivalMethod;
  warehouseId: string;
  locationId?: string | null;
  reason: string;
  lines: ArrivalLineInput[];
}
export interface RecordArrivalResult { receipt: InboundReceipt; lines: InboundReceiptLine[] }
class InboundReceiptKernel {
  constructor(command: InventoryCommandService, location: LocationService, eventStore: StockEventStore);
  recordArrival(input: RecordArrivalInput, tx: DbTx): Promise<RecordArrivalResult>;
}
// harness
export function makeInboundReceiptKernel(database: Database): InboundReceiptKernel;
```

> 스펙 §8 과의 차이(의도): 원장 이벤트 키를 「뿌리 + 순번」이 아니라 **라인별 `eventKey`** 로 받는다. 개별입고의 현행 키는 순번이 없어(`inbound.individual:${key}`) 뿌리 방식으로는 문자열을 보존할 수 없다. 반환도 id 만이 아니라 **행 전체**다 — 간편·개별입고 응답이 행 전체를 돌려주기 때문이다. PR-B 의 `{ source: 'purchase_order' }` 갈래는 PR-B 가 이 유니온에 더한다.

- [ ] **Step 1: 실패하는 커널 스펙 작성**

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from './inbound-receipt.kernel';
import { Database, inRollbackTx, makeInboundReceiptKernel } from '../services/__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 입고 커널의 계약. 동작 세부(이벤트·작업 로그 모양)는 InboundService 기준선 스펙이 고정한다 —
 * 여기서는 커널만의 약속을 본다: 호출자 트랜잭션 안에서만 쓴다 · eventKey 를 그대로 쓴다 ·
 * 회차 라인 행을 잠근다(Task 5·6).
 *
 *   npm run test:core:integration:local -- inbound-receipt.kernel
 */
describeIfDb('InboundReceiptKernel (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let kernel: InboundReceiptKernel;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    kernel = makeInboundReceiptKernel(db);
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedWarehouseAndSku(tx: DbTx, suffix: string) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `kernel-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `kernel-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'kernel sku', code: `KERNEL-${suffix}`, holderId: holder.id })
      .returning();
    return { warehouseId: warehouse.id, skuId: sku.id };
  }

  describe('recordArrival', () => {
    it('합계를 반영한 회차와 source 를 든 라인을 돌려주고, 라인별 eventKey 를 그대로 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);

        const result = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId,
            reason: 'kernel_spec',
            lines: [
              { skuId, quantity: 2, eventKey: `kernel-spec:${suffix}:a` },
              { skuId, quantity: 5, memo: 'm', eventKey: `kernel-spec:${suffix}:b` },
            ],
          },
          tx,
        );

        expect(result.receipt).toMatchObject({ method: 'simple', warehouseId, status: 'posted', totalQuantity: 7 });
        expect(result.lines.map((l) => [l.quantity, l.source, l.memo])).toEqual([
          [2, 'direct', null],
          [5, 'direct', 'm'],
        ]);
        const keys = await tx
          .select({ key: wmsTables.stockEvents.idempotencyKey, id: wmsTables.stockEvents.id })
          .from(wmsTables.stockEvents)
          .where(eq(wmsTables.stockEvents.journalId, result.receipt.journalId ?? ''));
        expect(keys.map((k) => k.key).sort()).toEqual([`kernel-spec:${suffix}:a`, `kernel-spec:${suffix}:b`]);
      });
    });

    it('지정 로케이션을 그대로 쓴다', async () => {
      await inRollbackTx(db, async (tx) => {
        const suffix = randomUUID();
        const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);
        const [shelf] = await tx
          .insert(wmsTables.locations)
          .values({ warehouseId, code: `K-${suffix.slice(0, 6)}`, locationType: 'zone', isSystem: false, systemRole: null, isActive: true })
          .returning();

        const result = await kernel.recordArrival(
          {
            source: 'direct',
            method: 'individual',
            warehouseId,
            locationId: shelf.id,
            reason: 'kernel_spec',
            lines: [{ skuId, quantity: 1, eventKey: `kernel-spec:${suffix}` }],
          },
          tx,
        );

        expect(result.receipt.locationId).toBe(shelf.id);
        expect(result.lines[0]?.originLocationId).toBe(shelf.id);
      });
    });

    it('호출자 트랜잭션 밖으로 쓰기가 새지 않는다 — 롤백하면 회차가 남지 않는다', async () => {
      const suffix = randomUUID();
      let warehouseId = '';
      await inRollbackTx(db, async (tx) => {
        const seeded = await seedWarehouseAndSku(tx, suffix);
        warehouseId = seeded.warehouseId;
        await kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId,
            reason: 'kernel_spec',
            lines: [{ skuId: seeded.skuId, quantity: 1, eventKey: `kernel-spec:${suffix}` }],
          },
          tx,
        );
      });

      const leaked = await db
        .select({ id: wmsTables.inboundReceipts.id })
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.warehouseId, warehouseId));
      expect(leaked).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: 실패하는지 본다**

Run: `npm run type-check`
Expected: FAIL — `Cannot find module './inbound-receipt.kernel'`, `makeInboundReceiptKernel` 없음.

- [ ] **Step 3: 커널 작성**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import type { InboundReceipt, InboundReceiptLine } from '../../schema/inventory.schema';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';

export type DirectArrivalMethod = 'simple' | 'simple_fullscan' | 'individual';

export interface ArrivalLineInput {
  skuId: string;
  quantity: number;
  memo?: string;
  /** 원장 이벤트 멱등 키. 호출자가 현행 문자열을 그대로 넘긴다 — 커널은 가공하지 않는다. */
  eventKey: string;
}

export interface RecordArrivalInput {
  source: 'direct';
  method: DirectArrivalMethod;
  warehouseId: string;
  /** 비우면 입고기본존. 지정값은 검증하지 않는다(현행 개별입고와 같다). */
  locationId?: string | null;
  /** 원장 이벤트와 작업 로그의 reason. */
  reason: string;
  lines: ArrivalLineInput[];
}

export interface RecordArrivalResult {
  receipt: InboundReceipt;
  lines: InboundReceiptLine[];
}

/**
 * 입고 커널 — 창고에 물건이 들어온 사실과 그 뒤 현장 처리를 소유한다(스펙 §3).
 *
 * 문서(발주·이동 지시서)의 정산은 모른다. 문서가 이 커널을 부르고, 커널은 문서를 부르지 않는다
 * (`inbound-kernel-boundary.arch.spec.ts` 가 import 방향을 잠근다).
 *
 * 🔴 **트랜잭션을 스스로 열지 않는다** — `DbService` 를 주입받지 않는다. 모든 public 메서드의 `tx` 는
 * 마지막 인자이고 **필수**다(CLAUDE.md «tx?: DbTx as last param» 의 예외). 선택 인자면 호출자가 빠뜨렸을 때
 * 원장·회차는 커밋되고 문서 정산은 롤백되는 식으로 원자성이 조용히 깨진다. 스펙 §8.
 *
 * 🔴 **잠금 순서**: 호출자(문서)가 문서 행 → 문서 라인을 먼저 잡고 커널을 부른다. 커널은 회차 라인과
 * 원장만 잠그고 문서 행을 절대 잠그지 않는다 — 역방향 간선이 없으므로 교착 사이클이 생기지 않는다(스펙 §7.1).
 *
 * 예외는 현행 Nest 예외와 메시지를 글자 그대로 옮긴다 — 응답 `error` 필드 보존(계획서 Global Constraints).
 */
@Injectable()
export class InboundReceiptKernel {
  constructor(
    private readonly command: InventoryCommandService,
    private readonly location: LocationService,
    private readonly eventStore: StockEventStore,
  ) {}

  /** 도착 한 번 = 저널 1 · 회차 1 · 라인 N · RECEIVE 이벤트 N · 작업 로그 1. */
  async recordArrival(input: RecordArrivalInput, tx: DbTx): Promise<RecordArrivalResult> {
    const locationId = await this.resolveLocation(input.warehouseId, input.locationId ?? null, tx);

    const [journal] = await tx.insert(wmsTables.stockJournals).values({ sourceType: 'inbound' }).returning();

    const [receipt] = await tx
      .insert(wmsTables.inboundReceipts)
      .values({
        method: input.method,
        warehouseId: input.warehouseId,
        locationId,
        occurredAt: new Date(),
        status: 'posted',
        totalQuantity: 0,
        journalId: journal.id,
      })
      .returning();

    const lines: InboundReceiptLine[] = [];
    let totalQuantity = 0;
    for (const item of input.lines) {
      const { eventId } = await this.command.receive(
        {
          skuId: item.skuId,
          toWarehouseId: input.warehouseId,
          toLocationId: locationId,
          quantity: item.quantity,
          occurredAt: new Date(),
          reason: input.reason,
          journalId: journal.id,
          idempotencyKey: item.eventKey,
        },
        tx,
      );

      const [line] = await tx
        .insert(wmsTables.inboundReceiptLines)
        .values({
          receiptId: receipt.id,
          skuId: item.skuId,
          quantity: item.quantity,
          originLocationId: locationId,
          eventId: eventId ?? null,
          memo: item.memo,
          source: input.source,
        })
        .returning();

      lines.push(line);
      totalQuantity += item.quantity;
    }

    const [updatedReceipt] = await tx
      .update(wmsTables.inboundReceipts)
      .set({ totalQuantity })
      .where(eq(wmsTables.inboundReceipts.id, receipt.id))
      .returning();

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'INBOUND',
      receiptId: receipt.id,
      warehouseId: input.warehouseId,
      toLocationId: locationId,
      quantity: totalQuantity,
      method: input.method,
      reason: input.reason,
    });

    return { receipt: updatedReceipt, lines };
  }

  private async resolveLocation(warehouseId: string, locationId: string | null, tx: DbTx): Promise<string> {
    if (locationId) return locationId;
    await this.location.ensureSystemLocations(warehouseId, tx);
    const inboundZone = await this.location.getSystemLocationByRole(warehouseId, 'inbound_default', tx);
    if (!inboundZone) throw new BadRequestException('입고 기본존이 존재하지 않습니다.');
    return inboundZone.id;
  }
}
```

> `eventStore` 는 Task 5 의 취소(`reverseEvent`)와 Task 6 의 회송(`createEvent`)이 쓴다. 생성자 모양을 Task 3 에서 확정해 배선 변경(하네스·실조립 3곳)을 한 번으로 끝낸다. 이 저장소의 tsconfig 에는 `noUnusedLocals` 가 없어 Task 3 시점의 미사용 private 필드가 게이트를 막지 않는다.

- [ ] **Step 4: 하네스에 커널 조립 추가** — `inbound-harness.ts`

import 추가:

```ts
import { InboundReceiptKernel } from '../../kernel/inbound-receipt.kernel';
```

`makeInboundPutawayReader` 바로 위에 추가:

```ts
export function makeInboundReceiptKernel(database: Database): InboundReceiptKernel {
  const { command, location, eventStore } = buildWiring(database);
  return new InboundReceiptKernel(command, location, eventStore);
}
```

- [ ] **Step 5: 모듈 등록** — `inbound.module.ts`

```ts
import { InboundReceiptKernel } from './kernel/inbound-receipt.kernel';
```

`providers` 에 `InboundReceiptKernel,` 을 `InboundPutawayReader,` 다음 줄에 추가하고, `exports: [InboundService]` 를 `exports: [InboundService, InboundReceiptKernel]` 로 바꾼다(PR-B 의 조달이 커널을 쓴다).

- [ ] **Step 6: 커널 스펙이 초록인지 본다**

Run: `npm run type-check && npm run test:core:integration:local -- inbound-receipt.kernel`
Expected: type-check 0 · 3 tests PASS.

- [ ] **Step 7: 부팅 DI 확인** — `nest build` 는 DI 를 검증하지 않는다. 앱 모듈 컴파일로 provider 해석을 본다(저장소 안에 두어야 모듈 해석이 된다).

`apps/core/scripts/tmp-di-check.ts` 를 만들고:

```ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.close();
  console.log('DI OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `npx dotenv -e apps/core/.env -- npx ts-node -r tsconfig-paths/register --transpile-only apps/core/scripts/tmp-di-check.ts`
Expected: `DI OK`. 확인 후 **파일을 지운다**(커밋하지 않는다). `AppModule` 경로가 다르면 `apps/core/src/main.ts` 의 import 를 따른다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/kernel/ apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts apps/core/src/modules/inventory/inbound/inbound.module.ts
git commit -m "feat(inbound): 입고 커널 recordArrival — 저널·회차·라인·RECEIVE·작업 로그를 한 곳에서 쓴다

커널은 트랜잭션을 스스로 열지 않고 tx 를 필수·마지막 인자로 받는다(규약 예외, 스펙 §8).

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 4: 간편·전수·개별입고를 커널 위임으로

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (생성자 `:42-51`, `simpleInbound` `:88-172`, `simpleInboundFullscan` `:175-251`, `individualInbound` `:254-331`)
- Modify: `apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts` (`makeInboundService`)
- Modify (배선만): `inbound.service.idempotency.spec.ts:10-18` · `inbound-plan-port-invariant.integration.spec.ts:47-57` · `core/services/inventory-idempotency.integration.spec.ts:48-56` · `procurement/services/purchase-order-single-plan.integration.spec.ts:77-85` · `procurement/services/purchase-order-line-execution.integration.spec.ts:78-86` · `scripts/local/seed-dev-core/index.ts:110-118` · `scripts/qa/seed-qa7-dev.ts:78-86`

**Interfaces:**
- Consumes: `InboundReceiptKernel.recordArrival(input, tx)` (Task 3)
- Produces: `InboundService` 생성자 = `(dbService, skuCatalogService, commandService, locationService, eventStore, idempotency, poClosure, receiptKernel)` — **마지막에 커널 추가**

- [ ] **Step 1: 개별입고 응답 변경을 먼저 단언한다(실패 테스트)** — 기준선 스펙의 「개별입고: 지정 로케이션을 그대로 쓰고…」 테스트 끝에 추가. 기준선 단언은 건드리지 않고 **새 단언을 더한다.**

```ts
        // 의도한 변경(계획서 Global Constraints 2): 응답 회차가 합계 반영 후 행이다. 현행은 0 이었다.
        expect(result.receipt.totalQuantity).toBe(4);
```

- [ ] **Step 2: 실패하는지 본다**

Run: `npm run test:core:integration:local -- arrival-characterization`
Expected: FAIL 1건 — `expected 4, received 0`.

- [ ] **Step 3: `InboundService` 수정**

import 추가:

```ts
import { InboundReceiptKernel } from '../kernel/inbound-receipt.kernel';
```

생성자 마지막 인자 추가(`poClosure` 다음):

```ts
    @Inject(PURCHASE_ORDER_CLOSURE)
    private readonly poClosure: PurchaseOrderClosurePort,
    private readonly receiptKernel: InboundReceiptKernel,
  ) {}
```

`simpleInbound`·`simpleInboundFullscan`·`individualInbound` 세 메서드 본문 전체를 아래로 교체:

```ts
  // 간편입고: 지정 창고의 입고기본존에 여러 SKU를 즉시 입고
  async simpleInbound(dto: SimpleInboundDto, tx?: DbTx) {
    return this.idempotency.withIdempotency(
      'inbound.simple',
      dto.idempotencyKey,
      dto,
      async (tx) => {
        await this.assertSkusExist(
          dto.items.map((item) => item.skuId),
          tx,
        );
        return this.receiptKernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId: dto.warehouseId,
            reason: 'simple_inbound',
            lines: dto.items.map((item, i) => ({
              skuId: item.skuId,
              quantity: item.quantity,
              memo: item.memo,
              eventKey: `inbound.simple:${dto.idempotencyKey}:${i}`,
            })),
          },
          tx,
        );
      },
      tx,
    );
  }

  // 전수조사 간편입고: 처리 로직은 동일하나 회차/로그의 method를 구분
  async simpleInboundFullscan(dto: SimpleInboundDto, tx?: DbTx) {
    return this.idempotency.withIdempotency(
      'inbound.simple-fullscan',
      dto.idempotencyKey,
      dto,
      async (tx) => {
        await this.assertSkusExist(
          dto.items.map((item) => item.skuId),
          tx,
        );
        return this.receiptKernel.recordArrival(
          {
            source: 'direct',
            method: 'simple_fullscan',
            warehouseId: dto.warehouseId,
            reason: 'simple_inbound_fullscan',
            lines: dto.items.map((item, i) => ({
              skuId: item.skuId,
              quantity: item.quantity,
              memo: item.memo,
              eventKey: `inbound.simple-fullscan:${dto.idempotencyKey}:${i}`,
            })),
          },
          tx,
        );
      },
      tx,
    );
  }

  // 개별입고: 단일 SKU를 지정 로케이션(옵션, 없으면 기본입고존)으로 입고
  async individualInbound(dto: IndividualInboundDto, tx?: DbTx) {
    return this.idempotency.withIdempotency(
      'inbound.individual',
      dto.idempotencyKey,
      dto,
      async (tx) => {
        await this.assertSkusExist([dto.skuId], tx);
        const { receipt, lines } = await this.receiptKernel.recordArrival(
          {
            source: 'direct',
            method: 'individual',
            warehouseId: dto.warehouseId,
            locationId: dto.locationId ?? null,
            reason: 'individual_inbound',
            // 개별입고의 현행 이벤트 키는 순번이 없다 — 문자열을 그대로 보존한다.
            lines: [{ skuId: dto.skuId, quantity: dto.quantity, memo: dto.memo, eventKey: `inbound.individual:${dto.idempotencyKey}` }],
          },
          tx,
        );
        return { receipt, line: lines[0] };
      },
      tx,
    );
  }

  /** 입고 전 SKU 존재 확인 — 현행 404 계약(`SKU ${id} not found`)을 유지한다. */
  private async assertSkusExist(skuIds: string[], tx: DbTx): Promise<void> {
    for (const skuId of skuIds) {
      const sku = await this.skuCatalogService.findById(skuId, tx);
      if (!sku) throw new NotFoundException(`SKU ${skuId} not found`);
    }
  }
```

- [ ] **Step 4: 하네스 배선** — `inbound-harness.ts` 의 `makeInboundService` 를 교체:

```ts
export function makeInboundService(database: Database): InboundService {
  const { dbService, skuCatalog, command, location, eventStore, idempotency } = buildWiring(database);
  return new InboundService(
    dbService,
    skuCatalog as never,
    command,
    location,
    eventStore,
    idempotency,
    new PurchaseOrderClosureAdapter(),
    new InboundReceiptKernel(command, location, eventStore),
  );
}
```

- [ ] **Step 5: 나머지 배선 6곳 + 스크립트 2곳** — 각 `new InboundService(` 호출의 `new PurchaseOrderClosureAdapter(),` 다음 줄에 인자 하나를 더한다.

`{} as never` 로 대역하는 네 곳(`inbound.service.idempotency.spec.ts`, `inbound-plan-port-invariant.integration.spec.ts`, `purchase-order-single-plan.integration.spec.ts`, `purchase-order-line-execution.integration.spec.ts`) — 커널 본문에 도달하지 않는 경로라 대역한다:

```ts
      new PurchaseOrderClosureAdapter(),
      {} as never,
    );
```

실제 조립하는 세 곳:

`core/services/inventory-idempotency.integration.spec.ts` — import `import { InboundReceiptKernel } from '../../inbound/kernel/inbound-receipt.kernel';` 후:

```ts
      new PurchaseOrderClosureAdapter(),
      new InboundReceiptKernel(command, location, eventStore),
    );
```

`scripts/local/seed-dev-core/index.ts` — import `import { InboundReceiptKernel } from '../../../apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel';` 후:

```ts
      new PurchaseOrderClosureAdapter(),
      new InboundReceiptKernel(wired.command, wired.location, wired.eventStore),
    );
```

`scripts/qa/seed-qa7-dev.ts` — import `import { InboundReceiptKernel } from '../../apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel';` 후:

```ts
    new PurchaseOrderClosureAdapter(),
    new InboundReceiptKernel(command, location, eventStore),
  );
```

- [ ] **Step 6: 게이트와 기준선 확인**

Run: `npm run type-check && npx jest --maxWorkers=2 inbound && npm run test:core:integration:local -- "(arrival-characterization|inbound-receipt.kernel|inventory-idempotency.integration|inbound-putaway.reader|same-day-cancel|cancel-plan-restore)"`
Expected: type-check 0 · 단위 PASS · 통합 전부 PASS(기준선 12 tests, 개별입고 새 단언 포함). **기준선의 기존 단언을 고쳤다면 이 태스크는 실패다.**

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/ apps/core/src/modules/inventory/core/services/inventory-idempotency.integration.spec.ts apps/core/src/modules/inventory/procurement/services/purchase-order-single-plan.integration.spec.ts apps/core/src/modules/inventory/procurement/services/purchase-order-line-execution.integration.spec.ts scripts/local/seed-dev-core/index.ts scripts/qa/seed-qa7-dev.ts
git commit -m "refactor(inbound): 간편·전수·개별입고를 입고 커널 위임으로 — 세 벌 복제 제거

라우트·응답·원장 이벤트 키·작업 로그 보존(기준선 스펙). 의도한 차이 하나:
개별입고 응답 receipt.totalQuantity 가 0 이 아니라 실제 수량이 된다.

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 5: 커널 `cancelLine` — 회차 라인 `FOR UPDATE`

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`cancelInbound` `:1190-1296`)

**Interfaces:**
- Consumes: `StockEventStore.reverseEvent(eventId, 'CANCEL', tx) → { id } | null` · `isTodaySeoul(instant)`
- Produces:

```ts
export interface CancelLineInput { receiptLineId: string; quantity?: number }
cancelLine(input: CancelLineInput, tx: DbTx): Promise<InboundReceiptLine>;  // 잠근 시점의 라인(갱신 전)
```

- [ ] **Step 1: 실패하는 잠금 스펙 추가** — 커널 스펙 파일에 추가. 두 트랜잭션이 같은 행을 보려면 시드가 **커밋**돼야 한다. 행은 고유 접미사로 남는다(`scripts/local/test-core-integration-local.sh` 머리 주석의 커밋형 스펙 선례).

탐침은 postgres.js 태그 템플릿으로 보낸다. `describeIfDb` 블록 안, 기존 `afterAll` 아래에 추가:

```ts
  let probe: postgres.Sql;
  beforeAll(() => {
    probe = postgres(DATABASE_URL as string, { max: 1 });
  });
  afterAll(async () => {
    await probe.end();
  });

  class Rollback extends Error {}

  /** 커밋된 창고·SKU·로케이션·간편입고 5개. 잠금 스펙 전용 — 행이 남는다. */
  async function seedCommittedLine() {
    const suffix = randomUUID();
    return db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      const { warehouseId, skuId } = await seedWarehouseAndSku(tx, suffix);
      const [shelf] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId, code: `KL-${suffix.slice(0, 6)}`, locationType: 'zone', isSystem: false, systemRole: null, isActive: true })
        .returning();
      const { lines } = await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId,
          reason: 'kernel_lock_spec',
          lines: [{ skuId, quantity: 5, eventKey: `kernel-lock-spec:${suffix}` }],
        },
        tx,
      );
      return { lineId: lines[0]?.id ?? '', shelfId: shelf.id };
    });
  }

  /**
   * `hold` 를 연 트랜잭션 안에서 실행해 둔 채로, 다른 커넥션이 같은 회차 라인을 NOWAIT 로 잠가 본다.
   * 55P03(lock_not_available)이면 `hold` 가 그 행을 잠근 것이다. 끝나면 롤백한다.
   */
  async function expectLineLockedDuring(lineId: string, hold: (tx: DbTx) => Promise<unknown>) {
    let entered: () => void = () => undefined;
    const enteredSignal = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const releaseSignal = new Promise<void>((resolve) => {
      release = resolve;
    });

    const held = db.transaction(async (trx) => {
      await hold(trx as unknown as DbTx);
      entered();
      await releaseSignal;
      throw new Rollback('intentional rollback');
    });

    // hold 가 먼저 실패하면 신호를 기다리지 말고 바로 드러낸다.
    await Promise.race([enteredSignal, held]);
    await expect(probe`SELECT id FROM inbound_receipt_lines WHERE id = ${lineId} FOR UPDATE NOWAIT`).rejects.toMatchObject({
      code: '55P03',
    });
    release();
    await expect(held).rejects.toThrow(Rollback);
  }

  describe('회차 라인 잠금 (스펙 §7.1)', () => {
    it('cancelLine 은 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const { lineId } = await seedCommittedLine();
      await expectLineLockedDuring(lineId, (tx) => kernel.cancelLine({ receiptLineId: lineId }, tx));
    });
  });
```

- [ ] **Step 2: 실패하는지 본다**

Run: `npm run type-check`
Expected: FAIL — `Property 'cancelLine' does not exist on type 'InboundReceiptKernel'`.

- [ ] **Step 3: 커널에 `cancelLine` 과 공용 헬퍼 추가**

커널 파일 import 를 교체:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import type { InboundReceipt, InboundReceiptLine } from '../../schema/inventory.schema';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { isTodaySeoul } from '../../shared/services/time.util';
```

`RecordArrivalResult` 아래에 타입 추가:

```ts
export interface CancelLineInput {
  receiptLineId: string;
  /** 넘기면 라인 수량과 같은지 본다 — 당일 취소는 전량만 허용한다(현행 `/inbound/cancel` 계약). */
  quantity?: number;
}
```

`recordArrival` 과 `resolveLocation` 사이에 추가:

```ts
  /**
   * 당일·전량 취소. 원 RECEIVE 이벤트를 역분개하고, 회차의 모든 라인이 취소되면 회차를 voided 로 돌린다.
   * 회차 라인을 **FOR UPDATE** 로 잠근다 — 현행은 잠그지 않고 읽어 적치·회송과 동시에 들어오면 카운터
   * 검증이 샜다(스펙 §7.1).
   *
   * PR-A 에서는 source 를 검사하지 않는다 — 옛 예정 입고 라인도 `direct` 로 쌓이는 기간이라서다(스펙 §11 PR-A 창).
   * 반환은 **잠근 시점(갱신 전)의 라인**이다. 호출자가 예정 연계(`planItemId`)를 되돌리는 데 쓴다(PR-B 에서 사라진다).
   */
  async cancelLine(input: CancelLineInput, tx: DbTx): Promise<InboundReceiptLine> {
    const line = await this.lockLine(input.receiptLineId, tx);
    const receipt = await this.loadReceipt(line.receiptId, tx);
    const originLocationId = this.requireOrigin(line);

    if (input.quantity !== undefined && input.quantity !== line.quantity) {
      throw new BadRequestException('must cancel the full received quantity of the line');
    }
    if ((line.putawayFromOriginQty ?? 0) > 0) {
      throw new BadRequestException('cannot cancel: putaway exists; move all back to origin first');
    }
    if ((line.returnedQty ?? 0) > 0) {
      throw new BadRequestException('cannot cancel: returns exist; cancel returns first');
    }
    if ((line.canceledQty ?? 0) > 0) {
      throw new BadRequestException('already canceled');
    }
    if (!isTodaySeoul(receipt.occurredAt)) {
      throw new BadRequestException('cancel is allowed only on the same day (Asia/Seoul)');
    }

    const onHand = await this.onHandAt({ skuId: line.skuId, warehouseId: receipt.warehouseId, locationId: originLocationId }, tx);
    if (onHand < line.quantity) {
      throw new BadRequestException('insufficient on-hand at origin to cancel');
    }
    if (!line.eventId) {
      throw new BadRequestException('original receive eventId missing; cannot perform reversal');
    }

    const reversal = await this.eventStore.reverseEvent(line.eventId, 'CANCEL', tx);

    await tx
      .update(wmsTables.inboundReceiptLines)
      .set({ canceledQty: line.quantity })
      .where(eq(wmsTables.inboundReceiptLines.id, line.id));

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'CANCEL',
      receiptId: receipt.id,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: receipt.warehouseId,
      fromLocationId: originLocationId,
      quantity: line.quantity,
      reason: 'CANCEL',
      eventId: reversal?.id ?? null,
    });

    // 모든 라인이 취소되면 헤더를 voided 처리하여 receipts 기반 조회에서 제외
    const siblings = await tx
      .select({ quantity: wmsTables.inboundReceiptLines.quantity, canceledQty: wmsTables.inboundReceiptLines.canceledQty })
      .from(wmsTables.inboundReceiptLines)
      .where(eq(wmsTables.inboundReceiptLines.receiptId, receipt.id));
    if (siblings.every((l) => (l.canceledQty ?? 0) >= (l.quantity ?? 0))) {
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ status: 'voided', totalQuantity: 0 })
        .where(eq(wmsTables.inboundReceipts.id, receipt.id));
    }

    return line;
  }
```

`resolveLocation` 아래에 private 헬퍼 추가:

```ts
  private async lockLine(receiptLineId: string, tx: DbTx): Promise<InboundReceiptLine> {
    const [line] = await tx
      .select()
      .from(wmsTables.inboundReceiptLines)
      .where(eq(wmsTables.inboundReceiptLines.id, receiptLineId))
      .limit(1)
      .for('update');
    if (!line) throw new NotFoundException('inbound line not found');
    return line;
  }

  private async loadReceipt(receiptId: string, tx: DbTx): Promise<InboundReceipt> {
    const [receipt] = await tx
      .select()
      .from(wmsTables.inboundReceipts)
      .where(eq(wmsTables.inboundReceipts.id, receiptId))
      .limit(1);
    if (!receipt) throw new NotFoundException('inbound receipt not found');
    return receipt;
  }

  /** 현행 적치와 같은 문구. 회송·취소는 non-null 단언으로 통과시켰으나 도달 불가 경로라 거절로 통일한다(계획서 Global Constraints 3). */
  private requireOrigin(line: InboundReceiptLine): string {
    if (!line.originLocationId) throw new BadRequestException('origin location missing');
    return line.originLocationId;
  }

  private async onHandAt(grain: { skuId: string; warehouseId: string; locationId: string }, tx: DbTx): Promise<number> {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, grain.skuId),
          eq(wmsTables.stockLedgers.warehouseId, grain.warehouseId),
          eq(wmsTables.stockLedgers.locationId, grain.locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    return row?.qty ?? 0;
  }
```

- [ ] **Step 4: `InboundService.cancelInbound` 를 위임으로 교체**

```ts
  // 입고취소
  async cancelInbound(dto: CancelInboundDto, tx?: DbTx) {
    return this.idempotency.withIdempotency(
      'inbound.cancel',
      dto.idempotencyKey,
      dto,
      async (tx) => {
        const line = await this.receiptKernel.cancelLine({ receiptLineId: dto.lineId, quantity: dto.quantity }, tx);

        // 예정 연계 라인이면 예정 누계를 되돌린다. 이게 없으면 취소 후 재입고가
        // receivedQty 를 이중 계상하고, 항목이 confirmed 로 굳어 예정 목록에서 사라진다.
        // PR-B 에서 발주 수령 취소(`POST /purchase-orders/receipt-lines/:id/cancel`)로 대체되며 사라진다.
        if (line.planItemId) {
          const planItem = await tx.query.inboundPlanItems.findFirst({
            where: eq(wmsTables.inboundPlanItems.id, line.planItemId),
          });
          if (planItem) {
            const restored = Math.max(0, (planItem.receivedQty ?? 0) - line.quantity);
            await tx
              .update(wmsTables.inboundPlanItems)
              .set({
                receivedQty: restored,
                // 여러 회차가 걸린 예정에서 한 건만 취소한 경우가 있으므로 상태는
                // 'pending' 으로 고정하지 않고 남은 누계로 다시 판정한다.
                status: restored >= planItem.expectedQty ? 'confirmed' : 'pending',
              })
              .where(eq(wmsTables.inboundPlanItems.id, planItem.id));
          }
        }

        return { success: true };
      },
      tx,
    );
  }
```

> 예정 품목 복원 블록은 현행 코드를 **글자 그대로** 옮긴 것이다(`tx.query` 포함). 커널 밖이고 PR-B 에서 통째로 지워지므로 여기서 조회 API 를 바꾸지 않는다.

- [ ] **Step 5: 확인**

Run: `npm run type-check && npm run test:core:integration:local -- "(arrival-characterization|inbound-receipt.kernel|same-day-cancel|cancel-plan-restore|inventory-idempotency.integration)"`
Expected: 전부 PASS — 잠금 스펙 1 · 기준선의 취소 3 테스트 · 당일 판정 · 예정 복원.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/kernel/ apps/core/src/modules/inventory/inbound/services/inbound.service.ts
git commit -m "refactor(inbound): 당일 입고 취소를 커널로 — 회차 라인을 FOR UPDATE 로 잠근다

예정 품목 복원은 PR-B 까지 InboundService 에 남긴다(source 가드도 PR-B 부터).

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 6: 커널 `putaway`·`returnLine` — 회차 라인 `FOR UPDATE`

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.ts`
- Modify: `apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (`getOnHandQuantity` `:72-85` 삭제, `putawayFromOrigin` `:1048-1120`, `returnInbound` `:1123-1187`, `isTodaySeoul` import 삭제)

**Interfaces:**
- Consumes: `InventoryCommandService.moveInternal(input, tx) → { eventId }` · `StockEventStore.createEvent(input, tx) → { id } | null` · Task 5 의 `lockLine`·`loadReceipt`·`requireOrigin`·`onHandAt`
- Produces:

```ts
export interface PutawayInput { receiptLineId: string; toLocationId: string; quantity: number; eventKey: string }
export interface ReturnLineInput { receiptLineId: string; quantity: number; reason?: string; eventKey: string }
putaway(input: PutawayInput, tx: DbTx): Promise<void>;
returnLine(input: ReturnLineInput, tx: DbTx): Promise<void>;
```

- [ ] **Step 1: 실패하는 잠금 스펙 추가** — Task 5 의 `describe('회차 라인 잠금 (스펙 §7.1)')` 안에 추가:

```ts
    it('putaway 는 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const { lineId, shelfId } = await seedCommittedLine();
      await expectLineLockedDuring(lineId, (tx) =>
        kernel.putaway({ receiptLineId: lineId, toLocationId: shelfId, quantity: 1, eventKey: `kernel-lock-spec:putaway:${randomUUID()}` }, tx),
      );
    });

    it('returnLine 은 회차 라인을 FOR UPDATE 로 잠근다', async () => {
      const { lineId } = await seedCommittedLine();
      await expectLineLockedDuring(lineId, (tx) =>
        kernel.returnLine({ receiptLineId: lineId, quantity: 1, eventKey: `kernel-lock-spec:return:${randomUUID()}` }, tx),
      );
    });
```

- [ ] **Step 2: 실패하는지 본다**

Run: `npm run type-check`
Expected: FAIL — `Property 'putaway' does not exist`, `Property 'returnLine' does not exist`.

- [ ] **Step 3: 커널에 추가** — 타입은 `CancelLineInput` 아래에:

```ts
export interface PutawayInput {
  receiptLineId: string;
  toLocationId: string;
  quantity: number;
  eventKey: string;
}

export interface ReturnLineInput {
  receiptLineId: string;
  quantity: number;
  reason?: string;
  eventKey: string;
}
```

메서드는 `cancelLine` 아래에:

```ts
  /** 즉시 적치 — 원위치(입고 로케이션)에서 같은 창고의 목적지로 내부 이동. 정산에 영향 없음. */
  async putaway(input: PutawayInput, tx: DbTx): Promise<void> {
    const line = await this.lockLine(input.receiptLineId, tx);
    const receipt = await this.loadReceipt(line.receiptId, tx);
    const originLocationId = this.requireOrigin(line);

    // 목적지 로케이션 검증: 존재/활성/동일 창고
    const [dest] = await tx
      .select()
      .from(wmsTables.locations)
      .where(eq(wmsTables.locations.id, input.toLocationId))
      .limit(1);
    if (!dest) throw new NotFoundException('destination location not found');
    if (!dest.isActive) throw new BadRequestException('destination location is inactive');
    if (dest.warehouseId !== receipt.warehouseId) {
      throw new BadRequestException('destination location must be in the same warehouse');
    }

    const originAvailable = line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty;
    if (input.quantity <= 0 || input.quantity > originAvailable) {
      throw new BadRequestException('quantity exceeds origin available');
    }

    // 실원장 검증: 원위치 ON_HAND 수량 확인
    const onHand = await this.onHandAt({ skuId: line.skuId, warehouseId: receipt.warehouseId, locationId: originLocationId }, tx);
    if (onHand < input.quantity) {
      throw new BadRequestException('insufficient on-hand at origin');
    }

    const moveResult = await this.command.moveInternal(
      {
        skuId: line.skuId,
        warehouseId: receipt.warehouseId,
        fromLocationId: originLocationId,
        toLocationId: input.toLocationId,
        quantity: input.quantity,
        reason: 'putaway_internal_move',
        idempotencyKey: input.eventKey,
      },
      tx,
    );

    await tx
      .update(wmsTables.inboundReceiptLines)
      .set({ putawayFromOriginQty: line.putawayFromOriginQty + input.quantity })
      .where(eq(wmsTables.inboundReceiptLines.id, line.id));

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'PUTAWAY',
      receiptId: receipt.id,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: receipt.warehouseId,
      fromLocationId: originLocationId,
      toLocationId: input.toLocationId,
      quantity: input.quantity,
      eventId: moveResult.eventId ?? null,
    });
  }

  /** 회송 — 원위치 잔량에서 차감(ADJUST_DOWN). 발주 정산은 바꾸지 않는다(스펙 §3.3). */
  async returnLine(input: ReturnLineInput, tx: DbTx): Promise<void> {
    const line = await this.lockLine(input.receiptLineId, tx);
    const receipt = await this.loadReceipt(line.receiptId, tx);
    const originLocationId = this.requireOrigin(line);

    // 선행 제약: 적치가 존재하면 회송 불가 (원위치로 모두 되돌린 후 처리)
    if ((line.putawayFromOriginQty ?? 0) > 0) {
      throw new BadRequestException('cannot return: putaway exists; move all back to origin first');
    }
    const originAvailable = line.quantity - line.putawayFromOriginQty - line.returnedQty - line.canceledQty;
    if (input.quantity <= 0 || input.quantity > originAvailable) {
      throw new BadRequestException('quantity exceeds origin available');
    }

    const onHand = await this.onHandAt({ skuId: line.skuId, warehouseId: receipt.warehouseId, locationId: originLocationId }, tx);
    if (onHand < input.quantity) {
      throw new BadRequestException('insufficient on-hand at origin');
    }

    const event = await this.eventStore.createEvent(
      {
        skuId: line.skuId,
        fromWarehouseId: receipt.warehouseId,
        fromLocationId: originLocationId,
        fromState: 'ON_HAND',
        transitionType: 'ADJUST_DOWN',
        quantity: input.quantity,
        occurredAt: new Date(),
        reason: 'RETURN',
        idempotencyKey: input.eventKey,
      },
      tx,
    );

    await tx
      .update(wmsTables.inboundReceiptLines)
      .set({ returnedQty: line.returnedQty + input.quantity })
      .where(eq(wmsTables.inboundReceiptLines.id, line.id));

    await tx.insert(wmsTables.inboundWorkLogs).values({
      type: 'RETURN',
      receiptId: receipt.id,
      lineId: line.id,
      skuId: line.skuId,
      warehouseId: receipt.warehouseId,
      fromLocationId: originLocationId,
      quantity: input.quantity,
      reason: input.reason,
      eventId: event?.id ?? null,
    });
  }
```

- [ ] **Step 4: `InboundService` 위임으로 교체** — `putawayFromOrigin`·`returnInbound` 본문 전체:

```ts
  // 즉시 적치(원위치 → 목적지)
  async putawayFromOrigin(dto: PutawayRequestDto, tx?: DbTx) {
    return this.idempotency.withIdempotency(
      'inbound.putaway',
      dto.idempotencyKey,
      dto,
      async (tx) => {
        await this.receiptKernel.putaway(
          {
            receiptLineId: dto.lineId,
            toLocationId: dto.toLocationId,
            quantity: dto.quantity,
            eventKey: `inbound.putaway:${dto.idempotencyKey}`,
          },
          tx,
        );
        return { success: true };
      },
      tx,
    );
  }

  // 회송
  async returnInbound(dto: ReturnInboundDto, tx?: DbTx) {
    return this.idempotency.withIdempotency(
      'inbound.return',
      dto.idempotencyKey,
      dto,
      async (tx) => {
        await this.receiptKernel.returnLine(
          {
            receiptLineId: dto.lineId,
            quantity: dto.quantity,
            reason: dto.reason,
            eventKey: `inbound.return:${dto.idempotencyKey}`,
          },
          tx,
        );
        return { success: true };
      },
      tx,
    );
  }
```

그리고 더 이상 쓰이지 않는 private `getOnHandQuantity`(`:72-85`)와 `import { isTodaySeoul } from '../../shared/services/time.util';` 를 지운다. 타입체커·린트가 남은 미사용 import(`BadRequestException` 등)를 알려 주면 **실제로 미사용인 것만** 지운다 — `receiveFromPlan` 이 쓰는 것은 남는다.

- [ ] **Step 5: 확인**

Run: `npm run type-check && npm run lint -- apps/core/src/modules/inventory/inbound && npm run test:core:integration:local -- "(arrival-characterization|inbound-receipt.kernel|inbound-putaway.reader|inventory-idempotency.integration|same-day-cancel|cancel-plan-restore|plan-receive)"`
Expected: 전부 PASS — 잠금 스펙 3 · 기준선 12 · 적치 대기 reader · 멱등 회송.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/
git commit -m "refactor(inbound): 적치·회송을 커널로 — 회차 라인 FOR UPDATE, db.query 조회 제거

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 7: 커널 경계 arch 스펙

**Files:**
- Create: `apps/core/src/modules/inventory/arch-spec.helpers.ts`
- Create: `apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts`
- Modify: `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` (`:1-23` 의 `collectTsFiles` · `:27-40` 의 `moduleSpecifiers` 를 헬퍼 import 로)

**Interfaces:**
- Produces: `collectTsFiles(dir: string): string[]` · `moduleSpecifiers(file: string): string[]`

- [ ] **Step 1: 공용 헬퍼로 옮긴다** — `arch-spec.helpers.ts`

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** 디렉터리 아래 `.ts` 파일(스펙 제외)을 재귀로 모은다. */
export function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/** 파일 안의 모든 모듈 지정자: `from '…'` (import·re-export, 줄바꿈 무관) · `require('…')` · `import('…')`. */
export function moduleSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}
```

`replenishment-boundary.arch.spec.ts` 에서 두 함수 정의를 지우고 `import { collectTsFiles, moduleSpecifiers } from './arch-spec.helpers';` 로 바꾼다. `fs` import 중 `readdirSync`·`readFileSync`·`statSync` 가 더 쓰이지 않으면 지운다(`sep` 은 남는다).

Run: `npx jest apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts`
Expected: PASS(동작 동일).

- [ ] **Step 2: 커널 경계 스펙 작성**

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { collectTsFiles, moduleSpecifiers } from './arch-spec.helpers';

const KERNEL_DIR = join(__dirname, 'inbound', 'kernel');
const DOCUMENT_MODULES = /(^|\/)(procurement|warehouse-transfer)(\/|$)/;

/**
 * 입고 커널의 경계 (스펙 docs/superpowers/specs/2026-09-14-purchase-order-owns-receiving-design.md §3·§8).
 *
 * - 문서가 커널을 부르고, 커널은 문서를 부르지 않는다 — 의존은 문서 → 커널 한 방향.
 * - 커널은 트랜잭션을 스스로 열지 않는다 — 호출자의 tx 안에서만 돈다.
 * - 커널은 db.query 관계 API 를 쓰지 않는다(CLAUDE.md Inventory Query Rules).
 *
 * 첫 위반이 생기면 이 스펙보다 스펙 문서를 먼저 고칠 것.
 */
describe('inbound receipt kernel boundary (arch)', () => {
  const files = collectTsFiles(KERNEL_DIR);

  it('커널 파일이 있다 — 디렉터리가 옮겨지면 아래 단언이 빈 집합으로 통과하지 않게', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it('커널은 procurement/ · warehouse-transfer/ 를 import 하지 않는다', () => {
    const violations = files.flatMap((file) =>
      moduleSpecifiers(file)
        .filter((s) => DOCUMENT_MODULES.test(s))
        .map((s) => `${file}: ${s}`),
    );
    expect(violations).toEqual([]);
  });

  it('커널은 트랜잭션을 스스로 열지 않는다 — DbService 주입·transaction() 호출이 없다', () => {
    const violations = files.filter((file) => /\bDbService\b|InjectTypedDb|\.transaction\(/.test(readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
  });

  it('커널은 db.query 관계 API 를 쓰지 않는다', () => {
    const violations = files.filter((file) => /\.query\.[A-Za-z]+\.find(First|Many)\(/.test(readFileSync(file, 'utf8')));
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 3: 위반을 일부러 만들어 스펙이 잡는지 본다(가드 검증)** — 커널 파일 맨 위에 임시로 `import '../../procurement/procurement.module';` 을 넣고:

Run: `npx jest apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts`
Expected: FAIL 1건(import 방향). 임시 줄을 **지우고** 다시 실행 → PASS 4.

- [ ] **Step 4: 커밋**

```bash
git add apps/core/src/modules/inventory/arch-spec.helpers.ts apps/core/src/modules/inventory/inbound-kernel-boundary.arch.spec.ts apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
git commit -m "test(inventory): 입고 커널 경계 arch 스펙 — import 방향·트랜잭션 자가 개시·db.query 금지

Claude-Session: https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP"
```

---

### Task 8: 전체 게이트 · 통합 기준선 · 스모크 · PR

**Files:** 없음(검증과 PR 본문)

- [ ] **Step 1: 전체 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: type-check 0 에러 · jest 실패 0. 실패가 있으면 이 브랜치가 만든 것이다(CLAUDE.md 검증 게이트).

- [ ] **Step 2: core 통합 전체와 develop 기준선 비교**

Run: `npm run test:core:integration:local`
Expected: develop 기준선 대비 **새 실패 0**. 기준선은 같은 명령을 develop 체크아웃에서 돌려 실패 suite 이름을 적어 둔 것과 대조한다(워크트리면 `COMPOSE_PROJECT_NAME=almondyoung-server` 필요). 결과 요약(통과/실패 suite 수, 기준선과의 차이)을 PR 본문에 붙인다 — CI 는 DB 스펙을 skip 한다.

- [ ] **Step 3: dev 스모크 — 라이브에서 쓰일 수 있는 경로라 사람 눈으로 한 번 본다**

core 를 **직접 재시작**한다(`--watch` 가 실제 프로세스에 안 붙어 옛 빌드로 검증한 전력). `apps/core/.env` 는 `dev_core` 를 본다 — Task 2 Step 6 에서 마이그레이션을 적용했는지 확인한다.

admin-web 입고 관리(`/inventory/inbound`)에서:
1. 간편입고 2품목 → 이력 탭에 회차 1건·수량 합계가 보인다
2. 그 라인 적치 1개 → 적치 대기 수량이 준다
3. 다른 간편입고 라인 회송 1개 → 성공 토스트
4. 또 다른 간편입고 라인 당일 취소 → 회차가 이력에서 사라진다(voided)
5. 개별입고(로케이션 지정) → 이력 탭 수량이 맞다

창고 앱이 로컬에 떠 있으면 간편입고·적치 한 번씩. 결과를 PR 본문 체크리스트로 남긴다.

- [ ] **Step 4: 사용자 확인 후 푸시·PR** — 푸시와 PR 생성은 사용자에게 먼저 묻는다.

PR 본문에 반드시 넣을 것:
- 스펙 링크와 「PR-A — 동작 보존」 선언, **의도한 차이 셋**(Global Constraints 1~3)
- 마이그레이션: additive(enum 생성 + `inbound_receipt_lines.source` 기본 `direct`). 배포 순서 **`migrate → deploy`**
- 게이트 결과 · 통합 기준선 비교 · 스모크 체크리스트
- 다음: PR-B 계획은 이 PR 머지 뒤 작성(스펙 §11 PR-B)
- 끝 줄: `https://claude.ai/code/session_01RoKTVGBkshkHGc2GJo5ggP`

---

## Self-Review 결과 (작성 시 점검)

- **스펙 커버리지 (PR-A 범위)**: §3 커널 책임(저널·회차·라인·원장·작업 로그 → Task 3 / 적치·회송·취소 → Task 5·6) · §4.3 `source` 컬럼 → Task 2 · §7.1 회차 라인 `FOR UPDATE`·`db.query` 제거 → Task 5·6 · §8 tx 필수·마지막, 트랜잭션 자가 개시 금지 → Task 3·7 · §11 PR-A 「동작 보존」 범위와 창의 공백(source 가드 미적용, 예정 복원 유지) → Global Constraints·Task 5 · §12 #9(a) import 방향 arch → Task 7 · §12 #10 기존 스펙 단언 불변 → Task 1·4·5·6 의 확인 명령.
- **PR-A 밖으로 명시적으로 미룬 것**: §12 #9(b) `PO_FORBIDDEN` 확장(조달 라인·링크 테이블이 PR-B 에서 생긴다) · #9(c) source 가드 409 · 판별 유니온의 `purchase_order` 갈래 · `cancelLine` 의 `expected.source` 인자 — 전부 PR-B.
- **스펙 §8 과의 차이 두 가지(의도)**: 라인별 `eventKey`(개별입고 키 보존) · 반환이 행 전체(기존 응답 모양). PR-B 계획이 이 시그니처를 근거로 쓴다.
- **타입 일관성**: `RecordArrivalInput`·`CancelLineInput`·`PutawayInput`·`ReturnLineInput` 필드명과 `InboundService` 호출부 일치 확인. 생성자 인자 순서 `(…, poClosure, receiptKernel)` 를 배선 8곳(하네스 포함)에 동일 적용.
