# 물류 현장 앱 Phase 1 — 재고 상세·조정 & 실사 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `native/warehouse-app`에 첫 write 워크플로우 2종(재고 조정·실사)을 얹어 Phase 1(마스터 설계 §11)을 완성한다.

**Architecture:** 백엔드는 apps/core에 additive 변경 4건(세션 상세 엔드포인트 1개 신규, 응답 확장 2개, 멱등키 optional 필드 1개)만 가한다 — 스키마 변경도 마이그레이션도 없다. 프론트는 기존 `useSkuSearch` 데이터훅 규약을 복제해 도메인별 훅 + 화면을 추가하고, 기기 고정 창고 컨텍스트를 새로 도입한다. 실사는 `scan-location`이 반환하는 위치별 라인을 화면 상태의 원천으로 삼아 "이어하기"가 항상 성립하게 한다.

**Tech Stack:** 백엔드 = NestJS + Drizzle ORM(postgres.js), Jest 통합 스펙. 프론트 = Vite + React 19 + TanStack Router(memory history) + TanStack Query + Tailwind 4 + Vitest/Testing Library.

## Global Constraints

- **설계 스펙**: `docs/superpowers/specs/2026-07-23-warehouse-app-phase1-adjust-stocktaking-design.md` — 충돌 시 스펙이 우선한다.
- **브랜치**: `feat/warehouse-app-phase1-adjust-stocktaking` (이미 생성됨).
- **백엔드는 전부 additive** — 기존 응답 필드 제거 금지, 기존 응답의 행 집합 축소 금지, 스키마/마이그레이션 변경 금지.
- **inventory 쿼리 규칙(CLAUDE.md)**: `trx.select().from().innerJoin().where().orderBy()` + Drizzle 연산자만. `db.query.*`·`with` 관계·`any`/`as` 캐스팅 금지. DB 주입은 `@InjectTypedDb<typeof wmsSchema>()`.
- **트랜잭션 규칙(ADR-0025)**: 단일 러너 `this.dbService.run(fn, tx)`. public 메서드는 `tx?: DbTx`를 마지막 파라미터로. per-class `inTx` 헬퍼 금지.
- **에러 규칙**: 서비스는 `@app/shared`의 `NotFoundError`/`BadRequestError`/`ConflictError`를 던진다. 컨트롤러는 service 호출을 try/catch로 감싸지 않는다.
- **프론트 UI 문구는 한국어**, 현장 작업자 기준의 평이한 존댓말(기존 `errorMessage.ts` 톤: "찾을 수 없어요.").
- **프론트 데이터훅 규약**: react-query key = 파라미터 튜플, `api.request<T>({ path })` 호출, URL 상태 없이 로컬 `useState`. mutation 성공 시 관련 key 무효화.
- **프론트 `any`/`as` 금지** — 기존 테스트가 쓰는 `request as unknown as ApiClient['request']` 캐스트만 예외(테스트 전용, 기존 패턴).
- **작업 디렉터리**: 프론트 명령은 `native/warehouse-app`에서, 백엔드 명령은 레포 루트에서 실행한다.

### 자주 쓰는 명령

```bash
# 프론트 (native/warehouse-app 에서)
npx vitest run <파일경로>          # 단일 테스트 파일
npm test                           # 전체 vitest
npm run build                      # tsc -b && vite build (타입체크 포함)

# 백엔드 (레포 루트에서)
npm run test:core:integration:local -- <패턴>   # docker compose postgres 기동 + migrate + jest
npx nest build core                             # core 타입체크/빌드
```

`test:core:integration:local`은 `DATABASE_URL` 없이는 통합 스펙이 `describe.skip`되므로 **반드시 이 스크립트를 통해** 실행한다.

---

# Part A — 백엔드 (apps/core)

### Task 1: `GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId` details에 `locationCode` 추가

**Files:**
- Modify: `apps/core/src/modules/inventory/stock-projection/services/stock-projection.reader.ts:163-202`
- Test: `apps/core/src/modules/inventory/stock-projection/services/stock-projection-by-location.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음 (첫 백엔드 태스크)
- Produces: `StockProjectionReader.getBySkuAndWarehouse(skuId, warehouseId, tx?)`의 `details[]` 항목이 `{ locationId: string | null; locationCode: string | null; stockState: string; quantity: number }`가 된다. Task 10(프론트 `useSkuWarehouseStock`)이 이 모양에 의존한다.

- [ ] **Step 1: 실패하는 통합 테스트를 작성한다**

Create `apps/core/src/modules/inventory/stock-projection/services/stock-projection-by-location.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockProjectionReader } from './stock-projection.reader';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stock projection by-location (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let reader: StockProjectionReader;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    reader = new StockProjectionReader(dbService, eventStore);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seed(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    // 코드 역순으로 삽입해 정렬이 실제로 적용되는지 본다.
    const [locB] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-B-${randomUUID().slice(0, 8)}` })
      .returning();
    const [locA] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-A-${randomUUID().slice(0, 8)}` })
      .returning();
    await tx.insert(wmsTables.stockLedgers).values([
      { skuId: sku.id, warehouseId: warehouse.id, locationId: locB.id, stockState: 'ON_HAND', qty: 7 },
      { skuId: sku.id, warehouseId: warehouse.id, locationId: locA.id, stockState: 'ON_HAND', qty: 5 },
      { skuId: sku.id, warehouseId: warehouse.id, locationId: null, stockState: 'ON_HAND', qty: 3 },
    ]);
    return { warehouse, sku, locA, locB };
  }

  it('details 각 행에 locationCode 를 동반한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku, locA } = await seed(tx);

      const result = await reader.getBySkuAndWarehouse(sku.id, warehouse.id, tx);

      const withLocation = result.details.filter((d) => d.locationId !== null);
      expect(withLocation).toHaveLength(2);
      expect(withLocation[0].locationId).toBe(locA.id);
      expect(withLocation[0].locationCode).toBe(locA.code);
      expect(withLocation[0].quantity).toBe(5);
    });
  });

  it('locationId 가 null 인 원장 행은 locationCode 도 null 로 두고 마지막에 정렬한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, sku } = await seed(tx);

      const result = await reader.getBySkuAndWarehouse(sku.id, warehouse.id, tx);

      expect(result.details).toHaveLength(3);
      const last = result.details[result.details.length - 1];
      expect(last.locationId).toBeNull();
      expect(last.locationCode).toBeNull();
      expect(last.quantity).toBe(3);
    });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run (레포 루트):
```bash
npm run test:core:integration:local -- stock-projection-by-location
```
Expected: FAIL — `Property 'locationCode' does not exist` 타입 에러, 또는 `expect(received).toBe(expected)`에서 `locationCode`가 `undefined`.

- [ ] **Step 3: 최소 구현 — leftJoin + 정렬**

`apps/core/src/modules/inventory/stock-projection/services/stock-projection.reader.ts`의 `getBySkuAndWarehouse` 안, `details` 조회 블록(현재 173-184행)을 아래로 교체한다:

```ts
    const details = await this.dbService.run(
      async (trx) =>
        trx
          .select({
            locationId: wmsTables.stockLedgers.locationId,
            locationCode: wmsTables.locations.code,
            stockState: wmsTables.stockLedgers.stockState,
            quantity: wmsTables.stockLedgers.qty,
          })
          .from(wmsTables.stockLedgers)
          .leftJoin(wmsTables.locations, eq(wmsTables.stockLedgers.locationId, wmsTables.locations.id))
          .where(and(eq(wmsTables.stockLedgers.skuId, skuId), eq(wmsTables.stockLedgers.warehouseId, warehouseId)))
          .orderBy(sql`${wmsTables.locations.code} ASC NULLS LAST`, wmsTables.stockLedgers.stockState),
      tx,
    );
```

`eq`·`and`·`sql`은 파일 상단에서 이미 import돼 있다(1-11행). 추가 import는 필요 없다.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run:
```bash
npm run test:core:integration:local -- stock-projection-by-location
```
Expected: PASS (2 tests)

- [ ] **Step 5: core 빌드로 타입을 검증한다**

Run (레포 루트):
```bash
npx nest build core
```
Expected: 에러 없이 종료 (exit 0)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/stock-projection/services/stock-projection.reader.ts \
        apps/core/src/modules/inventory/stock-projection/services/stock-projection-by-location.integration.spec.ts
git commit -m "feat(core): SKU×창고 재고 상세 details 에 locationCode 동반

현장 작업자는 UUID 가 아니라 A-01-02 를 본다. 기존 details[] 는 locationId
그레인이지만 코드가 없어 화면에 쓸 수 없었다. leftJoin 으로 코드를 얹고
위치 코드 순 정렬(NULLS LAST)을 추가한다. 필드 추가만 — 행 집합 불변."
```

---

### Task 2: `GET /stocktaking/sessions/:id` 세션 상세 신규

**Files:**
- Create: `apps/core/src/modules/inventory/stocktaking/dto/session-detail.dto.ts`
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts` (`getVariances` 앞에 `getSession` 추가)
- Modify: `apps/core/src/modules/inventory/stocktaking/controllers/stocktaking.controller.ts`
- Test: `apps/core/src/modules/inventory/stocktaking/services/stocktaking-session-detail.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `StocktakingService.getSession(sessionId: string, tx?: DbTx): Promise<StocktakingSessionDetailDto>`
  - `StocktakingSessionDetailDto { id, warehouseId, sessionName, status, notes, createdAt, startedAt, completedAt, progress: { total, counted }, lines: StocktakingLineDto[] }`
  - `StocktakingLineDto { lineId, skuId, skuCode, skuName, locationId, locationCode, expectedQuantity, countedQuantity, variance, scannedBarcode, status, notes }`
  - Task 14(프론트 `useStocktakingSession`)가 이 모양에 의존한다.

- [ ] **Step 1: 실패하는 통합 테스트를 작성한다**

Create `apps/core/src/modules/inventory/stocktaking/services/stocktaking-session-detail.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { NotFoundError } from '@app/shared';
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

describeIfDb('stocktaking session detail (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    const command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seed(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [skuB] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'sku-b', code: `IT-B-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [skuA] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'sku-a', code: `IT-A-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}` })
      .returning();
    const [session] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'it-session', status: 'in_progress' })
      .returning();
    await tx.insert(wmsTables.stocktakingLines).values([
      {
        sessionId: session.id,
        skuId: skuB.id,
        locationId: loc.id,
        expectedQuantity: 4,
        countedQuantity: 4,
        variance: 0,
        status: 'counted',
      },
      {
        sessionId: session.id,
        skuId: skuA.id,
        locationId: loc.id,
        expectedQuantity: 9,
        status: 'pending',
      },
    ]);
    return { warehouse, session, loc, skuA, skuB };
  }

  it('세션 메타 + 라인 전체 + 진행률을 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { warehouse, session, loc } = await seed(tx);

      const detail = await svc.getSession(session.id, tx);

      expect(detail.id).toBe(session.id);
      expect(detail.warehouseId).toBe(warehouse.id);
      expect(detail.sessionName).toBe('it-session');
      expect(detail.status).toBe('in_progress');
      expect(detail.lines).toHaveLength(2);
      expect(detail.lines[0].locationCode).toBe(loc.code);
      // progress.counted = countedQuantity IS NOT NULL 인 라인 수
      expect(detail.progress).toEqual({ total: 2, counted: 1 });
    });
  });

  it('라인을 locationCode → skuCode 순으로 정렬한다', async () => {
    await inRollbackTx(async (tx) => {
      const { session, skuA, skuB } = await seed(tx);

      const detail = await svc.getSession(session.id, tx);

      // 같은 로케이션이므로 skuCode(IT-A… < IT-B…) 순
      expect(detail.lines.map((l) => l.skuId)).toEqual([skuA.id, skuB.id]);
    });
  });

  it('미카운트 라인의 countedQuantity/variance 는 null 로 남는다', async () => {
    await inRollbackTx(async (tx) => {
      const { session, skuA } = await seed(tx);

      const detail = await svc.getSession(session.id, tx);
      const pending = detail.lines.find((l) => l.skuId === skuA.id);

      expect(pending?.countedQuantity).toBeNull();
      expect(pending?.variance).toBeNull();
      expect(pending?.status).toBe('pending');
    });
  });

  it('없는 세션은 NotFoundError 를 던진다', async () => {
    await inRollbackTx(async (tx) => {
      await expect(svc.getSession(randomUUID(), tx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run:
```bash
npm run test:core:integration:local -- stocktaking-session-detail
```
Expected: FAIL — `svc.getSession is not a function` (또는 타입 에러 `Property 'getSession' does not exist`).

- [ ] **Step 3: 응답 DTO를 정의한다**

Create `apps/core/src/modules/inventory/stocktaking/dto/session-detail.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import type { StocktakingStatus } from './list-sessions-query.dto';

export class StocktakingLineDto {
  @ApiProperty() lineId: string;
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty({ type: String, nullable: true }) locationId: string | null;
  @ApiProperty({ type: String, nullable: true }) locationCode: string | null;
  @ApiProperty() expectedQuantity: number;
  @ApiProperty({ type: Number, nullable: true, description: '미카운트면 null' })
  countedQuantity: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'counted − expected. 미카운트면 null' })
  variance: number | null;
  @ApiProperty({ type: String, nullable: true }) scannedBarcode: string | null;
  @ApiProperty({ description: 'pending | counted | verified' }) status: string;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
}

export class StocktakingProgressDto {
  @ApiProperty({ description: '세션의 전체 라인 수' }) total: number;
  @ApiProperty({ description: 'countedQuantity 가 채워진 라인 수' }) counted: number;
}

export class StocktakingSessionDetailDto {
  @ApiProperty() id: string;
  @ApiProperty() warehouseId: string;
  @ApiProperty() sessionName: string;
  @ApiProperty({ enum: ['draft', 'in_progress', 'completed', 'cancelled'] })
  status: StocktakingStatus;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) completedAt: Date | null;
  @ApiProperty({ type: StocktakingProgressDto }) progress: StocktakingProgressDto;
  @ApiProperty({ type: [StocktakingLineDto] }) lines: StocktakingLineDto[];
}
```

- [ ] **Step 4: 서비스에 `getSession`을 구현한다**

`apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts`에서, `getVariances` 메서드 **바로 앞**에 아래를 삽입한다:

```ts
  /**
   * 세션 상세 — 메타 + 전체 라인 + 진행률.
   * getVariances 는 variance != 0 만 주므로 "실사 이어하기"에는 쓸 수 없다.
   */
  async getSession(sessionId: string, tx?: DbTx): Promise<StocktakingSessionDetailDto> {
    return this.dbService.run(async (tx) => {
      const { stocktakingSessions, stocktakingLines, skus, locations } = wmsTables;

      const [session] = await tx
        .select()
        .from(stocktakingSessions)
        .where(eq(stocktakingSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`Stocktaking session not found: ${sessionId}`);

      const rows = await tx
        .select({
          lineId: stocktakingLines.id,
          skuId: stocktakingLines.skuId,
          skuCode: skus.code,
          skuName: skus.name,
          locationId: stocktakingLines.locationId,
          locationCode: locations.code,
          expectedQuantity: stocktakingLines.expectedQuantity,
          countedQuantity: stocktakingLines.countedQuantity,
          variance: stocktakingLines.variance,
          scannedBarcode: stocktakingLines.scannedBarcode,
          status: stocktakingLines.status,
          notes: stocktakingLines.notes,
        })
        .from(stocktakingLines)
        .innerJoin(skus, eq(stocktakingLines.skuId, skus.id))
        .leftJoin(locations, eq(stocktakingLines.locationId, locations.id))
        .where(eq(stocktakingLines.sessionId, sessionId))
        .orderBy(sql`${locations.code} ASC NULLS LAST`, skus.code);

      return {
        id: session.id,
        warehouseId: session.warehouseId,
        sessionName: session.sessionName,
        status: session.status,
        notes: session.notes,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        progress: {
          total: rows.length,
          counted: rows.filter((r) => r.countedQuantity !== null).length,
        },
        lines: rows,
      };
    }, tx);
  }
```

파일 상단 import를 확인/보강한다:
- `NotFoundError`가 `@app/shared`에서 import돼 있지 않으면 추가한다.
- `StocktakingSessionDetailDto`를 `../dto/session-detail.dto`에서 import한다.
- `eq`·`sql`·`wmsTables`·`DbTx`는 이미 import돼 있다.

> 파일이 `NotFoundException`(@nestjs/common)을 쓰고 있더라도 **신규 코드는 `NotFoundError`(@app/shared)** 를 쓴다 — CLAUDE.md 규칙. 기존 메서드는 건드리지 않는다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run:
```bash
npm run test:core:integration:local -- stocktaking-session-detail
```
Expected: PASS (4 tests)

- [ ] **Step 6: 컨트롤러에 라우트를 추가한다**

`apps/core/src/modules/inventory/stocktaking/controllers/stocktaking.controller.ts`에서 `@Get('sessions')` 메서드 **뒤**, `@Post('sessions')` **앞**에 삽입한다:

```ts
  @Get('sessions/:id')
  @ApiOperation({ summary: '재고 실사 세션 상세 조회 (세션 + 전체 라인 + 진행률)' })
  @ApiParam({ name: 'id', description: '세션 ID' })
  @ApiResponse({ status: 200, type: StocktakingSessionDetailDto })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async getSession(@Param('id') id: string): Promise<StocktakingSessionDetailDto> {
    return this.stocktakingService.getSession(id);
  }
```

상단에 `import { StocktakingSessionDetailDto } from '../dto/session-detail.dto';`를 추가한다. `Get`·`Param`·`ApiParam`·`ApiResponse`는 이미 import돼 있다.

> **라우트 순서 주의**: `sessions/:id`는 리터럴 경로 `sessions`와 충돌하지 않지만, 이후 누군가 `sessions/active` 같은 리터럴을 추가하면 `:id`보다 앞에 두어야 한다.

- [ ] **Step 7: 빌드로 타입을 검증한다**

Run (레포 루트):
```bash
npx nest build core
```
Expected: exit 0

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/stocktaking/
git commit -m "feat(core): GET /stocktaking/sessions/:id 세션 상세 신규

세션 메타 + 전체 라인 + 진행률(total/counted)을 반환한다. 기존
getVariances 는 variance != 0 만 주므로 앱 재시작 후 '실사 이어하기'를
지탱할 수 없었다. 라인은 locationCode → skuCode 순(현장 동선)."
```

---

### Task 3: `POST /stocktaking/scan-location` 응답에 lineId·countedQuantity·status 추가

**Files:**
- Modify: `apps/core/src/modules/inventory/stocktaking/services/stocktaking.service.ts:111-172` (`scanLocation`)
- Test: `apps/core/src/modules/inventory/stocktaking/services/stocktaking-scan-location.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음
- Produces: `scanLocation`의 `expectedItems[]` 항목이 `{ lineId, skuId, skuName, skuCode, barcode, expectedQuantity, countedQuantity, status }`가 된다. Task 15·17(프론트 실사 카운트 화면)이 이 모양에 의존한다.

- [ ] **Step 1: 실패하는 통합 테스트를 작성한다**

Create `apps/core/src/modules/inventory/stocktaking/services/stocktaking-scan-location.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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

describeIfDb('stocktaking scan-location response (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    const command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
  });
  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seed(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const barcode = `BC-${randomUUID().slice(0, 12)}`;
    await tx
      .insert(wmsTables.skuBarcodes)
      .values({ skuId: sku.id, barcode, isPrimary: true });
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}` })
      .returning();
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      stockState: 'ON_HAND',
      qty: 6,
    });
    const [session] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'it', status: 'in_progress' })
      .returning();
    return { warehouse, sku, barcode, loc, session };
  }

  it('첫 스캔에서 lineId 와 미카운트 상태를 함께 반환한다', async () => {
    await inRollbackTx(async (tx) => {
      const { loc, session } = await seed(tx);

      const res = await svc.scanLocation(
        { sessionId: session.id, locationBarcode: loc.code },
        tx,
      );

      expect(res.expectedItems).toHaveLength(1);
      const item = res.expectedItems[0];
      expect(item.lineId).toEqual(expect.any(String));
      expect(item.expectedQuantity).toBe(6);
      expect(item.countedQuantity).toBeNull();
      expect(item.status).toBe('pending');
    });
  });

  it('재스캔 시 이미 센 수량을 그대로 돌려준다 (이어하기)', async () => {
    await inRollbackTx(async (tx) => {
      const { loc, session, barcode } = await seed(tx);

      await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);
      const first = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);
      await svc.scanProduct(
        {
          sessionId: session.id,
          locationId: first.locationId,
          productBarcode: barcode,
          quantity: 4,
        },
        tx,
      );

      const again = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);

      expect(again.expectedItems).toHaveLength(1);
      expect(again.expectedItems[0].countedQuantity).toBe(4);
      expect(again.expectedItems[0].status).toBe('counted');
    });
  });

  it('그 위치에서 만들어진 미기대 항목도 함께 반환한다 (상위집합)', async () => {
    await inRollbackTx(async (tx) => {
      const { loc, session } = await seed(tx);

      // 원장에 없는 별도 SKU + 바코드 → scanProduct 가 expectedQuantity 0 라인을 만든다
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `it-h2-${randomUUID().slice(0, 8)}` })
        .returning();
      const [extra] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'extra', code: `IT-X-${randomUUID()}`, holderId: holder.id })
        .returning();
      const extraBarcode = `BC-X-${randomUUID().slice(0, 10)}`;
      await tx.insert(wmsTables.skuBarcodes).values({ skuId: extra.id, barcode: extraBarcode });

      const first = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);
      await svc.scanProduct(
        {
          sessionId: session.id,
          locationId: first.locationId,
          productBarcode: extraBarcode,
          quantity: 2,
        },
        tx,
      );

      const again = await svc.scanLocation({ sessionId: session.id, locationBarcode: loc.code }, tx);

      expect(again.expectedItems).toHaveLength(2);
      const unexpected = again.expectedItems.find((i) => i.skuId === extra.id);
      expect(unexpected?.expectedQuantity).toBe(0);
      expect(unexpected?.countedQuantity).toBe(2);
    });
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run:
```bash
npm run test:core:integration:local -- stocktaking-scan-location
```
Expected: FAIL — `item.lineId`가 `undefined`.

