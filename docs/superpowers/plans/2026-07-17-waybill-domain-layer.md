# 운송장(waybill) 도메인 계층 (플랜 2/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플랜 1의 캐리어 통합 계층 위에, `waybills` 1테이블 + 경량 상태머신 + CLAUDE.md 정식 레이어(Repository→Reader/Manager→Service→Controller)로 운송장 발급·수동등록·void·재발급·디스패치 seam을 구현한다. **invoices 는 건드리지 않는다(additive)** — 소비자 rewire·구 invoice drop 은 플랜 3.

**Architecture:** `waybills` durable 행 + `WaybillIssueMachine.drive()`(pending→allocated→registered CAS 전이)로 크래시 안전 발급. 외부 HTTP(allocate=print-wbl, register=insert-order)는 **트랜잭션 밖**에서 수행하고 전이만 짧은 tx 로 CAS 영속. 멱등 앵커 = `trackingNo` 부분 UNIQUE + 한진 ERROR-09. 발급/재발급/배치(carrier I/O)는 자체 tx 관리, seam(registerManual·void·markUsed·assertDispatchable·getActiveWaybill)은 `tx?` 전파.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), TypeScript, Jest(unit + DB integration), `@app/db`(`DbService`/`@InjectTypedDb`/`DbTx`), `@app/shared` 예외, native `fetch`(플랜 1 클라이언트).

**설계 근거(SoT):** `docs/superpowers/specs/2026-07-17-waybill-module-redesign-design.md` — §3.1(확정된 미정사항), §5(스키마), §8(상태머신), §9(서비스/컨트롤러), §10(배치), §11(void/재발급), §13(에러). 이 플랜은 그 §5·§8·§9·§10·§11 을 구현한다.

## Global Constraints

- **Additive only.** `inventory.schema.ts` 의 `invoices`/`invoiceOperations`/invoice enum·relations 를 **삭제하지 않는다**. `waybills` + enum 2종만 추가. 기존 invoice 통합 테스트가 계속 green 이어야 함(무회귀). 구 invoice drop 은 플랜 3.
- **DB 주입**: `@InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>`. `DbTx, inventoryTables, inventorySchema` 는 `apps/core/src/modules/inventory/schema/inventory.schema.ts` 에서 import(`inventoryTables===wmsTables`, `inventorySchema===wmsSchema`, `DbTx=TxFor<typeof wmsSchema>`). `DbModule` 은 global 이라 WaybillModule 에서 DB 모듈 import 불필요.
- **트랜잭션 규칙(ADR-0025)**: 단일 러너 `dbService.run(async (trx)=>{...}, tx)`. 절대 per-class `inTx` 헬퍼·`asTx` 캐스팅 금지. carrier I/O 를 tx 안에서 호출 금지.
- **쿼리 규칙**: `db.query.*`·`with` relations·`any`/`as` 캐스팅 금지. `trx.select().from().innerJoin().where().orderBy()` + drizzle 연산자만.
- **예외**: `@app/shared` 의 `NotFoundError`/`BadRequestError`/`ConflictError`(message-only 생성자). 메시지 앞에 `WAYBILL_*` 코드 토큰을 붙여 관측·테스트 단언 가능하게. 구 오케스트레이터의 `conflict()`/Nest `ConflictException` 스타일 **계승 안 함**.
- **recipientHash**: `canonicalFulfillmentRequestHash(recipientSnapshot)` (export from `apps/core/src/modules/fulfillment/services/fulfillment-command.service.ts` — 플랜 3에도 존속). 발급 시점 저장, `assertDispatchable` 이 현재 shipment 와 대조. 구 `canonicalShipmentRecipientHash`(invoice-orchestrator, 플랜 3 삭제)는 import 금지 — 값은 동일(둘 다 canonicalize+sha256).
- **idempotency**: 모든 쓰기는 `FulfillmentCommandService.execute<T>({commandType, idempotencyKey, canonicalRequest}, handler, tx?)` 재사용. handler=`(trx, commandRequestId, requestHash)=>Promise<{response,resourceType,resourceId,operationId?}>`.
- **carrier 값**: 기존 `carrierEnum=['CJ','HANJIN','LOTTE','LOGEN','KDEXP','CJGLS']`(inventory.schema.ts:77). 현재 발급 대상은 `HANJIN` 만.
- **검증 게이트(태스크마다)**: `npx tsc -p apps/core/tsconfig.app.json --noEmit` exit 0(ts-jest 는 transpile-only 라 타입에러 못 잡음) + 해당 테스트 통과 + `npx eslint --fix <changed files>` 신규 error 0.
- **테스트 러너**: 단위 `npm run test -- --testPathPattern=<pattern>`. DB 통합 `npm run test:core:integration:local -- <pattern>`(러너가 compose postgres+migrate+jest --runInBand). 통합 spec 은 `DATABASE_URL` 없으면 `describe.skip`.

## File Structure

신규(모두 `apps/core/src/modules/fulfillment/waybill/` 하위):
```
waybill/
  waybill.constants.ts            # CAP·배치·에러코드·custOrdNo prefix
  cust-ord-no.ts (+ .spec)        # deriveCustOrdNo(shipmentId): 'AY'+base32
  waybill.types.ts                # WaybillRow/WaybillView/IssueContext 타입
  waybill-request.assembler.ts (+ .spec)   # shipment+manifest+config → WaybillRequest
  waybill.repository.ts (+ .integration.spec)  # DB 접근(insert/CAS/select)
  waybill-issue.machine.ts (+ .spec)       # drive() 상태전이(unit, fakes)
  waybill.reader.ts (+ .integration.spec)  # loadIssueContext/getActiveWaybill/dispatchability
  waybill.manager.ts (+ .integration.spec) # 검증+오케스트레이션(issue/manual/void/reissue/seam/batch)
  waybill.service.ts              # 얇은 포트
  dto/waybill.dto.ts              # 요청/응답 DTO
  waybill.controller.ts (+ .spec)  # 라우트 6
  waybill.module.ts               # 모듈(carrier factory+registry, WaybillService export)
  carrier/carrier-gateway.registry.ts      # Map<CarrierCode, CarrierGateway>
  carrier/hanjin/carrier-gateway.factory.ts # loadHanjinConfig→signer→client→gateway
  __support__/waybill-fixtures.ts # seedPlannedShipmentForWaybill + fakeCarrierGateway
scripts/smoke/hanjin-staging-smoke.ts       # 게이트된 실사격 스모크
```
수정:
```
apps/core/src/modules/inventory/schema/inventory.schema.ts  # enum 2종 + waybills + wmsTables 등록(additive)
apps/core/drizzle/<ts>_add-waybills.sql                      # 생성된 additive 마이그레이션
apps/core/src/app.module.ts                                  # WaybillModule import
```

---

