# 판매상품 대량등록 v2 — 3단계: commit/publish 비동기 잡화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /product-imports/commit` 과 `POST /product-imports/:id/publish` 를 접수 즉시 반환하는 비동기 잡으로 바꾸고, 행 단위 생성·게시 상태를 DB 에 영속 추적해 중단 후 재개가 되게 한다.

**Architecture:** 접수 요청은 `parse → normalize → validate` 까지만 동기로 끝내고(전부 인메모리 + 카테고리 트리 1쿼리), 검증된 `ProductRecord` 를 `product_import_items.payload`(jsonb) 로 행마다 적은 뒤 202 로 반환한다. Core 안의 `@Cron` 워커가 `FOR UPDATE SKIP LOCKED` 로 세션 하나를 클레임해 **행 N개만** 처리하고 lease 를 놓는다 — 진행 원장은 행의 status 자체이므로 재개가 공짜다. 새 인프라는 들이지 않고 `OutboxDispatcher` 와 같은 패턴을 쓴다.

**Tech Stack:** NestJS · Drizzle ORM · PostgreSQL · `@nestjs/schedule` · Jest · Next.js(admin-web) · TanStack Query

## Global Constraints

스펙 `docs/superpowers/specs/2026-07-28-product-bulk-import-v2-design.md` §4.3.1~4.3.5 · §9 의 전역 요구사항. 모든 태스크에 암묵적으로 적용된다.