- [ ] **Step 3: `scanLocation`의 반환부를 재조회로 바꾼다**

`stocktaking.service.ts`의 `scanLocation`에서, 라인 insert 이후의 `return { … }` 블록(현재 160-170행)을 아래로 교체한다. **insert 로직 자체는 그대로 둔다.**

```ts
      // insert 결과가 아니라 재조회로 응답을 만든다 — onConflictDoNothing 은 기존 라인을
      // 돌려주지 않고, scanProduct 로 만들어진 미기대 라인도 화면에 보여야 하기 때문이다.
      const lines = await tx
        .select({
          lineId: stocktakingLines.id,
          skuId: stocktakingLines.skuId,
          skuName: skus.name,
          skuCode: skus.code,
          barcode: sql<string | null>`(
            SELECT barcode FROM sku_barcodes
            WHERE sku_id = ${skus.id} AND is_primary = true
            LIMIT 1
          )`,
          expectedQuantity: stocktakingLines.expectedQuantity,
          countedQuantity: stocktakingLines.countedQuantity,
          status: stocktakingLines.status,
        })
        .from(stocktakingLines)
        .innerJoin(skus, eq(stocktakingLines.skuId, skus.id))
        .where(
          and(
            eq(stocktakingLines.sessionId, dto.sessionId),
            eq(stocktakingLines.locationId, location[0].id),
          ),
        )
        .orderBy(skus.code);

      return {
        locationId: location[0].id,
        locationCode: location[0].code,
        expectedItems: lines,
      };
```

메서드 상단의 구조분해에 `skus`가 이미 포함돼 있다(`const { locations, stockLedgers, skus, stocktakingLines } = wmsTables;`). 추가 import는 필요 없다.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run:
```bash
npm run test:core:integration:local -- stocktaking-scan-location
```
Expected: PASS (3 tests)

- [ ] **Step 5: 기존 실사 스펙이 깨지지 않았는지 확인한다**

Run:
```bash
npm run test:core:integration:local -- stocktaking
```
Expected: PASS — `stocktaking-complete`·`stocktaking-state-machine`·`stocktaking-uniques`·신규 2개 전부 통과

- [ ] **Step 6: admin-web 소비자를 확인한다 (읽기만)**

Run (레포 루트):
```bash
grep -n "expectedItems" -r apps/admin-web/src --include=*.ts --include=*.tsx
```
Expected: 히트가 없거나, 있다면 필드를 **추가로 읽지 않는** 코드여야 한다. 히트가 있으면 그 코드가 `expectedItems`의 길이/내용을 가정하는지 육안 확인하고, 깨질 여지가 있으면 커밋 메시지에 남긴다. (설계 §4.3이 예고한 확인 항목)

- [ ] **Step 7: 빌드**

Run:
```bash
npx nest build core
```
Expected: exit 0

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/stocktaking/services/
git commit -m "feat(core): scan-location 응답에 lineId·countedQuantity·status 동반

insert 결과 대신 (sessionId, locationId) 재조회로 응답을 만든다. 이로써
(1) 수동 수량 입력(PUT lines/:id/count)이 선행 스캔 없이 가능해지고
(2) 재스캔 시 이미 센 수량이 보여 이중 카운트를 막는다.
응답은 기존의 상위집합 — 그 위치의 미기대 라인도 포함된다."
```

---

### Task 4: `AdjustStockDto.idempotencyKey` optional 추가

**Files:**
- Modify: `apps/core/src/modules/inventory/core/dto/inventory/adjust-stock.dto.ts`
- Modify: `apps/core/src/modules/inventory/core/controllers/inventory.controller.ts:22-48`
- Test: `apps/core/src/modules/inventory/core/services/adjust-idempotency.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: 없음
- Produces: `POST /inventory/stocks/adjust`가 body의 `idempotencyKey`를 받아 dedupe한다. Task 12(프론트 `useAdjustStock`)가 이 필드를 보낸다.

- [ ] **Step 1: 실패하는 통합 테스트를 작성한다**