## Task 1: `waybills` 스키마 + enum + 마이그레이션 (additive)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/<timestamp>_add-waybills.sql` (드리즐 생성)
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.repository.integration.spec.ts` (Task 4 에서 확장; 이 태스크는 제약 스모크만)

**Interfaces:**
- Produces: `waybillStatusEnum`, `waybillSourceEnum`, `waybills` (drizzle table) + `Waybill = InferSelectModel<typeof waybills>` / `NewWaybill = InferInsertModel<typeof waybills>`. 모두 `inventoryTables.waybills` 로 접근 가능.

- [ ] **Step 1: 실패 통합 테스트 작성** — 활성 유니크·부분 trackingNo 유니크 제약 검증

`apps/core/src/modules/fulfillment/waybill/waybill.constraints.integration.spec.ts`:
```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../../services/__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('waybills constraints (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  beforeAll(() => { ({ sql: client, db } = makeDb(DATABASE_URL as string)); });
  afterAll(async () => { await client.end(); });

  async function seedShipment(tx: DbTx): Promise<string> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const [s] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'planned' }).returning();
    return s.id;
  }

  it('rejects a second ACTIVE waybill for the same shipment', async () => {
    await inRollbackTx(db, async (tx) => {
      const shipmentId = await seedShipment(tx);
      await tx.insert(wmsTables.waybills).values({
        shipmentId, source: 'manual', carrier: 'HANJIN', status: 'registered',
        trackingNo: `T-${randomUUID().slice(0, 8)}`, manifestVersion: 1, recipientHash: 'a'.repeat(64),
      });
      await expect(
        tx.insert(wmsTables.waybills).values({
          shipmentId, source: 'manual', carrier: 'HANJIN', status: 'registered',
          trackingNo: `T-${randomUUID().slice(0, 8)}`, manifestVersion: 1, recipientHash: 'a'.repeat(64),
        }),
      ).rejects.toThrow(/uq_waybills_shipment_active/);
    });
  });

  it('allows a new active waybill once the prior one is voided (slot released)', async () => {
    await inRollbackTx(db, async (tx) => {
      const shipmentId = await seedShipment(tx);
      const [first] = await tx.insert(wmsTables.waybills).values({
        shipmentId, source: 'manual', carrier: 'HANJIN', status: 'voided',
        trackingNo: `T-${randomUUID().slice(0, 8)}`, manifestVersion: 1, recipientHash: 'a'.repeat(64),
      }).returning();
      // voided 는 슬롯 해제 → 새 active 삽입 성공
      await tx.insert(wmsTables.waybills).values({
        shipmentId, source: 'manual', carrier: 'HANJIN', status: 'registered',
        trackingNo: `T-${randomUUID().slice(0, 8)}`, manifestVersion: 1, recipientHash: 'a'.repeat(64),
      });
      expect(first.status).toBe('voided');
    });
  });

  it('check: allocated/registered/used require trackingNo', async () => {
    await inRollbackTx(db, async (tx) => {
      const shipmentId = await seedShipment(tx);
      await expect(
        tx.insert(wmsTables.waybills).values({
          shipmentId, source: 'carrier', carrier: 'HANJIN', status: 'registered',
          trackingNo: null, manifestVersion: 1, recipientHash: 'a'.repeat(64),
        }),
      ).rejects.toThrow(/ck_waybills_tracking_present/);
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:core:integration:local -- waybill.constraints`
Expected: FAIL — `relation "waybills" does not exist` (테이블 미생성).

- [ ] **Step 3: enum + 테이블 추가** — `inventory.schema.ts`. `carrierEnum`(line 77) 아래, `invoices` 정의(≈2278) 근처 **뒤**에 배치. 기존 `invoices` 는 그대로 둔다.

```typescript
export const waybillStatusEnum = pgEnum('waybill_status', [
  'pending',
  'allocated',
  'registered',
  'used',
  'voided',
  'failed',
  'abandoned',
]);
export const waybillSourceEnum = pgEnum('waybill_source', ['carrier', 'manual']);

export const waybills = pgTable(
  'waybills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    source: waybillSourceEnum('source').notNull(),
    carrier: carrierEnum('carrier').notNull(),
    status: waybillStatusEnum('status').notNull().default('pending'),
    trackingNo: varchar('tracking_no', { length: 128 }),
    custOrdNo: varchar('cust_ord_no', { length: 30 }),
    labelData: jsonb('label_data'),
    manifestVersion: integer('manifest_version').notNull(),
    recipientHash: varchar('recipient_hash', { length: 64 }).notNull(),
    lastError: text('last_error'),
    attempts: integer('attempts').notNull().default(0),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxShipment: index('idx_waybills_shipment').on(t.shipmentId),
    idxStatus: index('idx_waybills_status').on(t.status),
    idxTrackingNo: index('idx_waybills_tracking_no').on(t.trackingNo),
    // shipment 당 활성 운송장 1개. 종료 3상태(voided/failed/abandoned) 슬롯 해제.
    uqActivePerShipment: uniqueIndex('uq_waybills_shipment_active')
      .on(t.shipmentId)
      .where(sql`${t.status} NOT IN ('voided', 'failed', 'abandoned')`),
    // live 운송장 사이에서만 trackingNo 유일(멱등 앵커). 종료 상태 제외라 오void 번호 재등록 허용.
    uqLiveTrackingNo: uniqueIndex('uq_waybills_tracking_live')
      .on(t.trackingNo)
      .where(sql`${t.trackingNo} IS NOT NULL AND ${t.status} NOT IN ('voided', 'failed', 'abandoned')`),
    ckTrackingPresent: check(
      'ck_waybills_tracking_present',
      sql`${t.status} NOT IN ('allocated', 'registered', 'used') OR ${t.trackingNo} IS NOT NULL`,
    ),
    ckManualStatus: check(
      'ck_waybills_manual_status',
      sql`${t.source} <> 'manual' OR ${t.status} IN ('registered', 'used', 'voided')`,
    ),
    ckAttempts: check('ck_waybills_attempts', sql`${t.attempts} >= 0`),
    ckRecipientHash: check('ck_waybills_recipient_hash', sql`length(${t.recipientHash}) = 64`),
    ckManifestVersion: check('ck_waybills_manifest_version', sql`${t.manifestVersion} > 0`),
  }),
);
```

- [ ] **Step 4: 타입 export + wmsTables 등록** — 같은 파일. `invoices` 타입 export 부근에 추가하고, `wmsTables` 객체(테이블 집계, ≈4100 근처)에 `waybills` 를 포함시킨다(누락하면 `DbService` 가 테이블을 못 봄).

```typescript
export type Waybill = InferSelectModel<typeof waybills>;
export type NewWaybill = InferInsertModel<typeof waybills>;
```
그리고 `wmsTables` 리터럴에 `waybills,` 한 줄 추가(기존 `invoices,` 인접). enum 은 테이블에 물려 자동 포함되므로 별도 등록 불필요.

- [ ] **Step 5: 마이그레이션 생성 + SQL 리뷰**

Run: `npm run db:generate:core -- --name add-waybills`
Expected: `apps/core/drizzle/<timestamp>_add-waybills.sql` 생성. **리뷰**: `CREATE TYPE waybill_status`, `CREATE TYPE waybill_source`, `CREATE TABLE waybills`, 2개 partial `CREATE UNIQUE INDEX ... WHERE`, check 5개만 있어야 함. `invoices`/`invoice_operations` 관련 `DROP`/`ALTER` 이 **한 줄도 없어야** 한다(있으면 스키마 편집이 기존 정의를 건드린 것 → 되돌리고 재생성). rename 프롬프트가 뜨면 `+`(create) 선택.

- [ ] **Step 6: 마이그레이션 적용 + 테스트 통과**

Run: `npm run test:core:integration:local -- waybill.constraints`
Expected: PASS(3 tests). 러너가 compose DB 에 마이그레이션을 적용한 뒤 실행. (로컬 dev DB 에도 반영하려면 `npm run db:setup -- --stage dev --deployment lcnine-services`.)

- [ ] **Step 7: tsc + commit**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/fulfillment/waybill/waybill.constraints.integration.spec.ts
git commit -m "feat(waybill): waybills 테이블 + enum 2종 + additive 마이그레이션"
```

---

## Task 2: `deriveCustOrdNo` + 상수 (§3.1-1)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.constants.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/cust-ord-no.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/cust-ord-no.spec.ts`

**Interfaces:**
- Produces: `deriveCustOrdNo(shipmentId: string): string` (28자, `'AY'`+Crockford-base32(16B)); `WAYBILL` 상수(`ERROR` 코드맵, `PENDING_ATTEMPTS_CAP`, `BATCH_CONCURRENCY`, `BATCH_TIME_BUDGET_MS`, `CUST_ORD_NO_PREFIX`).

- [ ] **Step 1: 실패 단위 테스트**

`cust-ord-no.spec.ts`:
```typescript
import { deriveCustOrdNo } from './cust-ord-no';

describe('deriveCustOrdNo', () => {
  const A = '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  const B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  it('is 28 chars: AY + 26 base32', () => {
    expect(deriveCustOrdNo(A)).toHaveLength(28);
  });
  it('starts with AY and uses only Crockford base32 chars', () => {
    expect(deriveCustOrdNo(A)).toMatch(/^AY[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });
  it('is deterministic', () => {
    expect(deriveCustOrdNo(A)).toBe(deriveCustOrdNo(A));
  });
  it('is injective for distinct shipment ids', () => {
    expect(deriveCustOrdNo(A)).not.toBe(deriveCustOrdNo(B));
  });
  it('is ≤ 30 bytes (fits varchar(30))', () => {
    expect(Buffer.byteLength(deriveCustOrdNo(A), 'utf8')).toBeLessThanOrEqual(30);
  });
  it('rejects a non-uuid input', () => {
    expect(() => deriveCustOrdNo('not-a-uuid')).toThrow(/invalid uuid/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- --testPathPattern=cust-ord-no`
Expected: FAIL — cannot find module `./cust-ord-no`.

- [ ] **Step 3: 상수 작성** — `waybill.constants.ts`:
```typescript
export const WAYBILL = {
  CUST_ORD_NO_PREFIX: 'AY',
  PENDING_ATTEMPTS_CAP: 5, // pending unknown_outcome 지속 시 자동 abandon 임계(§8). allocated 는 무제한.
  BATCH_CONCURRENCY: 8, // issueBatch bounded 병렬(§10).
  BATCH_TIME_BUDGET_MS: 45_000, // 동기 배치 시간예산(< ALB 60s). 초과 시 미완건 조기반환(§10).
  ERROR: {
    NOT_FOUND: 'WAYBILL_NOT_FOUND',
    SHIPMENT_NOT_FOUND: 'WAYBILL_SHIPMENT_NOT_FOUND',
    ACTIVE_EXISTS: 'WAYBILL_ACTIVE_EXISTS',
    RECIPIENT_INCOMPLETE: 'WAYBILL_RECIPIENT_INCOMPLETE',
    STALE_MANIFEST_VERSION: 'WAYBILL_STALE_MANIFEST_VERSION',
    NOT_DISPATCHABLE: 'WAYBILL_NOT_DISPATCHABLE',
    STALE: 'WAYBILL_STALE',
    ALREADY_DISPATCHED: 'WAYBILL_ALREADY_DISPATCHED',
    NOT_VOIDABLE: 'WAYBILL_NOT_VOIDABLE',
    TRACKING_EXISTS: 'WAYBILL_TRACKING_EXISTS',
    CARRIER_NOT_CONFIGURED: 'WAYBILL_CARRIER_NOT_CONFIGURED',
    ISSUE_FAILED: 'WAYBILL_ISSUE_FAILED',
    ABANDON_NOT_ALLOWED: 'WAYBILL_ABANDON_NOT_ALLOWED',
  },
} as const;

// 종료(슬롯 해제) 상태. 활성 유니크 WHERE 와 동치.
export const WAYBILL_TERMINAL_STATUSES = ['voided', 'failed', 'abandoned'] as const;
// 디스패치 가능 상태.
export const WAYBILL_DISPATCHABLE_STATUSES = ['registered', 'used'] as const;
```

- [ ] **Step 4: `deriveCustOrdNo` 구현** — `cust-ord-no.ts`:
```typescript
import { WAYBILL } from './waybill.constants';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// shipment UUID(128bit) → 'AY' + Crockford base32(26자) = 28자(≤30B). 결정적·전단사(§3.1-1).
export function deriveCustOrdNo(shipmentId: string): string {
  const hex = shipmentId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`deriveCustOrdNo: invalid uuid ${shipmentId}`);
  }
  const bytes = Buffer.from(hex, 'hex'); // 16 bytes
  let value = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(value << (5 - bits)) & 31];
  }
  return WAYBILL.CUST_ORD_NO_PREFIX + out;
}
```

- [ ] **Step 5: 통과 확인 + tsc**

Run: `npm run test -- --testPathPattern=cust-ord-no` → PASS(6)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0

- [ ] **Step 6: commit**
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.constants.ts apps/core/src/modules/fulfillment/waybill/cust-ord-no.ts apps/core/src/modules/fulfillment/waybill/cust-ord-no.spec.ts
git commit -m "feat(waybill): custOrdNo 파생(AY+base32) + 상수"
```

---

## Task 3: `WaybillRequest` 어셈블러 + 수취인 파싱

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.types.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.spec.ts`

**Interfaces:**
- Consumes: `WaybillRequest`, `CarrierCode`(carrier-gateway.interface.ts), `HanjinConfig`(hanjin.config.ts), `deriveCustOrdNo`(Task 2).
- Produces: `parseRecipient(snapshot: unknown): WaybillRecipient`; `assembleWaybillRequest(input: AssembleInput): WaybillRequest`. `IssueContext`/`WaybillRecipient`/`ManifestLineLite` 타입(`waybill.types.ts`).

- [ ] **Step 1: 타입 정의** — `waybill.types.ts`:
```typescript
import type { Waybill } from '../../inventory/schema/inventory.schema';

export type WaybillRow = Waybill;

// recipientSnapshot(AddressDto) 의 안전한 부분집합. 발급 시점 assertRecipientComplete 로 5필드 보장.
export interface WaybillRecipient {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote?: string;
}

export interface ManifestLineLite {
  productName: string;
  quantity: number;
  skuId: string;
}

// Reader.loadIssueContext 반환 — 발급 조립에 필요한 최소 컨텍스트.
export interface IssueContext {
  shipmentId: string;
  status: string; // shipments.status
  manifestVersion: number;
  recipientSnapshot: unknown; // 원본(해시 대상)
  lines: ManifestLineLite[];
}

// 컨트롤러/서비스 응답.
export interface WaybillView {
  id: string;
  shipmentId: string;
  source: 'carrier' | 'manual';
  carrier: string;
  status: string;
  trackingNo: string | null;
  custOrdNo: string | null;
  manifestVersion: number;
  issuedAt: string | null;
  voidedAt: string | null;
  lastError: string | null;
}
```

- [ ] **Step 2: 실패 단위 테스트** — `waybill-request.assembler.spec.ts`:
```typescript
import { assembleWaybillRequest, parseRecipient } from './waybill-request.assembler';
import type { HanjinConfig } from '../carrier/hanjin/hanjin.config';

const config: HanjinConfig = {
  clientId: 'CID', apiKey: 'AK', secretKey: 'SK', contractNo: 'CN',
  orderBaseUrl: 'https://o', printBaseUrl: 'https://p', timeoutMs: 15000,
  sender: { name: '보내는이', zip: '06236', baseAddress: '서울 강남구 테헤란로 1', detailAddress: '10층', tel: '02-100-2000' },
  boxType: 'A', payType: 'PP',
};
const snapshot = {
  recipientName: '홍길동', phone: '010-1234-5678', postalCode: '01234',
  roadAddress: '서울 종로구 세종대로 1', detailAddress: '101동 202호', deliveryNote: '문앞',
};
const shipmentId = '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('parseRecipient', () => {
  it('accepts a complete AddressDto snapshot', () => {
    expect(parseRecipient(snapshot).postalCode).toBe('01234');
  });
  it('throws RECIPIENT_INCOMPLETE when a required field is blank', () => {
    expect(() => parseRecipient({ ...snapshot, postalCode: '  ' })).toThrow(/WAYBILL_RECIPIENT_INCOMPLETE/);
  });
  it('throws when snapshot is null', () => {
    expect(() => parseRecipient(null)).toThrow(/WAYBILL_RECIPIENT_INCOMPLETE/);
  });
});

describe('assembleWaybillRequest', () => {
  const lines = [
    { productName: '아몬드유 30입', quantity: 2, skuId: 's1' },
    { productName: '아몬드유 60입', quantity: 1, skuId: 's2' },
  ];
  const req = assembleWaybillRequest({ shipmentId, recipientSnapshot: snapshot, lines, config });

  it('maps recipient split-address fields (postalCode→zip, roadAddress→baseAddress, phone→mobile, deliveryNote→message)', () => {
    expect(req.recipient).toEqual({
      name: '홍길동', zip: '01234', baseAddress: '서울 종로구 세종대로 1',
      detailAddress: '101동 202호', mobile: '010-1234-5678', message: '문앞',
    });
  });
  it('takes sender + box/pay from config', () => {
    expect(req.sender).toEqual(config.sender);
    expect(req.boxType).toBe('A');
    expect(req.payType).toBe('PP');
  });
  it('derives custOrdNo from shipmentId', () => {
    expect(req.custOrdNo).toMatch(/^AY[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
  });
  it('maps lines to items and summarizes commodityName', () => {
    expect(req.items).toEqual([
      { name: '아몬드유 30입', quantity: 2 },
      { name: '아몬드유 60입', quantity: 1 },
    ]);
    expect(req.commodityName).toBe('아몬드유 30입 외 1건');
  });
  it('omits message when deliveryNote absent', () => {
    const r = assembleWaybillRequest({
      shipmentId, recipientSnapshot: { ...snapshot, deliveryNote: undefined }, lines, config,
    });
    expect(r.recipient.message).toBeUndefined();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test -- --testPathPattern=waybill-request.assembler`
Expected: FAIL — cannot find module.

- [ ] **Step 4: 어셈블러 구현** — `waybill-request.assembler.ts`:
```typescript
import { BadRequestError } from '@app/shared';
import type { HanjinConfig } from '../carrier/hanjin/hanjin.config';
import type { WaybillRequest } from '../carrier/carrier-gateway.interface';
import { deriveCustOrdNo } from './cust-ord-no';
import { WAYBILL } from './waybill.constants';
import type { ManifestLineLite, WaybillRecipient } from './waybill.types';

const REQUIRED = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'] as const;

export function parseRecipient(snapshot: unknown): WaybillRecipient {
  const r = (snapshot ?? {}) as Record<string, unknown>;
  const missing = REQUIRED.filter((k) => typeof r[k] !== 'string' || !(r[k] as string).trim());
  if (missing.length) {
    throw new BadRequestError(`${WAYBILL.ERROR.RECIPIENT_INCOMPLETE}: missing ${missing.join(',')}`);
  }
  const note = typeof r.deliveryNote === 'string' && r.deliveryNote.trim() ? r.deliveryNote : undefined;
  return {
    recipientName: r.recipientName as string,
    phone: r.phone as string,
    postalCode: r.postalCode as string,
    roadAddress: r.roadAddress as string,
    detailAddress: r.detailAddress as string,
    deliveryNote: note,
  };
}

export interface AssembleInput {
  shipmentId: string;
  recipientSnapshot: unknown;
  lines: ManifestLineLite[];
  config: HanjinConfig;
}

export function assembleWaybillRequest(input: AssembleInput): WaybillRequest {
  const rc = parseRecipient(input.recipientSnapshot);
  const items = input.lines.map((l) => ({ name: l.productName, quantity: l.quantity }));
  const head = input.lines[0]?.productName ?? '';
  const commodityName = input.lines.length > 1 ? `${head} 외 ${input.lines.length - 1}건` : head;
  return {
    custOrdNo: deriveCustOrdNo(input.shipmentId),
    recipient: {
      name: rc.recipientName,
      zip: rc.postalCode,
      baseAddress: rc.roadAddress,
      detailAddress: rc.detailAddress,
      mobile: rc.phone, // 스냅샷은 phone 단일필드 → mobile 로(§조사4). tel 은 생략.
      message: rc.deliveryNote,
    },
    sender: input.config.sender,
    items,
    commodityName,
    boxType: input.config.boxType,
    payType: input.config.payType,
  };
}
```

- [ ] **Step 5: 통과 + tsc + commit**

Run: `npm run test -- --testPathPattern=waybill-request.assembler` → PASS
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.types.ts apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.ts apps/core/src/modules/fulfillment/waybill/waybill-request.assembler.spec.ts
git commit -m "feat(waybill): WaybillRequest 어셈블러 + 수취인 파싱(스냅샷→한진 매핑)"
```

---

## Task 4: `WaybillRepository` (DB 접근)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.repository.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.repository.integration.spec.ts`

**Interfaces:**
- Consumes: `DbService<typeof inventorySchema>`, `DbTx`, `inventoryTables`(waybills), `WAYBILL_TERMINAL_STATUSES`.
- Produces: `WaybillRepository` with methods:
  - `insertPending(trx, row): Promise<WaybillRow>` — carrier 발급 시작행.
  - `insertManualRegistered(trx, row): Promise<WaybillRow>` — source='manual' 즉시 registered.
  - `findById(trx, id): Promise<WaybillRow | undefined>`
  - `findActiveByShipment(trx, shipmentId): Promise<WaybillRow | undefined>` — status ∉ terminal.
  - `casToAllocated(trx, id, trackingNo, labelData): Promise<boolean>` — WHERE status='pending'.
  - `casToRegistered(trx, id, issuedAt): Promise<boolean>` — WHERE status='allocated'.
  - `casToUsed(trx, shipmentId): Promise<number>` — WHERE status IN dispatchable(멱등·엄격).
  - `casToVoided(trx, id, voidedAt): Promise<boolean>` — WHERE status='registered'.
  - `casToAbandoned(trx, id, fromStatus): Promise<boolean>`
  - `casToFailed(trx, id, lastError): Promise<boolean>` — WHERE status IN ('pending','allocated').
  - `incrementAttempts(trx, id): Promise<void>`

- [ ] **Step 1: 실패 통합 테스트** — `waybill.repository.integration.spec.ts`:
```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';
import { makeDb, makeDbService, inRollbackTx, seedWarehouseWithZone } from '../../services/__support__';
import { WaybillRepository } from './waybill.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillRepository (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let repo: WaybillRepository;
  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    repo = new WaybillRepository(makeDbService(db));
  });
  afterAll(async () => { await client.end(); });

  async function shipment(tx: DbTx): Promise<string> {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const [s] = await tx.insert(wmsTables.shipments).values({ warehouseId, status: 'planned' }).returning();
    return s.id;
  }
  const base = (shipmentId: string) => ({
    shipmentId, source: 'carrier' as const, carrier: 'HANJIN' as const,
    custOrdNo: 'AYTEST', manifestVersion: 1, recipientHash: 'a'.repeat(64),
  });

  it('pending → allocated CAS only fires from pending', async () => {
    await inRollbackTx(db, async (tx) => {
      const sid = await shipment(tx);
      const wb = await repo.insertPending(tx, base(sid));
      expect(wb.status).toBe('pending');
      const t = `T-${randomUUID().slice(0, 8)}`;
      expect(await repo.casToAllocated(tx, wb.id, t, { s_tml_cod: 'x' })).toBe(true);
      // 두번째 시도는 pending 아님 → false
      expect(await repo.casToAllocated(tx, wb.id, t, {})).toBe(false);
      const after = await repo.findById(tx, wb.id);
      expect(after?.status).toBe('allocated');
      expect(after?.trackingNo).toBe(t);
    });
  });

  it('casToUsed is idempotent and strict (0 rows when not dispatchable)', async () => {
    await inRollbackTx(db, async (tx) => {
      const sid = await shipment(tx);
      const [wb] = await tx.insert(wmsTables.waybills).values({
        ...base(sid), status: 'registered', trackingNo: `T-${randomUUID().slice(0, 8)}`,
      }).returning();
      expect(await repo.casToUsed(tx, sid)).toBe(1); // registered→used
      expect(await repo.casToUsed(tx, sid)).toBe(1); // used→used 멱등
      // void 후엔 활성 dispatchable 없음 → 0
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, wb.id));
      expect(await repo.casToUsed(tx, sid)).toBe(0);
    });
  });

  it('findActiveByShipment ignores terminal rows', async () => {
    await inRollbackTx(db, async (tx) => {
      const sid = await shipment(tx);
      await tx.insert(wmsTables.waybills).values({ ...base(sid), status: 'failed', trackingNo: null });
      expect(await repo.findActiveByShipment(tx, sid)).toBeUndefined();
      await tx.insert(wmsTables.waybills).values({
        ...base(sid), status: 'registered', trackingNo: `T-${randomUUID().slice(0, 8)}`,
      });
      expect((await repo.findActiveByShipment(tx, sid))?.status).toBe('registered');
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.repository`
Expected: FAIL — cannot find module `./waybill.repository`.

- [ ] **Step 3: 구현** — `waybill.repository.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_DISPATCHABLE_STATUSES, WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
import type { WaybillRow } from './waybill.types';

const T = inventoryTables.waybills;

@Injectable()
export class WaybillRepository {
  constructor(
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  async insertPending(
    trx: DbTx,
    row: { shipmentId: string; source: 'carrier'; carrier: WaybillRow['carrier']; custOrdNo: string; manifestVersion: number; recipientHash: string },
  ): Promise<WaybillRow> {
    const [wb] = await trx.insert(T).values({ ...row, status: 'pending' }).returning();
    return wb;
  }

  async insertManualRegistered(
    trx: DbTx,
    row: { shipmentId: string; carrier: WaybillRow['carrier']; trackingNo: string; manifestVersion: number; recipientHash: string },
  ): Promise<WaybillRow> {
    const [wb] = await trx
      .insert(T)
      .values({ ...row, source: 'manual', status: 'registered', issuedAt: new Date() })
      .returning();
    return wb;
  }

  async findById(trx: DbTx, id: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx.select().from(T).where(eq(T.id, id)).limit(1);
    return wb;
  }

  async findActiveByShipment(trx: DbTx, shipmentId: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx
      .select()
      .from(T)
      .where(and(eq(T.shipmentId, shipmentId), notInArray(T.status, [...WAYBILL_TERMINAL_STATUSES])))
      .limit(1);
    return wb;
  }

  async casToAllocated(trx: DbTx, id: string, trackingNo: string, labelData: Record<string, unknown>): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ trackingNo, labelData, status: 'allocated', updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, 'pending')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async casToRegistered(trx: DbTx, id: string, issuedAt: Date): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'registered', issuedAt, updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, 'allocated')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  // 활성 waybill 을 registered/used → used. 멱등(used→used 매칭) + 엄격(0행이면 호출자가 예외).
  async casToUsed(trx: DbTx, shipmentId: string): Promise<number> {
    const rows = await trx
      .update(T)
      .set({ status: 'used', updatedAt: new Date() })
      .where(
        and(
          eq(T.shipmentId, shipmentId),
          inArray(T.status, [...WAYBILL_DISPATCHABLE_STATUSES]),
          notInArray(T.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .returning({ id: T.id });
    return rows.length;
  }

  async casToVoided(trx: DbTx, id: string, voidedAt: Date): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'voided', voidedAt, updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, 'registered')))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async casToAbandoned(trx: DbTx, id: string, fromStatus: 'pending' | 'allocated'): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'abandoned', updatedAt: new Date() })
      .where(and(eq(T.id, id), eq(T.status, fromStatus)))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async casToFailed(trx: DbTx, id: string, lastError: string): Promise<boolean> {
    const rows = await trx
      .update(T)
      .set({ status: 'failed', lastError, updatedAt: new Date() })
      .where(and(eq(T.id, id), inArray(T.status, ['pending', 'allocated'])))
      .returning({ id: T.id });
    return rows.length === 1;
  }

  async incrementAttempts(trx: DbTx, id: string): Promise<void> {
    await trx.update(T).set({ attempts: sql`${T.attempts} + 1`, updatedAt: new Date() }).where(eq(T.id, id));
  }
}
```

- [ ] **Step 4: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.repository` → PASS(3)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.repository.ts apps/core/src/modules/fulfillment/waybill/waybill.repository.integration.spec.ts
git commit -m "feat(waybill): WaybillRepository(insert/CAS 전이/조회)"
```

---

## Task 5: `WaybillIssueMachine.drive()` — 상태전이 (단위, fakes)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.registry.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/waybill-issue.machine.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill-issue.machine.spec.ts`

**Interfaces:**
- Consumes: `WaybillRepository`(Task 4), `CarrierGateway`/`CarrierError`/`WaybillRequest`(carrier), `WAYBILL`(Task 2), `DbService.run`.
- Produces: `CarrierGatewayRegistry`(`get(carrier): CarrierGateway | undefined`); `WaybillIssueMachine.drive(waybillId, req, tx?): Promise<WaybillRow>` — 저장된 행 상태에 따라 allocate→register 를 진행하고 최종 행을 반환. **carrier HTTP 는 tx 밖**; 각 전이는 `dbService.run` 짧은 tx 로 CAS.

- [ ] **Step 1: 레지스트리 작성** — `carrier/carrier-gateway.registry.ts`:
```typescript
import type { CarrierCode, CarrierGateway } from './carrier-gateway.interface';

export class CarrierGatewayRegistry {
  private readonly byCarrier = new Map<CarrierCode, CarrierGateway>();
  constructor(gateways: CarrierGateway[]) {
    for (const g of gateways) this.byCarrier.set(g.carrier, g);
  }
  get(carrier: CarrierCode): CarrierGateway | undefined {
    return this.byCarrier.get(carrier);
  }
}
```

- [ ] **Step 2: 실패 단위 테스트** — `waybill-issue.machine.spec.ts`. fake repo(상태 있는 인메모리) + fake gateway.
```typescript
import { CarrierError, type AllocateResult, type CarrierGateway, type RegisterOutcome, type WaybillRequest } from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';
import type { DbService } from '@app/db';
import type { WaybillRepository } from './waybill.repository';

const REQ = {} as WaybillRequest;
const runNoTx = { run: <T>(fn: (t: unknown) => Promise<T>) => fn({}) } as unknown as DbService<never>;

// 인메모리 fake repo: 단일 행 상태를 들고 CAS 시맨틱을 재현.
function fakeRepo(initial: Partial<WaybillRow>): { repo: WaybillRepository; row: WaybillRow } {
  const row = { id: 'w1', status: 'pending', attempts: 0, trackingNo: null, ...initial } as WaybillRow;
  const repo = {
    findById: async () => row,
    casToAllocated: async (_t: unknown, _id: string, tn: string, ld: Record<string, unknown>) => {
      if (row.status !== 'pending') return false;
      Object.assign(row, { status: 'allocated', trackingNo: tn, labelData: ld });
      return true;
    },
    casToRegistered: async () => {
      if (row.status !== 'allocated') return false;
      Object.assign(row, { status: 'registered', issuedAt: new Date() });
      return true;
    },
    casToFailed: async (_t: unknown, _id: string, err: string) => {
      if (!['pending', 'allocated'].includes(row.status)) return false;
      Object.assign(row, { status: 'failed', lastError: err });
      return true;
    },
    casToAbandoned: async (_t: unknown, _id: string, from: string) => {
      if (row.status !== from) return false;
      Object.assign(row, { status: 'abandoned' });
      return true;
    },
    incrementAttempts: async () => { row.attempts += 1; },
  } as unknown as WaybillRepository;
  return { repo, row };
}

function gatewayOf(over: Partial<CarrierGateway>): CarrierGatewayRegistry {
  const g = {
    carrier: 'HANJIN', capabilities: {} as never, isConfigured: () => true,
    allocate: async (): Promise<AllocateResult> => ({ waybillNo: 'WBL1', labelData: { s_tml_cod: 'x' } }),
    register: async (): Promise<RegisterOutcome> => ({ kind: 'registered' }),
    ...over,
  } as CarrierGateway;
  return new CarrierGatewayRegistry([g]);
}

describe('WaybillIssueMachine.drive', () => {
  it('pending → allocated → registered on happy path', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN' });
    const machine = new WaybillIssueMachine(repo, gatewayOf({}), runNoTx);
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('registered');
    expect(out.trackingNo).toBe('WBL1');
  });

  it('already_registered(ERROR-09) is treated as registered', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'allocated', trackingNo: 'WBL1' });
    const machine = new WaybillIssueMachine(repo, gatewayOf({ register: async () => ({ kind: 'already_registered' }) }), runNoTx);
    expect((await machine.drive(row.id, REQ)).status).toBe('registered');
  });

  it('allocate definitive_rejection → failed', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN' });
    const machine = new WaybillIssueMachine(
      repo, gatewayOf({ allocate: async () => { throw new CarrierError('nope', 'definitive_rejection', { code: 'ERROR-05' }); } }), runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('failed');
    expect(out.lastError).toContain('ERROR-05');
  });

  it('register rejected → failed with reason', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'allocated', trackingNo: 'WBL1' });
    const machine = new WaybillIssueMachine(repo, gatewayOf({ register: async () => ({ kind: 'rejected', reason: 'BAD_ADDR' }) }), runNoTx);
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('failed');
    expect(out.lastError).toContain('BAD_ADDR');
  });

  it('pending unknown_outcome bumps attempts and stays pending; auto-abandons at CAP', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', attempts: WAYBILL.PENDING_ATTEMPTS_CAP - 1 });
    const machine = new WaybillIssueMachine(
      repo, gatewayOf({ allocate: async () => { throw new CarrierError('timeout', 'unknown_outcome'); } }), runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.attempts).toBe(WAYBILL.PENDING_ATTEMPTS_CAP);
    expect(out.status).toBe('abandoned'); // CAP 도달 → 자동 포기(안전)
  });

  it('allocated unknown_outcome bumps attempts, stays allocated, NEVER auto-abandons', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'allocated', trackingNo: 'WBL1', attempts: 99 });
    const machine = new WaybillIssueMachine(
      repo, gatewayOf({ register: async () => { throw new CarrierError('timeout', 'unknown_outcome'); } }), runNoTx,
    );
    const out = await machine.drive(row.id, REQ);
    expect(out.status).toBe('allocated'); // 이중등록 위험 → 자동 포기 금지
    expect(out.attempts).toBe(100);
  });

  it('terminal states are no-op', async () => {
    const { repo, row } = fakeRepo({ carrier: 'HANJIN', status: 'registered', trackingNo: 'WBL1' });
    const machine = new WaybillIssueMachine(repo, gatewayOf({}), runNoTx);
    expect((await machine.drive(row.id, REQ)).status).toBe('registered');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test -- --testPathPattern=waybill-issue.machine`
Expected: FAIL — cannot find module.

- [ ] **Step 4: 상태머신 구현** — `waybill-issue.machine.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import { CarrierError, type CarrierCode, type WaybillRequest } from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { WaybillRepository } from './waybill.repository';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';

@Injectable()
export class WaybillIssueMachine {
  constructor(
    private readonly repo: WaybillRepository,
    private readonly registry: CarrierGatewayRegistry,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  // 저장된 waybill 행을 최종상태(registered|failed|abandoned|allocated/pending-정지)까지 진행.
  // carrier HTTP 는 tx 밖에서, 각 전이는 짧은 tx CAS. 재구동 안전(멱등).
  async drive(waybillId: string, req: WaybillRequest, tx?: DbTx): Promise<WaybillRow> {
    let row = await this.dbService.run((trx) => this.repo.findById(trx, waybillId), tx);
    if (!row) throw new Error(`${WAYBILL.ERROR.NOT_FOUND}: ${waybillId}`);

    if (row.status === 'pending') {
      row = await this.driveAllocate(row, req, tx);
      if (row.status !== 'allocated') return row; // failed / abandoned / pending 정지
    }
    if (row.status === 'allocated') {
      row = await this.driveRegister(row, req, tx);
    }
    return row;
  }

  private async driveAllocate(row: WaybillRow, req: WaybillRequest, tx?: DbTx): Promise<WaybillRow> {
    const gateway = this.registry.get(row.carrier as CarrierCode);
    if (!gateway || !gateway.isConfigured()) {
      await this.dbService.run((trx) => this.repo.casToFailed(trx, row.id, `${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}: ${row.carrier}`), tx);
      return this.reload(row.id, tx);
    }
    try {
      const { waybillNo, labelData } = await gateway.allocate(req);
      await this.dbService.run((trx) => this.repo.casToAllocated(trx, row.id, waybillNo, labelData), tx);
    } catch (e) {
      if (e instanceof CarrierError && e.outcome === 'unknown_outcome') {
        await this.dbService.run(async (trx) => {
          await this.repo.incrementAttempts(trx, row.id);
        }, tx);
        const bumped = await this.reload(row.id, tx);
        if (bumped.attempts >= WAYBILL.PENDING_ATTEMPTS_CAP) {
          await this.dbService.run((trx) => this.repo.casToAbandoned(trx, row.id, 'pending'), tx);
        }
        return this.reload(row.id, tx);
      }
      const code = e instanceof CarrierError ? (e.details.code ?? 'definitive_rejection') : String(e);
      await this.dbService.run((trx) => this.repo.casToFailed(trx, row.id, `allocate ${code}`), tx);
    }
    return this.reload(row.id, tx);
  }

  private async driveRegister(row: WaybillRow, req: WaybillRequest, tx?: DbTx): Promise<WaybillRow> {
    const gateway = this.registry.get(row.carrier as CarrierCode);
    if (!gateway) throw new Error(`${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}: ${row.carrier}`);
    if (!row.trackingNo) throw new Error(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: allocated row missing trackingNo`);
    try {
      const outcome = await gateway.register(row.trackingNo, req);
      if (outcome.kind === 'registered' || outcome.kind === 'already_registered') {
        await this.dbService.run((trx) => this.repo.casToRegistered(trx, row.id, new Date()), tx);
      } else {
        await this.dbService.run((trx) => this.repo.casToFailed(trx, row.id, `register rejected: ${outcome.reason}`), tx);
      }
    } catch (e) {
      if (e instanceof CarrierError && e.outcome === 'unknown_outcome') {
        // allocated 는 CAP 없음 — 동일 wblNo 로 재구동(ERROR-09 가 등록 확인). 자동 포기 금지.
        await this.dbService.run(async (trx) => { await this.repo.incrementAttempts(trx, row.id); }, tx);
        return this.reload(row.id, tx);
      }
      const code = e instanceof CarrierError ? (e.details.code ?? 'definitive_rejection') : String(e);
      await this.dbService.run((trx) => this.repo.casToFailed(trx, row.id, `register ${code}`), tx);
    }
    return this.reload(row.id, tx);
  }

  private async reload(id: string, tx?: DbTx): Promise<WaybillRow> {
    const row = await this.dbService.run((trx) => this.repo.findById(trx, id), tx);
    if (!row) throw new Error(`${WAYBILL.ERROR.NOT_FOUND}: ${id}`);
    return row;
  }
}
```

- [ ] **Step 5: 통과 + tsc + commit**

Run: `npm run test -- --testPathPattern=waybill-issue.machine` → PASS(7)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/carrier-gateway.registry.ts apps/core/src/modules/fulfillment/waybill/waybill-issue.machine.ts apps/core/src/modules/fulfillment/waybill/waybill-issue.machine.spec.ts
git commit -m "feat(waybill): WaybillIssueMachine.drive 상태전이 + 캐리어 레지스트리"
```

