# 창고간 이동 무손실화 (P0-1/W1, 작업 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재고를 소실시키는 창고간 이동 경로(Path A `movement/inter-warehouse`)를 하드 삭제해 `inventory/transfers`(Path B)로 일원화하고, 유일 경로가 된 Path B 의 이중출고 구멍을 봉인한다.

**Architecture:** Path A 의 inter-warehouse 자산(서비스 메서드 2개·컨트롤러 라우트 2개·DTO 1개·해당 스펙 케이스)만 절제하고 동일창고 batch 경로(`moveImmediately`)는 존치. Path B `TransferService.executeTransferJob` 에 두 겹 가드(job 헤더 `FOR UPDATE` + 실행된 라인 skip)를 추가하고 단위/통합 테스트로 잠근다. 스키마·마이그레이션 무변경.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), Jest(ts-jest, root config), `@app/db` 단일 트랜잭션 러너(`DbService.run`, ADR-0025).

## Global Constraints

- 원장 쓰기는 `StockEventStore.createEvent` / `InventoryCommandService` 경유만 — `stockEvents` 직접 INSERT 금지(arch test `inventory-write-boundary.arch.spec.ts` 로 강제, 작업 1 도입).
- 트랜잭션 전파: 공개 메서드는 `tx?: DbTx` 를 마지막 파라미터로, 내부는 `this.dbService.run(fn, tx)` — per-class `inTx` 헬퍼 금지(ADR-0025).
- 스키마 무변경(마이그레이션 없음). `movement_jobs`/`movement_job_lines`/`movement_work_logs` 테이블 존치.
- 타입 안전: `any`/무근거 `as` 캐스트 금지. 테스트 밴드의 `as never`/`as unknown as` 는 정당화 주석과 함께 허용(기존 통합 스펙 관행).
- 검증 게이트: `nest build core` exit 0 · 변경 파일 eslint 신규 error 0 · arch spec PASS · 삭제 심볼 소스 참조 0 · 단위 GREEN · 통합은 `describeIfDb` 로 DB 없을 때 graceful skip(⏸).
- 근거: `docs/superpowers/specs/2026-07-10-inter-warehouse-movement-retirement-design.md`.

---

### Task 1: Path A 하드 삭제 (손실 inter-warehouse 은퇴)

`movement/` 모듈에서 inter-warehouse 자산만 제거한다. 신규 동작이 없는 순수 삭제라 TDD 대신 "먼저 스펙에서 참조 제거 → 코드 삭제 → 빌드/grep/잔존 스펙 통과" 순.

**Files:**
- Modify: `apps/core/src/modules/inventory/movement/services/movement.service.ts` (메서드 2개 + import 정리)
- Modify: `apps/core/src/modules/inventory/movement/controllers/movement.controller.ts` (핸들러 2개 + import 정리)
- Delete: `apps/core/src/modules/inventory/movement/dto/inter-warehouse-transfer.dto.ts`
- Modify: `apps/core/src/modules/inventory/movement/services/movement.service.idempotency.spec.ts` (createInterWarehouseTransfer 케이스 제거)

**Interfaces:**
- Consumes: 없음(삭제 작업).
- Produces: 삭제 후에도 `MovementService.moveImmediately(dto: MoveBatchDto): Promise<{ job: MovementJob; lines: MovementJobLine[] }>`, `getJobById`, `getMovementHistory` 존치. `MovementController` 라우트 `POST /movement/move`·`GET /movement/jobs/:jobId`·`GET /movement/history` 존치.

- [ ] **Step 1: 스펙에서 createInterWarehouseTransfer 케이스 제거**

`movement.service.idempotency.spec.ts` 를 아래 최종 형태로 만든다(두 번째 `it` 블록 삭제):

