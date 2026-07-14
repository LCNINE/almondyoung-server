# 입고/이동 요청 멱등화 (P2-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입고/이동 9개 엔드포인트에 required `idempotencyKey`를 도입하고, 전용 idempotency 테이블 + 공용 래퍼로 요청 전체를 멱등화한다 (재-POST 시 저장 응답 replay).

**Architecture:** `inventory_idempotency_requests` 테이블(UNIQUE(endpoint,key)) + `InventoryIdempotencyService.withIdempotency(endpoint, key, body, handler, tx?)` 래퍼가 핸들러 본문 전체를 단일 tx에서 감싼다. 이벤트 레벨 파생 키(`${key}` / `${key}:${i}`)를 심층 방어로 병행. admin-web은 `useIdempotentMutation` central 래퍼로 키 수명주기 관리(성공/4xx 교체, 네트워크·5xx 유지).

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), class-validator, Jest, react-query(admin-web), axios.

**스펙:** `docs/superpowers/specs/2026-07-09-inbound-movement-idempotency-design.md` — 이 계획의 모든 요구는 스펙이 우선.

## Global Constraints

- 브랜치: `feat/inbound-movement-idempotency` (develop에서 분기). 작업 시작 전 생성.
- ADR-0025: `this.db.transaction` 직접 호출 금지 — `dbService.run(fn, tx)` + 공개 메서드 `tx?: DbTx` 마지막 파라미터.
- 도메인 에러는 `@app/shared`(`ConflictError` — `libs/shared/src/filters/domain-exceptions.ts:32`). 서비스에서 Nest `HttpException` 신규 도입 금지 (기존 코드의 `BadRequestException` 등은 P3-1 범위 — 이 PR에서 건드리지 않음).
- inventory 신규 쿼리: `trx.select().from().where()` 형태만 (`db.query.*` 신규 사용 금지). `any`/`as` 캐스트는 주석 정당화 필수.
- 스키마 변경은 additive만. `schema.ts` + 생성된 `drizzle/<ts>_*.sql` + `drizzle/meta/`를 **한 커밋에**.
- 마이그레이션 생성은 dev 머신에서: `npm run db:generate:core -- --name <kebab>` (CI 금지).
- endpoint 논리 이름 (스펙 §3 — 코드·테스트에서 이 문자열 그대로): `inbound.simple`, `inbound.simple-fullscan`, `inbound.individual`, `inbound.plans.receive`, `inbound.putaway`, `inbound.return`, `inbound.cancel`, `movement.move`, `movement.inter-warehouse`.
- DTO 검증 데코레이터: `@IsString() @IsNotEmpty() @MaxLength(100)` — required.
- 커밋 메시지는 저장소 관례(`[core] …`, `[admin-web] …`, 한국어) + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: 스키마 — `inventory_idempotency_requests` 테이블 + 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (stockJournals 정의 근처 :764 위, `wmsTables` :2207)
- Create(생성됨): `apps/core/drizzle/<timestamp>_add-inventory-idempotency-requests.sql` + `drizzle/meta/` 갱신

**Interfaces:**
- Produces: `wmsTables.inventoryIdempotencyRequests` — 컬럼 `id, endpoint, key, requestHash, response, createdAt`. Task 2가 사용.

- [ ] **Step 1: 브랜치 생성**

```bash
git checkout develop && git checkout -b feat/inbound-movement-idempotency
```

- [ ] **Step 2: 테이블 정의 추가**

`inventory.schema.ts`의 `stockJournals`(:764) 정의 **앞**에 추가 (`jsonb`, `uniqueIndex`, `index`, `varchar`, `uuid`, `timestamp`는 이미 import됨):

```typescript
/*───────────────────────────
 * REQUEST IDEMPOTENCY (P2-4)
 * 입고/이동 요청 전체의 멱등 기록. 이벤트 레벨 stock_events.idempotency_key 와 별개의
 * 요청(핸들러) 레벨 방어 — 스펙 docs/superpowers/specs/2026-07-09-inbound-movement-idempotency-design.md §4.1
 *──────────────────────────*/
export const inventoryIdempotencyRequests = pgTable(
  'inventory_idempotency_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpoint: varchar('endpoint', { length: 64 }).notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    // SHA-256(JSON.stringify(dto)) hex — 키 오용(같은 키, 다른 본문) 감지
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    // null = 처리 중(커밋 전에는 외부 미관찰). 완료 시 핸들러 반환값 저장
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqEndpointKey: uniqueIndex('uq_inv_idem_requests_endpoint_key').on(t.endpoint, t.key),
    idxCreatedAt: index('idx_inv_idem_requests_created_at').on(t.createdAt),
  }),
);
```

`wmsTables`(:2207) 객체에 `outboxEvents,` 다음 줄로 `inventoryIdempotencyRequests,` 추가. (`wmsSchema`는 `...wmsTables` 스프레드라 자동 포함.)