Create `apps/core/src/modules/inventory/core/services/adjust-idempotency.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { InventoryController } from '../controllers/inventory.controller';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventService } from './stock-event.service';
import { SafetyStockService } from './safety-stock.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('adjust idempotency (DB integration, committed rows with unique suffix)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let controller: InventoryController;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    const command = new InventoryCommandService(dbService, eventStore, outbox, location);
    const stockEvent = new StockEventService(dbService, eventStore, outbox);
    const safety = new SafetyStockService(dbService);
    controller = new InventoryController(stockEvent, safety, command);
  });
  afterAll(async () => {
    await sql.end();
  });

  // 멱등성은 커밋된 unique 제약을 통해서만 관측되므로 rollback-only 로는 검증할 수 없다.
  // 고유 접미사 행만 남긴다 (docs/local-dev.md 의 커밋형 스펙과 같은 취급).
  async function seed() {
    const [warehouse] = await db
      .insert(wmsTables.warehouses)
      .values({ name: `it-idem-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await db
      .insert(wmsTables.holders)
      .values({ name: `it-idem-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await db
      .insert(wmsTables.skus)
      .values({ name: 'it-idem-sku', code: `IT-IDEM-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [loc] = await db
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-IDEM-LOC-${randomUUID().slice(0, 8)}` })
      .returning();
    return { warehouse, sku, loc };
  }

  async function onHand(skuId: string, warehouseId: string, locationId: string) {
    const [row] = await db
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

  it('같은 idempotencyKey 로 두 번 조정해도 원장은 한 번만 움직인다', async () => {
    const { warehouse, sku, loc } = await seed();
    const key = `it-adjust-${randomUUID()}`;
    const body = {
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: loc.id,
      delta: 5,
      reason: '발견',
      idempotencyKey: key,
    };

    await controller.adjustStockQuantity(body);
    await controller.adjustStockQuantity(body);

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(5);
  });

  it('키가 다르면 각각 적용된다', async () => {
    const { warehouse, sku, loc } = await seed();
    const base = { skuId: sku.id, warehouseId: warehouse.id, locationId: loc.id, delta: 3, reason: '발견' };

    await controller.adjustStockQuantity({ ...base, idempotencyKey: `it-adjust-${randomUUID()}` });
    await controller.adjustStockQuantity({ ...base, idempotencyKey: `it-adjust-${randomUUID()}` });

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(6);
  });

  it('키가 없으면 매번 적용된다 (기존 호출자 동작 불변)', async () => {
    const { warehouse, sku, loc } = await seed();
    const body = { skuId: sku.id, warehouseId: warehouse.id, locationId: loc.id, delta: 2, reason: '발견' };

    await controller.adjustStockQuantity(body);
    await controller.adjustStockQuantity(body);

    expect(await onHand(sku.id, warehouse.id, loc.id)).toBe(4);
  });
});
```

> `InventoryController`·`StockEventService`·`SafetyStockService` 생성자 시그니처가 위와 다르면, 해당 파일을 읽어 **실제 생성자 순서에 맞춰** 인스턴스화하도록 이 블록만 고친다. 테스트의 의도(2회 호출 → 원장 1회 변화)는 그대로 유지한다.

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run:
```bash
npm run test:core:integration:local -- adjust-idempotency
```
Expected: FAIL — 첫 테스트가 `Expected: 5, Received: 10` (멱등키가 무시돼 두 번 적용됨). 또는 `idempotencyKey` 타입 에러.

- [ ] **Step 3: DTO에 필드를 추가한다**

`apps/core/src/modules/inventory/core/dto/inventory/adjust-stock.dto.ts`를 아래로 교체한다:

```ts
import { IsUUID, IsNotEmpty, IsNumber, IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdjustStockDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: '위치 ID', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '변경할 수량(양수=가산, 음수=감산)' })
  @IsNumber()
  @IsNotEmpty()
  delta: number;

  @ApiProperty({ description: '조정 사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    description: '요청 멱등 키 — 클라이언트 생성 UUID. 같은 조정의 재시도는 같은 값을 재사용한다.',
    required: false,
  })
  @IsString()
  @IsOptional()
  @MaxLength(90)
  idempotencyKey?: string;
}
```

- [ ] **Step 4: 컨트롤러가 키를 전달하게 한다**

`apps/core/src/modules/inventory/core/controllers/inventory.controller.ts`의 `adjustStockQuantity` 본문에서 두 호출에 `idempotencyKey`를 넘긴다:

```ts
  async adjustStockQuantity(@Body() adjustDto: AdjustStockDto) {
    if (adjustDto.delta > 0) {
      return this.commandService.adjustUp({
        skuId: adjustDto.skuId,
        warehouseId: adjustDto.warehouseId,
        locationId: adjustDto.locationId,
        quantity: Math.abs(adjustDto.delta),
        reason: adjustDto.reason,
        idempotencyKey: adjustDto.idempotencyKey,
      });
    } else if (adjustDto.delta < 0) {
      return this.commandService.adjustDown({
        skuId: adjustDto.skuId,
        warehouseId: adjustDto.warehouseId,
        locationId: adjustDto.locationId,
        quantity: Math.abs(adjustDto.delta),
        reason: adjustDto.reason,
        idempotencyKey: adjustDto.idempotencyKey,
      });
    } else {
      throw new BadRequestException('delta cannot be zero');
    }
  }
```

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

Run:
```bash
npm run test:core:integration:local -- adjust-idempotency
```
Expected: PASS (3 tests)

- [ ] **Step 6: 빌드 + 백엔드 전체 회귀**

Run:
```bash
npx nest build core
npm run test:core:integration:local -- inventory
```
Expected: 빌드 exit 0. 통합 스펙 전부 통과(기존 실패가 있었다면 그 목록이 변하지 않았음을 확인).

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/inventory/core/
git commit -m "feat(core): 재고 조정에 optional idempotencyKey 배선

createEvent 는 idempotencyKey unique 로 이미 dedupe 하는데 컨트롤러가
그것을 전달하지 않아 조정 경로만 멱등성이 없었다. 현장 더블탭/재시도
이중 적용을 막는다. optional 이라 기존 호출자 동작은 불변."
```

---

# Part B — 프론트 토대 (native/warehouse-app)

> 이하 모든 명령은 `native/warehouse-app`에서 실행한다.

### Task 5: `errorMessage` 확장

**Files:**
- Modify: `src/core/data/errorMessage.ts`
- Test: `src/core/data/errorMessage.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: 기존 `ConflictError`(`src/core/data/httpClient.ts`)
- Produces: `errorMessage(error: unknown, context?: ErrorContext): string`. `ErrorContext = 'barcode' | 'location' | 'stocktaking'`. 두 번째 인자는 optional이라 기존 호출부(`InventoryLookupScreen`)는 그대로 동작한다. Task 11·12·13·16·17·18이 이 함수를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/core/data/errorMessage.test.ts` 끝에 추가한다:

```ts
describe('errorMessage with context', () => {
  it('바코드 문맥의 404 는 미등록 바코드로 안내한다', () => {
    expect(errorMessage(new Error('GET /inventory/skus → 404'), 'barcode')).toBe(
      '등록되지 않은 바코드예요.'
    );
  });

  it('로케이션 문맥의 404 는 로케이션으로 안내한다', () => {
    expect(errorMessage(new Error('POST /stocktaking/scan-location → 404'), 'location')).toBe(
      '로케이션을 찾을 수 없어요.'
    );
  });

  it('실사 문맥의 400 은 세션 상태를 짚어준다', () => {
    expect(errorMessage(new Error('POST /stocktaking/scan-product → 400'), 'stocktaking')).toBe(
      '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.'
    );
  });

  it('문맥이 없으면 기존 문구를 유지한다', () => {
    expect(errorMessage(new Error('GET /x → 404'))).toBe('찾을 수 없어요.');
    expect(errorMessage(new Error('GET /x → 400'))).toBe('요청이 올바르지 않아요.');
  });

  it('문맥이 있어도 401/403/5xx 는 공통 문구를 쓴다', () => {
    expect(errorMessage(new Error('GET /x → 403'), 'barcode')).toBe(
      '권한이 없어요. 다시 로그인해 주세요.'
    );
    expect(errorMessage(new Error('GET /x → 500'), 'stocktaking')).toBe(
      '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.'
    );
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run src/core/data/errorMessage.test.ts`
Expected: FAIL — `Expected: '등록되지 않은 바코드예요.'  Received: '찾을 수 없어요.'`

- [ ] **Step 3: 구현**

`src/core/data/errorMessage.ts`를 아래로 교체한다:

```ts
import { ConflictError } from './httpClient';

/** 같은 상태 코드라도 화면 문맥에 따라 현장에 필요한 문구가 다르다. */
export type ErrorContext = 'barcode' | 'location' | 'stocktaking';

const CONTEXTUAL: Record<ErrorContext, Partial<Record<number, string>>> = {
  barcode: { 404: '등록되지 않은 바코드예요.' },
  location: { 404: '로케이션을 찾을 수 없어요.' },
  stocktaking: { 400: '실사가 진행 중이 아니에요. 세션 상태를 확인해 주세요.' },
};

export function errorMessage(error: unknown, context?: ErrorContext): string {
  if (error instanceof ConflictError) {
    return '다른 작업자가 먼저 변경했어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error instanceof Error) {
    const match = /→\s*(\d{3})/.exec(error.message);
    const status = match ? Number(match[1]) : undefined;
    if (status === 401 || status === 403) return '권한이 없어요. 다시 로그인해 주세요.';
    if (status !== undefined && status >= 500) {
      return '서버에 문제가 있어요. 잠시 후 다시 시도해 주세요.';
    }
    if (status !== undefined && context) {
      const specific = CONTEXTUAL[context][status];
      if (specific) return specific;
    }
    if (status === 404) return '찾을 수 없어요.';
    if (status === 400) return '요청이 올바르지 않아요.';
  }
  return '알 수 없는 오류가 발생했어요.';
}
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

Run: `npx vitest run src/core/data/errorMessage.test.ts`
Expected: PASS (기존 케이스 + 신규 5개)

- [ ] **Step 5: 커밋**

```bash
git add src/core/data/errorMessage.ts src/core/data/errorMessage.test.ts
git commit -m "feat(warehouse-app): errorMessage 에 화면 문맥 인자 추가

같은 404 라도 '등록되지 않은 바코드'와 '로케이션을 찾을 수 없음'은
현장에서 전혀 다른 행동을 부른다. context 는 optional 이라 기존 호출부
불변."
```

---

### Task 6: 디자인 프리미티브 — `ScreenHeader` · `NumberPad` · `ConfirmDialog`

**Files:**
- Create: `src/core/design/ScreenHeader.tsx`
- Create: `src/core/design/ScreenHeader.test.tsx`
- Create: `src/core/design/NumberPad.tsx`
- Create: `src/core/design/NumberPad.test.tsx`
- Create: `src/core/design/ConfirmDialog.tsx`
- Create: `src/core/design/ConfirmDialog.test.tsx`

**Interfaces:**
- Consumes: `Button`(`src/core/design/Button.tsx`), `cn`(`src/core/design/cn.ts`)
- Produces:
  - `ScreenHeader({ title, backTo, right }: { title: string; backTo: string; right?: ReactNode })`
  - `NumberPad({ value, onChange, allowNegative }: { value: number; onChange: (n: number) => void; allowNegative?: boolean })`
  - `ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel, danger }: { open: boolean; title: string; message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean })`
  - Task 11·12·13·16·17·18이 셋 다 쓴다.

- [ ] **Step 1: `ScreenHeader` 실패 테스트**

Create `src/core/design/ScreenHeader.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { ScreenHeader } from './ScreenHeader';

function renderAt(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  // 테스트 전용 라우터라 앱의 Register 타입과 다르다.
  return render(<RouterProvider router={router as never} />);
}

describe('ScreenHeader', () => {
  it('제목과 뒤로 링크를 렌더한다', async () => {
    renderAt(<ScreenHeader title="재고 조정" backTo="/inventory" />);
    expect(await screen.findByRole('heading', { name: '재고 조정' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute('href', '/inventory');
  });

  it('right 슬롯을 렌더한다', async () => {
    renderAt(<ScreenHeader title="실사" backTo="/" right={<span>17 / 42</span>} />);
    expect(await screen.findByText('17 / 42')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/design/ScreenHeader.test.tsx`
Expected: FAIL — `Failed to resolve import "./ScreenHeader"`

- [ ] **Step 3: `ScreenHeader` 구현**

Create `src/core/design/ScreenHeader.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

/** 워크플로우 화면 공통 헤더 — 뒤로 + 제목 + 우측 슬롯(진행률·창고 등). */
export function ScreenHeader({
  title,
  backTo,
  right,
}: {
  title: string;
  backTo: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Link
        to={backTo}
        aria-label="뒤로"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white active:bg-gray-100"
      >
        <ChevronLeft className="h-5 w-5 text-gray-700" aria-hidden />
      </Link>
      <h1 className="flex-1 truncate text-lg font-semibold text-gray-800">{title}</h1>
      {right ? <div className="shrink-0 text-sm text-gray-600">{right}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/design/ScreenHeader.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: `NumberPad` 실패 테스트**

Create `src/core/design/NumberPad.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberPad } from './NumberPad';

describe('NumberPad', () => {
  it('숫자 키를 누르면 자릿수가 누적된다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={1} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '2' }));

    expect(onChange).toHaveBeenCalledWith(12);
  });

  it('지우기는 마지막 자리를 없앤다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={12} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '지우기' }));

    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('한 자리에서 지우면 0 이 된다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={7} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '지우기' }));

    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('allowNegative 가 아니면 부호 키가 없다', () => {
    render(<NumberPad value={0} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '부호' })).not.toBeInTheDocument();
  });

  it('allowNegative 면 부호 키가 값을 뒤집는다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={3} onChange={onChange} allowNegative />);

    await userEvent.click(screen.getByRole('button', { name: '부호' }));

    expect(onChange).toHaveBeenCalledWith(-3);
  });

  it('음수에서 자릿수를 누르면 부호를 유지한다', async () => {
    const onChange = vi.fn();
    render(<NumberPad value={-1} onChange={onChange} allowNegative />);

    await userEvent.click(screen.getByRole('button', { name: '2' }));

    expect(onChange).toHaveBeenCalledWith(-12);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/core/design/NumberPad.test.tsx`
Expected: FAIL — `Failed to resolve import "./NumberPad"`

- [ ] **Step 7: `NumberPad` 구현**

Create `src/core/design/NumberPad.tsx`:

```tsx
import { cn } from './cn';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * 장갑 낀 손으로 누르는 큰 숫자패드. 자릿수 누적 방식이라 스캔 흐름을
 * 끊지 않는다. 값은 항상 정수이고, 부호는 allowNegative 일 때만 뒤집힌다.
 */
export function NumberPad({
  value,
  onChange,
  allowNegative = false,
}: {
  value: number;
  onChange: (next: number) => void;
  allowNegative?: boolean;
}) {
  const negative = value < 0;
  const magnitude = Math.abs(value);

  function signed(n: number): number {
    return negative ? -n : n;
  }

  function pressDigit(d: string) {
    const next = Number(`${magnitude}${d}`);
    onChange(signed(Number.isFinite(next) ? next : magnitude));
  }

  function pressBackspace() {
    const text = String(magnitude);
    const next = text.length <= 1 ? 0 : Number(text.slice(0, -1));
    onChange(signed(next));
  }

  const keyClass = cn(
    'h-14 rounded-lg border border-gray-300 bg-white text-xl font-semibold',
    'text-gray-800 active:bg-gray-100'
  );

  return (
    <div className="grid grid-cols-3 gap-2">
      {DIGITS.map((d) => (
        <button key={d} type="button" className={keyClass} onClick={() => pressDigit(d)}>
          {d}
        </button>
      ))}
      {allowNegative ? (
        <button type="button" className={keyClass} aria-label="부호" onClick={() => onChange(-value)}>
          ±
        </button>
      ) : (
        <span />
      )}
      <button type="button" className={keyClass} onClick={() => pressDigit('0')}>
        0
      </button>
      <button type="button" className={keyClass} aria-label="지우기" onClick={pressBackspace}>
        ←
      </button>
    </div>
  );
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/core/design/NumberPad.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 9: `ConfirmDialog` 실패 테스트**

Create `src/core/design/ConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

const base = {
  title: '재고 조정',
  message: 'A-01-02 의 코튼셔츠를 −2 조정합니다.',
  confirmLabel: '조정',
  onConfirm: () => {},
  onCancel: () => {},
};

describe('ConfirmDialog', () => {
  it('open 이 false 면 아무것도 렌더하지 않는다', () => {
    render(<ConfirmDialog {...base} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('제목과 메시지를 렌더한다', () => {
    render(<ConfirmDialog {...base} open />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('A-01-02 의 코튼셔츠를 −2 조정합니다.')).toBeInTheDocument();
  });

  it('확인/취소를 각각 호출한다', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: '조정' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 10: 실패 확인**

Run: `npx vitest run src/core/design/ConfirmDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./ConfirmDialog"`

- [ ] **Step 11: `ConfirmDialog` 구현**

Create `src/core/design/ConfirmDialog.tsx`:

```tsx
import { Button } from './Button';
import { cn } from './cn';

/** 되돌릴 수 없는 액션(조정 적용·실사 완료·세션 취소) 앞의 마지막 관문. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg"
      >
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-5 flex gap-2">
          <Button
            type="button"
            className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
            onClick={onCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            className={cn('flex-1', danger && 'bg-red-600 hover:bg-red-700')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: 통과 확인 + 커밋**

Run: `npx vitest run src/core/design/`
Expected: PASS (기존 DataTable/HubTile/PlaceholderScreen 테스트 + 신규 11개)

```bash
git add src/core/design/ScreenHeader.tsx src/core/design/ScreenHeader.test.tsx \
        src/core/design/NumberPad.tsx src/core/design/NumberPad.test.tsx \
        src/core/design/ConfirmDialog.tsx src/core/design/ConfirmDialog.test.tsx
git commit -m "feat(warehouse-app): ScreenHeader·NumberPad·ConfirmDialog 프리미티브

Phase 1 화면 6개가 공유한다. NumberPad 는 장갑 낀 손 기준 큰 키 +
자릿수 누적, ConfirmDialog 는 되돌릴 수 없는 액션의 마지막 관문."
```

---

### Task 7: `devicePrefs` + 창고 컨텍스트

**Files:**
- Create: `src/core/data/devicePrefs.ts`
- Create: `src/core/data/devicePrefs.test.ts`
- Create: `src/app/warehouse-context.tsx`
- Create: `src/app/warehouse-context.test.tsx`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface DevicePrefs { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }`
  - `createMemoryPrefs(): DevicePrefs` (테스트용), `localStoragePrefs: DevicePrefs`
  - `WarehouseProvider({ prefs?, children }: { prefs?: DevicePrefs; children: ReactNode })`
  - `useWarehouse(): { warehouseId: string | null; warehouseName: string | null; isSet: boolean; setWarehouse(w: { id: string; name: string }): void; clearWarehouse(): void }`
  - 저장 키는 `almondwms.warehouse`, 값은 `JSON.stringify({ id, name })`
  - Task 8·11·12·16·17이 `useWarehouse`를 쓴다.

- [ ] **Step 1: `devicePrefs` 실패 테스트**

Create `src/core/data/devicePrefs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryPrefs } from './devicePrefs';

describe('createMemoryPrefs', () => {
  it('저장한 값을 돌려준다', () => {
    const prefs = createMemoryPrefs();
    prefs.set('k', 'v');
    expect(prefs.get('k')).toBe('v');
  });

  it('없는 키는 null 이다', () => {
    expect(createMemoryPrefs().get('nope')).toBeNull();
  });

  it('remove 후에는 null 이다', () => {
    const prefs = createMemoryPrefs();
    prefs.set('k', 'v');
    prefs.remove('k');
    expect(prefs.get('k')).toBeNull();
  });

  it('초기값을 주입할 수 있다', () => {
    expect(createMemoryPrefs({ k: 'seed' }).get('k')).toBe('seed');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/data/devicePrefs.test.ts`
Expected: FAIL — `Failed to resolve import "./devicePrefs"`

- [ ] **Step 3: 구현**

Create `src/core/data/devicePrefs.ts`:

```ts
/**
 * 기기 로컬 설정(창고 선택 등) 저장소. 토큰과 달리 민감정보가 아니라
 * stronghold 를 쓰지 않는다 — Windows·Android 웹뷰 공통으로 localStorage 면 충분하다.
 * 인터페이스로 감싸는 이유는 테스트 주입 하나뿐이다.
 */
export interface DevicePrefs {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const localStoragePrefs: DevicePrefs = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 저장 실패는 치명적이지 않다 — 세션 동안 메모리 상태로 계속 동작한다.
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 위와 같음.
    }
  },
};

export function createMemoryPrefs(seed: Record<string, string> = {}): DevicePrefs {
  const map = new Map(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/data/devicePrefs.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 창고 컨텍스트 실패 테스트**

Create `src/app/warehouse-context.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryPrefs } from '../core/data/devicePrefs';
import { WarehouseProvider, useWarehouse } from './warehouse-context';

function Probe() {
  const { warehouseId, warehouseName, isSet, setWarehouse, clearWarehouse } = useWarehouse();
  return (
    <div>
      <span data-testid="id">{warehouseId ?? '없음'}</span>
      <span data-testid="name">{warehouseName ?? '없음'}</span>
      <span data-testid="isSet">{String(isSet)}</span>
      <button onClick={() => setWarehouse({ id: 'w-1', name: '본창고' })}>선택</button>
      <button onClick={clearWarehouse}>해제</button>
    </div>
  );
}

describe('warehouse-context', () => {
  it('저장된 창고가 없으면 미설정이다', () => {
    render(
      <WarehouseProvider prefs={createMemoryPrefs()}>
        <Probe />
      </WarehouseProvider>
    );
    expect(screen.getByTestId('isSet')).toHaveTextContent('false');
    expect(screen.getByTestId('id')).toHaveTextContent('없음');
  });

  it('저장된 창고를 복원한다', () => {
    const prefs = createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({ id: 'w-9', name: '제2창고' }),
    });
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );
    expect(screen.getByTestId('id')).toHaveTextContent('w-9');
    expect(screen.getByTestId('name')).toHaveTextContent('제2창고');
    expect(screen.getByTestId('isSet')).toHaveTextContent('true');
  });

  it('선택하면 상태와 저장소가 함께 바뀐다', async () => {
    const prefs = createMemoryPrefs();
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: '선택' }));

    expect(screen.getByTestId('id')).toHaveTextContent('w-1');
    expect(prefs.get('almondwms.warehouse')).toBe(JSON.stringify({ id: 'w-1', name: '본창고' }));
  });

  it('해제하면 저장소에서도 지운다', async () => {
    const prefs = createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({ id: 'w-9', name: '제2창고' }),
    });
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );

    await userEvent.click(screen.getByRole('button', { name: '해제' }));

    expect(screen.getByTestId('isSet')).toHaveTextContent('false');
    expect(prefs.get('almondwms.warehouse')).toBeNull();
  });

  it('저장값이 깨져 있으면 미설정으로 떨어진다', () => {
    const prefs = createMemoryPrefs({ 'almondwms.warehouse': '{not json' });
    render(
      <WarehouseProvider prefs={prefs}>
        <Probe />
      </WarehouseProvider>
    );
    expect(screen.getByTestId('isSet')).toHaveTextContent('false');
  });

  it('Provider 밖에서 쓰면 명시적으로 실패한다', () => {
    expect(() => render(<Probe />)).toThrow(/WarehouseProvider/);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/app/warehouse-context.test.tsx`
Expected: FAIL — `Failed to resolve import "./warehouse-context"`

- [ ] **Step 7: 구현**

Create `src/app/warehouse-context.tsx`:

```tsx
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { localStoragePrefs, type DevicePrefs } from '../core/data/devicePrefs';

const STORAGE_KEY = 'almondwms.warehouse';

export interface SelectedWarehouse {
  id: string;
  name: string;
}

interface WarehouseContextValue {
  warehouseId: string | null;
  warehouseName: string | null;
  isSet: boolean;
  setWarehouse(w: SelectedWarehouse): void;
  clearWarehouse(): void;
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

function readStored(prefs: DevicePrefs): SelectedWarehouse | null {
  const raw = prefs.get(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SelectedWarehouse).id === 'string' &&
      typeof (parsed as SelectedWarehouse).name === 'string'
    ) {
      return { id: (parsed as SelectedWarehouse).id, name: (parsed as SelectedWarehouse).name };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 현장 PDA 는 한 창고에 고정된다. 백엔드에 사용자↔창고 바인딩이 없으므로
 * 기기 로컬에 저장하고 조정·실사·위치조회가 이 값을 warehouseId 로 쓴다.
 */
export function WarehouseProvider({
  prefs = localStoragePrefs,
  children,
}: {
  prefs?: DevicePrefs;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<SelectedWarehouse | null>(() => readStored(prefs));

  const value = useMemo<WarehouseContextValue>(
    () => ({
      warehouseId: selected?.id ?? null,
      warehouseName: selected?.name ?? null,
      isSet: selected !== null,
      setWarehouse(w) {
        prefs.set(STORAGE_KEY, JSON.stringify({ id: w.id, name: w.name }));
        setSelected({ id: w.id, name: w.name });
      },
      clearWarehouse() {
        prefs.remove(STORAGE_KEY);
        setSelected(null);
      },
    }),
    [selected, prefs]
  );

  return <WarehouseContext.Provider value={value}>{children}</WarehouseContext.Provider>;
}

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) throw new Error('useWarehouse must be used within a WarehouseProvider');
  return ctx;
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/app/warehouse-context.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 9: `main.tsx` 프로바이더 스택에 배선한다**

`src/main.tsx`에서 `ScanProvider` 바로 안쪽에 `WarehouseProvider`를 넣는다:

```tsx
        <ApiClientProvider>
          <ScanProvider>
            <WarehouseProvider>
              <Bootstrap session={session}>
                <RouterProvider router={router} />
              </Bootstrap>
            </WarehouseProvider>
          </ScanProvider>
        </ApiClientProvider>
```

상단에 `import { WarehouseProvider } from './app/warehouse-context';`를 추가한다.

- [ ] **Step 10: 빌드 + 커밋**

Run: `npm run build`
Expected: exit 0

```bash
git add src/core/data/devicePrefs.ts src/core/data/devicePrefs.test.ts \
        src/app/warehouse-context.tsx src/app/warehouse-context.test.tsx src/main.tsx
git commit -m "feat(warehouse-app): 기기 고정 창고 컨텍스트

조정·실사·위치조회가 모두 warehouseId 를 요구하는데 백엔드에 사용자↔창고
바인딩 개념이 없다. 현장 PDA 는 한 창고 고정이므로 기기 로컬(localStorage)에
저장한다. devicePrefs 인터페이스는 테스트 주입 목적."
```

---

### Task 8: `useWarehouses` + `/settings` 창고 선택 + 상단 창고 칩

**Files:**
- Create: `src/domains/warehouse/types.ts`
- Create: `src/domains/warehouse/useWarehouses.ts`
- Create: `src/domains/warehouse/useWarehouses.test.tsx`
- Create: `src/domains/warehouse/WarehousePicker.tsx`
- Create: `src/domains/warehouse/WarehousePicker.test.tsx`
- Create: `src/app/routes/SettingsRoute.tsx`
- Modify: `src/app/routes/AuthedLayout.tsx`
- Modify: `src/app/routeTree.tsx` (`/settings` 스텁 교체)

**Interfaces:**
- Consumes: `useWarehouse`(Task 7), `useApiClient`, `ScreenHeader`(Task 6), `errorMessage`(Task 5)
- Produces:
  - `interface Warehouse { id: string; name: string; location: string | null }`
  - `useWarehouses(): UseQueryResult<Warehouse[]>` — key `['warehouses']`, path `/inventory/warehouses`
  - `WarehousePicker({ onPicked }: { onPicked?: () => void })` — 목록을 렌더하고 선택 시 `setWarehouse` 호출. Task 11·12·16이 "창고 미설정" 인라인 카드에서 재사용한다.

- [ ] **Step 1: `useWarehouses` 실패 테스트**

Create `src/domains/warehouse/useWarehouses.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useWarehouses } from './useWarehouses';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useWarehouses', () => {
  it('창고 목록을 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => [
      { id: 'w-1', name: '본창고', location: '김포' },
    ]);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useWarehouses(), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/warehouses');
    expect(result.current.data).toEqual([{ id: 'w-1', name: '본창고', location: '김포' }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/warehouse/useWarehouses.test.tsx`
Expected: FAIL — `Failed to resolve import "./useWarehouses"`

- [ ] **Step 3: 타입 + 훅 구현**

Create `src/domains/warehouse/types.ts`:

```ts
/** WarehouseDto 중 현장에서 쓰는 필드만. */
export interface Warehouse {
  id: string;
  name: string;
  location: string | null;
}

/** BaseLocationResponseDto 중 현장에서 쓰는 필드만. */
export interface LocationItem {
  id: string;
  code: string;
  displayName: string;
}
```

Create `src/domains/warehouse/useWarehouses.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { Warehouse } from './types';

/** GET /inventory/warehouses — 전체 목록(페이지네이션 없음). */
export function useWarehouses() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['warehouses'],
    staleTime: 5 * 60_000, // 창고 목록은 거의 안 바뀐다.
    queryFn: () => api.request<Warehouse[]>({ path: '/inventory/warehouses' }),
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/warehouse/useWarehouses.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: `WarehousePicker` 실패 테스트**

Create `src/domains/warehouse/WarehousePicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider, useWarehouse } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { WarehousePicker } from './WarehousePicker';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function Current() {
  const { warehouseName } = useWarehouse();
  return <span data-testid="current">{warehouseName ?? '없음'}</span>;
}

function renderPicker(client: ApiClient, onPicked?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={createMemoryPrefs()}>{children}</WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(
    <>
      <WarehousePicker onPicked={onPicked} />
      <Current />
    </>,
    { wrapper: wrap }
  );
}

describe('WarehousePicker', () => {
  const client: ApiClient = {
    request: (async () => [
      { id: 'w-1', name: '본창고', location: '김포' },
      { id: 'w-2', name: '제2창고', location: '이천' },
    ]) as unknown as ApiClient['request'],
  };

  it('창고를 목록으로 보여준다', async () => {
    renderPicker(client);
    expect(await screen.findByRole('button', { name: /본창고/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /제2창고/ })).toBeInTheDocument();
  });

  it('선택하면 컨텍스트에 반영하고 onPicked 를 부른다', async () => {
    const onPicked = vi.fn();
    renderPicker(client, onPicked);

    await userEvent.click(await screen.findByRole('button', { name: /제2창고/ }));

    expect(screen.getByTestId('current')).toHaveTextContent('제2창고');
    expect(onPicked).toHaveBeenCalledTimes(1);
  });

  it('조회 실패는 에러 문구를 보여준다', async () => {
    const failing: ApiClient = {
      request: (async () => {
        throw new Error('GET /inventory/warehouses → 500');
      }) as unknown as ApiClient['request'],
    };
    renderPicker(failing);
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 있어요');
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/domains/warehouse/WarehousePicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./WarehousePicker"`

- [ ] **Step 7: 구현**

Create `src/domains/warehouse/WarehousePicker.tsx`:

```tsx
import { Warehouse as WarehouseIcon, Check } from 'lucide-react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { cn } from '../../core/design/cn';
import { useWarehouses } from './useWarehouses';

/** 창고 선택 목록. /settings 와 "창고 미설정" 인라인 카드가 공유한다. */
export function WarehousePicker({ onPicked }: { onPicked?: () => void }) {
  const { warehouseId, setWarehouse } = useWarehouse();
  const { data, isLoading, isError, error } = useWarehouses();

  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {errorMessage(error)}
      </p>
    );
  }
  if (isLoading) return <p className="text-sm text-gray-500">불러오는 중…</p>;

  const warehouses = data ?? [];
  if (warehouses.length === 0) {
    return <p className="text-sm text-gray-500">등록된 창고가 없어요.</p>;
  }

  return (
    <ul className="space-y-2">
      {warehouses.map((w) => {
        const active = w.id === warehouseId;
        return (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => {
                setWarehouse({ id: w.id, name: w.name });
                onPicked?.();
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border p-4 text-left active:bg-gray-50',
                active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
              )}
            >
              <WarehouseIcon className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              <span className="flex-1">
                <span className="block font-semibold text-gray-800">{w.name}</span>
                {w.location ? (
                  <span className="block text-xs text-gray-500">{w.location}</span>
                ) : null}
              </span>
              {active ? <Check className="h-5 w-5 shrink-0 text-blue-600" aria-hidden /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/domains/warehouse/WarehousePicker.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 9: `/settings` 화면을 만든다**

Create `src/app/routes/SettingsRoute.tsx`:

```tsx
import { platform } from '@tauri-apps/plugin-os';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { resolveProfile } from '../profile';

export function SettingsRoute() {
  return (
    <div className="space-y-5">
      <ScreenHeader title="설정" backTo="/" />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">이 기기의 창고</h2>
        <p className="text-xs text-gray-500">
          조정·실사는 여기서 고른 창고를 기준으로 기록돼요.
        </p>
        <WarehousePicker />
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-gray-700">프로필</h2>
        <p className="text-sm text-gray-600">
          {resolveProfile(platform()) === 'station' ? '스테이션 (Windows)' : '핸드헬드'}
        </p>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-gray-700">그 외</h2>
        <p className="text-sm text-gray-500">
          백엔드 주소·프린터 IP·프로필 변경은 후속 Phase에서 열려요.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 10: 상단 창고 칩을 `AuthedLayout`에 넣는다**

`src/app/routes/AuthedLayout.tsx`를 아래로 교체한다:

```tsx
import { useEffect } from 'react';
import { Outlet, useNavigate, Link } from '@tanstack/react-router';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { useIsAuthenticated } from '../session-context';
import { useWarehouse } from '../warehouse-context';

export function AuthedLayout() {
  const authed = useIsAuthenticated();
  const navigate = useNavigate();
  const { warehouseName } = useWarehouse();
  // beforeLoad gates entry; this effect handles a live logout / refresh
  // failure while an authenticated screen is already mounted.
  useEffect(() => {
    if (!authed) navigate({ to: '/login' });
  }, [authed, navigate]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link
          to="/settings"
          className="flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 active:bg-gray-100"
        >
          <WarehouseIcon className="h-3.5 w-3.5 text-blue-600" aria-hidden />
          {warehouseName ?? '창고 미설정'}
        </Link>
      </div>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 11: 라우트를 교체한다**

`src/app/routeTree.tsx`에서 `settingsRoute`를 아래로 바꾼다:

```tsx
const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings',
  component: SettingsRoute,
});
```

상단에 `import { SettingsRoute } from './routes/SettingsRoute';`를 추가한다.

- [ ] **Step 12: 라우터/레이아웃 테스트가 깨지지 않는지 본다**

Run: `npx vitest run src/app/`
Expected: PASS. 실패한다면 `AuthedLayout`·라우터를 렌더하는 기존 테스트가 `WarehouseProvider` 없이 마운트하기 때문이다 — 그 테스트의 wrapper에 `<WarehouseProvider prefs={createMemoryPrefs()}>`를 추가해 고친다(프로바이더 요구는 의도된 것이므로 컨텍스트를 optional로 만들지 않는다).

- [ ] **Step 13: 전체 테스트 + 빌드 + 커밋**

Run:
```bash
npm test
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/warehouse/ src/app/routes/SettingsRoute.tsx \
        src/app/routes/AuthedLayout.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 창고 선택 화면 + 상단 창고 칩

/settings 스텁을 창고 선택으로 채우고, AuthedLayout 상단에 현재 창고를
상시 노출한다(탭하면 설정으로). WarehousePicker 는 이후 '창고 미설정'
인라인 카드에서 재사용한다."
```

---

### Task 9: `useLocationSearch`

**Files:**
- Create: `src/domains/warehouse/useLocationSearch.ts`
- Create: `src/domains/warehouse/useLocationSearch.test.tsx`

**Interfaces:**
- Consumes: `LocationItem`(Task 8 `types.ts`), `useApiClient`
- Produces: `useLocationSearch(warehouseId: string | null, search: string): UseQueryResult<{ items: LocationItem[]; total: number }>` — key `['location-search', warehouseId, search]`, path `/locations/warehouses/:warehouseId?search=…&limit=20`. `warehouseId`가 null이거나 `search`가 공백이면 `enabled: false`. Task 12(조정 화면)·Task 17(실사 카운트 화면)이 로케이션 코드 → id 해석에 쓴다.

- [ ] **Step 1: 실패 테스트**

Create `src/domains/warehouse/useLocationSearch.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useLocationSearch } from './useLocationSearch';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useLocationSearch', () => {
  it('창고 경로 + search 파라미터로 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => ({
      items: [{ id: 'l-1', code: 'A-01-02', displayName: 'A-01-02' }],
      total: 1,
    }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useLocationSearch('w-1', 'A-01'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/locations/warehouses/w-1?');
    expect(path).toContain('search=A-01');
    expect(path).toContain('limit=20');
  });

  it('창고가 없으면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useLocationSearch(null, 'A-01'), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });

  it('검색어가 공백이면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => ({ items: [], total: 0 }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useLocationSearch('w-1', '   '), {
      wrapper: wrapperFor(client),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/warehouse/useLocationSearch.test.tsx`
Expected: FAIL — `Failed to resolve import "./useLocationSearch"`

- [ ] **Step 3: 구현**

Create `src/domains/warehouse/useLocationSearch.ts`:

```ts
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { LocationItem } from './types';

export interface LocationSearchResult {
  items: LocationItem[];
  total: number;
}

/**
 * GET /locations/warehouses/:warehouseId?search=…
 * LocationQueryDto.search 는 "코드나 이름"을 본다 — 스캔한 로케이션 코드를
 * locationId 로 바꾸는 유일한 경로다.
 */
export function useLocationSearch(warehouseId: string | null, search: string) {
  const api = useApiClient();
  const term = search.trim();
  return useQuery({
    queryKey: ['location-search', warehouseId, term],
    enabled: warehouseId !== null && term.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => {
      const qs = new URLSearchParams({ search: term, limit: '20' });
      return api.request<LocationSearchResult>({
        path: `/locations/warehouses/${warehouseId}?${qs.toString()}`,
      });
    },
  });
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npx vitest run src/domains/warehouse/useLocationSearch.test.tsx`
Expected: PASS (3 tests)

```bash
git add src/domains/warehouse/useLocationSearch.ts src/domains/warehouse/useLocationSearch.test.tsx
git commit -m "feat(warehouse-app): 로케이션 검색 훅

스캔한 로케이션 코드를 locationId 로 바꾸는 유일한 경로다(조정·실사 공용)."
```

---

# Part C — 재고 상세 · 조정

### Task 10: 재고 상세 읽기 훅 3종

**Files:**
- Modify: `src/domains/inventory/types.ts`
- Create: `src/domains/inventory/useSkuDetail.ts`
- Create: `src/domains/inventory/useSkuDetail.test.tsx`

**Interfaces:**
- Consumes: `useApiClient`. Task 1의 백엔드 `locationCode` 확장.
- Produces (전부 `useSkuDetail.ts`에서 export):
  - `useSkuDetail(skuId: string)` → `SkuDetail` — key `['sku-detail', skuId]`, path `/inventory/skus/:id`
  - `useSkuStockSummary(skuId: string)` → `SkuStockSummary` — key `['sku-stock-summary', skuId]`, path `/inventory/skus/:id/stock-summary`
  - `useSkuWarehouseStock(skuId: string, warehouseId: string | null)` → `SkuWarehouseStock` — key `['sku-warehouse-stock', skuId, warehouseId]`, path `/inventory/stocks/sku/:skuId/warehouse/:warehouseId`, `warehouseId === null`이면 `enabled: false`
  - 타입 `SkuDetail`·`SkuStockSummary`·`SkuWarehouseStock`·`StockDetailRow`는 `types.ts`에서 export
  - Task 11·12가 쓴다.

- [ ] **Step 1: 타입을 추가한다**

`src/domains/inventory/types.ts` 끝에 추가한다 (기존 `SkuSearchItem`은 그대로 둔다):

```ts
/** GET /inventory/skus/:id — SkuResponseDto 중 현장에서 쓰는 필드만. */
export interface SkuDetail {
  id: string;
  code: string;
  name: string;
  optionKey?: string | null;
  safetyStock: number;
  barcodes: Array<{ id: string; barcode: string; isPrimary: boolean }>;
}

/** GET /inventory/skus/:id/stock-summary — 창고 단위 집계. */
export interface SkuStockSummary {
  skuId: string;
  skuName: string;
  skuCode: string;
  totalRealQuantity: number;
  totalReservedQuantity: number;
  totalAvailableQuantity: number;
  warehouseStocks: Array<{
    warehouseId: string;
    warehouseName: string;
    realQuantity: number;
    reservedQuantity: number;
    availableQuantity: number;
  }>;
}

/**
 * GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId 의 details[] 한 행.
 * stock_ledgers 는 location_id 가 NOT NULL 이고 복합 PK 의 일부라 위치 없는 재고 행은 존재할 수 없다.
 */
export interface StockDetailRow {
  locationId: string;
  locationCode: string;
  stockState: string;
  quantity: number;
}

export interface SkuWarehouseStock {
  summary: {
    currentQuantity: number;
    availableQuantity: number;
    reservedQuantity: number;
  } | null;
  details: StockDetailRow[];
}
```

- [ ] **Step 2: 실패 테스트**

Create `src/domains/inventory/useSkuDetail.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useSkuDetail, useSkuStockSummary, useSkuWarehouseStock } from './useSkuDetail';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

function stubClient() {
  const request = vi.fn(async (_opts: { path: string }) => ({}));
  return { request, client: { request: request as unknown as ApiClient['request'] } };
}

describe('inventory detail hooks', () => {
  it('useSkuDetail 은 SKU 상세 경로를 부른다', async () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuDetail('sku-1'), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/skus/sku-1');
  });

  it('useSkuStockSummary 는 stock-summary 경로를 부른다', async () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuStockSummary('sku-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/skus/sku-1/stock-summary');
  });

  it('useSkuWarehouseStock 은 sku×창고 경로를 부른다', async () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuWarehouseStock('sku-1', 'w-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/stocks/sku/sku-1/warehouse/w-1');
  });

  it('useSkuWarehouseStock 은 창고가 없으면 호출하지 않는다', () => {
    const { request, client } = stubClient();
    const { result } = renderHook(() => useSkuWarehouseStock('sku-1', null), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/domains/inventory/useSkuDetail.test.tsx`
Expected: FAIL — `Failed to resolve import "./useSkuDetail"`

- [ ] **Step 4: 구현**

Create `src/domains/inventory/useSkuDetail.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuDetail, SkuStockSummary, SkuWarehouseStock } from './types';

/** GET /inventory/skus/:id */
export function useSkuDetail(skuId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-detail', skuId],
    queryFn: () => api.request<SkuDetail>({ path: `/inventory/skus/${skuId}` }),
  });
}

/** GET /inventory/skus/:id/stock-summary — 전 창고 합계 + 창고별. */
export function useSkuStockSummary(skuId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-stock-summary', skuId],
    queryFn: () => api.request<SkuStockSummary>({ path: `/inventory/skus/${skuId}/stock-summary` }),
  });
}

/**
 * GET /inventory/stocks/sku/:skuId/warehouse/:warehouseId
 * 한 번의 호출로 창고 요약 + 위치별 details[] 를 준다(details 의 locationCode 는
 * Task 1 에서 추가됐다). quantity === 0 행 제외는 소비하는 화면의 몫이다.
 */
export function useSkuWarehouseStock(skuId: string, warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-warehouse-stock', skuId, warehouseId],
    enabled: warehouseId !== null,
    queryFn: () =>
      api.request<SkuWarehouseStock>({
        path: `/inventory/stocks/sku/${skuId}/warehouse/${warehouseId}`,
      }),
  });
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npx vitest run src/domains/inventory/useSkuDetail.test.tsx`
Expected: PASS (4 tests)

```bash
git add src/domains/inventory/types.ts src/domains/inventory/useSkuDetail.ts \
        src/domains/inventory/useSkuDetail.test.tsx
git commit -m "feat(warehouse-app): 재고 상세 읽기 훅 3종"
```

---

### Task 11: `SkuDetailScreen` + `/inventory/$sku` 라우트

**Files:**
- Create: `src/domains/inventory/SkuDetailScreen.tsx`
- Create: `src/domains/inventory/SkuDetailScreen.test.tsx`
- Create: `src/app/routes/SkuDetailRoute.tsx`
- Modify: `src/app/routeTree.tsx` (`inventoryDetailRoute` 스텁 교체)

**Interfaces:**
- Consumes: Task 10 훅 3종, `useWarehouse`(Task 7), `ScreenHeader`(Task 6), `WarehousePicker`(Task 8), `errorMessage`(Task 5)
- Produces: `SkuDetailScreen({ skuId }: { skuId: string })`. 라우트는 `useParams({ from: ... })` 대신 `SkuDetailRoute`가 `sku` 파라미터를 읽어 넘긴다. Task 12(조정 화면)가 `/inventory/$sku/adjust`로 이동하는 진입점이다.

- [ ] **Step 1: 실패 테스트**

Create `src/domains/inventory/SkuDetailScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SkuDetailScreen } from './SkuDetailScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const DETAIL = { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', optionKey: 'M / 흰색', safetyStock: 5, barcodes: [] };
const SUMMARY = {
  skuId: 'sku-1',
  skuName: '코튼셔츠',
  skuCode: 'CT-001',
  totalRealQuantity: 15,
  totalReservedQuantity: 3,
  totalAvailableQuantity: 12,
  warehouseStocks: [
    { warehouseId: 'w-1', warehouseName: '본창고', realQuantity: 15, reservedQuantity: 3, availableQuantity: 12 },
  ],
};
const WAREHOUSE_STOCK = {
  summary: { currentQuantity: 15, availableQuantity: 12, reservedQuantity: 3 },
  details: [
    { locationId: 'l-1', locationCode: 'A-01-02', stockState: 'ON_HAND', quantity: 12 },
    { locationId: 'l-1', locationCode: 'A-01-02', stockState: 'DEFECTIVE', quantity: 3 },
    { locationId: 'l-2', locationCode: 'A-02-01', stockState: 'ON_HAND', quantity: 0 },
  ],
};

function routeFor(path: string) {
  return (client: ApiClient, warehouse?: { id: string; name: string }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const prefs = createMemoryPrefs(
      warehouse ? { 'almondwms.warehouse': JSON.stringify(warehouse) } : {}
    );
    const rootRoute = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <SkuDetailScreen skuId="sku-1" />,
    });
    const adjust = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory/$sku/adjust',
      component: () => <div>조정화면</div>,
    });
    const inventory = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory',
      component: () => <div>목록</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([index, adjust, inventory]),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    return render(<RouterProvider router={router as never} />, { wrapper: wrap });
  };
}