```typescript
import { MovementService } from './movement.service';

const SENTINEL = { sentinel: true };

function build() {
  const withIdempotency = jest.fn().mockResolvedValue(SENTINEL);
  // MovementService 생성자 시그니처는 파일 :12 확인 — idempotency 를 마지막 파라미터로 추가한 상태 기준
  const svc = new MovementService({} as never, {} as never, { withIdempotency } as never);
  return { svc, withIdempotency };
}

describe('MovementService 멱등 래퍼 배선', () => {
  it('moveImmediately → withIdempotency(movement.move, …) — 단, 사전 검증은 래퍼 밖', async () => {
    const { svc, withIdempotency } = build();
    const dto = { warehouseId: 'w', lines: [], idempotencyKey: 'k' };
    const result = await svc.moveImmediately(dto as never);
    expect(withIdempotency).toHaveBeenCalledWith('movement.move', 'k', dto, expect.any(Function));
    expect(result).toBe(SENTINEL);
  });
});
```

- [ ] **Step 2: 컨트롤러에서 inter-warehouse·complete 핸들러와 DTO import 삭제**

`movement.controller.ts` 에서 `import { InterWarehouseTransferDto } ...`(line 5) 줄과 아래 두 핸들러 블록을 삭제한다:
- `@Post('inter-warehouse')` … `createInterWarehouseTransfer(...)` (line 14-19)
- `@Post('jobs/:jobId/complete')` … `completeInterWarehouseMovement(...)` (line 21-27)

삭제 후 최종 import 헤더는:

```typescript
import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { MovementService } from '../services/movement.service';
import { MoveBatchDto } from '../dto/move-batch.dto';
import { MovementJobWithLinesDto, MovementHistoryResponseDto } from '../dto/movement-response.dto';
import { MovementJobMapper, MovementJobLineMapper, MovementWorkLogMapper } from '../mappers/movement.mapper';
```

남는 핸들러: `moveImmediately`(`POST move`), `getJob`(`GET jobs/:jobId`), `history`(`GET history`).

- [ ] **Step 3: 서비스에서 메서드 2개와 미사용 import 삭제**

`movement.service.ts` 에서 `createInterWarehouseTransfer`(line 174-253)와 `completeInterWarehouseMovement`(line 259-305) 메서드 전체를 삭제한다. 그리고 import 를 정리한다 — `InterWarehouseTransferDto` import(line 6)와 top-level `inArray`(line 9, `createInterWarehouseTransfer:183` 전용) 제거. 최종 import 헤더:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, MovementJobLine, MovementJob } from '../../schema/inventory.schema';
import { MoveBatchDto } from '../dto/move-batch.dto';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { and, eq } from 'drizzle-orm';
```

(`and`·`eq` 는 `moveImmediately` 의 ledger 조회에서 계속 사용. `StockEventStore`·`InventoryIdempotencyService` 주입도 `moveImmediately` 가 사용하므로 존치.)

- [ ] **Step 4: DTO 파일 삭제**

```bash
git rm apps/core/src/modules/inventory/movement/dto/inter-warehouse-transfer.dto.ts
```

- [ ] **Step 5: 빌드 통과 확인**

Run: `npx nest build core`
Expected: exit 0 (tsc/webpack 에러 없음 — 미사용 import·삭제 심볼 참조가 남았으면 여기서 실패).

- [ ] **Step 6: 삭제 심볼 소스 참조 0 확인**

Run: `git grep -nE "createInterWarehouseTransfer|completeInterWarehouseMovement|InterWarehouseTransferDto" -- 'apps/**/*.ts'`
Expected: 출력 없음(0건). (docs 의 계획/스펙 언급은 `apps/**/*.ts` 스코프 밖이라 걸리지 않음.)

- [ ] **Step 7: 잔존 스펙·arch 경계 통과 확인**

Run: `npx jest --testPathPattern="movement\.service\.idempotency|inventory-write-boundary" --runInBand`
Expected: PASS (movement 멱등 배선 1 test + arch 경계 spec GREEN).

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/inventory/movement/
git commit -m "[inventory] 손실 창고간 이동 경로 하드 삭제 (P0-1/W1)

createInterWarehouseTransfer(출발지만 차감 소실) + 죽은 completeInterWarehouseMovement
+ POST /movement/inter-warehouse·/jobs/:id/complete 라우트 + InterWarehouseTransferDto 삭제.
inventory/transfers(무손실) 로 일원화. 동일창고 batch(moveImmediately) 존치.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Path B 이중출고 봉인 (FOR UPDATE + 실행된 라인 skip) + 단위 테스트

유일 inter-warehouse 경로가 된 `TransferService.executeTransferJob` 에 재실행 방어를 넣는다. TDD — 실행된 라인을 skip 하는 가드부터 red-green.

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/transfer.service.spec.ts`
- Modify: `apps/core/src/modules/inventory/core/services/transfer.service.ts:113-248` (`executeTransferJob`)

