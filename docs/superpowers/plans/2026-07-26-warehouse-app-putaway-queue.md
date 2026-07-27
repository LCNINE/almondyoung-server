# 적치 대기 큐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고 직후 화면을 벗어난 미적치 라인을 `native/warehouse-app` 에서 다시 찾아 적치할 수 있게 한다.

**Architecture:** core 에 전용 조회 리더와 엔드포인트(`GET /inbound/putaway/pending`)를 신설해 "출발지가 시스템 로케이션이고 미적치 잔량이 남은 입고 라인"만 내려준다. 앱은 그 목록을 큐 화면으로 렌더하고, 상품 바코드 스캔으로 큐를 좁혀 기존 `PutawaySheet` 를 연다. 시트는 부분 적치를 받도록 열되 멱등키 회전 조건에 수량을 포함시킨다.

**Tech Stack:** NestJS + Drizzle ORM (core), React 19 + TanStack Query/Router + Vitest + Testing Library (warehouse-app), Jest (core 통합 스펙)

**Spec:** `docs/superpowers/specs/2026-07-26-warehouse-app-putaway-queue-design.md`

## Global Constraints

- **인벤토리 쿼리 규칙**: `db.query.*` 금지, `with` 관계 금지, `any`/`as` 캐스팅 금지. `trx.select().from().innerJoin().where().orderBy()` 사용.
- **DB 주입**: `@InjectTypedDb<typeof wmsSchema>()`. `@Inject('DB')` 금지.
- **트랜잭션**: 공개 메서드는 `tx?: DbTx` 를 마지막 파라미터로. `this.dbService.run(fn, tx)` 단일 러너 사용. 클래스별 `inTx` 헬퍼 금지.
- **DTO**: `@ApiProperty({ type: 'object' })` 금지 — 중첩이 필요하면 별도 클래스.
- **마이그레이션 0건.** 이 작업은 스키마를 건드리지 않는다. `npm run db:generate:*` 를 부르지 말 것.
- **통합 스펙은 `DATABASE_URL` 이 없으면 조용히 초록이다** (`describeIfDb`). 반드시 `DATABASE_URL` 을 주고 돌린다.
- **커밋 메시지 마지막 줄**: `Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD`
- **브랜치**: `feat/warehouse-app-putaway-queue` (이미 생성됨, `origin/develop` `71166cd12` 기반)
- **검증 스코프**: `npm run lint` 는 repo 상시 debt 가 있다. 변경한 파일에 신규 error 가 없는지만 본다.

---

### Task 1: 적치 대기 조회 리더

**Files:**
- Create: `apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.integration.spec.ts`

**Interfaces:**
- Consumes: `makeInboundService(db)` · `inRollbackTx(db, fn)` (`__fixtures__/inbound-harness.ts`), `wmsTables` · `wmsSchema` · `DbTx` (`schema/inventory.schema.ts`)
- Produces: `class InboundPutawayReader` with
  `listPending(params: { warehouseId: string; days?: number }, tx?: DbTx): Promise<{ total: number; items: Array<{ lineId: string; skuId: string; skuName: string; skuCode: string; pendingQty: number; originLocationId: string; originLocationCode: string; receivedAt: string }> }>`
  및 테스트 헬퍼 `makeInboundPutawayReader(database)` (harness 에 추가)

- [ ] **Step 1: 하네스에 리더 팩토리를 추가한다**

`apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts` 의 `makeInboundService` 함수 **바로 아래**에 추가:

```typescript
export function makeInboundPutawayReader(database: Database): InboundPutawayReader {
  return new InboundPutawayReader(dbServiceFor(database));
}
```

같은 파일 상단 import 에 추가:

```typescript
import { InboundPutawayReader } from '../inbound-putaway.reader';
```

- [ ] **Step 2: 실패하는 통합 스펙을 쓴다**

`apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.integration.spec.ts`:

```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundService } from './inbound.service';
import { InboundPutawayReader } from './inbound-putaway.reader';
import {
  Database,
  inRollbackTx,
  makeInboundPutawayReader,
  makeInboundService,
} from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('InboundPutawayReader.listPending (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;
  let reader: InboundPutawayReader;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
    reader = makeInboundPutawayReader(db);
  });

  afterAll(async () => {
    await client.end();
  });

  /** 창고 + SKU 만. 시스템 존은 간편입고가 ensureSystemLocations 로 만든다. */
  async function seed(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `putaway-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `putaway-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: '무선마우스 블랙', code: `PUTAWAY-${suffix}`, holderId: holder.id })
      .returning();
    return { warehouse, sku };
  }

  /**
   * 비시스템 로케이션. zone 타입이면 rack/bin 이 NULL 이어도 ck_locations_type 을
   * 통과하고, is_system=false 라 ck_locations_system_role 도 만족한다.
   */
  async function seedPlainZone(tx: DbTx, warehouseId: string) {
    const [loc] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId,
        code: `A-01-${randomUUID().slice(0, 4)}`,
        locationType: 'zone',
        isSystem: false,
        systemRole: null,
        isActive: true,
      })
      .returning();
    return loc;
  }

  it('시스템 존에 남은 미적치 라인을 잔량과 출발지와 함께 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 20 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        skuId: sku.id,
        skuName: '무선마우스 블랙',
        pendingQty: 20,
        originLocationCode: 'zone-inbound-default',
      });
      expect(typeof result.items[0].receivedAt).toBe('string');
    });
  });

  it('전량 적치된 라인은 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const dest = await seedPlainZone(tx, warehouse.id);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 20 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.putawayFromOrigin(
        {
          lineId: received.lines[0].id,
          toLocationId: dest.id,
          quantity: 20,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.total).toBe(0);
    });
  });

  it('부분 적치 후에는 줄어든 잔량으로 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const dest = await seedPlainZone(tx, warehouse.id);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 50 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.putawayFromOrigin(
        {
          lineId: received.lines[0].id,
          toLocationId: dest.id,
          quantity: 30,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.total).toBe(1);
      expect(result.items[0].pendingQty).toBe(20);
    });
  });

  it('출발지가 비시스템 로케이션이면 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const shelf = await seedPlainZone(tx, warehouse.id);

      await svc.individualInbound(
        {
          warehouseId: warehouse.id,
          skuId: sku.id,
          quantity: 7,
          locationId: shelf.id,
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.total).toBe(0);
    });
  });

  it('회송분은 잔량에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 10 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      await svc.returnInbound(
        { lineId: received.lines[0].id, quantity: 4, idempotencyKey: randomUUID() },
        tx,
      );

      const result = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(result.items[0].pendingQty).toBe(6);
    });
  });

  it('다른 창고의 라인은 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);
      const other = await seed(tx);

      await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 3 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      const result = await reader.listPending({ warehouseId: other.warehouse.id }, tx);
      expect(result.total).toBe(0);
    });
  });

  it('days 필터는 그 기간 밖의 입고를 제외한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouse, sku } = await seed(tx);

      const received = await svc.simpleInbound(
        {
          warehouseId: warehouse.id,
          items: [{ skuId: sku.id, quantity: 5 }],
          idempotencyKey: randomUUID(),
        },
        tx,
      );

      // occurredAt 을 3일 전으로 밀어 rolling 창 밖으로 보낸다.
      // simpleInbound 는 서비스 계층에서 { receipt, lines } 를 돌려준다 —
      // 앱이 보는 HTTP 응답({ id, lines })과 모양이 다르니 헷갈리지 말 것.
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ occurredAt: threeDaysAgo })
        .where(eq(wmsTables.inboundReceipts.id, received.receipt.id));

      const within = await reader.listPending({ warehouseId: warehouse.id, days: 7 }, tx);
      expect(within.total).toBe(1);

      const outside = await reader.listPending({ warehouseId: warehouse.id, days: 1 }, tx);
      expect(outside.total).toBe(0);

      const all = await reader.listPending({ warehouseId: warehouse.id }, tx);
      expect(all.total).toBe(1);
    });
  });
});
```