- [ ] **Step 3: 마이그레이션 생성 + SQL 검토**

```bash
npm run db:generate:core -- --name add-inventory-idempotency-requests
```

생성된 `apps/core/drizzle/<timestamp>_add-inventory-idempotency-requests.sql` 열어 확인: `CREATE TABLE "inventory_idempotency_requests"` + `CREATE UNIQUE INDEX "uq_inv_idem_requests_endpoint_key"` + `CREATE INDEX "idx_inv_idem_requests_created_at"`만 있어야 함. 다른 테이블의 DROP/ALTER가 섞여 있으면 중단하고 schema.ts 오타 확인.

- [ ] **Step 4: 타입 확인**

```bash
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>/dev/null || npx tsc --noEmit -p tsconfig.json
```
Expected: 에러 0.

- [ ] **Step 5: 커밋 (schema + SQL + meta 한 커밋)**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/
git commit -m "[core] inventory_idempotency_requests 테이블 신설 (P2-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `InventoryIdempotencyService.withIdempotency` (TDD) + 모듈 등록

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/inventory-idempotency.service.ts`
- Create: `apps/core/src/modules/inventory/core/services/inventory-idempotency.service.spec.ts`
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (providers :53, exports :71)

**Interfaces:**
- Consumes: Task 1의 `wmsTables.inventoryIdempotencyRequests`.
- Produces: `computeRequestHash(body: unknown): string` (export), `InventoryIdempotencyService.withIdempotency<T>(endpoint: string, key: string, requestBody: unknown, handler: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T>`. Task 4·5가 주입해 사용. `inventory.module.ts`에서 export되어 inbound/movement 모듈에서 주입 가능.

- [ ] **Step 1: 실패하는 테스트 작성**

`inventory-idempotency.service.spec.ts` (기존 `ledger-reconciliation-cron.spec.ts`와 같은 생성자 직접 주입 스타일):

```typescript
import { ConflictError } from '@app/shared';
import { InventoryIdempotencyService, computeRequestHash } from './inventory-idempotency.service';

type Row = { id: string; endpoint: string; key: string; requestHash: string; response: unknown };

function makeTrx(over: { insertedIds?: Array<{ id: string }>; existing?: Row[] } = {}) {
  const whereUpdate = jest.fn().mockResolvedValue(undefined);
  const trx = {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(over.insertedIds ?? []),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({ where: whereUpdate }),
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(over.existing ?? []),
        }),
      }),
    }),
  };
  return { trx, whereUpdate };
}

function build(trx: unknown) {
  // dbService.run 이 즉시 fake trx 로 콜백 실행
  const dbService = { run: (fn: (t: unknown) => Promise<unknown>) => fn(trx) } as never;
  return new InventoryIdempotencyService(dbService);
}

