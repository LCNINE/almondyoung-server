# 실사(Stocktaking) 정상화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실사 조정을 원장(`InventoryCommandService`) 경유로 재배선하고, 완료 시점 단일 트랜잭션 원자 적용 + 멱등 + 세션 상태기계 + 라인 unique 로 실사를 정상화한다.

**Architecture:** `completeSession` 이 한 tx 에서 variance 라인마다 `InventoryCommandService.adjustUp/adjustDown` 를 호출(라이브 delta = counted − 현재 ON_HAND)해 원장·판매가능수량·outbox 를 원자 갱신하고 세션을 종결한다. `generateAdjustments` 는 무영속 미리보기로 격하한다. `cancelSession` 을 신설하고 scan/count 에 상태 가드를 건다. 원장 직접 INSERT 재도입은 아키텍처 테스트로 봉인한다.

**Tech Stack:** NestJS, Drizzle ORM(postgres-js) 0.44.7, Jest(ts-jest). 통합 테스트는 rollback-only 트랜잭션 패턴 + `DATABASE_URL` 게이트(`describeIfDb`).

**Spec:** `docs/superpowers/specs/2026-07-09-stocktaking-normalization-design.md`
**Branch:** `feat/stocktaking-normalization` (이미 체크아웃됨)

## Global Constraints

- **레이어 규칙**: 서비스는 도메인 예외(`NotFoundException`/`BadRequestException` — 이 모듈은 Nest 예외를 이미 사용 중)만 throw. 원장 쓰기는 반드시 `InventoryCommandService.adjustUp/adjustDown` 경유 — `stockEvents`/`stockLedgers` 직접 INSERT/UPDATE 금지(`stock-event.store.ts` 만 예외).
- **트랜잭션**: `this.dbService.run(async (tx) => …, tx)` 단일 러너. 공개 메서드는 마지막 인자 `tx?: DbTx`.
- **DTO 규칙**: `@ApiProperty({ type: 'object' })` 금지 — 중첩은 별도 클래스로.
- **타입 안전**: 정당화 없는 `any`/`as` 금지. nullable 정규화(`?? 0` 등).
- **드리즐 워크플로**: `schema.ts` 편집 → `npm run db:generate:core -- --name <kebab>` → 생성 SQL 리뷰 → `schema.ts` + `drizzle/<ts>_*.sql` + `drizzle/meta/` 를 **한 커밋**. 적용은 dev 머신에서 `npm run db:setup -- --stage dev --deployment lcnine-services`.
- **통합 테스트 실행**: 별도 터미널에서 `./scripts/sst-tunnel.sh deployments/lcnine/services dev` 후 `./scripts/test-core-integration.sh dev <spec-basename>`. `DATABASE_URL` 없으면 `describeIfDb` 로 skip.
- **커밋 접두어**: `[core]`.
- 기존 `InventoryCommandService.adjustUp/adjustDown` 시그니처(변경 금지, 소비만):
  ```ts
  adjustUp(input: { skuId: string; warehouseId: string; locationId?: string | null;
    quantity: number; occurredAt?: Date; idempotencyKey?: string; reason?: string }, tx?: DbTx): Promise<{ eventId: string | null }>
  adjustDown(input: { /* 동일 */ }, tx?: DbTx): Promise<{ eventId: string | null }>
  ```
  둘 다 내부에서 ledger projection + `StockAdjusted` outbox enqueue 를 수행. `adjustDown` 은 해당 위치 ON_HAND 부족 시 `BadRequestException`.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 스키마 | 라인·조정 unique 추가 |
| `apps/core/drizzle/<ts>_stocktaking-uniques.sql` | 마이그레이션 | 생성 SQL + dedup 선행 |
| `apps/core/src/modules/inventory/stocktaking/stocktaking.module.ts` | DI | `CoreInventoryModule` import, 서비스 주입 |
| `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` | 도메인 로직 | `completeSession` 원자 적용, `generateAdjustments`→미리보기, `cancelSession` 신설, scan/count 가드, `scanLocation` 멱등, 공용 helper |
| `apps/core/src/modules/inventory/stocktaking/controllers/stocktaking.controller.ts` | HTTP | `POST sessions/:id/cancel` |
| `apps/core/src/modules/inventory/stocktaking/dto/adjustment-preview.dto.ts` | DTO | `AdjustmentPreviewItem` (신규) |
| `apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts` | 아키텍처 테스트 | 직접 INSERT 금지(신규) |
| `apps/core/src/modules/inventory/stocktaking/services/stocktaking-uniques.integration.spec.ts` | 테스트 | Task 1 |
| `apps/core/src/modules/inventory/stocktaking/services/stocktaking-state-machine.integration.spec.ts` | 테스트 | Task 2 |
| `apps/core/src/modules/inventory/stocktaking/services/stocktaking-complete.integration.spec.ts` | 테스트 | Task 3 |

