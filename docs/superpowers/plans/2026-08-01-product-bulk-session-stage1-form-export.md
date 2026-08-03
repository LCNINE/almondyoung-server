# 상품 일괄 세션 1단계 — 양식 생성 잡 + 프리필 다운로드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 상품 목록에서 상품을 골라 "양식 다운로드"를 누르면, 워커가 그 상품들의 현재 데이터가 채워진 한국어 워크북을 조립해 file-service 에 올리고, 관리자가 내려받는다.

**Architecture:** 접수는 202 로 끝내고(수천 건이면 조립이 ALB 60초를 넘는다) `product_form_exports` 잡 행을 만든다. `@Cron` 워커가 `SKIP LOCKED` + uuid 펜싱 토큰 CAS 로 잡 하나를 클레임해 조립·업로드·완료 처리한다. 스냅샷은 값이 아니라 `(masterId, versionId)` 쌍으로 `product_form_export_items` 에 기록한다 — active 버전은 CoW 라 불변이므로 나중에 재구성할 수 있다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), exceljs, `@nestjs/schedule`, Jest, Next.js(admin-web) + TanStack Query

## Global Constraints

- 레이어 규칙: Controller → Service(2-3줄 포트) → Manager/Reader → DB. Controller 는 Repository 를 직접 부르지 않고, Service 는 `HttpException`·drizzle·Express 타입을 임포트하지 않는다.
- 도메인 예외는 `@app/shared` 의 `NotFoundError`·`BadRequestError`·`ConflictError` 를 던진다. `GlobalExceptionFilter` 가 상태코드로 매핑한다.
- 트랜잭션 전파: 공개 메서드는 `tx?: DbTransaction` 을 마지막 인자로, private 헬퍼는 `tx: DbTransaction` 을 필수로. `this.db.run(async (trx) => {...}, tx)` 만 쓰고 per-class `inTx` 헬퍼를 새로 만들지 않는다 (ADR-0025).
- DB 주입은 `@InjectDb() private readonly db: DbService<PimSchema>` 형태다. `@Inject('DB')` 금지.
- 쿼리는 `trx.select().from().innerJoin().where()` 형태로 쓴다. `db.query.*`·`with` relations 금지. `any`/`as` 캐스팅은 **근거를 주석으로 남긴 경우에만** 허용한다(CLAUDE.md 규칙). 이 계획에서 유일하게 허용된 사용처는 Task 8 의 `trx.execute` 반환 좁히기이며, 근거와 선례가 그 자리에 적혀 있다.
- 마이그레이션은 `npm run db:generate:core -- --name <kebab-description>` 로 만들고 생성된 SQL 을 눈으로 확인한다. **이미 적용된 마이그레이션을 손으로 고치지 않는다.**
- 검증 게이트: `npm run type-check:scoped` exit 0, 변경 파일 기준 신규 lint error 0. **전역 `npx jest`·전역 `tsc`·`nest build core` 는 develop 에서도 red 이므로 "전체 그린"으로 판정하지 않는다** — 변경 파일 차분으로만 본다.
- admin-web 의 `.tsx` 는 레포 `lint`/`format` 글롭(`**/*.ts`)을 빠져나간다. `npx eslint <파일>` 로 직접 확인한다.
- 이 단계의 마이그레이션은 **전부 additive** 다 → ADR-0005 §5 expand phase = `migrate` → `deploy` 순서.

---

## File Structure

**신규 모듈** `apps/core/src/modules/catalog/operations/bulk-session/`

| 파일 | 책임 |
|---|---|
| `bulk-session.module.ts` | 프로바이더 배선 |
| `form-export.controller.ts` | `POST /product-forms`, `GET /product-forms/:id` |
| `dto/create-form-export.dto.ts` | 요청 DTO (masterIds) |
| `dto/form-export-response.dto.ts` | 접수 202 · 상태 조회 응답 |
| `dto/index.ts` | 배럴 |
| `services/form-export.types.ts` | 프리필 행 타입 (DB 무관, 순수) |
| `services/form-export.sheets.ts` | 시트 이름 + 한국어 헤더 정의 (순수) |
| `services/form-export.pricing-judge.ts` | 가격 룰 → 표현 가능 여부 (순수) |
| `services/form-export.workbook.ts` | 프리필 데이터 → xlsx Buffer (순수, exceljs) |
| `services/form-export.snapshot.reader.ts` | masterId[] → 프리필 행 (DB 조회 전담) |
| `services/form-export.manager.ts` | 잡 접수·조회·만료 정리 (DB 쓰기) |
| `services/form-export-job.manager.ts` | claim / lease / 조립 실행 |
| `services/form-export-job.worker.ts` | `@Cron` 틱 |
| `services/form-export-file.client.ts` | file-service 업로드·다운로드 URL |
| `services/form-export.service.ts` | 포트 (2-3줄) |

**수정**

| 파일 | 내용 |
|---|---|
| `apps/core/src/modules/catalog/schema/catalog.schema.ts` | enum 1 + 테이블 2 |
| `apps/core/src/modules/catalog/catalog.module.ts` | `BulkSessionModule` 등록 |
| `apps/file-service/src/database/default-file-contexts.ts` | `product-bulk-form` 컨텍스트 추가 |
| `apps/admin-web/src/lib/types/dto/form-export.ts` | 신규 |
| `apps/admin-web/src/lib/api/domains/products/form-export.client.ts` | 신규 |
| `apps/admin-web/src/lib/services/products/form-export.ts` | 신규 훅 |
| `apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx` | 신규 |

**분해 원칙:** 순수 함수(시트 정의·가격 판정·워크북 조립)를 DB 접근에서 분리한다. 워크북 조립이 가장 손이 많이 가는데 순수하면 단위 테스트가 싸고, 실 Postgres 없이 헤더·볼드·값 배치를 전부 검증할 수 있다.

---

### Task 1: 스키마와 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts`
- Create: `apps/core/drizzle/<timestamp>_product-form-exports.sql` (생성물)

**Interfaces:**
- Consumes: 없음
- Produces: `productFormExports`, `productFormExportItems` 테이블 객체와 `productFormExportStatusEnum`. 이후 모든 태스크가 `from '../../../schema/catalog.schema'` 로 임포트한다.

- [ ] **Step 1: enum 과 테이블을 스키마에 추가**

`catalog.schema.ts` 의 `productImportSessionStatusEnum` 선언(979행 부근) **위**에, 기존 임포트 테이블 블록과 섞이지 않도록 새 섹션으로 추가한다.

```typescript
// ===== PRODUCT FORM EXPORTS (일괄 세션 1단계 — 양식 생성 잡) =====

export const productFormExportStatusEnum = pgEnum('product_form_export_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const productFormExports = pgTable(
  'product_form_exports',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    requestedBy: uuid('requested_by').notNull(),
    /**
     * 접수 시 요청된 masterId 목록. 조립이 이 목록을 훑어 각 상품의 현재 active 를 찾는다.
     *
     * items 테이블에 미리 넣지 않는 이유: items 는 **실제로 프리필된 것만** 담아야
     * 업로드 시 수정/신규 판정의 근거가 된다. 요청됐지만 active 가 없어 빠진 상품이
     * items 에 남아 있으면, 그 상품키로 올라온 행이 "수정"으로 잘못 해석된다.
     */
    requestedMasterIds: uuid('requested_master_ids').array().notNull(),
    status: productFormExportStatusEnum('status').notNull().default('queued'),
    /** 완성된 xlsx 의 file-service fileId. status='completed' 일 때만 채워진다. */
    fileId: uuid('file_id'),
    productCount: integer('product_count').notNull().default(0),
    errorMessage: text('error_message'),
    /** 워커 클레임 lease 만료시각. NULL 이거나 과거면 다른 틱이 집어갈 수 있다. */
    leaseUntil: timestamp('lease_until'),
    /**
     * lease 소유권 펜싱 토큰. 갱신·해제·마감을 이 값으로 CAS 한다.
     * 타임스탬프로 소유권을 보려던 시도는 정밀도·타임존·드라이버 직렬화에서 세 번 깨졌다
     * (product_import_sessions.lease_token 주석 참조).
     */
    leaseToken: uuid('lease_token'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** 생성 + 30일. 만료 정리 잡이 잡 행과 xlsx 를 함께 지운다. */
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_form_exports_claim').on(table.status, table.leaseUntil),
    index('idx_form_exports_expires').on(table.expiresAt),
    index('idx_form_exports_requested_by').on(table.requestedBy),
  ],
);

export const productFormExportItems = pgTable(
  'product_form_export_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    exportId: uuid('export_id')
      .notNull()
      .references(() => productFormExports.id, { onDelete: 'cascade' }),
    masterId: uuid('master_id').notNull(),
    /**
     * 다운로드 시점의 active 버전. **값이 아니라 이 uuid 만 보관한다** —
     * active/inactive 버전은 CoW 라 불변이므로 나중에 원본을 재구성할 수 있다.
     */
    versionId: uuid('version_id').notNull(),
    /** 워크북의 '상품키' 열 값. 업로드 시 이 키로 수정/신규를 가른다. */
    rowKey: varchar('row_key', { length: 100 }).notNull(),
    /**
     * 프리필 시점의 "가격을 임포트로 표현할 수 있는가" 판정을 얼려둔다.
     * 업로드 시점에 다시 판정하면 그 사이 누가 룰을 바꿨을 때 워크북의 센티넬과 어긋난다.
     */
    pricingEditable: boolean('pricing_editable').notNull(),
  },
  (table) => [
    uniqueIndex('uq_form_export_items_master').on(table.exportId, table.masterId),
    uniqueIndex('uq_form_export_items_row_key').on(table.exportId, table.rowKey),
  ],
);
```

`masterId`·`versionId` 에 FK 를 걸지 않는 것은 의도적이다 — 상품이 지워져도 만료 전까지 잡 이력이 남아야 하고, 잡은 조립 시점에 존재 여부를 다시 확인한다.

- [ ] **Step 2: 마이그레이션 생성**

Run: `npm run db:generate:core -- --name product-form-exports`

- [ ] **Step 3: 생성된 SQL 을 눈으로 확인**

`apps/core/drizzle/<timestamp>_product-form-exports.sql` 을 연다. 다음이 **전부** 맞아야 한다:

- `CREATE TYPE "public"."product_form_export_status"` 1건
- `CREATE TABLE "product_form_exports"` / `"product_form_export_items"` 2건
- FK 1건 (`export_id` → `product_form_exports`, `ON DELETE cascade`)
- 인덱스 5건
- **`DROP` 이 0건, `ALTER TYPE ... ADD VALUE` 가 0건**

하나라도 어긋나면 `git rm` 후 `schema.ts` 를 고치고 다시 생성한다.

- [ ] **Step 4: 로컬 DB 에 적용**

Run: `npm run db:migrate:local`
Expected: 새 마이그레이션 1건 적용, 에러 없음

(AWS `dev` stage 는 폐기됐다 — `db:migrate --stage dev` 는 죽은 명령이다. 로컬은 docker-compose Postgres 를 본다.)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle/
git commit -m "feat(bulk-session): 양식 생성 잡 테이블 2종

스냅샷을 값이 아니라 (masterId, versionId) 쌍으로 보관한다 — active 버전은
CoW 라 불변이므로 재구성 가능하고, 수천 건이어도 잡에 붙는 건 uuid 쌍뿐이다.
pricing_editable 은 프리필 시점 판정을 얼린 것이다."
```

---

### Task 2: 시트 정의와 한국어 헤더

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.spec.ts`

**Interfaces:**
- Consumes: 없음 (순수)
- Produces: `ColumnDef`, `SHEET_NAMES`, `PRODUCT_COLUMNS`, `OPTION_COLUMNS`, `VARIANT_COLUMNS`, `CATEGORY_COLUMNS`, `CONSTRAINT_COLUMNS`, `IMAGE_COLUMNS`, `PRICING_SENTINEL`, `labelsOf(cols)`. Task 4(워크북)와 2단계 파서가 같은 정의를 읽는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
// form-export.sheets.spec.ts
import {
  ALL_COLUMN_SETS,
  PRODUCT_COLUMNS,
  IMAGE_COLUMNS,
  labelsOf,
  PRICING_SENTINEL,
} from './form-export.sheets';

