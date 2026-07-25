# packing_unit varchar → integer 타입 교정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `sku_barcodes.packing_unit`을 `varchar(64)`에서 `integer`(+ `>= 1` CHECK)로 좁히고, 그 때문에 존재하던 varchar↔number 경계 함수를 제거한다.

**Architecture:** 기존 값은 실무 미사용이므로 마이그레이션 첫 줄에서 전량 NULL로 폐기한다. Postgres는 varchar→integer에 등록된 캐스트가 없어 `SET DATA TYPE`은 `USING` 절이 있어야 통과하는데, 앞선 UPDATE로 전량 NULL을 만들어 둔 뒤라 그 캐스트가 숫자 아닌 문자열을 만날 일이 없어 안전하다. 그렇게 컬럼이 전량 NULL이면 롤링 배포 중 구/신 코드가 무엇을 읽든 `null`이라 ADR-0005의 3-PR expand-contract를 생략하고 단일 PR로 간다. API 계약(`number | null`)은 PR #540에서 이미 확정돼 있어 이번 변경으로 바뀌지 않는다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), PostgreSQL, Jest(백엔드) / Vitest(현장 앱), class-validator

## Global Constraints

- 설계 근거: `docs/superpowers/specs/2026-07-25-packing-unit-integer-design.md`
- 컬럼은 **nullable로 유지**한다. 포장단위 없는 낱개 바코드가 정상 상태다.
- `schema.ts` + `drizzle/<timestamp>_*.sql` + `drizzle/meta/`는 **반드시 한 커밋**에 묶는다 (CLAUDE.md).
- 생성된 마이그레이션 SQL은 **적용 전에만** 손댄다. 한 번 적용된 파일은 절대 수정하지 않는다.
- `web/df-admin`은 은퇴한 기술실증 앱이다. **수정하지 않는다.**
- `native/warehouse-app`의 `scanIncrement` 방어 로직(`typeof unit !== 'number'` 등)은 **삭제하지 않는다.** API 응답을 신뢰하지 않는 클라이언트 경계 방어다.
- 통합 테스트는 로컬 compose Postgres에서 돈다: `npm run test:core:integration:local -- <pattern>`
- 배포 순서는 `db:migrate` → `sst deploy` (expand 순서). 코드가 아니라 런북 사항이다.

---

### Task 1: DTO에 int4 상한 추가

`@Max`가 없으면 `2147483648` 같은 값이 DB까지 내려가 `22003`으로 500이 된다. DB의 진실을 DTO 경계에서 400으로 돌려준다. 스키마와 무관하게 독립적으로 완결되므로 먼저 처리한다.

**Files:**
- Modify: `apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.ts`
- Modify: `apps/core/src/modules/inventory/inbound/dto/create-stock-entry-by-skuid.dto.ts`
- Test: `apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `AddBarcodeDto.packingUnit?: number` / `CreateStockEntryBySkuIdDto.packingUnit?: number` — 둘 다 `@IsInt() @Min(1) @Max(2147483647) @IsOptional()`. 타입 시그니처는 변하지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts`의 마지막 `it('0 과 음수를 거부한다', ...)` 블록 **뒤에** 아래를 추가한다:

```typescript
  // int4 상한을 넘으면 DB 가 22003 을 던져 500 이 된다. 경계에서 400 으로 막는다.
  it('int4 상한을 받고 그 위를 거부한다', async () => {
    await expect(validate(dtoWith(2147483647))).resolves.toHaveLength(0);

    const errors = await validate(dtoWith(2147483648));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('packingUnit');
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts
```

Expected: FAIL — `int4 상한을 받고 그 위를 거부한다`에서 `expect(received).toHaveLength(1)` / `Received length: 0`. 상한 검증이 없어 `2147483648`이 통과한다.

- [ ] **Step 3: `AddBarcodeDto`에 `@Max`를 단다**

`apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.ts` 전체를 아래로 바꾼다:

```typescript
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** packing_unit 은 int4 컬럼이라 상한이 있다. 넘기면 DB 가 22003 을 던지므로 경계에서 막는다. */
const INT4_MAX = 2147483647;

export class AddBarcodeDto {
  @ApiProperty({ description: '바코드 값' })
  @IsString()
  @IsNotEmpty()
  barcode: string;

  @ApiProperty({
    description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량',
    required: false,
    minimum: 1,
    maximum: INT4_MAX,
  })
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  @IsOptional()
  packingUnit?: number;
}
```