**Interfaces:**
- Consumes: `TransferService(dbService, stockEventService, commandService)` 생성자(`transfer.service.ts:19-23`). `stockEventService.transferBetweenWarehouses(skuId, fromWarehouseId, fromLocationId, toWarehouseId, toLocationId, quantity, reason?, tx?) → { shipEventId, receiveEventId }`.
- Produces: `executeTransferJob(params: { jobId: string }, tx?: DbTx) → { jobId: string; linesExecuted: number }` — `linesExecuted` 는 **이번 호출에서 실제 실행(ship)된 라인 수**(기실행 라인은 skip 되어 미포함, 재-PATCH 시 0).

- [ ] **Step 1: 실패하는 단위 테스트 작성**

`transfer.service.spec.ts` 생성:

```typescript
import { TransferService } from './transfer.service';
import { wmsSchema } from '../../schema/inventory.schema';
import { DbService } from '@app/db';

/**
 * executeTransferJob 재실행 가드 단위 테스트 — DB 불요.
 * trx 는 executeTransferJob 이 실제로 부르는 메서드만 최소 대역으로 모킹한다.
 */
function buildTrx(opts: {
  job: { id: string; journalId: string | null };
  lines: Array<{ id: string; skuId: string; quantity: number; fromLocationId: string | null; toLocationId: string | null; eventId: string | null; memo: string | null }>;
  fromLoc: { warehouseId: string };
  toLoc: { warehouseId: string };
}) {
  // .select().from().where().for('update') → [job]  (FOR UPDATE 잠금 조회)
  const selectChain = {
    from: () => ({ where: () => ({ for: () => Promise.resolve([opts.job]) }) }),
  };
  const findFirstLoc = jest
    .fn()
    .mockResolvedValueOnce(opts.fromLoc)
    .mockResolvedValueOnce(opts.toLoc);
  const trx = {
    select: () => selectChain,
    query: {
      movementJobLines: { findMany: jest.fn().mockResolvedValue(opts.lines) },
      locations: { findFirst: findFirstLoc },
    },
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
  };
  return trx as never;
}

function build(trx: unknown) {
  const dbService = { run: (fn: (t: unknown) => unknown) => fn(trx) } as unknown as DbService<typeof wmsSchema>;
  const transferBetweenWarehouses = jest.fn().mockResolvedValue({ shipEventId: 'se', receiveEventId: 're' });
  const stockEventService = { transferBetweenWarehouses } as never;
  const commandService = { moveInternal: jest.fn() } as never;
  const svc = new TransferService(dbService, stockEventService, commandService);
  return { svc, transferBetweenWarehouses };
}

describe('TransferService.executeTransferJob 재실행 가드', () => {
  it('전 라인이 기실행(eventId 설정)이면 transferBetweenWarehouses 를 부르지 않는다(멱등 no-op)', async () => {
    const trx = buildTrx({
      job: { id: 'job1', journalId: 'j1' },
      lines: [
        { id: 'l1', skuId: 's', quantity: 5, fromLocationId: 'lf', toLocationId: 'lt', eventId: 'e1', memo: null },
        { id: 'l2', skuId: 's', quantity: 3, fromLocationId: 'lf', toLocationId: 'lt', eventId: 'e2', memo: null },
      ],
      fromLoc: { warehouseId: 'A' },
      toLoc: { warehouseId: 'B' },
    });
    const { svc, transferBetweenWarehouses } = build(trx);
    const result = await svc.executeTransferJob({ jobId: 'job1' });
    expect(transferBetweenWarehouses).not.toHaveBeenCalled();
    expect(result).toEqual({ jobId: 'job1', linesExecuted: 0 });
  });

  it('미실행 창고간 라인(eventId=null)은 transferBetweenWarehouses 로 무손실 이송한다', async () => {
    const trx = buildTrx({
      job: { id: 'job2', journalId: 'j2' },
      lines: [
        { id: 'l1', skuId: 's1', quantity: 7, fromLocationId: 'lf', toLocationId: 'lt', eventId: null, memo: 'm' },
      ],
      fromLoc: { warehouseId: 'A' },
      toLoc: { warehouseId: 'B' },
    });
    const { svc, transferBetweenWarehouses } = build(trx);
    const result = await svc.executeTransferJob({ jobId: 'job2' });
    expect(transferBetweenWarehouses).toHaveBeenCalledTimes(1);
    expect(transferBetweenWarehouses).toHaveBeenCalledWith('s1', 'A', 'lf', 'B', 'lt', 7, 'm', trx);
    expect(result).toEqual({ jobId: 'job2', linesExecuted: 1 });
  });
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run: `npx jest --testPathPattern="transfer\.service\.spec" --runInBand`
Expected: FAIL — mock trx 는 변경 후 인터페이스(`select().for('update')`)만 구현한다. 현재 코드는 job 을 `trx.query.movementJobs.findFirst` 로 조회하는데 mock 에 `query.movementJobs` 가 없어 TypeError 로 실패한다. (구현 후 job 은 `select().for('update')` 경로로 오고 eventId skip 이 첫 테스트를 통과시킨다.)

- [ ] **Step 3: executeTransferJob 에 FOR UPDATE 잠금 적용**

`transfer.service.ts` `executeTransferJob` 의 job 조회부(`:122-129`)를 FOR UPDATE select 로 교체:

```typescript
      // Job 헤더를 FOR UPDATE 로 잠가 같은 jobId 동시 실행을 직렬화 (이중출고 방지)
      const [movementJob] = await trx
        .select()
        .from(wmsTables.movementJobs)
        .where(eq(wmsTables.movementJobs.id, params.jobId))
        .for('update');

      if (!movementJob) {
        throw new NotFoundException(`Movement job ${params.jobId} not found`);
      }