const renderScreen = routeFor('/');

function clientFor(overrides: Record<string, unknown> = {}): ApiClient {
  const table: Record<string, unknown> = {
    '/inventory/skus/sku-1': DETAIL,
    '/inventory/skus/sku-1/stock-summary': SUMMARY,
    '/inventory/stocks/sku/sku-1/warehouse/w-1': WAREHOUSE_STOCK,
    ...overrides,
  };
  return {
    request: (async (opts: { path: string }) => {
      if (!(opts.path in table)) throw new Error(`GET ${opts.path} → 404`);
      return table[opts.path];
    }) as unknown as ApiClient['request'],
  };
}

describe('SkuDetailScreen', () => {
  it('상품명·코드와 합계를 보여준다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByRole('heading', { name: /코튼셔츠/ })).toBeInTheDocument();
    expect(screen.getByText('CT-001')).toBeInTheDocument();
    expect(await screen.findByTestId('total-real')).toHaveTextContent('15');
    expect(screen.getByTestId('total-available')).toHaveTextContent('12');
  });

  it('위치별 행을 보여주고 수량 0 행은 감춘다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByText('A-01-02')).toBeInTheDocument();
    expect(screen.queryByText('A-02-01')).not.toBeInTheDocument();
  });

  it('같은 로케이션의 상태별 행을 각각 보여준다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByText('ON_HAND')).toBeInTheDocument();
    expect(screen.getByText('DEFECTIVE')).toBeInTheDocument();
  });

  it('창고 미설정이면 위치별 대신 창고 선택을 보여준다', async () => {
    renderScreen(clientFor());
    expect(await screen.findByText(/창고를 먼저 선택/)).toBeInTheDocument();
    expect(screen.queryByText('A-01-02')).not.toBeInTheDocument();
  });

  it('SKU 조회 실패는 에러 문구를 보여준다', async () => {
    const failing: ApiClient = {
      request: (async () => {
        throw new Error('GET /inventory/skus/sku-1 → 500');
      }) as unknown as ApiClient['request'],
    };
    renderScreen(failing, { id: 'w-1', name: '본창고' });
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 있어요');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/inventory/SkuDetailScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./SkuDetailScreen"`

- [ ] **Step 3: 구현**

Create `src/domains/inventory/SkuDetailScreen.tsx`:

```tsx
import { Link } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuDetail, useSkuStockSummary, useSkuWarehouseStock } from './useSkuDetail';
import type { StockDetailRow } from './types';

function StatCard({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div data-testid={testId} className="text-lg font-semibold text-gray-900">
        {value}
      </div>
    </div>
  );
}

export function SkuDetailScreen({ skuId }: { skuId: string }) {
  const { warehouseId, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const summary = useSkuStockSummary(skuId);
  const warehouseStock = useSkuWarehouseStock(skuId, warehouseId);

  if (detail.isError) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="상품 재고 상세" backTo="/inventory" />
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(detail.error)}
        </p>
      </div>
    );
  }

  const sku = detail.data;
  // quantity 0 행은 현장에 의미가 없다 — 백엔드는 행 집합을 줄이지 않으므로 여기서 거른다.
  const rows: StockDetailRow[] = (warehouseStock.data?.details ?? []).filter((d) => d.quantity !== 0);

  return (
    <div className="space-y-5">
      <ScreenHeader title={sku ? sku.name : '상품 재고 상세'} backTo="/inventory" />

      {sku ? (
        <div className="text-sm text-gray-600">
          <span className="font-mono">{sku.code}</span>
          {sku.optionKey ? <span className="ml-2 text-gray-500">{sku.optionKey}</span> : null}
        </div>
      ) : null}

      {summary.data ? (
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="실재고" value={summary.data.totalRealQuantity} testId="total-real" />
          <StatCard label="예약" value={summary.data.totalReservedQuantity} testId="total-reserved" />
          <StatCard label="가용" value={summary.data.totalAvailableQuantity} testId="total-available" />
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">위치별 재고</h2>

        {!isSet ? (
          <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="text-sm text-gray-600">
              창고를 먼저 선택하면 위치별 재고를 볼 수 있어요.
            </p>
            <WarehousePicker />
          </div>
        ) : warehouseStock.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage(warehouseStock.error)}
          </p>
        ) : warehouseStock.isLoading ? (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">이 창고에는 재고가 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={`${row.locationId}-${row.stockState}`}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
              >
                <span className="flex-1">
                  <span className="block font-medium text-gray-800">{row.locationCode}</span>
                  <span className="block text-xs text-gray-500">{row.stockState}</span>
                </span>
                <span className="text-lg font-semibold text-gray-900">{row.quantity}</span>
                <Link
                  to="/inventory/$sku/adjust"
                  params={{ sku: skuId }}
                  search={{ locationId: row.locationId }}
                >
                  <Button className="px-3 py-1.5 text-xs">조정</Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isSet ? (
        <Link to="/inventory/$sku/adjust" params={{ sku: skuId }}>
          <Button className="w-full py-3">재고 조정</Button>
        </Link>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/inventory/SkuDetailScreen.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: 라우트를 배선한다**

Create `src/app/routes/SkuDetailRoute.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { SkuDetailScreen } from '../../domains/inventory/SkuDetailScreen';

export function SkuDetailRoute() {
  const { sku } = useParams({ strict: false });
  return <SkuDetailScreen skuId={sku ?? ''} />;
}
```

`src/app/routeTree.tsx`에서 `inventoryDetailRoute`를 교체하고, **조정 라우트를 지금 스텁으로 등록한다.** 화면이 `<Link to="/inventory/$sku/adjust">`를 쓰는데 라우트가 없으면 TanStack Router 의 타입 검사에서 `tsc -b`가 깨진다 — 이 태스크의 빌드가 스스로 초록이어야 하므로 여기서 자리를 만든다(Task 12 가 component 만 갈아끼운다):

```tsx
const inventoryDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory/$sku',
  component: SkuDetailRoute,
});
const inventoryAdjustRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory/$sku/adjust',
  component: () => <PlaceholderScreen title="재고 조정" note="다음 태스크에서 구현됩니다." />,
  validateSearch: (search: Record<string, unknown>): { locationId?: string } => ({
    locationId: typeof search.locationId === 'string' ? search.locationId : undefined,
  }),
});
```

상단에 `import { SkuDetailRoute } from './routes/SkuDetailRoute';`를 추가하고, `authedRoute.addChildren([...])` 목록에 `inventoryAdjustRoute`를 넣는다.

- [ ] **Step 6: 빌드 + 커밋**

Run:
```bash
npx vitest run src/app/
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/inventory/SkuDetailScreen.tsx src/domains/inventory/SkuDetailScreen.test.tsx \
        src/app/routes/SkuDetailRoute.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): SKU 재고 상세 화면