---

## Task 6: 공유 픽스처 + `WaybillReader`

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/__support__/waybill-fixtures.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.reader.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.reader.integration.spec.ts`

**Interfaces:**
- Consumes: `DbService<typeof inventorySchema>`, `inventoryTables`, `canonicalFulfillmentRequestHash`(fulfillment-command.service.ts).
- Produces:
  - 픽스처: `seedPlannedShipmentForWaybill(tx, deps)` — planned shipment + 라인 체인 시드(반환 `{shipmentId, warehouseId, skuId, salesOrderLineId, manifestVersion, recipientSnapshot}`); `fakeCarrierGateway(over?)`.
  - `WaybillReader`:
    - `loadIssueContext(trx, shipmentId): Promise<IssueContext>` — shipment(planned 검증) + 라인.
    - `getActiveWaybill(trx, shipmentId): Promise<WaybillRow | undefined>`
    - `recipientHashOf(snapshot): string` — `canonicalFulfillmentRequestHash` 래퍼.

- [ ] **Step 1: 픽스처 작성** — `__support__/waybill-fixtures.ts`. `plannedFixture`(invoice-orchestrator.integration.spec.ts:103-166)를 재사용 가능한 함수로 이식. `wired`(wireLogistics 결과)와 `planning`(ShipmentPlanningService)을 주입받는다. **주의**: `wireLogistics` 반환(`Wired`)에서 `fulfillments`/`planning` 접근자를 `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts` 로 확인해 시그니처를 맞출 것(플랜 작성 시점 `wired.fulfillments.create` 확인됨; planning 은 wiring 이 노출하지 않으면 spec 처럼 별도 `new ShipmentPlanningService(...)` 로 구성).
```typescript
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  seedHolder, seedMatching, seedSalesOrder, seedSku, seedWarehouseWithZone,
} from '../../services/__support__';
import type {
  AllocateResult, CarrierGateway, RegisterOutcome, WaybillRequest,
} from '../carrier/carrier-gateway.interface';