```

- [ ] **Step 4: 실행된 라인 skip 가드 + 실행 카운트 적용**

라인 루프 진입 직전에 카운터를 두고(`:158` "각 라인 실행" 주석 위), 라인 위치-ID 가드(`:160-162`) 다음에 skip 을 추가하고, 반환의 `linesExecuted` 를 실제 실행 수로 바꾼다. 최종 루프 골격:

```typescript
      let executed = 0;
      // 각 라인 실행
      for (const line of lines) {
        if (!line.fromLocationId || !line.toLocationId) {
          throw new BadRequestException(`Line ${line.id} has invalid location IDs`);
        }

        // 이미 실행된 라인은 skip — 기완료 잡 재-PATCH(더블클릭/재시도) 시 이중출고 방지
        if (line.eventId) {
          continue;
        }

        if (isInterWarehouse) {
          // …(기존 transferBetweenWarehouses + line update + workLog 그대로)…
        } else {
          // …(기존 moveInternal + line update + workLog 그대로)…
        }
        executed++;
      }

      this.logger.log(`Transfer job ${params.jobId} execution completed`);

      return {
        jobId: params.jobId,
        linesExecuted: executed,
      };
```

(`isInterWarehouse` 계산과 fromLocation/toLocation 조회는 루프 앞 기존 위치 그대로 유지 — skip 여부와 무관하게 라우팅 판정에 필요.)

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npx jest --testPathPattern="transfer\.service\.spec" --runInBand`
Expected: PASS (2 tests).

- [ ] **Step 6: 빌드·잔존 스펙 통과 확인**