같은 파일 상단 import 에 `eq` 를 추가한다:

```typescript
import { eq } from 'drizzle-orm';
```

- [ ] **Step 3: 실패를 확인한다**

Run:
```bash
DATABASE_URL="$DATABASE_URL" npx jest --testPathPattern=inbound-putaway.reader.integration --runInBand
```
Expected: FAIL — `Cannot find module './inbound-putaway.reader'`

`DATABASE_URL` 이 비어 있으면 7건 전부 skip 으로 조용히 초록이 된다. 그럴 땐 멈추고 dev DB 접속 문자열을 받아온다.

- [ ] **Step 4: DTO 를 만든다**

리더가 이 타입을 import 하므로 먼저 만든다.

`apps/core/src/modules/inventory/inbound/dto/putaway-pending.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class PutawayPendingItemDto {
  @ApiProperty({ description: '입고 라인 ID' })
  lineId: string;

  @ApiProperty({ description: 'SKU ID' })
  skuId: string;

  @ApiProperty({ description: 'SKU 이름', example: '무선마우스 블랙' })
  skuName: string;

  @ApiProperty({ description: 'SKU 코드', example: 'MOUSE-BK-01' })
  skuCode: string;

  @ApiProperty({ description: '미적치 잔량', example: 20 })
  pendingQty: number;

  @ApiProperty({ description: '출발지 로케이션 ID' })
  originLocationId: string;

  @ApiProperty({ description: '출발지 로케이션 코드', example: 'zone-inbound-default' })
  originLocationCode: string;

  @ApiProperty({ description: '입고 시각 (ISO)', example: '2026-07-26T00:14:00.000Z' })
  receivedAt: string;
}

export class PutawayPendingListDto {
  @ApiProperty({ description: '건수', example: 2 })
  total: number;

  @ApiProperty({ description: '적치 대기 라인', type: [PutawayPendingItemDto] })
  items: PutawayPendingItemDto[];
}
```

- [ ] **Step 5: 리더를 구현한다**

`apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { PutawayPendingListDto } from '../dto/putaway-pending.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 적치 대기 조회. inbound.service.ts 에 두지 않는 이유는 그 파일이 이미 1100줄이
 * 넘고 조회 규칙 위반이 남아 있어서다 — 신규 조회는 리더로 분리한다.
 */
@Injectable()
export class InboundPutawayReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async listPending(
    params: { warehouseId: string; days?: number },
    tx?: DbTx,
  ): Promise<PutawayPendingListDto> {
    const { warehouseId, days } = params;

    return this.dbService.run(async (trx) => {
      // putawayFromOrigin 의 originAvailable 검증식과 같은 식이다(inbound.service.ts:846).
      // 화면이 제안하는 수량과 서버가 허용하는 수량이 어긋날 수 없게 하나로 둔다.
      const pendingQty = sql<number>`(
        ${wmsTables.inboundReceiptLines.quantity}
        - ${wmsTables.inboundReceiptLines.putawayFromOriginQty}
        - ${wmsTables.inboundReceiptLines.returnedQty}
        - ${wmsTables.inboundReceiptLines.canceledQty}
      )`;

      const rows = await trx
        .select({
          lineId: wmsTables.inboundReceiptLines.id,
          skuId: wmsTables.skus.id,
          skuName: wmsTables.skus.name,
          skuCode: wmsTables.skus.code,
          pendingQty,
          originLocationId: wmsTables.locations.id,
          originLocationCode: wmsTables.locations.code,
          receivedAt: wmsTables.inboundReceipts.occurredAt,
        })
        .from(wmsTables.inboundReceiptLines)
        .innerJoin(
          wmsTables.inboundReceipts,
          eq(wmsTables.inboundReceipts.id, wmsTables.inboundReceiptLines.receiptId),
        )
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.inboundReceiptLines.skuId))
        .innerJoin(
          wmsTables.locations,
          eq(wmsTables.locations.id, wmsTables.inboundReceiptLines.originLocationId),
        )
        .where(
          and(
            eq(wmsTables.inboundReceipts.status, 'posted'),
            eq(wmsTables.inboundReceipts.warehouseId, warehouseId),
            // 임시로 쌓아둔 것만 할 일이다. 처음부터 최종 위치로 입고된 라인은 제자리다.
            eq(wmsTables.locations.isSystem, true),
            sql`${pendingQty} > 0`,
            days !== undefined
              ? gte(wmsTables.inboundReceipts.occurredAt, new Date(Date.now() - days * DAY_MS))
              : undefined,
          ),
        )
        .orderBy(asc(wmsTables.inboundReceipts.occurredAt));

      return {
        total: rows.length,
        items: rows.map((row) => ({
          lineId: row.lineId,
          skuId: row.skuId,
          skuName: row.skuName,
          skuCode: row.skuCode,
          pendingQty: Number(row.pendingQty),
          originLocationId: row.originLocationId,
          originLocationCode: row.originLocationCode,
          receivedAt: row.receivedAt.toISOString(),
        })),
      };
    }, tx);
  }
}
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run:
```bash
DATABASE_URL="$DATABASE_URL" npx jest --testPathPattern=inbound-putaway.reader.integration --runInBand
```
Expected: PASS — 7 passed

7건이 아니라 "7 skipped" 로 나오면 `DATABASE_URL` 이 안 걸린 것이다. 초록으로 넘어가지 말 것.

- [ ] **Step 7: 빌드를 확인한다**

Run: `npx nest build core`
Expected: 에러 없이 종료

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.ts \
        apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.integration.spec.ts \
        apps/core/src/modules/inventory/inbound/services/__fixtures__/inbound-harness.ts \
        apps/core/src/modules/inventory/inbound/dto/putaway-pending.dto.ts
git commit -m "feat(core): 적치 대기 라인 조회 리더 추가

출발지가 시스템 로케이션이고 미적치 잔량이 남은 입고 라인만 돌려준다.
잔량 계산식은 putawayFromOrigin 의 originAvailable 검증식과 동일하게 둔다.

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD"
```