export const WAYBILL_RECIPIENT = {
  recipientName: '수취인 통합', phone: '010-1111-2222', postalCode: '01234',
  roadAddress: '서울 종로구 세종대로 1', detailAddress: '101', deliveryNote: '문앞',
};

// deps.fulfillments = wired.fulfillments, deps.plan = (shipmentId, opts, idem, actor, tx) => planning.plan(...)
export interface SeedDeps {
  fulfillments: { create(args: { salesOrderId: string; warehouseId: string }, tx: DbTx): Promise<unknown> };
  plan(shipmentId: string, opts: { shippingProfileId: string; expectedManifestVersion: number; expectedReservationVersion: number }, idem: string, actor: { id: string; roles: string[] }, tx: DbTx): Promise<{ shipment: { id: string; manifestVersion: number; recipientSnapshot: unknown } }>;
}

export async function seedPlannedShipmentForWaybill(tx: DbTx, deps: SeedDeps) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  const [profile] = await tx.insert(wmsTables.deliveryProfiles).values({
    name: `waybill-profile-${randomUUID()}`, sourceType: 'in_house',
    senderSnapshot: { name: 'Sender', phone: '02-0000-0000' },
    originAddressSnapshot: { address: 'Origin' }, returnAddressSnapshot: { address: 'Return' },
    carrierAccountRef: 'n/a', supportedFulfillmentModes: ['in_house'],
  }).returning();
  await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
  await tx.insert(wmsTables.stockLedgers).values({ skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: 2 });
  const variantId = randomUUID();
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2, productName: '아몬드유 30입' }] });
  await tx.update(wmsTables.salesOrders).set({ shippingAddress: WAYBILL_RECIPIENT }).where(eq(wmsTables.salesOrders.id, salesOrderId));
  await seedMatching(tx, { variantId, skuId });
  await deps.fulfillments.create({ salesOrderId, warehouseId }, tx);
  const [line] = await tx.select().from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
    .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId))
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId))
    .then((rows) => rows.map((r) => r.shipment_lines));
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, line.shipmentId));
  const planned = await deps.plan(
    shipment.id,
    { shippingProfileId: profile.id, expectedManifestVersion: shipment.manifestVersion, expectedReservationVersion: shipment.reservationVersion },
    `plan-${randomUUID()}`, { id: randomUUID(), roles: ['master'] }, tx,
  );
  return {
    shipmentId: planned.shipment.id, warehouseId, skuId, salesOrderLineId: lineIds[0],
    manifestVersion: planned.shipment.manifestVersion, recipientSnapshot: planned.shipment.recipientSnapshot,
  };
}