Run: `npx nest build core && npx jest --testPathPattern="inventory-write-boundary" --runInBand`
Expected: build exit 0, arch 경계 spec PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/inventory/core/services/transfer.service.ts apps/core/src/modules/inventory/core/services/transfer.service.spec.ts
git commit -m "[inventory] transfers 실행 이중출고 봉인 (FOR UPDATE + 실행 라인 skip)

executeTransferJob: job 헤더 FOR UPDATE 로 동시 실행 직렬화 + eventId 설정된
라인 skip 으로 재-PATCH 이중출고 차단. linesExecuted 를 실제 실행 수로 정정.
Path B 첫 단위 테스트(재실행 가드·무손실 라우팅) 추가.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Path B 수량 보존 통합 스펙 (⏸ — 저작, DB 복구 시 실행)

유일 경로가 된 Path B 의 P0-1 핵심 성질(무손실: origin −N/dest +N, 재실행 시 불변)을 원장 레벨로 잠근다. `describeIfDb` 게이트라 DB 없으면 graceful skip.

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/transfer.service.integration.spec.ts`

**Interfaces:**
- Consumes: 통합 서비스 그래프(`ProductSellableQuantityService`, `StockEventStore`, `LocationService`, `InventoryCommandService`, `StockEventService`, `TransferService`), `OutboxService as InventoryOutboxService`. 시드는 `command.receive({ skuId, toWarehouseId, toLocationId, quantity }, tx)` 로 origin ON_HAND 생성.
- Produces: 없음(테스트).

- [ ] **Step 1: 통합 스펙 작성**

```typescript
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { LocationService } from './location.service';
import { InventoryCommandService } from './inventory-command.service';
import { StockEventService } from './stock-event.service';
import { TransferService } from './transfer.service';