---

### Task 2: 엔드포인트 배선

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.ts`
- Modify: `apps/core/src/modules/inventory/inbound/inbound.module.ts`

**Interfaces:**
- Consumes: `InboundPutawayReader.listPending` (Task 1)
- Produces: `GET /inbound/putaway/pending?warehouseId=<uuid>&days=<int>` → `PutawayPendingListDto`

- [ ] **Step 1: 모듈에 리더를 등록한다**

`inbound.module.ts` 를 아래로 교체:

```typescript
import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseOrderCronService } from './services/purchase-order-cron.service';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController, PurchaseOrderController],
  providers: [InboundService, InboundPutawayReader, PurchaseOrderService, PurchaseOrderCronService],
  exports: [InboundService, PurchaseOrderService],
})
export class InboundModule {}
```

- [ ] **Step 2: 컨트롤러에 리더를 주입한다**

`inbound.controllers.ts` 의 생성자에 파라미터를 추가한다. 기존:

```typescript
  constructor(private readonly inboundService: InboundService) {}
```

를 아래로:

```typescript
  constructor(
    private readonly inboundService: InboundService,
    private readonly putawayReader: InboundPutawayReader,
  ) {}
```

상단 import 에 추가:

```typescript
import { InboundPutawayReader } from '../services/inbound-putaway.reader';
import { PutawayPendingListDto } from '../dto/putaway-pending.dto';
```

`BadRequestException` 이 아직 import 되어 있지 않으면 `@nestjs/common` import 목록에 추가한다.

- [ ] **Step 3: 엔드포인트를 추가한다**

`inbound.controllers.ts` 의 `@Post('putaway')` 핸들러 **바로 위**에 삽입:

```typescript
  @Get('putaway/pending')
  @ApiOperation({ summary: '적치 대기 조회 — 시스템 존에 남은 미적치 잔량' })
  @ApiQuery({ name: 'warehouseId', required: true })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '최근 N일 (rolling, now − N×24h). 미지정 시 전체 기간',
  })
  @ApiResponse({ status: 200, type: PutawayPendingListDto })
  async listPutawayPending(
    @Query('warehouseId') warehouseId?: string,
    @Query('days') days?: string,
  ): Promise<PutawayPendingListDto> {
    if (!warehouseId) throw new BadRequestException('warehouseId is required');
    const parsedDays = days === undefined ? undefined : Number(days);
    if (parsedDays !== undefined && (!Number.isInteger(parsedDays) || parsedDays < 1)) {
      throw new BadRequestException('days must be a positive integer');
    }
    return this.putawayReader.listPending({ warehouseId, days: parsedDays });
  }
```

- [ ] **Step 4: 빌드로 배선을 확인한다**

Run: `npx nest build core`
Expected: 에러 없이 종료

빌드는 DI 배선을 검증하지 않는다. 다음 스텝에서 실제로 부팅해 확인한다.

- [ ] **Step 5: 라우트가 실제로 뜨는지 확인한다**

Run:
```bash
npm run start:main:dev
```

부팅 로그에서 아래 줄을 찾는다:
```
Mapped {/inbound/putaway/pending, GET} route
```

`InboundPutawayReader` 의존성 해결 실패(`Nest can't resolve dependencies`)가 나면 Step 1 의 providers 등록이 빠진 것이다. 확인 후 프로세스를 종료한다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.ts \
        apps/core/src/modules/inventory/inbound/inbound.module.ts
git commit -m "feat(core): GET /inbound/putaway/pending 엔드포인트 추가

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD"
```

---

### Task 3: 앱 조회 훅과 캐시 무효화

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/types.ts`
- Modify: `native/warehouse-app/src/domains/inbound/queries.ts`
- Modify: `native/warehouse-app/src/domains/inbound/mutations.ts`
- Test: `native/warehouse-app/src/domains/inbound/queries.test.tsx` (기존 파일에 추가)

**Interfaces:**
- Consumes: `GET /inbound/putaway/pending` (Task 2), `useApiClient()` (`core/data/ApiClientProvider`)
- Produces:
  - `type PutawayDays = 1 | 7 | 'all'`
  - `usePutawayPending(warehouseId: string | null, days: PutawayDays)` → TanStack Query result of `PutawayPendingResult`
  - 쿼리 키 `['putaway-pending', warehouseId, days]`
  - 인터페이스 `PutawayPendingItem` · `PutawayPendingResult` · `PutawayTarget`

- [ ] **Step 1: 실패하는 훅 테스트를 쓴다**

`native/warehouse-app/src/domains/inbound/queries.test.tsx` 파일 끝에 추가:

```tsx
describe('usePutawayPending', () => {
  it('days 를 쿼리스트링에 싣는다', async () => {
    const request = vi.fn(async (_o: { path: string }) => ({ total: 0, items: [] }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => usePutawayPending('w-1', 1), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe(
      '/inbound/putaway/pending?warehouseId=w-1&days=1'
    );
  });

  it("days 가 'all' 이면 파라미터를 빼고 보낸다", async () => {
    const request = vi.fn(async (_o: { path: string }) => ({ total: 0, items: [] }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    const { result } = renderHook(() => usePutawayPending('w-1', 'all'), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request.mock.calls[0][0].path).toBe('/inbound/putaway/pending?warehouseId=w-1');
  });

  it('창고가 없으면 요청하지 않는다', () => {
    const request = vi.fn(async () => ({ total: 0, items: [] }));
    const client: ApiClient = { request: request as unknown as ApiClient['request'] };
    renderHook(() => usePutawayPending(null, 1), { wrapper: wrapperWith(client) });
    expect(request).not.toHaveBeenCalled();
  });
});
```