export function fakeCarrierGateway(over: Partial<CarrierGateway> = {}): CarrierGateway {
  return {
    carrier: 'HANJIN', isConfigured: () => true,
    capabilities: { allocatesExternally: true, registersSeparately: true, canTrack: true, canCancel: false },
    allocate: async (_req: WaybillRequest): Promise<AllocateResult> => ({ waybillNo: `WBL-${randomUUID().slice(0, 10)}`, labelData: { s_tml_cod: 'x' } }),
    register: async (): Promise<RegisterOutcome> => ({ kind: 'registered' }),
    ...over,
  } as CarrierGateway;
}
```

- [ ] **Step 2: 실패 통합 테스트** — `waybill.reader.integration.spec.ts`. wiring 은 기존 spec 패턴을 따른다(아래 setup 은 invoice-orchestrator.integration.spec.ts:36-51 미러링). `wired` 에서 `fulfillments`/`planning` 접근은 wiring 파일을 확인해 배선.
```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { makeDb, makeDbService, wireLogistics, type Wired } from '../../services/__support__';
import { seedPlannedShipmentForWaybill, type SeedDeps } from './__support__/waybill-fixtures';
import { WaybillReader } from './waybill.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let reader: WaybillReader;
  let deps: SeedDeps;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const svc = makeDbService(db);
    wired = wireLogistics(svc, 'v2');
    reader = new WaybillReader(svc);
    // deps: wired.fulfillments + planning.plan 을 wiring 에서 얻어 배선(구성은 wiring 파일 참조).
    deps = { fulfillments: wired.fulfillments, plan: (id, opts, idem, actor, tx) => wired.planning.plan(id, opts, idem, actor, tx) } as unknown as SeedDeps;
  });
  afterAll(async () => { await client.end(); });

  it('loadIssueContext returns manifest lines + recipient snapshot for a planned shipment', async () => {
    await db.transaction(async (tx) => {
      const seed = await seedPlannedShipmentForWaybill(tx as never, deps);
      const ctx = await reader.loadIssueContext(tx as never, seed.shipmentId);
      expect(ctx.status).toBe('planned');
      expect(ctx.manifestVersion).toBe(seed.manifestVersion);
      expect(ctx.lines).toEqual([{ productName: '아몬드유 30입', quantity: 2, skuId: seed.skuId }]);
      expect(reader.recipientHashOf(ctx.recipientSnapshot)).toHaveLength(64);
      throw new Error('rollback');
    }).catch((e) => { if (e.message !== 'rollback') throw e; });
  });

  it('getActiveWaybill returns undefined when none', async () => {
    await db.transaction(async (tx) => {
      const seed = await seedPlannedShipmentForWaybill(tx as never, deps);
      expect(await reader.getActiveWaybill(tx as never, seed.shipmentId)).toBeUndefined();
      throw new Error('rollback');
    }).catch((e) => { if (e.message !== 'rollback') throw e; });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.reader`
Expected: FAIL — cannot find module `./waybill.reader`.

- [ ] **Step 4: 구현** — `waybill.reader.ts`. `loadIssueContext` 는 loadManifest(invoice-orchestrator.service.ts:988-1022) 조인을 축약 복제(productName·quantity·skuId 만).
```typescript
import { Injectable } from '@nestjs/common';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { WAYBILL, WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
import type { IssueContext, WaybillRow } from './waybill.types';

const W = inventoryTables.waybills;

@Injectable()
export class WaybillReader {
  constructor(
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  recipientHashOf(recipientSnapshot: unknown): string {
    return canonicalFulfillmentRequestHash(recipientSnapshot);
  }

  async loadIssueContext(trx: DbTx, shipmentId: string): Promise<IssueContext> {
    const [shipment] = await trx
      .select()
      .from(inventoryTables.shipments)
      .where(eq(inventoryTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId}`);
    const rows = await trx
      .select({
        skuId: inventoryTables.shipmentLines.skuId,
        skuName: inventoryTables.skus.name,
        productName: inventoryTables.salesOrderLines.productName,
        quantity: inventoryTables.shipmentLines.qty,
      })
      .from(inventoryTables.shipmentLines)
      .innerJoin(inventoryTables.fulfillmentOrderItems, eq(inventoryTables.fulfillmentOrderItems.id, inventoryTables.shipmentLines.fulfillmentOrderItemId))
      .innerJoin(inventoryTables.fulfillmentOrders, eq(inventoryTables.fulfillmentOrders.id, inventoryTables.fulfillmentOrderItems.fulfillmentOrderId))
      .innerJoin(inventoryTables.skus, eq(inventoryTables.skus.id, inventoryTables.shipmentLines.skuId))
      .leftJoin(inventoryTables.salesOrders, eq(inventoryTables.salesOrders.id, inventoryTables.fulfillmentOrders.salesOrderId))
      .leftJoin(inventoryTables.salesOrderLines, sql`${inventoryTables.salesOrderLines.id}::text = ${inventoryTables.fulfillmentOrderItems.salesOrderLineId}`)
      .where(eq(inventoryTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(inventoryTables.shipmentLines.id));
    if (!rows.length) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId} has no lines`);
    return {
      shipmentId: shipment.id,
      status: shipment.status,
      manifestVersion: shipment.manifestVersion,
      recipientSnapshot: shipment.recipientSnapshot,
      lines: rows.map((r) => ({ productName: r.productName ?? r.skuName ?? '', quantity: r.quantity, skuId: r.skuId })),
    };
  }

  async getActiveWaybill(trx: DbTx, shipmentId: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx
      .select()
      .from(W)
      .where(and(eq(W.shipmentId, shipmentId), notInArray(W.status, [...WAYBILL_TERMINAL_STATUSES])))
      .limit(1);
    return wb;
  }
}
```

- [ ] **Step 5: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.reader` → PASS(2)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/__support__ apps/core/src/modules/fulfillment/waybill/waybill.reader.ts apps/core/src/modules/fulfillment/waybill/waybill.reader.integration.spec.ts
git commit -m "feat(waybill): WaybillReader(loadIssueContext/getActiveWaybill) + 공유 픽스처"
```

---

## Task 7: `WaybillManager.issueForShipment` (carrier 발급, 동기 drive)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts`

**Interfaces:**
- Consumes: `WaybillReader`, `WaybillRepository`, `WaybillIssueMachine`, `CarrierGatewayRegistry`, `FulfillmentCommandService`, `HanjinConfig`(주입), `assembleWaybillRequest`, `deriveCustOrdNo`.
- Produces: `WaybillManager.issueForShipment(shipmentId, opts: {carrier: CarrierCode; expectedManifestVersion: number}, idemKey, actor, config): Promise<WaybillRow>`. (config 는 모듈이 주입; 시그니처엔 DI 필드로 존재 — 여기선 명시.)

**핵심 흐름**: `commands.execute` 로 **pending 행만 durable 삽입**(idempotent) → 반환된 waybillId 로 **tx 밖에서 `machine.drive`**(allocate+register) → 최종 행 반환. carrier I/O 가 커맨드 tx 안에 들어가지 않게 분리(크래시 시 pending 행이 남아 stuck 재구동 가능). **이 메서드는 `tx?` 를 받지 않는다**(외부 HTTP 를 호출자 tx 에 넣을 수 없음 — Global Constraints 참조).

- [ ] **Step 1: 실패 통합 테스트** — `waybill.manager.integration.spec.ts`. fake gateway 를 registry 로 주입.
```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { makeDb, makeDbService, wireLogistics, type Wired } from '../../services/__support__';
import { seedPlannedShipmentForWaybill, fakeCarrierGateway, type SeedDeps } from './__support__/waybill-fixtures';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { CarrierError, type WaybillRequest } from './carrier/carrier-gateway.interface';
import { WaybillRepository } from './waybill.repository';
import { WaybillReader } from './waybill.reader';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillManager } from './waybill.manager';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import type { HanjinConfig } from '../carrier/hanjin/hanjin.config';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const CONFIG: HanjinConfig = {
  clientId: 'CID', apiKey: 'AK', secretKey: 'SK', contractNo: 'CN', orderBaseUrl: 'https://o', printBaseUrl: 'https://p',
  timeoutMs: 15000, sender: { name: '보내는이', zip: '06236', baseAddress: '테헤란로 1', detailAddress: '10층', tel: '02-100-2000' },
  boxType: 'A', payType: 'PP',
};
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('WaybillManager.issueForShipment (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let deps: SeedDeps;

  function manager(registry: CarrierGatewayRegistry): WaybillManager {
    const svc = makeDbService(db);
    const repo = new WaybillRepository(svc);
    return new WaybillManager(
      new WaybillReader(svc), repo, new WaybillIssueMachine(repo, registry, svc),
      registry, new FulfillmentCommandService(svc), CONFIG,
    );
  }

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    wired = wireLogistics(makeDbService(db), 'v2');
    deps = { fulfillments: wired.fulfillments, plan: (id, o, k, a, tx) => wired.planning.plan(id, o, k, a, tx) } as unknown as SeedDeps;
  });
  afterAll(async () => { await client.end(); });

  it('issues to registered on happy path (durable row + inline drive)', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const wb = await mgr.issueForShipment(seed.shipmentId, { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    expect(wb.status).toBe('registered');
    expect(wb.trackingNo).toMatch(/^WBL-/);
    expect(wb.custOrdNo).toMatch(/^AY/);
  });

  it('leaves a durable failed row on definitive rejection', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const gw = fakeCarrierGateway({ allocate: async () => { throw new CarrierError('x', 'definitive_rejection', { code: 'ERROR-05' }); } });
    const mgr = manager(new CarrierGatewayRegistry([gw]));
    const wb = await mgr.issueForShipment(seed.shipmentId, { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    expect(wb.status).toBe('failed');
    const [row] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, wb.id));
    expect(row.lastError).toContain('ERROR-05');
  });

  it('rejects a stale manifest version', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    await expect(
      mgr.issueForShipment(seed.shipmentId, { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion + 1 }, `idem-${randomUUID()}`, actor),
    ).rejects.toThrow(/WAYBILL_STALE_MANIFEST_VERSION/);
  });

  it('rejects a second active waybill', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    await mgr.issueForShipment(seed.shipmentId, { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    await expect(
      mgr.issueForShipment(seed.shipmentId, { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor),
    ).rejects.toThrow(/WAYBILL_ACTIVE_EXISTS/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.manager`
Expected: FAIL — cannot find module `./waybill.manager`.

- [ ] **Step 3: 매니저 골격 + issueForShipment 구현** — `waybill.manager.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { HANJIN_CONFIG } from './waybill.tokens';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import type { CarrierCode } from './carrier/carrier-gateway.interface';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { assembleWaybillRequest } from './waybill-request.assembler';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillReader } from './waybill.reader';
import { WaybillRepository } from './waybill.repository';
import { WAYBILL } from './waybill.constants';
import type { WaybillRow } from './waybill.types';

export interface IssueOpts {
  carrier: CarrierCode;
  expectedManifestVersion: number;
}
export type Actor = { id: string; roles: string[] };

@Injectable()
export class WaybillManager {
  constructor(
    private readonly reader: WaybillReader,
    private readonly repo: WaybillRepository,
    private readonly machine: WaybillIssueMachine,
    private readonly registry: CarrierGatewayRegistry,
    private readonly commands: FulfillmentCommandService,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService?: DbService<typeof inventorySchema>,
  ) {}

  // carrier 발급: pending durable 삽입(idempotent) → tx 밖 drive. tx? 안 받음(외부 I/O).
  async issueForShipment(shipmentId: string, opts: IssueOpts, idempotencyKey: string, actor: Actor): Promise<WaybillRow> {
    const gateway = this.registry.get(opts.carrier);
    if (!gateway || !gateway.isConfigured()) {
      throw new ConflictError(`${WAYBILL.ERROR.CARRIER_NOT_CONFIGURED}: ${opts.carrier}`);
    }
    const { waybillId, request } = await this.commands.execute<{ waybillId: string }>(
      { commandType: 'shipment.waybill.issue', idempotencyKey, canonicalRequest: { actorId: actor.id, shipmentId, ...opts } },
      async (trx) => {
        const ctx = await this.reader.loadIssueContext(trx, shipmentId);
        if (ctx.status !== 'planned') throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: shipment ${ctx.status}`);
        if (ctx.manifestVersion !== opts.expectedManifestVersion) {
          throw new ConflictError(`${WAYBILL.ERROR.STALE_MANIFEST_VERSION}: ${ctx.manifestVersion} != ${opts.expectedManifestVersion}`);
        }
        if (await this.reader.getActiveWaybill(trx, shipmentId)) {
          throw new ConflictError(`${WAYBILL.ERROR.ACTIVE_EXISTS}: ${shipmentId}`);
        }
        const req = assembleWaybillRequest({ shipmentId, recipientSnapshot: ctx.recipientSnapshot, lines: ctx.lines, config: this.config });
        const row = await this.repo.insertPending(trx, {
          shipmentId, source: 'carrier', carrier: opts.carrier, custOrdNo: req.custOrdNo,
          manifestVersion: ctx.manifestVersion, recipientHash: this.reader.recipientHashOf(ctx.recipientSnapshot),
        });
        return { response: { waybillId: row.id }, resourceType: 'waybill', resourceId: row.id };
      },
    ).then(async (r) => {
      // 커맨드 밖에서 request 재조립(멱등 replay 시에도 동일). drive 는 저장 상태 기준.
      const ctx = await this.dbService!.run((trx) => this.reader.loadIssueContext(trx, shipmentId));
      const request = assembleWaybillRequest({ shipmentId, recipientSnapshot: ctx.recipientSnapshot, lines: ctx.lines, config: this.config });
      return { waybillId: r.waybillId, request };
    });

    return this.machine.drive(waybillId, request);
  }
}
```
> **주의(어셈블 재조립)**: `commands.execute` 반환 후 `request` 를 다시 조립하는 이유 — 커맨드 핸들러의 지역변수는 idempotent replay(두번째 호출) 시 실행되지 않아 사용할 수 없다. drive 는 저장된 pending 행 기준으로 동작하므로 재조립 request 로 충분하다.

- [ ] **Step 4: 토큰 파일** — `waybill.tokens.ts`:
```typescript
export const HANJIN_CONFIG = Symbol('HANJIN_CONFIG');
```
(config 는 모듈 팩토리가 `loadHanjinConfig(process.env)` 결과를 이 토큰으로 provide — Task 12.)

- [ ] **Step 5: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.manager` → PASS(4)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.manager.ts apps/core/src/modules/fulfillment/waybill/waybill.tokens.ts apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts
git commit -m "feat(waybill): WaybillManager.issueForShipment(durable pending + 동기 drive)"
```

---

## Task 8: `WaybillManager.registerManual` (self 계승 — assertProfileComplete 미적용)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts`

**Interfaces:**
- Produces: `WaybillManager.registerManual(shipmentId, dto: {carrier: CarrierCode; trackingNo: string; expectedManifestVersion: number; reason?: string}, idemKey, actor, tx?): Promise<WaybillRow>` — source='manual', 즉시 registered. 외부 호출 없음. **`assertProfileComplete`(goodsflow center code) 미적용**(계승). manifest/recipient/version 검증 + 활성 유일 + trackingNo 유일.