- **범위**: 이 계획은 스펙 §7 의 **3단계**와, §9 의 **② 무리(#12·#8·#2)** + **① 중 3단계에 흡수되는 것(#4·#6)** 만 담는다. #7·#11 은 5단계 계획, #1·#3·#5·#9·#10 은 5단계 뒤 정리 커밋, #13 은 범위 밖이다.
- **트랜잭션 전파** (루트 CLAUDE.md, ADR-0025): public 메서드는 `tx?: DbTransaction` 을 마지막 파라미터로, private 헬퍼는 `tx: DbTransaction` 필수. `this.db.run(async (trx) => …, tx)` 단일 러너만 쓰고 내부에서는 `trx` 만 쓴다. 클래스별 `inTx` 헬퍼를 새로 만들지 않는다.
- **레이어**: Controller → Service → Reader/Manager → Repository. Controller 는 Repository 를 직접 부르지 않고, 서비스 계층은 `HttpException` 을 import 하지 않는다. 도메인 예외는 `@app/shared` 의 `BadRequestError` / `NotFoundError` / `ConflictError`.
- **타입 안전성**: `any` / `as` 캐스팅 금지(근거 주석 + 팀 승인 예외). 단 **기존 spec 파일의 mock 은 예외** — 이 모듈의 spec 들은 이미 `as any` 로 목을 만든다(`product-import.manager.spec.ts`). 그 관례를 따른다.
- **권위 타입 게이트**: `npx nest build core`. 레포 eslint 와 레포 전역 `tsc` 는 미게이트 debt 이므로 판단 근거로 쓰지 않는다 (전역 `tsc --noEmit` 은 오늘 2,058줄 오류다 — Task 1 참조).
- **`product_import_sessions.status`(`completed`|`archived`)는 건드리지 않는다.** 그건 아카이브 플래그이고, 잡 라이프사이클은 이 계획이 추가하는 `commit_status`/`publish_status` 다.
- **신규 환경변수는 반드시 `apps/core/src/config/env.validation.ts` 의 `almondyoungEnvSchema` 에 선언한다.** `validateAlmondyoungEnv` 가 zod `safeParse` 의 `parsed.data` 를 반환하는데 zod object 는 기본이 non-strict 라 **선언되지 않은 키를 조용히 버린다**. 선언을 빠뜨리면 `configService.get()` 이 항상 `undefined` 를 반환해 노브가 죽은 채로 배포된다.
- **마이그레이션은 additive 1건**이고 expand phase 이므로 **`migrate` → `deploy`** 순서다 (contract phase 의 반대). ADR-0005 §5.

---

### Task 1: 임포트 모듈 타입 게이트 + 기존 오류 4건 정리 (#12)

`tsconfig.build.json` 이 `**/*spec.ts` 를 제외하므로 `nest build core` 는 spec 파일의 타입 오류를 못 본다. 그래서 2단계에서 `NormalizedOption.sortOrder` 를 필수로 만들 때 spec 4곳이 깨진 채로 머지됐다 — 지금 실재하는 오류다.

레포 전역 `tsc -p tsconfig.json --noEmit` 은 **오늘 2,058줄 오류**를 낸다(대부분 `native/warehouse-app` 1,633줄, `deployments/*` 175줄, `apps/core/src` 81줄). 따라서 게이트는 **스코프 방식**이어야 한다 — 지금 손대는 모듈만 포함하고, 스코프는 배열에 줄을 더해 넓힌다.

**Files:**
- Create: `tsconfig.spec-scope.json`
- Modify: `package.json` (scripts)
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts:146`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts:65,105`

**Interfaces:**
- Consumes: 루트 `tsconfig.json` 의 `compilerOptions`(`paths` 포함)
- Produces: `npm run type-check:scoped` — exit 0 이 게이트

- [ ] **Step 1: 게이트가 실패하는 것을 먼저 확인한다**

`tsconfig.spec-scope.json` 을 만든다. 루트 tsconfig 를 `extends` 하면 `compilerOptions.paths` 를 그대로 물려받고, 자식의 `include` 가 부모의 암묵적 "전부 포함"을 덮는다.

```json
{
  "extends": "./tsconfig.json",
  "include": ["apps/core/src/modules/catalog/operations/import/**/*.ts"]
}
```

파일 상단에 주석을 둘 수 없는 형식이므로, 스코프의 근거는 `package.json` 스크립트 옆이 아니라 이 계획과 커밋 메시지가 남긴다. 스코프를 넓힐 때는 `include` 배열에 경로를 추가한다.

- [ ] **Step 2: 게이트 실행 — 실패 확인**

Run: `npx tsc -p tsconfig.spec-scope.json --noEmit`
Expected: FAIL, 정확히 4건. 전부 `error TS2741: Property 'sortOrder' is missing ... but required in type 'NormalizedOption'`
- `product-import.manager.spec.ts(146,21)`
- `product-import.validator.spec.ts(65,9)`
- `product-import.validator.spec.ts(105,80)`
- `product-import.validator.spec.ts(105,86)`

**4건보다 많이 나오면 멈추고 보고한다** — 이 계획이 세운 전제(모듈 밖은 이미 깨끗하다)가 틀렸다는 뜻이다.

- [ ] **Step 3: 4건을 고친다**

`product-import.manager.spec.ts:146` — `options` 리터럴에 `sortOrder` 를 넣는다.

```ts
          options: [{ displayName: '색상', values: [{ displayName: '빨강' }], sortOrder: 1 }],
```

`product-import.validator.spec.ts:65` — `record()` 두 번째 인자의 옵션 리터럴.

```ts
      record({ productKey: 'P1', name: 'x' }, [
        { displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '빨강' }], sortOrder: 1 },
      ]),
```

`product-import.validator.spec.ts:103-104` — `many` / `many2` 에 각각 넣는다.

```ts
    const many = {
      displayName: '색상',
      values: Array.from({ length: 11 }, (_, i) => ({ displayName: `c${i}` })),
      sortOrder: 1,
    };
    const many2 = {
      displayName: '사이즈',
      values: Array.from({ length: 11 }, (_, i) => ({ displayName: `s${i}` })),
      sortOrder: 2,
    };
```

- [ ] **Step 4: 게이트 실행 — 통과 확인**

Run: `npx tsc -p tsconfig.spec-scope.json --noEmit`
Expected: exit 0, 출력 없음

- [ ] **Step 5: npm 스크립트로 고정**

`package.json` 의 `scripts` 에 추가한다(`lint` 근처, 알파벳 순서 무관 — 기존 파일이 정렬돼 있지 않다).

```json
    "type-check:scoped": "tsc -p tsconfig.spec-scope.json --noEmit",
```

- [ ] **Step 6: 스크립트로 다시 실행 — 통과 확인**

Run: `npm run type-check:scoped`
Expected: exit 0

- [ ] **Step 7: 테스트가 여전히 통과하는지 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: 전체 PASS (타입만 고쳤으므로 런타임 동작 변화 없음)

- [ ] **Step 8: 커밋**

```bash
git add tsconfig.spec-scope.json package.json apps/core/src/modules/catalog/operations/import
git commit -m "test(core): 대량등록 임포트 모듈 spec 타입 게이트 도입 + 기존 오류 4건 정리

nest build 는 tsconfig.build.json 이 **/*spec.ts 를 제외해 spec 의 타입
오류를 보지 못한다. 레포 전역 tsc 는 2,058줄 debt 라 게이트가 될 수 없으므로
스코프 tsconfig 로 이 모듈만 먼저 가둔다. 스코프는 include 배열로 넓힌다."
```

---

### Task 2: 죽은 `NormalizedVariantOverride.combination` 제거 (#8)

`combination` 은 어디서도 읽히지 않는다(`grep -rn '\.combination' apps/core/src/modules/catalog/operations/import` → spec 리터럴 외 0건). 3단계는 이 타입을 **jsonb 로 DB 에 영속화**하므로, 두면 죽은 필드가 행마다 저장된다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts:35-47`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts` (override 를 만드는 지점)
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts` (리터럴에서 제거)

**Interfaces:**
- Consumes: 없음
- Produces: `NormalizedVariantOverride` 에서 `combination` 필드 제거. 다른 필드는 그대로

- [ ] **Step 1: 타입에서 필드를 지운다**

`import.types.ts` 의 `NormalizedVariantOverride` 에서 아래 줄을 삭제한다.

```ts
  combination: Array<{ name: string; value: string }>;
```

- [ ] **Step 2: 타입 게이트로 사용처를 찾는다**

Run: `npm run type-check:scoped`
Expected: FAIL — `combination` 을 채우던 normalizer 와, 리터럴을 쓰던 spec 이 오류로 뜬다. **이 목록이 곧 수정 대상이다.**

- [ ] **Step 3: normalizer 에서 필드 채우기를 지운다**

`product-import.normalizer.ts` 의 `target.variantOverrides.push({ ... })` 에서 `combination: pairs,` 줄을 삭제한다. `pairs` 는 바로 위 `comboKey(pairs)` 에서 계속 쓰이므로 변수 자체는 남는다.

- [ ] **Step 4: spec 리터럴에서 지운다**

Step 2 가 알려준 spec 위치에서 `combination: [...]` 항목을 삭제한다. `product-import.validator.spec.ts` 의 variant override 리터럴 2곳이 해당한다.

- [ ] **Step 5: 게이트 + 테스트 통과 확인**

Run: `npm run type-check:scoped && npx jest --testPathPattern='operations/import' --silent`
Expected: 둘 다 PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "refactor(core): 대량등록 NormalizedVariantOverride.combination 죽은 필드 제거

3단계가 이 타입을 jsonb 로 영속화하므로 두면 행마다 DB 에 박힌다."
```

---

### Task 3: `variantCode` 유일성을 파이프라인으로 옮기고 DB 전역 검사를 더한다 (#2)

지금 검사는 `ProductImportManager.commit()` 이 들고 도는 인메모리 `seenVariantCodes` 맵이다. 두 가지가 문제다.

1. **파일 안만 본다.** 기존 카탈로그의 상품과 코드가 겹쳐도 통과하고, `publishVersion._validateVariantCodeUniqueness` 는 *한 버전(=한 상품) 안*만 비교하므로 게시 시점에도 안 걸린다.
2. **슬라이스 처리와 양립하지 않는다.** Task 6 이 commit 을 슬라이스로 쪼개면 인메모리 맵은 틱을 넘어 살아남지 못한다. 즉 이 이동은 선택이 아니라 **3단계의 선행조건**이다.

검사를 `ProductImportService.pipeline()` 으로 옮기면 `/validate` 프리뷰에서도 충돌이 보인다 — commit 을 눌러야 알던 것을 업로드 즉시 안다.

> **DB 검사의 스코프는 "active 버전에 매달린 variant" 다.** `catalog.schema.ts:477-482` 가 밝히듯 같은 master 의 active variant 와 draft variant 는 **의도적으로 코드를 공유**한다. 모든 `product_variants` 행을 보면 남의 미게시 draft 에 오탐이 난다. `publishVersion` 이 강제하는 규칙과 같은 스코프로 맞춘다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-variant-code.checker.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-variant-code.checker.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts:28-32`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts:56-195`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.module.ts`
- Test: 위 신규 spec + `product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord.variantOverrides[].variantCode`, `ProductRecord.errors`
- Produces:
  - `ProductImportSessionReader.findActiveVariantCodes(codes: string[], tx?: DbTransaction): Promise<Set<string>>`
  - `ProductImportVariantCodeChecker.check(records: ProductRecord[], tx?: DbTransaction): Promise<void>` — 충돌을 `record.errors` 에 `sheet: 'Variants'` 로 밀어 넣는다. 반환값 없음(레코드를 제자리에서 수정)
  - `ProductImportManager.applyVariantCodes` 는 `seenVariantCodes` 인자와 반환값을 잃고 `Promise<void>` 가 된다

- [ ] **Step 1: 실패하는 테스트 작성 (checker)**

`product-import-variant-code.checker.spec.ts` 를 만든다.

```ts
import { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';
import { ProductRecord, NormalizedVariantOverride } from '../dto/import.types';

function override(over: Partial<NormalizedVariantOverride>): NormalizedVariantOverride {
  return { rowNumber: 1, comboKey: '색상=빨강', basePriceRaw: '', membershipPriceRaw: '', ...over };
}

function record(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: {},
    version: {},
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
    ...over,
  };
}

function makeChecker(existing: string[] = []) {
  const reader = { findActiveVariantCodes: jest.fn(async () => new Set(existing)) } as any;
  return { checker: new ProductImportVariantCodeChecker(reader), reader };
}

describe('ProductImportVariantCodeChecker', () => {
  it('같은 코드를 두 행이 요청하면 양쪽 다 오류다', async () => {
    const { checker } = makeChecker();
    const a = record({ rowNumber: 1, productKey: 'P1', variantOverrides: [override({ rowNumber: 1, variantCode: 'SKU-1' })] });
    const b = record({ rowNumber: 2, productKey: 'P2', variantOverrides: [override({ rowNumber: 2, variantCode: 'SKU-1' })] });

    await checker.check([a, b]);

    expect(a.errors.filter((e) => /SKU-1/.test(e.message))).toHaveLength(1);
    expect(b.errors.filter((e) => /SKU-1/.test(e.message))).toHaveLength(1);
    expect(a.errors[0].sheet).toBe('Variants');
  });

  it('같은 상품 안의 중복도 잡는다', async () => {
    const { checker } = makeChecker();
    const a = record({
      variantOverrides: [
        override({ rowNumber: 1, comboKey: '색상=빨강', variantCode: 'SKU-1' }),
        override({ rowNumber: 2, comboKey: '색상=파랑', variantCode: 'SKU-1' }),
      ],
    });

    await checker.check([a]);

    expect(a.errors).toHaveLength(2);
  });

  it('이미 active 상품이 쓰는 코드는 오류다', async () => {
    const { checker, reader } = makeChecker(['SKU-EXISTING']);
    const a = record({ variantOverrides: [override({ variantCode: 'SKU-EXISTING' })] });

    await checker.check([a]);

    expect(reader.findActiveVariantCodes).toHaveBeenCalledWith(['SKU-EXISTING'], undefined);
    expect(a.errors.some((e) => /이미 사용 중/.test(e.message))).toBe(true);
  });

  it('코드가 하나도 없으면 DB 를 조회하지 않는다', async () => {
    const { checker, reader } = makeChecker();

    await checker.check([record()]);

    expect(reader.findActiveVariantCodes).not.toHaveBeenCalled();
  });

  it('충돌이 없으면 오류를 남기지 않는다', async () => {
    const { checker } = makeChecker(['OTHER']);
    const a = record({ variantOverrides: [override({ variantCode: 'SKU-1' })] });

    await checker.check([a]);

    expect(a.errors).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import-variant-code.checker.spec' --silent`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: reader 에 DB 조회 추가**

`product-import-session.reader.ts` 의 import 에 `inArray` 와 `productVariants` 를 더한 뒤 메서드를 추가한다.

```ts
  /**
   * 주어진 코드 중 **현재 active 버전에 매달린** variant 가 이미 쓰고 있는 것들.
   *
   * 스코프가 active 인 이유: 같은 master 의 active variant 와 draft variant 는
   * 같은 물리 상품을 가리키므로 의도적으로 코드를 공유한다(catalog.schema.ts:477-482,
   * ADR-0004). 모든 product_variants 를 보면 남의 미게시 draft 에 오탐이 난다.
   * publishVersion._validateVariantCodeUniqueness 가 강제하는 규칙과 같은 스코프다.
   */
  async findActiveVariantCodes(codes: string[], tx?: DbTransaction): Promise<Set<string>> {
    if (codes.length === 0) return new Set();
    return this.db.run(async (trx) => {
      const found = new Set<string>();
      // postgres 파라미터 상한(65534)에 걸리지 않도록 나눠 조회한다.
      for (let i = 0; i < codes.length; i += 1000) {
        const chunk = codes.slice(i, i + 1000);
        const rows = await trx
          .selectDistinct({ variantCode: productVariants.variantCode })
          .from(productVariants)
          .innerJoin(productMasterVariants, eq(productMasterVariants.variantId, productVariants.id))
          .innerJoin(productMasterVersions, eq(productMasterVersions.id, productMasterVariants.versionId))
          .where(and(inArray(productVariants.variantCode, chunk), eq(productMasterVersions.status, 'active')));
        for (const row of rows) {
          if (row.variantCode !== null) found.add(row.variantCode);
        }
      }
      return found;
    }, tx);
  }
```

- [ ] **Step 4: checker 구현**

`product-import-variant-code.checker.ts` 를 만든다.

```ts
import { Injectable } from '@nestjs/common';
import { ProductRecord } from '../dto/import.types';
import { DbTransaction } from '../../../catalog.types';
import { ProductImportSessionReader } from './product-import-session.reader';

/**
 * variantCode 충돌을 파이프라인 단계에서 잡는다 — 파일 안 중복과 DB 전역 중복 양쪽.
 *
 * 이 검사가 manager.commit() 의 인메모리 맵이 아니라 여기 있는 이유가 둘이다.
 * (1) 커밋이 슬라이스로 쪼개지면(3단계) 인메모리 맵은 틱을 넘어 살아남지 못한다.
 * (2) 여기 있으면 /validate 프리뷰에서도 충돌이 보인다 — 커밋을 눌러야 알던 것을
 *     업로드 즉시 안다.
 *
 * ⚠️ 남는 경합: 접수 시점 검사와 실제 write(워커) 사이에 다른 파일이 같은 코드를
 * 선점할 수 있다. Task 6 이 슬라이스마다 같은 검사를 한 번 더 돌려 창을 좁히지만
 * 완전히 닫지는 못한다. DB 유니크 제약으로 닫으려면 "active 버전에 매달린 variant
 * 끼리만 unique" 를 표현해야 하는데 정션 join 이 필요해 partial index 로 불가능하다
 * (ADR-0004).
 */
@Injectable()
export class ProductImportVariantCodeChecker {
  constructor(private readonly reader: ProductImportSessionReader) {}

  async check(records: ProductRecord[], tx?: DbTransaction): Promise<void> {
    const claims = new Map<string, Array<{ record: ProductRecord; rowNumber: number }>>();

    for (const record of records) {
      for (const override of record.variantOverrides) {
        const code = override.variantCode;
        if (!code) continue;
        const bucket = claims.get(code) ?? [];
        bucket.push({ record, rowNumber: override.rowNumber });
        claims.set(code, bucket);
      }
    }

    if (claims.size === 0) return;

    // 파일 안 중복 — 어느 쪽이 맞는지 알 수 없으므로 양쪽 다 오류로 남긴다.
    for (const [code, bucket] of claims) {
      if (bucket.length < 2) continue;
      const rows = bucket.map((b) => `${b.rowNumber}행`).join(', ');
      for (const { record, rowNumber } of bucket) {
        record.errors.push({
          sheet: 'Variants',
          rowNumber,
          message: `variantCode 가 파일 안에서 중복됩니다: ${code} (${rows})`,
        });
      }
    }

    const existing = await this.reader.findActiveVariantCodes([...claims.keys()], tx);
    for (const code of existing) {
      for (const { record, rowNumber } of claims.get(code) ?? []) {
        record.errors.push({
          sheet: 'Variants',
          rowNumber,
          message: `variantCode 를 이미 사용 중인 상품이 있습니다: ${code}`,
        });
      }
    }
  }
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='product-import-variant-code.checker.spec' --silent`
Expected: PASS 5건

- [ ] **Step 6: 파이프라인에 배선**

`product-import.module.ts` 의 `providers` 에 `ProductImportVariantCodeChecker` 를 추가하고 import 한다.

`product-import.service.ts` 의 생성자에 `private readonly variantCodeChecker: ProductImportVariantCodeChecker,` 를 추가하고 `pipeline` 을 고친다.

```ts
  private async pipeline(buffer: Buffer): Promise<ProductRecord[]> {
    const parsed = await this.parser.parse(buffer);
    const categories = await this.reader.loadCategoryTree();
    const records = this.validator.validate(this.normalizer.normalize(parsed, categories));
    // variantCode 충돌은 레코드 하나만 봐서는 알 수 없다(파일 전체 + DB 전역).
    // validate 뒤에 두어 프리뷰와 커밋이 같은 판정을 보게 한다.
    await this.variantCodeChecker.check(records);
    return records;
  }
```

- [ ] **Step 7: manager 에서 인메모리 맵 제거**

`product-import.manager.ts` 를 고친다.

`commit()` 에서 `seenVariantCodes` 선언(59-63행 주석 포함), `claimedVariantCodes` 변수, `for (const { code, rowNumber } of claimedVariantCodes) …` 줄을 지운다. 호출부는 이렇게 남는다.

```ts
          await this.applyVariantCodes(record, comboMap, trx);
```

`applyVariantCodes` 를 아래로 교체한다. 중복 판정은 전부 checker 로 갔으므로 남는 일은 write 뿐이다.

```ts
  /**
   * 조합별 variantCode 를 write 한다. variantCode 는 채널·WMS 매칭의 다리라
   * 여기서 심어두면 대량 등록 후 별도 SKU 매칭 작업의 규모가 줄어든다.
   *
   * 중복 판정은 여기 없다 — ProductImportVariantCodeChecker 가 파이프라인 단계에서
   * 파일 전체 + DB 전역을 본다. 레코드 하나만 보는 이 자리에서는 알 수 없는 것이고,
   * 커밋이 슬라이스로 쪼개지면 인메모리 누적도 성립하지 않는다.
   */
  private async applyVariantCodes(
    record: ProductRecord,
    comboMap: Map<string, string>,
    tx: DbTransaction,
  ): Promise<void> {
    for (const override of record.variantOverrides) {
      if (!override.variantCode) continue;
      const variantId = comboMap.get(override.comboKey);
      if (!variantId) {
        throw new BadRequestError(
          `조합에 해당하는 variant 를 찾을 수 없습니다: ${override.comboKey} (${record.productKey})`,
        );
      }
      await tx
        .update(productVariants)
        .set({ variantCode: override.variantCode, updatedAt: new Date() })
        .where(eq(productVariants.id, variantId));
    }
  }
```

`NormalizedVariantOverride` import 가 더 이상 안 쓰이면 지운다.

- [ ] **Step 8: manager spec 에서 사라진 동작의 테스트를 checker 쪽으로 옮긴다**

`product-import.manager.spec.ts` 에서 "파일 안 variantCode 중복" 을 단정하던 케이스를 찾는다(`/중복/` 로 검색). 그 동작은 이제 checker 의 책임이므로 **manager spec 에서 삭제**한다 — Step 1 이 같은 요구사항을 checker spec 에서 이미 덮었다. 삭제하는 대신 남겨두면 manager 가 더는 하지 않는 일을 요구하는 red 테스트가 된다.

- [ ] **Step 9: 전체 테스트 + 게이트**

Run: `npx jest --testPathPattern='operations/import' --silent && npm run type-check:scoped && npx nest build core`
Expected: 전부 PASS / exit 0

- [ ] **Step 10: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "fix(core): 대량등록 variantCode 유일성 검사를 파이프라인으로 이동 + DB 전역 검사 추가

기존 검사는 commit() 의 인메모리 맵이라 (1) 파일 안만 보고 기존 카탈로그와의
충돌을 놓쳤고 (2) 커밋이 슬라이스로 쪼개지면 틱을 넘어 살아남지 못한다.
스코프는 active 버전에 매달린 variant — 같은 master 의 draft 는 코드를
의도적으로 공유하므로(ADR-0004) 전수 검사는 오탐이 난다."
```

---

### Task 4: 스키마 + 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts:978-1019`
- Create: `apps/core/drizzle/<timestamp>_product-import-async-jobs.sql` (생성물)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `productImportJobStatusEnum` (`idle`|`queued`|`running`|`completed`|`failed`)
  - `productImportItemPublishStatusEnum` (`pending`|`published`|`failed`|`skipped`)
  - `productImportItemStatusEnum` 에 `pending` 추가
  - `productImportSessions`: `commitStatus`, `publishStatus`, `leaseUntil`, `commitError`, `publishError`, `publishedCount`, `publishFailedCount`
  - `productImportItems`: `payload`, `publishStatus`, `publishError`, `publishedAt`

- [ ] **Step 1: enum 정의**

`catalog.schema.ts:978-979` 를 아래로 교체한다.

```ts
export const productImportSessionStatusEnum = pgEnum('product_import_session_status', ['completed', 'archived']);
// 'pending' 은 **맨 뒤**에 붙인다. drizzle-kit 이 중간 삽입을 만나면
// `ALTER TYPE ... ADD VALUE 'x' BEFORE 'y'` 를 만드는데, 뒤에 붙이면 단순 ADD VALUE 로
// 끝난다. enum 순서는 이 컬럼으로 ORDER BY 를 하지 않는 한 의미가 없다.
export const productImportItemStatusEnum = pgEnum('product_import_item_status', ['created', 'failed', 'pending']);

/** 세션 단위 잡(commit·publish)의 라이프사이클. 세션의 `status` 는 아카이브 플래그로 별개다. */
export const productImportJobStatusEnum = pgEnum('product_import_job_status', [
  'idle',
  'queued',
  'running',
  'completed',
  'failed',
]);

/** 행 단위 게시 상태. 'skipped' 는 생성 자체가 실패해 게시 대상이 아닌 행. */
export const productImportItemPublishStatusEnum = pgEnum('product_import_item_publish_status', [
  'pending',
  'published',
  'failed',
  'skipped',
]);
```

- [ ] **Step 2: 세션 테이블 컬럼 추가**

`productImportSessions` 의 `committedAt` 아래에 추가한다.

```ts
    committedAt: timestamp('committed_at'),

    // ─── 비동기 잡 (3단계) ───
    // status 는 아카이브 플래그다. 잡 라이프사이클은 아래 두 컬럼이 들고 있다.
    //
    // ⚠️ commit_status 의 DEFAULT 가 'completed' 인 것은 의도적이다. ADD COLUMN 은 기존
    // 행에 DEFAULT 를 채우는데, 'queued' 로 두면 **v1 시절의 완료된 세션이 전부 큐에
    // 들어간다** — 워커가 그것들을 하나씩 클레임해 "pending 행 0" 을 확인하고 완료
    // 처리하면서 committed_at 을 오늘로 덮어써 이력을 망가뜨린다. 기존 세션은 동기
    // 경로로 이미 끝났으므로 'completed' 가 사실에 맞다. 새 세션은 acceptCommit 이
    // 'queued' 를 명시로 넣으므로 DEFAULT 에 의존하지 않는다.
    commitStatus: productImportJobStatusEnum('commit_status').notNull().default('completed'),
    publishStatus: productImportJobStatusEnum('publish_status').notNull().default('idle'),
    /** 워커 클레임 lease 만료시각. NULL 이거나 과거면 다른 틱이 집어갈 수 있다. */
    leaseUntil: timestamp('lease_until'),
    /**
     * lease 소유권 토큰(fencing token). 클레임한 워커가 발급하고, 갱신·해제는 이 값으로
     * CAS 한다.
     *
     * 소유권을 lease_until 타임스탬프로 확인하려던 앞선 설계는 세 번 연속 실패했다:
     * (1) `lease_until > NOW()` 는 후임 워커가 방금 민 lease 도 통과시켜 아무 것도 막지 못했고
     * (2) 타임스탬프 등호 CAS 는 DB 가 만든 마이크로초를 JS Date 밀리초로 되읽어 영구 불일치했고
     * (3) 그 값을 raw sql 에 Date 로 바인딩하니 드라이버가 직렬화하지 못해 매 호출 throw 했다.
     * 토큰은 정밀도·타임존·드라이버 직렬화·앱 클럭 스큐 어디에도 의존하지 않는다.
     */
    leaseToken: uuid('lease_token'),
    commitError: text('commit_error'),
    publishError: text('publish_error'),
    publishedCount: integer('published_count').notNull().default(0),
    publishFailedCount: integer('publish_failed_count').notNull().default(0),
```

인덱스 배열에 추가한다. **한 개짜리 복합 인덱스가 아니라 두 개**여야 한다 — 워커의 두 클레임 쿼리는 각각 `commit_status` 만, `publish_status` 만 필터하므로 `(commit_status, publish_status, lease_until)` 하나로 묶으면 publish 측이 leftmost-prefix 에 걸려 인덱스를 못 탄다.

```ts
    index('idx_import_sessions_commit_claim').on(table.commitStatus, table.leaseUntil),
    index('idx_import_sessions_publish_claim').on(table.publishStatus, table.leaseUntil),
```

- [ ] **Step 3: 아이템 테이블 컬럼 추가**

`productImportItems` 의 `createdAt` 위에 추가한다.

```ts
    /**
     * 접수 시점에 확정된 ProductRecord. 워커가 이걸 읽어 상품을 만든다.
     * 파일을 저장하지 않는 이유는 스펙 §4.3.1 — 재개가 "행 오프셋 커서"가 되지 않게 한다.
     * 검증 실패로 접수 즉시 failed 가 된 행은 NULL 이다.
     */
    payload: jsonb('payload'),
    publishStatus: productImportItemPublishStatusEnum('publish_status').notNull().default('pending'),
    publishError: text('publish_error'),
    publishedAt: timestamp('published_at'),
```

인덱스 배열에 추가한다.

```ts
    index('idx_import_items_session_status').on(table.sessionId, table.status),
```

> **재생성 주의 (round 4 에서 추가됨):** `lease_token` 은 Task 4 를 이미 커밋한 뒤에 추가된 컬럼이다.
> Task 4 의 마이그레이션은 **아직 어느 DB 에도 적용되지 않았으므로**, 새 마이그레이션을 하나 더
> 쌓지 말고 기존 것을 지우고 재생성해 한 파일로 유지한다 (`git rm` 한 뒤 `_journal.json` 을
> 되돌리고 재생성 — Task 4 의 fix round 이 이미 한 번 성공한 절차다).

- [ ] **Step 4: 마이그레이션 생성**

Run: `npm run db:generate:core -- --name product-import-async-jobs`
Expected: `apps/core/drizzle/<timestamp>_product-import-async-jobs.sql` 생성

- [ ] **Step 5: 생성된 SQL 을 눈으로 검사한다 — 게이트**

생성 파일을 열어 **세 가지**를 확인한다.

1. `ALTER TYPE "public"."product_import_item_status" ADD VALUE 'pending';` 이 있고, `BEFORE`/`AFTER` 절이 없다.
2. 그 새 값 `'pending'` 이 **같은 파일의 다른 statement 에서 쓰이지 않는다.** `items.status` 는 지금도 DEFAULT 가 없으므로 `DEFAULT 'pending'` 이 나오면 안 된다 — 나오면 PG 가 `unsafe use of new value of enum type` 로 거부한다. (레포 선례 `20260727141456` 은 `::text` 캐스트로 우회했다.)
3. `DROP` 이 하나도 없다. 이 마이그레이션은 전부 additive 여야 한다.
4. `commit_status` 의 DEFAULT 가 `'completed'` 다. `'queued'` 로 나오면 기존 세션이 전부 워커 큐에 들어가 `committed_at` 이 덮어써진다 — schema.ts 의 주석 참조.

셋 중 하나라도 어긋나면 `git rm` 으로 마이그레이션을 지우고 `schema.ts` 를 고친 뒤 재생성한다 — **이미 생성된 SQL 을 손으로 고치지 않는다**(루트 CLAUDE.md).

- [ ] **Step 6: 타입 게이트**

Run: `npx nest build core`
Expected: exit 0

- [ ] **Step 7: 커밋 — schema.ts + SQL + meta 를 한 커밋에**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle
git commit -m "feat(core): 대량등록 세션·아이템에 비동기 잡 컬럼 추가

commit_status/publish_status/lease_until 로 잡 라이프사이클을, items.payload
와 publish_status 로 행 단위 진행 원장을 만든다. 기존 sessions.status 는
아카이브 플래그로 그대로 둔다(의미 전용은 ADR-0005 §5 상 PR 3개짜리).
additive 이므로 expand phase — migrate 를 deploy 보다 먼저 돌린다."
```

> 마이그레이션 적용(`npm run db:setup -- --stage dev --deployment lcnine-services`)은 로컬 DB 를 쓰는 사람이 직접 돌린다. 이 계획의 단위테스트는 DB 를 목하므로 적용 없이도 진행할 수 있다.

---

### Task 5: `commit` 을 접수(202)로 바꾼다

이 태스크가 끝난 시점의 시스템은 **일부러 미완성**이다 — 행이 `pending` 으로 쌓이지만 처리하는 주체가 아직 없다(Task 6 이 만든다). 단위테스트는 완결되며, 런타임 완결은 Task 6 에서 온다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts:45-74`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts:45-141`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts:51-54`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.controller.ts:46-57`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord[]` (파이프라인 결과)
- Produces:
  - `CommitAcceptedDto { sessionId: string; status: 'queued'; totalRows: number; queuedCount: number; invalidCount: number }`
  - `ProductImportManager.acceptCommit(input: { fileName: string; userId: string; records: ProductRecord[] }): Promise<CommitAcceptedDto>`
  - 기존 `ProductImportManager.commit()` 은 **삭제**된다 (동기 생성 루프는 Task 6 의 워커로 옮겨간다)

- [ ] **Step 1: 실패하는 테스트 작성**

`product-import.manager.spec.ts` 의 `makeHarness` 는 `trx.insert(table).values(v)` 를 `inserted` 에 모은다. 세션과 아이템을 가르려면 테이블 식별이 필요하므로 하네스를 먼저 손본다 — `insert` 가 실제 테이블 객체를 받도록 바꾼다.

```ts
import { productImportSessions, productImportItems, productVariants } from '../../../schema/catalog.schema';

// makeHarness 안의 trx.insert 를 아래로 교체한다.
    insert: (table: any) => ({
      values: (v: any) => {
        if (table === productImportSessions) sessions.push(v);
        else if (table === productImportItems) inserted.push(...(Array.isArray(v) ? v : [v]));
        return { returning: () => Promise.resolve([{ ...v, id: 'sess-1' }]) };
      },
    }),
```

그 뒤 테스트를 추가한다.

```ts
describe('acceptCommit', () => {
  it('세션을 queued 로 만들고 유효한 행을 payload 와 함께 pending 으로 적는다', async () => {
    const { manager, sessions, inserted } = makeHarness();

    const result = await manager.acceptCommit({
      fileName: 'f.xlsx',
      userId: 'u1',
      records: [validRecord({ rowNumber: 1, productKey: 'P1' }), validRecord({ rowNumber: 2, productKey: 'P2' })],
    });

    expect(sessions[0]).toMatchObject({ commitStatus: 'queued', publishStatus: 'idle', totalRows: 2, failedCount: 0 });
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ rowNumber: 1, productKey: 'P1', status: 'pending' });
    expect(inserted[0].payload).toMatchObject({ productKey: 'P1' });
    expect(result).toEqual({
      sessionId: 'sess-1',
      status: 'queued',
      totalRows: 2,
      queuedCount: 2,
      invalidCount: 0,
    });
  });

  it('검증 실패 행은 접수 즉시 failed + skipped 로 확정한다 — payload 없이', async () => {
    const { manager, sessions, inserted } = makeHarness();
    const bad = validRecord({
      rowNumber: 1,
      productKey: 'P1',
      errors: [{ sheet: 'Products', rowNumber: 1, message: 'basePrice 는 0보다 커야 합니다' }],
    });

    const result = await manager.acceptCommit({ fileName: 'f.xlsx', userId: 'u1', records: [bad] });

    expect(inserted[0]).toMatchObject({ status: 'failed', publishStatus: 'skipped' });
    expect(inserted[0].payload).toBeUndefined();
    expect(inserted[0].errorMessage).toContain('basePrice');
    expect(sessions[0]).toMatchObject({ failedCount: 1 });
    expect(result).toMatchObject({ queuedCount: 0, invalidCount: 1 });
  });

  it('상품을 만들지 않는다 — 그건 워커의 몫이다', async () => {
    const { manager, productMastersService } = makeHarness();

    await manager.acceptCommit({ fileName: 'f.xlsx', userId: 'u1', records: [validRecord()] });

    expect(productMastersService.createMaster).not.toHaveBeenCalled();
  });
});
```

`makeHarness` 가 `sessions`/`inserted`/`productMastersService` 를 반환하지 않으면 반환 객체에 추가한다.

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.manager.spec' --silent`
Expected: FAIL — `acceptCommit` 없음

- [ ] **Step 3: DTO 교체**

`import-response.dto.ts` 의 `CommitResultDto` 를 지우고(`CommitItemDto` 는 세션 상세가 계속 쓰므로 남긴다) 아래를 넣는다.

```ts
export class CommitAcceptedDto {
  @ApiProperty({ description: '생성된 임포트 세션 id. 진행 상황은 GET /product-imports/:id 로 폴링한다.' })
  sessionId: string;

  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty()
  totalRows: number;

  @ApiProperty({ description: '워커가 처리할 유효 행 수' })
  queuedCount: number;

  @ApiProperty({ description: '검증에서 이미 떨어진 행 수 — 접수 시점의 확정값' })
  invalidCount: number;
}
```

`CommitItemDto.status` 의 enum 에 `pending` 을 더한다.

```ts
  @ApiProperty({ enum: ['pending', 'created', 'failed'] })
  status: 'pending' | 'created' | 'failed';
```

- [ ] **Step 4: `commit()` 을 `acceptCommit()` 으로 교체**

`product-import.manager.ts` 의 `commit()` 전체(45-122행)와 `recordItem()`(124-141행)을 지우고 아래를 넣는다. `CommitItem`/`CommitResult` 인터페이스도 지운다 — 쓰는 곳이 사라진다.

```ts
  /**
   * 접수만 한다. 검증은 이미 끝났고(파이프라인), 여기서는 세션과 행을 적을 뿐이다.
   * 상품 생성은 ProductImportJobWorker 가 슬라이스 단위로 이어받는다.
   */
  async acceptCommit(input: {
    fileName: string;
    userId: string;
    records: ProductRecord[];
  }): Promise<CommitAcceptedDto> {
    const { fileName, userId, records } = input;
    const invalidCount = records.filter((r) => r.errors.length > 0).length;

    return this.db.run(async (trx) => {
      const [session] = await trx
        .insert(productImportSessions)
        .values({
          fileName,
          uploadedBy: userId,
          totalRows: records.length,
          failedCount: invalidCount,
          // status 는 아카이브 플래그다. 잡 상태는 commitStatus/publishStatus 가 든다.
          status: 'completed',
          commitStatus: 'queued',
          publishStatus: 'idle',
        })
        .returning();

      const rows = records.map((record) =>
        record.errors.length > 0
          ? {
              sessionId: session.id,
              rowNumber: record.rowNumber,
              productKey: record.productKey,
              status: 'failed' as const,
              // 생성이 없으니 게시 대상도 아니다 — pending 으로 두면 영영 안 끝난 것처럼 보인다.
              publishStatus: 'skipped' as const,
              errorMessage: record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; '),
            }
          : {
              sessionId: session.id,
              rowNumber: record.rowNumber,
              productKey: record.productKey,
              status: 'pending' as const,
              payload: record,
            },
      );

      // payload 가 행마다 붙으므로 한 statement 에 다 넣지 않는다(파라미터 상한·문 크기).
      for (let i = 0; i < rows.length; i += 200) {
        await trx.insert(productImportItems).values(rows.slice(i, i + 200));
      }

      return {
        sessionId: session.id,
        status: 'queued' as const,
        totalRows: records.length,
        queuedCount: records.length - invalidCount,
        invalidCount,
      };
    });
  }
```

`CommitAcceptedDto` 를 import 한다.

- [ ] **Step 5: service·controller 배선**

`product-import.service.ts`:

```ts
  async commit(buffer: Buffer, fileName: string, userId: string): Promise<CommitAcceptedDto> {
    const records = await this.pipeline(buffer);
    return this.manager.acceptCommit({ fileName, userId, records });
  }
```

`product-import.controller.ts` — `HttpCode` 를 import 하고 commit 핸들러를 고친다.

```ts
  @Post('commit')
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '워크북 커밋 접수(세션 생성 + 행 적재). 상품 생성은 워커가 이어받는다.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiResponse({ status: 202, type: CommitAcceptedDto })
  async commit(
    @UploadedFile() file: Express.Multer.File,
    @User() user: { userId: string },
  ): Promise<CommitAcceptedDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.commit(file.buffer, file.originalname, user.userId);
  }
```

`dto/index.ts` 의 export 에서 `CommitResultDto` 를 `CommitAcceptedDto` 로 바꾼다.

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='operations/import' --silent`
Expected: PASS. `product-import.service.spec.ts` 가 `manager.commit` 을 목하고 있으면 `acceptCommit` 으로 바꾼다.

- [ ] **Step 7: 게이트**

Run: `npm run type-check:scoped && npx nest build core`
Expected: 둘 다 exit 0

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 commit 을 202 접수로 전환 — 행을 pending 으로 적재

검증은 동기로 끝내고(오류를 업로드 즉시 보여주기 위해) 상품 생성만 워커로 넘긴다.
이 커밋 시점에는 처리 주체가 아직 없다 — 다음 커밋의 워커가 이어받는다."
```

---

### Task 6: 잡 워커 + commit 슬라이스 (#4 포함)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.spec.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.ts`
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.spec.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.module.ts`
- Modify: `apps/core/src/config/env.validation.ts`

**Interfaces:**
- Consumes: `ProductImportManager` 의 상품 생성 경로, `ProductImportVariantCodeChecker.check`
- Produces:
  - `ProductImportManager.createFromRecord(record: ProductRecord, userId: string, tx: DbTransaction): Promise<string>` — masterId 반환. `commit()` 안에 있던 per-row 로직 그대로
  - `ProductImportJobManager.claimCommit(): Promise<string | null>` — 클레임한 sessionId
  - `ProductImportJobManager.runCommitSlice(sessionId: string): Promise<void>`
  - `ProductImportJobWorker` — `@Cron(EVERY_5_SECONDS)`
  - env: `PRODUCT_IMPORT_WORKER_ENABLED`(기본 `true`), `PRODUCT_IMPORT_COMMIT_SLICE`(기본 20), `PRODUCT_IMPORT_LEASE_MS`(기본 60000)

- [ ] **Step 1: env 스키마에 노브를 먼저 선언한다**

`apps/core/src/config/env.validation.ts` 의 `almondyoungEnvSchema` 안, OpenTelemetry 블록 위에 추가한다. **이 선언을 빠뜨리면 zod 가 키를 버려 `configService.get()` 이 영영 `undefined` 를 준다** (Global Constraints 참조).

```ts
    // 대량등록 비동기 잡 워커 (3단계)
    PRODUCT_IMPORT_WORKER_ENABLED: z.enum(['true', 'false']).optional(),
    PRODUCT_IMPORT_COMMIT_SLICE: z.string().regex(/^\d+$/).optional(),
    PRODUCT_IMPORT_PUBLISH_SLICE: z.string().regex(/^\d+$/).optional(),
    PRODUCT_IMPORT_LEASE_MS: z.string().regex(/^\d+$/).optional(),
```

`PRODUCT_IMPORT_PUBLISH_SLICE` 는 Task 7 이 쓴다 — env 파일을 두 번 건드리지 않도록 여기서 함께 선언한다.

- [ ] **Step 2: 실패하는 테스트 작성 (job manager)**

`product-import-job.manager.spec.ts` 를 만든다.

```ts
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { PgDialect } from 'drizzle-orm/pg-core';
import { ProductImportJobManager } from './product-import-job.manager';
import { productImportSessions, productImportItems } from '../../../schema/catalog.schema';

/**
 * drizzle sql 조각을 실제 SQL 문자열로 렌더한다. 클레임의 원자성은 바인딩 값이 아니라
 * **쿼리 모양**에 있으므로(SKIP LOCKED, LIMIT 1, running 후보 포함) 이렇게만 단정할 수 있다.
 * 2단계 supersede 테스트가 쓴 것과 같은 기법이다.
 */
function renderSql(query: unknown): string {
  return new PgDialect().sqlToQuery(query as never).sql;
}

/**
 * drizzle 셀렉트 빌더는 thenable 이면서 체이닝도 된다. 코드가 쓰는 세 형태를
 * (`await where(...)`, `where(...).limit(n)`, `where(...).orderBy(c).limit(n)`)
 * 하나로 받는다.
 */
function chain(rows: any[]): any {
  const builder: any = Promise.resolve(rows);
  builder.limit = () => Promise.resolve(rows);
  builder.orderBy = () => ({ limit: () => Promise.resolve(rows) });
  return builder;
}

function makeHarness(opts: { pendingItems?: any[]; claimed?: any[] } = {}) {
  const updates: any[] = [];
  const pending = opts.pendingItems ?? [];

  const trx = {
    execute: jest.fn(async () => opts.claimed ?? []),
    select: (_projection?: any) => ({
      from: (table: any) => ({
        where: () => chain(table === productImportItems ? pending : [{ id: 'sess-1', uploadedBy: 'u1' }]),
      }),
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: () => {
          updates.push({ table: table === productImportSessions ? 'sessions' : 'items', values });
          return Promise.resolve();
        },
      }),
    }),
  };
  const db = { run: (fn: any, t?: any) => (t ? fn(t) : fn(trx)), db: trx } as any;
  const importManager = { createFromRecord: jest.fn(async () => 'master-1') } as any;
  const variantCodeChecker = { check: jest.fn(async () => undefined) } as any;
  const config = { get: jest.fn(() => undefined) } as any;
  const manager = new ProductImportJobManager(db, importManager, variantCodeChecker, config);
  return { manager, updates, trx, importManager, variantCodeChecker };
}

const PENDING = (rowNumber: number) => ({
  id: `item-${rowNumber}`,
  rowNumber,
  productKey: `P${rowNumber}`,
  status: 'pending',
  payload: {
    rowNumber,
    productKey: `P${rowNumber}`,
    raw: {},
    version: {},
    basePrice: 1000,
    categoryIds: [],
    categoryNames: [],
    options: [],
    variantOverrides: [],
    errors: [],
  },
});

describe('ProductImportJobManager', () => {
  it('클레임은 SKIP LOCKED 로 한 세션만 잡고, lease 만료된 running 도 다시 잡는다', async () => {
    const { manager, trx } = makeHarness({ claimed: [{ id: 'sess-1' }] });

    const sessionId = await manager.claimCommit();

    expect(sessionId).toBe('sess-1');
    const sql = renderSql(trx.execute.mock.calls[0][0]).toLowerCase();
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('limit 1');
    // 재개 경로: running 을 후보에서 빼면 크래시한 세션이 영영 멈춘다.
    expect(sql).toContain("'running'");
    expect(sql).toContain('lease_until');
  });

  it('클레임할 세션이 없으면 null 이다', async () => {
    const { manager } = makeHarness({ claimed: [] });
    expect(await manager.claimCommit()).toBeNull();
  });

  it('pending 행을 처리하고 아이템을 created 로 바꾼다', async () => {
    const { manager, updates, importManager } = makeHarness({ pendingItems: [PENDING(1), PENDING(2)] });

    await manager.runCommitSlice('sess-1');

    expect(importManager.createFromRecord).toHaveBeenCalledTimes(2);
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ status: 'created', masterId: 'master-1' });
  });

  it('한 행이 터져도 나머지를 계속 처리하고 그 행만 failed 로 남긴다', async () => {
    const { manager, updates, importManager } = makeHarness({ pendingItems: [PENDING(1), PENDING(2)] });
    importManager.createFromRecord
      .mockRejectedValueOnce(new Error('productCode 중복'))
      .mockResolvedValueOnce('master-2');

    await manager.runCommitSlice('sess-1');

    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ status: 'failed', publishStatus: 'skipped' });
    expect(itemUpdates[0].values.errorMessage).toContain('productCode 중복');
    expect(itemUpdates[1].values).toMatchObject({ status: 'created' });
  });

  it('payload 형태가 어긋난 행은 그 행만 실패시킨다', async () => {
    const broken = { ...PENDING(1), payload: { productKey: 'P1' } };
    const { manager, updates, importManager } = makeHarness({ pendingItems: [broken] });

    await manager.runCommitSlice('sess-1');

    expect(importManager.createFromRecord).not.toHaveBeenCalled();
    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values.errorMessage).toMatch(/다시 올려/);
  });

  it('남은 pending 이 없으면 세션을 completed 로 마감한다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runCommitSlice('sess-1');

    const done = updates.find((u) => u.table === 'sessions' && u.values.commitStatus === 'completed');
    expect(done).toBeDefined();
    expect(done!.values.leaseUntil).toBeNull();
  });

  it('슬라이스를 마치면 lease 를 놓되 running 은 유지한다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [PENDING(1)] });

    await manager.runCommitSlice('sess-1');

    const release = updates.filter((u) => u.table === 'sessions').at(-1);
    expect(release!.values).toEqual({ leaseUntil: null });
  });

  it('슬라이스마다 variantCode 충돌을 다시 본다', async () => {
    const { manager, variantCodeChecker } = makeHarness({ pendingItems: [PENDING(1)] });

    await manager.runCommitSlice('sess-1');

    expect(variantCodeChecker.check).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import-job.manager.spec' --silent`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: `ProductImportManager` 에서 per-row 생성 로직을 꺼낸다**

`product-import.manager.ts` 에 public 메서드를 추가한다. Task 5 에서 지운 `commit()` 루프의 본문 그대로이되, **#4 가드**가 붙는다.

```ts
  /**
   * 레코드 하나로 draft 상품을 만든다. 호출자가 연 트랜잭션 안에서 돈다 —
   * 이 안에서 터지면 그 행의 변경 전부가 롤백된다.
   */
  async createFromRecord(record: ProductRecord, userId: string, tx: DbTransaction): Promise<string> {
    const version = await this.productMastersService.createMaster(userId, tx);
    const data: UpdateProductMasterVersion = {
      ...record.version,
      categoryIds: record.categoryIds,
      primaryCategoryId: record.primaryCategoryId,
      optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
    };
    await this.productMastersService.updateVersion(version.id, data, tx);

    // variant override 가 없으면 조합 → variantId 맵이 필요 없다. getVariantComboMap 은
    // variant 마다 4-join 조회를 돌리므로 Variants 시트를 안 쓴 파일(=v1 호환 경로)에서
    // 그 비용을 물지 않는다. 빈 맵은 applyVariantCodes 와 pricingBuilder 둘 다 안전하다 —
    // 양쪽 모두 variantOverrides 루프 안에서만 맵을 읽는다.
    const comboMap =
      record.variantOverrides.length > 0
        ? await this.reader.getVariantComboMap(version.masterId, version.id, tx)
        : new Map<string, string>();

    await this.applyVariantCodes(record, comboMap, tx);
    await this.pricingService.replaceVersionRules(version.id, this.pricingBuilder.build(record, comboMap), tx);

    return version.masterId;
  }
```

- [ ] **Step 5: `ProductImportJobManager` 구현**

`product-import-job.manager.ts` 를 만든다.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDb, DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { type PimSchema, productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { ProductRecord } from '../dto/import.types';
import { ProductImportManager } from './product-import.manager';
import { ProductImportVariantCodeChecker } from './product-import-variant-code.checker';

export const DEFAULT_COMMIT_SLICE = 20;
export const DEFAULT_LEASE_MS = 60_000;

/** 클레임 결과. leaseToken 이 이후 갱신·해제의 CAS 비교값이다. */
export interface ClaimedSession {
  sessionId: string;
  leaseToken: string;
}

/**
 * payload 는 접수 시점의 ProductRecord 다. 접수와 처리 사이에 배포가 끼면 워커가
 * 옛 형태를 읽을 수 있으므로, 창조 경로에 넘기기 전에 최소 형태를 확인한다.
 * 어긋나면 그 행만 실패시킨다 — 세션 전체를 막지 않는다.
 */
function isProductRecord(value: unknown): value is ProductRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rowNumber === 'number' &&
    typeof v.productKey === 'string' &&
    typeof v.version === 'object' &&
    v.version !== null &&
    Array.isArray(v.categoryIds) &&
    Array.isArray(v.options) &&
    Array.isArray(v.variantOverrides) &&
    // errors 는 가드 통과 직후 .length 로 읽으므로 반드시 여기서 확인해야 한다.
    // 빠뜨리면 이 필드가 없는 payload 가 가드를 통과한 뒤 TypeError 를 던지고,
    // 그 예외가 runCommitSlice 를 탈출해 세션이 영원히 같은 행에서 재시도한다.
    Array.isArray(v.errors) &&
    typeof v.basePrice === 'number'
  );
}

@Injectable()
export class ProductImportJobManager {
  private readonly logger = new Logger(ProductImportJobManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly importManager: ProductImportManager,
    private readonly variantCodeChecker: ProductImportVariantCodeChecker,
    private readonly config: ConfigService,
  ) {}

  private positiveInt(key: string, fallback: number): number {
    const raw = this.config.get<string>(key);
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  get commitSlice(): number {
    return this.positiveInt('PRODUCT_IMPORT_COMMIT_SLICE', DEFAULT_COMMIT_SLICE);
  }

  get leaseMs(): number {
    return this.positiveInt('PRODUCT_IMPORT_LEASE_MS', DEFAULT_LEASE_MS);
  }

  /**
   * commit 대기 세션 하나를 원자적으로 잡는다. lease 를 미래로 밀어 두므로
   * 롤링 배포로 태스크가 잠시 둘이어도 같은 세션을 겹쳐 처리하지 않는다.
   * running 을 다시 잡는 것은 재개 경로다 — lease 가 만료됐다는 건 처리하던
   * 프로세스가 죽었다는 뜻이고, 남은 pending 행부터 이어가면 된다.
   */
  async claimCommit(tx?: DbTransaction): Promise<ClaimedSession | null> {
    return this.claim('commit_status', tx);
  }

  private async claim(
    column: 'commit_status' | 'publish_status',
    tx?: DbTransaction,
  ): Promise<ClaimedSession | null> {
    // sql.raw 는 SQL 인젝션 경로지만 인자가 이 유니온 두 값뿐이라 외부 입력이 닿지 않는다.
    // 컬럼명은 바인딩할 수 없으므로 raw 외의 선택지가 없다.
    const statusColumn = sql.raw(column);
    // lease 소유권은 **토큰**으로 확인한다. 만료시각은 DB 시계가 만들게 두고(비교하지 않고
    // `lease_until < NOW()` 자격 판정에만 쓰므로 정밀도가 무관하다), 소유권은 uuid 등호로 본다.
    // 타임스탬프로 소유권을 보려던 앞선 세 번의 시도가 모두 정밀도·타임존·드라이버 직렬화에서
    // 깨졌다. 토큰은 문자열이라 raw sql 바인딩도 안전하다.
    const leaseToken = uuidv7();
    return this.db.run(async (trx) => {
      const rows = await trx.execute<{ id: string }>(sql`
        UPDATE product_import_sessions
           SET ${statusColumn} = 'running',
               lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid
         WHERE id = (
           SELECT id
             FROM product_import_sessions
            WHERE ${statusColumn} IN ('queued', 'running')
              AND (lease_until IS NULL OR lease_until < NOW())
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id
      `);
      // drizzle 의 execute 는 postgres-js RowList 를 돌려주며 제네릭이 배열 원소 타입까지
      // 좁혀주지 않는다. fulfillment-order-reservation-retry.worker.ts:111 과 같은 선례.
      const [row] = rows as unknown as Array<{ id: string }>;
      return row ? { sessionId: row.id, leaseToken } : null;
    }, tx);
  }

  /**
   * 클레임한 세션의 pending 행을 슬라이스만큼 처리한다.
   * 세션을 통째로 돌지 않는 이유는 스펙 §4.3.3 — 틱 길이를 유계로 두고,
   * 세션이 둘이면 교대로 진행시키고, 재개를 공짜로 만든다.
   */
  async runCommitSlice(claimed: ClaimedSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;
    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productImportItems)
        .where(and(eq(productImportItems.sessionId, sessionId), eq(productImportItems.status, 'pending')))
        .orderBy(productImportItems.rowNumber)
        .limit(this.commitSlice),
    );

    if (items.length === 0) {
      await this.db.run((trx) =>
        trx
          .update(productImportSessions)
          .set({ commitStatus: 'completed', leaseUntil: null, committedAt: new Date() })
          .where(eq(productImportSessions.id, sessionId)),
      );
      return;
    }

    const [session] = await this.db.run((trx) =>
      trx
        .select({ uploadedBy: productImportSessions.uploadedBy })
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1),
    );
    const userId = session?.uploadedBy ?? '';

    // 접수 시점 검사와 실제 write 사이에 다른 파일이 코드를 선점했을 수 있다.
    // 슬라이스마다 한 번 더 봐서 창을 좁힌다 (슬라이스당 쿼리 1회).
    const records = items.map((item) => item.payload).filter(isProductRecord);
    await this.variantCodeChecker.check(records);

    for (const item of items) {
      // 행마다 lease 를 갱신한다. 클레임 때 한 번만 밀어두면 슬라이스가 lease 보다
      // 오래 걸릴 때(행당 createMaster + variant 재생성 + 조합 4-join + 가격 replace 라
      // 20행이 60초를 넘기는 건 무리한 가정이 아니다) 다른 워커가 같은 세션을 잡아
      // **아직 pending 인 같은 행을 함께 처리한다** — 상품이 둘 생기고 createdCount 가
      // 두 번 오른다.
      //
      // 갱신은 CAS 다. 실패했다는 건 이미 lease 를 빼앗겼다는 뜻이므로 **즉시 멈춘다** —
      // 계속 진행하면 후임 워커와 같은 행을 나란히 처리하게 된다. 가드는 반드시 두
      // continue 경로보다 위에 있어야 한다(어느 경로든 시간을 쓴다).
      if (!(await this.renewLease(sessionId, leaseToken))) {
        this.logger.warn(`임포트 세션 lease 를 잃어 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }

      const record = item.payload;
      if (!isProductRecord(record)) {
        await this.failItem(item.id, sessionId, '행 데이터 형식이 달라 처리할 수 없습니다. 파일을 다시 올려주세요.');
        continue;
      }
      if (record.errors.length > 0) {
        await this.failItem(
          item.id,
          sessionId,
          record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; '),
        );
        continue;
      }

      try {
        await this.db.run(async (trx) => {
          const masterId = await this.importManager.createFromRecord(record, userId, trx);
          await trx
            .update(productImportItems)
            .set({ status: 'created', masterId })
            .where(eq(productImportItems.id, item.id));
          await trx
            .update(productImportSessions)
            .set({ createdCount: sql`${productImportSessions.createdCount} + 1` })
            .where(eq(productImportSessions.id, sessionId));
        });
      } catch (error) {
        this.logger.warn(`임포트 행 생성 실패 (session=${sessionId}, row=${item.rowNumber}): ${String(error)}`);
        await this.failItem(item.id, sessionId, error instanceof Error ? error.message : '알 수 없는 오류');
      }
    }

    // lease 만 놓는다. commit_status 는 running 그대로 두어 다음 틱이 이어받는다.
    await this.releaseLease(sessionId, leaseToken);
  }

  /**
   * lease 를 다시 민다 — **직전에 내가 쓴 값을 그대로 들고 있을 때만**(CAS).
   * 반환값이 null 이면 그 사이 lease 가 만료돼 다른 워커가 세션을 가져갔다는 뜻이고,
   * 호출자는 슬라이스를 즉시 중단해야 한다.
   *
   * `lease_until > NOW()` 같은 *생존* 검사로는 부족하다. 후임 워커가 방금 민 lease 도
   * 미래이므로 그 조건을 통과한다 — 즉 정말 막아야 할 경우(후임이 넘겨받은 상태)에
   * 그대로 통과해 버려 아무 것도 막지 못한다. 소유권은 "내가 쓴 정확한 값" 으로만
   * 확인할 수 있다.
   */
  private async renewLease(sessionId: string, token: string): Promise<boolean> {
    const rows = await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        // 만료시각은 DB 시계로 다시 민다 — 이 값은 비교 대상이 아니므로 정밀도가 무관하다.
        .set({ leaseUntil: sql`NOW() + ${this.leaseMs} * interval '1 millisecond'` })
        .where(and(eq(productImportSessions.id, sessionId), eq(productImportSessions.leaseToken, token)))
        .returning({ id: productImportSessions.id }),
    );
    return rows.length > 0;
  }

  /** lease 를 놓는다 — 내 토큰을 그대로 들고 있을 때만(CAS). */
  private async releaseLease(sessionId: string, token: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ leaseUntil: null, leaseToken: null })
        .where(and(eq(productImportSessions.id, sessionId), eq(productImportSessions.leaseToken, token))),
    );
  }

  private async failItem(itemId: string, sessionId: string, errorMessage: string): Promise<void> {
    await this.db.run(async (trx) => {
      await trx
        .update(productImportItems)
        // 생성이 실패했으면 게시 대상이 아니다 — pending 으로 두면 영영 안 끝난 것처럼 보인다.
        .set({ status: 'failed', publishStatus: 'skipped', errorMessage })
        .where(eq(productImportItems.id, itemId));
      await trx
        .update(productImportSessions)
        .set({ failedCount: sql`${productImportSessions.failedCount} + 1` })
        .where(eq(productImportSessions.id, sessionId));
    });
  }
}
```

- [ ] **Step 6: 테스트 실행 — 통과 확인**

Run: `npx jest --testPathPattern='product-import-job.manager.spec' --silent`
Expected: PASS 8건

- [ ] **Step 7: 워커 테스트 작성**

`product-import-job.worker.spec.ts` 를 만든다.

```ts
import { ProductImportJobWorker } from './product-import-job.worker';

function makeWorker(opts: { enabled?: string; claims?: Array<string | null> } = {}) {
  const claims = opts.claims ?? [null];
  let i = 0;
  const jobManager = {
    claimCommit: jest.fn(async () => claims[Math.min(i++, claims.length - 1)] ?? null),
    runCommitSlice: jest.fn(async () => undefined),
  } as any;
  const config = { get: jest.fn(() => opts.enabled) } as any;
  return { worker: new ProductImportJobWorker(jobManager, config), jobManager };
}

describe('ProductImportJobWorker', () => {
  it('클레임한 세션의 슬라이스를 돌린다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });

    await worker.tick();

    expect(jobManager.runCommitSlice).toHaveBeenCalledWith('sess-1');
  });

  it('클레임할 세션이 없으면 아무 것도 하지 않는다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });

    await worker.tick();

    expect(jobManager.runCommitSlice).not.toHaveBeenCalled();
  });

  it('PRODUCT_IMPORT_WORKER_ENABLED=false 면 클레임조차 하지 않는다', async () => {
    const { worker, jobManager } = makeWorker({ enabled: 'false', claims: ['sess-1'] });

    await worker.tick();

    expect(jobManager.claimCommit).not.toHaveBeenCalled();
  });

  it('이전 틱이 아직 돌고 있으면 건너뛴다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    let release: () => void = () => {};
    jobManager.runCommitSlice.mockImplementation(() => new Promise<void>((r) => (release = r)));

    const first = worker.tick();
    await worker.tick();
    release();
    await first;

    expect(jobManager.claimCommit).toHaveBeenCalledTimes(1);
  });

  it('슬라이스가 터져도 예외를 밖으로 던지지 않는다 — 다음 틱이 이어간다', async () => {
    const { worker, jobManager } = makeWorker({ claims: ['sess-1'] });
    jobManager.runCommitSlice.mockRejectedValue(new Error('DB down'));

    await expect(worker.tick()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 8: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import-job.worker.spec' --silent`
Expected: FAIL — 모듈 없음

- [ ] **Step 9: 워커 구현**

`product-import-job.worker.ts` 를 만든다.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProductImportJobManager } from './product-import-job.manager';

/**
 * 대량등록 잡 워커. OutboxDispatcher 와 같은 모양이다 — @Cron + 원자적 claim.
 *
 * 한 틱은 세션 하나의 슬라이스 하나만 돈다. isProcessing 가드가 틱 누적을 막고,
 * 슬라이스가 틱 길이를 유계로 만든다.
 *
 * ScheduleModule.forRoot() 는 앱 어딘가에서 한 번만 부르면 되고
 * (apps/core/src/modules/inventory/core/inventory.module.ts:39) 전역 discovery 로
 * 이 @Cron 을 찾는다 — fulfillment.module.ts:78 과 같은 관례다.
 */
@Injectable()
export class ProductImportJobWorker {
  private readonly logger = new Logger(ProductImportJobWorker.name);
  private isProcessing = false;

  constructor(
    private readonly jobManager: ProductImportJobManager,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('PRODUCT_IMPORT_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.isProcessing) {
      this.logger.debug('이전 임포트 잡 슬라이스 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;
    let claimed: ClaimedSession | null = null;
    try {
      claimed = await this.jobManager.claimCommit();
      if (!claimed) return;
      await this.jobManager.runCommitSlice(claimed);
    } catch (error) {
      // 다음 틱이 이어받는다. lease 가 만료되면 같은 세션을 다시 잡는다.
      //
      // 예외를 로그로만 남기면, 결정적으로 실패하는 세션(예: 형식이 깨진 payload)이
      // lease 주기마다 조용히 재시도되며 운영자에게는 "running 인 채로 멈춘" 것으로만
      // 보인다. commit_error 에 적어 GET /product-imports/:id 로 드러나게 한다.
      //
      // lease 는 여기서 지우지 않는다 — 예외가 났다는 건 우리가 지금 어떤 상태인지
      // 모른다는 뜻이고, 그 상태에서 lease 를 지우면 후임 워커의 lease 를 지울 수도 있다.
      // 만료를 기다리면 그만이다(최대 leaseMs).
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      // 두 번째 인자를 넘겨야 Nest 가 스택을 찍는다 — 예상 못 한 예외에서 유일한 단서다.
      this.logger.error(
        `임포트 잡 슬라이스 실패 (session=${claimed?.sessionId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (claimed) await this.jobManager.recordJobError(claimed.sessionId, 'commit', message);
    } finally {
      this.isProcessing = false;
    }
  }
}
```

`ProductImportJobManager` 에 아래를 더한다. lease 도 함께 놓아 다음 틱이 곧바로 재시도하게 한다 (상태는 `running` 유지 — 재시도 자체를 막지는 않는다).

```ts
  /**
   * 슬라이스를 탈출한 예외를 세션에 기록한다. 상태를 failed 로 바꾸지는 않는다 —
   * 일시적 DB 오류로 임포트를 영구 실패시키는 편이 더 나쁘고, 재시도 횟수를 셀 컬럼이
   * 없다. 대신 마지막 오류를 남겨 운영자가 API 로 볼 수 있게 한다.
   */
  async recordJobError(sessionId: string, kind: 'commit' | 'publish', message: string): Promise<void> {
    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set(kind === 'commit' ? { commitError: message } : { publishError: message })
        .where(eq(productImportSessions.id, sessionId)),
    );
  }
```

- [ ] **Step 10: 모듈 배선**

`product-import.module.ts` 의 `providers` 에 `ProductImportJobManager`, `ProductImportJobWorker` 를 추가하고 import 한다.

- [ ] **Step 11: 전체 테스트 + 게이트**

Run: `npx jest --testPathPattern='operations/import' --silent && npm run type-check:scoped && npx nest build core`
Expected: 전부 PASS / exit 0

- [ ] **Step 12: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import apps/core/src/config/env.validation.ts
git commit -m "feat(core): 대량등록 commit 잡 워커 — SKIP LOCKED 클레임 + 슬라이스 처리

한 틱이 세션 하나를 잡아 행 N개만 처리하고 lease 를 놓는다. 진행 원장은 행의
status 자체라 크래시 후 lease 만료되면 남은 pending 부터 이어간다.
variantOverrides 가 없으면 getVariantComboMap(variant 당 4-join)을 건너뛴다."
```

---

### Task 7: publish 슬라이스 + 행 단위 게시 상태

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.worker.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts:197-221`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts:78-80`
- Modify: `apps/core/src/modules/catalog/operations/import/product-import.controller.ts:74-79`
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts:104-118`
- Test: `product-import-job.manager.spec.ts`, `product-import-job.worker.spec.ts`, `product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductVersionsService.publishVersion(versionId, tx?)`, `ProductImportSessionReader.getDraftVersionId(masterId, tx?)`
- Produces:
  - `ProductImportManager.queuePublish(sessionId: string): Promise<PublishAcceptedDto>` — 기존 `publishSession()` 을 대체
  - `ProductImportJobManager.claimPublish(): Promise<ClaimedSession | null>`
  - `ProductImportJobManager.runPublishSlice(claimed: ClaimedSession): Promise<void>`
  - `PublishAcceptedDto { sessionId: string; status: 'queued'; targetCount: number }`
  - env: `PRODUCT_IMPORT_PUBLISH_SLICE` (기본 10) — Task 6 Step 1 에서 이미 선언됨

- [ ] **Step 1: 실패하는 테스트 작성 (큐잉)**

`product-import.manager.spec.ts` 의 `makeHarness` 를 먼저 확장한다. 지금은 `select` 를 목하지 않고 `update` 도 `productVariants` 만 모은다.

```ts
// makeHarness(opts) 로 시그니처를 바꾸고 session 을 주입 가능하게 한다.
function makeHarness(
  createMasterImpl?: (userId: string) => any,
  opts: { session?: Record<string, unknown> } = {},
) {
  const session = {
    id: 'sess-1',
    commitStatus: 'completed',
    publishStatus: 'idle',
    ...opts.session,
  };
  const updates: { table: string; values: any }[] = [];
  // …기존 inserted/sessions/updatedVariantCodes 선언 그대로…

  const chain = (rows: any[]): any => {
    const builder: any = Promise.resolve(rows);
    builder.limit = () => Promise.resolve(rows);
    return builder;
  };
```

`trx` 에 `select` 를 더하고 `update` 가 모든 테이블을 `updates` 에 모으게 한다.

```ts
    select: (projection?: any) => ({
      from: (table: any) => ({
        // count() 프로젝션이면 집계 한 줄, 아니면 세션 한 줄
        where: () => chain(projection?.value ? [{ value: 0 }] : table === productImportSessions ? [session] : []),
      }),
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: (condition: any) => {
          if (table === productVariants) {
            updatedVariantCodes.push({
              variantId: extractEqValue(condition) as string,
              variantCode: values.variantCode,
            });
          }
          updates.push({ table: table === productImportSessions ? 'sessions' : 'items', values });
          return Promise.resolve();
        },
      }),
    }),
```

반환 객체에 `updates` 를 더한다. 그 뒤 테스트를 추가한다.

```ts
describe('queuePublish', () => {
  it('publish_status 를 queued 로 올리고 실패했던 행만 pending 으로 되돌린다', async () => {
    const { manager, updates } = makeHarness();

    const result = await manager.queuePublish('sess-1');

    expect(result).toMatchObject({ sessionId: 'sess-1', status: 'queued' });
    const sessionUpdate = updates.find((u) => u.values.publishStatus === 'queued');
    expect(sessionUpdate).toBeDefined();
    const retry = updates.find((u) => u.values.publishStatus === 'pending');
    expect(retry).toBeDefined();
  });

  it('이미 running 이면 409 다', async () => {
    const { manager } = makeHarness(undefined, { session: { publishStatus: 'running' } });

    await expect(manager.queuePublish('sess-1')).rejects.toThrow(/이미/);
  });

  it('commit 이 끝나지 않았으면 409 다', async () => {
    const { manager } = makeHarness(undefined, { session: { commitStatus: 'running', publishStatus: 'idle' } });

    await expect(manager.queuePublish('sess-1')).rejects.toThrow(/생성/);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.manager.spec' --silent`
Expected: FAIL — `queuePublish` 없음

- [ ] **Step 3: `publishSession()` 을 `queuePublish()` 로 교체**

`product-import.manager.ts` 의 `publishSession()`(197-221행)을 지우고 아래를 넣는다. `ItemRow` import 가 안 쓰이면 지운다.

```ts
  /**
   * 게시를 접수한다. 실제 게시는 ProductImportJobWorker 가 슬라이스로 돈다.
   * 실패했던 행만 pending 으로 되돌리므로, 다시 누르면 재시도가 된다 —
   * 이미 published 인 행은 건드리지 않아 이벤트가 두 번 나가지 않는다.
   */
  async queuePublish(sessionId: string): Promise<PublishAcceptedDto> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      if (session.commitStatus !== 'completed') {
        throw new ConflictError('상품 생성이 아직 끝나지 않았습니다. 완료 후 게시할 수 있습니다.');
      }
      if (session.publishStatus === 'queued' || session.publishStatus === 'running') {
        throw new ConflictError('이미 게시가 진행 중입니다.');
      }

      await trx
        .update(productImportItems)
        .set({ publishStatus: 'pending', publishError: null })
        .where(and(eq(productImportItems.sessionId, sessionId), eq(productImportItems.publishStatus, 'failed')));

      const [targetRow] = await trx
        .select({ value: count() })
        .from(productImportItems)
        .where(
          and(
            eq(productImportItems.sessionId, sessionId),
            eq(productImportItems.status, 'created'),
            eq(productImportItems.publishStatus, 'pending'),
          ),
        );

      await trx
        .update(productImportSessions)
        .set({ publishStatus: 'queued', publishError: null, publishFailedCount: 0, leaseUntil: null })
        .where(eq(productImportSessions.id, sessionId));

      return { sessionId, status: 'queued' as const, targetCount: Number(targetRow?.value ?? 0) };
    });
  }
```

`and`, `count`, `ConflictError`, `NotFoundError`, `PublishAcceptedDto` 를 import 한다.

- [ ] **Step 4: DTO 교체**

`import-response.dto.ts` 의 `PublishResultDto` / `PublishFailureDto` 를 지우고 넣는다.

```ts
export class PublishAcceptedDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty({ description: '게시 대상 행 수. 진행은 GET /product-imports/:id 로 폴링한다.' })
  targetCount: number;
}
```

`dto/index.ts` 의 export 를 맞춘다.

- [ ] **Step 5: service·controller 배선**

`product-import.service.ts`:

```ts
  publishSession(sessionId: string): Promise<PublishAcceptedDto> {
    return this.manager.queuePublish(sessionId);
  }
```

`product-import.controller.ts`:

```ts
  @Post(':sessionId/publish')
  @HttpCode(202)
  @ApiOperation({ summary: '세션 내 draft 일괄 게시 접수' })
  @ApiResponse({ status: 202, type: PublishAcceptedDto })
  async publish(@Param('sessionId') sessionId: string): Promise<PublishAcceptedDto> {
    return this.service.publishSession(sessionId);
  }
```

- [ ] **Step 6: 실패하는 테스트 작성 (publish 슬라이스)**

`product-import-job.manager.spec.ts` 에 추가한다. `makeHarness` 의 `pendingItems` 를 게시 대상 행으로도 쓴다.

```ts
describe('runPublishSlice', () => {
  const CREATED = (rowNumber: number) => ({
    id: `item-${rowNumber}`,
    rowNumber,
    status: 'created',
    masterId: `master-${rowNumber}`,
    publishStatus: 'pending',
  });

  it('draft 버전을 게시하고 행을 published 로 바꾼다', async () => {
    const { manager, updates, reader, versionsService } = makeHarness({ pendingItems: [CREATED(1)] });

    await manager.runPublishSlice('sess-1');

    expect(versionsService.publishVersion).toHaveBeenCalledWith('draft-1', expect.anything());
    const itemUpdate = updates.find((u) => u.table === 'items');
    expect(itemUpdate!.values).toMatchObject({ publishStatus: 'published' });
    expect(itemUpdate!.values.publishedAt).toBeInstanceOf(Date);
  });

  it('draft 가 없으면 이미 게시된 것으로 보고 published 로 마감한다', async () => {
    const { manager, updates, reader, versionsService } = makeHarness({ pendingItems: [CREATED(1)] });
    reader.getDraftVersionId.mockResolvedValue(null);

    await manager.runPublishSlice('sess-1');

    expect(versionsService.publishVersion).not.toHaveBeenCalled();
    expect(updates.find((u) => u.table === 'items')!.values).toMatchObject({ publishStatus: 'published' });
  });

  it('한 행이 터져도 나머지를 계속하고 그 행만 failed 로 남긴다', async () => {
    const { manager, updates, versionsService } = makeHarness({ pendingItems: [CREATED(1), CREATED(2)] });
    versionsService.publishVersion.mockRejectedValueOnce(new Error('productCode 중복'));

    await manager.runPublishSlice('sess-1');

    const itemUpdates = updates.filter((u) => u.table === 'items');
    expect(itemUpdates[0].values).toMatchObject({ publishStatus: 'failed' });
    expect(itemUpdates[0].values.publishError).toContain('productCode 중복');
    expect(itemUpdates[1].values).toMatchObject({ publishStatus: 'published' });
  });

  it('남은 대상이 없으면 세션 publish 를 completed 로 마감한다', async () => {
    const { manager, updates } = makeHarness({ pendingItems: [] });

    await manager.runPublishSlice('sess-1');

    const done = updates.find((u) => u.table === 'sessions' && u.values.publishStatus === 'completed');
    expect(done).toBeDefined();
    expect(done!.values.leaseUntil).toBeNull();
  });
});
```

`makeHarness` 에 `reader`(`getDraftVersionId` 는 기본 `draft-1` 반환)와 `versionsService`(`publishVersion`)를 추가하고 `ProductImportJobManager` 생성자에 넘긴다.

- [ ] **Step 7: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import-job.manager.spec' --silent`
Expected: FAIL — `runPublishSlice` 없음

- [ ] **Step 8: publish 슬라이스 구현**

`product-import-job.manager.ts` 에 추가한다. 생성자 인자를 **아래 순서로 고정**한다 — Task 6 의 spec 하네스가 위치 인자로 만들기 때문에 순서가 어긋나면 조용히 잘못된 목이 주입된다.

```ts
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly importManager: ProductImportManager,
    private readonly variantCodeChecker: ProductImportVariantCodeChecker,
    private readonly config: ConfigService,
    private readonly reader: ProductImportSessionReader,
    private readonly versionsService: ProductVersionsService,
  ) {}
```

Task 6 의 `makeHarness` 도 같은 순서로 고친다.

```ts
  const reader = { getDraftVersionId: jest.fn(async () => 'draft-1') } as any;
  const versionsService = { publishVersion: jest.fn(async () => undefined) } as any;
  const manager = new ProductImportJobManager(db, importManager, variantCodeChecker, config, reader, versionsService);
  return { manager, updates, trx, importManager, variantCodeChecker, reader, versionsService };
```

```ts
export const DEFAULT_PUBLISH_SLICE = 10;
```

```ts
  get publishSlice(): number {
    return this.positiveInt('PRODUCT_IMPORT_PUBLISH_SLICE', DEFAULT_PUBLISH_SLICE);
  }

  async claimPublish(tx?: DbTransaction): Promise<ClaimedSession | null> {
    return this.claim('publish_status', tx);
  }

  /**
   * 게시 슬라이스. commit 보다 작은 이유는 건당 outbox 이벤트 + 스냅샷 조립이 붙기
   * 때문이다 — 4단계(레인 강등) 이전까지 이 슬라이스가 유일한 완충이다.
   */
  async runPublishSlice(claimed: ClaimedSession): Promise<void> {
    const { sessionId, leaseToken } = claimed;
    const items = await this.db.run((trx) =>
      trx
        .select()
        .from(productImportItems)
        .where(
          and(
            eq(productImportItems.sessionId, sessionId),
            eq(productImportItems.status, 'created'),
            eq(productImportItems.publishStatus, 'pending'),
          ),
        )
        .orderBy(productImportItems.rowNumber)
        .limit(this.publishSlice),
    );

    if (items.length === 0) {
      await this.db.run((trx) =>
        trx
          .update(productImportSessions)
          // commit 마감과 같은 이유로 토큰 CAS 를 건다 — lease 를 잃은 좀비가
          // 후임의 세션에 completed 를 도장 찍고 lease 를 지우는 것을 막는다.
          .set({ publishStatus: 'completed', leaseUntil: null, leaseToken: null })
          .where(and(eq(productImportSessions.id, sessionId), eq(productImportSessions.leaseToken, leaseToken))),
      );
      return;
    }

    for (const item of items) {
      // commit 슬라이스와 같은 이유로 행마다 lease 를 갱신한다 — publishVersion 은
      // 가격검증 + 캐시 + 매칭 인계 + 스냅샷 조립이 붙어 행당 비용이 commit 보다 크다.
      if (!(await this.renewLease(sessionId, leaseToken))) {
        this.logger.warn(`임포트 세션 lease 를 잃어 게시 슬라이스를 중단한다 (session=${sessionId})`);
        return;
      }

      const { masterId } = item;
      if (!masterId) {
        await this.failPublish(item.id, sessionId, 'masterId 가 없어 게시할 수 없습니다.');
        continue;
      }

      try {
        const draftVersionId = await this.reader.getDraftVersionId(masterId);
        if (draftVersionId) {
          await this.db.run((trx) => this.versionsService.publishVersion(draftVersionId, trx));
        }
        // draft 가 없으면 이미 active 다 — 재실행에서 여기 오므로 published 로 마감한다(멱등).
        await this.db.run(async (trx) => {
          await trx
            .update(productImportItems)
            .set({ publishStatus: 'published', publishedAt: new Date(), publishError: null })
            .where(eq(productImportItems.id, item.id));
          await trx
            .update(productImportSessions)
            .set({ publishedCount: sql`${productImportSessions.publishedCount} + 1` })
            .where(eq(productImportSessions.id, sessionId));
        });
      } catch (error) {
        this.logger.warn(`임포트 행 게시 실패 (session=${sessionId}, master=${masterId}): ${String(error)}`);
        await this.failPublish(item.id, sessionId, error instanceof Error ? error.message : '알 수 없는 오류');
      }
    }

    await this.releaseLease(sessionId, leaseToken);
  }

  private async failPublish(itemId: string, sessionId: string, publishError: string): Promise<void> {
    await this.db.run(async (trx) => {
      await trx
        .update(productImportItems)
        .set({ publishStatus: 'failed', publishError })
        .where(eq(productImportItems.id, itemId));
      await trx
        .update(productImportSessions)
        .set({ publishFailedCount: sql`${productImportSessions.publishFailedCount} + 1` })
        .where(eq(productImportSessions.id, sessionId));
    });
  }
```

- [ ] **Step 9: 워커가 publish 도 집도록 확장**

`product-import-job.worker.ts` 의 `tick()` 본문을 고친다.

```ts
    this.isProcessing = true;
    let claimed: string | null = null;
    let kind: 'commit' | 'publish' = 'commit';
    try {
      // commit 이 우선이다 — 생성이 끝나야 게시할 것이 생긴다.
      claimed = await this.jobManager.claimCommit();
      if (claimed) {
        await this.jobManager.runCommitSlice(claimed);
        return;
      }
      kind = 'publish';
      claimed = await this.jobManager.claimPublish();
      if (claimed) {
        await this.jobManager.runPublishSlice(claimed);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      this.logger.error(
        `임포트 잡 슬라이스 실패 (session=${claimed?.sessionId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Task 6 이 'commit' 로 고정해 둔 인자를 kind 로 바꾼다.
      if (claimed) await this.jobManager.recordJobError(claimed.sessionId, kind, message);
    } finally {
      this.isProcessing = false;
    }
  }
```

워커 spec 에 케이스를 하나 더한다.

```ts
  it('commit 대상이 없으면 publish 를 잡는다', async () => {
    const { worker, jobManager } = makeWorker({ claims: [null] });
    jobManager.claimPublish = jest.fn(async () => ({ sessionId: 'sess-2', leaseToken: 'tok-2' }));
    jobManager.runPublishSlice = jest.fn(async () => undefined);

    await worker.tick();

    expect(jobManager.runPublishSlice).toHaveBeenCalledWith('sess-2');
  });
```

기존 워커 spec 의 `makeWorker` 에 `claimPublish: jest.fn(async () => null)` 와 `runPublishSlice: jest.fn()` 을 기본값으로 더한다. `runPublishSlice` 단정은 `toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-2' }))` 형태로 쓴다 — 인자가 문자열이 아니라 `ClaimedSession` 이다.

- [ ] **Step 10: 전체 테스트 + 게이트**

Run: `npx jest --testPathPattern='operations/import' --silent && npm run type-check:scoped && npx nest build core`
Expected: 전부 PASS / exit 0

- [ ] **Step 11: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 대량등록 publish 를 202 접수 + 슬라이스 잡으로 전환

행마다 publish_status 를 남겨 게시 여부를 영속 추적한다(v1 의 알려진 제약 해소).
다시 누르면 failed 행만 pending 으로 되돌아가므로 published 행에 이벤트가
두 번 나가지 않는다. publish 슬라이스가 commit 보다 작은 것은 건당 outbox
이벤트 + 스냅샷 조립이 붙기 때문이다."
```

---

### Task 8: 진행 조회 API

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts:76-102`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts:56-110`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts`

**Interfaces:**
- Consumes: `ProductImportSessionReader.getSession/getSessions` (변경 없음 — `select()` 가 새 컬럼을 자동으로 포함한다)
- Produces:
  - `SessionSummaryDto` += `commitStatus`, `publishStatus`, `publishedCount`, `publishFailedCount`, `commitError`, `publishError`
  - `CommitItemDto` += `publishStatus`, `publishError`

- [ ] **Step 1: 실패하는 테스트 작성**

`product-import.service.spec.ts` 에 추가한다. 기존 reader 목의 반환 객체에 새 컬럼을 더해야 한다.

```ts
it('세션 상세가 잡 상태와 게시 카운트를 담는다', async () => {
  reader.getSession.mockResolvedValue({
    session: {
      id: 'sess-1',
      fileName: 'f.xlsx',
      totalRows: 3,
      createdCount: 2,
      failedCount: 1,
      status: 'completed',
      createdAt: new Date('2026-07-28T00:00:00.000Z'),
      commitStatus: 'completed',
      publishStatus: 'running',
      publishedCount: 1,
      publishFailedCount: 0,
      commitError: null,
      publishError: null,
    },
    items: [
      {
        rowNumber: 1,
        productKey: 'P1',
        status: 'created',
        masterId: 'm1',
        errorMessage: null,
        publishStatus: 'published',
        publishError: null,
      },
    ],
  });

  const result = await service.getSession('sess-1');

  expect(result).toMatchObject({
    commitStatus: 'completed',
    publishStatus: 'running',
    publishedCount: 1,
    publishFailedCount: 0,
  });
  expect(result.items[0]).toMatchObject({ publishStatus: 'published' });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npx jest --testPathPattern='product-import.service.spec' --silent`
Expected: FAIL — 필드 없음

- [ ] **Step 3: DTO 확장**

`import-response.dto.ts` 의 `SessionSummaryDto` 에 추가한다.

```ts
  @ApiProperty({ enum: ['idle', 'queued', 'running', 'completed', 'failed'], description: '상품 생성 잡 상태' })
  commitStatus: string;

  @ApiProperty({ enum: ['idle', 'queued', 'running', 'completed', 'failed'], description: '게시 잡 상태' })
  publishStatus: string;

  @ApiProperty()
  publishedCount: number;

  @ApiProperty()
  publishFailedCount: number;

  @ApiProperty({ required: false, nullable: true })
  commitError: string | null;

  @ApiProperty({ required: false, nullable: true })
  publishError: string | null;
```

`CommitItemDto` 에 추가한다.

```ts
  @ApiProperty({ enum: ['pending', 'published', 'failed', 'skipped'] })
  publishStatus: 'pending' | 'published' | 'failed' | 'skipped';

  @ApiProperty({ required: false })
  publishError?: string;
```

- [ ] **Step 4: service 매핑 확장**

`product-import.service.ts` 의 `toSummary` 시그니처와 본문에 새 필드를 더하고, `getSession` 의 item 매핑에 두 필드를 더한다.

```ts
      items: items.map((i) => ({
        rowNumber: i.rowNumber,
        productKey: i.productKey ?? '',
        status: i.status,
        masterId: i.masterId ?? undefined,
        errorMessage: i.errorMessage ?? undefined,
        publishStatus: i.publishStatus,
        publishError: i.publishError ?? undefined,
      })),
```

`toSummary` 의 파라미터 타입은 인라인 객체 리터럴 대신 `SessionRow` 를 쓴다 — 컬럼이 늘 때마다 손대지 않게 된다.

```ts
  private toSummary(session: SessionRow): SessionSummaryDto {
    return {
      id: session.id,
      fileName: session.fileName,
      totalRows: session.totalRows,
      createdCount: session.createdCount,
      failedCount: session.failedCount,
      status: session.status,
      createdAt: session.createdAt,
      commitStatus: session.commitStatus,
      publishStatus: session.publishStatus,
      publishedCount: session.publishedCount,
      publishFailedCount: session.publishFailedCount,
      commitError: session.commitError,
      publishError: session.publishError,
    };
  }
```

`SessionRow` 를 `product-import-session.reader` 에서 import 한다.

- [ ] **Step 5: 테스트 + 게이트**

Run: `npx jest --testPathPattern='operations/import' --silent && npm run type-check:scoped && npx nest build core`
Expected: 전부 PASS / exit 0

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import
git commit -m "feat(core): 임포트 세션 조회에 잡 상태·게시 카운트 노출 (폴링 대상)"
```

---

### Task 9: admin-web 폴링 UI + 업로드 안내 문구 (#6)

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Modify: `apps/admin-web/src/lib/api/domains/products/product-import.client.ts`
- Modify: `apps/admin-web/src/lib/services/products/queries.ts`
- Modify: `apps/admin-web/src/features/mall/product-imports/wizard/index.tsx`
- Modify: `apps/admin-web/src/features/mall/product-imports/wizard/commit-result-step.tsx`
- Modify: `apps/admin-web/src/features/mall/product-imports/wizard/upload-step.tsx:51`
- Modify: `apps/admin-web/src/features/mall/product-imports/session-detail/index.tsx`

**Interfaces:**
- Consumes: `GET /product-imports/:id` (Task 8), `POST /commit`(202, `CommitAcceptedDto`), `POST /:id/publish`(202, `PublishAcceptedDto`)
- Produces: `useImportSession(sessionId)` 가 잡이 진행 중이면 2초마다 refetch

- [ ] **Step 1: DTO 미러 타입 갱신**

`apps/admin-web/src/lib/types/dto/product-import.ts` 를 고친다.

```ts
export type ImportJobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';
export type ItemPublishStatus = 'pending' | 'published' | 'failed' | 'skipped';

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  status: 'pending' | 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
  publishStatus: ItemPublishStatus;
  publishError?: string;
}

export interface CommitAcceptedDto {
  sessionId: string;
  status: 'queued';
  totalRows: number;
  queuedCount: number;
  invalidCount: number;
}

export interface PublishAcceptedDto {
  sessionId: string;
  status: 'queued';
  targetCount: number;
}

export interface SessionSummaryDto {
  id: string;
  fileName: string | null;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  status: string;
  createdAt: string;
  commitStatus: ImportJobStatus;
  publishStatus: ImportJobStatus;
  publishedCount: number;
  publishFailedCount: number;
  commitError: string | null;
  publishError: string | null;
}
```

`CommitResultDto` / `PublishResultDto` 는 지운다.

- [ ] **Step 2: 클라이언트 반환 타입 교체**

`product-import.client.ts` 의 `commit` 반환을 `CommitAcceptedDto`, `publish` 반환을 `PublishAcceptedDto` 로 바꾸고 import 를 맞춘다.

- [ ] **Step 3: 진행 중이면 폴링하도록 쿼리 훅 수정**

`queries.ts:649-655` 의 `useImportSession` 을 고친다. 키와 `enabled` 는 그대로 두고 `refetchInterval` 만 얹는다.

```ts
/** 임포트 세션 상세(성공/실패 아이템 전체). 잡이 도는 동안만 폴링한다. */
export const useImportSession = (sessionId: string) => {
  return useQuery({
    queryKey: productQueryKeys.productImport(sessionId),
    queryFn: () => products.productImport.getSession(sessionId),
    enabled: !!sessionId,
    // 끝나면 false 가 되어 폴링이 멈춘다 — 완료된 세션 화면을 열어두어도 요청이 계속 나가지 않는다.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      const running = (s: ImportJobStatus) => s === 'queued' || s === 'running';
      return running(data.commitStatus) || running(data.publishStatus) ? 2000 : false;
    },
  });
};
```

`ImportJobStatus` 를 `@/lib/types/dto/product-import` 에서 import 한다.

- [ ] **Step 4: 위저드 3단계를 "접수됨" 으로 바꾼다**

`wizard/index.tsx` 의 `handleCommit` 을 고친다 — 접수되면 바로 세션 상세로 보낸다. 거기가 진행률을 보여주는 화면이다.

```ts
  function handleCommit() {
    if (!file) return;
    commit.mutate(file, {
      onSuccess: (res) => {
        setResult(res);
        setStep(3);
      },
      onError: () => toast.error('커밋 접수 중 오류가 발생했습니다.'),
    });
  }
```

`result` 의 타입을 `CommitAcceptedDto | null` 로 바꾸고, `commit-result-step.tsx` 가 `createdCount`/`failedCount`/`items` 대신 `totalRows`/`queuedCount`/`invalidCount` 를 읽도록 고친다. 문구는 "등록 완료" 가 아니라 **"접수되었습니다 — 생성이 진행 중입니다"** 여야 한다. 실제 생성은 아직 안 끝났고, 끝난 것처럼 쓰면 사용자가 결과를 오해한다.

- [ ] **Step 5: 세션 상세에 진행률과 게시 상태를 붙인다**

`session-detail/index.tsx` 를 고친다.

- `handlePublish` 의 `onSuccess` 에서 `res.published` 대신 `res.targetCount` 를 읽어 `toast.info(`${res.targetCount}건 게시를 접수했습니다.`)` 로 바꾸고, `publishResult` 상태와 결과 박스는 지운다 — 결과는 이제 폴링되는 `session` 에서 온다.
- 헤더 `subtitle` 에 진행률을 넣는다.

```tsx
          subtitle={`${session.fileName ?? '(파일명 없음)'} · 생성 ${session.createdCount}/${session.totalRows} (실패 ${session.failedCount}) · 게시 ${session.publishedCount} (실패 ${session.publishFailedCount})`}
```

- 게시 버튼은 잡이 도는 동안 비활성화한다.

```tsx
  const commitRunning = session.commitStatus === 'queued' || session.commitStatus === 'running';
  const publishRunning = session.publishStatus === 'queued' || session.publishStatus === 'running';
```

```tsx
            <Button onClick={handlePublish} disabled={publish.isPending || commitRunning || publishRunning}>
              {commitRunning ? '생성 중...' : publishRunning ? '게시 중...' : '세션 일괄 게시'}
            </Button>
```

- 아이템 표(`<thead>` 의 4개 열)에 게시 열을 더한다.

```tsx
                <tr className="text-left">
                  <th className="p-2">행</th>
                  <th className="p-2">productKey</th>
                  <th className="p-2">생성</th>
                  <th className="p-2">게시</th>
                  <th className="p-2">상품 / 오류</th>
                </tr>
```

- `<tbody>` 의 상태 셀을 `pending` 까지 다루도록 고치고 게시 셀을 더한다. 기존 코드는 `created` 가 아니면 전부 "실패" 로 그리므로, 아직 처리되지 않은 행이 실패로 보인다.

```tsx
                    <td className="p-2">
                      {i.status === 'created' ? (
                        <span className="text-green-600">생성</span>
                      ) : i.status === 'pending' ? (
                        <span className="text-muted-foreground">대기</span>
                      ) : (
                        <span className="text-destructive">실패</span>
                      )}
                    </td>
                    <td className="p-2">
                      {i.publishStatus === 'published' ? (
                        <span className="text-green-600">게시</span>
                      ) : i.publishStatus === 'failed' ? (
                        <span className="text-destructive" title={i.publishError}>
                          실패
                        </span>
                      ) : i.publishStatus === 'skipped' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-muted-foreground">대기</span>
                      )}
                    </td>
```

- 마지막 셀의 오류 표시도 게시 오류를 함께 보여준다.

```tsx
                    <td className="p-2">
                      {i.status === 'created' && i.masterId ? (
                        <div className="flex flex-col gap-y-1">
                          <Link
                            href={`/mall/products-list/${i.masterId}`}
                            className="text-primary underline"
                          >
                            상품 상세
                          </Link>
                          {i.publishError && (
                            <span className="text-xs text-destructive">{i.publishError}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-destructive">{i.errorMessage}</span>
                      )}
                    </td>
```

- [ ] **Step 6: 업로드 안내 문구 수정 (#6)**

`upload-step.tsx:51` 의 문구를 고친다. 2단계에서 `Variants` 시트가 생겼는데 안내는 2시트 그대로다.

```tsx
          템플릿(Products/Options/Variants 시트)을 받아 작성한 뒤 업로드하세요.
          Variants 시트는 선택입니다 — 조합별로 가격을 다르게 주거나 variantCode 를
          심을 때만 채웁니다. 업로드하면 자동으로 검증됩니다.
```

- [ ] **Step 7: 타입 게이트**

Run: `cd apps/admin-web && npx tsc --noEmit -p tsconfig.json`
Expected: **변경한 파일에 신규 오류가 없어야 한다.** admin-web 타입체크는 레포 상시 debt 이므로 전체 exit code 를 게이트로 쓰지 않는다 — 출력에서 위 7개 파일 경로를 검색해 새 오류가 없는지 본다.

- [ ] **Step 8: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 대량등록 접수·진행률 폴링 UI + 업로드 안내 문구 3시트로 수정

commit/publish 가 202 접수로 바뀌었으므로 위저드 3단계는 '접수됨'이고 진행은
세션 상세가 2초 폴링으로 보여준다. 잡이 끝나면 폴링이 멈춘다."
```

---

## 배포 노트

이 계획이 끝나면 다음이 필요하다.

1. **`migrate` 를 `deploy` 보다 먼저.** additive expand phase 다 (ADR-0005 §5). 새 컬럼을 읽고 쓰는 코드가 컬럼보다 먼저 뜨면 깨진다.
   ```bash
   npm run db:migrate -- --stage live --deployment lcnine-services --yes
   ```
2. **`sst deploy`** — core 와 admin-web 이 같은 스택(`sst.aws.Nextjs('AdminWeb')`)이라 함께 나간다.
3. **환경변수는 전부 선택**이다. 미설정 시 워커 on / commit 슬라이스 20 / publish 슬라이스 10 / lease 60초. 급할 때 끄는 스위치는 `PRODUCT_IMPORT_WORKER_ENABLED=false`.
4. **⚠️ 배포 이전에 만들어진 세션의 "세션 일괄 게시" 버튼을 누르지 말 것.** `publish_status` 는 컬럼 DEFAULT 로 `idle`, 행은 `pending` 을 받으므로, v1 시절 이미 게시가 끝난 세션도 새 UI 에서 게시 "대기" 로 보이고 버튼이 살아있다. 누르면 `getDraftVersionId` 가 각 master 의 **현재 draft** 를 찾아 게시하는데, 그 사이 관리자가 편집 중이던 미완성 draft 가 있으면 그것이 active 로 올라가 full snapshot 이 Medusa·검색·스토어프론트로 나간다. 코드 경로는 v1 의 `publishSession` 과 동일해 회귀는 아니지만, **UI 가 새로 유도한다**는 점이 다르다.
5. **취소 수단과 종료 상태가 없다.** `product_import_job_status.'failed'` 를 쓰는 경로가 없어, 세션이 `commit_status='running'` 에 `lease_until` 이 계속 미래인 상태로 굳으면 복구는 수동 SQL 이다. 아래 관찰 항목이 탐지는 해주지만 처방은 없다.
6. **관찰**: 배포 후 첫 임포트에서 `product_import_sessions.commit_status` 가 `queued → running → completed` 로 도는지, `lease_until` 이 슬라이스마다 비는지 본다. `running` 인데 `lease_until` 이 계속 미래면 워커가 한 슬라이스에서 멈춘 것이다.

## 남는 것 (이 계획 밖)

- **#7·#11** — 5단계(InboxWorker 배치 claim) 계획에서 그 함수를 재작성하며 함께 처리한다.
- **#1·#3·#5·#9·#10** — 5단계 뒤 정리 커밋 하나. 전부 1~5줄이다.
- **접수↔write 사이의 variantCode 경합** — Task 3 의 checker 주석에 남겼다. DB 유니크 제약으로 닫으려면 정션 join 이 필요해 partial index 로 표현할 수 없다(ADR-0004).
- **phantom masterId** — 행 트랜잭션이 롤백돼도 비-트랜잭션 Kafka 이벤트와 product-matching 행이 남는다. 스펙 §6, 사용자 결정 "현상 유지".