이 파일에는 이미 `wrapperWith(client)` 헬퍼와 `session` 상수가 있다. import 줄만 넓힌다:

```tsx
import { usePendingPlans, usePutawayPending } from './queries';
```

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound/queries.test.tsx
```
Expected: FAIL — `usePutawayPending` is not exported

- [ ] **Step 3: 타입을 추가한다**

`native/warehouse-app/src/domains/inbound/types.ts` 파일 끝에 추가:

```typescript
/** GET /inbound/putaway/pending 의 items[] 한 행. */
export interface PutawayPendingItem {
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationId: string;
  originLocationCode: string;
  /** ISO 문자열. */
  receivedAt: string;
}

export interface PutawayPendingResult {
  total: number;
  items: PutawayPendingItem[];
}

/**
 * PutawaySheet 의 입력. 입고 직후 화면과 적치 큐가 공유한다.
 * originLocationId 가 선택인 이유: 입고 직후 경로는 그 값을 모른다
 * (ReceiveFromPlanResult·SimpleInboundLine 어느 쪽도 로케이션을 안 돌려준다).
 * 없으면 "출발지를 대상지 후보에서 제외" 가드를 걸지 않는다.
 */
export interface PutawayTarget {
  lineId: string;
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationCode: string;
  originLocationId?: string;
}
```

- [ ] **Step 4: 훅을 구현한다**

`native/warehouse-app/src/domains/inbound/queries.ts` 파일 끝에 추가:

```typescript
/** 큐 기간 필터. 'all' 은 days 파라미터를 아예 안 보낸다. */
export type PutawayDays = 1 | 7 | 'all';

/**
 * GET /inbound/putaway/pending
 *
 * days 는 달력일이 아니라 rolling(now − N×24h)이다 — 야간 조가 자정을 넘겨도
 * 방금 입고한 물건이 큐에서 사라지지 않게.
 */
export function usePutawayPending(warehouseId: string | null, days: PutawayDays) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['putaway-pending', warehouseId, days],
    enabled: warehouseId !== null,
    queryFn: () => {
      const qs = new URLSearchParams({ warehouseId: warehouseId ?? '' });
      if (days !== 'all') qs.set('days', String(days));
      return api.request<PutawayPendingResult>({
        path: `/inbound/putaway/pending?${qs.toString()}`,
      });
    },
  });
}
```

같은 파일 상단 import 에 `PutawayPendingResult` 를 추가한다:

```typescript
import type { PendingPlanListResult, PutawayPendingResult } from './types';
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound/queries.test.tsx
```
Expected: PASS

- [ ] **Step 6: 무효화 목록에 큐를 추가한다**

`native/warehouse-app/src/domains/inbound/mutations.ts` 의 `invalidateAfterLedgerWrite` 를 아래로 교체:

```typescript
function invalidateAfterLedgerWrite(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['inbound-pending'] });
  void qc.invalidateQueries({ queryKey: ['location-contents'] });
  void qc.invalidateQueries({ queryKey: ['sku-warehouse-stock'] });
  void qc.invalidateQueries({ queryKey: ['sku-stock-summary'] });
  // 적치를 건너뛴 라인은 큐에 나타나야 하고, 큐에서 적치한 라인은 사라져야 한다.
  // 한쪽만 갱신하면 두 화면이 서로 다른 사실을 말한다.
  void qc.invalidateQueries({ queryKey: ['putaway-pending'] });
}
```

- [ ] **Step 7: 무효화 회귀 테스트를 추가한다**

`native/warehouse-app/src/domains/inbound/mutations.test.tsx` 파일 끝에 추가:

이 파일에는 이미 무효화를 수집하는 `setup(calls)` 헬퍼가 있다. 그대로 쓴다. `describe('나머지 뮤테이션 경로', ...)` 블록 안에 추가:

```tsx
  it('적치 성공 후 putaway-pending 을 무효화한다', async () => {
    const calls: Call[] = [];
    const { wrapper, invalidated } = setup(calls);
    const { result } = renderHook(() => usePutaway(), { wrapper });

    result.current.mutate({
      lineId: 'ln-1',
      toLocationId: 'loc-1',
      quantity: 3,
      idempotencyKey: 'k-1',
    });

    await waitFor(() => expect(invalidated).toContainEqual(['putaway-pending']));
  });
```

- [ ] **Step 8: 인바운드 도메인 테스트 전체를 돌린다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound
```
Expected: PASS — 기존 테스트 포함 전부 초록

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/types.ts \
        native/warehouse-app/src/domains/inbound/queries.ts \
        native/warehouse-app/src/domains/inbound/queries.test.tsx \
        native/warehouse-app/src/domains/inbound/mutations.ts \
        native/warehouse-app/src/domains/inbound/mutations.test.tsx
git commit -m "feat(warehouse-app): 적치 대기 조회 훅과 캐시 무효화

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD"
```

---

### Task 4: PutawaySheet 을 부분 적치용으로 연다

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/PutawaySheet.tsx`
- Modify: `native/warehouse-app/src/domains/inbound/PutawaySheet.test.tsx`
- Modify: `native/warehouse-app/src/domains/inbound/types.ts` (`FreshLine`)
- Modify: `native/warehouse-app/src/domains/inbound/PlanReceiveScreen.tsx`
- Modify: `native/warehouse-app/src/domains/inbound/QuickInboundScreen.tsx`
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts`

**Interfaces:**
- Consumes: `PutawayTarget` (Task 3), `NumberPad` (`core/design/NumberPad`), `usePutaway` (`./mutations`)
- Produces: `PutawaySheet({ target, warehouseId, lastDest, onDone, onCancel })` — `onDone: (dest: LocationRef, quantity: number) => void`; `FreshLine.putawayDoneQty: number` (기존 `putawayDone: boolean` 대체)

- [ ] **Step 1: 실패하는 시트 테스트를 쓴다**

`native/warehouse-app/src/domains/inbound/PutawaySheet.test.tsx` 에 추가. 기존 테스트가 `line={...}` 로 렌더하고 있으면 `target={...}` 으로 함께 고친다.

먼저 기존 파일의 세 곳을 고친다.

(1) `LINE: FreshLine` 상수를 `TARGET: PutawayTarget` 으로 교체하고 import 를 바꾼다:

```tsx
import type { PutawayTarget } from './types';
import { PutawaySheet } from './PutawaySheet';