**작업 순서**: Task 1(스키마·멱등 기반) → Task 2(상태기계) → Task 3(P0-2 원자 적용, Task 1 의 조정 unique 를 `ON CONFLICT` 로 소비). Task 3 이 조정 적용을 켜므로, Task 1·2 완료 시점의 중간 상태는 "조정 미적용(기존과 동일하게 원장 무변)" 이며 정상.

---

## Task 1: 라인·조정 unique + 마이그레이션 + scanLocation 멱등 (P2-5, P0-3 기반)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (stocktakingLines 1716-1743, stocktakingAdjustments 1746-1767)
- Create: `apps/core/drizzle/<ts>_stocktaking-uniques.sql` (생성 후 dedup 선행 추가)
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (scanLocation 147-149)
- Test: `apps/core/src/modules/inventory/stocktaking/services/stocktaking-uniques.integration.spec.ts`

**Interfaces:**
- Produces: unique `uq_stocktaking_line_session_sku_location`(session_id, sku_id, location_id, NULLS NOT DISTINCT), unique `uq_stocktaking_adjustment_line`(line_id). Task 3 의 `completeSession` 이 `onConflictDoNothing({ target: stocktakingAdjustments.lineId })` 로 후자를 소비.

- [ ] **Step 1: 실패 테스트 작성** — `stocktaking-uniques.integration.spec.ts`

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking uniques (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
  });
  afterAll(async () => { await sql.end(); });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => { await fn(tx as DbTx); throw new Rollback(); }),
    ).rejects.toThrow(Rollback);
  }

  async function fixture(tx: DbTx) {
    const [warehouse] = await tx.insert(wmsTables.warehouses).values({ name: `it-wh-${randomUUID().slice(0, 8)}` }).returning();
    const [holder] = await tx.insert(wmsTables.holders).values({ name: `it-h-${randomUUID().slice(0, 8)}` }).returning();
    const [sku] = await tx.insert(wmsTables.skus).values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id }).returning();
    const [location] = await tx.insert(wmsTables.locations).values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}` }).returning();
    const [session] = await tx.insert(wmsTables.stocktakingSessions).values({ warehouseId: warehouse.id, sessionName: 'it', status: 'in_progress' }).returning();
    return { warehouse, sku, location, session };
  }

  it('같은 (session, sku, location) 라인 2건은 unique 위반으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(wmsTables.stocktakingLines).values({ sessionId: f.session.id, skuId: f.sku.id, locationId: f.location.id, expectedQuantity: 1 });
      await expect(
        tx.insert(wmsTables.stocktakingLines).values({ sessionId: f.session.id, skuId: f.sku.id, locationId: f.location.id, expectedQuantity: 1 }),
      ).rejects.toThrow();
    });
  });

  it('같은 line_id 조정 2건은 unique 위반으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [line] = await tx.insert(wmsTables.stocktakingLines).values({ sessionId: f.session.id, skuId: f.sku.id, locationId: f.location.id, expectedQuantity: 1 }).returning();
      await tx.insert(wmsTables.stocktakingAdjustments).values({ sessionId: f.session.id, lineId: line.id, adjustmentQuantity: 1, adjustmentType: 'INCREASE' });
      await expect(
        tx.insert(wmsTables.stocktakingAdjustments).values({ sessionId: f.session.id, lineId: line.id, adjustmentQuantity: 1, adjustmentType: 'INCREASE' }),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

터널 기동 후 실행:
```bash
./scripts/test-core-integration.sh dev stocktaking-uniques.integration
```
Expected: FAIL — 두 번째 INSERT 가 거부되지 않아 `expect(...).rejects` 가 실패(unique 미존재).

- [ ] **Step 3: 스키마에 unique 추가** — `inventory.schema.ts`

`stocktakingLines` 의 세 번째 인자(인덱스 콜백, 1738-1742) 에 추가:
```ts
    uqStocktakingLine: unique('uq_stocktaking_line_session_sku_location')
      .on(t.sessionId, t.skuId, t.locationId)
      .nullsNotDistinct(),
```
`stocktakingAdjustments` 의 세 번째 인자(1763-1766) 에 추가:
```ts
    uqStocktakingAdjustmentLine: unique('uq_stocktaking_adjustment_line').on(t.lineId),