- [ ] **Step 4: `CreateStockEntryBySkuIdDto`에도 같은 상한을 단다**

`apps/core/src/modules/inventory/inbound/dto/create-stock-entry-by-skuid.dto.ts`의 2번째 줄 import를 바꾼다:

```typescript
import { IsUUID, IsNotEmpty, IsNumber, IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
```

같은 파일의 `packingUnit` 필드를 아래로 바꾼다:

```typescript
  @ApiProperty({
    description: '포장 단위 — 이 바코드 1회 스캔이 뜻하는 낱개 수량',
    required: false,
    minimum: 1,
    maximum: 2147483647,
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsOptional()
  packingUnit?: number;
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
npx jest apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts
```

Expected: PASS — 5 passed.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.ts \
        apps/core/src/modules/inventory/sku-catalog/dto/add-barcode.dto.spec.ts \
        apps/core/src/modules/inventory/inbound/dto/create-stock-entry-by-skuid.dto.ts
git commit -m "fix(core): packingUnit DTO 에 int4 상한 추가"
```

---

### Task 2: 컬럼 타입 교정과 경계 함수 제거

컬럼 타입이 바뀌면 Drizzle이 추론하는 타입도 `string | null` → `number | null`로 바뀌고, `parsePackingUnit(raw: string)`을 호출하던 5곳이 즉시 컴파일 에러가 된다. 즉 **스키마·마이그레이션·호출부는 한 태스크로 묶어야 컴파일 가능한 상태가 유지된다.** 쪼개면 중간 커밋이 빌드되지 않는다.

**Files:**
- Create: `apps/core/src/modules/inventory/schema/sku-barcodes-schema.integration.spec.ts`
- Create: `apps/core/drizzle/<timestamp>_narrow-packing-unit-to-integer.sql` (생성 후 손으로 한 줄 추가)
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:560-570`
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.reader.ts` (import 8행, 114·253·429행)
- Modify: `apps/core/src/modules/inventory/sku-catalog/mappers/sku.mapper.ts` (import 3행, 11행)
- Modify: `apps/core/src/modules/inventory/inbound/services/inbound.service.ts` (import 25행, 1140행)
- Modify: `apps/core/src/modules/inventory/sku-catalog/services/sku-catalog.manager.ts` (import 11행, 230행)
- Modify: `apps/core/src/modules/inventory/core/services/stock-event.service.ts` (import 11행, 69행)
- Delete: `apps/core/src/modules/inventory/sku-catalog/packing-unit.ts`
- Delete: `apps/core/src/modules/inventory/sku-catalog/packing-unit.spec.ts`

**Interfaces:**
- Consumes: Task 1의 DTO들 (시그니처 무변화)
- Produces:
  - `skuBarcodes.packingUnit` — Drizzle 추론 타입 `number | null` (select), `number | null | undefined` (insert)
  - `SkuBarcode`(`InferSelectModel`) 의 `packingUnit: number | null`
  - `parsePackingUnit` / `serializePackingUnit` — **삭제됨.** 이후 어떤 코드도 import 하지 않는다.
  - DB 제약 `ck_sku_barcodes_packing_unit_positive`

- [ ] **Step 1: CHECK 제약 통합 테스트를 쓴다**

`apps/core/src/modules/inventory/schema/sku-barcodes-schema.integration.spec.ts` 를 새로 만든다. 같은 디렉터리의 `outbound-v2-schema.integration.spec.ts`가 쓰는 rollback-only 패턴을 그대로 따른다 — `DATABASE_URL`이 없으면 skip, 모든 삽입은 트랜잭션 안에서 일어나고 마지막에 강제 롤백한다.

```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from './inventory.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('sku_barcodes.packing_unit (PostgreSQL constraints, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
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

  /** 바코드를 달 SKU 하나. holder 는 skus.holder_id 가 NOT NULL 이라 필요하다. */
  async function fixture(tx: DbTx) {
    const suffix = randomUUID();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `packing-unit-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'packing-unit-sku', code: `PACKING-UNIT-${suffix}`, holderId: holder.id })
      .returning();
    return { sku, suffix };
  }

  async function expectCheckViolation(tx: DbTx, action: (savepoint: DbTx) => Promise<unknown>) {
    let caught: unknown;
    try {
      await tx.transaction((savepoint) => action(savepoint as unknown as DbTx));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();

    const evidence: string[] = [];
    let current = caught as (Error & { cause?: unknown; constraint_name?: string; code?: string }) | undefined;
    for (let depth = 0; current && depth < 5; depth += 1) {
      evidence.push(current.message, current.constraint_name ?? '', current.code ?? '');
      current = current.cause as typeof current;
    }
    expect(evidence.join(' ')).toContain('ck_sku_barcodes_packing_unit_positive');
  }

  it('양의 정수 포장단위를 받는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [row] = await tx
        .insert(wmsTables.skuBarcodes)
        .values({ skuId: f.sku.id, barcode: `PU-OK-${f.suffix}`, packingUnit: 20 })
        .returning();
      expect(row.packingUnit).toBe(20);
    });
  });

  it('포장단위 없는 바코드를 받는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [row] = await tx
        .insert(wmsTables.skuBarcodes)
        .values({ skuId: f.sku.id, barcode: `PU-NULL-${f.suffix}` })
        .returning();
      expect(row.packingUnit).toBeNull();
    });
  });

  it('0 을 거부한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectCheckViolation(tx, (sp) =>
        sp.insert(wmsTables.skuBarcodes).values({ skuId: f.sku.id, barcode: `PU-ZERO-${f.suffix}`, packingUnit: 0 }),
      );
    });
  });

  it('음수를 거부한다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectCheckViolation(tx, (sp) =>
        sp.insert(wmsTables.skuBarcodes).values({ skuId: f.sku.id, barcode: `PU-NEG-${f.suffix}`, packingUnit: -5 }),
      );
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npm run test:core:integration:local -- sku-barcodes-schema.integration
```

Expected: FAIL. 컬럼이 아직 `varchar`라 Drizzle 타입이 `string`이고 `packingUnit: 20`이 **TypeScript 컴파일 에러**(`Type 'number' is not assignable to type 'string'`)를 낸다. 이 컴파일 실패가 red 상태다. 제약이 없다는 사실도 함께 확인하고 싶으면 `packingUnit: '0'`으로 잠깐 바꿔 돌려보면 위반 없이 통과한다 — 확인 후 `0`으로 되돌린다.

- [ ] **Step 3: 스키마를 고친다**

`apps/core/src/modules/inventory/schema/inventory.schema.ts`의 `skuBarcodes` 정의(560-570행)를 아래로 바꾼다. `integer`와 `check`는 이미 이 파일에 import 돼 있다.

```typescript
export const skuBarcodes = pgTable(
  'sku_barcodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),
    barcode: varchar('barcode', { length: 64 }).notNull().unique(),
    isPrimary: boolean('is_primary').notNull().default(false),
    // 이 바코드 1회 스캔이 뜻하는 낱개 수량. 상자 바코드면 n, 낱개 바코드면 NULL.
    packingUnit: integer('packing_unit'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ckPackingUnitPositive: check(
      'ck_sku_barcodes_packing_unit_positive',
      sql`${t.packingUnit} IS NULL OR ${t.packingUnit} >= 1`,
    ),
  }),
);
```

- [ ] **Step 4: 마이그레이션을 생성한다**

```bash
npm run db:generate:core -- --name narrow-packing-unit-to-integer
```

Expected: `apps/core/drizzle/<timestamp>_narrow-packing-unit-to-integer.sql` 과 `drizzle/meta/` 갱신. drizzle-kit이 rename 프롬프트를 띄우면 **잘못된 것이다** — 컬럼 이름은 그대로이므로 중단하고 스키마 편집을 재확인한다.

- [ ] **Step 5: 마이그레이션 SQL 맨 위에 데이터 폐기 구문을 추가한다**

생성된 `.sql` 파일의 **맨 앞**에 아래를 붙인다. (아직 적용 전이므로 편집해도 된다.)

```sql
-- packing_unit 은 "몇 개입"이라는 숫자인데 컬럼이 varchar(64) 였다.
-- 값이 실무에서 쓰인 적이 없어 전량 폐기하고 타입을 좁힌다.
-- ADR-0005 §5 의 3-PR expand-contract 를 생략한 근거:
-- 버릴 데이터라 손실이 없고, ALTER 직후 컬럼이 전량 NULL 이라
-- 롤링 배포 중 구/신 코드가 무엇을 읽든 null 이다.
-- 배포 순서는 migrate → deploy (expand 순서).
-- Postgres 는 varchar→integer 에 등록된 묵시적/대입 캐스트가 없어
-- 테이블이 텅 비어(전량 NULL) 있어도 USING 절 없이는 ALTER 가 거부된다
-- ("column ... cannot be cast automatically to type integer").
-- 위 UPDATE 로 전량 NULL 을 만들어 둔 뒤라 USING 캐스트는 안전하다.
UPDATE "sku_barcodes" SET "packing_unit" = NULL WHERE "packing_unit" IS NOT NULL;
```

그 아래 drizzle이 생성한 `SET DATA TYPE integer USING "packing_unit"::integer`와 `ADD CONSTRAINT`는 손대지 않는다. `USING` 캐스트는 drizzle-kit이 이미 만들어 둔 것이다 — Postgres에 varchar→integer 묵시적 캐스트가 없어 이 절 없이는 ALTER가 거부되기 때문이며, 위 UPDATE로 전량 NULL을 만들어 둔 뒤라 그 캐스트가 숫자 아닌 문자열을 만날 일이 없어 안전하다.

- [ ] **Step 6: 읽기 5곳에서 `parsePackingUnit`을 걷어낸다**

`sku-catalog.reader.ts` — 8행의 `import { parsePackingUnit } from '../packing-unit';`을 **삭제**하고, 세 곳을 바꾼다:

```typescript
// 114행 근처
        packingUnit: b.packingUnit,
// 253행 근처 (변수명이 bc 다)
          packingUnit: bc.packingUnit,
// 429행 근처
              packingUnit: b.packingUnit,
```

`sku.mapper.ts` — 파일 전체를 아래로 바꾼다:

```typescript
import { SkuBarcode } from '../../schema/inventory.schema';
import { BarcodeDto } from '../dto/sku-response.dto';

export class SkuBarcodeMapper {
  static toDto(barcode: SkuBarcode): BarcodeDto {
    return {
      id: barcode.id,
      barcode: barcode.barcode,
      isPrimary: barcode.isPrimary,
      packingUnit: barcode.packingUnit,
    };
  }
}
```

`inbound.service.ts` — 25행의 `import { parsePackingUnit } from '../../sku-catalog/packing-unit';`을 **삭제**하고 1140행을 바꾼다:

```typescript
      packingUnit: skuBarcode.packingUnit,
```

- [ ] **Step 7: 쓰기 2곳에서 `serializePackingUnit`을 걷어낸다**

`sku-catalog.manager.ts` — 11행의 `import { serializePackingUnit } from '../packing-unit';`을 **삭제**하고 230행을 바꾼다:

```typescript
          packingUnit: dto.packingUnit ?? null,
```

`stock-event.service.ts` — 11행의 `import { serializePackingUnit } from '../../sku-catalog/packing-unit';`을 **삭제**하고 69행을 바꾼다:

```typescript
            packingUnit: packingUnit ?? null,
```

- [ ] **Step 8: 경계 함수 파일을 지운다**

```bash
git rm apps/core/src/modules/inventory/sku-catalog/packing-unit.ts \
       apps/core/src/modules/inventory/sku-catalog/packing-unit.spec.ts
```

- [ ] **Step 9: 남은 참조가 없는지 확인한다**

```bash
grep -rn "parsePackingUnit\|serializePackingUnit\|packing-unit'" --include=*.ts apps/ native/ web/
```

Expected: 출력 없음. 하나라도 나오면 그 파일을 Step 6-7 방식으로 정리한다.

- [ ] **Step 10: 컴파일을 확인한다**

```bash
npx tsc --noEmit -p apps/core/tsconfig.app.json 2>&1 | head -20
```

Expected: 에러 없음.

- [ ] **Step 11: 마이그레이션을 적용하고 통합 테스트를 돌린다**

```bash
npm run test:core:integration:local -- sku-barcodes-schema.integration
```

Expected: PASS — 4 passed. 이 스크립트가 compose Postgres 기동 → `drizzle-kit migrate` → jest 순으로 돈다.

- [ ] **Step 12: 인접 회귀를 확인한다**

```bash
npx jest --testPathPattern="sku-catalog|inbound" 2>&1 | tail -20
```

Expected: 기존 통과 테스트가 그대로 통과. `packing-unit.spec.ts`는 사라졌으므로 목록에 없어야 정상이다.

- [ ] **Step 13: 커밋**

스키마·마이그레이션·meta·호출부를 **한 커밋**에 묶는다.

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/src/modules/inventory/schema/sku-barcodes-schema.integration.spec.ts \
        apps/core/drizzle/ \
        apps/core/src/modules/inventory/sku-catalog/ \
        apps/core/src/modules/inventory/inbound/services/inbound.service.ts \
        apps/core/src/modules/inventory/core/services/stock-event.service.ts
git commit -m "fix(core): sku_barcodes.packing_unit 을 integer 로 교정하고 경계 함수 제거"
```

---

### Task 3: 현장 앱 주석 갱신과 최종 검증

앱 로직은 변하지 않는다. 다만 "컬럼이 varchar라서" 성립하던 주석이 이제 틀렸으므로 사실에 맞춘다.

**Files:**
- Modify: `native/warehouse-app/src/domains/inbound/packingUnit.ts:10-11`

**Interfaces:**
- Consumes: Task 2가 만든 DB 제약(코드 의존은 없음)
- Produces: 없음. `scanIncrement(sku, barcode): number` 시그니처와 동작 모두 무변화.

- [ ] **Step 1: 앱 테스트가 지금도 통과하는지 확인한다 (기준선)**

```bash
cd native/warehouse-app && npm test -- packingUnit && cd ../..
```

Expected: PASS. 이 테스트들은 이미 number/null을 쓰므로 백엔드 변경과 무관하게 통과해야 한다. 여기서 실패하면 Task 2에서 계약을 잘못 건드린 것이므로 되돌아간다.

- [ ] **Step 2: 주석을 사실에 맞춘다**

`native/warehouse-app/src/domains/inbound/packingUnit.ts`의 10-11행을 바꾼다.

바꾸기 전:

```typescript
 * 참고: 현재 sku_barcodes.packing_unit 은 전량 NULL 이라 실효 동작은 모두 +1 이다.
 * 운영에서 포장단위를 채우기 시작하면 앱 배포 없이 배수 누적으로 바뀐다.
```

바꾼 뒤:

```typescript
 * 참고: sku_barcodes.packing_unit 은 integer 컬럼이고 DB 가 >= 1 을 강제한다.
 * 2026-07-25 타입 교정 때 기존 값을 전량 폐기해 현재는 모두 NULL — 실효 동작은 +1 이다.
 * 운영에서 포장단위를 채우기 시작하면 앱 배포 없이 배수 누적으로 바뀐다.
```

위의 `typeof unit !== 'number'` 방어 로직은 **건드리지 않는다.** DB 제약이 생겨도 API 응답을 신뢰하지 않는 클라이언트 경계 방어는 유지한다.

- [ ] **Step 3: 앱 전체 테스트와 타입체크**

```bash
cd native/warehouse-app && npm test && npx tsc -b --noEmit; cd ../..
```

Expected: 모든 vitest 통과, 타입 에러 없음.

- [ ] **Step 4: core 빌드**

```bash
npx nest build core 2>&1 | tail -20
```

Expected: 빌드 성공(출력 없음). 이번 변경은 core 안에서 끝나므로 `build:all` 전체를 돌릴 필요는 없다. 이 저장소는 `npm run lint`와 admin-web `type-check`에 상시 debt가 있으니, 검증은 이번 변경 파일에서 새로 생긴 에러만 스코프로 본다.

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/inbound/packingUnit.ts
git commit -m "docs(warehouse-app): packing_unit 이 integer 컬럼이 된 사실 반영"
```

---

## 완료 후 (사람이 하는 일)

코드가 끝나도 배포는 자동이 아니다. ADR-0005 상 autodeploy가 없으므로 아래는 운영자가 직접 부른다.

```bash
# 1) 마이그레이션 먼저 (expand 순서)
npm run db:migrate -- --stage <stage> --deployment lcnine-services --yes
# 2) 그 다음 배포
sst deploy
```

순서를 뒤집으면 신 코드가 varchar 문자열을 `number` 선언 자리에서 받아, 앱이 배수를 적용하지 않고 +1로 폴백한다. 크래시는 아니지만 잘못된 상태다.

- 마이그레이션: 1건
- 신규 SST Secret / 환경변수 / 플래그: 없음
- warehouse-app 재배포: 불필요 (API 계약·앱 동작 무변화)