const TARGET: PutawayTarget = {
  lineId: 'ln-1',
  skuCode: 'CT-001',
  skuName: '코튼셔츠',
  pendingQty: 50,
  originLocationCode: '입고기본존',
  originLocationId: 'l-origin',
};
```

(2) `renderSheet` 의 렌더 부분에서 `line={props.line ?? LINE}` 을 교체:

```tsx
      target={props.target ?? TARGET}
```

(3) `makeClient` 의 로케이션 검색 분기에 출발지를 함께 돌려주는 항목을 추가한다 — 출발지 제외 가드를 검증하려면 서버가 출발지를 포함해 내려주는 상황이 필요하다. `if (o.path.includes('C-09'))` 블록 **뒤**에 삽입:

```tsx
        if (o.path.includes('INB')) {
          return {
            items: [
              { id: 'l-origin', code: '입고기본존', displayName: '입고기본존' },
              { id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' },
            ],
            total: 2,
          };
        }
```

그 다음 `describe('PutawaySheet', ...)` 안에 테스트 셋을 추가한다:

```tsx
  it('잔여 수량을 프리필하고 초과 입력이면 적치를 막는다', async () => {
    const user = userEvent.setup();
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } });

    expect(screen.getByText(/입고기본존 · 잔여 50개/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());

    // NumberPad 는 자릿수를 누적한다 — 50 에서 1 을 누르면 501 이 되어 잔여를 넘는다.
    await user.click(screen.getByRole('button', { name: '1' }));
    expect(screen.getByRole('button', { name: '적치' })).toBeDisabled();
  });

  it('출발지는 대상 로케이션 후보에서 제외한다', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText('대상 로케이션 검색'), 'INB');

    expect(await screen.findByRole('button', { name: 'B-05-03' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '입고기본존' })).not.toBeInTheDocument();
  });

  it('수량을 바꾸면 멱등키가 회전한다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderSheet({ lastDest: { id: 'l-prev', code: 'A-01-01' } }, calls);

    await user.click(screen.getByRole('button', { name: '직전 대상지 A-01-01 사용' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    // 같은 라인·같은 대상지인데 수량만 바꿔 재제출한다.
    // 50 → 지우기 → 5 → 지우기 → 0 → '3' → 3.
    await user.click(screen.getByRole('button', { name: '지우기' }));
    await user.click(screen.getByRole('button', { name: '지우기' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: '적치' }));

    const putaways = calls.filter((c) => c.path === '/inbound/putaway');
    expect(putaways).toHaveLength(2);
    expect(putaways[0].idempotencyKey).not.toBe(putaways[1].idempotencyKey);
    expect(putaways[1].body).toMatchObject({ quantity: 3 });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound/PutawaySheet.test.tsx
```
Expected: FAIL — `target` prop 미지원 / 수량 입력 없음

- [ ] **Step 3: 시트 시그니처와 수량 상태를 바꾼다**

`PutawaySheet.tsx` 의 props 블록을 교체:

```tsx
export function PutawaySheet({
  target,
  warehouseId,
  lastDest,
  onDone,
  onCancel,
}: {
  target: PutawayTarget;
  warehouseId: string | null;
  lastDest: LocationRef | null;
  onDone: (dest: LocationRef, quantity: number) => void;
  onCancel: () => void;
}) {
  const [dest, setDest] = useState<LocationRef | null>(null);
  const [quantity, setQuantity] = useState(target.pendingQty);
  const [term, setTerm] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const search = useLocationSearch(warehouseId, dest ? '' : term);
  const putaway = usePutaway();
```

상단 import 에서 `FreshLine` 을 `PutawayTarget` 으로 바꾸고 `NumberPad` 를 추가:

```tsx
import { NumberPad } from '../../core/design/NumberPad';
import type { PutawayTarget } from './types';
```

`line.lineId` 를 보던 리셋 이펙트를 `target` 기준으로 바꾸고 수량도 되돌린다:

```tsx
  useEffect(() => {
    setDest(null);
    setTerm('');
    setQuantity(target.pendingQty);
  }, [target.lineId, target.pendingQty]);
```

- [ ] **Step 4: 멱등키 회전 조건에 수량을 넣는다**

`keyPayloadRef` 블록을 교체:

```tsx
  // 멱등키 회전: 대상지나 수량이 바뀌면 새 키. "커밋됐는데 응답만 유실" 뒤 값을
  // 고쳐 재제출할 때 옛 payload 를 같은 키로 replay 하면 서버가 옛 결과를 돌려주고
  // 화면은 새 값이 반영된 줄 안다 — 원장과 화면이 갈린다.
  const keyPayloadRef = useRef({ lineId: target.lineId, to: '', qty: target.pendingQty });
  useEffect(() => {
    const next = { lineId: target.lineId, to: dest?.id ?? '', qty: quantity };
    const prev = keyPayloadRef.current;
    if (prev.lineId === next.lineId && prev.to === next.to && prev.qty === next.qty) return;
    keyPayloadRef.current = next;
    setIdempotencyKey(crypto.randomUUID());
  }, [target.lineId, dest, quantity]);
```

- [ ] **Step 5: 본문을 잔량·수량패드·출발지 제외로 고친다**

머리말 블록 교체:

```tsx
        <div>
          <div className="font-semibold text-gray-800">{target.skuName}</div>
          <div className="font-mono text-xs text-gray-500">{target.skuCode}</div>
          <div className="mt-1 text-xs text-gray-500">
            {target.originLocationCode} · 잔여 {target.pendingQty}개
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">적치 수량</h3>
          <div className="flex items-center gap-2">
            <output className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-right text-xl font-semibold">
              {quantity}
            </output>
            <button
              type="button"
              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-700"
              onClick={() => setQuantity(target.pendingQty)}
            >
              전량
            </button>
          </div>
          <NumberPad value={quantity} onChange={setQuantity} />
        </section>
```

로케이션 후보 목록에서 출발지를 뺀다 — `(search.data?.items ?? []).map(...)` 을 아래로:

```tsx
                {(search.data?.items ?? [])
                  .filter((loc) => loc.id !== target.originLocationId)
                  .map((loc) => (
```

완전일치 자동선택 이펙트도 같은 필터를 적용한다:

```tsx
    const exact = (search.data?.items ?? []).filter(
      (i) => i.code === trimmed && i.id !== target.originLocationId
    );
```

`dest` 의존 배열의 `line.lineId` 참조도 `target.lineId` 로 바꾼다.

- [ ] **Step 6: 제출부를 고친다**

```tsx
          <Button
            type="button"
            className="flex-1"
            disabled={!dest || putaway.isPending || quantity < 1 || quantity > target.pendingQty}
            onClick={() => {
              if (!dest) return;
              putaway.mutate(
                {
                  lineId: target.lineId,
                  toLocationId: dest.id,
                  quantity,
                  idempotencyKey,
                },
                { onSuccess: () => onDone(dest, quantity) }
              );
            }}
          >
            적치
          </Button>
```

에러 문구의 문맥도 `'inbound'` 에서 `'putaway'` 로 바꾼다:

```tsx
            {errorMessage(putaway.error, 'putaway')}
```

- [ ] **Step 7: putaway 에러 문맥을 추가한다**

`native/warehouse-app/src/core/data/errorMessage.ts` 의 `ErrorContext` 에 `'putaway'` 를 추가하고 `CONTEXTUAL` 에 항목을 넣는다:

```typescript
export type ErrorContext =
  | 'barcode'
  | 'location'
  | 'stocktaking'
  | 'movement'
  | 'inbound'
  | 'inbound-cancel'
  | 'putaway';
```

```typescript
  // 적치는 출발지가 입고기본존이 아닐 수 있다(반품기본존·재작업존도 시스템 존이다).
  // inbound 문맥의 "입고기본존 재고가 부족해요" 를 그대로 쓰면 거짓말이 된다.
  putaway: {
    400: '출발지 재고가 부족하거나 이미 적치됐어요. 새로고침 후 확인해 주세요.',
    404: '입고 라인을 찾을 수 없어요. 새로고침 해주세요.',
  },
```

- [ ] **Step 8: FreshLine 을 잔량 추적형으로 바꾼다**

`types.ts` 의 `FreshLine` 을 교체:

```typescript
/** 입고 직후 화면에 남는 "방금 만든 라인" — 적치·취소의 대상. */
export interface FreshLine {
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  quantity: number;
  /**
   * 지금까지 적치한 누계. boolean 이 아닌 이유는 부분 적치가 가능해졌기 때문이다 —
   * 50개 중 30개만 적치한 라인에 다시 50개를 제안하면 서버가 400 을 낸다.
   */
  putawayDoneQty: number;
}
```

- [ ] **Step 9: PlanReceiveScreen 을 새 계약에 맞춘다**

`submitReceive` 의 `setFresh` 에서 `putawayDone: false` 를 `putawayDoneQty: 0` 으로 바꾼다.

배너 블록을 교체:

```tsx
      {fresh ? (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <p className="text-sm text-green-900">
            {fresh.skuName} {fresh.quantity}개 입고됨
            {fresh.putawayDoneQty >= fresh.quantity
              ? ' · 적치 완료'
              : fresh.putawayDoneQty > 0
                ? ` · ${fresh.putawayDoneQty}개 적치됨`
                : ''}
          </p>
          <div className="flex gap-2">
            {fresh.putawayDoneQty < fresh.quantity ? (
              <Button type="button" className="flex-1 py-1.5 text-xs" onClick={() => setPutawayOpen(true)}>
                적치하기
              </Button>
            ) : null}
            {/* 취소는 적치 전에만 가능하다 — 서버가 putawayFromOriginQty > 0 이면 거부한다.
                부분 적치도 그 조건에 걸리므로 누계가 0 일 때만 노출한다. */}
            {fresh.putawayDoneQty === 0 && !cancelConfirm ? (
```

시트 호출부를 교체:

```tsx
      {putawayOpen && fresh ? (
        <PutawaySheet
          target={{
            lineId: fresh.lineId,
            skuName: fresh.skuName,
            skuCode: fresh.skuCode,
            pendingQty: fresh.quantity - fresh.putawayDoneQty,
            originLocationCode: '입고기본존',
          }}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayOpen(false)}
          onDone={(dest, quantity) => {
            setLastDest(dest);
            setPutawayOpen(false);
            setFresh((prev) =>
              prev ? { ...prev, putawayDoneQty: prev.putawayDoneQty + quantity } : prev
            );
          }}
        />
      ) : null}
```

- [ ] **Step 10: QuickInboundScreen 을 새 계약에 맞춘다**

`setStaged` 매핑의 `putawayDone: false` 를 `putawayDoneQty: 0` 으로 바꾼다.

목록 행의 완료 표시를 교체:

```tsx
                {line.putawayDoneQty >= line.quantity ? (
                  <span className="shrink-0 text-xs font-semibold text-green-700">완료</span>
                ) : (
                  <Button className="shrink-0 px-3 py-1.5 text-xs" onClick={() => setPutawayFor(line)}>
                    적치
                  </Button>
                )}
```

시트 호출부를 교체:

```tsx
      {putawayFor ? (
        <PutawaySheet
          target={{
            lineId: putawayFor.lineId,
            skuName: putawayFor.skuName,
            skuCode: putawayFor.skuCode,
            pendingQty: putawayFor.quantity - putawayFor.putawayDoneQty,
            originLocationCode: '입고기본존',
          }}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setPutawayFor(null)}
          onDone={(dest, quantity) => {
            setLastDest(dest);
            setStaged((prev) =>
              prev.map((l) =>
                l.lineId === putawayFor.lineId
                  ? { ...l, putawayDoneQty: l.putawayDoneQty + quantity }
                  : l
              )
            );
            setPutawayFor(null);
          }}
        />
      ) : null}
```

- [ ] **Step 11: 기존 테스트의 FreshLine 사용처를 고친다**

Run:
```bash
cd native/warehouse-app && npx tsc -b
```

`putawayDone` 을 쓰는 테스트 픽스처가 컴파일 에러로 잡힌다. 전부 `putawayDoneQty` 로 바꾼다 (`putawayDone: false` → `putawayDoneQty: 0`, `putawayDone: true` → `putawayDoneQty: <quantity>`).

Expected: 에러 없이 종료

- [ ] **Step 12: 인바운드 도메인 테스트를 돌린다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound
```
Expected: PASS

- [ ] **Step 13: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound native/warehouse-app/src/core/data/errorMessage.ts
git commit -m "feat(warehouse-app): PutawaySheet 을 부분 적치와 임의 출발지에 열다

수량이 가변이 되면서 멱등키 회전 조건에 수량을 포함시킨다. 없으면 응답
유실 후 수량을 고쳐 재제출할 때 서버가 옛 결과를 replay 하고 화면만
새 값이 반영된 줄 안다.

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD"
```

---

### Task 5: 적치 대기 큐 화면

**Files:**
- Create: `native/warehouse-app/src/domains/inbound/PutawayQueueScreen.tsx`
- Create: `native/warehouse-app/src/domains/inbound/PutawayQueueScreen.test.tsx`
- Create: `native/warehouse-app/src/app/routes/PutawayRoute.tsx`
- Modify: `native/warehouse-app/src/app/routeTree.tsx`

**Interfaces:**
- Consumes: `usePutawayPending` · `PutawayDays` (Task 3), `PutawaySheet` · `PutawayTarget` (Task 4), `useSkuByBarcode` (`domains/inventory/useSkuByBarcode`), `useScanner` (`core/hardware/scan/useScanner`), `useWarehouse` (`app/warehouse-context`), `WarehousePicker` · `ScreenHeader`
- Produces: `PutawayQueueScreen` (default 화면), `/putaway` 라우트

- [ ] **Step 1: 실패하는 화면 테스트를 쓴다**

`native/warehouse-app/src/domains/inbound/PutawayQueueScreen.test.tsx` 를 만든다. 렌더 하네스는 `PendingPlanListScreen.test.tsx` 의 구조를 그대로 복제하되(`SessionProvider` → `QueryClientProvider` → `ApiClientProvider` → `WarehouseProvider` → `ScanProvider`), 스캔을 쏘기 위해 `useScanBus` 를 쓰는 버튼을 하나 심는다 — `QuickInboundScreen.test.tsx:52-57` 과 같은 방식이다.

```tsx
const QUEUE = {
  total: 2,
  items: [
    {
      lineId: 'l-1',
      skuId: 's-1',
      skuName: '무선마우스 블랙',
      skuCode: 'MOUSE-BK-01',
      pendingQty: 20,
      originLocationId: 'loc-origin',
      originLocationCode: 'zone-inbound-default',
      receivedAt: '2026-07-26T00:14:00.000Z',
    },
    {
      lineId: 'l-2',
      skuId: 's-2',
      skuName: 'USB-C 케이블 1m',
      skuCode: 'CBL-C-1M',
      pendingQty: 50,
      originLocationId: 'loc-origin',
      originLocationCode: 'zone-inbound-default',
      receivedAt: '2026-07-26T00:20:00.000Z',
    },
  ],
};

describe('PutawayQueueScreen', () => {
  it('창고가 없으면 창고 선택을 요구한다', async () => {
    renderScreen();
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('대기 라인을 잔여수량·출발지와 함께 보여준다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByText('무선마우스 블랙')).toBeInTheDocument();
    expect(screen.getByText('잔여 20')).toBeInTheDocument();
    expect(screen.getAllByText(/zone-inbound-default/)[0]).toBeInTheDocument();
  });

  it('큐에 1건인 상품을 스캔하면 시트가 바로 열린다', async () => {
    renderScreen(SELECTED, { barcode: { '8801': [{ id: 's-1' }] } });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));

    expect(await screen.findByRole('dialog', { name: '적치' })).toBeInTheDocument();
  });

  it('큐에 여러 건인 상품을 스캔하면 후보 목록을 보여준다', async () => {
    // 같은 SKU 로 두 라인이 내려오는 응답
    renderScreen(SELECTED, {
      queue: {
        total: 2,
        items: [
          { ...QUEUE.items[0] },
          { ...QUEUE.items[0], lineId: 'l-3', pendingQty: 50, receivedAt: '2026-07-26T05:02:00.000Z' },
        ],
      },
      barcode: { '8801': [{ id: 's-1' }] },
    });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));

    expect(await screen.findByText('어느 건을 적치할까요?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '적치' })).not.toBeInTheDocument();
  });

  it('큐에 없는 상품을 스캔하면 없다고 알린다', async () => {
    renderScreen(SELECTED, { barcode: { '9999': [{ id: 's-none' }] } });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-9999' }));

    expect(await screen.findByText('이 상품은 적치 대기가 없어요.')).toBeInTheDocument();
  });

  it('큐가 비면 기간 필터가 걸려 있음을 함께 알린다', async () => {
    renderScreen(SELECTED, { queue: { total: 0, items: [] } });
    expect(await screen.findByText(/적치할 항목이 없어요/)).toBeInTheDocument();
  });
});
```

`renderScreen(prefsSeed?, opts?)` 의 가짜 트랜스포트는 경로로 분기한다:

```tsx
    request: (async (o: { path: string }) => {
      if (o.path.startsWith('/inbound/putaway/pending')) return opts?.queue ?? QUEUE;
      if (o.path.startsWith('/inventory/skus?barcode=')) {
        const code = decodeURIComponent(o.path.split('barcode=')[1]);
        const hit = opts?.barcode?.[code];
        if (!hit) throw new Error(`GET ${o.path} → 404`);
        return hit;
      }
      if (o.path.startsWith('/locations/warehouses/')) return { items: [], total: 0 };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
```

로케이션 검색 경로는 `useLocationSearch.ts` 기준 `/locations/warehouses/:warehouseId?search=…&limit=20` 이다.

스캔 버튼은 `QuickInboundScreen.test.tsx:52-57` 과 같은 방식으로 심는다:

```tsx
function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      scan-{code}
    </button>
  );
}
```

`ScanProvider` 안쪽, `PutawayQueueScreen` 과 형제로 렌더한다.

- [ ] **Step 2: 실패를 확인한다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound/PutawayQueueScreen.test.tsx
```
Expected: FAIL — `Cannot find module './PutawayQueueScreen'`

- [ ] **Step 3: 큐 화면을 구현한다**

`native/warehouse-app/src/domains/inbound/PutawayQueueScreen.tsx`:

```tsx
import { useState } from 'react';
import { useWarehouse } from '../../app/warehouse-context';
import { errorMessage } from '../../core/data/errorMessage';
import { ScreenHeader } from '../../core/design/ScreenHeader';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { useSkuByBarcode } from '../inventory/useSkuByBarcode';
import { WarehousePicker } from '../warehouse/WarehousePicker';
import { PutawaySheet, type LocationRef } from './PutawaySheet';
import { usePutawayPending, type PutawayDays } from './queries';
import type { PutawayPendingItem } from './types';

const DAY_OPTIONS: Array<{ value: PutawayDays; label: string }> = [
  { value: 1, label: '최근 1일' },
  { value: 7, label: '최근 7일' },
  { value: 'all', label: '전체' },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function PutawayQueueScreen() {
  const { warehouseId, isSet } = useWarehouse();
  const [days, setDays] = useState<PutawayDays>(1);
  const [target, setTarget] = useState<PutawayPendingItem | null>(null);
  const [candidates, setCandidates] = useState<PutawayPendingItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastDest, setLastDest] = useState<LocationRef | null>(null);

  const queue = usePutawayPending(warehouseId, days);
  const byBarcode = useSkuByBarcode();
  const items = queue.data?.items ?? [];

  // 스캔은 큐를 좁히는 지름길이다. 서버가 아니라 이미 받은 목록에서 거르므로
  // "큐에 없음"과 "조회 실패"를 화면이 구분해 말할 수 있다.
  useScanner((e) => {
    if (target) return;
    setNotice(null);
    byBarcode.mutate(e.code, {
      onSuccess: (skus) => {
        const ids = new Set(skus.map((s) => s.id));
        const hits = items.filter((i) => ids.has(i.skuId));
        if (hits.length === 0) {
          setNotice('이 상품은 적치 대기가 없어요.');
          return;
        }
        if (hits.length === 1) {
          setTarget(hits[0]);
          return;
        }
        setCandidates(hits);
      },
    });
  });

  if (!isSet) {
    return (
      <div className="space-y-4">
        <ScreenHeader title="적치" backTo="/" />
        <div className="space-y-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="text-sm text-gray-600">창고를 먼저 선택해 주세요.</p>
          <WarehousePicker />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScreenHeader title="적치" backTo="/" right={`${items.length}건`} />

      <div className="flex gap-2">
        {DAY_OPTIONS.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={days === o.value}
            className={
              days === o.value
                ? 'rounded-md border border-blue-500 bg-blue-50 px-3 py-1.5 text-sm text-blue-700'
                : 'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700'
            }
            onClick={() => setDays(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <p className="text-sm text-gray-500">상품 바코드를 스캔하거나 목록에서 고르세요.</p>

      {notice ? (
        <p role="status" className="text-sm text-amber-700">
          {notice}
        </p>
      ) : null}
      {byBarcode.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(byBarcode.error, 'barcode')}
        </p>
      ) : null}

      {queue.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(queue.error, 'putaway')}
        </p>
      ) : queue.isLoading ? (
        <p className="text-sm text-gray-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">
          적치할 항목이 없어요. 기간 필터를 넓혀 보세요.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.lineId}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left active:bg-gray-50"
                onClick={() => setTarget(item)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-800">{item.skuName}</span>
                  <span className="block text-xs text-gray-500">
                    {item.originLocationCode} · {formatTime(item.receivedAt)}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  잔여 {item.pendingQty}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {candidates ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="적치 대상 선택"
        >
          <div className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-lg">
            <h2 className="font-semibold text-gray-800">어느 건을 적치할까요?</h2>
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.lineId}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left active:bg-gray-50"
                    onClick={() => {
                      setTarget(c);
                      setCandidates(null);
                    }}
                  >
                    <span className="flex-1 text-sm text-gray-700">
                      {formatTime(c.receivedAt)} 입고 · {c.originLocationCode}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{c.pendingQty}개</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="w-full rounded-md border border-gray-300 py-2 text-sm text-gray-700"
              onClick={() => setCandidates(null)}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {target ? (
        <PutawaySheet
          target={target}
          warehouseId={warehouseId}
          lastDest={lastDest}
          onCancel={() => setTarget(null)}
          onDone={(dest) => {
            setLastDest(dest);
            setTarget(null);
            // 잔량이 남으면 무효화된 큐가 줄어든 수량으로 다시 내려준다.
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/domains/inbound/PutawayQueueScreen.test.tsx
```
Expected: PASS — 6 passed

- [ ] **Step 5: 라우트를 만든다**

`native/warehouse-app/src/app/routes/PutawayRoute.tsx`:

```tsx
import { PutawayQueueScreen } from '../../domains/inbound/PutawayQueueScreen';

export function PutawayRoute() {
  return <PutawayQueueScreen />;
}
```

- [ ] **Step 6: routeTree 의 플레이스홀더를 교체한다**

`native/warehouse-app/src/app/routeTree.tsx` 의 `putawayRoute` 를 교체:

```tsx
const putawayRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/putaway',
  component: PutawayRoute,
});
```

상단 import 에 추가:

```tsx
import { PutawayRoute } from './routes/PutawayRoute';
```

- [ ] **Step 7: 라우터 테스트를 돌린다**

Run:
```bash
cd native/warehouse-app && npx vitest run src/app
```
Expected: PASS

`/putaway` 가 플레이스홀더 문구("후속 Phase에서 구현됩니다")를 단언하는 테스트가 있으면 새 화면 기준으로 고친다.

- [ ] **Step 8: 전체 검증**

Run:
```bash
cd native/warehouse-app && npx vitest run && npx tsc -b && npx oxlint src
```
Expected: 전부 PASS, tsc 무출력, oxlint error 0

Run:
```bash
npx nest build core
```
Expected: 에러 없이 종료

- [ ] **Step 9: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/PutawayQueueScreen.tsx \
        native/warehouse-app/src/domains/inbound/PutawayQueueScreen.test.tsx \
        native/warehouse-app/src/app/routes/PutawayRoute.tsx \
        native/warehouse-app/src/app/routeTree.tsx
git commit -m "feat(warehouse-app): 적치 대기 큐 화면

핸드헬드 홈의 적치 타일이 플레이스홀더 대신 실제 큐로 간다. 스캔은 이미
받은 큐를 좁히는 지름길이고, 목록 탭도 같은 시트로 이어진다.

Claude-Session: https://claude.ai/code/session_01FDMZrnfMy6iZt1bt9puriD"
```

---

## 완료 후 남는 것

- **기기 수동 스모크**: 실제 PDA 에서 HID 스캔으로 큐 좁히기 → 적치 → admin-web 원장에서 `−N`/`+N` 확인. Phase 2 의 예정 경로 스모크도 아직 밀려 있으니 함께 돈다.
- **배포 순서**: `core` 선배포 → 앱 배포. 마이그레이션 0건이라 `db:migrate` 는 부르지 않는다.