/**
 * Path B(inventory/transfers) 창고간 이동 무손실 통합 검증. rollback 전용 트랜잭션.
 * 성공 기준: create+execute 후 origin ON_HAND −N, dest ON_HAND +N, IN_TRANSFER 잔량 0.
 *           재-execute 는 이중출고 없이 원장 불변(eventId skip 가드).
 *
 * 실행 (throwaway 로컬 Postgres):
 *   1) docker run -d --name almond-it-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=core_it \
 *        -p 54329:5432 postgres:16-alpine
 *   2) DATABASE_URL=postgresql://postgres:postgres@localhost:54329/core_it \
 *        npx drizzle-kit migrate --config apps/core/drizzle.config.ts
 *   3) DATABASE_URL=…54329/core_it npx jest --testPathPattern="transfer\.service\.integration" --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('TransferService inter-warehouse 무손실 (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let transfer: TransferService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });

    // DbService 최소 대역 (ADR-0025 단일 러너): tx 전파만 사용(spec 은 항상 rollback tx 전파).
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((t) => fn(t as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;

    const invOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, invOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, invOutbox, location);
    // transferBetweenWarehouses 는 command.transferShip/Receive 만 사용 —
    // unifiedReservation·allocationStrategy 미사용이라 대역 불요(undefined 밴드).
    const stockEventService = new StockEventService(dbService, eventStore, command, undefined as never, undefined as never);
    transfer = new TransferService(dbService, stockEventService, command);
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seed(tx: DbTx, onHand: number) {
    const [wa] = await tx.insert(wmsTables.warehouses).values({ name: `it-wa-${randomUUID().slice(0, 8)}` }).returning();
    const [wb] = await tx.insert(wmsTables.warehouses).values({ name: `it-wb-${randomUUID().slice(0, 8)}` }).returning();
    const [holder] = await tx.insert(wmsTables.holders).values({ name: `it-h-${randomUUID().slice(0, 8)}` }).returning();
    const [sku] = await tx.insert(wmsTables.skus).values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id }).returning();
    // 유효한 최소 로케이션: zone (ck_locations_type — zone 은 rack/bin NULL 허용)
    const [locA] = await tx.insert(wmsTables.locations).values({ warehouseId: wa.id, code: `IT-A-${randomUUID().slice(0, 8)}`, locationType: 'zone' }).returning();
    const [locB] = await tx.insert(wmsTables.locations).values({ warehouseId: wb.id, code: `IT-B-${randomUUID().slice(0, 8)}`, locationType: 'zone' }).returning();
    // origin ON_HAND 시드 (원장 경유)
    await command.receive({ skuId: sku.id, toWarehouseId: wa.id, toLocationId: locA.id, quantity: onHand }, tx);
    return { wa, wb, sku, locA, locB };
  }

  async function onHandQty(tx: DbTx, skuId: string, warehouseId: string, locationId: string): Promise<number> {
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
      );
    return row?.qty ?? 0;
  }

  async function inTransferTotal(tx: DbTx, skuId: string): Promise<number> {
    const rows = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.stockState, 'IN_TRANSFER')));
    return rows.reduce((s, r) => s + (r.qty ?? 0), 0);
  }

  it('create+execute 는 재고를 보존한다 (origin −N, dest +N, IN_TRANSFER 0)', async () => {
    await inRollbackTx(async (tx) => {
      const { wa, wb, sku, locA, locB } = await seed(tx, 100);

      const { jobId } = await transfer.createTransferJob(
        { fromWarehouseId: wa.id, toWarehouseId: wb.id, items: [{ skuId: sku.id, fromLocationId: locA.id, toLocationId: locB.id, quantity: 40 }] },
        tx,
      );
      await transfer.executeTransferJob({ jobId }, tx);

      expect(await onHandQty(tx, sku.id, wa.id, locA.id)).toBe(60);
      expect(await onHandQty(tx, sku.id, wb.id, locB.id)).toBe(40);
      expect(await inTransferTotal(tx, sku.id)).toBe(0);
    });
  });

  it('재-execute 는 이중출고 없이 원장을 유지한다 (eventId skip)', async () => {
    await inRollbackTx(async (tx) => {
      const { wa, wb, sku, locA, locB } = await seed(tx, 100);

      const { jobId } = await transfer.createTransferJob(
        { fromWarehouseId: wa.id, toWarehouseId: wb.id, items: [{ skuId: sku.id, fromLocationId: locA.id, toLocationId: locB.id, quantity: 40 }] },
        tx,
      );
      await transfer.executeTransferJob({ jobId }, tx);
      const second = await transfer.executeTransferJob({ jobId }, tx);

      expect(second.linesExecuted).toBe(0);
      expect(await onHandQty(tx, sku.id, wa.id, locA.id)).toBe(60);
      expect(await onHandQty(tx, sku.id, wb.id, locB.id)).toBe(40);
      expect(await inTransferTotal(tx, sku.id)).toBe(0);
    });
  });
});
```

- [ ] **Step 2: DB 없이 graceful skip 확인**

Run: `npx jest --testPathPattern="transfer\.service\.integration" --runInBand`
Expected: PASS with 2 skipped (`describe.skip` — DATABASE_URL 미설정). 컴파일 에러 없이 skip 되면 성공.

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/modules/inventory/core/services/transfer.service.integration.spec.ts
git commit -m "[inventory][test] transfers 무손실 통합 스펙 (⏸ describeIfDb)

create+execute 보존(origin −N/dest +N/IN_TRANSFER 0) + 재-execute 이중출고 없음.
DB 없을 때 graceful skip, dev DB 복구 시 실행(작업 1·2·3 ⏸ 항목과 동일).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 문서화 (현황판 갱신 + 신규 W-항목)

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md`

**Interfaces:**
- Consumes: 없음.
- Produces: 없음(문서).

- [ ] **Step 1: P0-1 · W1 상태 🟩 + 완료 근거**

`docs/logistics-backend-hardening-2026-07.md` 에서:
- P0-1 행 상태 컬럼 ⬜ → 🟩.
- W1 행 상태 컬럼 ⬜ → 🟩.
- WS-B 헤더(`§5`) 문구의 잔여 목록에서 P0-1·W1 제거(작업 6 완료 반영).

- [ ] **Step 2: 작업 6 완료 블록 추가**

WS-B 작업 5 완료 블록 다음에 작업 4·5 블록과 같은 형식으로 추가:

```markdown
> **✅ 작업 6 (창고간 이동 무손실화, P0-1·W1) 완료 — 2026-07-10:** 손실 경로(Path A `movement/inter-warehouse`)를 하드 삭제해 무손실 경로 `inventory/transfers`(Path B)로 일원화. 호출자 전수 감사(FE·BE·타 앱)로 은퇴가 재배선보다 적합함을 확정 — Path A inter-warehouse 는 모노레포 호출자 0(라이브 지뢰), `complete` 는 완전 dead, Path B 는 admin-web 라이브.
> - **P0-1/W1**: `createInterWarehouseTransfer`(출발지만 차감 `toState:null` 소실) + 죽은 `completeInterWarehouseMovement` + 두 라우트(`POST /movement/inter-warehouse`·`/jobs/:id/complete`) + `InterWarehouseTransferDto` + 스펙 케이스 삭제. 동일창고 batch(`moveImmediately`, admin-web 라이브)·조회 라우트 존치. `movementJobs.warehouseId` 의 `to` 의미 사용처 소멸로 divergence 자동 해소.
> - **Path B 경량 하드닝**: `executeTransferJob` 에 job 헤더 `FOR UPDATE`(동시 실행 직렬화) + 실행된 라인 skip(재-PATCH 이중출고 차단). Path B 첫 테스트(단위: 재실행 가드·무손실 라우팅 / 통합 ⏸: 보존·재실행 불변).
> - 스키마·마이그레이션 무변경(작업 4 와 동일). 검증: `nest build core` exit 0 · 삭제 심볼 소스 참조 0 · arch 경계(`inventory-write-boundary.arch.spec.ts`) PASS · 단위 GREEN · 통합 ⏸(dev DB 복구 시).
> - 설계 `docs/superpowers/specs/2026-07-10-inter-warehouse-movement-retirement-design.md` · 계획 `docs/superpowers/plans/2026-07-10-inter-warehouse-movement-retirement.md`.
```

- [ ] **Step 3: 신규 W-항목 추가 (미완성 크로스보더 인바운드)**

§3 "업무 흐름 공백" 표에 행 추가:

```markdown
| W11 | ⬜ | 외화 PO 크로스보더 인바운드(source 플랜 → 창고간 이송 → destination 플랜 활성화) 미완성 | 삭제한 `completeInterWarehouseMovement` 가 닫으려던 루프. Path A(소실)·Path B(즉시 atomic) 어느 쪽도 지속 IN_TRANSFER(중국→한국 다일 운송)를 모델링 안 함. 부수: `purchase-order.service.ts:313` 이 만드는 `planType='destination'`(expectedDate=null) 플랜이 활성화 경로 없이 pending 잔존 → `stock_summary` 뷰 `transit_out`/`inbound_pending` 에 영구 반영(기존 조건, 작업 6 이 악화 아님). 착수 시 2단계 상태기계·receive API·도착 로케이션 규칙 설계 필요 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "[docs] 물류 하드닝 현황판 — 작업 6(P0-1/W1) 완료 + W11 신설

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review 결과

**Spec coverage:** 스펙 §3(Path A 삭제)→Task 1 · §4(Path B 하드닝)→Task 2 · §5(2-tier 테스트: unit→Task 2, integration→Task 3) · §6(문서화+W항목)→Task 4 · §7(검증 게이트)→각 Task 의 build/grep/test 스텝. 누락 없음.

**Placeholder scan:** TBD/TODO/"적절히" 없음 — 모든 코드 스텝에 실제 코드·명령·기대 출력 명시.

**Type consistency:** `executeTransferJob` 반환 `{ jobId, linesExecuted }` 를 Task 2(구현·단위)·Task 3(통합 `second.linesExecuted`)에서 동일 사용. `transferBetweenWarehouses` 6+2 인자 시그니처를 단위 테스트 assert 와 실제 호출이 일치. `TransferService(dbService, stockEventService, commandService)` 생성자 순서를 단위·통합 양쪽에서 동일 사용.