describe('form-export.sheets', () => {
  it.each(ALL_COLUMN_SETS)('$name: 라벨이 중복되지 않는다', ({ columns }) => {
    const labels = labelsOf(columns);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it.each(ALL_COLUMN_SETS)('$name: 내부 키가 중복되지 않는다', ({ columns }) => {
    const keys = columns.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(ALL_COLUMN_SETS)('$name: 필수 열이 선택 열보다 앞에 온다', ({ columns }) => {
    const firstOptional = columns.findIndex((c) => !c.required);
    if (firstOptional === -1) return;
    const requiredAfter = columns.slice(firstOptional).filter((c) => c.required);
    expect(requiredAfter).toEqual([]);
  });

  it.each(ALL_COLUMN_SETS)('$name: 헤더가 전부 한국어다(ASCII 전용 라벨 없음)', ({ columns }) => {
    const asciiOnly = columns.filter((c) => /^[\x20-\x7E]+$/.test(c.label));
    expect(asciiOnly).toEqual([]);
  });

  it('상품 시트의 필수는 상품키·상품명·판매가 셋이다', () => {
    expect(PRODUCT_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual([
      'rowKey',
      'name',
      'basePrice',
    ]);
  });

  it('이미지 시트는 이미지키와 원본 두 열이다', () => {
    expect(labelsOf(IMAGE_COLUMNS)).toEqual(['이미지키', '원본']);
  });

  it('가격 센티넬은 대괄호로 감싼 고정 문자열이다', () => {
    expect(PRICING_SENTINEL).toBe('[복합 가격규칙]');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.spec.ts`
Expected: FAIL — "Cannot find module './form-export.sheets'"

- [ ] **Step 3: 구현**

```typescript
// form-export.sheets.ts

/**
 * 워크북 열 하나의 정의. `key` 는 내부 식별자(파서·프리필이 공유), `label` 은 작업자가
 * 보는 한국어 헤더다. 파서는 **라벨 이름으로** 열을 찾으므로 열 순서는 자유이고
 * 모르는 열은 무시한다 — 작업자가 메모 열을 추가해도 안전하다.
 */
export interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
}

/** 가격 룰이 임포트 표현 집합 밖일 때 판매가 칸에 넣는 값. 그대로면 "가격 변경 없음"이다. */
export const PRICING_SENTINEL = '[복합 가격규칙]';

export const SHEET_NAMES = {
  products: '상품',
  options: '옵션',
  variants: '조합',
  categories: '카테고리',
  constraints: '구매제약',
  images: '이미지',
  categoryReference: '카테고리 참조',
  /** exportId 를 담는 숨은 시트. 스펙의 "숨은 열"을 시트로 구현했다 — 열은 정렬·삭제로
   *  쉽게 유실되지만 시트는 훨씬 덜 건드려진다. */
  meta: '_양식정보',
} as const;

const req = (key: string, label: string): ColumnDef => ({ key, label, required: true });
const opt = (key: string, label: string): ColumnDef => ({ key, label, required: false });

export const PRODUCT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('name', '상품명'),
  req('basePrice', '판매가'),
  opt('membershipPrice', '멤버십가'),
  opt('productCode', '상품코드'),
  opt('brand', '브랜드'),
  opt('thumbnailImageKey', '대표이미지키'),
  opt('additionalImageKeys', '부가이미지키'),
  opt('description', '상세설명'),
  opt('alternativeName', '별칭'),
  opt('material', '소재'),
  opt('marketPrice', '시중가'),
  opt('supplyPrice', '공급가'),
  opt('productType', '상품유형'),
  opt('fulfillmentKind', '배송유형'),
  opt('salesClassification', '판매분류'),
  opt('purchaseClassification', '구매분류'),
  opt('ageRestriction', '연령제한'),
  opt('minQuantity', '최소구매수량'),
  opt('maxQuantity', '최대구매수량'),
  opt('seller', '판매처'),
  opt('isOverseas', '해외직구'),
  opt('isVisibleToMembersOnly', '멤버십회원전용노출'),
  opt('hideMembershipPriceForNonMembers', '비회원에게멤버십가숨김'),
  opt('isWholesaleOnly', '도매전용'),
  opt('seoTitle', 'SEO제목'),
  opt('seoDescription', 'SEO설명'),
  opt('seoKeywords', 'SEO키워드'),
  opt('salesStartDate', '판매시작'),
  opt('salesEndDate', '판매종료'),
];

export const OPTION_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('optionKey', '옵션키'),
  req('optionName', '옵션명'),
  req('optionValueKey', '옵션값키'),
  req('optionValueName', '옵션값명'),
  opt('optionSortOrder', '옵션정렬'),
  opt('colorCode', '색상코드'),
  opt('valueSortOrder', '값정렬'),
];

export const VARIANT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('combination', '조합'),
  opt('combinationLabel', '조합명(참고용)'),
  opt('basePrice', '판매가'),
  opt('membershipPrice', '멤버십가'),
  opt('variantCode', '품목코드'),
];

export const CATEGORY_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  req('categoryPath', '카테고리경로'),
  req('isPrimary', '대표여부'),
];

export const CONSTRAINT_COLUMNS: ColumnDef[] = [
  req('rowKey', '상품키'),
  opt('requiresMembership', '멤버십필요'),
  opt('lifetimeQuantityLimit', '평생구매한도'),
];

export const IMAGE_COLUMNS: ColumnDef[] = [req('imageKey', '이미지키'), req('sourceValue', '원본')];

export const CATEGORY_REFERENCE_COLUMNS: ColumnDef[] = [req('categoryPath', '카테고리경로')];

/** 테스트가 전 시트를 한 번에 도는 데 쓴다. */
export const ALL_COLUMN_SETS = [
  { name: '상품', columns: PRODUCT_COLUMNS },
  { name: '옵션', columns: OPTION_COLUMNS },
  { name: '조합', columns: VARIANT_COLUMNS },
  { name: '카테고리', columns: CATEGORY_COLUMNS },
  { name: '구매제약', columns: CONSTRAINT_COLUMNS },
  { name: '이미지', columns: IMAGE_COLUMNS },
  { name: '카테고리 참조', columns: CATEGORY_REFERENCE_COLUMNS },
];

export function labelsOf(columns: ColumnDef[]): string[] {
  return columns.map((c) => c.label);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.spec.ts`
Expected: PASS (7 tests + `it.each` 확장분)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export.sheets.spec.ts
git commit -m "feat(bulk-session): 워크북 시트·한국어 헤더 정의

파서가 라벨 이름으로 열을 찾으므로 순서는 자유다. 필수 열이 앞에 오는 규칙과
라벨/키 중복 없음을 테스트가 강제한다."
```

---

### Task 3: 가격 표현 가능 판정

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.pricing-judge.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.pricing-judge.spec.ts`

**Interfaces:**
- Consumes: `PricingRulesResponseDto` from `apps/core/src/modules/catalog/core/pricing/dto` — `{ basePriceRules, membershipPriceRules, tieredPriceRules }`, 각 원소는 `{ id, layer, order, scopeType, scopeTargetIds, operationType, operationValue }`
- Produces: `isPricingEditable(rules: PricingRulesResponseDto): boolean`, `extractSimplePrices(rules): { basePrice: number | null; membershipPrice: number | null; variantOverrides: Map<string, {basePrice: number|null; membershipPrice: number|null}> }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
// form-export.pricing-judge.spec.ts
import { isPricingEditable, extractSimplePrices } from './form-export.pricing-judge';
import type { PricingRulesResponseDto } from '../../../core/pricing/dto';

type Rule = PricingRulesResponseDto['basePriceRules'][number];

const rule = (over: Partial<Rule>): Rule =>
  ({
    id: 'r1',
    layer: 'base_price',
    order: 1,
    scopeType: 'all_variants',
    scopeTargetIds: null,
    operationType: 'override',
    operationValue: 29000,
    ...over,
  }) as Rule;

const rules = (over: Partial<PricingRulesResponseDto> = {}): PricingRulesResponseDto => ({
  basePriceRules: [],
  membershipPriceRules: [],
  tieredPriceRules: [],
  ...over,
});

describe('isPricingEditable', () => {
  it('룰이 하나도 없으면 표현 가능하다', () => {
    expect(isPricingEditable(rules())).toBe(true);
  });

  it('all_variants override 하나면 표현 가능하다', () => {
    expect(isPricingEditable(rules({ basePriceRules: [rule({})] }))).toBe(true);
  });

  it('variants override 가 섞여도 표현 가능하다', () => {
    const r = rules({
      basePriceRules: [rule({}), rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v1'] })],
    });
    expect(isPricingEditable(r)).toBe(true);
  });

  it('tiered_price 룰이 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ tieredPriceRules: [rule({ layer: 'tiered_price' })] }))).toBe(false);
  });

  it('with_option 스코프가 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ basePriceRules: [rule({ scopeType: 'with_option' })] }))).toBe(false);
  });

  it('scale 연산이 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ basePriceRules: [rule({ operationType: 'scale' })] }))).toBe(false);
  });

  it('offset 연산이 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ membershipPriceRules: [rule({ operationType: 'offset' })] }))).toBe(false);
  });
});

describe('extractSimplePrices', () => {
  it('all_variants override 를 기본가로 뽑는다', () => {
    const r = rules({
      basePriceRules: [rule({ operationValue: 29000 })],
      membershipPriceRules: [rule({ layer: 'membership_price', operationValue: 26000 })],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    expect(out.membershipPrice).toBe(26000);
  });

  it('variants 스코프는 variantId 별 오버라이드로 뽑는다', () => {
    const r = rules({
      basePriceRules: [
        rule({ operationValue: 29000 }),
        rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v1', 'v2'], operationValue: 31000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.variantOverrides.get('v1')?.basePrice).toBe(31000);
    expect(out.variantOverrides.get('v2')?.basePrice).toBe(31000);
  });

  it('기본가 룰이 없으면 null 이다', () => {
    expect(extractSimplePrices(rules()).basePrice).toBeNull();
  });

  // 계산기는 매칭되는 룰마다 가격을 덮어쓰고 all_variants 는 전 variant 에 매칭된다.
  // 따라서 뒤에 오는 all_variants 는 앞선 조합별 오버라이드까지 이긴다.
  it('뒤에 오는 all_variants 가 앞선 조합별 오버라이드를 덮는다', () => {
    const r = rules({
      basePriceRules: [
        rule({ id: 'r2', order: 2, scopeType: 'all_variants', operationValue: 29000 }),
        rule({ id: 'r1', order: 1, scopeType: 'variants', scopeTargetIds: ['v1'], operationValue: 31000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    expect(out.variantOverrides.get('v1')?.basePrice).toBeNull();
  });

  it('앞에 오는 all_variants 는 뒤의 조합별 오버라이드를 덮지 않는다', () => {
    const r = rules({
      basePriceRules: [
        rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v1'], operationValue: 31000 }),
        rule({ id: 'r1', order: 1, scopeType: 'all_variants', operationValue: 29000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    expect(out.variantOverrides.get('v1')?.basePrice).toBe(31000);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.pricing-judge.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```typescript
// form-export.pricing-judge.ts
import type { PricingRulesResponseDto } from '../../../core/pricing/dto';

type PricingRule = PricingRulesResponseDto['basePriceRules'][number];

export interface SimplePrices {
  basePrice: number | null;
  membershipPrice: number | null;
  /** variantId → 조합별 오버라이드. 값이 없는 축은 null 이다. */
  variantOverrides: Map<string, { basePrice: number | null; membershipPrice: number | null }>;
}

/**
 * 임포트가 표현할 수 있는 가격 룰의 부분집합인지 판정한다.
 *
 * 임포트는 layer ∈ {base_price, membership_price} × scopeType ∈ {all_variants, variants}
 * × operationType = override 만 만든다(form-export.pricing-judge 와 2단계 빌더가 같은
 * 집합을 쓴다). 그 밖의 룰이 걸린 상품을 프리필해 판매가 한 칸만 고쳐 올리면,
 * ReplacePricingRulesDto 가 **replace** 라 가격 체계가 통째로 뭉개진다.
 * 그래서 밖이면 워크북에 센티넬을 넣어 수정을 막는다.
 */
export function isPricingEditable(rules: PricingRulesResponseDto): boolean {
  if (rules.tieredPriceRules.length > 0) return false;

  const flat = [...rules.basePriceRules, ...rules.membershipPriceRules];
  return flat.every(
    (r) => r.operationType === 'override' && (r.scopeType === 'all_variants' || r.scopeType === 'variants'),
  );
}

/**
 * 표현 가능한 룰에서 워크북에 채울 숫자를 뽑는다.
 *
 * **`isPricingEditable` 이 true 인 룰셋에만 부른다.** false 인 룰셋에 부르면 조용히 무시되는
 * 게 아니라 **잘못된 값이 들어간다** — `with_option` 룰의 scopeTargetIds 는 variantId 가
 * 아니라 optionValueId 인데 variantOverrides 키로 쓰이고, operationType 을 보지 않으므로
 * offset·scale 의 피연산자가 확정 가격인 양 기록된다.
 */
export function extractSimplePrices(rules: PricingRulesResponseDto): SimplePrices {
  const out: SimplePrices = { basePrice: null, membershipPrice: null, variantOverrides: new Map() };

  const apply = (list: PricingRule[], axis: 'basePrice' | 'membershipPrice'): void => {
    // order 오름차순으로 훑는다. 계산기(pricing-calculator.service.ts:78-93)는 매칭되는
    // 룰마다 currentPrice 를 덮어쓰므로 뒤 룰이 이긴다.
    for (const r of [...list].sort((a, b) => a.order - b.order)) {
      if (r.scopeType === 'all_variants') {
        out[axis] = r.operationValue;
        // all_variants 는 **모든** variant 에 매칭되므로, 앞서 나온 variants 오버라이드까지
        // 이 룰이 덮는다. 그 값들을 지우지 않으면 계산기가 내는 실제 가격과 어긋난다
        // (order 1 variants=31000, order 2 all_variants=29000 이면 v1 의 실제가는 29000).
        // null 은 "조합별 오버라이드 없음" 이라 워크북이 칸을 비우고 기본가를 상속한다.
        for (const [variantId, prev] of out.variantOverrides) {
          out.variantOverrides.set(variantId, { ...prev, [axis]: null });
        }
        continue;
      }
      for (const variantId of r.scopeTargetIds ?? []) {
        const prev = out.variantOverrides.get(variantId) ?? { basePrice: null, membershipPrice: null };
        out.variantOverrides.set(variantId, { ...prev, [axis]: r.operationValue });
      }
    }
  };

  apply(rules.basePriceRules, 'basePrice');
  apply(rules.membershipPriceRules, 'membershipPrice');
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.pricing-judge.spec.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export.pricing-judge.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export.pricing-judge.spec.ts
git commit -m "feat(bulk-session): 가격 룰 표현 가능 판정 + 단순 가격 추출

tiered_price·with_option·offset·scale 이 하나라도 있으면 표현 불가다.
DTO 가 replace 라, 표현 못 하는 룰이 걸린 상품을 프리필해 한 칸 고쳐 올리면
가격 체계가 통째로 뭉개진다."
```

---

### Task 4: 워크북 조립

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.types.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `SHEET_NAMES`·`*_COLUMNS`·`labelsOf`
- Produces:
  - `form-export.types.ts`: `PrefillCell = string`, `PrefillRow = Record<string, string>`, `PrefillWorkbookData { exportId: string; products: PrefillRow[]; options: PrefillRow[]; variants: PrefillRow[]; categories: PrefillRow[]; constraints: PrefillRow[]; images: PrefillRow[]; categoryPaths: string[] }`
  - `form-export.workbook.ts`: `buildFormWorkbook(data: PrefillWorkbookData): Promise<Buffer>`, `readExportIdFromWorkbook(buf: Buffer): Promise<string | null>` (2단계 파서가 재사용한다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
// form-export.workbook.spec.ts
import * as ExcelJS from 'exceljs';
import { buildFormWorkbook, readExportIdFromWorkbook } from './form-export.workbook';
import { SHEET_NAMES, PRODUCT_COLUMNS, labelsOf } from './form-export.sheets';
import type { PrefillWorkbookData } from './form-export.types';

const data: PrefillWorkbookData = {
  exportId: '0193aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
  products: [{ rowKey: 'P-000001', name: '겨울 니트', basePrice: '29000', brand: 'ACME' }],
  options: [
    { rowKey: 'P-000001', optionKey: 'OG-1', optionName: '색상', optionValueKey: 'OV-1', optionValueName: '빨강' },
  ],
  variants: [{ rowKey: 'P-000001', combination: 'OV-1', combinationLabel: '색상=빨강', basePrice: '29000' }],
  categories: [{ rowKey: 'P-000001', categoryPath: '여성패션>니트', isPrimary: 'Y' }],
  constraints: [{ rowKey: 'P-000001', requiresMembership: 'N', lifetimeQuantityLimit: '2' }],
  images: [{ imageKey: 'IMG-1', sourceValue: '0193bbbb-cccc-7ddd-8eee-ffff00001111' }],
  categoryPaths: ['여성패션', '여성패션>니트', '기획전>겨울신상'],
};

async function load(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('buildFormWorkbook', () => {
  it('시트 8개를 순서대로 만든다 (보이는 7개 + 숨은 메타 1개)', async () => {
    const wb = await load(await buildFormWorkbook(data));
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      SHEET_NAMES.products,
      SHEET_NAMES.options,
      SHEET_NAMES.variants,
      SHEET_NAMES.categories,
      SHEET_NAMES.constraints,
      SHEET_NAMES.images,
      SHEET_NAMES.categoryReference,
      SHEET_NAMES.meta,
    ]);
  });

  it('상품 시트 헤더가 한국어 라벨이다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const header = wb.getWorksheet(SHEET_NAMES.products)!.getRow(1);
    const actual = labelsOf(PRODUCT_COLUMNS).map((_, i) => header.getCell(i + 1).text);
    expect(actual).toEqual(labelsOf(PRODUCT_COLUMNS));
  });

  it('필수 열 헤더만 볼드다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const header = wb.getWorksheet(SHEET_NAMES.products)!.getRow(1);
    PRODUCT_COLUMNS.forEach((col, i) => {
      expect(header.getCell(i + 1).font?.bold ?? false).toBe(col.required);
    });
  });

  it('프리필 값이 열 정의 순서대로 들어간다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const row = wb.getWorksheet(SHEET_NAMES.products)!.getRow(2);
    const keyIndex = (key: string): number => PRODUCT_COLUMNS.findIndex((c) => c.key === key) + 1;
    expect(row.getCell(keyIndex('rowKey')).text).toBe('P-000001');
    expect(row.getCell(keyIndex('name')).text).toBe('겨울 니트');
    expect(row.getCell(keyIndex('brand')).text).toBe('ACME');
  });

  it('값이 없는 열은 빈 문자열이다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const row = wb.getWorksheet(SHEET_NAMES.products)!.getRow(2);
    const idx = PRODUCT_COLUMNS.findIndex((c) => c.key === 'seoTitle') + 1;
    expect(row.getCell(idx).text).toBe('');
  });

  it('카테고리 참조 시트에 전체 경로가 들어가고 보호된다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    const ws = wb.getWorksheet(SHEET_NAMES.categoryReference)!;
    expect(ws.getRow(2).getCell(1).text).toBe('여성패션');
    expect(ws.getRow(4).getCell(1).text).toBe('기획전>겨울신상');
  });

  it('메타 시트는 숨겨져 있다', async () => {
    const wb = await load(await buildFormWorkbook(data));
    expect(wb.getWorksheet(SHEET_NAMES.meta)!.state).toBe('veryHidden');
  });

  it('exportId 를 다시 읽어낼 수 있다', async () => {
    const buf = await buildFormWorkbook(data);
    await expect(readExportIdFromWorkbook(buf)).resolves.toBe(data.exportId);
  });

  it('메타 시트가 없으면 null 을 돌려준다 — 신규 전용 세션으로 해석된다', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet(SHEET_NAMES.products).addRow(labelsOf(PRODUCT_COLUMNS));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(readExportIdFromWorkbook(buf)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 타입 파일을 만든다**

```typescript
// form-export.types.ts

/**
 * 워크북 한 행. 키는 ColumnDef.key 이고 값은 **항상 문자열**이다.
 * 숫자·날짜를 셀에 그대로 넣으면 exceljs 가 로케일·TZ 의존 서식으로 되돌려주므로
 * (cell.text 가 Date.prototype.toString() 이다) 조립 단계에서 규격 문자열로 굳힌다.
 */
export type PrefillRow = Record<string, string>;

export interface PrefillWorkbookData {
  exportId: string;
  products: PrefillRow[];
  options: PrefillRow[];
  variants: PrefillRow[];
  categories: PrefillRow[];
  constraints: PrefillRow[];
  images: PrefillRow[];
  /** 카테고리 참조 시트용. '여성패션>니트' 형태의 전체 경로 목록. */
  categoryPaths: string[];
}
```

- [ ] **Step 4: 워크북 빌더를 만든다**

```typescript
// form-export.workbook.ts
import * as ExcelJS from 'exceljs';
import {
  CATEGORY_COLUMNS,
  CATEGORY_REFERENCE_COLUMNS,
  CONSTRAINT_COLUMNS,
  ColumnDef,
  IMAGE_COLUMNS,
  OPTION_COLUMNS,
  PRODUCT_COLUMNS,
  SHEET_NAMES,
  VARIANT_COLUMNS,
  labelsOf,
} from './form-export.sheets';
import type { PrefillRow, PrefillWorkbookData } from './form-export.types';

const META_CELL = 'B1';

function addSheet(wb: ExcelJS.Workbook, name: string, columns: ColumnDef[], rows: PrefillRow[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  const header = ws.addRow(labelsOf(columns));
  columns.forEach((col, i) => {
    if (col.required) header.getCell(i + 1).font = { bold: true };
  });
  header.commit();

  for (const row of rows) {
    ws.addRow(columns.map((col) => row[col.key] ?? ''));
  }

  // 헤더가 항상 보이게 고정한다. 수십 열짜리 시트에서 작업자가 어느 칸인지 잃지 않는다.
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/**
 * 프리필 워크북을 만든다. 순수 함수다 — DB 도 네트워크도 타지 않으므로 단위 테스트가 싸고,
 * 헤더·볼드·값 배치를 실 Postgres 없이 전부 검증할 수 있다.
 */
export async function buildFormWorkbook(data: PrefillWorkbookData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  addSheet(wb, SHEET_NAMES.products, PRODUCT_COLUMNS, data.products);
  addSheet(wb, SHEET_NAMES.options, OPTION_COLUMNS, data.options);
  addSheet(wb, SHEET_NAMES.variants, VARIANT_COLUMNS, data.variants);
  addSheet(wb, SHEET_NAMES.categories, CATEGORY_COLUMNS, data.categories);
  addSheet(wb, SHEET_NAMES.constraints, CONSTRAINT_COLUMNS, data.constraints);
  addSheet(wb, SHEET_NAMES.images, IMAGE_COLUMNS, data.images);

  // 카테고리 참조는 **상수**다. 작업자가 고쳐도 파서가 읽지 않으므로 반영되지 않는다.
  // 시트 보호는 비밀번호 없이도 실수로 지우는 것을 한 번 막아준다(의도적 우회는 못 막지만,
  // 애초에 읽지 않으므로 우회해도 무해하다).
  const reference = addSheet(
    wb,
    SHEET_NAMES.categoryReference,
    CATEGORY_REFERENCE_COLUMNS,
    data.categoryPaths.map((categoryPath) => ({ categoryPath })),
  );
  await reference.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  // exportId 는 숨은 시트에 둔다. 스펙의 "숨은 열"을 시트로 구현한 것으로, 열은 정렬·삭제로
  // 쉽게 유실되지만 시트는 훨씬 덜 건드려진다. 유실되면 2단계가 신규 전용 세션으로 해석한다.
  const meta = wb.addWorksheet(SHEET_NAMES.meta);
  meta.getCell('A1').value = 'exportId';
  meta.getCell(META_CELL).value = data.exportId;
  meta.state = 'veryHidden';

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 업로드된 워크북에서 exportId 를 되읽는다. 없으면 null — 신규 전용 세션이다. */
export async function readExportIdFromWorkbook(buf: Buffer): Promise<string | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const meta = wb.getWorksheet(SHEET_NAMES.meta);
  if (!meta) return null;
  const value = meta.getCell(META_CELL).text.trim();
  return value.length > 0 ? value : null;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export.types.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export.workbook.spec.ts
git commit -m "feat(bulk-session): 프리필 워크북 조립 (순수)

셀 값은 항상 문자열로 굳힌다 — 숫자·날짜를 그대로 넣으면 exceljs 가 로케일·TZ
의존 서식으로 되돌려준다. exportId 는 숨은 시트에 두고, 유실되면 2단계가
신규 전용 세션으로 해석한다."
```

---

### Task 5: 스냅샷 리더

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.snapshot.reader.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-snapshot.integration.spec.ts`

**Interfaces:**
- Consumes: `ProductVersionReadLoader`(`getActiveVersion`, `getCategories`, `getVariants`, `getImages`, `getPurchaseConstraint`), `OptionReadLoader`(`getOptionGroups`, `getVariantOptionValues`), `PricingService.getVersionRules`, `ProductCategoriesService.getCategoryTree`, Task 3 의 `isPricingEditable`·`extractSimplePrices`, Task 4 의 `PrefillWorkbookData`
- Produces: `FormExportSnapshotReader.buildPrefill(tx, masterIds, exportId): Promise<{ data: PrefillWorkbookData; items: SnapshotItem[] }>` where `SnapshotItem = { masterId: string; versionId: string; rowKey: string; pricingEditable: boolean }`

- [ ] **Step 1: 리더를 구현한다**

이 태스크는 기존 로더 조합이 본체라 단위 테스트가 목 덩어리가 된다. 실 Postgres 통합 테스트를 먼저 쓰는 대신 구현을 먼저 두고 Step 3 에서 통합 테스트로 못 박는다.

```typescript
// form-export.snapshot.reader.ts
import { Injectable } from '@nestjs/common';
import { DbTransaction } from '../../../catalog.types';
import { ProductVersionReadLoader } from '../../../core/products/loaders/product-version-read.loader';
import { OptionReadLoader } from '../../../core/products/loaders/option-read.loader';
import { PricingService } from '../../../core/pricing/pricing.service';
import { ProductCategoriesService } from '../../../core/categories/categories.service';
import { extractSimplePrices, isPricingEditable } from './form-export.pricing-judge';
import { PRICING_SENTINEL } from './form-export.sheets';
import type { PrefillRow, PrefillWorkbookData } from './form-export.types';

const LOCALE = 'ko-KR';

export interface SnapshotItem {
  masterId: string;
  versionId: string;
  rowKey: string;
  pricingEditable: boolean;
}

/** 불리언 셀 표기. 파서(2단계)와 반드시 같은 규약을 쓴다. */
const yn = (value: boolean | null | undefined): string => (value ? 'Y' : 'N');
const str = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

@Injectable()
export class FormExportSnapshotReader {
  constructor(
    private readonly versionLoader: ProductVersionReadLoader,
    private readonly optionLoader: OptionReadLoader,
    private readonly pricing: PricingService,
    private readonly categories: ProductCategoriesService,
  ) {}

  /**
   * masterId 목록의 현재 active 버전을 읽어 워크북 데이터와 스냅샷 항목을 만든다.
   *
   * active 버전을 못 찾는 상품은 **조용히 건너뛴다** — 잡 접수와 조립 사이에 상품이
   * 지워지거나 draft 만 남는 경우가 있고, 그 하나 때문에 수천 건 잡이 실패하는 편이 나쁘다.
   * 건너뛴 수는 productCount 와 요청 수의 차이로 드러난다.
   */
  async buildPrefill(
    tx: DbTransaction,
    masterIds: string[],
    exportId: string,
  ): Promise<{ data: PrefillWorkbookData; items: SnapshotItem[] }> {
    const products: PrefillRow[] = [];
    const options: PrefillRow[] = [];
    const variants: PrefillRow[] = [];
    const categories: PrefillRow[] = [];
    const constraints: PrefillRow[] = [];
    const images: PrefillRow[] = [];
    const items: SnapshotItem[] = [];

    let seq = 0;
    for (const masterId of masterIds) {
      const version = await this.versionLoader.getActiveVersion(tx, masterId).catch(() => null);
      if (!version) continue;

      seq += 1;
      const rowKey = `P-${String(seq).padStart(6, '0')}`;

      const rules = await this.pricing.getVersionRules(version.id, tx);
      const pricingEditable = isPricingEditable(rules);
      const prices = pricingEditable
        ? extractSimplePrices(rules)
        : { basePrice: null, membershipPrice: null, variantOverrides: new Map() };

      const imageKeyByFileId = new Map<string, string>();
      const imageKeyFor = (fileId: string): string => {
        const existing = imageKeyByFileId.get(fileId);
        if (existing) return existing;
        const key = `IMG-${imageKeyByFileId.size + 1}`;
        imageKeyByFileId.set(fileId, key);
        images.push({ imageKey: key, sourceValue: fileId });
        return key;
      };

      const versionImages = await this.versionLoader.getImages(tx, version.id);
      const additional = versionImages.map((img) => imageKeyFor(img.fileId));

      products.push({
        rowKey,
        name: str(version.name),
        basePrice: pricingEditable ? str(prices.basePrice) : PRICING_SENTINEL,
        membershipPrice: pricingEditable ? str(prices.membershipPrice) : PRICING_SENTINEL,
        productCode: str(version.productCode),
        brand: str(version.brand),
        thumbnailImageKey: version.thumbnail ? imageKeyFor(version.thumbnail) : '',
        additionalImageKeys: additional.join('|'),
        description: str(version.description),
        alternativeName: str(version.alternativeName),
        material: str(version.material),
        marketPrice: str(version.marketPrice),
        supplyPrice: str(version.supplyPrice),
        productType: str(version.productType),
        fulfillmentKind: str(version.fulfillmentKind),
        salesClassification: str(version.salesClassification),
        purchaseClassification: str(version.purchaseClassification),
        ageRestriction: str(version.ageRestriction),
        minQuantity: str(version.minQuantity),
        maxQuantity: str(version.maxQuantity),
        seller: '',
        isOverseas: yn(version.isOverseas),
        isVisibleToMembersOnly: yn(version.isVisibleToMembersOnly),
        hideMembershipPriceForNonMembers: yn(version.hideMembershipPriceForNonMembers),
        isWholesaleOnly: yn(version.isWholesaleOnly),
        seoTitle: str(version.seoTitle),
        seoDescription: str(version.seoDescription),
        seoKeywords: (version.seoKeywords ?? []).join('|'),
        salesStartDate: formatKstDate(version.salesStartDate),
        salesEndDate: formatKstDate(version.salesEndDate),
      });

      const groups = await this.optionLoader.getOptionGroups(tx, masterId, version.id, LOCALE);
      for (const group of groups) {
        for (const value of group.values) {
          options.push({
            rowKey,
            optionKey: group.id,
            optionName: str(group.displayName),
            optionSortOrder: str(group.sortOrder),
            optionValueKey: value.id,
            optionValueName: str(value.displayName),
            colorCode: '',
            valueSortOrder: str(value.sortOrder),
          });
        }
      }

      const versionVariants = await this.versionLoader.getVariants(tx, masterId, version.id);
      for (const variant of versionVariants) {
        const optionValues = await this.optionLoader.getVariantOptionValues(tx, variant.id, version.id, LOCALE);
        const override = prices.variantOverrides.get(variant.id);
        variants.push({
          rowKey,
          // 조합 참조는 **이름이 아니라 optionValueId 결합**이다. 이름으로 쓰면 옵션값
          // displayName 을 바꾸는 순간 참조가 깨진다. 정렬해서 축 순서에 무관하게 만든다.
          combination: optionValues
            .map((ov) => ov.id)
            .sort()
            .join('+'),
          combinationLabel: optionValues.map((ov) => `${ov.optionGroupName}=${ov.displayName}`).join(';'),
          basePrice: pricingEditable ? str(override?.basePrice) : PRICING_SENTINEL,
          membershipPrice: pricingEditable ? str(override?.membershipPrice) : PRICING_SENTINEL,
          variantCode: str(variant.variantCode),
        });
      }

      const versionCategories = await this.versionLoader.getCategories(tx, masterId, version.id);
      for (const category of versionCategories) {
        categories.push({
          rowKey,
          categoryPath: category.path,
          isPrimary: yn(category.isPrimary),
        });
      }

      const constraint = await this.versionLoader.getPurchaseConstraint(tx, masterId, version.id);
      if (constraint) {
        constraints.push({
          rowKey,
          requiresMembership: yn(constraint.requiresMembership),
          lifetimeQuantityLimit: str(constraint.lifetimeQuantityLimit),
        });
      }

      items.push({ masterId, versionId: version.id, rowKey, pricingEditable });
    }

    const tree = await this.categories.getCategoryTree(undefined, false, tx);
    const categoryPaths = flattenCategoryPaths(tree);

    return {
      data: { exportId, products, options, variants, categories, constraints, images, categoryPaths },
      items,
    };
  }
}

/**
 * 판매기간을 KST 'YYYY-MM-DD HH:mm' 로 굳힌다. 파서가 받는 두 형식 중 하나다.
 * `toISOString()` 을 그대로 쓰면 UTC 가 되어 KST 경계 해석과 9시간 어긋난다.
 */
function formatKstDate(value: Date | null): string {
  if (!value) return '';
  const kst = new Date(value.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ` +
    `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
  );
}

interface CategoryNodeLike {
  name: string;
  children?: CategoryNodeLike[];
}

/** 트리를 '조상>자식' 경로 문자열 목록으로 평탄화한다. 파서의 categoryPath 규약과 같다. */
function flattenCategoryPaths(tree: { categories?: CategoryNodeLike[] } | CategoryNodeLike[]): string[] {
  const roots = Array.isArray(tree) ? tree : (tree.categories ?? []);
  const out: string[] = [];
  const walk = (node: CategoryNodeLike, prefix: string): void => {
    const path = prefix ? `${prefix}>${node.name}` : node.name;
    out.push(path);
    for (const child of node.children ?? []) walk(child, path);
  };
  for (const root of roots) walk(root, '');
  return out;
}
```

**주의:** `getCategories`·`getImages`·`getPurchaseConstraint`·`getVariants` 의 실제 반환 필드명(`path`, `isPrimary`, `fileId`, `requiresMembership`, `lifetimeQuantityLimit`)과 `getCategoryTree` 의 실제 반환 모양을 **구현 시점에 파일을 열어 확인**한다. 다르면 위 매핑을 그에 맞춰 고친다 — 이 태스크는 기존 로더의 계약에 붙는 어댑터다.

- [ ] **Step 2: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0. 필드명이 틀렸으면 여기서 잡힌다.

- [ ] **Step 3: 실 Postgres 통합 테스트를 쓴다**

`product-import-payload-roundtrip.integration.spec.ts` 의 부팅 방식을 그대로 따른다(환경변수 가드 + 실 `DATABASE_URL`). 테스트는 상품 하나를 만들고 프리필을 읽어 다음을 단정한다.

```typescript
// form-export-snapshot.integration.spec.ts (핵심 단정만 발췌 — 픽스처 구성은 선례를 따른다)
describe('FormExportSnapshotReader (실 Postgres)', () => {
  it('active 버전의 스칼라를 워크북 행으로 옮긴다', async () => {
    const { data } = await reader.buildPrefill(tx, [masterId], exportId);
    expect(data.products).toHaveLength(1);
    expect(data.products[0].name).toBe('겨울 니트');
    expect(data.products[0].rowKey).toBe('P-000001');
  });

  it('조합 참조가 optionValueId 정렬 결합이다 — 이름이 아니다', async () => {
    const { data } = await reader.buildPrefill(tx, [masterId], exportId);
    const combo = data.variants[0].combination;
    expect(combo).toMatch(/^[0-9a-f-]{36}(\+[0-9a-f-]{36})*$/);
    expect(combo.split('+')).toEqual([...combo.split('+')].sort());
  });

  it('복합 가격규칙 상품은 가격 칸이 센티넬이고 pricingEditable 이 false 다', async () => {
    await givenTieredPricingRule(masterId, versionId);
    const { data, items } = await reader.buildPrefill(tx, [masterId], exportId);
    expect(data.products[0].basePrice).toBe('[복합 가격규칙]');
    expect(items[0].pricingEditable).toBe(false);
  });

  it('active 버전이 없는 masterId 는 건너뛴다 — 잡 전체를 실패시키지 않는다', async () => {
    const { data, items } = await reader.buildPrefill(tx, [masterId, randomUUID()], exportId);
    expect(data.products).toHaveLength(1);
    expect(items).toHaveLength(1);
  });
});
```

`package.json` 에 스크립트를 더한다:

```json
"test:form-export:integration": "REQUIRE_FORM_EXPORT_DB=1 dotenv -e apps/core/.env -- jest --testPathPattern=form-export-snapshot.integration"
```

- [ ] **Step 4: 통합 테스트 실행**

Run: `npm run test:form-export:integration`
Expected: PASS. 로컬 core DB 에 Task 1 마이그레이션이 적용돼 있어야 한다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export.snapshot.reader.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-snapshot.integration.spec.ts \
        package.json
git commit -m "feat(bulk-session): 프리필 스냅샷 리더

조합 참조를 optionValueId 정렬 결합으로 쓴다 — 이름으로 쓰면 옵션값 displayName 을
바꾸는 순간 참조가 깨진다. 복합 가격규칙 상품은 센티넬을 넣고 pricingEditable=false 로
얼린다. active 버전 없는 상품은 건너뛴다(잡 전체를 죽이지 않는다)."
```

---

### Task 6: file-service 컨텍스트와 업로드 클라이언트

**Files:**
- Modify: `apps/file-service/src/database/default-file-contexts.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (`FILE_SERVICE_URL`, `AUTH_SECRET`)
- Produces: `FormExportFileClient.upload(input: { buffer: Buffer; fileName: string; userId: string }): Promise<{ fileId: string }>`, `FormExportFileClient.getDownloadUrl(fileId: string, userId: string): Promise<string>`, `BULK_FORM_CONTEXT_ID`

- [ ] **Step 1: file-service 에 컨텍스트를 추가한다**

`FILE_CONTEXTS` 배열에 항목을 더한다(기존 항목과 같은 모양).

```typescript
  {
    id: 'product-bulk-form',
    name: 'Product Bulk Form',
    description: '상품 일괄 등록/수정 양식 워크북(xlsx)',
    allowPublic: false,
    allowPrivate: true,
    allowedMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    maxFileSize: 52428800,
    pathPrefix: 'products/bulk-forms',
    isActive: true,
  },
```

50MB 로 잡는 이유: 수천 행 × 7시트를 담을 여유. 업로드 워크북(2단계)도 같은 컨텍스트를 쓴다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`product-import-file.client.spec.ts` 의 `global.fetch` 스텁 방식을 그대로 따른다.

```typescript
// form-export-file.client.spec.ts
import { FormExportFileClient, BULK_FORM_CONTEXT_ID } from './form-export-file.client';

describe('FormExportFileClient', () => {
  const config = {
    get: (k: string) => ({ FILE_SERVICE_URL: 'http://file-service', AUTH_SECRET: 'secret' })[k],
  } as never;

  afterEach(() => jest.restoreAllMocks());

  it('올바른 컨텍스트로 업로드하고 fileId 를 돌려준다', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '0193cccc-dddd-7eee-8fff-000011112222' }),
    });
    global.fetch = fetchMock as never;

    const client = new FormExportFileClient(config);
    const out = await client.upload({ buffer: Buffer.from('x'), fileName: 'form.xlsx', userId: 'u1' });

    expect(out.fileId).toBe('0193cccc-dddd-7eee-8fff-000011112222');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://file-service/files/upload');
    expect((init.body as FormData).get('contextId')).toBe(BULK_FORM_CONTEXT_ID);
  });

  it('실패 응답의 본문을 200자로 잘라 메시지에 담는다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 413,
      text: async () => 'E'.repeat(500),
    }) as never;

    const client = new FormExportFileClient(config);
    await expect(
      client.upload({ buffer: Buffer.from('x'), fileName: 'form.xlsx', userId: 'u1' }),
    ).rejects.toThrow(/413/);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 클라이언트를 구현한다**

```typescript
// form-export-file.client.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign as jwtSign } from 'jsonwebtoken';

export const BULK_FORM_CONTEXT_ID = 'product-bulk-form';
const MAX_ERROR_BODY_CHARS = 200;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 양식 워크북을 file-service 에 올린다.
 *
 * 기존 library FileServiceClient(다운로드 위임 전용)와 분리한 이유는 토큰 클레임이
 * 다르기 때문이다 — uploads.uploaded_by 가 NOT NULL uuid 인데 서비스 토큰에는 sub 만
 * 있어, 요청자 userId 를 클레임에 실어야 업로드가 죽지 않는다.
 */
@Injectable()
export class FormExportFileClient {
  private readonly logger = new Logger(FormExportFileClient.name);

  constructor(private readonly config: ConfigService) {}

  private token(userId: string): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) throw new Error('AUTH_SECRET 이 없어 file-service 토큰을 발급할 수 없습니다');
    return jwtSign({ sub: 'core-bulk-session', userId, scopes: ['master'] }, secret, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('FILE_SERVICE_URL');
    if (!url) throw new Error('FILE_SERVICE_URL 이 설정되지 않았습니다');
    return url.replace(/\/$/, '');
  }

  async upload(input: { buffer: Buffer; fileName: string; userId: string }): Promise<{ fileId: string }> {
    const form = new FormData();
    form.append('file', new Blob([input.buffer], { type: XLSX_MIME }), input.fileName);
    form.append('contextId', BULK_FORM_CONTEXT_ID);

    // Content-Type 을 직접 세팅하지 않는다 — FormData 를 넘기면 undici 가 boundary 를
    // 포함해 알아서 붙인다. 손으로 붙이면 boundary 가 빠져 서버가 파싱에 실패한다.
    const res = await fetch(`${this.baseUrl}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token(input.userId)}` },
      body: form,
    });

    if (!res.ok) throw new Error(await this.describeFailure('업로드', res));

    const json: unknown = await res.json();
    const fileId = this.extractFileId(json);
    if (!fileId) throw new Error('file-service 응답에 fileId 가 없습니다');
    return { fileId };
  }

  async getDownloadUrl(fileId: string, userId: string): Promise<string> {
    // 실측 경로다 — file-service 는 `/download-url` 이 아니라 `/download` 이고,
    // 응답 필드는 `signedUrl` 이다 (download.controller.ts + signed-url-response.dto.ts).
    const res = await fetch(`${this.baseUrl}/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${this.token(userId)}` },
    });
    if (!res.ok) throw new Error(await this.describeFailure('다운로드 URL 발급', res));
    const json: unknown = await res.json();
    const url = this.extractSignedUrl(json);
    if (!url) throw new Error('file-service 응답에 다운로드 URL 이 없습니다');
    return url;
  }

  /** file-service 원문 JSON 이 관리자 화면까지 새지 않게 자른다. */
  private async describeFailure(action: string, res: Response): Promise<string> {
    let body = '';
    try {
      body = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
    } catch {
      body = '(본문 없음)';
    }
    this.logger.warn(`file-service ${action} 실패 ${res.status}: ${body}`);
    return `file-service ${action} 실패 (${res.status})`;
  }
}
```

**실측 확인 완료 (2026-08-01):** 업로드는 `POST /files/upload`, 멀티파트 필드 `file`·`contextId`, 응답 `{ id }` — 위 코드와 일치한다. 다운로드는 **`GET /files/:fileId/download`** 이고 응답이 **`{ signedUrl, expiresAt }`** 다. `/download-url` 과 `url`/`downloadUrl` 은 file-service 에 존재하지 않는다.

응답 파싱에 `as` 캐스팅을 쓰지 않는다 — `res.json()` 의 `unknown` 을 `in` 연산자 narrowing 으로 좁히는 private 헬퍼 둘을 둔다(`product-import-file.client.ts:111-116` 과 같은 패턴).

```typescript
  private extractFileId(json: unknown): string | null {
    if (typeof json === 'object' && json !== null && 'id' in json && typeof json.id === 'string') return json.id;
    if (typeof json === 'object' && json !== null && 'fileId' in json && typeof json.fileId === 'string') {
      return json.fileId;
    }
    return null;
  }

  private extractSignedUrl(json: unknown): string | null {
    if (typeof json === 'object' && json !== null && 'signedUrl' in json && typeof json.signedUrl === 'string') {
      return json.signedUrl;
    }
    return null;
  }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: 커밋**

```bash
git add apps/file-service/src/database/default-file-contexts.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-file.client.spec.ts
git commit -m "feat(bulk-session): 양식 워크북 file-service 컨텍스트 + 업로드 클라이언트

uploads.uploaded_by 가 NOT NULL uuid 라 요청자 userId 를 토큰 클레임에 실어야 한다.
컨텍스트 추가는 배포 후 db:seed:ref 를 돌려야 반영된다."
```

---

### Task 7: 접수·조회 매니저와 컨트롤러

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/dto/create-form-export.dto.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/dto/form-export-response.dto.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/dto/index.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.service.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/form-export.controller.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/bulk-session.module.ts`
- Modify: `apps/core/src/modules/catalog/catalog.module.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts`

**Interfaces:**
- Consumes: Task 1 테이블, Task 6 `FormExportFileClient.getDownloadUrl`
- Produces: `FormExportManager.accept(masterIds, userId, tx?)`, `FormExportManager.getStatus(exportId, tx?)`, `FormExportService.request(...)`, `FormExportService.getStatus(...)`, `FormExportService.getDownloadUrl(...)`

- [ ] **Step 1: DTO 를 만든다**

```typescript
// dto/create-form-export.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** 한 양식이 담을 수 있는 상품 수 상한. 워크북 파일 크기와 조립 시간의 실용 상한이다. */
export const MAX_FORM_EXPORT_PRODUCTS = 5000;

export class CreateFormExportDto {
  @ApiProperty({ description: '양식에 프리필할 상품 masterId 목록', type: [String] })
  @IsArray()
  @ArrayNotEmpty({ message: '상품을 한 개 이상 선택해 주세요.' })
  @ArrayMaxSize(MAX_FORM_EXPORT_PRODUCTS, {
    message: `한 번에 최대 ${MAX_FORM_EXPORT_PRODUCTS}개까지 선택할 수 있습니다.`,
  })
  @IsUUID('all', { each: true })
  masterIds: string[];
}
```

```typescript
// dto/form-export-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class FormExportAcceptedDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued'] }) status: 'queued';
  @ApiProperty({ description: '요청한 상품 수' }) requestedCount: number;
}

export class FormExportStatusDto {
  @ApiProperty() exportId: string;
  @ApiProperty({ enum: ['queued', 'running', 'completed', 'failed'] })
  status: 'queued' | 'running' | 'completed' | 'failed';
  @ApiProperty({ description: '실제로 프리필된 상품 수. active 버전이 없는 상품은 빠진다' })
  productCount: number;
  @ApiProperty({ required: false, nullable: true }) errorMessage: string | null;
  @ApiProperty({ description: '완료 시에만 true' }) downloadable: boolean;
  @ApiProperty() expiresAt: string;
}

export class FormExportDownloadDto {
  @ApiProperty() url: string;
}
```

```typescript
// dto/index.ts
export * from './create-form-export.dto';
export * from './form-export-response.dto';
```

- [ ] **Step 2: 매니저 테스트를 쓴다**

```typescript
// form-export.manager.spec.ts
import { FormExportManager, FORM_EXPORT_TTL_DAYS } from './form-export.manager';
import { NotFoundError } from '@app/shared';

describe('FormExportManager.accept', () => {
  it('중복 masterId 를 제거하고 요청 수를 돌려준다', async () => {
    const inserted: unknown[] = [];
    const db = fakeDb({ onInsert: (rows) => inserted.push(rows) });
    const manager = new FormExportManager(db, {} as never);

    const out = await manager.accept(['m1', 'm1', 'm2'], 'u1');

    expect(out.requestedCount).toBe(2);
    expect(out.status).toBe('queued');
  });

  it('만료시각을 30일 뒤로 잡는다', async () => {
    let captured: { expiresAt: Date } | null = null;
    const db = fakeDb({ onInsertExport: (row) => (captured = row) });
    const manager = new FormExportManager(db, {} as never);

    await manager.accept(['m1'], 'u1');

    const days = (captured!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(FORM_EXPORT_TTL_DAYS);
  });

  it('없는 exportId 조회는 NotFoundError 다', async () => {
    const manager = new FormExportManager(fakeDb({ exportRow: null }), {} as never);
    await expect(manager.getStatus('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('완료가 아니면 downloadable 이 false 다', async () => {
    const manager = new FormExportManager(
      fakeDb({ exportRow: { id: 'e1', status: 'running', productCount: 0, errorMessage: null, expiresAt: new Date() } }),
      {} as never,
    );
    await expect(manager.getStatus('e1')).resolves.toMatchObject({ downloadable: false });
  });
});
```

`fakeDb` 는 `product-import.manager.spec.ts` 의 기존 페이크 헬퍼 모양을 따른다 — `run(cb)` 가 콜백에 스텁 trx 를 넘기고, `select/insert/update` 체인이 미리 정한 값을 돌려주는 형태다.

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export.manager.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 매니저를 구현한다**

```typescript
// form-export.manager.ts
import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { eq, lt } from 'drizzle-orm';
import { type PimSchema, productFormExports } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportFileClient } from './form-export-file.client';
import { FormExportAcceptedDto, FormExportStatusDto } from '../dto';

export const FORM_EXPORT_TTL_DAYS = 30;

@Injectable()
export class FormExportManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly fileClient: FormExportFileClient,
  ) {}

  /**
   * 양식 생성을 접수한다. 조립은 워커가 이어받는다 — 수천 건이면 ALB 60초 안에 못 끝낸다.
   * 스냅샷 항목은 이 시점이 아니라 조립 시점에 만든다. 접수와 조립 사이에 active 가
   * 바뀔 수 있고, 워크북에 실제로 담긴 버전과 스냅샷이 어긋나면 안 되기 때문이다.
   */
  async accept(masterIds: string[], userId: string, tx?: DbTransaction): Promise<FormExportAcceptedDto> {
    const unique = [...new Set(masterIds)];

    return this.db.run(async (trx) => {
      const expiresAt = new Date(Date.now() + FORM_EXPORT_TTL_DAYS * 86_400_000);
      const [row] = await trx
        .insert(productFormExports)
        .values({
          requestedBy: userId,
          requestedMasterIds: unique,
          status: 'queued',
          productCount: 0,
          expiresAt,
        })
        .returning();
      if (!row) throw new Error('양식 생성 잡을 만들지 못했습니다');

      // items 는 여기서 만들지 않는다 — 조립 시점에 실제 active 를 확인한 것만 담긴다.
      return { exportId: row.id, status: 'queued' as const, requestedCount: unique.length };
    }, tx);
  }

  async getStatus(exportId: string, tx?: DbTransaction): Promise<FormExportStatusDto> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select()
        .from(productFormExports)
        .where(eq(productFormExports.id, exportId))
        .limit(1);
      if (!row) throw new NotFoundError(`양식 생성 잡을 찾을 수 없습니다: ${exportId}`);

      return {
        exportId: row.id,
        status: row.status,
        productCount: row.productCount,
        errorMessage: row.errorMessage,
        downloadable: row.status === 'completed' && row.fileId !== null,
        expiresAt: row.expiresAt.toISOString(),
      };
    }, tx);
  }

  async getDownloadUrl(exportId: string, userId: string, tx?: DbTransaction): Promise<string> {
    const fileId = await this.db.run(async (trx) => {
      const [row] = await trx
        .select({ fileId: productFormExports.fileId, status: productFormExports.status })
        .from(productFormExports)
        .where(eq(productFormExports.id, exportId))
        .limit(1);
      if (!row) throw new NotFoundError(`양식 생성 잡을 찾을 수 없습니다: ${exportId}`);
      if (row.status !== 'completed' || !row.fileId) {
        throw new NotFoundError('양식이 아직 준비되지 않았습니다');
      }
      return row.fileId;
    }, tx);

    return this.fileClient.getDownloadUrl(fileId, userId);
  }

  /** 만료된 잡을 지운다. items 는 FK cascade 로 함께 사라진다. */
  async purgeExpired(now: Date, tx?: DbTransaction): Promise<number> {
    return this.db.run(async (trx) => {
      const rows = await trx
        .delete(productFormExports)
        .where(lt(productFormExports.expiresAt, now))
        .returning({ id: productFormExports.id });
      return rows.length;
    }, tx);
  }
}
```

`productFormExportItems` 를 임포트하지 않는 것에 주의한다 — 이 매니저는 items 를 만들지 않는다. items 를 쓰는 곳은 Task 8 의 조립 한 곳뿐이다.

- [ ] **Step 5: 서비스·컨트롤러·모듈을 만든다**

```typescript
// services/form-export.service.ts
import { Injectable } from '@nestjs/common';
import { FormExportManager } from './form-export.manager';
import { FormExportAcceptedDto, FormExportStatusDto } from '../dto';

/** 포트. 흐름만 표현하고 검증·DB 는 매니저가 든다. */
@Injectable()
export class FormExportService {
  constructor(private readonly manager: FormExportManager) {}

  request(masterIds: string[], userId: string): Promise<FormExportAcceptedDto> {
    return this.manager.accept(masterIds, userId);
  }

  getStatus(exportId: string): Promise<FormExportStatusDto> {
    return this.manager.getStatus(exportId);
  }

  getDownloadUrl(exportId: string, userId: string): Promise<string> {
    return this.manager.getDownloadUrl(exportId, userId);
  }
}
```

```typescript
// form-export.controller.ts
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { FormExportService } from './services/form-export.service';
import {
  CreateFormExportDto,
  FormExportAcceptedDto,
  FormExportDownloadDto,
  FormExportStatusDto,
} from './dto';

@ApiTags('Product Bulk Form')
@Controller('product-forms')
export class FormExportController {
  constructor(private readonly service: FormExportService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: '양식 생성 접수. 조립은 워커가 이어받는다.' })
  @ApiResponse({ status: 202, type: FormExportAcceptedDto })
  async create(
    @Body() dto: CreateFormExportDto,
    @User() user: { userId: string },
  ): Promise<FormExportAcceptedDto> {
    return this.service.request(dto.masterIds, user.userId);
  }

  @Get(':exportId')
  @ApiOperation({ summary: '양식 생성 상태 조회(폴링 대상)' })
  @ApiResponse({ status: 200, type: FormExportStatusDto })
  async getStatus(@Param('exportId') exportId: string): Promise<FormExportStatusDto> {
    return this.service.getStatus(exportId);
  }

  @Get(':exportId/download-url')
  @ApiOperation({ summary: '완성된 양식의 다운로드 URL' })
  @ApiResponse({ status: 200, type: FormExportDownloadDto })
  async getDownloadUrl(
    @Param('exportId') exportId: string,
    @User() user: { userId: string },
  ): Promise<FormExportDownloadDto> {
    return { url: await this.service.getDownloadUrl(exportId, user.userId) };
  }
}
```

```typescript
// bulk-session.module.ts
import { Module } from '@nestjs/common';
import { FormExportController } from './form-export.controller';
import { FormExportService } from './services/form-export.service';
import { FormExportManager } from './services/form-export.manager';
import { FormExportSnapshotReader } from './services/form-export.snapshot.reader';
import { FormExportFileClient } from './services/form-export-file.client';
import { FormExportJobManager } from './services/form-export-job.manager';
import { FormExportJobWorker } from './services/form-export-job.worker';
import { ProductsModule } from '../../core/products/products.module';
import { PricingModule } from '../../core/pricing/pricing.module';
// 실측: 클래스명은 CategoriesModule 이다 (ProductCategoriesModule 은 존재하지 않는다).
import { CategoriesModule } from '../../core/categories/categories.module';

@Module({
  imports: [ProductsModule, PricingModule, CategoriesModule],
  controllers: [FormExportController],
  providers: [
    FormExportService,
    FormExportManager,
    FormExportSnapshotReader,
    FormExportFileClient,
    FormExportJobManager,
    FormExportJobWorker,
  ],
  exports: [FormExportService],
})
export class BulkSessionModule {}
```

`catalog.module.ts` 의 `imports` 에 `BulkSessionModule` 을 더한다. 카테고리 모듈의 실제 클래스명은 `categories.module.ts` 에서 확인해 맞춘다.

- [ ] **Step 6: 테스트와 타입 게이트**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/`
Expected: PASS

Run: `npm run type-check:scoped`
Expected: exit 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/ apps/core/src/modules/catalog/catalog.module.ts
git commit -m "feat(bulk-session): 양식 생성 접수 202 + 상태 조회 + 다운로드 URL

스냅샷 항목은 접수가 아니라 조립 시점에 만든다 — 그 사이 active 가 바뀔 수 있고,
워크북에 실제로 담긴 버전과 스냅샷이 어긋나면 안 된다."
```

---

### Task 8: 잡 워커

**Files:**
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.ts`
- Create: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.worker.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.spec.ts`
- Test: `apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job-lease.integration.spec.ts`

**Interfaces:**
- Consumes: Task 5 `FormExportSnapshotReader.buildPrefill`, Task 4 `buildFormWorkbook`, Task 6 `FormExportFileClient.upload`
- Produces: `FormExportJobManager.claim(): Promise<ClaimedExport | null>` (`{ exportId, leaseToken }`), `runExport(claimed)`, `recordJobError(exportId, message)`, `clearConsecutiveFailures(exportId)`, `MAX_CONSECUTIVE_EXPORT_FAILURES`

- [ ] **Step 1: 잡 매니저를 구현한다**

claim 쿼리는 `product-import-job.manager.ts:148-192` 의 것을 **컬럼만 바꿔** 가져온다. 알고리즘을 바꾸지 않는다 — lease 소유권은 이 레포에서 목이 초록인 채 세 번 깨졌고, 그때 얻은 결론이 "만료시각은 DB 시계가 만들고 소유권은 uuid 등호로 본다" 이다.

```typescript
// form-export-job.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDb, DbService } from '@app/db';
import { and, eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type PimSchema, productFormExports, productFormExportItems } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';
import { FormExportSnapshotReader } from './form-export.snapshot.reader';
import { FormExportFileClient } from './form-export-file.client';
import { buildFormWorkbook } from './form-export.workbook';

export const DEFAULT_EXPORT_LEASE_MS = 300_000;
/**
 * 상한에 닿으면 잡을 failed 로 확정한다. 실제 소요는 상한 × lease 만료(5분)다 —
 * recordJobError 가 lease 를 의도적으로 안 지우므로 재시도 주기가 틱이 아니라 lease 다.
 * 조립은 임포트 슬라이스보다 훨씬 길어 lease 를 5분으로 잡았고, 그래서 상한을 3으로 낮춘다.
 */
export const MAX_CONSECUTIVE_EXPORT_FAILURES = 3;

export interface ClaimedExport {
  exportId: string;
  leaseToken: string;
}

@Injectable()
export class FormExportJobManager {
  private readonly logger = new Logger(FormExportJobManager.name);

  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly snapshot: FormExportSnapshotReader,
    private readonly fileClient: FormExportFileClient,
    private readonly config: ConfigService,
  ) {}

  private get leaseMs(): number {
    const raw = Number.parseInt(this.config.get<string>('FORM_EXPORT_LEASE_MS') ?? '', 10);
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_EXPORT_LEASE_MS;
  }

  /**
   * 대기 잡 하나를 원자적으로 잡는다. lease 를 미래로 밀어 두므로 롤링 배포로 태스크가
   * 잠시 둘이어도 같은 잡을 겹쳐 조립하지 않는다. running 을 다시 잡는 것은 재개 경로다 —
   * lease 가 만료됐다는 건 처리하던 프로세스가 죽었다는 뜻이다.
   */
  async claim(tx?: DbTransaction): Promise<ClaimedExport | null> {
    const leaseToken = uuidv7();
    return this.db.run(async (trx) => {
      const rows = await trx.execute<{ id: string }>(sql`
        UPDATE product_form_exports
           SET status = 'running',
               lease_until = NOW() + ${this.leaseMs} * interval '1 millisecond',
               lease_token = ${leaseToken}::uuid,
               updated_at = NOW()
         WHERE id = (
           SELECT id
             FROM product_form_exports
            WHERE status IN ('queued', 'running')
              AND (lease_until IS NULL OR lease_until < NOW())
            ORDER BY created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
         )
        RETURNING id
      `);
      // drizzle 의 execute 는 postgres-js RowList 를 돌려주며 제네릭이 원소 타입까지
      // 좁혀주지 않는다 — fulfillment-order-reservation-retry.worker.ts:111 과 같은 선례.
      const [row] = rows as unknown as Array<{ id: string }>;
      return row ? { exportId: row.id, leaseToken } : null;
    }, tx);
  }

  /**
   * 조립 전체를 한 번에 돈다. 임포트와 달리 슬라이스로 나누지 않는 이유는 워크북이
   * **하나의 파일**이라 부분 산출물이 없기 때문이다. 대신 lease 를 5분으로 길게 잡고,
   * 죽으면 처음부터 다시 조립한다(멱등하다 — 매번 현재 active 를 다시 읽는다).
   */
  async runExport(claimed: ClaimedExport): Promise<void> {
    const { exportId, leaseToken } = claimed;

    const [job] = await this.db.run((trx) =>
      trx.select().from(productFormExports).where(eq(productFormExports.id, exportId)).limit(1),
    );
    if (!job) return;

    const { data, items } = await this.db.run((trx) =>
      this.snapshot.buildPrefill(trx, job.requestedMasterIds, exportId),
    );

    const buffer = await buildFormWorkbook(data);
    const fileName = `상품일괄양식_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const { fileId } = await this.fileClient.upload({ buffer, fileName, userId: job.requestedBy });

    await this.db.run(async (trx) => {
      // 재조립(lease 만료 후 재개)이면 옛 항목이 남아 UNIQUE 를 때린다. 먼저 비운다.
      await trx.delete(productFormExportItems).where(eq(productFormExportItems.exportId, exportId));
      if (items.length > 0) {
        await trx.insert(productFormExportItems).values(items.map((item) => ({ exportId, ...item })));
      }

      // 마감도 토큰 CAS 를 건다. 무조건 쓰면, lease 가 만료된 뒤 뒤늦게 깨어난 좀비가
      // **후임이 처리 중인 잡을** completed 로 도장 찍고 후임의 fileId 를 덮어쓴다.
      await trx
        .update(productFormExports)
        .set({
          status: 'completed',
          fileId,
          productCount: items.length,
          errorMessage: null,
          leaseUntil: null,
          leaseToken: null,
          updatedAt: new Date(),
        })
        .where(and(eq(productFormExports.id, exportId), eq(productFormExports.leaseToken, leaseToken)));
    });
  }

  /**
   * 조립 중 예외를 기록한다. **상태를 바꾸지 않는 것이 기본이다** — 일시적 DB 오류로
   * 양식 생성을 영구 실패시키는 편이 더 나쁘다. 대신 연속 실패가 상한에 닿으면 failed 로
   * 확정해 무한 재시도를 유계로 만든다.
   */
  async recordJobError(exportId: string, message: string): Promise<void> {
    await this.db.run(async (trx) => {
      const [row] = await trx
        .update(productFormExports)
        .set({
          errorMessage: message,
          consecutiveFailures: sql`${productFormExports.consecutiveFailures} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(productFormExports.id, exportId))
        .returning({ failures: productFormExports.consecutiveFailures });

      if (row && row.failures >= MAX_CONSECUTIVE_EXPORT_FAILURES) {
        await trx
          .update(productFormExports)
          .set({ status: 'failed', leaseUntil: null, leaseToken: null })
          .where(eq(productFormExports.id, exportId));
        this.logger.error(`양식 생성 잡 ${exportId} 이 연속 실패 상한에 닿아 failed 로 확정됐습니다`);
      }
    });
  }

  async clearConsecutiveFailures(exportId: string): Promise<void> {
    await this.db.run((trx) =>
      trx.update(productFormExports).set({ consecutiveFailures: 0 }).where(eq(productFormExports.id, exportId)),
    );
  }
}
```

- [ ] **Step 2: 워커를 구현한다**

```typescript
// form-export-job.worker.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimedExport, FormExportJobManager } from './form-export-job.manager';
import { FormExportManager } from './form-export.manager';

/**
 * 양식 생성 잡 워커. ProductImportJobWorker 와 같은 모양이다 — @Cron + 원자적 claim.
 * 한 틱은 잡 하나를 통째로 조립한다(워크북은 부분 산출물이 없다). isProcessing 가드가
 * 틱 누적을 막는다.
 */
@Injectable()
export class FormExportJobWorker {
  private readonly logger = new Logger(FormExportJobWorker.name);
  private isProcessing = false;

  constructor(
    private readonly jobManager: FormExportJobManager,
    private readonly manager: FormExportManager,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<string>('FORM_EXPORT_WORKER_ENABLED') !== 'false';
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    if (this.isProcessing) {
      this.logger.debug('이전 양식 조립 진행 중, 건너뜀');
      return;
    }

    this.isProcessing = true;
    let claimed: ClaimedExport | null = null;
    try {
      claimed = await this.jobManager.claim();
      if (!claimed) return;
      await this.jobManager.runExport(claimed);
      // 여기 도달했다는 건 조립이 예외 없이 끝났다는 뜻이다. catch 에서 부르면 안 된다
      // (리셋이 상한을 영원히 막는다).
      await this.jobManager.clearConsecutiveFailures(claimed.exportId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      // 두 번째 인자를 넘겨야 Nest 가 스택을 찍는다 — 예상 못 한 예외에서 유일한 단서다.
      this.logger.error(
        `양식 조립 실패 (export=${claimed?.exportId ?? 'none'}): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (claimed) await this.jobManager.recordJobError(claimed.exportId, message);
    } finally {
      this.isProcessing = false;
    }
  }

  /** 만료된 잡과 워크북을 정리한다. 하루 한 번이면 충분하다. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    if (!this.enabled) return;
    const removed = await this.manager.purgeExpired(new Date());
    if (removed > 0) this.logger.log(`만료된 양식 생성 잡 ${removed}건을 정리했습니다`);
  }
}
```

- [ ] **Step 3: 단위 테스트를 쓴다**

```typescript
// form-export-job.manager.spec.ts
import { FormExportJobManager, MAX_CONSECUTIVE_EXPORT_FAILURES } from './form-export-job.manager';

describe('FormExportJobManager.recordJobError', () => {
  it('상한 미만이면 상태를 바꾸지 않는다 — 일시적 오류로 잡을 죽이지 않는다', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const manager = new FormExportJobManager(
      fakeDb({ onUpdate: (set) => updates.push(set), returning: [{ failures: 1 }] }),
      {} as never,
      {} as never,
      fakeConfig(),
    );

    await manager.recordJobError('e1', '일시적 DB 오류');

    expect(updates.some((u) => u.status === 'failed')).toBe(false);
  });

  it('상한에 닿으면 failed 로 확정하고 lease 를 놓는다', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const manager = new FormExportJobManager(
      fakeDb({ onUpdate: (set) => updates.push(set), returning: [{ failures: MAX_CONSECUTIVE_EXPORT_FAILURES }] }),
      {} as never,
      {} as never,
      fakeConfig(),
    );

    await manager.recordJobError('e1', '반복 오류');

    const final = updates.find((u) => u.status === 'failed');
    expect(final).toMatchObject({ status: 'failed', leaseUntil: null, leaseToken: null });
  });
});
```

- [ ] **Step 4: lease 소유권 통합 테스트를 쓴다**

`product-import-job-lease.integration.spec.ts` 를 그대로 본떠 실 Postgres 로 단정한다. **목 스펙만으로 통과시키면 안 된다 — 이 레포에서 lease 소유권은 목이 초록인 채 세 번 깨졌다.**

```typescript
// form-export-job-lease.integration.spec.ts (핵심 단정)
it('두 번째 claim 은 lease 가 살아있는 동안 같은 잡을 잡지 못한다', async () => {
  const first = await manager.claim();
  expect(first).not.toBeNull();
  await expect(manager.claim()).resolves.toBeNull();
});

it('lease 가 만료되면 다시 클레임되고 토큰이 바뀐다', async () => {
  const first = await manager.claim();
  await expireLease(first!.exportId);
  const second = await manager.claim();
  expect(second!.exportId).toBe(first!.exportId);
  expect(second!.leaseToken).not.toBe(first!.leaseToken);
});

it('옛 토큰으로는 마감하지 못한다 — 좀비가 후임을 덮어쓰지 않는다', async () => {
  const first = await manager.claim();
  await expireLease(first!.exportId);
  const second = await manager.claim();

  await manager.runExport(first!); // 좀비
  const row = await readExport(first!.exportId);
  expect(row.status).toBe('running');
  expect(row.leaseToken).toBe(second!.leaseToken);
});
```

- [ ] **Step 5: 테스트 실행**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.spec.ts`
Expected: PASS

Run: `npm run test:form-export:integration`
Expected: PASS (lease 3건 포함)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.worker.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job.manager.spec.ts \
        apps/core/src/modules/catalog/operations/bulk-session/services/form-export-job-lease.integration.spec.ts
git commit -m "feat(bulk-session): 양식 조립 워커 (claim + lease CAS + 만료 정리)

워크북은 부분 산출물이 없어 슬라이스로 나누지 않고 lease 를 5분으로 길게 잡는다.
조립은 멱등하다 — 죽으면 현재 active 를 다시 읽어 처음부터 만든다.
마감에 토큰 CAS 를 걸어 좀비가 후임의 fileId 를 덮어쓰지 못하게 한다."
```

---

### Task 9: admin-web 배선

**Files:**
- Create: `apps/admin-web/src/lib/types/dto/form-export.ts`
- Create: `apps/admin-web/src/lib/api/domains/products/form-export.client.ts`
- Create: `apps/admin-web/src/lib/services/products/form-export.ts`
- Modify: `apps/admin-web/src/lib/services/products/query-keys.ts`
- Create: `apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx`
- Modify: `apps/admin-web/src/features/mall/products-list/components/table/index.tsx`
- Test: `apps/admin-web/src/lib/services/products/form-export.spec.ts`

**Interfaces:**
- Consumes: `POST /product-forms`, `GET /product-forms/:id`, `GET /product-forms/:id/download-url`, 기존 `selectedIdsFromRowSelection`
- Produces: `useRequestFormExport()`, `useFormExportStatus(exportId)`, `FormExportModal`

- [ ] **Step 1: 타입과 클라이언트를 만든다**

```typescript
// lib/types/dto/form-export.ts
export interface FormExportAccepted {
  exportId: string;
  status: 'queued';
  requestedCount: number;
}

export interface FormExportStatus {
  exportId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  productCount: number;
  errorMessage: string | null;
  downloadable: boolean;
  expiresAt: string;
}
```

```typescript
// lib/api/domains/products/form-export.client.ts
import { apiClient } from '../../client';
import type { FormExportAccepted, FormExportStatus } from '@/lib/types/dto/form-export';

export const formExportClient = {
  request: (masterIds: string[]) =>
    apiClient.post<FormExportAccepted>('/product-forms', { masterIds }),
  getStatus: (exportId: string) => apiClient.get<FormExportStatus>(`/product-forms/${exportId}`),
  getDownloadUrl: (exportId: string) =>
    apiClient.get<{ url: string }>(`/product-forms/${exportId}/download-url`),
};
```

`apiClient` 의 실제 임포트 경로와 메서드 시그니처는 이웃 클라이언트(`product-import.client.ts`)를 열어 맞춘다.

- [ ] **Step 2: 폴링 훅 테스트를 쓴다**

```typescript
// lib/services/products/form-export.spec.ts
import { formExportRefetchInterval, isFormExportRunning } from './form-export';

describe('formExportRefetchInterval', () => {
  it('데이터가 아직 없으면 계속 두드린다', () => {
    expect(formExportRefetchInterval(undefined)).toBe(2000);
  });

  it('진행 중이면 폴링한다', () => {
    expect(formExportRefetchInterval({ status: 'running' } as never)).toBe(2000);
    expect(formExportRefetchInterval({ status: 'queued' } as never)).toBe(2000);
  });

  it('완료·실패면 폴링을 멈춘다', () => {
    expect(formExportRefetchInterval({ status: 'completed' } as never)).toBe(false);
    expect(formExportRefetchInterval({ status: 'failed' } as never)).toBe(false);
  });
});

describe('isFormExportRunning', () => {
  it('알 수 없는 상태는 진행 중으로 본다 — 롤링 배포 중 옛 응답이 화면을 굳히지 않게', () => {
    expect(isFormExportRunning(undefined)).toBe(true);
  });
});
```

**이 테스트가 있는 이유:** v3 2단계에서 폴링 훅을 갈아끼우며 `if (!data) return 2000;` 분기를 빠뜨려, 첫 요청 1회 실패로 화면이 리로드 전까지 얼어붙은 회귀가 있었다. TanStack Query 는 에러 상태를 `refetchInterval` 콜백에 넘기지 않으므로 판단 재료가 `data === undefined` 뿐이다.

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd apps/admin-web && npx jest src/lib/services/products/form-export.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 훅을 구현한다**

```typescript
// lib/services/products/form-export.ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { formExportClient } from '@/lib/api/domains/products/form-export.client';
import type { FormExportStatus } from '@/lib/types/dto/form-export';
import { productQueryKeys } from './query-keys';

/**
 * 데이터가 아직 없는 동안에도 계속 두드린다 — 첫 요청이 한 번 실패해도 화면이 얼지 않는다.
 * TanStack Query 는 에러 상태를 이 콜백에 넘기지 않으므로 판단 재료가 data 뿐이다.
 */
export function formExportRefetchInterval(data: FormExportStatus | undefined): number | false {
  if (!data) return 2000;
  return data.status === 'queued' || data.status === 'running' ? 2000 : false;
}

/** 알 수 없는 상태는 진행 중으로 본다 — 롤링 배포 중 옛 core 응답이 화면을 굳히지 않게. */
export function isFormExportRunning(status: FormExportStatus['status'] | undefined): boolean {
  return status !== 'completed' && status !== 'failed';
}

export function useRequestFormExport() {
  return useMutation({
    mutationFn: (masterIds: string[]) => formExportClient.request(masterIds),
  });
}

export function useFormExportStatus(exportId: string | null) {
  return useQuery({
    queryKey: productQueryKeys.formExport(exportId ?? ''),
    queryFn: () => formExportClient.getStatus(exportId!),
    enabled: exportId !== null,
    refetchInterval: ({ state }) => formExportRefetchInterval(state.data),
  });
}
```

`query-keys.ts` 에 더한다:

```typescript
  formExport: (exportId: string) => ['products', 'form-export', exportId] as const,
```

- [ ] **Step 5: 모달을 만든다**

```tsx
// features/mall/products-list/components/form-export-modal/index.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormExportStatus, useRequestFormExport } from '@/lib/services/products/form-export';
import { formExportClient } from '@/lib/api/domains/products/form-export.client';

interface Props {
  open: boolean;
  masterIds: string[];
  onClose: () => void;
}

export function FormExportModal({ open, masterIds, onClose }: Props) {
  const [exportId, setExportId] = useState<string | null>(null);
  const request = useRequestFormExport();
  const { data } = useFormExportStatus(exportId);

  // useMutation 이 돌려주는 객체는 렌더마다 새 참조다. 그대로 의존성에 넣으면 effect 가
  // 매 렌더 돌아 접수 요청이 무한히 나간다. ref 로 최신 mutate 만 들고, effect 는
  // '열림 전환' 한 번에만 반응하게 한다.
  const requestRef = useRef(request);
  requestRef.current = request;
  const startedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setExportId(null);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    requestRef.current.mutate(masterIds, { onSuccess: (res) => setExportId(res.exportId) });
  }, [open, masterIds]);

  if (!open) return null;

  const handleDownload = async () => {
    if (!exportId) return;
    const { url } = await formExportClient.getDownloadUrl(exportId);
    window.location.href = url;
  };

  return (
    <div role="dialog" aria-label="양식 생성">
      <h2>양식 생성</h2>
      {!data && <p>양식 생성을 접수하는 중입니다…</p>}
      {data?.status === 'queued' && <p>대기 중입니다. 잠시만 기다려 주세요.</p>}
      {data?.status === 'running' && <p>상품 데이터를 모으는 중입니다…</p>}
      {data?.status === 'failed' && <p role="alert">양식 생성에 실패했습니다: {data.errorMessage}</p>}
      {data?.status === 'completed' && (
        <>
          <p>
            상품 {data.productCount}건이 담긴 양식이 준비됐습니다.
            {data.productCount < masterIds.length && (
              <> 판매 중인 버전이 없는 상품 {masterIds.length - data.productCount}건은 제외됐습니다.</>
            )}
          </p>
          <button type="button" onClick={handleDownload}>
            다운로드
          </button>
        </>
      )}
      <button type="button" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}
```

마크업·버튼 컴포넌트는 이웃 모달(`features/mall/bulk/components/bulk-action-modal/index.tsx`)의 디자인 시스템을 따라 맞춘다.

- [ ] **Step 6: 목록 테이블에 버튼을 붙인다**

`products-list/components/table/index.tsx` 에서 `selectedIdsFromRowSelection(rowSelection)` 로 얻은 목록을 `FormExportModal` 에 넘기는 "양식 다운로드" 버튼을 추가한다. 선택이 0건이면 비활성.

- [ ] **Step 7: 테스트와 린트**

Run: `cd apps/admin-web && npx jest src/lib/services/products/form-export.spec.ts`
Expected: PASS (4 tests)

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: exit 0

Run: `npx eslint apps/admin-web/src/features/mall/products-list/components/form-export-modal/index.tsx`
Expected: 0 errors (`.tsx` 는 레포 lint 글롭을 빠져나가므로 직접 봐야 한다)

- [ ] **Step 8: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/form-export.ts \
        apps/admin-web/src/lib/api/domains/products/form-export.client.ts \
        apps/admin-web/src/lib/services/products/form-export.ts \
        apps/admin-web/src/lib/services/products/form-export.spec.ts \
        apps/admin-web/src/lib/services/products/query-keys.ts \
        apps/admin-web/src/features/mall/products-list/
git commit -m "feat(admin-web): 상품 목록에서 프리필 양식 요청·폴링·다운로드

폴링 훅에 '데이터가 아직 없는 동안에도 계속 두드린다' 분기를 넣는다 — v3 2단계에서
이 분기를 빠뜨려 첫 요청 1회 실패로 화면이 얼어붙은 회귀가 있었다."
```

---

### Task 10: 마무리 검증

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 스코프 테스트 전량**

Run: `npx jest apps/core/src/modules/catalog/operations/bulk-session/`
Expected: 전부 PASS

Run: `npm run test:form-export:integration`
Expected: 전부 PASS

Run: `cd apps/admin-web && npx jest src/lib/services/products/form-export.spec.ts`
Expected: PASS

- [ ] **Step 2: 타입 게이트**

Run: `npm run type-check:scoped`
Expected: exit 0

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 전역 회귀 차분**

Run: `npx jest 2>&1 | tail -20`

`develop` 의 기준선과 **실패 스위트 수를 비교**한다. 신규 실패 0건이어야 한다. 전역이 red 인 것 자체는 이 레포의 상시 debt 이므로 "전체 그린" 을 기대하지 않는다.

- [ ] **Step 4: 수동 스모크 (사람)**

로컬에서 core + admin-web 을 띄우고:

1. 상품 목록에서 3~5건 선택 → "양식 다운로드" → 모달이 대기→진행→완료로 바뀌는지
2. 내려받은 xlsx 를 엑셀로 열어 확인:
   - 시트 8개(상품·옵션·조합·카테고리·구매제약·이미지·카테고리 참조 + 숨은 메타)
   - 헤더가 한국어이고 **필수 열만 볼드**
   - 상품 데이터가 실제 값과 일치
   - 조합 열이 uuid 결합이고 옆 "조합명(참고용)" 이 사람이 읽을 수 있는 형태
   - 카테고리 참조 시트에 전체 트리가 경로로 들어있음
3. 복합 가격규칙(`tiered_price` 또는 `scale`)이 걸린 상품을 하나 섞어 → 그 행의 판매가가 `[복합 가격규칙]` 인지
4. `product_form_export_items` 를 직접 조회해 `version_id` 가 그 상품의 현재 active 와 같은지

- [ ] **Step 5: 배포 선행조건 확인**

- 마이그레이션 1건, 전부 additive → **`migrate` → `deploy`** 순서 (ADR-0005 §5 expand phase)
- **file-service 컨텍스트 추가는 `db:seed:ref` 를 돌려야 반영된다** — 안 돌리면 첫 업로드가 "알 수 없는 컨텍스트" 로 실패한다. file-service 배포 → `npm run db:seed:ref -- --stage <stage> --deployment <name> --yes`
- 신규 시크릿 없음 — `AUTH_SECRET`·`FILE_SERVICE_URL` 이 Core live env 에 이미 있다
- 신규 env(전부 기본값 있음): `FORM_EXPORT_WORKER_ENABLED`, `FORM_EXPORT_LEASE_MS`
- 배포 순서: file-service → core → admin-web

---

## 이 계획이 의도적으로 남기는 것

- **업로드·검증·프리뷰** — 2단계. `readExportIdFromWorkbook` 을 이 단계에서 미리 만들어 두었으므로 2단계가 그대로 쓴다.
- **`bulk_session_id` 잠금 컬럼** — 4단계.
- **옛 `product_import_*` 제거** — 6단계 contract phase.
- **양식 생성 잡의 취소** — 조립이 최대 5분이고 만료가 자동이라 1단계에서는 필요하지 않다. 굳으면 연속 실패 상한이 3회에 `failed` 로 확정한다.
- **`seller` 프리필** — `product_master_versions` 에 대응 컬럼을 확인하지 못했다. 컬럼이 있으면 채우고, 없으면 워크북 열을 빼는 대신 빈 칸으로 둔다(신규 등록에는 쓰이는 열이다).

## 착수 전 확인 (스펙 §6)

**`active`·`inactive` 버전이 CoW 없이 UPDATE 되는 경로가 없는지 먼저 확인한다.** 스냅샷을 `versionId` 만으로 보관하는 이 단계의 설계 전체가 여기 기댄다. `productMasterVersions` 에 대한 `.update(` 호출을 전수 조사해, `status` 전이(publish/rollback)와 draft 편집 외에 active 행의 내용을 바꾸는 곳이 있으면 **Task 1 로 돌아가 스냅샷을 값으로 복사하는 설계로 바꾼다.**

Run: `grep -rn "update(productMasterVersions)" apps/core/src --include="*.ts" | grep -v spec`