```
(`unique` 는 이미 import 되어 있음 — line 16.)

- [ ] **Step 4: 마이그레이션 생성 + dedup 선행 추가**

```bash
npm run db:generate:core -- --name stocktaking-uniques
```
생성된 `apps/core/drizzle/<ts>_stocktaking-uniques.sql` 를 열어, `ADD CONSTRAINT` 두 줄 **위에** dedup 선행 블록을 삽입:
```sql
-- P0-3/P2-5 dedup (light/dev data). 운영에 실 실사 데이터가 있으면 phase 분리 (spec §10 #1).
DELETE FROM "stocktaking_adjustments" a
  USING "stocktaking_adjustments" b
  WHERE a.line_id = b.line_id AND a.created_at < b.created_at;
DELETE FROM "stocktaking_lines" a
  USING "stocktaking_lines" b
  WHERE a.session_id = b.session_id
    AND a.sku_id = b.sku_id
    AND a.location_id IS NOT DISTINCT FROM b.location_id
    AND a.created_at < b.created_at
    AND NOT EXISTS (SELECT 1 FROM "stocktaking_adjustments" adj WHERE adj.line_id = a.id);
```
dev DB 에 적용:
```bash
npm run db:setup -- --stage dev --deployment lcnine-services
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
./scripts/test-core-integration.sh dev stocktaking-uniques.integration
```
Expected: PASS (2 tests).

- [ ] **Step 6: scanLocation 멱등화 + 멱등 테스트 추가** — `stocktaking.service.ts:147-149`

```ts
      if (linesToCreate.length > 0) {
        await tx.insert(stocktakingLines).values(linesToCreate).onConflictDoNothing();
      }
```
같은 spec 파일에 테스트 추가:
```ts
  it('같은 위치를 두 번 scanLocation 해도 라인이 중복 생성되지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      // 해당 위치 ON_HAND 시드: ledger 직접 insert (store 아님 — 테스트 픽스처는 arch 예외)
      await tx.insert(wmsTables.stockLedgers).values({ skuId: f.sku.id, warehouseId: f.warehouse.id, locationId: f.location.id, stockState: 'ON_HAND', qty: 5 });
      const dbService = { db, run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)) } as unknown as DbService<typeof wmsSchema>;
      const { StocktakingService } = await import('./stocktaking.service');
      const svc = new StocktakingService(dbService);
      await svc.scanLocation({ sessionId: f.session.id, locationBarcode: f.location.code }, tx);
      await svc.scanLocation({ sessionId: f.session.id, locationBarcode: f.location.code }, tx);
      const lines = await tx.select().from(wmsTables.stocktakingLines).where(eq(wmsTables.stocktakingLines.sessionId, f.session.id));
      expect(lines).toHaveLength(1);
    });
  });
```
> 참고: 이 테스트 픽스처의 `stockLedgers` 직접 insert 는 `*.spec.ts` 라 Task 3 아키텍처 테스트 스캔에서 제외된다.

- [ ] **Step 7: 테스트 통과 확인**

```bash
./scripts/test-core-integration.sh dev stocktaking-uniques.integration
```
Expected: PASS (3 tests).

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/drizzle \
        apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts \
        apps/core/src/modules/inventory/stocktaking/services/stocktaking-uniques.integration.spec.ts
git commit -m "[core] 실사 라인·조정 unique + scanLocation 멱등 (P2-5, P0-3 기반)"
```

---

## Task 2: 세션 상태기계 — cancel + scan/count 가드 (W2, 가드 하드닝)

**Files:**
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (cancelSession 신설, assertInProgress helper, scanLocation/scanProduct/updateCount 가드)
- Modify: `apps/core/src/modules/inventory/stocktaking/controllers/stocktaking.controller.ts` (cancel 라우트)
- Test: `apps/core/src/modules/inventory/stocktaking/services/stocktaking-state-machine.integration.spec.ts`

**Interfaces:**
- Produces: `StocktakingService.cancelSession(sessionId: string, tx?: DbTx): Promise<{ sessionId: string; status: 'cancelled'; message: string }>`; private `assertInProgress(tx: DbTx, sessionId: string): Promise<void>`.

- [ ] **Step 1: 실패 테스트 작성** — `stocktaking-state-machine.integration.spec.ts`