- [ ] **Step 1: 실패 테스트 추가** (기존 spec 에 `describe` 블록 추가):
```typescript
describe('registerManual', () => {
  it('registers a manual waybill immediately without carrier calls or profile completeness', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    // 게이트웨이가 던지도록 해도 manual 은 호출 안 함을 증명
    const gw = fakeCarrierGateway({ allocate: async () => { throw new Error('should not be called'); } });
    const mgr = manager(new CarrierGatewayRegistry([gw]));
    const wb = await mgr.registerManual(seed.shipmentId, { carrier: 'HANJIN', trackingNo: `MANUAL-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    expect(wb.source).toBe('manual');
    expect(wb.status).toBe('registered');
  });

  it('rejects a duplicate live tracking number', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const seed2 = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const tn = `MANUAL-${randomUUID().slice(0, 8)}`;
    await mgr.registerManual(seed.shipmentId, { carrier: 'HANJIN', trackingNo: tn, expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    await expect(
      mgr.registerManual(seed2.shipmentId, { carrier: 'HANJIN', trackingNo: tn, expectedManifestVersion: seed2.manifestVersion }, `idem-${randomUUID()}`, actor),
    ).rejects.toThrow(/WAYBILL_TRACKING_EXISTS/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.manager`
Expected: FAIL — `registerManual is not a function`.

- [ ] **Step 3: 구현** — `waybill.manager.ts` 에 메서드 추가. (postgres unique_violation code `23505`.)
```typescript
async registerManual(
  shipmentId: string,
  dto: { carrier: CarrierCode; trackingNo: string; expectedManifestVersion: number; reason?: string },
  idempotencyKey: string,
  actor: Actor,
  tx?: DbTx,
): Promise<WaybillRow> {
  const trackingNo = dto.trackingNo.trim();
  if (!trackingNo) throw new BadRequestError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: trackingNo required`);
  return this.commands.execute<WaybillRow>(
    { commandType: 'shipment.waybill.register-manual', idempotencyKey, canonicalRequest: { actorId: actor.id, shipmentId, ...dto } },
    async (trx) => {
      const ctx = await this.reader.loadIssueContext(trx, shipmentId);
      if (ctx.status !== 'planned') throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: shipment ${ctx.status}`);
      if (ctx.manifestVersion !== dto.expectedManifestVersion) {
        throw new ConflictError(`${WAYBILL.ERROR.STALE_MANIFEST_VERSION}: ${ctx.manifestVersion} != ${dto.expectedManifestVersion}`);
      }
      // 계승: assertRecipientComplete 는 적용, assertProfileComplete(carrierAccountRef)는 미적용 — parseRecipient 가 5필드만 검증.
      assembleRecipientCheck(ctx.recipientSnapshot);
      if (await this.reader.getActiveWaybill(trx, shipmentId)) throw new ConflictError(`${WAYBILL.ERROR.ACTIVE_EXISTS}: ${shipmentId}`);
      let row: WaybillRow;
      try {
        row = await this.repo.insertManualRegistered(trx, {
          shipmentId, carrier: dto.carrier, trackingNo,
          manifestVersion: ctx.manifestVersion, recipientHash: this.reader.recipientHashOf(ctx.recipientSnapshot),
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ConflictError(`${WAYBILL.ERROR.TRACKING_EXISTS}: ${trackingNo}`);
        throw e;
      }
      return { response: row, resourceType: 'waybill', resourceId: row.id };
    },
    tx,
  );
}
```
그리고 파일 하단 헬퍼:
```typescript
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}
```
`assembleRecipientCheck` 는 `parseRecipient`(Task 3)를 재사용 — import 하고 `parseRecipient(snapshot)` 를 호출(반환 무시, 검증 목적). import 추가:
```typescript
import { assembleWaybillRequest, parseRecipient } from './waybill-request.assembler';
// 사용처: parseRecipient(ctx.recipientSnapshot); // WAYBILL_RECIPIENT_INCOMPLETE 던짐
```
(위 `assembleRecipientCheck(...)` 호출을 `parseRecipient(ctx.recipientSnapshot);` 로 대체.)

- [ ] **Step 4: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.manager` → PASS(6)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.manager.ts apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts
git commit -m "feat(waybill): registerManual(source=manual 즉시 registered, profile 완비 미적용 계승)"
```

---

## Task 9: `WaybillManager.void` + `reissue`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts`

**Interfaces:**
- Produces:
  - `void(waybillId, dto: {reason: string}, idemKey, actor, tx?): Promise<WaybillRow>` — `registered`→`voided`(발송 전, 로컬, 외부호출 없음). `used` 또는 shipment ∈ {shipped,in_transit,delivered} → `WAYBILL_ALREADY_DISPATCHED` 거부. 종료상태 해제로 재발급 경로 열림(§11).
  - `reissue(shipmentId, opts: IssueOpts, idemKey, actor): Promise<WaybillRow>` — 활성 행 void 후 새 발급을 한 명령으로(§11). carrier I/O 포함 → tx? 없음.

- [ ] **Step 1: 실패 테스트 추가**:
```typescript
import { eq } from 'drizzle-orm'; // 파일 상단에 이미 있으면 생략

describe('void + reissue', () => {
  it('voids a registered waybill before dispatch', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const wb = await mgr.registerManual(seed.shipmentId, { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    const voided = await mgr.void(wb.id, { reason: 'wrong address' }, `idem-${randomUUID()}`, actor);
    expect(voided.status).toBe('voided');
    expect(voided.voidedAt).toBeTruthy();
  });

  it('rejects voiding a used waybill', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const wb = await mgr.registerManual(seed.shipmentId, { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    await db.update(wmsTables.waybills).set({ status: 'used' }).where(eq(wmsTables.waybills.id, wb.id));
    await expect(mgr.void(wb.id, { reason: 'x' }, `idem-${randomUUID()}`, actor)).rejects.toThrow(/WAYBILL_ALREADY_DISPATCHED/);
  });

  it('reissue voids the active waybill and issues a fresh one', async () => {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const first = await mgr.registerManual(seed.shipmentId, { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    const second = await mgr.reissue(seed.shipmentId, { carrier: 'HANJIN', expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('registered');
    const [old] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, first.id));
    expect(old.status).toBe('voided');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.manager`
Expected: FAIL — `void is not a function`.

- [ ] **Step 3: 구현** — `waybill.manager.ts`:
```typescript
async void(waybillId: string, dto: { reason: string }, idempotencyKey: string, actor: Actor, tx?: DbTx): Promise<WaybillRow> {
  return this.commands.execute<WaybillRow>(
    { commandType: 'shipment.waybill.void', idempotencyKey, canonicalRequest: { actorId: actor.id, waybillId, ...dto } },
    async (trx) => {
      const wb = await this.repo.findById(trx, waybillId);
      if (!wb) throw new NotFoundError(`${WAYBILL.ERROR.NOT_FOUND}: ${waybillId}`);
      const [shipment] = await trx
        .select({ status: inventoryTables.shipments.status })
        .from(inventoryTables.shipments)
        .where(eq(inventoryTables.shipments.id, wb.shipmentId))
        .limit(1);
      if (wb.status === 'used' || (shipment && ['shipped', 'in_transit', 'delivered'].includes(shipment.status))) {
        throw new ConflictError(`${WAYBILL.ERROR.ALREADY_DISPATCHED}: ${waybillId}`);
      }
      if (wb.status !== 'registered') {
        throw new ConflictError(`${WAYBILL.ERROR.NOT_VOIDABLE}: ${waybillId} is ${wb.status}`);
      }
      const ok = await this.repo.casToVoided(trx, waybillId, new Date());
      if (!ok) throw new ConflictError(`${WAYBILL.ERROR.NOT_VOIDABLE}: ${waybillId} changed concurrently`);
      const row = await this.repo.findById(trx, waybillId);
      return { response: row as WaybillRow, resourceType: 'waybill', resourceId: waybillId };
    },
    tx,
  );
}

// void(활성) → 새 발급. carrier I/O 포함 → tx? 없음.
async reissue(shipmentId: string, opts: IssueOpts, idempotencyKey: string, actor: Actor): Promise<WaybillRow> {
  const active = await this.dbService!.run((trx) => this.reader.getActiveWaybill(trx, shipmentId));
  if (active && active.status === 'registered') {
    await this.void(active.id, { reason: 'reissue' }, `${idempotencyKey}:void`, actor);
  } else if (active) {
    // pending/allocated 교착발 reissue 는 운영자-전용 abandon 규칙 적용(§11).
    throw new ConflictError(`${WAYBILL.ERROR.ABANDON_NOT_ALLOWED}: active waybill is ${active.status}; operator abandon required before reissue`);
  }
  return this.issueForShipment(shipmentId, opts, `${idempotencyKey}:issue`, actor);
}
```

- [ ] **Step 4: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.manager` → PASS(9)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.manager.ts apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts
git commit -m "feat(waybill): void(발송전 안전범위) + reissue(void+발급 원자화)"
```

---

## Task 10: seam — `assertDispatchable` + `markUsed` + `getActiveWaybill`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts`

**Interfaces:**
- Produces(플랜 3 dispatch 소비):
  - `assertDispatchable(shipmentId, tx?): Promise<WaybillRow>` — 활성 waybill 정확히 1개 + `status ∈ {registered, used}` + carrier 존재 + trackingNo non-empty + `manifestVersion`·`recipientHash` 현재 shipment 와 일치. **externalServiceId 요구 없음**(폐지), source 무관 통일(§9.1). 불일치 → `WAYBILL_STALE`.
  - `markUsed(shipmentId, tx?): Promise<void>` — `registered/used → used`. 멱등 + 엄격(0행이면 예외). §3.1-3.
  - `getActiveWaybill(shipmentId, tx?): Promise<WaybillRow | null>`

- [ ] **Step 1: 실패 테스트 추가**:
```typescript
describe('seam: assertDispatchable + markUsed', () => {
  async function registered(mgr: WaybillManager) {
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const wb = await mgr.registerManual(seed.shipmentId, { carrier: 'HANJIN', trackingNo: `M-${randomUUID().slice(0, 8)}`, expectedManifestVersion: seed.manifestVersion }, `idem-${randomUUID()}`, actor);
    return { seed, wb };
  }

  it('assertDispatchable returns the active registered waybill', async () => {
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const { seed, wb } = await registered(mgr);
    const got = await mgr.assertDispatchable(seed.shipmentId);
    expect(got.id).toBe(wb.id);
  });

  it('assertDispatchable rejects a stale recipient hash', async () => {
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const { seed } = await registered(mgr);
    await db.update(wmsTables.shipments).set({ recipientSnapshot: { ...WAYBILL_RECIPIENT, detailAddress: 'CHANGED' } }).where(eq(wmsTables.shipments.id, seed.shipmentId));
    await expect(mgr.assertDispatchable(seed.shipmentId)).rejects.toThrow(/WAYBILL_STALE/);
  });

  it('markUsed transitions registered→used and is idempotent', async () => {
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const { seed, wb } = await registered(mgr);
    await mgr.markUsed(seed.shipmentId);
    await mgr.markUsed(seed.shipmentId); // 멱등
    const [row] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, wb.id));
    expect(row.status).toBe('used');
  });

  it('markUsed throws when no dispatchable waybill', async () => {
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const seed = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    await expect(mgr.markUsed(seed.shipmentId)).rejects.toThrow(/WAYBILL_NOT_DISPATCHABLE/);
  });
});
```
(`WAYBILL_RECIPIENT` import 를 spec 상단에 추가: `import { ..., WAYBILL_RECIPIENT } from './__support__/waybill-fixtures';`)

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.manager`
Expected: FAIL — `assertDispatchable is not a function`.

- [ ] **Step 3: 구현** — `waybill.manager.ts`:
```typescript
async assertDispatchable(shipmentId: string, tx?: DbTx): Promise<WaybillRow> {
  return this.dbService!.run(async (trx) => {
    const [shipment] = await trx
      .select({ manifestVersion: inventoryTables.shipments.manifestVersion, recipientSnapshot: inventoryTables.shipments.recipientSnapshot })
      .from(inventoryTables.shipments)
      .where(eq(inventoryTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId}`);
    const wb = await this.reader.getActiveWaybill(trx, shipmentId);
    if (!wb || !['registered', 'used'].includes(wb.status)) {
      throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: shipment ${shipmentId} needs one registered waybill`);
    }
    if (!wb.carrier || !wb.trackingNo?.trim()) {
      throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: waybill missing carrier or tracking number`);
    }
    if (wb.manifestVersion !== shipment.manifestVersion || wb.recipientHash !== this.reader.recipientHashOf(shipment.recipientSnapshot)) {
      throw new ConflictError(`${WAYBILL.ERROR.STALE}: waybill does not match shipment manifest/recipient`);
    }
    return wb;
  }, tx);
}

async markUsed(shipmentId: string, tx?: DbTx): Promise<void> {
  await this.dbService!.run(async (trx) => {
    const affected = await this.repo.casToUsed(trx, shipmentId);
    if (affected !== 1) throw new ConflictError(`${WAYBILL.ERROR.NOT_DISPATCHABLE}: markUsed affected ${affected} rows for ${shipmentId}`);
  }, tx);
}

async getActiveWaybill(shipmentId: string, tx?: DbTx): Promise<WaybillRow | null> {
  const wb = await this.dbService!.run((trx) => this.reader.getActiveWaybill(trx, shipmentId), tx);
  return wb ?? null;
}
```

- [ ] **Step 4: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.manager` → PASS(13)
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.manager.ts apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts
git commit -m "feat(waybill): seam assertDispatchable/markUsed(멱등+엄격)/getActiveWaybill"
```

---

## Task 11: `WaybillService` 포트 + DTO + `WaybillController`

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.service.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.controller.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.controller.spec.ts`

**Interfaces:**
- Produces: `WaybillService`(얇은 위임 + `toView`), DTO 클래스들, `WaybillController`(라우트 6). 컨트롤러는 try/catch 없이 위임(전역 필터).

- [ ] **Step 1: DTO 작성** — `dto/waybill.dto.ts` (house 패턴: class-validator + `carrierValues`):
```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { carrierValues, CarrierEnum } from '../../../inventory/schema/enum-values';

export class IssueWaybillDto {
  @IsInt() @Min(1) expectedManifestVersion: number;
  @IsIn(carrierValues) carrier: CarrierEnum;
}
export class RegisterManualWaybillDto {
  @IsInt() @Min(1) expectedManifestVersion: number;
  @IsIn(carrierValues) carrier: CarrierEnum;
  @IsString() @IsNotEmpty() @MaxLength(128) trackingNo: string;
  @IsString() @IsOptional() reason?: string;
}
export class VoidWaybillDto {
  @IsString() @IsNotEmpty() reason: string;
}
export class IssueBatchWaybillDto {
  @IsString({ each: true }) shipmentIds: string[];
  @IsIn(carrierValues) carrier: CarrierEnum;
}
export class WaybillResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() shipmentId: string;
  @ApiProperty({ enum: ['carrier', 'manual'] }) source: string;
  @ApiProperty() carrier: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional({ nullable: true }) trackingNo: string | null;
  @ApiPropertyOptional({ nullable: true }) custOrdNo: string | null;
  @ApiProperty() manifestVersion: number;
  @ApiPropertyOptional({ nullable: true }) issuedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) voidedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) lastError: string | null;
}
export class BatchResultItemDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() status: string; // registered | failed | pending | allocated
  @ApiPropertyOptional({ nullable: true }) trackingNo: string | null;
  @ApiPropertyOptional({ nullable: true }) reason: string | null;
}
export type WaybillActor = { id: string; roles: string[] };
```

- [ ] **Step 2: 서비스 작성** — `waybill.service.ts` (얇은 포트 + toView):
```typescript
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { WaybillManager, type Actor, type IssueOpts } from './waybill.manager';
import type { WaybillRow, WaybillView } from './waybill.types';

export function toView(row: WaybillRow): WaybillView {
  return {
    id: row.id, shipmentId: row.shipmentId, source: row.source, carrier: row.carrier, status: row.status,
    trackingNo: row.trackingNo, custOrdNo: row.custOrdNo, manifestVersion: row.manifestVersion,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    lastError: row.lastError,
  };
}

@Injectable()
export class WaybillService {
  constructor(private readonly manager: WaybillManager) {}

  async issueForShipment(shipmentId: string, opts: IssueOpts, idemKey: string, actor: Actor): Promise<WaybillView> {
    return toView(await this.manager.issueForShipment(shipmentId, opts, idemKey, actor));
  }
  async registerManual(shipmentId: string, dto: { carrier: IssueOpts['carrier']; trackingNo: string; expectedManifestVersion: number; reason?: string }, idemKey: string, actor: Actor, tx?: DbTx): Promise<WaybillView> {
    return toView(await this.manager.registerManual(shipmentId, dto, idemKey, actor, tx));
  }
  async void(waybillId: string, dto: { reason: string }, idemKey: string, actor: Actor, tx?: DbTx): Promise<WaybillView> {
    return toView(await this.manager.void(waybillId, dto, idemKey, actor, tx));
  }
  async reissue(shipmentId: string, opts: IssueOpts, idemKey: string, actor: Actor): Promise<WaybillView> {
    return toView(await this.manager.reissue(shipmentId, opts, idemKey, actor));
  }
  async getActiveWaybill(shipmentId: string, tx?: DbTx): Promise<WaybillView | null> {
    const row = await this.manager.getActiveWaybill(shipmentId, tx);
    return row ? toView(row) : null;
  }
  // 플랜 3 dispatch 소비:
  assertDispatchable(shipmentId: string, tx?: DbTx) { return this.manager.assertDispatchable(shipmentId, tx); }
  markUsed(shipmentId: string, tx?: DbTx) { return this.manager.markUsed(shipmentId, tx); }
  issueBatch(shipmentIds: string[], opts: IssueOpts, idemKey: string, actor: Actor) { return this.manager.issueBatch(shipmentIds, opts, idemKey, actor); } // Task 13
}
```
> `issueBatch` 는 Task 13 에서 매니저에 추가되므로, 이 태스크에서 컴파일하려면 임시로 `issueBatch` 위임 줄을 **주석 처리**했다가 Task 13 에서 활성화한다(또는 Task 13 을 이 태스크 앞에 실행). 실행 순서상 Task 13 를 먼저 하지 않는다면 지금은 주석.

- [ ] **Step 3: 컨트롤러 작성** — `waybill.controller.ts` (shipment-invoice.controller.ts 패턴):
```typescript
import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { WaybillService } from './waybill.service';
import { BatchResultItemDto, IssueBatchWaybillDto, IssueWaybillDto, RegisterManualWaybillDto, VoidWaybillDto, WaybillResponseDto, type WaybillActor } from './dto/waybill.dto';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

@Controller()
@UseGuards(ScopeGuard)
export class WaybillController {
  constructor(private readonly waybills: WaybillService) {}

  @Post('shipments/:shipmentId/waybills')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: WaybillResponseDto })
  issue(@Param('shipmentId') shipmentId: string, @Body() dto: IssueWaybillDto, @Headers('idempotency-key') idem: string | undefined, @User() user: AuthenticatedUser) {
    return this.waybills.issueForShipment(shipmentId, { carrier: dto.carrier, expectedManifestVersion: dto.expectedManifestVersion }, idem ?? '', this.actor(user));
  }

  @Post('shipments/:shipmentId/waybills/manual')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: WaybillResponseDto })
  manual(@Param('shipmentId') shipmentId: string, @Body() dto: RegisterManualWaybillDto, @Headers('idempotency-key') idem: string | undefined, @User() user: AuthenticatedUser) {
    return this.waybills.registerManual(shipmentId, dto, idem ?? '', this.actor(user));
  }

  @Post('waybills:batch')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: BatchResultItemDto, isArray: true })
  batch(@Body() dto: IssueBatchWaybillDto, @Headers('idempotency-key') idem: string | undefined, @User() user: AuthenticatedUser) {
    return this.waybills.issueBatch(dto.shipmentIds, { carrier: dto.carrier, expectedManifestVersion: 0 }, idem ?? '', this.actor(user));
  }

  @Post('waybills/:waybillId/void')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)
  @ApiOkResponse({ type: WaybillResponseDto })
  void(@Param('waybillId') waybillId: string, @Body() dto: VoidWaybillDto, @Headers('idempotency-key') idem: string | undefined, @User() user: AuthenticatedUser) {
    return this.waybills.void(waybillId, dto, idem ?? '', this.actor(user));
  }

  @Post('shipments/:shipmentId/waybills/reissue')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: WaybillResponseDto })
  reissue(@Param('shipmentId') shipmentId: string, @Body() dto: IssueWaybillDto, @Headers('idempotency-key') idem: string | undefined, @User() user: AuthenticatedUser) {
    return this.waybills.reissue(shipmentId, { carrier: dto.carrier, expectedManifestVersion: dto.expectedManifestVersion }, idem ?? '', this.actor(user));
  }

  @Get('shipments/:shipmentId/waybill')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: WaybillResponseDto })
  active(@Param('shipmentId') shipmentId: string) {
    return this.waybills.getActiveWaybill(shipmentId);
  }

  private actor(user: AuthenticatedUser | undefined): WaybillActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