합계 카드 + 위치별 재고(수량 0 행 제외, 위치 미지정 표기) + 행별 조정 진입.
창고 미설정이면 위치별 자리에 창고 선택을 인라인으로 띄운다."
```

---

### Task 12: `useAdjustStock` + `AdjustStockScreen` + `/inventory/$sku/adjust`

**Files:**
- Create: `src/domains/inventory/useAdjustStock.ts`
- Create: `src/domains/inventory/useAdjustStock.test.tsx`
- Create: `src/domains/inventory/AdjustStockScreen.tsx`
- Create: `src/domains/inventory/AdjustStockScreen.test.tsx`
- Create: `src/app/routes/AdjustStockRoute.tsx`
- Modify: `src/app/routeTree.tsx`

**Interfaces:**
- Consumes: Task 4(백엔드 `idempotencyKey`), Task 9(`useLocationSearch`), Task 10(`useSkuWarehouseStock`, `useSkuDetail`), Task 6(`ScreenHeader`·`NumberPad`·`ConfirmDialog`), Task 7(`useWarehouse`), Task 8(`WarehousePicker`)
- Produces:
  - `useAdjustStock()` → `UseMutationResult<unknown, Error, AdjustStockInput>` where `AdjustStockInput = { skuId: string; warehouseId: string; locationId: string; delta: number; reason: string; idempotencyKey: string }`. 성공 시 `['sku-warehouse-stock']`·`['sku-stock-summary']` prefix 무효화
  - `ADJUST_REASONS: readonly string[]` — `['파손', '분실', '발견', '오출고 정정', '기타']`
  - `AdjustStockScreen({ skuId, initialLocationId }: { skuId: string; initialLocationId?: string })`

- [ ] **Step 1: mutation 실패 테스트**

Create `src/domains/inventory/useAdjustStock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useAdjustStock } from './useAdjustStock';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