describe('computeRequestHash', () => {
  it('같은 본문은 같은 해시, 다른 본문은 다른 해시', () => {
    const a = computeRequestHash({ x: 1 });
    expect(a).toBe(computeRequestHash({ x: 1 }));
    expect(a).not.toBe(computeRequestHash({ x: 2 }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('InventoryIdempotencyService.withIdempotency', () => {
  const dto = { warehouseId: 'w', qty: 3 };

  it('신규 키: handler 를 실행하고 반환값을 response 에 저장 후 그대로 반환한다', async () => {
    const { trx, whereUpdate } = makeTrx({ insertedIds: [{ id: 'row-1' }] });
    const svc = build(trx);
    const handler = jest.fn().mockResolvedValue({ receiptId: 'r-1' });
    const result = await svc.withIdempotency('inbound.simple', 'k-1', dto, handler);
    expect(handler).toHaveBeenCalledWith(trx);
    expect(whereUpdate).toHaveBeenCalled();
    expect(result).toEqual({ receiptId: 'r-1' });
  });

  it('신규 키: handler 가 throw 하면 그대로 전파한다(응답 저장 없음)', async () => {
    const { trx, whereUpdate } = makeTrx({ insertedIds: [{ id: 'row-1' }] });
    const svc = build(trx);
    await expect(
      svc.withIdempotency('inbound.simple', 'k-1', dto, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(whereUpdate).not.toHaveBeenCalled();
  });

  it('중복 키 + 같은 해시 + 응답 존재: handler 를 실행하지 않고 저장 응답을 반환한다', async () => {
    const stored: Row = {
      id: 'row-1', endpoint: 'inbound.simple', key: 'k-1',
      requestHash: computeRequestHash(dto), response: { receiptId: 'r-1' },
    };
    const { trx } = makeTrx({ existing: [stored] });
    const svc = build(trx);
    const handler = jest.fn();
    const result = await svc.withIdempotency('inbound.simple', 'k-1', dto, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(result).toEqual({ receiptId: 'r-1' });
  });

  it('중복 키 + 다른 해시: ConflictError(키 재사용)', async () => {
    const stored: Row = {
      id: 'row-1', endpoint: 'inbound.simple', key: 'k-1',
      requestHash: computeRequestHash({ other: true }), response: { receiptId: 'r-1' },
    };
    const { trx } = makeTrx({ existing: [stored] });
    const svc = build(trx);
    await expect(svc.withIdempotency('inbound.simple', 'k-1', dto, jest.fn())).rejects.toThrow(ConflictError);
  });

  it('중복 키 + response null(처리 중): ConflictError', async () => {
    const stored: Row = {
      id: 'row-1', endpoint: 'inbound.simple', key: 'k-1',
      requestHash: computeRequestHash(dto), response: null,
    };
    const { trx } = makeTrx({ existing: [stored] });
    const svc = build(trx);
    await expect(svc.withIdempotency('inbound.simple', 'k-1', dto, jest.fn())).rejects.toThrow(ConflictError);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx jest --testPathPattern=inventory-idempotency.service.spec
```
Expected: FAIL — `Cannot find module './inventory-idempotency.service'`.

- [ ] **Step 3: 구현**

`inventory-idempotency.service.ts`:

```typescript
import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';

/**
 * 요청 본문 지문. 키 정렬 정규화는 하지 않는다 — 같은 클라이언트의 재전송은 직렬화가
 * 동일하고, 오탐(직렬화 상이)은 409로만 귀결되어 안전한 방향 (스펙 §4.1).
 */
export function computeRequestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

@Injectable()
export class InventoryIdempotencyService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * 요청(핸들러) 단위 멱등 래퍼 — 스펙 §4.2.
   * 신규 키: handler 실행 후 반환값을 같은 tx 에서 response 로 저장(throw 시 키까지 롤백).
   * 중복 키: 본문 해시 일치 시 저장 응답 replay, 불일치 시 409.
   * 동시 중복은 UNIQUE(endpoint,key) INSERT 의 행 락 대기로 직렬화된다.
   */
  async withIdempotency<T>(
    endpoint: string,
    key: string,
    requestBody: unknown,
    handler: (tx: DbTx) => Promise<T>,
    tx?: DbTx,
  ): Promise<T> {
    const requestHash = computeRequestHash(requestBody);
    const t = wmsTables.inventoryIdempotencyRequests;
    return this.dbService.run(async (trx) => {
      const inserted = await trx
        .insert(t)
        .values({ endpoint, key, requestHash })
        .onConflictDoNothing({ target: [t.endpoint, t.key] })
        .returning({ id: t.id });

      if (inserted.length > 0) {
        const result = await handler(trx);
        await trx
          .update(t)
          .set({ response: result ?? null })
          .where(eq(t.id, inserted[0].id));
        return result;
      }

      const [existing] = await trx
        .select()
        .from(t)
        .where(and(eq(t.endpoint, endpoint), eq(t.key, key)))
        .limit(1);
      // ON CONFLICT 가 빈 결과 = 경쟁 tx 커밋 완료 → READ COMMITTED 에서 row 가시.
      // 미가시(경쟁 tx 진행 중 등 이례 상황)면 처리 중으로 간주.
      if (!existing || existing.response === null) {
        throw new ConflictError(`동일 요청이 처리 중입니다: ${endpoint} (key=${key})`);
      }
      if (existing.requestHash !== requestHash) {
        throw new ConflictError(`idempotencyKey 재사용: 같은 키로 다른 요청 본문 (${endpoint}, key=${key})`);
      }
      // jsonb round-trip 값 — 저장 시점 handler 반환값과 동형이라는 계약. jsonb 조회 타입이
      // unknown 이라 캐스트 불가피 (정당화 주석, CLAUDE.md 타입 규칙)
      return existing.response as T;
    }, tx);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx jest --testPathPattern=inventory-idempotency.service.spec
```
Expected: PASS (6 tests).

- [ ] **Step 5: 모듈 등록**

`inventory.module.ts`: import 추가 후 `providers`(:53 블록)와 `exports`(:71 블록) 양쪽에 `InventoryIdempotencyService,` 추가 (`LedgerReconciliationService` 항목 옆).

- [ ] **Step 6: 타입/린트 확인 후 커밋**

```bash
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>/dev/null || npx tsc --noEmit -p tsconfig.json
npm run lint -- --quiet 2>/dev/null | tail -5
git add apps/core/src/modules/inventory/core/services/inventory-idempotency.service.ts \
        apps/core/src/modules/inventory/core/services/inventory-idempotency.service.spec.ts \
        apps/core/src/modules/inventory/core/inventory.module.ts
git commit -m "[core] 요청 멱등 래퍼 InventoryIdempotencyService 신설 (P2-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 보존 크론 `purgeExpired` (TDD)

**Files:**
- Modify: `apps/core/src/modules/inventory/core/services/inventory-idempotency.service.ts`
- Modify: `apps/core/src/modules/inventory/core/services/inventory-idempotency.service.spec.ts`

**Interfaces:**
- Produces: `InventoryIdempotencyService.purgeExpired(): Promise<number>` — `@Cron('30 3 * * *', Asia/Seoul)`, 30일 초과 row 삭제.

- [ ] **Step 1: 실패하는 테스트 추가**

spec 파일에 추가:

```typescript
describe('InventoryIdempotencyService.purgeExpired', () => {
  it('30일 초과 row 를 삭제하고 삭제 건수를 반환한다', async () => {
    const whereDelete = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
    });
    const db = { delete: jest.fn().mockReturnValue({ where: whereDelete }) };
    const dbService = { db, run: jest.fn() } as never;
    const svc = new InventoryIdempotencyService(dbService);
    await expect(svc.purgeExpired()).resolves.toBe(2);
    expect(db.delete).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx jest --testPathPattern=inventory-idempotency.service.spec
```
Expected: FAIL — `svc.purgeExpired is not a function`.

- [ ] **Step 3: 구현**

서비스에 추가 (import에 `Logger`(@nestjs/common), `Cron`(@nestjs/schedule), `lt`(drizzle-orm) 보강):

```typescript
  private static readonly RETENTION_DAYS = 30;
  private readonly logger = new Logger(InventoryIdempotencyService.name);

  /** 멱등 기록 보존 크론 — 재전송 방어 window(30일) 초과분 정리. 야간 03:30 KST (스펙 §6). */
  @Cron('30 3 * * *', { name: 'inventory-idempotency-purge', timeZone: 'Asia/Seoul' })
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - InventoryIdempotencyService.RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.dbService.db
      .delete(wmsTables.inventoryIdempotencyRequests)
      .where(lt(wmsTables.inventoryIdempotencyRequests.createdAt, cutoff))
      .returning({ id: wmsTables.inventoryIdempotencyRequests.id });
    this.logger.log(`idempotency purge: ${deleted.length} rows (< ${cutoff.toISOString()})`);
    return deleted.length;
  }
```

- [ ] **Step 4: 통과 확인 + 커밋**

```bash
npx jest --testPathPattern=inventory-idempotency.service.spec
git add apps/core/src/modules/inventory/core/services/inventory-idempotency.service.ts \
        apps/core/src/modules/inventory/core/services/inventory-idempotency.service.spec.ts
git commit -m "[core] 멱등 기록 30일 보존 크론 (P2-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: inbound DTO + `InboundService` 7개 핸들러 배선 (TDD)

**Files:**
- Modify: `apps/core/src/modules/inventory/inbound/dto/simple-inbound.dto.ts`
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts`
- Create: `apps/core/src/modules/inventory/inbound/services/inbound.service.idempotency.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `InventoryIdempotencyService.withIdempotency(endpoint, key, body, handler, tx?)`.
- Produces: 7개 핸들러가 `dto.idempotencyKey` required로 동작. 엔드포인트 이름은 Global Constraints의 논리 이름.

- [ ] **Step 1: 실패하는 배선 테스트 작성**

`inbound.service.idempotency.spec.ts` — withIdempotency 모킹으로 (endpoint, key, dto) 전달만 검증(본문 실행 없음):

```typescript
import { InboundService } from './inbound.service';

const SENTINEL = { sentinel: true };

function build() {
  const withIdempotency = jest.fn().mockResolvedValue(SENTINEL);
  const idempotency = { withIdempotency } as never;
  // 나머지 의존성은 withIdempotency 모킹으로 본문이 실행되지 않으므로 도달하지 않음
  const svc = new InboundService({} as never, {} as never, {} as never, {} as never, {} as never, idempotency);
  return { svc, withIdempotency };
}

const CASES: Array<{ method: keyof InboundService; endpoint: string; dto: Record<string, unknown> }> = [
  { method: 'simpleInbound', endpoint: 'inbound.simple', dto: { warehouseId: 'w', items: [], idempotencyKey: 'k' } },
  { method: 'simpleInboundFullscan', endpoint: 'inbound.simple-fullscan', dto: { warehouseId: 'w', items: [], idempotencyKey: 'k' } },
  { method: 'individualInbound', endpoint: 'inbound.individual', dto: { idempotencyKey: 'k' } },
  { method: 'receiveFromPlan', endpoint: 'inbound.plans.receive', dto: { idempotencyKey: 'k' } },
  { method: 'putawayFromOrigin', endpoint: 'inbound.putaway', dto: { idempotencyKey: 'k' } },
  { method: 'returnInbound', endpoint: 'inbound.return', dto: { idempotencyKey: 'k' } },
  { method: 'cancelInbound', endpoint: 'inbound.cancel', dto: { idempotencyKey: 'k' } },
];

describe('InboundService 멱등 래퍼 배선', () => {
  it.each(CASES)('$method → withIdempotency($endpoint, dto.idempotencyKey, dto)', async ({ method, endpoint, dto }) => {
    const { svc, withIdempotency } = build();
    // 배선 검증 목적의 동적 호출 — DTO 전체 형태는 통합 스펙에서 검증 (정당화 주석)
    const result = await (svc[method] as (d: unknown, tx?: unknown) => Promise<unknown>)(dto);
    expect(withIdempotency).toHaveBeenCalledWith(endpoint, 'k', dto, expect.any(Function), undefined);
    expect(result).toBe(SENTINEL);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx jest --testPathPattern=inbound.service.idempotency.spec
```
Expected: FAIL — 생성자 인자 수 불일치 또는 `withIdempotency` 미호출.

- [ ] **Step 3: DTO 필드 추가**

`simple-inbound.dto.ts` — 6개 클래스(`SimpleInboundDto`, `IndividualInboundDto`, `PutawayRequestDto`, `ReturnInboundDto`, `CancelInboundDto`, `ReceiveFromPlanDto`) 각각의 클래스 본문 끝에 동일하게 추가 (파일 상단 import에 `IsString`, `MaxLength`는 이미 있음):

```typescript
  @ApiProperty({ description: '요청 멱등 키 — 클라이언트 생성 UUID, 같은 작업의 재시도는 같은 값 재사용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  idempotencyKey: string;
```

- [ ] **Step 4: 서비스 배선**

`inbound.service.ts` 수정:

(a) import + 생성자 (마지막 파라미터로 추가 — spec의 6번째 인자 순서와 일치):

```typescript
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
// constructor 마지막에:
    private readonly idempotency: InventoryIdempotencyService,
```

(b) 7개 핸들러 각각: 본문 최상위 `return this.dbService.run(async (tx) => {` → 래퍼로 교체, 닫는 `}, tx);`는 그대로. 예: `simpleInbound`(:72):

```typescript
  async simpleInbound(dto: SimpleInboundDto, tx?: DbTx) {
    return this.idempotency.withIdempotency('inbound.simple', dto.idempotencyKey, dto, async (tx) => {
      // …기존 본문 그대로 (tx 사용 동일)…
    }, tx);
  }
```

동일 패턴으로: `simpleInboundFullscan`(:158, `'inbound.simple-fullscan'`), `individualInbound`(:236, `'inbound.individual'`), `receiveFromPlan`(:721, `'inbound.plans.receive'`), `putawayFromOrigin`(:811, `'inbound.putaway'`), `returnInbound`(:885, `'inbound.return'`), `cancelInbound`(:951, `'inbound.cancel'`).

(c) 이벤트 레벨 파생 키 (스펙 §4.4):

- `simpleInbound`·`simpleInboundFullscan`의 items 루프를 `for (const [i, item] of items.entries())`로 바꾸고, `commandService.receive({...})` 입력에 `idempotencyKey: \`${dto.idempotencyKey}:${i}\`,` 추가 (`journalId: journal.id,` 다음 줄).
- `individualInbound`(:270 부근)·`receiveFromPlan`(:760 부근)의 `commandService.receive` 입력에 `idempotencyKey: dto.idempotencyKey,` 추가.
- `putawayFromOrigin`(:851 부근)의 `commandService.moveInternal` 입력에 `idempotencyKey: dto.idempotencyKey,` 추가.
- `returnInbound`(:915 부근)의 `eventStore.createEvent` 입력에 `idempotencyKey: dto.idempotencyKey,` 추가.
- `cancelInbound`의 `reverseEvent`는 원 이벤트 역분개로 자체 멱등 — 변경 없음.

- [ ] **Step 5: 통과 확인**

```bash
npx jest --testPathPattern=inbound.service.idempotency.spec
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>/dev/null || npx tsc --noEmit -p tsconfig.json
```
Expected: PASS (7 cases), tsc 에러 0. (InboundModule은 InventoryCommandService를 이미 주입받으므로 core 모듈 import가 존재 — 해당 모듈 파일에서 확인만.)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/inbound/
git commit -m "[core] 입고 7개 경로 요청 멱등화 — required idempotencyKey (P2-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: movement DTO + `MovementService` 2개 핸들러 배선 (TDD)

**Files:**
- Modify: `apps/core/src/modules/inventory/movement/dto/move-batch.dto.ts` (`MoveBatchDto` :39)
- Modify: `apps/core/src/modules/inventory/movement/dto/inter-warehouse-transfer.dto.ts` (`InterWarehouseTransferDto` :4)
- Modify: `apps/core/src/modules/inventory/movement/services/movement.service.ts`
- Create: `apps/core/src/modules/inventory/movement/services/movement.service.idempotency.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `withIdempotency`.
- Produces: `moveImmediately`/`createInterWarehouseTransfer`가 `dto.idempotencyKey` required로 동작.

- [ ] **Step 1: 실패하는 배선 테스트 작성**

`movement.service.idempotency.spec.ts`:

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
    // 사전 검증(로케이션 조회 등)을 통과시키기 어려우므로 검증 로직이 래퍼 앞에 있으면
    // 이 테스트는 검증 의존성 모킹이 필요 — 구현 시 검증도 래퍼 안(handler 첫머리)으로 이동해 단순화
    const dto = { warehouseId: 'w', lines: [], idempotencyKey: 'k' };
    const result = await svc.moveImmediately(dto as never);
    // 이 두 메서드는 tx? 파라미터가 없어 래퍼를 4개 인자로 호출 — 기대 인자 수를 맞춘다
    expect(withIdempotency).toHaveBeenCalledWith('movement.move', 'k', dto, expect.any(Function));
    expect(result).toBe(SENTINEL);
  });

  it('createInterWarehouseTransfer → withIdempotency(movement.inter-warehouse, …)', async () => {
    const { svc, withIdempotency } = build();
    const dto = { skuId: 's', fromWarehouseId: 'a', toWarehouseId: 'b', quantity: 1, idempotencyKey: 'k' };
    const result = await svc.createInterWarehouseTransfer(dto as never);
    expect(withIdempotency).toHaveBeenCalledWith('movement.inter-warehouse', 'k', dto, expect.any(Function));
    expect(result).toBe(SENTINEL);
  });
});
```

주의: `MovementService` 생성자의 실제 기존 파라미터 수를 파일(:12)에서 확인해 `build()`의 `{} as never` 개수를 맞출 것. 또한 `moveImmediately`는 `dbService.run`(:53) **앞**에 사전 검증 블록(:21-51)이 있음 — 래퍼 배선 시 이 검증 블록을 handler 첫머리(래퍼 안)로 이동해, 검증 실패도 tx 롤백으로 키를 남기지 않게 한다(위 테스트가 이 구조를 전제).

- [ ] **Step 2: 실패 확인**

```bash
npx jest --testPathPattern=movement.service.idempotency.spec
```
Expected: FAIL.

- [ ] **Step 3: DTO + 서비스 구현**

(a) `MoveBatchDto`(:39)와 `InterWarehouseTransferDto`(:4)에 Task 4 Step 3과 동일한 `idempotencyKey` 필드 추가 (각 파일 import에 `IsString`/`IsNotEmpty`/`MaxLength` 없으면 보강).

(b) `movement.service.ts`: import + 생성자 마지막 파라미터 `private readonly idempotency: InventoryIdempotencyService,` 추가.

(c) `moveImmediately`(:21): 사전 검증 블록(:21-51)을 `dbService.run` 콜백 첫머리로 이동한 뒤, `return this.dbService.run(async (tx) => {` → `return this.idempotency.withIdempotency('movement.move', dto.idempotencyKey, dto, async (tx) => {` 교체, 닫는 `});`는 `}, undefined);` 대신 그대로 `});` (tx 파라미터 없음 — 래퍼 마지막 인자 생략).

(d) `moveImmediately`의 lines 루프를 `for (const [i, line] of dto.lines.entries())`로 바꾸고 `stockEventStore.createEvent`(:92 부근) 입력에 `idempotencyKey: \`${dto.idempotencyKey}:${i}\`,` 추가.

(e) `createInterWarehouseTransfer`(:170): `return this.dbService.run(async (tx) => {`(:203) → `return this.idempotency.withIdempotency('movement.inter-warehouse', dto.idempotencyKey, dto, async (tx) => {` 교체. `createEvent`(:220 부근) 입력에 `idempotencyKey: dto.idempotencyKey,` 추가. (이 경로는 P0-1로 WS-B에서 재배선 예정 — DTO·래퍼는 유지되므로 그대로 적용.)

- [ ] **Step 4: 통과 확인 + 커밋**

```bash
npx jest --testPathPattern=movement.service.idempotency.spec
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>/dev/null || npx tsc --noEmit -p tsconfig.json
git add apps/core/src/modules/inventory/movement/
git commit -m "[core] 이동 2개 경로 요청 멱등화 — required idempotencyKey (P2-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: admin-web — `useIdempotentMutation` + 클라이언트/타입 배선

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (`WithIdempotencyKey` 타입 추가)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/inbound.client.ts` (7개 메서드 시그니처)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/movement.client.ts` (`moveImmediately`)
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts` (래퍼 훅 + 8개 훅 전환)

**Interfaces:**
- Consumes: 서버의 required `idempotencyKey` (Task 4·5).
- Produces: 컴포넌트 call site 무수정 — `mutate(data)` 시그니처 불변. `movement/inter-warehouse`는 admin-web 클라이언트 부재(확인됨) — 변경 없음.

- [ ] **Step 1: 타입 추가**

`lib/types/dto/inventory.ts` 상단에:

```typescript
/** 서버가 required 로 요구하는 요청 멱등 키를 부착한 wire 타입 (P2-4) */
export type WithIdempotencyKey<T> = T & { idempotencyKey: string };
```

- [ ] **Step 2: 클라이언트 시그니처 변경**

`inbound.client.ts` — 7개 메서드의 `data` 파라미터 타입을 `WithIdempotencyKey<…>`로 (import에 `WithIdempotencyKey` 추가): `simple`/`simpleFullscan`(`WithIdempotencyKey<SimpleInboundDto>`), `individual`, `putaway`, `return`, `cancel`, `plans.receive`. 예:

```typescript
  simple: async (data: WithIdempotencyKey<SimpleInboundDto>): Promise<SimpleInboundResponseDto> => {
    const response = await client.post(`${BASE}/simple`, data);
    return response.data;
  },
```

`movement.client.ts` — `moveImmediately`의 `data`를 `WithIdempotencyKey<MoveBatchRequestDto>`로.

- [ ] **Step 3: `useIdempotentMutation` 래퍼 + 8개 훅 전환**

`mutations.ts` 상단(import 뒤)에 추가 (`useRef`는 `react`에서, `isCustomError`는 `../../api/customError`에서 import):

```typescript
/**
 * 멱등 키 수명주기를 관리하는 mutation 래퍼 (P2-4, 스펙 §5).
 * - 키를 ref 로 유지: react-query 재시도·네트워크 오류 후 재클릭이 같은 키 재사용 → 서버 replay
 * - 성공 시 키 교체(다음 제출은 새 작업), 4xx 시 교체(서버 미커밋 확정)
 * - 네트워크/타임아웃/5xx 는 키 유지: 서버가 커밋했을 수 있으므로 재시도가 replay 돼야 함
 */
function useIdempotentMutation<TVars, TData>(opts: {
  mutationFn: (vars: TVars, idempotencyKey: string) => Promise<TData>;
  onSuccess?: (data: TData, vars: TVars) => void;
}) {
  const keyRef = useRef<string>(crypto.randomUUID());
  return useMutation({
    mutationFn: (vars: TVars) => opts.mutationFn(vars, keyRef.current),
    onSuccess: (data, vars) => {
      keyRef.current = crypto.randomUUID();
      opts.onSuccess?.(data, vars);
    },
    onError: (error) => {
      if (isCustomError(error) && error.statusCode < 500) {
        keyRef.current = crypto.randomUUID();
      }
    },
  });
}
```

8개 훅 전환 — 각각 `useMutation` → `useIdempotentMutation`, `mutationFn`이 두 번째 인자로 키를 받아 payload에 부착. `onSuccess`의 invalidate 로직은 기존 그대로 유지. 전환 목록과 코드:

```typescript
export const useSimpleInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: SimpleInboundDto, idempotencyKey) => inboundClient.simple({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};

export const useSimpleFullscanInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: SimpleInboundDto, idempotencyKey) => inboundClient.simpleFullscan({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};

export const useIndividualInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: IndividualInboundDto, idempotencyKey) => inboundClient.individual({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
    },
  });
};

export const useReceiveFromPlan = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: ReceiveFromPlanDto, idempotencyKey) => inboundClient.plans.receive({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inbounds });
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundPending() });
    },
  });
};

export const usePutaway = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: PutawayRequestDto, idempotencyKey) => inboundClient.putaway({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

export const useReturnInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: ReturnInboundDto, idempotencyKey) => inboundClient.return({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

export const useCancelInbound = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: CancelInboundDto, idempotencyKey) => inboundClient.cancel({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.inboundReceipts() });
    },
  });
};

export const useMoveImmediately = () => {
  const queryClient = useQueryClient();
  return useIdempotentMutation({
    mutationFn: (data: MoveBatchRequestDto, idempotencyKey) => movementClient.moveImmediately({ ...data, idempotencyKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'movement', 'history'] });
    },
  });
};
```

- [ ] **Step 4: 타입/빌드 확인**

```bash
cd apps/admin-web && npx tsc --noEmit && cd ../..
```
Expected: 에러 0. (에러가 나오면 컴포넌트가 payload에 임의로 `idempotencyKey`를 넣던 곳 — 없어야 정상.)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib/
git commit -m "[admin-web] 입고/이동 mutation 멱등 키 자동 부착 — useIdempotentMutation (P2-4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 통합 스펙(⏸ dev DB) + 최종 검증 + 상황판 갱신

**Files:**
- Create: `apps/core/src/modules/inventory/core/services/inventory-idempotency.integration.spec.ts`
- Modify: `docs/logistics-backend-hardening-2026-07.md` (P2-4 행 + §5 WS-A 블록)

**Interfaces:**
- Consumes: Task 1~5 전부.

- [ ] **Step 1: 통합 스펙 작성 (rollback-only 하네스 재사용)**

`ledger-reconciliation.integration.spec.ts`의 하네스(`describeIfDb = DATABASE_URL ? describe : describe.skip`, `postgres(DATABASE_URL,{max:1})` + `inRollbackTx`, 시드 헬퍼)를 **그대로 복사·재사용**해 작성. `InboundService`를 실제 의존성(같은 파일의 조립 방식대로 `StockEventStore`/`InventoryCommandService` 등 + 신규 `InventoryIdempotencyService`)으로 조립. 케이스 (각각 `inRollbackTx` 안에서, 같은 tx 전달로 2회 호출):

```typescript
// 1. simpleInbound 같은 키 2회 → 두 응답 deep-equal, stock_events 1건, inbound_receipts 1건
const dto = { warehouseId: wh.id, items: [{ skuId: sku.id, quantity: 5 }], idempotencyKey: randomUUID() };
const r1 = await inbound.simpleInbound(dto, tx);
const r2 = await inbound.simpleInbound(dto, tx);
expect(r2).toEqual(r1);
// stock_events / inbound_receipts 건수를 trx.select()로 조회해 각각 1 확인

// 2. returnInbound 같은 키 2회 → returnedQty 1회만 증가 (라인 재조회로 확인)

// 3. 같은 키 + 다른 본문 → ConflictError

// 4. moveImmediately 같은 키 2회 → movement_jobs 1건, MOVE 이벤트 lines 수만큼 1회만
```

주의: 케이스 1·2는 시드(창고/로케이션/SKU/원장)를 하네스의 기존 `seed` 헬퍼 방식으로 준비. **같은 tx 안 2회 호출**은 요청 레벨 replay를 검증하기에 충분하다(unique 충돌은 tx 내에서도 발생).

- [ ] **Step 2: 통합 스펙 실행 시도**

```bash
DATABASE_URL="${DATABASE_URL:-}" npx jest --testPathPattern=inventory-idempotency.integration
```
Expected: dev DB 부재 시 `skipped` (describeIfDb). DB가 있으면 PASS. **dev DB 부재 시 ⏸ 항목으로 기록하고 진행** (작업 1·2와 동일 관례).

- [ ] **Step 3: 전체 회귀 검증**

```bash
npx jest --testPathPattern='inventory' 2>&1 | tail -15   # arch spec 포함 inventory 단위 전체
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>/dev/null || npx tsc --noEmit -p tsconfig.json
npm run lint -- --quiet 2>&1 | tail -5
```
Expected: 전부 GREEN (arch test `inventory-write-boundary.arch.spec.ts` 포함 — 신규 코드는 stockEvents 직접 INSERT 없음).

- [ ] **Step 4: 상황판 갱신**

`docs/logistics-backend-hardening-2026-07.md`:
- P2-4 행(:68) 상태 `⬜` → `🟩`, 결함 설명 끝에 완료 요약 1문장 추가: `**완료(작업3): 전용 idempotency 테이블+래퍼로 9개 경로 요청 멱등화, 이벤트 파생 키 병행, admin-web 키 수명주기 래퍼**`.
- §5 WS-A 블록(:141)의 "WS-A 잔여(미착수): P0-4, P2-2, P2-4" → `P0-4, P2-2`로 수정하고, 작업 1·2 블록과 같은 형식으로 **작업 3 완료 블록** 추가 (브랜치명·tip 해시·스펙/계획 경로·⏸ 통합 스펙 dev DB 대기 명기).
- 작업 2 블록(:138)의 "develop 미머지, 머지 후 해시 기입" → `develop 스쿼시 머지 \`ae5f979c0\` (2026-07-09)`로 정정.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/core/services/inventory-idempotency.integration.spec.ts docs/logistics-backend-hardening-2026-07.md
git commit -m "[core][docs] 멱등화 통합 스펙(⏸ dev DB) + 하드닝 상황판 P2-4 완료 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 완료 기준

- 9개 엔드포인트 전부 required `idempotencyKey` + `withIdempotency` 래핑 + 이벤트 파생 키.
- 단위 스펙(래퍼 6케이스 + purge 1 + 배선 7+2) GREEN, tsc·lint·arch test GREEN.
- admin-web `tsc --noEmit` GREEN, 컴포넌트 call site 무수정.
- 통합 스펙 4케이스 작성 완료 (dev DB 부재 시 ⏸ — DB 복구 시 실행이 배포 전 조건).
- 상황판 P2-4 🟩 + 작업 2 머지 해시 정정.