```
> **배치의 `expectedManifestVersion`**: 배치는 shipment 마다 버전이 달라 단일 dto 버전이 무의미 → `issueBatch` 는 shipment별 현재 버전을 읽어 발급(버전 게이트는 개별 발급과 달리 "현재값 사용"). Task 13 참조. 컨트롤러의 `expectedManifestVersion: 0` 은 무시된다(Task 13 시그니처에서 opts.expectedManifestVersion 불사용).

- [ ] **Step 4: 컨트롤러 단위 테스트** — `waybill.controller.spec.ts` (서비스 목):
```typescript
import { WaybillController } from './waybill.controller';
import { UnauthorizedException } from '@nestjs/common';

describe('WaybillController', () => {
  const svc = {
    issueForShipment: jest.fn().mockResolvedValue({ id: 'w1', status: 'registered' }),
    registerManual: jest.fn(), void: jest.fn(), reissue: jest.fn(), getActiveWaybill: jest.fn(), issueBatch: jest.fn(),
  };
  const ctrl = new WaybillController(svc as never);
  const user = { userId: 'u1', roles: ['logistics_worker'] };

  it('issue delegates with actor + idempotency-key', async () => {
    await ctrl.issue('s1', { carrier: 'HANJIN', expectedManifestVersion: 2 } as never, 'idem-1', user);
    expect(svc.issueForShipment).toHaveBeenCalledWith('s1', { carrier: 'HANJIN', expectedManifestVersion: 2 }, 'idem-1', { id: 'u1', roles: ['logistics_worker'] });
  });
  it('passes empty string when idempotency-key header absent', async () => {
    await ctrl.issue('s1', { carrier: 'HANJIN', expectedManifestVersion: 2 } as never, undefined, user);
    expect(svc.issueForShipment).toHaveBeenLastCalledWith('s1', expect.anything(), '', expect.anything());
  });
  it('throws Unauthorized without an actor id', () => {
    expect(() => ctrl.active('s1') && ctrl['actor']({})).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 5: 통과 + tsc + commit**

Run: `npm run test -- --testPathPattern=waybill.controller` → PASS
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0(`issueBatch` 주석 상태면 컨트롤러 batch 라우트도 임시 주석; Task 13 후 활성화)
```bash
git add apps/core/src/modules/fulfillment/waybill/waybill.service.ts apps/core/src/modules/fulfillment/waybill/dto apps/core/src/modules/fulfillment/waybill/waybill.controller.ts apps/core/src/modules/fulfillment/waybill/waybill.controller.spec.ts
git commit -m "feat(waybill): WaybillService 포트 + DTO + WaybillController(라우트 6)"
```

---

## Task 12: `WaybillModule` + 캐리어 팩토리 + AppModule 배선

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/carrier-gateway.factory.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/waybill.module.ts`
- Modify: `apps/core/src/app.module.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.module.spec.ts`

**Interfaces:**
- Consumes: 플랜 1 캐리어 클래스(`loadHanjinConfig`, `HanjinHmacSigner`, `HanjinApiClient`, `HanjinCarrierGateway`), `FulfillmentModule`(FulfillmentCommandService export), `HANJIN_CONFIG` 토큰.
- Produces: `WaybillModule`(WaybillService export). **플랜 2 방향**: `WaybillModule` 이 `FulfillmentModule` 을 import(FulfillmentCommandService 획득). AppModule 이 WaybillModule 등록. **플랜 3 에서 방향 반전**(dispatch→WaybillService 순환 발생 시 FulfillmentCommandService 를 공유 모듈로 추출) — 이 플랜에선 하지 않음.

- [ ] **Step 1: 캐리어 팩토리** — `carrier/hanjin/carrier-gateway.factory.ts` (플랜 1 클래스들은 `@Injectable` 아님 → 수동 생성):
```typescript
import { loadHanjinConfig, type HanjinConfig } from './hanjin.config';
import { HanjinHmacSigner } from './hanjin-hmac.signer';
import { HanjinApiClient } from './hanjin-api.client';
import { HanjinCarrierGateway } from './hanjin-carrier.gateway';
import { CarrierGatewayRegistry } from '../carrier-gateway.registry';

export function buildHanjinConfig(): HanjinConfig {
  return loadHanjinConfig(process.env);
}

export function buildCarrierGatewayRegistry(config: HanjinConfig): CarrierGatewayRegistry {
  const signer = new HanjinHmacSigner({ clientId: config.clientId, apiKey: config.apiKey, secretKey: config.secretKey });
  const client = new HanjinApiClient(config, signer);
  const hanjin = new HanjinCarrierGateway(config, client);
  return new CarrierGatewayRegistry([hanjin]);
}
```

- [ ] **Step 2: 모듈** — `waybill.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment.module';
import { HANJIN_CONFIG } from './waybill.tokens';
import { CarrierGatewayRegistry } from './carrier/carrier-gateway.registry';
import { buildCarrierGatewayRegistry, buildHanjinConfig } from './carrier/hanjin/carrier-gateway.factory';
import { WaybillRepository } from './waybill.repository';
import { WaybillReader } from './waybill.reader';
import { WaybillIssueMachine } from './waybill-issue.machine';
import { WaybillManager } from './waybill.manager';
import { WaybillService } from './waybill.service';
import { WaybillController } from './waybill.controller';

@Module({
  imports: [FulfillmentModule], // FulfillmentCommandService 획득. 플랜 3 에서 방향 반전.
  controllers: [WaybillController],
  providers: [
    { provide: HANJIN_CONFIG, useFactory: buildHanjinConfig },
    { provide: CarrierGatewayRegistry, useFactory: buildCarrierGatewayRegistry, inject: [HANJIN_CONFIG] },
    WaybillRepository,
    WaybillReader,
    WaybillIssueMachine,
    WaybillManager,
    WaybillService,
  ],
  exports: [WaybillService],
})
export class WaybillModule {}
```

- [ ] **Step 3: AppModule 등록** — `apps/core/src/app.module.ts`. `FulfillmentModule`(line 47) 아래에 `WaybillModule` 추가 + import 문.
```typescript
import { WaybillModule } from './modules/fulfillment/waybill/waybill.module';
// imports 배열에서 FulfillmentModule 뒤:
    WaybillModule,
```

- [ ] **Step 4: 부팅/DI 테스트** — `waybill.module.spec.ts` (컴파일 후 모듈이 WaybillService 를 해석하는지):
```typescript
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { WaybillModule } from './waybill.module';
import { WaybillService } from './waybill.service';

// FulfillmentModule 이 무겁게 물려 있어 이 테스트는 컴파일-DI 스모크로만. DATABASE_URL 없으면 skip.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
describeIfDb('WaybillModule DI', () => {
  it('resolves WaybillService', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), WaybillModule] }).compile();
    expect(moduleRef.get(WaybillService)).toBeInstanceOf(WaybillService);
    await moduleRef.close();
  });
});
```
> 이 테스트가 DB/외부 모듈 배선 때문에 부담되면, 대신 **`nest build core` 성공 + 앱 부팅 스모크**(`npm run start:main:dev` 로 뜨는지 로그 확인)로 대체 가능. 최소한 `nest build core` 는 통과해야 한다.

- [ ] **Step 5: 빌드 + tsc + commit**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
Run: `nest build core` → 성공(dead-code 없이 전체 그래프 컴파일)
Run: `npm run test:core:integration:local -- waybill.module`(또는 부팅 스모크)
```bash
git add apps/core/src/modules/fulfillment/waybill/carrier/hanjin/carrier-gateway.factory.ts apps/core/src/modules/fulfillment/waybill/waybill.module.ts apps/core/src/app.module.ts apps/core/src/modules/fulfillment/waybill/waybill.module.spec.ts
git commit -m "feat(waybill): WaybillModule + 한진 게이트웨이 팩토리 + AppModule 배선"
```

---

## Task 13: `WaybillManager.issueBatch` (bounded 병렬 + 시간예산)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.service.ts`(`issueBatch` 위임 활성화) + `waybill.controller.ts`(batch 라우트 활성화)
- Test: `apps/core/src/modules/fulfillment/waybill/waybill.manager.integration.spec.ts`