describe('useAdjustStock', () => {
  it('조정 body 와 멱등 헤더를 함께 보낸다', async () => {
    const request = vi.fn(
      async (_opts: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => ({})
    );
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>{children}</ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );

    const { result } = renderHook(() => useAdjustStock(), { wrapper });

    await result.current.mutateAsync({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
      idempotencyKey: 'key-1',
    });

    const call = request.mock.calls[0][0];
    expect(call.path).toBe('/inventory/stocks/adjust');
    expect(call.method).toBe('POST');
    expect(call.idempotencyKey).toBe('key-1');
    expect(call.body).toEqual({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
      idempotencyKey: 'key-1',
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(keys.some((k) => k.includes('sku-warehouse-stock'))).toBe(true);
    expect(keys.some((k) => k.includes('sku-stock-summary'))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/inventory/useAdjustStock.test.tsx`
Expected: FAIL — `Failed to resolve import "./useAdjustStock"`

- [ ] **Step 3: 구현**

Create `src/domains/inventory/useAdjustStock.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';

export const ADJUST_REASONS = ['파손', '분실', '발견', '오출고 정정', '기타'] as const;

export interface AdjustStockInput {
  skuId: string;
  warehouseId: string;
  /** 로케이션은 필수다 — 생략하면 백엔드가 시스템 '입고기본존'으로 밀어넣는다. */
  locationId: string;
  /** 0 은 백엔드가 400 으로 거절한다. 화면에서 먼저 막는다. */
  delta: number;
  reason: string;
  /** 화면 진입 시 1회 생성해 재시도에 재사용한다. */
  idempotencyKey: string;
}

/** POST /inventory/stocks/adjust */
export function useAdjustStock() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStockInput) =>
      api.request<unknown>({
        method: 'POST',
        path: '/inventory/stocks/adjust',
        body: input,
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/inventory/useAdjustStock.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: 화면 실패 테스트**

Create `src/domains/inventory/AdjustStockScreen.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { AdjustStockScreen } from './AdjustStockScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const TABLE: Record<string, unknown> = {
  '/inventory/skus/sku-1': {
    id: 'sku-1',
    code: 'CT-001',
    name: '코튼셔츠',
    safetyStock: 0,
    barcodes: [],
  },
  '/inventory/stocks/sku/sku-1/warehouse/w-1': {
    summary: { currentQuantity: 12, availableQuantity: 12, reservedQuantity: 0 },
    details: [{ locationId: 'l-1', locationCode: 'A-01-02', stockState: 'ON_HAND', quantity: 12 }],
  },
};

function makeClient(calls: Array<{ path: string; body?: unknown; idempotencyKey?: string }>): ApiClient {
  return {
    request: (async (opts: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => {
      calls.push({ path: opts.path, body: opts.body, idempotencyKey: opts.idempotencyKey });
      if (opts.path.startsWith('/locations/warehouses/')) {
        return { items: [{ id: 'l-9', code: 'B-03-01', displayName: 'B-03-01' }], total: 1 };
      }
      if (opts.path === '/inventory/stocks/adjust') return {};
      if (opts.path in TABLE) return TABLE[opts.path];
      throw new Error(`GET ${opts.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderScreen(client: ApiClient, initialLocationId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }),
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AdjustStockScreen skuId="sku-1" initialLocationId={initialLocationId} />,
  });
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inventory/$sku',
    component: () => <div>상세화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, detail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('AdjustStockScreen', () => {
  it('로케이션 미선택이면 조정 버튼이 비활성이다', async () => {
    renderScreen(makeClient([]));
    expect(await screen.findByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('프리필된 로케이션의 현재 수량을 보여준다', async () => {
    renderScreen(makeClient([]), 'l-1');
    expect(await screen.findByText('A-01-02')).toBeInTheDocument();
    expect(await screen.findByTestId('current-onhand')).toHaveTextContent('12');
  });

  it('delta 가 0 이면 조정 버튼이 비활성이다', async () => {
    renderScreen(makeClient([]), 'l-1');
    // 기본 delta 는 0
    expect(await screen.findByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('사유를 고르지 않으면 조정 버튼이 비활성이다', async () => {
    renderScreen(makeClient([]), 'l-1');
    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    expect(screen.getByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('로케이션·delta·사유가 갖춰지면 확인 후 조정을 보낸다', async () => {
    const calls: Array<{ path: string; body?: unknown; idempotencyKey?: string }> = [];
    renderScreen(makeClient(calls), 'l-1');

    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '부호' }));
    await userEvent.click(screen.getByRole('button', { name: '파손' }));
    await userEvent.click(screen.getByRole('button', { name: '조정하기' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '조정' }));

    const adjust = calls.find((c) => c.path === '/inventory/stocks/adjust');
    expect(adjust?.body).toMatchObject({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
    });
    expect(adjust?.idempotencyKey).toEqual(expect.any(String));
  });

  it('기타 사유는 자유 입력을 요구한다', async () => {
    renderScreen(makeClient([]), 'l-1');
    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '기타' }));

    expect(screen.getByRole('button', { name: '조정하기' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('사유 직접 입력'), '창고 이관 누락');
    expect(screen.getByRole('button', { name: '조정하기' })).toBeEnabled();
  });

  it('검색으로 로케이션을 고를 수 있다', async () => {
    renderScreen(makeClient([]));
    await userEvent.type(screen.getByLabelText('로케이션 검색'), 'B-03');
    await userEvent.click(await screen.findByRole('button', { name: /B-03-01/ }));
    expect(await screen.findByText('B-03-01')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/domains/inventory/AdjustStockScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./AdjustStockScreen"`

- [ ] **Step 7: 구현**

Create `src/domains/inventory/AdjustStockScreen.tsx`:

```tsx
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { NumberPad } from '../../core/design/NumberPad';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useLocationSearch } from '../warehouse/useLocationSearch';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useSkuDetail, useSkuWarehouseStock } from './useSkuDetail';
import { useAdjustStock, ADJUST_REASONS } from './useAdjustStock';

const OTHER = '기타';

export function AdjustStockScreen({
  skuId,
  initialLocationId,
}: {
  skuId: string;
  initialLocationId?: string;
}) {
  const navigate = useNavigate();
  const { warehouseId, isSet } = useWarehouse();
  const detail = useSkuDetail(skuId);
  const stock = useSkuWarehouseStock(skuId, warehouseId);
  const adjust = useAdjustStock();

  const [locationId, setLocationId] = useState<string | undefined>(initialLocationId);
  const [term, setTerm] = useState('');
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  // 화면 생애 동안 고정 — 네트워크 재시도가 이중 적용되지 않게 한다.
  const idempotencyKey = useRef(crypto.randomUUID()).current;

  const search = useLocationSearch(warehouseId, term);

  // 스캔한 로케이션 코드는 검색으로 해석한다(코드 → id 경로가 이것뿐이다).
  useScanner((e) => setTerm(e.code));

  const rows = stock.data?.details ?? [];
  const selected = useMemo(() => {
    if (!locationId) return null;
    const fromStock = rows.find((r) => r.locationId === locationId && r.locationCode !== null);
    if (fromStock) return { id: locationId, code: fromStock.locationCode as string };
    const fromSearch = search.data?.items.find((i) => i.id === locationId);
    return fromSearch ? { id: fromSearch.id, code: fromSearch.code } : { id: locationId, code: locationId };
  }, [locationId, rows, search.data]);

  const currentOnHand = useMemo(
    () =>
      rows
        .filter((r) => r.locationId === locationId && r.stockState === 'ON_HAND')
        .reduce((sum, r) => sum + r.quantity, 0),
    [rows, locationId]
  );

  const effectiveReason = reason === OTHER ? otherReason.trim() : (reason ?? '');
  const canSubmit =
    isSet && Boolean(warehouseId) && Boolean(locationId) && delta !== 0 && effectiveReason.length > 0;

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="재고 조정" backTo="/inventory" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="재고 조정" backTo="/inventory" />

      {detail.data ? (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="font-semibold text-gray-800">{detail.data.name}</div>
          <div className="font-mono text-xs text-gray-500">{detail.data.code}</div>
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">로케이션</h2>
        {selected ? (
          <div className="flex items-center gap-3 rounded-lg border border-blue-500 bg-blue-50 p-3">
            <span className="flex-1 font-medium text-gray-800">{selected.code}</span>
            <span className="text-xs text-gray-500">현재 ON_HAND</span>
            <span data-testid="current-onhand" className="text-lg font-semibold text-gray-900">
              {currentOnHand}
            </span>
            <button
              type="button"
              className="text-xs text-blue-700 underline"
              onClick={() => setLocationId(undefined)}
            >
              변경
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="loc-search" className="sr-only">
              로케이션 검색
            </label>
            <input
              id="loc-search"
              aria-label="로케이션 검색"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="로케이션 바코드를 스캔하거나 코드를 입력하세요"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {search.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(search.error, 'location')}
              </p>
            ) : null}
            <ul className="space-y-1">
              {(search.data?.items ?? []).map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                    onClick={() => setLocationId(loc.id)}
                  >
                    {loc.code}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">조정 수량</h2>
        <div
          className={cn(
            'rounded-lg border p-3 text-center text-2xl font-semibold',
            delta > 0 && 'border-green-500 bg-green-50 text-green-700',
            delta < 0 && 'border-red-500 bg-red-50 text-red-700',
            delta === 0 && 'border-gray-200 bg-white text-gray-400'
          )}
        >
          {delta > 0 ? `+${delta}` : delta}
        </div>
        <NumberPad value={delta} onChange={setDelta} allowNegative />
        <p className="text-xs text-gray-500">
          파손·분실은 −, 발견은 +. 실제 수량을 그대로 맞추려면 실사를 쓰세요.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">사유</h2>
        <div className="flex flex-wrap gap-2">
          {ADJUST_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm',
                reason === r ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 bg-white text-gray-700'
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === OTHER ? (
          <input
            aria-label="사유 직접 입력"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="사유를 입력하세요"
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
          />
        ) : null}
      </section>

      {adjust.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(adjust.error)}
        </p>
      ) : null}

      <Button
        type="button"
        className="w-full py-3"
        disabled={!canSubmit || adjust.isPending}
        onClick={() => setConfirming(true)}
      >
        조정하기
      </Button>

      <ConfirmDialog
        open={confirming}
        title="재고 조정"
        message={`${selected?.code ?? ''} 의 ${detail.data?.name ?? '상품'} 을(를) ${
          delta > 0 ? `+${delta}` : delta
        } 조정합니다. 사유: ${effectiveReason}`}
        confirmLabel="조정"
        danger={delta < 0}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (!warehouseId || !locationId) return;
          adjust.mutate(
            { skuId, warehouseId, locationId, delta, reason: effectiveReason, idempotencyKey },
            { onSuccess: () => navigate({ to: '/inventory/$sku', params: { sku: skuId } }) }
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/domains/inventory/AdjustStockScreen.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 9: 라우트를 배선한다**

Create `src/app/routes/AdjustStockRoute.tsx`:

```tsx
import { useParams, useSearch } from '@tanstack/react-router';
import { AdjustStockScreen } from '../../domains/inventory/AdjustStockScreen';

export function AdjustStockRoute() {
  const { sku } = useParams({ strict: false });
  const search: { locationId?: string } = useSearch({ strict: false });
  return <AdjustStockScreen skuId={sku ?? ''} initialLocationId={search.locationId} />;
}
```

`src/app/routeTree.tsx`의 `inventoryAdjustRoute`는 Task 11 에서 스텁으로 이미 등록돼 있다. **component 만 갈아끼운다** (path·validateSearch·addChildren 등록은 그대로):

```tsx
const inventoryAdjustRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/inventory/$sku/adjust',
  component: AdjustStockRoute,
  validateSearch: (search: Record<string, unknown>): { locationId?: string } => ({
    locationId: typeof search.locationId === 'string' ? search.locationId : undefined,
  }),
});
```

상단에 `import { AdjustStockRoute } from './routes/AdjustStockRoute';`를 추가한다. `PlaceholderScreen` import 가 다른 스텁 라우트에서 계속 쓰이는지 확인하고, 안 쓰이면 지운다.

- [ ] **Step 10: 전체 검증 + 커밋**

Run:
```bash
npm test
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/inventory/useAdjustStock.ts src/domains/inventory/useAdjustStock.test.tsx \
        src/domains/inventory/AdjustStockScreen.tsx src/domains/inventory/AdjustStockScreen.test.tsx \
        src/app/routes/AdjustStockRoute.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 재고 조정 화면 (delta 전용·로케이션 필수)

절대 카운트는 실사의 몫이라 조정은 delta 만 받는다. 로케이션은 필수 —
생략하면 백엔드가 시스템 입고기본존으로 밀어넣어 실물과 원장이 어긋난다.
멱등키는 화면 진입 시 1회 생성해 재시도에 재사용한다."
```

---

### Task 13: `useSkuByBarcode` + `/inventory` 스캔 배선

**Files:**
- Create: `src/domains/inventory/useSkuByBarcode.ts`
- Create: `src/domains/inventory/useSkuByBarcode.test.tsx`
- Modify: `src/domains/inventory/InventoryLookupScreen.tsx`
- Modify: `src/domains/inventory/InventoryLookupScreen.test.tsx`

**Interfaces:**
- Consumes: `useApiClient`, `useScanner`, `errorMessage`(Task 5)
- Produces: `useSkuByBarcode(barcode: string | null): UseQueryResult<SkuSearchItem[]>` — key `['sku-by-barcode', barcode]`, path `/inventory/skus?barcode=…`, `barcode === null`이면 `enabled: false`. 응답이 배열이라는 점이 `search/advanced`(`{items,total}`)와 다르다.

- [ ] **Step 1: 훅 실패 테스트**

Create `src/domains/inventory/useSkuByBarcode.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { useSkuByBarcode } from './useSkuByBarcode';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

describe('useSkuByBarcode', () => {
  it('barcode 쿼리로 조회한다', async () => {
    const request = vi.fn(async (_opts: { path: string }) => []);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode('8801234567890'), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inventory/skus?barcode=8801234567890');
  });

  it('바코드가 없으면 호출하지 않는다', () => {
    const request = vi.fn(async (_opts: { path: string }) => []);
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };

    const { result } = renderHook(() => useSkuByBarcode(null), { wrapper: wrapperFor(client) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/inventory/useSkuByBarcode.test.tsx`
Expected: FAIL — `Failed to resolve import "./useSkuByBarcode"`

- [ ] **Step 3: 구현**

Create `src/domains/inventory/useSkuByBarcode.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { SkuSearchItem } from './types';

/**
 * GET /inventory/skus?barcode=…
 * search/advanced 는 name·code 만 보고 바코드를 안 본다 — 스캔 경로는 이 엔드포인트뿐이다.
 * 응답은 배열({items,total} 아님).
 */
export function useSkuByBarcode(barcode: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['sku-by-barcode', barcode],
    enabled: barcode !== null && barcode.length > 0,
    queryFn: () =>
      api.request<SkuSearchItem[]>({
        path: `/inventory/skus?barcode=${encodeURIComponent(barcode ?? '')}`,
      }),
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/inventory/useSkuByBarcode.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: 화면 스캔 배선 실패 테스트**

`src/domains/inventory/InventoryLookupScreen.test.tsx` 끝에 추가한다. 파일 상단 import에 아래를 보강한다 (이미 있으면 생략):

```tsx
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
```

테스트 블록:

```tsx
describe('InventoryLookupScreen — 스캔 진입', () => {
  function Emitter() {
    const bus = useScanBus();
    return (
      <button onClick={() => bus.emit({ code: '8801234567890', source: 'hid', at: 1 })}>
        스캔발사
      </button>
    );
  }

  function renderWithScan(client: ApiClient) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <>
          <InventoryLookupScreen />
          <Emitter />
        </>
      ),
    });
    const detail = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory/$sku',
      component: () => <div>상세화면</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([index, detail]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    return render(<RouterProvider router={router as never} />, { wrapper: wrap });
  }

  it('스캔 결과가 1건이면 상세로 이동한다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) {
          return [{ id: 'sku-1', code: 'CT-001', name: '코튼셔츠', currentStock: 1, safetyStock: 0 }];
        }
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(screen.getByRole('button', { name: '스캔발사' }));

    expect(await screen.findByText('상세화면')).toBeInTheDocument();
  });

  it('스캔 결과가 0건이면 미등록 바코드로 안내한다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) return [];
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(screen.getByRole('button', { name: '스캔발사' }));

    expect(await screen.findByRole('status')).toHaveTextContent('등록되지 않은 바코드예요');
  });

  it('스캔 결과가 여러 건이면 목록으로 보여준다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) {
          return [
            { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', currentStock: 1, safetyStock: 0 },
            { id: 'sku-2', code: 'CT-002', name: '코튼셔츠 L', currentStock: 2, safetyStock: 0 },
          ];
        }
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(screen.getByRole('button', { name: '스캔발사' }));

    expect(await screen.findByText('코튼셔츠 L')).toBeInTheDocument();
  });
});
```

> 이 블록이 참조하는 `session`·`ApiClient`·`QueryClient`·라우터 헬퍼가 기존 파일에 없으면, Task 11의 `SkuDetailScreen.test.tsx` 상단 import 블록을 그대로 복사해 채운다.

- [ ] **Step 6: 실패 확인**

Run: `npx vitest run src/domains/inventory/InventoryLookupScreen.test.tsx`
Expected: FAIL — 스캔을 발사해도 상세로 이동하지 않는다 (`Unable to find an element with the text: 상세화면`)

- [ ] **Step 7: 화면에 스캔을 배선한다**

`src/domains/inventory/InventoryLookupScreen.tsx`를 수정한다.

import 보강:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from './useSkuByBarcode';
```

`InventoryLookupScreen` 본문에서 `const sort = sorting[0];` 위에 추가:

```tsx
  const navigate = useNavigate();
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const byBarcode = useSkuByBarcode(scanned);

  // 각 화면은 자신이 기대하는 바코드 종류를 안다 — 여기선 상품 바코드다.
  useScanner((e) => {
    setScanNotice(null);
    setScanned(e.code);
  });

  useEffect(() => {
    if (!scanned || !byBarcode.isSuccess) return;
    const hits = byBarcode.data ?? [];
    if (hits.length === 1) {
      setScanned(null);
      void navigate({ to: '/inventory/$sku', params: { sku: hits[0].id } });
    } else if (hits.length === 0) {
      setScanNotice(`등록되지 않은 바코드예요: ${scanned}`);
      setScanned(null);
    }
  }, [scanned, byBarcode.isSuccess, byBarcode.data, navigate]);
```

`{isError && …}` 블록 **위**에 스캔 안내/결과를 넣는다:

```tsx
      {scanNotice ? (
        <p role="status" className="text-sm text-amber-700">
          {scanNotice}
        </p>
      ) : null}

      {byBarcode.isSuccess && (byBarcode.data?.length ?? 0) > 1 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">스캔한 바코드의 상품</h2>
          <ul className="space-y-1">
            {(byBarcode.data ?? []).map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                  onClick={() => {
                    setScanned(null);
                    void navigate({ to: '/inventory/$sku', params: { sku: hit.id } });
                  }}
                >
                  <span className="block font-medium text-gray-800">{hit.name}</span>
                  <span className="block font-mono text-xs text-gray-500">{hit.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
```

DataTable의 각 행에서도 상세로 갈 수 있게, `name` 컬럼의 `cell`을 링크로 바꾼다:

```tsx
      {
        accessorKey: 'name',
        header: '상품명',
        cell: ({ row }) => (
          <Link
            to="/inventory/$sku"
            params={{ sku: row.original.id }}
            className="font-medium text-blue-700 underline"
          >
            {row.original.name}
          </Link>
        ),
      },
```

이때 `import { Link, useNavigate } from '@tanstack/react-router';`로 합치고, `columns`의 `useMemo` 의존성 배열은 `[]` 그대로 둔다(`Link`는 모듈 스코프 값이다).

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/domains/inventory/InventoryLookupScreen.test.tsx`
Expected: PASS (기존 테스트 + 신규 3개)

- [ ] **Step 9: 전체 검증 + 커밋**

Run:
```bash
npm test
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/inventory/useSkuByBarcode.ts src/domains/inventory/useSkuByBarcode.test.tsx \
        src/domains/inventory/InventoryLookupScreen.tsx src/domains/inventory/InventoryLookupScreen.test.tsx
git commit -m "feat(warehouse-app): 재고조회 바코드 스캔 진입

스캔 → GET /inventory/skus?barcode= → 1건이면 상세 직행, 0건이면 미등록
안내, 다건이면 선택 목록. search/advanced 는 바코드를 안 보므로 별도 경로.
목록 행에서도 상세로 갈 수 있게 상품명을 링크로 바꿨다."
```

---

# Part D — 실사

### Task 14: 실사 타입 + 읽기 훅 3종

**Files:**
- Create: `src/domains/stocktaking/types.ts`
- Create: `src/domains/stocktaking/queries.ts`
- Create: `src/domains/stocktaking/queries.test.tsx`

**Interfaces:**
- Consumes: `useApiClient`. Task 2(백엔드 세션 상세 엔드포인트).
- Produces (`queries.ts`에서 export):
  - `useStocktakingSessions(warehouseId: string | null)` → `{ data: StocktakingSession[]; total: number }` — key `['stocktaking-sessions', warehouseId]`, path `/stocktaking/sessions?warehouseId=…&limit=50`. `warehouseId === null`이면 `enabled: false`
  - `useStocktakingSession(sessionId: string | null)` → `StocktakingSessionDetail` — key `['stocktaking-session', sessionId]`, path `/stocktaking/sessions/:id`
  - `useStocktakingVariances(sessionId: string | null)` → `Variance[]` — key `['stocktaking-variances', sessionId]`, path `/stocktaking/sessions/:id/variances`
- 타입(`types.ts`): `StocktakingStatus`, `StocktakingSession`, `StocktakingLine`, `StocktakingSessionDetail`, `Variance`, `ScanLocationResult`, `ScanLocationItem`, `ScanProductResult`, `AdjustmentPreview`, `GenerateAdjustmentsResult`. Task 15·16·17·18이 쓴다.

> 실측 확인됨: `listSessions`는 `{ total, page, limit, data: items }`를 반환한다 (`stocktaking.service.ts:53`). 목록은 `createdAt DESC` 정렬이다. 래퍼 키는 `data`이지 `items`가 아니다.

- [ ] **Step 1: 타입을 작성한다**

Create `src/domains/stocktaking/types.ts`:

```ts
export type StocktakingStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface StocktakingSession {
  id: string;
  warehouseId: string;
  sessionName: string;
  status: StocktakingStatus;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StocktakingLine {
  lineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  locationId: string | null;
  locationCode: string | null;
  expectedQuantity: number;
  /** 미카운트면 null. */
  countedQuantity: number | null;
  variance: number | null;
  scannedBarcode: string | null;
  status: string;
  notes: string | null;
}

export interface StocktakingSessionDetail extends StocktakingSession {
  progress: { total: number; counted: number };
  lines: StocktakingLine[];
}

/** POST /stocktaking/scan-location 의 expectedItems[] (Task 3 에서 확장됨). */
export interface ScanLocationItem {
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  barcode: string | null;
  expectedQuantity: number;
  countedQuantity: number | null;
  status: string;
}

export interface ScanLocationResult {
  locationId: string;
  locationCode: string;
  expectedItems: ScanLocationItem[];
}

/** POST /stocktaking/scan-product — countedQuantity 는 갱신 후 절대값. */
export interface ScanProductResult {
  lineId: string;
  skuId: string;
  countedQuantity: number;
  expectedQuantity: number;
  variance: number;
}

export interface Variance {
  lineId: string;
  locationCode: string | null;
  skuName: string;
  skuCode: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  discrepancyPercent: number;
}

export interface AdjustmentPreview {
  lineId: string;
  skuId: string;
  locationId: string | null;
  countedQuantity: number;
  currentOnHand: number;
  delta: number;
  adjustmentType: 'INCREASE' | 'DECREASE';
}

export interface GenerateAdjustmentsResult {
  adjustmentsCreated: number;
  eventsPosted: number;
  message: string;
  preview: AdjustmentPreview[];
}
```

- [ ] **Step 2: 실패 테스트**

Create `src/domains/stocktaking/queries.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  useStocktakingSessions,
  useStocktakingSession,
  useStocktakingVariances,
} from './queries';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function wrapperFor(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}

function stub() {
  const request = vi.fn(async (_opts: { path: string }) => ({ data: [], total: 0 }));
  return { request, client: { request: request as unknown as ApiClient['request'] } };
}

describe('stocktaking queries', () => {
  it('세션 목록은 창고로 필터한다', async () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingSessions('w-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const path = request.mock.calls[0][0].path;
    expect(path).toContain('/stocktaking/sessions?');
    expect(path).toContain('warehouseId=w-1');
  });

  it('창고가 없으면 세션 목록을 조회하지 않는다', () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingSessions(null), {
      wrapper: wrapperFor(client),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });

  it('세션 상세는 sessions/:id 를 부른다', async () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingSession('s-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/stocktaking/sessions/s-1');
  });

  it('차이는 sessions/:id/variances 를 부른다', async () => {
    const { request, client } = stub();
    const { result } = renderHook(() => useStocktakingVariances('s-1'), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/stocktaking/sessions/s-1/variances');
  });

  it('세션 id 가 없으면 상세/차이를 조회하지 않는다', () => {
    const { request, client } = stub();
    const detail = renderHook(() => useStocktakingSession(null), { wrapper: wrapperFor(client) });
    const variances = renderHook(() => useStocktakingVariances(null), {
      wrapper: wrapperFor(client),
    });
    expect(detail.result.current.fetchStatus).toBe('idle');
    expect(variances.result.current.fetchStatus).toBe('idle');
    expect(request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/domains/stocktaking/queries.test.tsx`
Expected: FAIL — `Failed to resolve import "./queries"`

- [ ] **Step 4: 구현**

Create `src/domains/stocktaking/queries.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type { StocktakingSession, StocktakingSessionDetail, Variance } from './types';

export interface SessionListResult {
  data: StocktakingSession[];
  total: number;
}

/** GET /stocktaking/sessions?warehouseId=… */
export function useStocktakingSessions(warehouseId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-sessions', warehouseId],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '', limit: '50' });
      return api.request<SessionListResult>({ path: `/stocktaking/sessions?${qs.toString()}` });
    },
  });
}

/**
 * GET /stocktaking/sessions/:id — 세션 + 전체 라인 + 진행률.
 * 실사 이어하기의 기반이다(getVariances 는 차이≠0 만 준다).
 */
export function useStocktakingSession(sessionId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-session', sessionId],
    enabled: sessionId !== null,
    queryFn: () =>
      api.request<StocktakingSessionDetail>({ path: `/stocktaking/sessions/${sessionId}` }),
  });
}

/** GET /stocktaking/sessions/:id/variances — 차이(variance != 0) 만. */
export function useStocktakingVariances(sessionId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['stocktaking-variances', sessionId],
    enabled: sessionId !== null,
    queryFn: () =>
      api.request<Variance[]>({ path: `/stocktaking/sessions/${sessionId}/variances` }),
  });
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

Run: `npx vitest run src/domains/stocktaking/queries.test.tsx`
Expected: PASS (5 tests)

```bash
git add src/domains/stocktaking/types.ts src/domains/stocktaking/queries.ts \
        src/domains/stocktaking/queries.test.tsx
git commit -m "feat(warehouse-app): 실사 타입 + 읽기 훅 3종"
```

---

### Task 15: 실사 mutation 훅 8종

**Files:**
- Create: `src/domains/stocktaking/mutations.ts`
- Create: `src/domains/stocktaking/mutations.test.tsx`

**Interfaces:**
- Consumes: Task 14 타입, Task 3(확장된 `scan-location` 응답)
- Produces (`mutations.ts`에서 export):
  - `useCreateSession()` — `POST /stocktaking/sessions`, body `{ warehouseId, sessionName, notes? }` → `StocktakingSession`. 성공 시 `['stocktaking-sessions']` 무효화
  - `useStartSession()` — `POST /stocktaking/sessions/:id/start` → 무효화 `['stocktaking-sessions']`, `['stocktaking-session', id]`
  - `useCancelSession()` — `POST /stocktaking/sessions/:id/cancel` → 같은 무효화
  - `useScanLocation()` — `POST /stocktaking/scan-location`, body `{ sessionId, locationBarcode }` → `ScanLocationResult`. 성공 시 `['stocktaking-session', sessionId]` 무효화
  - `useScanProduct()` — `POST /stocktaking/scan-product`, body `{ sessionId, locationId, productBarcode, quantity }` → `ScanProductResult`. 같은 무효화
  - `useUpdateCount()` — `PUT /stocktaking/lines/:lineId/count`, body `{ countedQuantity, notes? }` → `ScanProductResult`. 인자에 `sessionId`를 함께 받아 무효화에 쓴다
  - `useGenerateAdjustments()` — `POST /stocktaking/sessions/:id/generate-adjustments`, body `{}` → `GenerateAdjustmentsResult` (dry-run, 무효화 없음)
  - `useCompleteSession()` — `POST /stocktaking/sessions/:id/complete` → 무효화 `['stocktaking-sessions']`, `['stocktaking-session', id]`, `['stocktaking-variances', id]`, `['sku-warehouse-stock']`, `['sku-stock-summary']`

- [ ] **Step 1: 실패 테스트**

Create `src/domains/stocktaking/mutations.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import {
  useCreateSession,
  useStartSession,
  useCancelSession,
  useScanLocation,
  useScanProduct,
  useUpdateCount,
  useGenerateAdjustments,
  useCompleteSession,
} from './mutations';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

function setup() {
  const calls: Call[] = [];
  const client: ApiClient = {
    request: (async (opts: Call) => {
      calls.push(opts);
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return { calls, invalidate, wrapper };
}

function invalidatedKeys(invalidate: ReturnType<typeof vi.spyOn>): string {
  return invalidate.mock.calls.map((c) => JSON.stringify(c[0])).join('|');
}

describe('stocktaking mutations', () => {
  it('세션을 생성한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCreateSession(), { wrapper });

    await result.current.mutateAsync({ warehouseId: 'w-1', sessionName: '2026-07-23 실사' });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/sessions',
      method: 'POST',
      body: { warehouseId: 'w-1', sessionName: '2026-07-23 실사' },
    });
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-sessions');
  });

  it('세션을 시작한다', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useStartSession(), { wrapper });
    await result.current.mutateAsync('s-1');
    expect(calls[0]).toMatchObject({ path: '/stocktaking/sessions/s-1/start', method: 'POST' });
  });

  it('세션을 취소한다', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useCancelSession(), { wrapper });
    await result.current.mutateAsync('s-1');
    expect(calls[0]).toMatchObject({ path: '/stocktaking/sessions/s-1/cancel', method: 'POST' });
  });

  it('로케이션을 스캔한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useScanLocation(), { wrapper });

    await result.current.mutateAsync({ sessionId: 's-1', locationBarcode: 'A-01-02' });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/scan-location',
      method: 'POST',
      body: { sessionId: 's-1', locationBarcode: 'A-01-02' },
    });
    expect(invalidatedKeys(invalidate)).toContain('stocktaking-session');
  });

  it('상품을 스캔한다 (수량 동반)', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useScanProduct(), { wrapper });

    await result.current.mutateAsync({
      sessionId: 's-1',
      locationId: 'l-1',
      productBarcode: '880',
      quantity: 3,
    });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/scan-product',
      method: 'POST',
      body: { sessionId: 's-1', locationId: 'l-1', productBarcode: '880', quantity: 3 },
    });
  });

  it('수량을 절대값으로 세팅한다', async () => {
    const { calls, wrapper } = setup();
    const { result } = renderHook(() => useUpdateCount(), { wrapper });

    await result.current.mutateAsync({ sessionId: 's-1', lineId: 'line-1', countedQuantity: 12 });

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/lines/line-1/count',
      method: 'PUT',
      body: { countedQuantity: 12 },
    });
  });

  it('조정 미리보기는 dry-run 이라 무효화하지 않는다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useGenerateAdjustments(), { wrapper });

    await result.current.mutateAsync('s-1');

    expect(calls[0]).toMatchObject({
      path: '/stocktaking/sessions/s-1/generate-adjustments',
      method: 'POST',
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('완료는 원장 관련 쿼리까지 무효화한다', async () => {
    const { calls, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCompleteSession(), { wrapper });

    await result.current.mutateAsync('s-1');

    expect(calls[0]).toMatchObject({ path: '/stocktaking/sessions/s-1/complete', method: 'POST' });
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain('stocktaking-variances');
    expect(keys).toContain('sku-warehouse-stock');
    expect(keys).toContain('sku-stock-summary');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/stocktaking/mutations.test.tsx`
Expected: FAIL — `Failed to resolve import "./mutations"`

- [ ] **Step 3: 구현**

Create `src/domains/stocktaking/mutations.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import type {
  GenerateAdjustmentsResult,
  ScanLocationResult,
  ScanProductResult,
  StocktakingSession,
} from './types';

function invalidateSession(qc: QueryClient, sessionId: string) {
  void qc.invalidateQueries({ queryKey: ['stocktaking-session', sessionId] });
}

function invalidateList(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['stocktaking-sessions'] });
}

export interface CreateSessionInput {
  warehouseId: string;
  sessionName: string;
  notes?: string;
}

/** POST /stocktaking/sessions */
export function useCreateSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) =>
      api.request<StocktakingSession>({ method: 'POST', path: '/stocktaking/sessions', body: input }),
    onSuccess: () => invalidateList(qc),
  });
}

/** POST /stocktaking/sessions/:id/start */
export function useStartSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<unknown>({ method: 'POST', path: `/stocktaking/sessions/${sessionId}/start` }),
    onSuccess: (_data, sessionId) => {
      invalidateList(qc);
      invalidateSession(qc, sessionId);
    },
  });
}

/** POST /stocktaking/sessions/:id/cancel */
export function useCancelSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<unknown>({ method: 'POST', path: `/stocktaking/sessions/${sessionId}/cancel` }),
    onSuccess: (_data, sessionId) => {
      invalidateList(qc);
      invalidateSession(qc, sessionId);
    },
  });
}

export interface ScanLocationInput {
  sessionId: string;
  locationBarcode: string;
}

/** POST /stocktaking/scan-location — 라인을 upsert 하고 그 위치의 전체 라인을 돌려준다. */
export function useScanLocation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScanLocationInput) =>
      api.request<ScanLocationResult>({
        method: 'POST',
        path: '/stocktaking/scan-location',
        body: input,
      }),
    onSuccess: (_data, input) => invalidateSession(qc, input.sessionId),
  });
}

export interface ScanProductInput {
  sessionId: string;
  locationId: string;
  productBarcode: string;
  /** 서버는 이 값을 기존 카운트에 **더한다**. */
  quantity: number;
}

/** POST /stocktaking/scan-product — 증가 연산. 응답 countedQuantity 는 갱신 후 절대값. */
export function useScanProduct() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScanProductInput) =>
      api.request<ScanProductResult>({
        method: 'POST',
        path: '/stocktaking/scan-product',
        body: input,
      }),
    onSuccess: (_data, input) => invalidateSession(qc, input.sessionId),
  });
}

export interface UpdateCountInput {
  sessionId: string;
  lineId: string;
  /** 절대값 세팅(정정용). scan-product 의 증가 연산과 다르다. */
  countedQuantity: number;
  notes?: string;
}

/** PUT /stocktaking/lines/:lineId/count */
export function useUpdateCount() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCountInput) =>
      api.request<ScanProductResult>({
        method: 'PUT',
        path: `/stocktaking/lines/${input.lineId}/count`,
        body: { countedQuantity: input.countedQuantity, notes: input.notes },
      }),
    onSuccess: (_data, input) => invalidateSession(qc, input.sessionId),
  });
}

/** POST /stocktaking/sessions/:id/generate-adjustments — dry-run 미리보기(영속 없음). */
export function useGenerateAdjustments() {
  const api = useApiClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<GenerateAdjustmentsResult>({
        method: 'POST',
        path: `/stocktaking/sessions/${sessionId}/generate-adjustments`,
        body: {},
      }),
  });
}

/** POST /stocktaking/sessions/:id/complete — 원장에 조정을 원자 적용하고 종결한다. */
export function useCompleteSession() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.request<unknown>({ method: 'POST', path: `/stocktaking/sessions/${sessionId}/complete` }),
    onSuccess: (_data, sessionId) => {
      invalidateList(qc);
      invalidateSession(qc, sessionId);
      void qc.invalidateQueries({ queryKey: ['stocktaking-variances', sessionId] });
      // 원장이 실제로 움직였으므로 재고 화면도 새로 읽어야 한다.
      void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
      void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
    },
  });
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npx vitest run src/domains/stocktaking/mutations.test.tsx`
Expected: PASS (8 tests)

```bash
git add src/domains/stocktaking/mutations.ts src/domains/stocktaking/mutations.test.tsx
git commit -m "feat(warehouse-app): 실사 mutation 훅 8종