```ts
import { BadRequestException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking state machine (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = { db, run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)) } as unknown as DbService<typeof wmsSchema>;
    svc = new StocktakingService(dbService);
  });
  afterAll(async () => { await sql.end(); });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(db.transaction(async (tx) => { await fn(tx as DbTx); throw new Rollback(); })).rejects.toThrow(Rollback);
  }
  async function session(tx: DbTx, status: 'draft' | 'in_progress' | 'completed' | 'cancelled') {
    const [wh] = await tx.insert(wmsTables.warehouses).values({ name: `it-wh-${randomUUID().slice(0, 8)}` }).returning();
    const [s] = await tx.insert(wmsTables.stocktakingSessions).values({ warehouseId: wh.id, sessionName: 'it', status }).returning();
    return { wh, s };
  }

  it('in_progress 세션을 cancel 하면 cancelled 로 전이한다', async () => {
    await inRollbackTx(async (tx) => {
      const { s } = await session(tx, 'in_progress');
      const r = await svc.cancelSession(s.id, tx);
      expect(r.status).toBe('cancelled');
      const [row] = await tx.select().from(wmsTables.stocktakingSessions).where(eq(wmsTables.stocktakingSessions.id, s.id));
      expect(row.status).toBe('cancelled');
    });
  });

  it('completed 세션 cancel 은 400 으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { s } = await session(tx, 'completed');
      await expect(svc.cancelSession(s.id, tx)).rejects.toThrow(BadRequestException);
    });
  });

  it('in_progress 아닌 세션의 scanLocation 은 400 으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { s } = await session(tx, 'draft');
      await expect(svc.scanLocation({ sessionId: s.id, locationBarcode: 'X' }, tx)).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
./scripts/test-core-integration.sh dev stocktaking-state-machine.integration
```
Expected: FAIL — `svc.cancelSession` 미존재(TypeError), scanLocation 가드 미존재(draft 세션에서 거부 안 됨).

- [ ] **Step 3: assertInProgress helper + cancelSession 구현** — `stocktaking.service.ts`

파일 하단(클래스 내부, `completeSession` 뒤)에 추가:
```ts
  private async assertInProgress(tx: DbTx, sessionId: string): Promise<void> {
    const { stocktakingSessions } = wmsTables;
    const [session] = await tx
      .select({ status: stocktakingSessions.status })
      .from(stocktakingSessions)
      .where(eq(stocktakingSessions.id, sessionId))
      .limit(1);
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.status !== 'in_progress') throw new BadRequestException(`Session is not in progress`);
  }

  async cancelSession(sessionId: string, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions } = wmsTables;
      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .for('update');
      if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
      if (session.status === 'completed' || session.status === 'cancelled') {
        throw new BadRequestException(`Session is already ${session.status}`);
      }
      await tx
        .update(stocktakingSessions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(stocktakingSessions.id, sessionId));
      return { sessionId, status: 'cancelled' as const, message: '재고 실사를 취소했습니다.' };
    }, tx);
  }
```

- [ ] **Step 4: scan/count 가드 삽입** — `stocktaking.service.ts`

`scanLocation` 의 `run` 콜백 첫 줄(구조분해 `const { locations, … }` 직후)에:
```ts
      await this.assertInProgress(tx, dto.sessionId);
```
`scanProduct` 의 `run` 콜백 첫 줄(구조분해 직후)에 동일:
```ts
      await this.assertInProgress(tx, dto.sessionId);
```
`updateCount` 에서 line 조회(`if (!line[0]) …`) 직후에:
```ts
      await this.assertInProgress(tx, line[0].sessionId);
```

- [ ] **Step 5: cancel 라우트 추가** — `stocktaking.controller.ts` (completeSession 핸들러 뒤, 클래스 닫기 전)

```ts
  @Post('sessions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '재고 실사 취소 (Cancel stocktaking session)' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session cancelled' })
  async cancelSession(@Param('id') id: string) {
    return this.stocktakingService.cancelSession(id);
  }
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
./scripts/test-core-integration.sh dev stocktaking-state-machine.integration
```
Expected: PASS (3 tests).

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts \
        apps/core/src/modules/inventory/stocktaking/controllers/stocktaking.controller.ts \
        apps/core/src/modules/inventory/stocktaking/services/stocktaking-state-machine.integration.spec.ts