**Interfaces:**
- Produces: `issueBatch(shipmentIds: string[], opts: {carrier: CarrierCode}, idemKey, actor): Promise<BatchResultItem[]>` where `BatchResultItem = {shipmentId, status, trackingNo, reason}`. shipment별 **현재 manifestVersion 사용**(배치는 버전 인자 없음). 각 shipment 를 `issueForShipment`(개별 idem key `${idemKey}:${shipmentId}`)로 발급하되 `WAYBILL.BATCH_CONCURRENCY` bounded 병렬 + `BATCH_TIME_BUDGET_MS` 초과 시 미발급건은 `status:'pending'`, `reason:'time-budget-exceeded'` 로 조기반환(silent truncation 금지 — 사유 기록).

- [ ] **Step 1: 실패 테스트 추가**:
```typescript
describe('issueBatch', () => {
  it('issues multiple shipments and returns per-item results', async () => {
    const s1 = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const s2 = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const mgr = manager(new CarrierGatewayRegistry([fakeCarrierGateway()]));
    const results = await mgr.issueBatch([s1.shipmentId, s2.shipmentId], { carrier: 'HANJIN', expectedManifestVersion: 0 }, `batch-${randomUUID()}`, actor);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'registered')).toBe(true);
  });

  it('records a per-item reason on failure without aborting the batch', async () => {
    const s1 = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    const s2 = await db.transaction((tx) => seedPlannedShipmentForWaybill(tx as never, deps));
    let call = 0;
    const gw = fakeCarrierGateway({
      allocate: async () => { call += 1; if (call === 1) throw new CarrierError('x', 'definitive_rejection', { code: 'ERROR-05' }); return { waybillNo: `WBL-${randomUUID().slice(0, 8)}`, labelData: {} }; },
    });
    const mgr = manager(new CarrierGatewayRegistry([gw]));
    const results = await mgr.issueBatch([s1.shipmentId, s2.shipmentId], { carrier: 'HANJIN', expectedManifestVersion: 0 }, `batch-${randomUUID()}`, actor);
    const failed = results.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain('ERROR-05');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- waybill.manager`
Expected: FAIL — `issueBatch is not a function`.

- [ ] **Step 3: 구현** — `waybill.manager.ts`. 배치는 shipment별 현재 버전으로 개별 발급(버전 게이트 없이 현재값 채택). bounded 병렬 + 시간예산.
```typescript
import type { BatchResultItem } from './waybill.types'; // 아래 타입 추가

async issueBatch(shipmentIds: string[], opts: { carrier: CarrierCode }, idempotencyKey: string, actor: Actor): Promise<BatchResultItem[]> {
  const deadline = Date.now() + WAYBILL.BATCH_TIME_BUDGET_MS;
  const results = new Map<string, BatchResultItem>();
  const queue = [...shipmentIds];

  const runOne = async (shipmentId: string): Promise<void> => {
    if (Date.now() >= deadline) {
      results.set(shipmentId, { shipmentId, status: 'pending', trackingNo: null, reason: 'time-budget-exceeded' });
      return;
    }
    try {
      const ctx = await this.dbService!.run((trx) => this.reader.loadIssueContext(trx, shipmentId));
      const wb = await this.issueForShipment(shipmentId, { carrier: opts.carrier, expectedManifestVersion: ctx.manifestVersion }, `${idempotencyKey}:${shipmentId}`, actor);
      results.set(shipmentId, { shipmentId, status: wb.status, trackingNo: wb.trackingNo, reason: wb.lastError });
    } catch (e) {
      results.set(shipmentId, { shipmentId, status: 'failed', trackingNo: null, reason: e instanceof Error ? e.message : String(e) });
    }
  };

  // bounded 병렬 풀
  const workers = Array.from({ length: Math.min(WAYBILL.BATCH_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await runOne(next);
    }
  });
  await Promise.all(workers);
  // 시간예산으로 큐에 남은 미착수건도 pending 사유 기록(silent truncation 금지)
  for (const id of queue) results.set(id, { shipmentId: id, status: 'pending', trackingNo: null, reason: 'time-budget-exceeded' });
  return shipmentIds.map((id) => results.get(id) ?? { shipmentId: id, status: 'pending', trackingNo: null, reason: 'not-processed' });
}
```
`waybill.types.ts` 에 타입 추가:
```typescript
export interface BatchResultItem {
  shipmentId: string;
  status: string;
  trackingNo: string | null;
  reason: string | null;
}
```

- [ ] **Step 4: 서비스/컨트롤러 배치 위임 활성화** — Task 11 에서 주석 처리했던 `WaybillService.issueBatch` 와 컨트롤러 batch 라우트를 활성화(주석 해제). `WaybillService.issueBatch` 시그니처를 `issueBatch(shipmentIds, opts: {carrier}, idemKey, actor)` 로 맞춘다.

- [ ] **Step 5: 통과 + tsc + commit**

Run: `npm run test:core:integration:local -- waybill.manager` → PASS(15)
Run: `npm run test -- --testPathPattern=waybill.controller` → PASS
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add apps/core/src/modules/fulfillment/waybill
git commit -m "feat(waybill): issueBatch(bounded 병렬 + 시간예산 조기반환)"
```

---

## Task 14: 스테이징 스모크 스크립트 (게이트) + 문서

**Files:**
- Create: `scripts/smoke/hanjin-staging-smoke.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/README.md`

**Interfaces:**
- Produces: 실행형 스모크 스크립트 — `HANJIN_*` env 존재 시에만 실제 호출. **order 호스트(insert-order/tracking)** 를 dev key 로 실사격해 body 매핑을 검증(§3.1-4). `print-wbl`(ebbapd) 은 방화벽 IP 미커버 시 **skip + 경고 로그**(silent 금지). CI 아님 — 사람이 `npx tsx scripts/smoke/hanjin-staging-smoke.ts` 로 실행.

- [ ] **Step 1: 스크립트 작성** — `scripts/smoke/hanjin-staging-smoke.ts`:
```typescript
/* 한진 스테이징 실사격 스모크. CI 아님. `npx tsx scripts/smoke/hanjin-staging-smoke.ts` */
import { loadHanjinConfig, isHanjinConfigured } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin.config';
import { HanjinHmacSigner } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-hmac.signer';
import { HanjinApiClient } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-api.client';
import { HanjinCarrierGateway } from '../../apps/core/src/modules/fulfillment/waybill/carrier/hanjin/hanjin-carrier.gateway';
import { assembleWaybillRequest } from '../../apps/core/src/modules/fulfillment/waybill/waybill-request.assembler';

async function main() {
  const config = loadHanjinConfig(process.env);
  if (!isHanjinConfigured(config)) {
    console.error('SKIP: HANJIN_* env not configured. Set dev keys to run the staging smoke.');
    process.exit(2);
  }
  const signer = new HanjinHmacSigner({ clientId: config.clientId, apiKey: config.apiKey, secretKey: config.secretKey });
  const client = new HanjinApiClient(config, signer);
  const gateway = new HanjinCarrierGateway(config, client);

  const req = assembleWaybillRequest({
    shipmentId: '018f3b2c-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
    recipientSnapshot: { recipientName: '테스트수취인', phone: '010-0000-0000', postalCode: '01234', roadAddress: '서울 종로구 세종대로 1', detailAddress: '101', deliveryNote: '스모크' },
    lines: [{ productName: '스모크상품', quantity: 1, skuId: 'smoke' }],
    config,
  });

  // print-wbl: 방화벽 IP 커버 시에만. 커버 안 되면 fetch 가 timeout/거부 → 경고.
  console.log('--- allocate(print-wbl) — 방화벽 IP 등록 필요. 실패 시 IP 미커버로 간주 ---');
  let waybillNo: string | undefined;
  try {
    const r = await gateway.allocate(req);
    waybillNo = r.waybillNo;
    console.log('allocate OK:', waybillNo, Object.keys(r.labelData));
  } catch (e) {
    console.warn('allocate FAILED (print-wbl IP 미커버 가능):', (e as Error).message);
  }

  // insert-order/tracking: order 호스트, dev key 로 검증.
  if (waybillNo) {
    console.log('--- register(insert-order) ---');
    console.log('register:', await gateway.register(waybillNo, req));
    console.log('--- track(tracking-wbl) ---');
    console.log('track:', await gateway.track(waybillNo));
  } else {
    console.warn('SKIP register/track: no waybillNo (print-wbl unavailable).');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: README 작성** — `apps/core/src/modules/fulfillment/waybill/README.md`: 모듈 개요(레이어·상태머신·seam), 스모크 실행법, **미해결 리스크**(print-wbl 방화벽 IP·라이브 자격증명은 개발완료 후·plan 3 소비자 rewire 미완). §3.1-4 게이트 상태 명시.

- [ ] **Step 3: 실행(있으면) + commit**

Run(선택, env 있을 때만): `npx tsx scripts/smoke/hanjin-staging-smoke.ts` — order 호스트 검증. env 없으면 `SKIP`(exit 2)로 정상.
Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit` → exit 0
```bash
git add scripts/smoke/hanjin-staging-smoke.ts apps/core/src/modules/fulfillment/waybill/README.md
git commit -m "feat(waybill): 스테이징 스모크 스크립트(게이트) + 모듈 README"
```

---

## Self-Review (작성자 체크)

**Spec coverage (§ → task):**
- §5(스키마·enum·제약·마이그레이션) → Task 1 ✓
- §3.1-1(custOrdNo) → Task 2 ✓; §조사(어셈블러 매핑) → Task 3 ✓
- §8(상태머신 전이·abandon 비대칭·CAP) → Task 5 ✓ (allocated 무제한/자동포기 금지, pending CAP 자동 검증)
- §9.1 seam(issueForShipment·registerManual·void·reissue·assertDispatchable·markUsed·getActiveWaybill·issueBatch) → Task 7·8·9·10·13 ✓; self 계승(assertProfileComplete 미적용) Task 8, externalServiceId 폐지 Task 10 ✓
- §9.2(컨트롤러 라우트 6·스코프·idempotency-key) → Task 11 ✓
- §10(배치 bounded 병렬·시간예산·silent truncation 금지) → Task 13 ✓
- §11(void 발송전 안전범위·reissue·abandon 규칙) → Task 9 ✓
- §3.1-3(markUsed 멱등+엄격) → Task 10 ✓; §3.1-4(스모크) → Task 14 ✓
- 모듈 배선 + additive 유지 → Task 12·Global Constraints ✓

**미커버/의도적 스코프 밖(플랜 3):** 소비자 rewire(dispatch/picking/recall/short-pick/planning/invariant/consolidation), 구 invoice DROP, 모듈 방향 반전(FulfillmentCommandService 추출). abandon **운영자 액션 API**(allocated 수동 포기)는 §8 이 운영자-전용이라 명시했으나 본 플랜은 stuck 재구동(drive 재호출)만 제공 — 명시적 운영자 abandon 엔드포인트는 후속(필요 시 소량 태스크).

**Placeholder/일관성:** custOrdNo 정규식 `[0-9ABCDEFGHJKMNPQRSTVWXYZ]` = Crockford(I/L/O/U 제외) 전 태스크 일치. `WaybillRow`=`Waybill`(schema InferSelect) 전 태스크 일치. `casToUsed` 반환 number(0/1) Task 4↔10 일치. `issueForShipment` tx 미수용(외부 I/O) — Global Constraints·Task 7 일치.

**알려진 실행 주의:**
1. Task 11 의 `WaybillService.issueBatch`/컨트롤러 batch 는 Task 13 전이면 임시 주석(순서 의존). Task 13 을 Task 11 앞에 실행하면 주석 불필요.
2. `wired.planning`/`wired.fulfillments` 접근자는 `logistics-wiring.ts` 실물로 확인해 픽스처 `deps` 배선(플랜은 `wired.fulfillments.create` 확인, planning 은 wiring 노출 형태 확인 필요).
3. Task 7 의 `commands.execute().then(재조립)` 은 idempotent replay 시 핸들러 지역변수 부재를 우회하기 위한 의도된 구조 — drive 는 저장상태 기준이라 안전.
4. `inventory.schema.ts` 의 `wmsTables` 리터럴에 `waybills` 등록 누락 시 `inventoryTables.waybills` 가 undefined — Task 1 Step 4 필수.

## Execution Handoff (플랜 실행)

이 플랜은 subagent-driven 실행을 권장한다(태스크마다 신선한 서브에이전트 + 2단계 리뷰). Task 5(상태머신)·Task 7~10(매니저)·Task 13(배치)이 correctness 핵심이라 리뷰 게이트가 특히 유효하다.