scan-product 는 증가, updateCount 는 절대값 세팅 — 두 연산의 차이를
타입 주석으로 못박았다. complete 는 원장을 실제로 움직이므로 재고 쿼리까지
무효화한다. generate-adjustments 는 dry-run 이라 무효화하지 않는다."
```

---

### Task 16: `SessionListScreen` + `/stocktaking` 라우트

**Files:**
- Create: `src/domains/stocktaking/SessionListScreen.tsx`
- Create: `src/domains/stocktaking/SessionListScreen.test.tsx`
- Create: `src/app/routes/StocktakingRoute.tsx`
- Modify: `src/app/routeTree.tsx` (`stocktakingRoute` 스텁 교체)

**Interfaces:**
- Consumes: Task 14 `useStocktakingSessions`, Task 15 `useCreateSession`·`useStartSession`·`useCancelSession`, Task 7 `useWarehouse`, Task 8 `WarehousePicker`, Task 6 `ScreenHeader`·`ConfirmDialog`, Task 5 `errorMessage`
- Produces: `SessionListScreen()` — `/stocktaking/$sessionId`로 이동하는 진입점. Task 17이 그 목적지를 만든다.

- [ ] **Step 1: 실패 테스트**

Create `src/domains/stocktaking/SessionListScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SessionListScreen } from './SessionListScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

const SESSIONS = [
  {
    id: 's-run',
    warehouseId: 'w-1',
    sessionName: '진행중 실사',
    status: 'in_progress',
    notes: null,
    createdAt: '2026-07-23T00:00:00Z',
    startedAt: '2026-07-23T01:00:00Z',
    completedAt: null,
  },
  {
    id: 's-draft',
    warehouseId: 'w-1',
    sessionName: '대기 실사',
    status: 'draft',
    notes: null,
    createdAt: '2026-07-22T00:00:00Z',
    startedAt: null,
    completedAt: null,
  },
];

function renderScreen(calls: Call[], withWarehouse = true) {
  const client: ApiClient = {
    request: (async (opts: Call) => {
      calls.push(opts);
      if (opts.path.startsWith('/stocktaking/sessions?')) return { data: SESSIONS, total: 2 };
      if (opts.path === '/stocktaking/sessions') return { ...SESSIONS[1], id: 's-new' };
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs(
    withWarehouse ? { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) } : {}
  );
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: SessionListScreen,
  });
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking/$sessionId',
    component: () => <div>카운트화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, detail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('SessionListScreen', () => {
  it('창고 미설정이면 창고 선택을 요구한다', async () => {
    renderScreen([], false);
    expect(await screen.findByText(/창고를 먼저 선택/)).toBeInTheDocument();
  });

  it('세션 목록을 상태와 함께 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('진행중 실사')).toBeInTheDocument();
    expect(screen.getByText('대기 실사')).toBeInTheDocument();
    expect(screen.getAllByText('진행중').length).toBeGreaterThan(0);
  });

  it('진행중 세션을 탭하면 카운트 화면으로 간다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: /진행중 실사/ }));
    expect(await screen.findByText('카운트화면')).toBeInTheDocument();
  });

  it('대기 세션을 탭하면 start 후 카운트 화면으로 간다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: /대기 실사/ }));
    expect(await screen.findByText('카운트화면')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-draft/start')).toBe(true);
  });

  it('새 실사는 생성 → 시작 → 이동을 잇는다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(await screen.findByRole('button', { name: '+ 새 실사' }));
    await userEvent.click(screen.getByRole('button', { name: '시작' }));

    expect(await screen.findByText('카운트화면')).toBeInTheDocument();
    const create = calls.find((c) => c.path === '/stocktaking/sessions' && c.method === 'POST');
    expect(create?.body).toMatchObject({ warehouseId: 'w-1' });
    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-new/start')).toBe(true);
  });

  it('진행중 세션은 취소할 수 있다 (확인 후)', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(await screen.findByRole('button', { name: '진행중 실사 취소' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '실사 취소' }));

    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-run/cancel')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/stocktaking/SessionListScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./SessionListScreen"`

- [ ] **Step 3: 구현**

Create `src/domains/stocktaking/SessionListScreen.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { useStocktakingSessions } from './queries';
import { useCreateSession, useStartSession, useCancelSession } from './mutations';
import type { StocktakingSession, StocktakingStatus } from './types';

const STATUS_LABEL: Record<StocktakingStatus, string> = {
  draft: '대기',
  in_progress: '진행중',
  completed: '완료',
  cancelled: '취소됨',
};

const STATUS_CLASS: Record<StocktakingStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

/** 오늘 날짜를 기본 세션명으로. 현장에서 타이핑을 최소화한다. */
function defaultSessionName(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} 실사`;
}