git commit -m "[core] 실사 세션 cancel + scan/count 상태 가드 (W2)"
```

---

## Task 3: 완료 시점 원자 적용 + 미리보기 격하 + 아키텍처 봉인 (P0-2, P0-3, W3, 실사 P2-6)

**Files:**
- Create: `apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts`
- Create: `apps/core/src/modules/inventory/stocktaking/dto/adjustment-preview.dto.ts`
- Modify: `apps/core/src/modules/inventory/stocktaking/stocktaking.module.ts`
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (constructor, computeOnHand helper, generateAdjustments→preview, completeSession 재작성)
- Test: `apps/core/src/modules/inventory/stocktaking/services/stocktaking-complete.integration.spec.ts`

**Interfaces:**
- Consumes: `InventoryCommandService.adjustUp/adjustDown`(Global Constraints), unique `uq_stocktaking_adjustment_line`(Task 1).
- Produces: `completeSession` 이 조정을 원장 적용; `generateAdjustments` 는 `{ adjustmentsCreated, eventsPosted: 0, message, preview: AdjustmentPreviewItem[] }` 반환(무영속). private `computeOnHand(tx: DbTx, skuId: string, warehouseId: string, locationId: string | null): Promise<number>`.

- [ ] **Step 1: 아키텍처 테스트 작성(현재 red)** — `inventory-write-boundary.arch.spec.ts`

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// 이 spec 은 modules/inventory 루트에 위치 → __dirname 이 스캔 루트
const INVENTORY_ROOT = __dirname;
const ALLOW_FILES = new Set(['stock-event.store.ts']); // 유일한 정상 원장 writer

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...collectTsFiles(full)); continue; }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts')) continue;      // 테스트 픽스처 제외
    if (ALLOW_FILES.has(entry)) continue;
    out.push(full);
  }
  return out;
}

const FORBIDDEN = [
  /\.insert\(\s*(wmsTables\.)?stockEvents\b/,
  /\.insert\(\s*(wmsTables\.)?stockLedgers\b/,
  /\.update\(\s*(wmsTables\.)?stockLedgers\b/,
];

describe('inventory write boundary (arch)', () => {
  it('StockEventStore 외부에서 stockEvents/stockLedgers 직접 쓰기 금지', () => {
    const violations: string[] = [];
    for (const file of collectTsFiles(INVENTORY_ROOT)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) violations.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인** (DB 불요 — 일반 jest)

```bash
npx jest --testPathPattern='inventory-write-boundary.arch' -v
```
Expected: FAIL — `stocktaking.service.ts:362  .insert(stockEvents)` 위반 1건 나열.

- [ ] **Step 3: 완료/미리보기 통합 테스트 작성** — `stocktaking-complete.integration.spec.ts`

```ts
import { BadRequestException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking complete (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;
  let command: InventoryCommandService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = { db, run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)) } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
  });
  afterAll(async () => { await sql.end(); });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(db.transaction(async (tx) => { await fn(tx as DbTx); throw new Rollback(); })).rejects.toThrow(Rollback);
  }
  async function onHandAt(tx: DbTx, skuId: string, warehouseId: string, locationId: string) {
    const [row] = await tx.select({ qty: wmsTables.stockLedgers.qty }).from(wmsTables.stockLedgers)
      .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.locationId, locationId), eq(wmsTables.stockLedgers.stockState, 'ON_HAND'))).limit(1);
    return row?.qty ?? 0;
  }
  // 시드: adjustUp(위치 미지정)→시스템 위치에 ON_HAND, 해결된 locationId 를 되읽어 반환
  async function seed(tx: DbTx, qty: number) {
    const [wh] = await tx.insert(wmsTables.warehouses).values({ name: `it-wh-${randomUUID().slice(0, 8)}` }).returning();
    const [h] = await tx.insert(wmsTables.holders).values({ name: `it-h-${randomUUID().slice(0, 8)}` }).returning();
    const [sku] = await tx.insert(wmsTables.skus).values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: h.id }).returning();
    const { eventId } = await command.adjustUp({ skuId: sku.id, warehouseId: wh.id, quantity: qty, reason: 'SEED' }, tx);
    const [ev] = await tx.select({ loc: wmsTables.stockEvents.toLocationId }).from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.id, eventId as string));
    const locationId = ev.loc as string;
    const [session] = await tx.insert(wmsTables.stocktakingSessions).values({ warehouseId: wh.id, sessionName: 'it', status: 'in_progress' }).returning();
    return { wh, sku, locationId, session };
  }
  async function addLine(tx: DbTx, s: { session: { id: string }; sku: { id: string }; locationId: string }, expected: number, counted: number) {
    const [line] = await tx.insert(wmsTables.stocktakingLines).values({
      sessionId: s.session.id, skuId: s.sku.id, locationId: s.locationId,
      expectedQuantity: expected, countedQuantity: counted, variance: counted - expected, status: 'counted',
    }).returning();
    return line;
  }

  it('완료 시 조정이 원장에 적용되고 조정행·라인상태·세션이 종결된다', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      const line = await addLine(tx, s, 10, 12); // +2
      const res = await svc.completeSession(s.session.id, tx);

      expect(await onHandAt(tx, s.sku.id, s.wh.id, s.locationId)).toBe(12);
      expect(res.summary.adjustmentsApplied).toBe(1);
      const [adj] = await tx.select().from(wmsTables.stocktakingAdjustments).where(eq(wmsTables.stocktakingAdjustments.lineId, line.id));
      expect(adj).toMatchObject({ adjustmentType: 'INCREASE', adjustmentQuantity: 2 });
      const [ev] = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.idempotencyKey, `stocktaking:${s.session.id}:${line.id}`));
      expect(ev).toMatchObject({ transitionType: 'ADJUST_UP', eventStatus: 'POSTED' });
      const [lineRow] = await tx.select().from(wmsTables.stocktakingLines).where(eq(wmsTables.stocktakingLines.id, line.id));
      expect(lineRow.status).toBe('adjusted');
      const [sess] = await tx.select().from(wmsTables.stocktakingSessions).where(eq(wmsTables.stocktakingSessions.id, s.session.id));
      expect(sess.status).toBe('completed');
    });
  });

  it('라이브 delta: 스캔~완료 사이 원장이 변해도 최종 ON_HAND 는 counted 와 같다', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      await addLine(tx, s, 10, 7); // 스냅샷 variance = -3
      await command.adjustDown({ skuId: s.sku.id, warehouseId: s.wh.id, locationId: s.locationId, quantity: 2, reason: 'MID' }, tx); // 현재고 8
      await svc.completeSession(s.session.id, tx);
      // 스냅샷(-3)이면 5, 라이브(counted 7)면 7
      expect(await onHandAt(tx, s.sku.id, s.wh.id, s.locationId)).toBe(7);
    });
  });

  it('완료를 두 번 하면 두 번째는 400 으로 거부된다(멱등)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 5);
      await addLine(tx, s, 5, 6);
      await svc.completeSession(s.session.id, tx);
      await expect(svc.completeSession(s.session.id, tx)).rejects.toThrow(BadRequestException);
    });
  });

  it('generateAdjustments 는 미리보기라 원장/조정을 영속하지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      const line = await addLine(tx, s, 10, 12);
      const preview = await svc.generateAdjustments(s.session.id, {}, tx);
      expect(preview.preview).toEqual([expect.objectContaining({ lineId: line.id, delta: 2, adjustmentType: 'INCREASE', currentOnHand: 10, countedQuantity: 12 })]);
      expect(await onHandAt(tx, s.sku.id, s.wh.id, s.locationId)).toBe(10); // 불변
      const adj = await tx.select().from(wmsTables.stocktakingAdjustments).where(eq(wmsTables.stocktakingAdjustments.sessionId, s.session.id));
      expect(adj).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

```bash
./scripts/test-core-integration.sh dev stocktaking-complete.integration
```
Expected: FAIL — `new StocktakingService(dbService, command)` 인자 수 불일치(현재 생성자 1개) / `generateAdjustments` 가 preview 미반환.

- [ ] **Step 5: PreviewItem DTO 생성** — `dto/adjustment-preview.dto.ts`

```ts
import { ApiProperty } from '@nestjs/swagger';

export class AdjustmentPreviewItem {
  @ApiProperty() lineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty({ type: String, nullable: true }) locationId: string | null;
  @ApiProperty() countedQuantity: number;
  @ApiProperty() currentOnHand: number;
  @ApiProperty({ description: '적용 예정 delta (counted − 현재 ON_HAND)' }) delta: number;
  @ApiProperty({ enum: ['INCREASE', 'DECREASE'] }) adjustmentType: 'INCREASE' | 'DECREASE';
}
```

- [ ] **Step 6: 모듈 배선** — `stocktaking.module.ts` (전체 교체)

```ts
import { Module } from '@nestjs/common';
import { StocktakingController } from './controllers/stocktaking.controller';
import { StocktakingService } from './services/stocktaking.service';
import { CoreInventoryModule } from '../core/inventory.module';

@Module({
  imports: [CoreInventoryModule],
  controllers: [StocktakingController],
  providers: [StocktakingService],
  exports: [StocktakingService],
})
export class StocktakingModule {}
```

- [ ] **Step 7: 서비스 생성자에 InventoryCommandService 주입 + computeOnHand helper** — `stocktaking.service.ts`

import 추가(상단):
```ts
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { AdjustmentPreviewItem } from '../dto/adjustment-preview.dto';
```
생성자 교체:
```ts
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commandService: InventoryCommandService,
  ) {}
```
클래스 내부(예: `assertInProgress` 옆)에 helper 추가:
```ts
  private async computeOnHand(tx: DbTx, skuId: string, warehouseId: string, locationId: string | null): Promise<number> {
    const { stockLedgers } = wmsTables;
    const [row] = await tx
      .select({ qty: stockLedgers.qty })
      .from(stockLedgers)
      .where(
        and(
          eq(stockLedgers.skuId, skuId),
          eq(stockLedgers.warehouseId, warehouseId),
          locationId ? eq(stockLedgers.locationId, locationId) : sql`${stockLedgers.locationId} IS NULL`,
          eq(stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    return row?.qty ?? 0;
  }
```

- [ ] **Step 8: generateAdjustments 를 미리보기로 재작성** — `stocktaking.service.ts:329-396` 전체 교체

```ts
  /**
   * 미리보기(dry-run): variance 라인의 라이브 delta 를 계산만 한다. 영속 없음.
   * 실제 적용은 completeSession(§5) 에서 원자적으로 수행한다.
   */
  async generateAdjustments(sessionId: string, dto: GenerateAdjustmentsDto, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingLines, stocktakingSessions } = wmsTables;

      const [session] = await tx.select().from(stocktakingSessions).where(eq(stocktakingSessions.id, sessionId)).limit(1);
      if (!session) throw new NotFoundException(`Session ${sessionId} not found`);

      const conditions = [
        eq(stocktakingLines.sessionId, sessionId),
        sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
        sql`${stocktakingLines.countedQuantity} IS NOT NULL`,
      ];
      if (dto.lineIds && dto.lineIds.length > 0) {
        conditions.push(sql`${stocktakingLines.id} = ANY(${dto.lineIds}::uuid[])`);
      }
      const lines = await tx.select().from(stocktakingLines).where(and(...conditions));

      const preview: AdjustmentPreviewItem[] = [];
      for (const line of lines) {
        const counted = line.countedQuantity ?? 0;
        const currentOnHand = await this.computeOnHand(tx, line.skuId, session.warehouseId, line.locationId);
        const delta = counted - currentOnHand;
        if (delta === 0) continue;
        preview.push({
          lineId: line.id,
          skuId: line.skuId,
          locationId: line.locationId,
          countedQuantity: counted,
          currentOnHand,
          delta,
          adjustmentType: delta > 0 ? 'INCREASE' : 'DECREASE',
        });
      }

      return {
        adjustmentsCreated: preview.length, // 하위호환: 적용 예정 수
        eventsPosted: 0, // 미리보기 — 아직 적용 안 됨
        message: `${preview.length}개 조정이 미리보기로 계산되었습니다 (완료 시 적용).`,
        preview,
      };
    }, tx);
  }
```

- [ ] **Step 9: completeSession 원자 적용으로 재작성** — `stocktaking.service.ts:401-452` 전체 교체

```ts
  /**
   * 실사 완료 — variance 라인을 원장에 원자 적용(adjustUp/adjustDown, 라이브 delta)하고 세션 종결.
   */
  async completeSession(sessionId: string, tx?: DbTx) {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions, stocktakingLines, stocktakingAdjustments } = wmsTables;

      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .for('update');
      if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
      if (session.status !== 'in_progress') throw new BadRequestException(`Session is not in progress`);

      const lines = await tx
        .select()
        .from(stocktakingLines)
        .where(
          and(
            eq(stocktakingLines.sessionId, sessionId),
            sql`${stocktakingLines.variance} IS NOT NULL AND ${stocktakingLines.variance} != 0`,
            sql`${stocktakingLines.countedQuantity} IS NOT NULL`,
          ),
        )
        .for('update');

      let adjustmentsApplied = 0;
      for (const line of lines) {
        const counted = line.countedQuantity ?? 0;
        const currentOnHand = await this.computeOnHand(tx, line.skuId, session.warehouseId, line.locationId);
        const delta = counted - currentOnHand;

        if (delta !== 0) {
          const idempotencyKey = `stocktaking:${sessionId}:${line.id}`;
          const reason = `stocktaking:${sessionId}`;
          const { eventId } =
            delta > 0
              ? await this.commandService.adjustUp(
                  { skuId: line.skuId, warehouseId: session.warehouseId, locationId: line.locationId, quantity: delta, idempotencyKey, reason },
                  tx,
                )
              : await this.commandService.adjustDown(
                  { skuId: line.skuId, warehouseId: session.warehouseId, locationId: line.locationId, quantity: -delta, idempotencyKey, reason },
                  tx,
                );

          await tx
            .insert(stocktakingAdjustments)
            .values({
              sessionId,
              lineId: line.id,
              stockEventId: eventId,
              adjustmentQuantity: Math.abs(delta),
              adjustmentType: delta > 0 ? 'INCREASE' : 'DECREASE',
              reason: `Variance detected: ${line.variance}`,
            })
            .onConflictDoNothing({ target: stocktakingAdjustments.lineId });

          adjustmentsApplied++;
        }

        await tx.update(stocktakingLines).set({ status: 'adjusted', updatedAt: new Date() }).where(eq(stocktakingLines.id, line.id));
      }

      const [lineStats] = await tx
        .select({
          total: sql<number>`count(*)`,
          withVariances: sql<number>`count(*) FILTER (WHERE ${stocktakingLines.variance} != 0)`,
        })
        .from(stocktakingLines)
        .where(eq(stocktakingLines.sessionId, sessionId));

      const completedAt = new Date();
      await tx
        .update(stocktakingSessions)
        .set({ status: 'completed', completedAt, updatedAt: completedAt })
        .where(eq(stocktakingSessions.id, sessionId));

      return {
        sessionId,
        status: 'completed' as const,
        completedAt,
        summary: {
          totalLines: Number(lineStats?.total ?? 0),
          discrepanciesFound: Number(lineStats?.withVariances ?? 0),
          adjustmentsApplied,
        },
      };
    }, tx);
  }
```

- [ ] **Step 10: 아키텍처 테스트 통과 확인** (DB 불요)

```bash
npx jest --testPathPattern='inventory-write-boundary.arch' -v
```
Expected: PASS — `stocktaking.service.ts` 의 직접 INSERT 제거로 위반 0.

- [ ] **Step 11: 완료/미리보기 통합 테스트 통과 확인**

```bash
./scripts/test-core-integration.sh dev stocktaking-complete.integration
```
Expected: PASS (4 tests).

- [ ] **Step 12: 전체 타입체크/린트**

```bash
npx tsc -p apps/core/tsconfig.app.json --noEmit && npm run lint
```
Expected: 에러 없음. (구 `generateAdjustments` 가 쓰던 `stockEvents` 구조분해가 남아있으면 제거.)

- [ ] **Step 13: 커밋**

```bash
git add apps/core/src/modules/inventory/inventory-write-boundary.arch.spec.ts \
        apps/core/src/modules/inventory/stocktaking/dto/adjustment-preview.dto.ts \
        apps/core/src/modules/inventory/stocktaking/stocktaking.module.ts \
        apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts \
        apps/core/src/modules/inventory/stocktaking/services/stocktaking-complete.integration.spec.ts
git commit -m "[core] 실사 완료 원장 원자 적용 + 미리보기 격하 + 직접INSERT 봉인 (P0-2/P0-3/W3)"
```

---

## Self-Review

**1. Spec coverage:**
- P0-2(원장 우회 제거) → Task 3 Step 9(adjustUp/adjustDown 재배선) + Step 1/10(arch test). ✔
- P0-3(멱등) → Task 3 Step 9(status 가드 + `FOR UPDATE` + idempotencyKey + `ON CONFLICT` 조정) + Task 1(조정 unique). ✔
- W3(순서·원자성) → Task 3 Step 9(단일 tx 완료 적용, generate=미리보기). ✔
- W2(취소) → Task 2(cancelSession + 라우트). ✔
- P2-5(라인 unique) → Task 1(라인 unique + scanLocation 멱등). ✔
- 아키텍처 테스트(P0-2 회귀) → Task 3 Step 1/10. ✔
- P2-6 실사(라이브 delta) → Task 3 Step 7 helper + Step 9/8 사용, Step 3 라이브-delta 테스트. ✔
- scan/count 상태 가드(부수 하드닝) → Task 2 Step 3/4. ✔

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드/명령/예상결과 포함. dedup SQL·arch 정규식·테스트 전문 명시. 플레이스홀더 없음. ✔

**3. Type consistency:**
- `adjustUp/adjustDown` 인자·반환(`{ eventId }`)이 Global Constraints 와 Task 3 사용처 일치. ✔
- `computeOnHand(tx, skuId, warehouseId, locationId)` 정의(Step 7)와 사용처(Step 8/9) 시그니처 일치. ✔
- `AdjustmentPreviewItem` 필드(DTO Step 5)와 preview 생성(Step 8)·테스트 단언(Step 3) 일치. ✔
- `StocktakingService` 생성자: Task 1/2 테스트는 `(dbService)`, Task 3 에서 `(dbService, command)` 로 변경 — Task 3 테스트만 command 전달(일관). ✔
- unique `uq_stocktaking_adjustment_line`(line_id) 정의(Task 1)와 `onConflictDoNothing({ target: stocktakingAdjustments.lineId })`(Task 3) 대응. ✔

**착수 체크포인트(스펙 §10) 재확인:**
1. 운영 실사 데이터 유무 — Task 1 Step 4 dedup 이 light/dev 가정. 실 데이터 있으면 phase 분리(구현자 확인).
2. `CoreInventoryModule`(= `core/inventory.module.ts`) 가 `InventoryCommandService` export 확인됨 — Task 3 Step 6.
3. `adjustUp/adjustDown` 는 `occurredAt` 미지정 시 `new Date()` 기본 — Task 3 는 미지정(완료 시각). 확인됨.