export function SessionListScreen() {
  const navigate = useNavigate();
  const { warehouseId, isSet } = useWarehouse();
  const sessions = useStocktakingSessions(warehouseId);
  const create = useCreateSession();
  const start = useStartSession();
  const cancel = useCancelSession();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState(defaultSessionName);
  const [cancelTarget, setCancelTarget] = useState<StocktakingSession | null>(null);

  function goToSession(sessionId: string) {
    void navigate({ to: '/stocktaking/$sessionId', params: { sessionId } });
  }

  async function open(s: StocktakingSession) {
    if (s.status === 'draft') {
      await start.mutateAsync(s.id);
    }
    goToSession(s.id);
  }

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="실사" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  const list = sessions.data?.data ?? [];

  return (
    <div className="space-y-4">
      <ScreenHeader title="실사" backTo="/" />

      {creating ? (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <label htmlFor="session-name" className="block text-sm font-medium text-gray-700">
            실사 이름
          </label>
          <input
            id="session-name"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              onClick={() => setCreating(false)}
            >
              그만두기
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={newName.trim().length === 0 || create.isPending || start.isPending}
              onClick={async () => {
                if (!warehouseId) return;
                const created = await create.mutateAsync({
                  warehouseId,
                  sessionName: newName.trim(),
                });
                await start.mutateAsync(created.id);
                setCreating(false);
                goToSession(created.id);
              }}
            >
              시작
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" className="w-full py-3" onClick={() => setCreating(true)}>
          + 새 실사
        </Button>
      )}

      {sessions.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(sessions.error, 'stocktaking')}
        </p>
      ) : null}
      {create.isError || start.isError || cancel.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(create.error ?? start.error ?? cancel.error, 'stocktaking')}
        </p>
      ) : null}

      {sessions.isLoading ? <p className="text-sm text-gray-500">불러오는 중…</p> : null}

      {!sessions.isLoading && list.length === 0 ? (
        <p className="text-sm text-gray-500">이 창고에 실사 기록이 없어요.</p>
      ) : null}

      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} className="rounded-lg border border-gray-200 bg-white">
            <button
              type="button"
              className="flex w-full items-center gap-3 p-3 text-left active:bg-gray-50"
              onClick={() => void open(s)}
            >
              <span className="flex-1">
                <span className="block font-semibold text-gray-800">{s.sessionName}</span>
                <span className="block text-xs text-gray-500">
                  {new Date(s.createdAt).toLocaleDateString('ko-KR')}
                </span>
              </span>
              <span
                className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS_CLASS[s.status])}
              >
                {STATUS_LABEL[s.status]}
              </span>
            </button>
            {s.status === 'in_progress' ? (
              <div className="border-t border-gray-100 px-3 py-2 text-right">
                <button
                  type="button"
                  className="text-xs text-red-600 underline"
                  onClick={() => setCancelTarget(s)}
                >
                  {s.sessionName} 취소
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="실사 취소"
        message={`"${cancelTarget?.sessionName ?? ''}" 실사를 취소합니다. 센 수량은 원장에 반영되지 않아요.`}
        confirmLabel="실사 취소"
        danger
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => {
          const target = cancelTarget;
          setCancelTarget(null);
          if (target) cancel.mutate(target.id);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/stocktaking/SessionListScreen.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: 라우트를 배선한다**

Create `src/app/routes/StocktakingRoute.tsx`:

```tsx
import { SessionListScreen } from '../../domains/stocktaking/SessionListScreen';

export function StocktakingRoute() {
  return <SessionListScreen />;
}
```

`src/app/routeTree.tsx`에서 `stocktakingRoute`를 교체하고, 화면이 이동하는 `/stocktaking/$sessionId`를 **지금 스텁으로 등록한다**(Task 17 이 component 만 갈아끼운다). 이유는 Task 11 과 같다 — 라우트가 없으면 `tsc -b`가 깨져 이 태스크가 스스로 초록일 수 없다:

```tsx
const stocktakingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking',
  component: StocktakingRoute,
});
const stocktakingSessionRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking/$sessionId',
  component: () => <PlaceholderScreen title="실사 카운트" note="다음 태스크에서 구현됩니다." />,
});
```

상단에 `import { StocktakingRoute } from './routes/StocktakingRoute';`를 추가하고, `addChildren` 목록에 `stocktakingSessionRoute`를 넣는다.

- [ ] **Step 6: 커밋**

Run:
```bash
npx vitest run src/app/
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/stocktaking/SessionListScreen.tsx src/domains/stocktaking/SessionListScreen.test.tsx \
        src/app/routes/StocktakingRoute.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 실사 세션 목록 화면

새 실사(생성→시작→진입)와 기존 세션 재진입(대기면 start 후). 진행중
세션은 확인 다이얼로그를 거쳐 취소할 수 있다."
```

---

### Task 17: `SessionCountScreen` + `/stocktaking/$sessionId` 라우트

핵심 화면이다. 두 모드(로케이션 대기 ↔ 위치 카운트)를 오간다.

**Files:**
- Create: `src/domains/stocktaking/SessionCountScreen.tsx`
- Create: `src/domains/stocktaking/SessionCountScreen.test.tsx`
- Create: `src/app/routes/StocktakingSessionRoute.tsx`
- Modify: `src/app/routeTree.tsx`

**Interfaces:**
- Consumes: Task 14 `useStocktakingSession`, Task 15 `useScanLocation`·`useScanProduct`·`useUpdateCount`, Task 6 `ScreenHeader`·`NumberPad`·`ConfirmDialog`, `useScanner`, Task 5 `errorMessage`
- Produces: `SessionCountScreen({ sessionId }: { sessionId: string })`. `/stocktaking/$sessionId/variances`로 이동하는 진입점 — Task 18이 그 목적지를 만든다.

**동작 규약 (구현 시 반드시 지킬 것):**
- `scan-location` 응답이 그 위치 화면의 **유일한 원천**이다. 로컬 낙관적 갱신을 하지 않는다.
- `scan-product` 응답의 `countedQuantity`는 **갱신 후 절대값**이므로 그 값으로 해당 라인을 덮어쓴다.
- 수량 직접 입력은 `updateCount`(절대값 세팅)를 쓴다. `scan-product`(증가)와 섞지 않는다.

- [ ] **Step 1: 실패 테스트**

Create `src/domains/stocktaking/SessionCountScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SessionCountScreen } from './SessionCountScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

const DETAIL = {
  id: 's-1',
  warehouseId: 'w-1',
  sessionName: '2026-07-23 실사',
  status: 'in_progress',
  notes: null,
  createdAt: '2026-07-23T00:00:00Z',
  startedAt: '2026-07-23T01:00:00Z',
  completedAt: null,
  progress: { total: 3, counted: 1 },
  lines: [],
};

const SCAN_LOCATION = {
  locationId: 'l-1',
  locationCode: 'A-01-02',
  expectedItems: [
    {
      lineId: 'line-1',
      skuId: 'sku-1',
      skuName: '코튼셔츠',
      skuCode: 'CT-001',
      barcode: '8801',
      expectedQuantity: 6,
      countedQuantity: null,
      status: 'pending',
    },
    {
      lineId: 'line-2',
      skuId: 'sku-2',
      skuName: '리넨셔츠',
      skuCode: 'LN-002',
      barcode: '8802',
      expectedQuantity: 2,
      countedQuantity: 2,
      status: 'counted',
    },
  ],
};

function Emitter({ code }: { code: string }) {
  const bus = useScanBus();
  return <button onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>스캔:{code}</button>;
}

function renderScreen(calls: Call[]) {
  const client: ApiClient = {
    request: (async (opts: Call) => {
      calls.push(opts);
      if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
      if (opts.path === '/stocktaking/scan-location') return SCAN_LOCATION;
      if (opts.path === '/stocktaking/scan-product') {
        return { lineId: 'line-1', skuId: 'sku-1', countedQuantity: 5, expectedQuantity: 6, variance: -1 };
      }
      if (opts.path === '/stocktaking/lines/line-1/count') {
        const body = opts.body as { countedQuantity: number };
        return {
          lineId: 'line-1',
          skuId: 'sku-1',
          countedQuantity: body.countedQuantity,
          expectedQuantity: 6,
          variance: body.countedQuantity - 6,
        };
      }
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <SessionCountScreen sessionId="s-1" />
        <Emitter code="A-01-02" />
        <Emitter code="8801" />
      </>
    ),
  });
  const variances = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking/$sessionId/variances',
    component: () => <div>차이화면</div>,
  });
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking',
    component: () => <div>세션목록</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, variances, list]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('SessionCountScreen', () => {
  it('로케이션 대기 모드로 시작하고 진행률을 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText(/로케이션 바코드를 스캔/)).toBeInTheDocument();
    expect(await screen.findByTestId('progress')).toHaveTextContent('1 / 3');
  });

  it('로케이션 스캔이 그 위치의 라인을 띄운다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText('리넨셔츠')).toBeInTheDocument();
    const scan = calls.find((c) => c.path === '/stocktaking/scan-location');
    expect(scan?.body).toMatchObject({ sessionId: 's-1', locationBarcode: 'A-01-02' });
  });

  it('이미 센 라인은 저장된 카운트를 그대로 보여준다 (이어하기)', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));
    expect(await screen.findByTestId('count-line-2')).toHaveTextContent('2');
    expect(screen.getByTestId('count-line-1')).toHaveTextContent('—');
  });

  it('상품 스캔은 응답의 절대 카운트로 라인을 덮어쓴다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));

    await userEvent.click(await screen.findByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByTestId('count-line-1')).toHaveTextContent('5');
    const scan = calls.find((c) => c.path === '/stocktaking/scan-product');
    expect(scan?.body).toMatchObject({
      sessionId: 's-1',
      locationId: 'l-1',
      productBarcode: '8801',
      quantity: 1,
    });
  });

  it('수량 직접 입력은 updateCount 로 절대값을 세팅한다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));

    await userEvent.click(await screen.findByRole('button', { name: '코튼셔츠 수량 입력' }));
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    const update = calls.find((c) => c.path === '/stocktaking/lines/line-1/count');
    expect(update?.method).toBe('PUT');
    expect(update?.body).toMatchObject({ countedQuantity: 12 });
    expect(await screen.findByTestId('count-line-1')).toHaveTextContent('12');
  });

  it('다른 로케이션 버튼이 대기 모드로 되돌린다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));
    await userEvent.click(await screen.findByRole('button', { name: '다른 로케이션' }));
    expect(await screen.findByText(/로케이션 바코드를 스캔/)).toBeInTheDocument();
  });

  it('차이 확인으로 이동한다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: /차이 확인/ }));
    expect(await screen.findByText('차이화면')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/stocktaking/SessionCountScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./SessionCountScreen"`

- [ ] **Step 3: 구현**

Create `src/domains/stocktaking/SessionCountScreen.tsx`:

```tsx
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { NumberPad } from '../../core/design/NumberPad';
import { cn } from '../../core/design/cn';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useStocktakingSession } from './queries';
import { useScanLocation, useScanProduct, useUpdateCount } from './mutations';
import type { ScanLocationItem, ScanLocationResult } from './types';

interface EditingLine {
  lineId: string;
  skuName: string;
  value: number;
}

export function SessionCountScreen({ sessionId }: { sessionId: string }) {
  const detail = useStocktakingSession(sessionId);
  const scanLocation = useScanLocation();
  const scanProduct = useScanProduct();
  const updateCount = useUpdateCount();

  /** 현재 위치의 화면 상태. scan-location 응답이 유일한 원천이다. */
  const [place, setPlace] = useState<ScanLocationResult | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [editing, setEditing] = useState<EditingLine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 서버가 준 절대 카운트로 라인 하나를 덮어쓴다. 낙관적 계산을 하지 않는다. */
  function applyCount(lineId: string, countedQuantity: number) {
    setPlace((prev) =>
      prev
        ? {
            ...prev,
            expectedItems: prev.expectedItems.map((i) =>
              i.lineId === lineId ? { ...i, countedQuantity, status: 'counted' } : i
            ),
          }
        : prev
    );
  }

  async function enterLocation(code: string) {
    setNotice(null);
    try {
      const result = await scanLocation.mutateAsync({ sessionId, locationBarcode: code });
      setPlace(result);
      setManualCode('');
    } catch (e) {
      setNotice(errorMessage(e, 'location'));
    }
  }

  async function countProduct(barcode: string) {
    if (!place) return;
    setNotice(null);
    try {
      const result = await scanProduct.mutateAsync({
        sessionId,
        locationId: place.locationId,
        productBarcode: barcode,
        quantity: 1,
      });
      // 응답에 없던 라인(미기대 항목)이면 로케이션을 다시 읽어 목록에 넣는다.
      const known = place.expectedItems.some((i) => i.lineId === result.lineId);
      if (known) {
        applyCount(result.lineId, result.countedQuantity);
      } else {
        await enterLocation(place.locationCode);
      }
    } catch (e) {
      setNotice(errorMessage(e, 'barcode'));
    }
  }

  // 위치가 정해지기 전엔 로케이션 바코드를, 정해진 뒤엔 상품 바코드를 기대한다.
  useScanner((e) => {
    if (place) void countProduct(e.code);
    else void enterLocation(e.code);
  });

  const progress = detail.data?.progress;

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={detail.data?.sessionName ?? '실사'}
        backTo="/stocktaking"
        right={
          progress ? (
            <span data-testid="progress">
              {progress.counted} / {progress.total}
            </span>
          ) : null
        }
      />

      {detail.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(detail.error, 'stocktaking')}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-amber-700">
          {notice}
        </p>
      ) : null}

      {place === null ? (
        <section className="space-y-3">
          <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50 p-8 text-center">
            <p className="text-base font-semibold text-blue-800">로케이션 바코드를 스캔하세요</p>
            <p className="mt-1 text-xs text-blue-700">스캔하면 그 위치의 상품이 나와요.</p>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (manualCode.trim()) void enterLocation(manualCode.trim());
            }}
          >
            <label htmlFor="loc-manual" className="sr-only">
              로케이션 코드 직접 입력
            </label>
            <input
              id="loc-manual"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              placeholder="코드 직접 입력"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
            />
            <Button type="submit" disabled={scanLocation.isPending}>
              열기
            </Button>
          </form>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 rounded-lg border border-blue-500 bg-blue-50 px-3 py-2 font-semibold text-blue-800">
              {place.locationCode}
            </span>
            <Button
              type="button"
              className="border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
              onClick={() => setPlace(null)}
            >
              다른 로케이션
            </Button>
          </div>

          <p className="text-xs text-gray-500">
            상품 바코드를 스캔하면 1개씩 올라가요. 박스 단위는 수량 입력을 쓰세요.
          </p>

          <ul className="space-y-2">
            {place.expectedItems.map((item) => (
              <LineRow
                key={item.lineId}
                item={item}
                onEdit={() =>
                  setEditing({
                    lineId: item.lineId,
                    skuName: item.skuName,
                    value: item.countedQuantity ?? 0,
                  })
                }
              />
            ))}
          </ul>
        </section>
      )}

      <Link to="/stocktaking/$sessionId/variances" params={{ sessionId }}>
        <Button className="w-full py-3">차이 확인 →</Button>
      </Link>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${editing.skuName} 수량`}
            className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-lg"
          >
            <h2 className="text-base font-semibold text-gray-900">{editing.skuName}</h2>
            <div className="rounded-lg border border-gray-200 p-3 text-center text-2xl font-semibold text-gray-900">
              {editing.value}
            </div>
            <NumberPad
              value={editing.value}
              onChange={(v) => setEditing((prev) => (prev ? { ...prev, value: v } : prev))}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
                onClick={() => setEditing(null)}
              >
                취소
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={updateCount.isPending}
                onClick={async () => {
                  const target = editing;
                  setEditing(null);
                  if (!target) return;
                  try {
                    const result = await updateCount.mutateAsync({
                      sessionId,
                      lineId: target.lineId,
                      countedQuantity: target.value,
                    });
                    applyCount(result.lineId, result.countedQuantity);
                  } catch (e) {
                    setNotice(errorMessage(e, 'stocktaking'));
                  }
                }}
              >
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LineRow({ item, onEdit }: { item: ScanLocationItem; onEdit: () => void }) {
  const counted = item.countedQuantity;
  const diff = counted === null ? null : counted - item.expectedQuantity;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <span className="flex-1">
        <span className="block font-medium text-gray-800">{item.skuName}</span>
        <span className="block font-mono text-xs text-gray-500">{item.skuCode}</span>
      </span>
      <span className="text-center">
        <span className="block text-xs text-gray-500">예상</span>
        <span className="block text-sm text-gray-700">{item.expectedQuantity}</span>
      </span>
      <span className="text-center">
        <span className="block text-xs text-gray-500">카운트</span>
        <span
          data-testid={`count-${item.lineId}`}
          className={cn(
            'block text-lg font-semibold',
            counted === null && 'text-gray-400',
            diff !== null && diff === 0 && 'text-gray-900',
            diff !== null && diff !== 0 && 'text-red-600'
          )}
        >
          {counted === null ? '—' : counted}
        </span>
      </span>
      <Button
        type="button"
        aria-label={`${item.skuName} 수량 입력`}
        className="px-3 py-1.5 text-xs"
        onClick={onEdit}
      >
        수량
      </Button>
    </li>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/stocktaking/SessionCountScreen.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: 라우트를 배선한다**

Create `src/app/routes/StocktakingSessionRoute.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { SessionCountScreen } from '../../domains/stocktaking/SessionCountScreen';

export function StocktakingSessionRoute() {
  const { sessionId } = useParams({ strict: false });
  return <SessionCountScreen sessionId={sessionId ?? ''} />;
}
```

`stocktakingSessionRoute`는 Task 16 에서 스텁으로 등록돼 있다. **component 만 갈아끼우고**, 화면이 이동하는 `/stocktaking/$sessionId/variances`를 지금 스텁으로 등록한다(Task 18 이 갈아끼운다):

```tsx
const stocktakingSessionRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking/$sessionId',
  component: StocktakingSessionRoute,
});
const stocktakingVariancesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking/$sessionId/variances',
  component: () => <PlaceholderScreen title="차이 확인" note="다음 태스크에서 구현됩니다." />,
});
```

상단에 `import { StocktakingSessionRoute } from './routes/StocktakingSessionRoute';`를 추가하고, `addChildren` 목록에 `stocktakingVariancesRoute`를 넣는다.

- [ ] **Step 6: 커밋**

Run:
```bash
npx vitest run src/app/ src/domains/stocktaking/
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/stocktaking/SessionCountScreen.tsx src/domains/stocktaking/SessionCountScreen.test.tsx \
        src/app/routes/StocktakingSessionRoute.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 실사 카운트 화면 (로케이션 대기 ↔ 위치 카운트)

scan-location 응답이 위치 화면의 유일한 원천이라 재진입 시 이미 센 수량이
항상 보인다(이중 카운트 방지). 상품 스캔은 서버가 준 절대 카운트로
덮어쓰고, 수량 직접 입력은 updateCount(절대 세팅)를 쓴다."
```

---

### Task 18: `VarianceReviewScreen` + `/stocktaking/$sessionId/variances` 라우트

**Files:**
- Create: `src/domains/stocktaking/VarianceReviewScreen.tsx`
- Create: `src/domains/stocktaking/VarianceReviewScreen.test.tsx`
- Create: `src/app/routes/StocktakingVariancesRoute.tsx`
- Modify: `src/app/routeTree.tsx`

**Interfaces:**
- Consumes: Task 14 `useStocktakingSession`·`useStocktakingVariances`, Task 15 `useGenerateAdjustments`·`useCompleteSession`, Task 6 `ScreenHeader`·`ConfirmDialog`, Task 5 `errorMessage`
- Produces: `VarianceReviewScreen({ sessionId }: { sessionId: string })` — Phase 1의 마지막 화면.

**동작 규약:**
- 차이가 **1건 이상**이면 `[조정 미리보기]`를 성공적으로 받기 전까지 `[실사 완료]`는 **비활성**이다.
- 차이가 **0건**이면 적용할 게 없으므로 미리보기 없이 완료를 허용한다.
- 세션이 `completed`/`cancelled`면 읽기 전용 — 미리보기·완료 버튼을 렌더하지 않는다.

- [ ] **Step 1: 실패 테스트**

Create `src/domains/stocktaking/VarianceReviewScreen.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { VarianceReviewScreen } from './VarianceReviewScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

const VARIANCES = [
  {
    lineId: 'line-1',
    locationCode: 'A-01-02',
    skuName: '코튼셔츠',
    skuCode: 'CT-001',
    expectedQuantity: 6,
    countedQuantity: 5,
    variance: -1,
    discrepancyPercent: -16.7,
  },
];

const PREVIEW = {
  adjustmentsCreated: 1,
  eventsPosted: 0,
  message: '1개 조정이 미리보기로 계산되었습니다 (완료 시 적용).',
  preview: [
    {
      lineId: 'line-1',
      skuId: 'sku-1',
      locationId: 'l-1',
      countedQuantity: 5,
      currentOnHand: 6,
      delta: -1,
      adjustmentType: 'DECREASE',
    },
  ],
};

function detailWith(status: string) {
  return {
    id: 's-1',
    warehouseId: 'w-1',
    sessionName: '2026-07-23 실사',
    status,
    notes: null,
    createdAt: '2026-07-23T00:00:00Z',
    startedAt: '2026-07-23T01:00:00Z',
    completedAt: null,
    progress: { total: 3, counted: 3 },
    lines: [],
  };
}

function renderScreen(
  calls: Call[],
  opts: { status?: string; variances?: unknown[] } = {}
) {
  const status = opts.status ?? 'in_progress';
  const variances = opts.variances ?? VARIANCES;
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path === '/stocktaking/sessions/s-1') return detailWith(status);
      if (o.path === '/stocktaking/sessions/s-1/variances') return variances;
      if (o.path === '/stocktaking/sessions/s-1/generate-adjustments') return PREVIEW;
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <VarianceReviewScreen sessionId="s-1" />,
  });
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking',
    component: () => <div>세션목록</div>,
  });
  const count = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking/$sessionId',
    component: () => <div>카운트화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, list, count]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('VarianceReviewScreen', () => {
  it('차이 목록을 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText('A-01-02')).toBeInTheDocument();
    expect(screen.getByTestId('variance-line-1')).toHaveTextContent('-1');
  });

  it('미리보기 전에는 완료 버튼이 비활성이다', async () => {
    renderScreen([]);
    expect(await screen.findByRole('button', { name: /실사 완료/ })).toBeDisabled();
  });

  it('미리보기를 받으면 완료가 열리고 delta 를 보여준다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: '조정 미리보기' }));

    expect(await screen.findByTestId('preview-line-1')).toHaveTextContent('-1');
    expect(screen.getByText(/현재 6/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();
  });

  it('완료는 확인 다이얼로그를 거쳐 complete 를 부른다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '조정 미리보기' }));
    await userEvent.click(await screen.findByRole('button', { name: /실사 완료/ }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('되돌릴 수 없어요');
    await userEvent.click(screen.getByRole('button', { name: '완료' }));

    expect(calls.some((c) => c.path === '/stocktaking/sessions/s-1/complete')).toBe(true);
    expect(await screen.findByText('세션목록')).toBeInTheDocument();
  });

  it('차이가 0건이면 미리보기 없이 완료할 수 있다', async () => {
    renderScreen([], { variances: [] });
    expect(await screen.findByText(/차이가 없어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /실사 완료/ })).toBeEnabled();
  });

  it('완료된 세션은 읽기 전용이다', async () => {
    renderScreen([], { status: 'completed' });
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '조정 미리보기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /실사 완료/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/domains/stocktaking/VarianceReviewScreen.test.tsx`
Expected: FAIL — `Failed to resolve import "./VarianceReviewScreen"`

- [ ] **Step 3: 구현**

Create `src/domains/stocktaking/VarianceReviewScreen.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { ConfirmDialog } from '../../core/design/ConfirmDialog';
import { cn } from '../../core/design/cn';
import { useStocktakingSession, useStocktakingVariances } from './queries';
import { useGenerateAdjustments, useCompleteSession } from './mutations';
import type { AdjustmentPreview } from './types';

export function VarianceReviewScreen({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const detail = useStocktakingSession(sessionId);
  const variances = useStocktakingVariances(sessionId);
  const generate = useGenerateAdjustments();
  const complete = useCompleteSession();

  const [preview, setPreview] = useState<AdjustmentPreview[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const editable = detail.data?.status === 'in_progress';
  const rows = variances.data ?? [];
  const noVariance = variances.isSuccess && rows.length === 0;
  // 미리보기를 봤거나, 애초에 적용할 차이가 없을 때만 완료를 연다.
  const canComplete = editable && (preview !== null || noVariance);

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="차이 확인"
        backTo="/stocktaking"
        right={detail.data ? <span>{detail.data.sessionName}</span> : null}
      />

      {variances.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(variances.error, 'stocktaking')}
        </p>
      ) : null}
      {generate.isError || complete.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(generate.error ?? complete.error, 'stocktaking')}
        </p>
      ) : null}

      {variances.isLoading ? <p className="text-sm text-gray-500">불러오는 중…</p> : null}

      {noVariance ? (
        <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          차이가 없어요. 적용할 조정이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => (
            <li
              key={v.lineId}
              className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
            >
              <span className="flex-1">
                <span className="block font-medium text-gray-800">{v.skuName}</span>
                <span className="block text-xs text-gray-500">
                  {v.locationCode ?? '위치 미지정'} · {v.skuCode}
                </span>
              </span>
              <span className="text-center">
                <span className="block text-xs text-gray-500">예상</span>
                <span className="block text-sm text-gray-700">{v.expectedQuantity}</span>
              </span>
              <span className="text-center">
                <span className="block text-xs text-gray-500">카운트</span>
                <span className="block text-sm text-gray-700">{v.countedQuantity ?? '—'}</span>
              </span>
              <span
                data-testid={`variance-${v.lineId}`}
                className={cn(
                  'w-12 text-right text-lg font-semibold',
                  (v.variance ?? 0) > 0 ? 'text-green-700' : 'text-red-600'
                )}
              >
                {(v.variance ?? 0) > 0 ? `+${v.variance}` : v.variance}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && !noVariance ? (
        <Button
          type="button"
          className="w-full py-3 border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          disabled={generate.isPending}
          onClick={async () => {
            const result = await generate.mutateAsync(sessionId);
            setPreview(result.preview);
          }}
        >
          조정 미리보기
        </Button>
      ) : null}

      {preview !== null ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">
            적용될 조정 {preview.length}건
          </h2>
          {preview.length === 0 ? (
            <p className="text-sm text-gray-500">적용할 조정이 없어요.</p>
          ) : (
            <ul className="space-y-1">
              {preview.map((p) => (
                <li
                  key={p.lineId}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm"
                >
                  <span className="flex-1 text-gray-700">
                    현재 {p.currentOnHand} → 카운트 {p.countedQuantity}
                  </span>
                  <span
                    data-testid={`preview-${p.lineId}`}
                    className={cn(
                      'font-semibold',
                      p.delta > 0 ? 'text-green-700' : 'text-red-600'
                    )}
                  >
                    {p.delta > 0 ? `+${p.delta}` : p.delta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {editable ? (
        <Button
          type="button"
          className="w-full py-3"
          disabled={!canComplete || complete.isPending}
          onClick={() => setConfirming(true)}
        >
          실사 완료 · 원장 적용
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="실사 완료"
        message={`${preview?.length ?? 0}건의 조정이 원장에 적용돼요. 되돌릴 수 없어요.`}
        confirmLabel="완료"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          complete.mutate(sessionId, {
            onSuccess: () => void navigate({ to: '/stocktaking' }),
          });
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/domains/stocktaking/VarianceReviewScreen.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: 라우트를 배선한다**

Create `src/app/routes/StocktakingVariancesRoute.tsx`:

```tsx
import { useParams } from '@tanstack/react-router';
import { VarianceReviewScreen } from '../../domains/stocktaking/VarianceReviewScreen';

export function StocktakingVariancesRoute() {
  const { sessionId } = useParams({ strict: false });
  return <VarianceReviewScreen sessionId={sessionId ?? ''} />;
}
```

`stocktakingVariancesRoute`는 Task 17 에서 스텁으로 등록돼 있다. **component 만 갈아끼운다**:

```tsx
const stocktakingVariancesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/stocktaking/$sessionId/variances',
  component: StocktakingVariancesRoute,
});
```

상단에 `import { StocktakingVariancesRoute } from './routes/StocktakingVariancesRoute';`를 추가한다.

- [ ] **Step 6: 전체 검증 + 커밋**

Run:
```bash
npm test
npm run build
```
Expected: 둘 다 통과

```bash
git add src/domains/stocktaking/VarianceReviewScreen.tsx \
        src/domains/stocktaking/VarianceReviewScreen.test.tsx \
        src/app/routes/StocktakingVariancesRoute.tsx src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 차이 확인 + 실사 완료 화면

차이가 있으면 generate-adjustments(dry-run) 미리보기를 받기 전까지 완료를
잠근다. 차이 0건이면 적용할 게 없어 바로 완료 허용. 완료/취소된 세션은
읽기 전용."
```

---

# Part E — 마무리

### Task 19: 스텁 정리 · 전체 검증 · 문서 갱신

**Files:**
- Modify: `src/app/routeTree.tsx` (`/movement` note 문구)
- Modify: `docs/superpowers/specs/2026-07-23-warehouse-app-phase1-adjust-stocktaking-design.md` (상태 줄)

- [ ] **Step 1: `/movement` 스텁 문구를 정정한다**

`src/app/routeTree.tsx`에서 `movementRoute`의 note를 바꾼다 — 이동은 Phase 1 정의에 없어 후속으로 미뤘다(설계 §2 비목표):

```tsx
const movementRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/movement',
  component: () => <PlaceholderScreen title="이동" note="후속 Phase에서 구현됩니다." />,
});
```

`/inventory/$sku`·`/stocktaking`·`/settings` 스텁이 모두 실제 화면으로 교체됐는지 확인한다. `PlaceholderScreen`을 아직 쓰는 라우트는 `/shipments`(후속) · `/movement`(후속) · `/inbound`(Phase 2) · `/picking`(Phase 3) · `/packing`(Phase 4) 다섯 개여야 한다.

- [ ] **Step 2: 프론트 전체 검증**

Run (`native/warehouse-app`):
```bash
npm test
npm run build
npm run lint
```
Expected: 테스트 전부 통과 · 빌드 exit 0 · lint에 **이번에 추가한 파일의 신규 error 없음**.

> lint는 레포 상시 debt가 있을 수 있다. 판단 기준은 "이번 변경 파일에서 새로 생긴 error"뿐이다. 기존 파일의 기존 경고는 고치지 않는다.

- [ ] **Step 3: 백엔드 전체 검증**

Run (워크트리 루트):
```bash
npx nest build core
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "inventory.*integration"
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- stocktaking
```
Expected: 빌드 exit 0.

⚠️ **완료조건은 "전부 green" 이 아니다.** `develop` 자체에서 inventory 통합 스위트 **18개 중 6개 / 78개 테스트 중 15개가 이미 실패**한다(컨트롤러가 develop 체크아웃에서 독립 측정). 원인은 테스트 시드가 `ck_locations_type` 체크 제약을 위반하는 것 — `locationType` 누락 또는 rack/bin 없이 `'standard'` 지정. 우리 브랜치와 무관하며 별도 이슈로 분리하기로 결정됐다.

따라서 판정 기준은:
1. **이 브랜치가 추가하거나 변경한 스펙은 전부 green** — `stock-projection-by-location` · `stocktaking-session-detail` · `stocktaking-scan-location` · `adjust-idempotency` · `stocktaking-complete` · `stocktaking-state-machine`
2. **develop 기존 실패 목록이 늘지 않았다** — 실패 스위트 수와 이름이 develop 측정치와 동일해야 한다. 늘었다면 그건 우리 회귀다.

- [ ] **Step 4: 수동 검증 체크리스트를 기록한다**

아래를 실행 결과와 함께 최종 보고에 포함한다. **실행하지 않은 항목은 "미실행"이라고 적는다 — 통과했다고 쓰지 않는다.**

기기 스모크(개발 머신 또는 실기기, `npm run tauri:dev:live`):
1. 로그인 → 허브 상단에 "창고 미설정" 칩이 보인다
2. 칩 탭 → 설정 → 창고 선택 → 칩에 창고명이 뜬다
3. 재고조회에서 HID 리더기로 상품 바코드 스캔 → 상세로 직행
4. 상세에 위치별 재고가 로케이션 코드와 함께 나온다
5. 조정: 로케이션 스캔 → delta −1 → 사유 "파손" → 확인 → 상세의 수량이 줄어든다
6. 실사: 새 실사 → 로케이션 스캔 → 상품 스캔 2회 → 카운트 2 → 앱 재시작 → 같은 세션·같은 로케이션 재스캔 시 **카운트 2가 그대로 보인다** (이어하기 회귀 테스트)
7. 차이 확인 → 미리보기 → 완료 → admin-web 재고 화면에서 원장 반영 확인

- [ ] **Step 5: 설계 문서 상태를 갱신한다**

`docs/superpowers/specs/2026-07-23-warehouse-app-phase1-adjust-stocktaking-design.md`의 상태 줄을 바꾼다:

```markdown
- 상태: 구현 완료 (플랜 `docs/superpowers/plans/2026-07-23-warehouse-app-phase1-adjust-stocktaking.md`)
```

- [ ] **Step 6: 커밋**

```bash
git add src/app/routeTree.tsx
git add ../../docs/superpowers/specs/2026-07-23-warehouse-app-phase1-adjust-stocktaking-design.md
git commit -m "chore(warehouse-app): Phase 1 마무리 — 이동 스텁 문구 정정 + 설계 상태 갱신

이동(/movement)은 마스터 설계 §11 Phase 1 정의에 없어 후속으로 미뤘다."
```

---

## 완료 조건

- [ ] 백엔드 4건이 전부 additive로 들어갔고 마이그레이션 파일이 **하나도 생기지 않았다**
- [ ] `npm test`(프론트) · `npx nest build core` green. 백엔드 통합은 **이 브랜치가 추가·변경한 스펙 전부 green + develop 기존 실패 목록 불변**(develop 자체가 6 스위트 실패 중 — Task 19 §Step 3)
- [ ] `/inventory/$sku` · `/inventory/$sku/adjust` · `/stocktaking` · `/stocktaking/$sessionId` · `/stocktaking/$sessionId/variances` · `/settings` 여섯 라우트가 실제 화면이다
- [ ] 조정은 로케이션 없이 보낼 수 없고, delta 0을 보낼 수 없고, 사유 없이 보낼 수 없다
- [ ] 실사 완료는 차이가 있을 때 미리보기 없이 눌릴 수 없다
- [ ] 앱 재시작 후 실사 세션 재진입 시 이미 센 수량이 보인다 (수동 스모크 6번)
