# 판매상품 대량등록 v3 — 3단계(스칼라 필드 6종 + Categories·Constraints 시트) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대량등록 워크북이 SEO·도매전용·판매기간 스칼라 6종을 싣고, `Categories`·`Constraints` 시트로 다중 카테고리와 구매제약을 지정할 수 있게 한다.

**Architecture:** 기존 파이프라인(`parser → normalizer → validator → manager`)의 각 층에 책임을 그대로 나눠 얹는다. 파서가 새 시트 2개를 읽고, 정규화기가 시트를 `productKey` 로 상품 레코드에 접합하며(카테고리 경로 해석은 이미 정규화기에 있다), 검증기가 셀 문자열을 타입으로 강제하고, `ProductImportManager.createFromRecord` 가 이미 있는 `updateVersion` + `ProductPurchaseConstraintsService.upsertForDraft` 로 흘려보낸다. **DB 스키마 변경은 없다** — 6종 스칼라 컬럼과 구매제약 테이블이 모두 이미 존재하고 쓰기 경로만 없었다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), ExcelJS, Jest, Next.js(admin-web), Zod/class-validator

**베이스:** `develop` @ `1627bce6d` (v3 1·2단계 모두 머지됨 — 2단계 `8958107d0`, 1단계 마이그레이션 `20260729181026`)
**브랜치/워크트리:** `feat/product-bulk-import-v3-fields` @ `.claude/worktrees/feat+product-bulk-import-v3-fields`
**스펙:** `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` §3.1 · §6 3단계

---

## Global Constraints

- **마이그레이션 0건.** 이 단계가 쓰는 컬럼은 전부 이미 있다 — `seo_title`(varchar 255)·`seo_description`(text)·`seo_keywords`(text[])·`is_wholesale_only`(bool not null default false)·`sales_start_date`(timestamp)·`sales_end_date`(timestamp) 는 `catalog.schema.ts:141-187`, 구매제약은 `product_purchase_constraints` + `product_master_purchase_constraints` 매핑 테이블. `npm run db:generate:core` 를 **부르지 않는다.** drizzle 마이그레이션 파일이 새로 생기면 그건 실수다.
- **신규 시크릿·env 0건.**
- **레이어 규칙**(CLAUDE.md): Controller → Service → Reader/Manager → Repository. Service 는 2~3줄 흐름만. 검증·비즈니스 로직은 Reader/Manager 에. 도메인 예외는 `@app/shared` 의 `BadRequestError`/`NotFoundError`/`ConflictError` — Service 층에서 `HttpException` 계열을 import 하지 않는다.
- **`any`·`as` 금지** (프로덕션 코드). 기존 spec 파일의 `as any` 목 하네스는 관례이므로 유지·확장해도 된다.
- **오류 메시지는 한국어.** 기존 메시지 톤을 따른다 (`basePrice 는 0보다 큰 숫자여야 합니다`).
- **트랜잭션 전파**: `this.db.run(async (trx) => {...}, tx)`. `DbTransaction` 은 `apps/core/src/modules/catalog/catalog.types.ts` 에서 import. 클래스별 `inTx` 헬퍼를 새로 만들지 않는다 (ADR-0025).
- **스코프 밖 (스펙 §4)**: 이미지(`Images` 시트·`thumbnailImageKey`·`additionalImageKeys`) = 4단계. `descriptionHtml`·`shippingMethodId`·`supplierId`·태그·옵션값별 색상/이미지/정렬·기존 상품 upsert·카테고리 신규 생성 = 영구 제외.
- **검증 게이트 스코프**(repo 상시 debt): `npm run lint`(전역 `--fix`)·전역 `jest`·전역 `tsc`·`nest build core`(webpack module-not-found 12건) 는 develop 에서도 red 라 권위가 아니다. **변경 파일 기준 차분**으로만 판정하고, core 타입 게이트는 `npm run type-check:scoped` 를 쓴다.

### 이 단계가 지불하는 대가 — 사람이 알아야 할 것

`salesStartDate`/`salesEndDate` 는 **읽기는 살아있고 쓰기는 죽어있던** 컬럼이다. 재고 게이팅이 실제로 이 값을 본다 (`product-sellable-quantity.calculator.ts:90-96` → `SALES_NOT_STARTED`/`SALES_ENDED`, 경계 시각 재계산은 `product-sellable-quantity.service.ts:469-481`). 반면 **쓰기 경로는 레포 전체에 하나도 없다** — `update-master.dto.ts` 에도 admin-web 화면에도 없다.

즉 이 단계가 끝나면 **임포트가 판매기간의 유일한 쓰기 경로**가 되고, 잘못 넣은 값을 나중에 화면에서 고치거나 지울 수단이 없다. 실패 모드가 조용하다 — 상품은 정상 게시되고 스토어프론트에서만 품절로 보인다.

그래서 이 계획은 두 가지로 막는다: (1) 검증기가 `salesStartDate < salesEndDate` 순서를 강제한다, (2) **프리뷰가 해석된 판매기간을 KST 로 표시**해 커밋 전에 눈으로 확인할 수 있게 한다(Task 9). 근본 해결(admin UI 판매기간 편집)은 이 계획 밖이고, 후속으로 남긴다.

과거 시각 `salesEndDate` 를 거부하는 가드는 **넣지 않는다** — 지금 순수 함수인 `ProductImportValidator` 에 시계를 주입해야 하고(테스트가 시간 의존적이 된다), 워크북 재업로드를 막는다. 프리뷰 표시로 대신한다.

---

## File Structure

### apps/core (전부 기존 파일 수정)

| 파일 | 이 단계에서의 책임 |
|---|---|
| `.../import/dto/import.types.ts` | `ParsedWorkbook` 에 시트 2개, `RowError.sheet` 유니온 확장, `ProductRecord` 신규 필드, 셀 불린/KST 포맷 공용 헬퍼 |
| `.../import/services/product-import.parser.ts` | `Categories`·`Constraints` 시트 읽기 + 행 상한, **엑셀 날짜 셀을 규격 텍스트로 정규화** |
| `.../import/services/product-import.normalizer.ts` | `Categories` 다중 지정 해석(+`isPrimary` 규칙, `Products.categoryPath` 충돌 규칙), `Constraints` 접합 |
| `.../import/services/product-import.validator.ts` | 스칼라 6종 강제(길이·형식·순서), 구매제약 숫자 파싱 |
| `.../import/services/product-import.manager.ts` | `createFromRecord`: ISO 문자열 → `Date` 되살리기 + `upsertForDraft` 호출 |
| `.../import/services/product-import-job.manager.ts` | `isProductRecord` export (통합 테스트가 쓴다) |
| `.../import/services/product-import.template.ts` | Products 컬럼 6개 추가 + 시트 2개 신설 + 예시 행 |
| `.../import/dto/import-response.dto.ts` | `ResolvedPreviewDto.categoryCount`·`salesPeriod` |
| `.../import/services/product-import.service.ts` | 프리뷰 조립에 위 두 필드 |

**모듈 변경 없음** — `ProductsModule` 이 `ProductPurchaseConstraintsService` 를 이미 export 하고(`products.module.ts:45`) `ProductImportModule` 이 `ProductsModule` 을 이미 import 한다(`product-import.module.ts:18`).

### apps/admin-web

| 파일 | 책임 |
|---|---|
| `src/lib/types/dto/product-import.ts` | `ResolvedPreview` 미러 타입 확장 |
| `src/features/mall/product-imports/wizard/validate-step.tsx` | 카테고리 개수 접미사 + 판매기간 컬럼 |

**템플릿은 서버가 만든다** (`GET /product-imports/template` → `generateTemplateWorkbook`). admin-web 에 하드코딩된 컬럼 목록은 없으므로 시트가 늘어도 admin-web 은 프리뷰 표시만 바뀐다.

### 신규 파일 1개

| 파일 | 책임 |
|---|---|
| `.../import/services/product-import-payload-roundtrip.integration.spec.ts` | payload jsonb 왕복이 신규 필드를 잃지 않는지 **진짜 Postgres** 로 확인 |

---

### Task 1: 파서가 새 시트 2개를 읽고, 타입이 그걸 표현한다

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `ParsedWorkbook.categories: RawRow[]`, `ParsedWorkbook.constraints: RawRow[]`
  - `RowError.sheet: 'Products' | 'Options' | 'Variants' | 'Categories' | 'Constraints'`
  - `export const MAX_CATEGORY_ROWS = 5_000`, `export const MAX_CONSTRAINT_ROWS = 1_000` (parser)
  - `export function parseBoolCell(raw: string | undefined): boolean` (import.types.ts)
  - `ProductRecord` 신규 필드: `purchaseConstraintRaw?`, `purchaseConstraint?`, `salesStartDate?: string`, `salesEndDate?: string`
  - `export interface NormalizedPurchaseConstraintRaw { rowNumber: number; requiresMembershipRaw: string; lifetimeQuantityLimitRaw: string }`
  - `export interface NormalizedPurchaseConstraint { requiresMembership: boolean; lifetimeQuantityLimit: number | null }`

- [ ] **Step 1: 워크트리에 의존성을 설치한다**

git worktree 는 `node_modules` 를 공유하지 않는다 — 새 워크트리에는 없으므로 jest 가 아예 돌지 않는다. (선례: `.claude/worktrees/feat+product-bulk-import-v3-progress` 는 자체 설치본을 갖고 있다.)

```bash
cd /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat+product-bulk-import-v3-fields
npm install
```

확인:

```bash
npx jest --testPathPattern="product-import.parser" 2>&1 | tail -5
```

기대: 기존 파서 테스트가 초록. (여기서 빨강이면 설치가 덜 된 것이지 코드 문제가 아니다.)

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`product-import.parser.spec.ts` 끝에 아래를 추가한다. 기존 파일의 워크북 조립 헬퍼(파일 상단)를 그대로 재사용한다 — 없으면 이 블록의 `buildWorkbook` 을 파일 안에 함께 넣는다.

```typescript
import * as ExcelJS from 'exceljs';
import { ProductImportParser, MAX_CATEGORY_ROWS, MAX_CONSTRAINT_ROWS } from './product-import.parser';

/** 시트명 → [헤더행, ...데이터행] 으로 워크북 버퍼를 만든다 */
async function buildWorkbook(sheets: Record<string, string[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const PRODUCTS_MINIMAL = [
  ['productKey', 'name', 'basePrice'],
  ['P1', '니트A', '29000'],
];

describe('ProductImportParser — Categories/Constraints 시트', () => {
  const parser = new ProductImportParser();

  it('두 시트가 없으면 빈 배열이다 (기존 워크북 하위호환)', async () => {
    const parsed = await parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL }));
    expect(parsed.categories).toEqual([]);
    expect(parsed.constraints).toEqual([]);
  });

  it('Categories 시트를 헤더명 → 셀 맵으로 읽는다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: PRODUCTS_MINIMAL,
        Categories: [
          ['productKey', 'categoryPath', 'isPrimary'],
          ['P1', '여성패션>니트', 'Y'],
          ['P1', '기획전>겨울신상', 'N'],
        ],
      }),
    );
    expect(parsed.categories).toEqual([
      { rowNumber: 1, cells: { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' } },
      { rowNumber: 2, cells: { productKey: 'P1', categoryPath: '기획전>겨울신상', isPrimary: 'N' } },
    ]);
  });

  it('Constraints 시트를 읽는다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: PRODUCTS_MINIMAL,
        Constraints: [
          ['productKey', 'requiresMembership', 'lifetimeQuantityLimit'],
          ['P1', 'Y', '2'],
        ],
      }),
    );
    expect(parsed.constraints).toEqual([
      { rowNumber: 1, cells: { productKey: 'P1', requiresMembership: 'Y', lifetimeQuantityLimit: '2' } },
    ]);
  });

  it('Categories 행 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['productKey', 'categoryPath', 'isPrimary']];
    for (let i = 0; i <= MAX_CATEGORY_ROWS; i++) rows.push(['P1', `여성패션>니트${i}`, 'N']);
    await expect(parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL, Categories: rows }))).rejects.toThrow(
      /Categories/,
    );
  });

  it('Constraints 행 상한을 넘으면 거부한다', async () => {
    const rows: string[][] = [['productKey', 'requiresMembership', 'lifetimeQuantityLimit']];
    for (let i = 0; i <= MAX_CONSTRAINT_ROWS; i++) rows.push([`P${i}`, 'Y', '']);
    await expect(parser.parse(await buildWorkbook({ Products: PRODUCTS_MINIMAL, Constraints: rows }))).rejects.toThrow(
      /Constraints/,
    );
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.parser" 2>&1 | tail -20
```

기대: FAIL — `MAX_CATEGORY_ROWS` 가 export 되지 않아 TS 컴파일 오류, 그리고 `parsed.categories` 가 `undefined`.

- [ ] **Step 4: 타입을 넓힌다**

`import.types.ts` 의 `ParsedWorkbook` 과 `RowError` 를 교체하고, 새 인터페이스·헬퍼를 추가한다.

```typescript
export interface ParsedWorkbook {
  products: RawRow[];
  options: RawRow[];
  /** 선택 시트 — 없으면 빈 배열 */
  variants: RawRow[];
  /** 선택 시트 — 다중 카테고리 지정. 없으면 빈 배열(Products.categoryPath 하위호환) */
  categories: RawRow[];
  /** 선택 시트 — 구매제약. 없으면 빈 배열 */
  constraints: RawRow[];
}

export interface RowError {
  sheet: 'Products' | 'Options' | 'Variants' | 'Categories' | 'Constraints';
  rowNumber: number;
  message: string;
}

/** Constraints 시트 원본 — 숫자 파싱은 validator 가 한다(오류 메시지를 한 곳에 모으기 위해) */
export interface NormalizedPurchaseConstraintRaw {
  rowNumber: number;
  requiresMembershipRaw: string;
  lifetimeQuantityLimitRaw: string;
}

export interface NormalizedPurchaseConstraint {
  requiresMembership: boolean;
  /** null 이면 수량 제한 없음 (upsert DTO 의 표현과 같다) */
  lifetimeQuantityLimit: number | null;
}

/**
 * 워크북 불린 셀 해석. 엑셀에서 사람이 쓰는 표기가 갈리므로 셋 다 받는다.
 * validator·normalizer 양쪽이 쓰므로 여기 둔다(전에는 validator private 였다).
 */
export function parseBoolCell(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'y' || value === 'true' || value === '1';
}
```

같은 파일의 `ProductRecord` 에 아래 필드를 추가한다 (`errors` 바로 위).

```typescript
  /** Constraints 시트 원본. 시트에 이 상품 행이 없으면 undefined. */
  purchaseConstraintRaw?: NormalizedPurchaseConstraintRaw;
  /** validator 가 purchaseConstraintRaw 를 파싱해 채운다. 실질 제약이 없으면 undefined. */
  purchaseConstraint?: NormalizedPurchaseConstraint;
  /**
   * 판매 시작/종료. **ISO8601 문자열**이다 — Date 로 두면 payload jsonb 왕복에서 문자열로
   * 바뀌어 타입이 거짓이 된다(워커는 항상 왕복한 값을 본다). 처음부터 문자열로 들고,
   * Date 로 되살리는 지점을 manager 한 곳으로 모은다.
   */
  salesStartDate?: string;
  salesEndDate?: string;
```

- [ ] **Step 5: 파서가 두 시트를 읽게 한다**

`product-import.parser.ts` 상단 상수 뒤에 추가한다.

```typescript
/**
 * 상품 1000행 × 카테고리 5개면 5,000 행이다. 도메인 상한은 없으나(_linkCategories 는
 * 개수를 제한하지 않는다) 파싱 메모리를 보호하는 실용 상한을 둔다.
 */
export const MAX_CATEGORY_ROWS = 5_000;
/** 구매제약은 상품당 최대 1행이므로 상품 상한과 같다. */
export const MAX_CONSTRAINT_ROWS = MAX_PRODUCT_ROWS;
```

`parse()` 안의 variants 블록 바로 뒤, `return` 직전에 추가한다.

```typescript
    const categoriesSheet = wb.getWorksheet('Categories');
    const categories = categoriesSheet ? this.readSheet(categoriesSheet) : [];
    if (categories.length > MAX_CATEGORY_ROWS) {
      throw new BadRequestError(`Categories 행이 상한(${MAX_CATEGORY_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    const constraintsSheet = wb.getWorksheet('Constraints');
    const constraints = constraintsSheet ? this.readSheet(constraintsSheet) : [];
    if (constraints.length > MAX_CONSTRAINT_ROWS) {
      throw new BadRequestError(`Constraints 행이 상한(${MAX_CONSTRAINT_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }
```

`return` 문을 교체한다.

```typescript
    return { products, options, variants, categories, constraints };
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
```

기대: 파서 테스트 전부 PASS. **다른 import 스펙들도 함께 초록이어야 한다** — `ParsedWorkbook` 에 필수 필드 2개가 늘었으므로 목 워크북을 만드는 스펙에서 TS 오류가 날 수 있다. 나면 그 스펙의 헬퍼에 `categories: [], constraints: []` 를 채운다 (예: `product-import.normalizer.spec.ts` 의 `parsed()` 헬퍼).

- [ ] **Step 7: 타입 게이트**

```bash
npm run type-check:scoped 2>&1 | tail -20
```

기대: 변경 파일에 대한 신규 error 0건.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/dto/import.types.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts
git commit -m "feat(product-import): v3 3단계 — Categories·Constraints 시트 파싱 + 타입 확장"
```

---

### Task 2: 엑셀 날짜 셀을 워크북 규격 텍스트로 되돌린다

MD 가 셀에 `2026-08-01` 을 입력하면 Excel 이 자동으로 **날짜 서식**으로 바꾼다. 그러면 exceljs 는 그 셀을 `Date` 로 읽고 `cell.text` 는 `Date.prototype.toString()` — `"Sat Aug 01 2026 09:00:00 GMT+0900 (Korean Standard Time)"` 같은 **서버 로케일·TZ 의존 문자열**이 된다 (`node_modules/exceljs/lib/doc/cell.js:575` `DateValue.toString()`). 그대로면 Task 6 의 날짜 검증이 "형식이 틀렸다"고 거부하고, MD 는 왜 거부당했는지 알 수 없다.

텍스트 서식을 강요하는 대신 파서가 규격 텍스트로 되돌린다. 날짜 셀은 지금 어떤 컬럼에서도 쓸 수 있는 값이 아니므로(어느 필드든 위 문자열이 들어오면 쓰레기다) 이 정규화는 전 시트에 걸쳐 무해하다.

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `buildWorkbook` 테스트 헬퍼
- Produces: `readSheet` 가 날짜 셀을 `'YYYY-MM-DD'`(자정) 또는 `'YYYY-MM-DD HH:mm'` 로 내보낸다. 다른 셀 동작은 불변.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.parser.spec.ts` 에 추가한다. 값을 손으로 만든 workbook 이 아니라 **exceljs 가 쓴 실제 날짜 셀**로 검사해야 의미가 있다.

```typescript
describe('ProductImportParser — 날짜 셀 정규화', () => {
  const parser = new ProductImportParser();

  async function workbookWithDateCell(value: Date): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(['productKey', 'name', 'salesStartDate']);
    ws.addRow(['P1', '니트A', value]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('자정 날짜 셀은 YYYY-MM-DD 로 읽힌다', async () => {
    const parsed = await parser.parse(await workbookWithDateCell(new Date(Date.UTC(2026, 7, 1, 0, 0))));
    expect(parsed.products[0].cells.salesStartDate).toBe('2026-08-01');
  });

  it('시각이 있는 날짜 셀은 YYYY-MM-DD HH:mm 로 읽힌다', async () => {
    const parsed = await parser.parse(await workbookWithDateCell(new Date(Date.UTC(2026, 7, 1, 14, 30))));
    expect(parsed.products[0].cells.salesStartDate).toBe('2026-08-01 14:30');
  });

  it('문자열 셀은 그대로 통과한다', async () => {
    const parsed = await parser.parse(
      await buildWorkbook({
        Products: [
          ['productKey', 'name', 'salesStartDate'],
          ['P1', '니트A', '2026-08-01'],
        ],
      }),
    );
    expect(parsed.products[0].cells.salesStartDate).toBe('2026-08-01');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.parser" -t "날짜 셀" 2>&1 | tail -25
```

기대: FAIL. 실제로 받은 문자열이 출력된다 (`"Sat Aug 01 2026 ..."` 류).

**이 출력을 반드시 읽어라.** exceljs 가 시트의 날짜 serial 을 UTC 기준 Date 로 만드는지 로컬 기준으로 만드는지가 여기서 확정된다. 아래 구현은 UTC 기준을 가정한다 — 만약 실패 출력이 하루/9시간 밀린 값을 보이면 `getUTC*` 를 로컬 게터로 바꾸고 주석도 함께 고친다. **테스트가 심판이고, 추측이 아니다.**

- [ ] **Step 3: 구현한다**

`product-import.parser.ts` 의 `@Injectable()` 데코레이터 **위**(클래스 밖)에 헬퍼를 추가한다.

```typescript
/**
 * 엑셀 날짜 셀을 워크북 규격 텍스트로 되돌린다.
 *
 * exceljs 는 날짜 서식 셀을 Date 로 읽고 `cell.text` 는 그 Date 의 `toString()` 이다 —
 * "Sat Aug 01 2026 09:00:00 GMT+0900 (Korean Standard Time)" 같은 **서버 로케일·TZ 의존
 * 문자열**이라 어떤 필드에도 쓸 수 없다. MD 가 날짜를 입력하면 Excel 이 자동으로 날짜
 * 서식으로 바꿔버리므로, "텍스트 서식으로 넣으세요"를 요구하는 대신 여기서 되돌린다.
 *
 * UTC 성분으로 읽는다 — exceljs 는 시트의 날짜 serial 을 UTC 기준 Date 로 만든다.
 * 로컬 성분(getMonth 등)으로 읽으면 서버 TZ 에 따라 날짜가 하루 밀린다.
 */
function formatWorkbookDateCell(value: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  const time = `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
  return time === '00:00' ? date : `${date} ${time}`;
}
```

`readSheet` 의 셀 순회를 교체한다.

```typescript
      headers.forEach((header, col) => {
        if (!header) return;
        const cell = row.getCell(col);
        // 날짜 셀만 가로챈다. 수식 셀의 value 는 {formula, result} 객체라 instanceof 가
        // 걸리지 않으므로 기존 text 경로를 그대로 탄다.
        const value =
          cell.value instanceof Date ? formatWorkbookDateCell(cell.value) : String(cell.text ?? '').trim();
        cells[header] = value;
        if (value !== '') hasValue = true;
      });
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -20
```

기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts
git commit -m "fix(product-import): 엑셀 날짜 셀을 로케일 의존 문자열 대신 규격 텍스트로 읽는다"
```

---

### Task 3: Categories 시트 — 다중 카테고리

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook.categories` (Task 1), `parseBoolCell` (Task 1), 기존 `private resolveCategory(path, bySlug, byParent, byId): { id, names } | null`
- Produces: `ProductRecord.categoryIds` 가 시트 순서의 다중 id, `primaryCategoryId` 가 `isPrimary='Y'` 행의 id, `categoryNames` 가 **대표 카테고리의 조상 경로**

**규칙 (스펙 §3.1):**
1. `Products.categoryPath` 와 `Categories` 시트를 같은 상품에 동시에 쓰면 **행 오류** (조용히 한쪽을 이기게 하지 않는다 — 지정한 카테고리가 말없이 사라지는 편이 더 나쁘다).
2. `isPrimary` 는 상품당 **정확히 1개**. 0개·2개 이상이면 행 오류.
3. 같은 카테고리 중복 지정 → 행 오류.
4. 해석 불가 경로 → 행 오류.
5. 존재하지 않는 `productKey` 참조 → Options 시트와 같은 stub 레코드 + 오류.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.normalizer.spec.ts` 의 `parsed()` 헬퍼를 카테고리 시트를 받도록 넓히고(Task 1 에서 이미 `categories: []` 를 채웠다면 인자만 추가), 아래 describe 를 추가한다.

```typescript
function parsedWith(
  products: Record<string, string>[],
  extra: { categories?: Record<string, string>[]; constraints?: Record<string, string>[] } = {},
) {
  return {
    products: products.map((cells, i) => ({ rowNumber: i + 1, cells })),
    options: [],
    variants: [],
    categories: (extra.categories ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
    constraints: (extra.constraints ?? []).map((cells, i) => ({ rowNumber: i + 1, cells })),
  };
}

describe('ProductImportNormalizer — Categories 시트', () => {
  const normalizer = new ProductImportNormalizer();

  it('여러 카테고리를 시트 순서대로 붙이고 isPrimary 를 대표로 삼는다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: '니트A' }], {
        categories: [
          { productKey: 'P1', categoryPath: '남성패션>니트', isPrimary: 'N' },
          { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' },
        ],
      }),
      CATEGORIES,
    );
    expect(rec.categoryIds).toEqual(['c-knit2', 'c-knit']);
    expect(rec.primaryCategoryId).toBe('c-knit');
    // categoryNames 는 대표 카테고리의 조상 경로다 (프리뷰가 이걸 그린다)
    expect(rec.categoryNames).toEqual(['여성패션', '니트']);
    expect(rec.errors).toEqual([]);
  });

  it('Products.categoryPath 와 동시 사용은 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x', categoryPath: '여성패션>니트' }], {
        categories: [{ productKey: 'P1', categoryPath: '남성패션>니트', isPrimary: 'Y' }],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /동시에/.test(e.message))).toBe(true);
    // 충돌 시 Categories 는 적용하지 않는다 — Products 쪽 해석만 남는다
    expect(rec.categoryIds).toEqual(['c-knit']);
  });

  it('isPrimary 가 0개면 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [{ productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'N' }],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /isPrimary/.test(e.message))).toBe(true);
    expect(rec.categoryIds).toEqual([]);
  });

  it('isPrimary 가 2개면 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [
          { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' },
          { productKey: 'P1', categoryPath: '남성패션>니트', isPrimary: 'Y' },
        ],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /isPrimary/.test(e.message))).toBe(true);
  });

  it('같은 카테고리 중복 지정은 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [
          { productKey: 'P1', categoryPath: '여성패션>니트', isPrimary: 'Y' },
          { productKey: 'P1', categoryPath: 'women-knit', isPrimary: 'N' }, // slug 로 같은 노드
        ],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Categories' && /중복/.test(e.message))).toBe(true);
  });

  it('해석 불가 경로는 행 오류이고 isPrimary 오류를 덧붙이지 않는다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [{ productKey: 'P1', categoryPath: '없는>경로', isPrimary: 'Y' }],
      }),
      CATEGORIES,
    );
    const messages = rec.errors.filter((e) => e.sheet === 'Categories').map((e) => e.message);
    expect(messages.some((m) => /카테고리 경로를 해석할 수 없습니다/.test(m))).toBe(true);
    // 경로가 안 풀린 상태에서 "isPrimary 가 0개다"까지 얹으면 원인이 흐려진다
    expect(messages.some((m) => /isPrimary/.test(m))).toBe(false);
  });

  it('존재하지 않는 productKey 참조는 stub 레코드로 남는다', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        categories: [{ productKey: 'GHOST', categoryPath: '여성패션>니트', isPrimary: 'Y' }],
      }),
      CATEGORIES,
    );
    const ghost = records.find((r) => r.productKey === 'GHOST');
    expect(ghost).toBeDefined();
    expect(ghost!.errors.some((e) => e.sheet === 'Categories' && /productKey/.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.normalizer" 2>&1 | tail -25
```

기대: FAIL — `categoryIds` 가 `[]` 이고 오류가 붙지 않는다.

- [ ] **Step 3: 구현한다**

`product-import.normalizer.ts` 의 import 를 넓힌다.

```typescript
import {
  ParsedWorkbook,
  CategoryNode,
  ProductRecord,
  NormalizedOption,
  RawRow,
  comboKey,
  parseBoolCell,
} from '../dto/import.types';
```

`normalize()` 의 Products 루프가 끝난 직후(즉 `const optionSeqByKey = ...` 바로 위)에 호출을 넣는다.

```typescript
    this.applyCategorySheet(parsed.categories, records, byKey, bySlug, byParent, byId);
```

`resolveCategory` 위에 메서드를 추가한다.

```typescript
  /**
   * Categories 시트로 다중 카테고리를 지정한다.
   *
   * `Products.categoryPath` 는 기존 워크북 하위호환으로 남아 있고, **같은 상품에 둘 다
   * 있으면 행 오류**다. 조용히 한쪽을 이기게 하면 MD 가 채운 카테고리가 말없이 사라지는데,
   * 카테고리는 노출 위치를 결정하므로 그 실수는 게시 후에나 발견된다.
   */
  private applyCategorySheet(
    rows: RawRow[],
    records: ProductRecord[],
    byKey: Map<string, ProductRecord>,
    bySlug: Map<string, CategoryNode>,
    byParent: Map<string | null, CategoryNode[]>,
    byId: Map<string, CategoryNode>,
  ): void {
    if (rows.length === 0) return;

    // 상품 단위로 모은다 — isPrimary "정확히 1개" 는 행 하나만 봐서는 판정할 수 없다.
    const grouped = new Map<string, RawRow[]>();
    for (const row of rows) {
      const productKey = row.cells.productKey ?? '';
      if (!byKey.has(productKey)) {
        records.push({
          rowNumber: row.rowNumber,
          productKey,
          raw: {},
          version: {},
          categoryIds: [],
          categoryNames: [],
          options: [],
          variantOverrides: [],
          errors: [
            {
              sheet: 'Categories',
              rowNumber: row.rowNumber,
              message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}`,
            },
          ],
        });
        continue;
      }
      const list = grouped.get(productKey) ?? [];
      list.push(row);
      grouped.set(productKey, list);
    }

    for (const [productKey, sheetRows] of grouped) {
      const target = byKey.get(productKey);
      if (!target) continue; // grouped 에는 byKey.has 를 통과한 키만 들어온다
      const push = (row: RawRow, message: string): void =>
        target.errors.push({ sheet: 'Categories', rowNumber: row.rowNumber, message });

      if ((target.raw.categoryPath ?? '').trim() !== '') {
        push(sheetRows[0], 'Products.categoryPath 와 Categories 시트를 동시에 쓸 수 없습니다. 한쪽만 채워주세요.');
        continue;
      }

      const ids: string[] = [];
      const seen = new Set<string>();
      const primaries: string[] = [];
      let primaryNames: string[] = [];
      let valid = true;

      for (const row of sheetRows) {
        const path = (row.cells.categoryPath ?? '').trim();
        if (path === '') {
          push(row, 'categoryPath 는 필수입니다.');
          valid = false;
          continue;
        }
        const resolved = this.resolveCategory(path, bySlug, byParent, byId);
        if (!resolved) {
          push(row, `카테고리 경로를 해석할 수 없습니다(미존재 또는 동명 모호): ${path}`);
          valid = false;
          continue;
        }
        if (seen.has(resolved.id)) {
          push(row, `같은 카테고리가 중복 지정되었습니다: ${path}`);
          valid = false;
          continue;
        }
        seen.add(resolved.id);
        ids.push(resolved.id);
        if (parseBoolCell(row.cells.isPrimary)) {
          primaries.push(resolved.id);
          primaryNames = resolved.names;
        }
      }

      // 경로가 안 풀린 상태에서 개수까지 세면 "isPrimary 가 0개다"가 함께 나와 원인이
      // 흐려진다 — 해석이 전부 성공했을 때만 개수를 본다.
      if (valid && primaries.length !== 1) {
        push(sheetRows[0], `isPrimary 는 상품당 정확히 1개여야 합니다 (현재 ${primaries.length}개).`);
        valid = false;
      }
      if (!valid) continue;

      target.categoryIds = ids;
      target.primaryCategoryId = primaries[0];
      target.categoryNames = primaryNames;
    }
  }
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import.normalizer" 2>&1 | tail -20
```

기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts
git commit -m "feat(product-import): Categories 시트로 다중 카테고리 지정"
```

---

### Task 4: Constraints 시트 — 구매제약

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook.constraints`, `NormalizedPurchaseConstraintRaw`, `NormalizedPurchaseConstraint`, `parseBoolCell` (Task 1)
- Produces: `ProductRecord.purchaseConstraint?: { requiresMembership: boolean; lifetimeQuantityLimit: number | null }` — 실질 제약이 없으면 `undefined` (Task 7 이 이 유무로 서비스 호출을 가른다)

- [ ] **Step 1: 실패하는 테스트를 쓴다 (정규화기)**

`product-import.normalizer.spec.ts` 에 추가한다.

```typescript
describe('ProductImportNormalizer — Constraints 시트', () => {
  const normalizer = new ProductImportNormalizer();

  it('상품에 구매제약 원본을 붙인다', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        constraints: [{ productKey: 'P1', requiresMembership: 'Y', lifetimeQuantityLimit: '2' }],
      }),
      CATEGORIES,
    );
    expect(rec.purchaseConstraintRaw).toEqual({
      rowNumber: 1,
      requiresMembershipRaw: 'Y',
      lifetimeQuantityLimitRaw: '2',
    });
    expect(rec.errors).toEqual([]);
  });

  it('한 상품에 두 행이면 두 번째가 행 오류', () => {
    const [rec] = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        constraints: [
          { productKey: 'P1', requiresMembership: 'Y', lifetimeQuantityLimit: '' },
          { productKey: 'P1', requiresMembership: 'N', lifetimeQuantityLimit: '3' },
        ],
      }),
      CATEGORIES,
    );
    expect(rec.errors.some((e) => e.sheet === 'Constraints' && e.rowNumber === 2)).toBe(true);
    // 첫 행은 살아있다 — 나중 행이 조용히 덮지 않는다
    expect(rec.purchaseConstraintRaw?.requiresMembershipRaw).toBe('Y');
  });

  it('존재하지 않는 productKey 참조는 stub 레코드로 남는다', () => {
    const records = normalizer.normalize(
      parsedWith([{ productKey: 'P1', name: 'x' }], {
        constraints: [{ productKey: 'GHOST', requiresMembership: 'Y', lifetimeQuantityLimit: '' }],
      }),
      CATEGORIES,
    );
    const ghost = records.find((r) => r.productKey === 'GHOST');
    expect(ghost!.errors.some((e) => e.sheet === 'Constraints' && /productKey/.test(e.message))).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.normalizer" -t "Constraints" 2>&1 | tail -20
```

기대: FAIL — `purchaseConstraintRaw` 가 `undefined`.

- [ ] **Step 3: 정규화기를 구현한다**

`normalize()` 의 `applyCategorySheet` 호출 바로 뒤에 추가한다.

```typescript
    this.applyConstraintSheet(parsed.constraints, records, byKey);
```

`applyCategorySheet` 아래에 메서드를 추가한다.

```typescript
  /**
   * Constraints 시트를 상품에 접합한다. 숫자 파싱은 하지 않는다 — 오류 메시지를 한 곳에
   * 모으기 위해 validator 가 한다(Variants 오버라이드 가격과 같은 분담).
   */
  private applyConstraintSheet(rows: RawRow[], records: ProductRecord[], byKey: Map<string, ProductRecord>): void {
    const seenKeys = new Set<string>();

    for (const row of rows) {
      const productKey = row.cells.productKey ?? '';
      const target = byKey.get(productKey);

      if (!target) {
        records.push({
          rowNumber: row.rowNumber,
          productKey,
          raw: {},
          version: {},
          categoryIds: [],
          categoryNames: [],
          options: [],
          variantOverrides: [],
          errors: [
            {
              sheet: 'Constraints',
              rowNumber: row.rowNumber,
              message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}`,
            },
          ],
        });
        continue;
      }

      if (seenKeys.has(productKey)) {
        // 나중 행이 조용히 앞 행을 덮으면 어느 쪽이 적용됐는지 파일만 봐서는 알 수 없다.
        target.errors.push({
          sheet: 'Constraints',
          rowNumber: row.rowNumber,
          message: `구매제약은 상품당 한 행만 쓸 수 있습니다: ${productKey}`,
        });
        continue;
      }
      seenKeys.add(productKey);

      target.purchaseConstraintRaw = {
        rowNumber: row.rowNumber,
        requiresMembershipRaw: (row.cells.requiresMembership ?? '').trim(),
        lifetimeQuantityLimitRaw: (row.cells.lifetimeQuantityLimit ?? '').trim(),
      };
    }
  }
```

- [ ] **Step 4: 실패하는 테스트를 쓴다 (검증기)**

`product-import.validator.spec.ts` 에 추가한다. 기존 스펙의 레코드 조립 방식(`ProductRecord` 리터럴)을 그대로 따른다.

```typescript
describe('ProductImportValidator — 구매제약', () => {
  const validator = new ProductImportValidator();

  function recordWithConstraint(raw: Partial<{ requiresMembershipRaw: string; lifetimeQuantityLimitRaw: string }>) {
    const record: ProductRecord = {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A', basePrice: '29000' },
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
      purchaseConstraintRaw: {
        rowNumber: 1,
        requiresMembershipRaw: raw.requiresMembershipRaw ?? '',
        lifetimeQuantityLimitRaw: raw.lifetimeQuantityLimitRaw ?? '',
      },
    };
    return validator.validate([record])[0];
  }

  it('requiresMembership=Y 를 파싱한다', () => {
    const out = recordWithConstraint({ requiresMembershipRaw: 'Y' });
    expect(out.purchaseConstraint).toEqual({ requiresMembership: true, lifetimeQuantityLimit: null });
    expect(out.errors).toEqual([]);
  });

  it('lifetimeQuantityLimit 만 있어도 제약이 생긴다', () => {
    const out = recordWithConstraint({ requiresMembershipRaw: 'N', lifetimeQuantityLimitRaw: '2' });
    expect(out.purchaseConstraint).toEqual({ requiresMembership: false, lifetimeQuantityLimit: 2 });
  });

  it('둘 다 비면 제약을 만들지 않는다 (삭제 의도로 해석되는 입력을 보내지 않는다)', () => {
    const out = recordWithConstraint({});
    expect(out.purchaseConstraint).toBeUndefined();
    expect(out.errors).toEqual([]);
  });

  it('lifetimeQuantityLimit 0 이하·소수는 행 오류', () => {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      const out = recordWithConstraint({ lifetimeQuantityLimitRaw: bad });
      expect(out.errors.some((e) => e.sheet === 'Constraints' && /lifetimeQuantityLimit/.test(e.message))).toBe(true);
      expect(out.purchaseConstraint).toBeUndefined();
    }
  });
});
```

- [ ] **Step 5: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.validator" -t "구매제약" 2>&1 | tail -20
```

기대: FAIL — `purchaseConstraint` 가 `undefined`.

- [ ] **Step 6: 검증기를 구현한다**

`product-import.validator.ts` 의 import 를 넓힌다.

```typescript
import { ProductRecord, parseBoolCell } from '../dto/import.types';
```

`validate()` 의 루프에 호출을 추가한다.

```typescript
      this.validateFields(record);
      this.validateOptions(record);
      this.validateVariantOverrides(record);
      this.validatePurchaseConstraint(record);
```

`validateVariantOverrides` 아래에 메서드를 추가한다.

```typescript
  private validatePurchaseConstraint(record: ProductRecord): void {
    const raw = record.purchaseConstraintRaw;
    if (!raw) return;
    const push = (message: string): void =>
      record.errors.push({ sheet: 'Constraints', rowNumber: raw.rowNumber, message });

    const requiresMembership = parseBoolCell(raw.requiresMembershipRaw);

    let lifetimeQuantityLimit: number | null = null;
    if (raw.lifetimeQuantityLimitRaw !== '') {
      const parsed = Number(raw.lifetimeQuantityLimitRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        push(`lifetimeQuantityLimit 는 1 이상의 정수여야 합니다: ${raw.lifetimeQuantityLimitRaw}`);
        return;
      }
      lifetimeQuantityLimit = parsed;
    }

    // 둘 다 비어 있으면 "제약 없음"이고, 그 입력은 upsertForVersion 의 isDeleteIntent 가
    // **삭제**로 해석한다(product-purchase-constraints.service.ts:32-34). 신규 생성엔 지울
    // 것이 없으니 호출 자체를 하지 않는 것이 맞다 — 그래서 undefined 로 남긴다.
    if (!requiresMembership && lifetimeQuantityLimit === null) return;

    record.purchaseConstraint = { requiresMembership, lifetimeQuantityLimit };
  }
```

- [ ] **Step 7: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -20
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS, 신규 타입 error 0건.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts
git commit -m "feat(product-import): Constraints 시트로 구매제약 지정"
```

---

### Task 5: SEO 3종 + 도매전용 스칼라

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord.raw`, `ProductRecord.version` (기존)
- Produces: `record.version` 에 `seoTitle?: string`, `seoDescription?: string`, `seoKeywords?: string[]`, `isWholesaleOnly: boolean`. 이 값들은 `createFromRecord` 가 그대로 `updateVersion` 에 흘려보낸다 (문자열·문자열배열·불린은 payload jsonb 왕복에서 안전하다).

`seo_keywords` 는 `text[]` 이므로 `string[]` 이 그대로 들어간다. `is_wholesale_only` 는 `notNull().default(false)` 라 `isOverseas` 와 같이 항상 세팅한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
describe('ProductImportValidator — SEO·도매전용', () => {
  const validator = new ProductImportValidator();

  function versionOf(raw: Record<string, string>) {
    const record: ProductRecord = {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A', basePrice: '29000', ...raw },
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
    };
    return validator.validate([record])[0];
  }

  it('seoTitle·seoDescription 을 version 에 넣는다', () => {
    const out = versionOf({ seoTitle: '겨울 니트 추천', seoDescription: '부드러운 니트' });
    expect(out.version.seoTitle).toBe('겨울 니트 추천');
    expect(out.version.seoDescription).toBe('부드러운 니트');
    expect(out.errors).toEqual([]);
  });

  it('seoKeywords 를 | 로 쪼갠다', () => {
    const out = versionOf({ seoKeywords: '니트|겨울| 여성니트 |' });
    expect(out.version.seoKeywords).toEqual(['니트', '겨울', '여성니트']);
  });

  it('빈 SEO 칸은 version 에 키를 만들지 않는다', () => {
    const out = versionOf({ seoTitle: '  ', seoDescription: '', seoKeywords: '|' });
    expect('seoTitle' in out.version).toBe(false);
    expect('seoDescription' in out.version).toBe(false);
    expect('seoKeywords' in out.version).toBe(false);
  });

  it('seoTitle 255자 초과는 행 오류', () => {
    const out = versionOf({ seoTitle: 'ㄱ'.repeat(256) });
    expect(out.errors.some((e) => e.sheet === 'Products' && /seoTitle/.test(e.message))).toBe(true);
    expect('seoTitle' in out.version).toBe(false);
  });

  it('isWholesaleOnly 는 항상 불린으로 채워진다', () => {
    expect(versionOf({ isWholesaleOnly: 'Y' }).version.isWholesaleOnly).toBe(true);
    expect(versionOf({}).version.isWholesaleOnly).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.validator" -t "SEO" 2>&1 | tail -20
```

기대: FAIL — `version.seoTitle` 이 `undefined`.

- [ ] **Step 3: 구현한다**

`validateFields` 안, `version.isOverseas = ...` 세 줄 **바로 위**에 추가한다.

```typescript
    const seoTitle = (raw.seoTitle ?? '').trim();
    if (seoTitle !== '') {
      // seo_title 은 varchar(255) 다. 넘겨도 프리뷰는 통과하고 commit 에서 Postgres 22001 로
      // 그 행만 죽는다 — basePrice 를 입구에서 막는 것과 같은 이유로 여기서 막는다.
      if (seoTitle.length > 255) push(`seoTitle 은 255자 이하여야 합니다 (현재 ${seoTitle.length}자).`);
      else version.seoTitle = seoTitle;
    }

    const seoDescription = (raw.seoDescription ?? '').trim();
    if (seoDescription !== '') version.seoDescription = seoDescription;

    // seo_keywords 는 text[] 다. 구분자는 optionValues 와 같은 '|' 로 맞춘다.
    const seoKeywords = (raw.seoKeywords ?? '')
      .split('|')
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword !== '');
    if (seoKeywords.length > 0) version.seoKeywords = seoKeywords;

    version.isWholesaleOnly = this.bool(raw.isWholesaleOnly);
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import.validator" 2>&1 | tail -20
```

기대: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts
git commit -m "feat(product-import): SEO 3종 + isWholesaleOnly 임포트"
```

---

### Task 6: 판매기간 2종 (KST 경계 해석)

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord.salesStartDate?: string`, `ProductRecord.salesEndDate?: string` (Task 1)
- Produces:
  - `record.salesStartDate`/`record.salesEndDate` 에 **ISO8601 UTC 문자열**(`toISOString()` 결과). `version` 에 넣지 **않는다** — Task 7 이 `Date` 로 되살려 별도로 얹는다.
  - `export function formatKstMinutes(iso: string): string` (import.types.ts) — 프리뷰가 쓴다(Task 9)

**설계 결정**

- 받는 형식은 **`YYYY-MM-DD` 와 `YYYY-MM-DD HH:mm` 둘뿐**이다. 느슨한 `new Date(문자열)` 은 브라우저·Node 구현 재량이라 `08/01/2026` 같은 입력을 조용히 다른 날로 해석한다.
- **날짜만 주면 KST 경계로 해석한다** — 시작은 `00:00:00.000`, 종료는 `23:59:59.999`. MD 는 KST 로 생각하고, 이 값은 `SALES_ENDED` 게이팅에 직접 쓰인다. "8월 31일까지 판매"가 8월 31일 09:00(KST) 에 끝나면 사고다.
- KST 오프셋(`+09:00`)을 **문자열에 명시**해 파싱한다. KST 는 DST 가 없어 항상 UTC+9 이므로 라이브러리가 필요 없고, 서버·CI·개발 머신 TZ 와 무관해진다 (레포에 timestamp/TZ 함정 이력이 있다).
- 순서 비교는 ISO **문자열 비교**로 한다 — 둘 다 `toISOString()` 결과(`Z` 고정, 같은 자릿수)라 사전순 = 시간순이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```typescript
import { formatKstMinutes } from '../dto/import.types';

describe('ProductImportValidator — 판매기간', () => {
  const validator = new ProductImportValidator();

  function salesOf(raw: Record<string, string>) {
    const record: ProductRecord = {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A', basePrice: '29000', ...raw },
      version: {},
      categoryIds: [],
      categoryNames: [],
      options: [],
      variantOverrides: [],
      errors: [],
    };
    return validator.validate([record])[0];
  }

  it('날짜만 주면 시작은 KST 자정, 종료는 KST 하루 끝이다', () => {
    const out = salesOf({ salesStartDate: '2026-08-01', salesEndDate: '2026-08-31' });
    // 2026-08-01 00:00 KST === 2026-07-31T15:00:00.000Z
    expect(out.salesStartDate).toBe('2026-07-31T15:00:00.000Z');
    // 2026-08-31 23:59:59.999 KST === 2026-08-31T14:59:59.999Z
    expect(out.salesEndDate).toBe('2026-08-31T14:59:59.999Z');
    expect(out.errors).toEqual([]);
  });

  it('시각까지 주면 그 분을 KST 로 해석한다', () => {
    const out = salesOf({ salesStartDate: '2026-08-01 14:30' });
    expect(out.salesStartDate).toBe('2026-08-01T05:30:00.000Z');
    expect(out.salesEndDate).toBeUndefined();
  });

  it('version 에는 넣지 않는다 (manager 가 Date 로 되살린다)', () => {
    const out = salesOf({ salesStartDate: '2026-08-01' });
    expect('salesStartDate' in out.version).toBe(false);
  });

  it('형식이 다르면 행 오류', () => {
    for (const bad of ['08/01/2026', '2026-8-1', '2026-08-01T14:30:00Z', 'Sat Aug 01 2026 09:00:00 GMT+0900']) {
      const out = salesOf({ salesStartDate: bad });
      expect(out.errors.some((e) => /salesStartDate/.test(e.message))).toBe(true);
      expect(out.salesStartDate).toBeUndefined();
    }
  });

  it('존재하지 않는 날짜는 행 오류', () => {
    const out = salesOf({ salesStartDate: '2026-02-30' });
    expect(out.errors.some((e) => /salesStartDate/.test(e.message))).toBe(true);
  });

  it('종료가 시작보다 앞이면 행 오류이고 둘 다 버린다', () => {
    const out = salesOf({ salesStartDate: '2026-08-31', salesEndDate: '2026-08-01' });
    expect(out.errors.some((e) => /salesEndDate/.test(e.message))).toBe(true);
    expect(out.salesStartDate).toBeUndefined();
    expect(out.salesEndDate).toBeUndefined();
  });

  it('빈 칸은 아무 것도 만들지 않는다', () => {
    const out = salesOf({ salesStartDate: '', salesEndDate: '  ' });
    expect(out.salesStartDate).toBeUndefined();
    expect(out.salesEndDate).toBeUndefined();
    expect(out.errors).toEqual([]);
  });

  it('formatKstMinutes 는 KST 분 단위로 되돌린다', () => {
    expect(formatKstMinutes('2026-07-31T15:00:00.000Z')).toBe('2026-08-01 00:00');
    expect(formatKstMinutes('2026-08-31T14:59:59.999Z')).toBe('2026-08-31 23:59');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.validator" -t "판매기간" 2>&1 | tail -25
```

기대: FAIL — `formatKstMinutes` 미존재로 컴파일 오류.

- [ ] **Step 3: 표시 헬퍼를 추가한다**

`import.types.ts` 의 `parseBoolCell` 아래에 추가한다.

```typescript
/**
 * ISO8601 → 'YYYY-MM-DD HH:mm' (KST). 프리뷰 표시 전용이다.
 *
 * KST 는 DST 가 없어 항상 UTC+9 이므로 오프셋을 더한 뒤 UTC 성분을 읽으면 정확하다 —
 * 서버·CI TZ 와 무관해지고 Intl 로케일 데이터에도 의존하지 않는다.
 */
export function formatKstMinutes(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace('T', ' ');
}
```

- [ ] **Step 4: 검증기를 구현한다**

`product-import.validator.ts` 파일 상단 상수 뒤에 추가한다.

```typescript
const SALES_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SALES_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
/**
 * 날짜만 적힌 칸을 KST 경계로 해석한다. UTC 로 읽으면 "8월 31일까지 판매"가 그날
 * 09:00(KST) 에 끝나 SALES_ENDED 로 조용히 품절된다 — MD 는 KST 로 생각한다.
 * KST 는 DST 가 없어 오프셋이 항상 +09:00 이므로 문자열에 박아 넣으면 서버 TZ 와 무관해진다.
 */
const KST_OFFSET = '+09:00';
```

`validateFields` 안, `record.version = version;` **바로 위**에 추가한다.

```typescript
    // ISO 문자열로 둔다 — payload jsonb 왕복에서 Date 는 문자열이 되므로 version 에 Date 를
    // 넣으면 워커가 문자열을 drizzle timestamp 컬럼에 그대로 넘겨 TypeError 로 그 행이 죽는다.
    // Date 로 되살리는 지점은 ProductImportManager.createFromRecord 한 곳이다.
    const salesStartDate = this.salesDate(raw.salesStartDate, 'salesStartDate', false, push);
    const salesEndDate = this.salesDate(raw.salesEndDate, 'salesEndDate', true, push);
    if (salesStartDate !== undefined && salesEndDate !== undefined && salesStartDate >= salesEndDate) {
      // 둘 다 toISOString() 결과(Z 고정·같은 자릿수)라 사전순 비교 = 시간순 비교다.
      push('salesEndDate 는 salesStartDate 보다 뒤여야 합니다.');
    } else {
      record.salesStartDate = salesStartDate;
      record.salesEndDate = salesEndDate;
    }
```

`bool()` 위에 메서드를 추가한다.

```typescript
  /**
   * 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 을 KST 로 해석해 ISO8601(UTC) 문자열로 돌려준다.
   *
   * 느슨한 `new Date(문자열)` 을 쓰지 않는 이유: '08/01/2026' 같은 입력을 구현 재량으로
   * 조용히 해석해 MD 의 의도와 다른 날짜가 게시된다. 형식을 좁히고 명시적으로 거부한다.
   * (엑셀 날짜 서식 셀은 파서가 이미 이 두 형식으로 정규화한다 — product-import.parser.ts)
   *
   * endOfDay 는 종료일 전용이다. 날짜만 주면 그 날 23:59:59.999(KST)까지 판매한다는 뜻이다.
   */
  private salesDate(
    raw: string | undefined,
    field: string,
    endOfDay: boolean,
    push: (m: string) => void,
  ): string | undefined {
    const value = (raw ?? '').trim();
    if (value === '') return undefined;

    let iso: string;
    if (SALES_DATE_ONLY.test(value)) {
      iso = `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${KST_OFFSET}`;
    } else if (SALES_DATE_TIME.test(value)) {
      iso = `${value.replace(' ', 'T')}:00.000${KST_OFFSET}`;
    } else {
      push(`${field} 는 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' 형식이어야 합니다: ${value}`);
      return undefined;
    }

    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      // 정규식은 통과하지만 실재하지 않는 날짜(2026-02-30 등)
      push(`${field} 는 존재하지 않는 날짜입니다: ${value}`);
      return undefined;
    }
    return parsed.toISOString();
  }
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -20
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/dto/import.types.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts
git commit -m "feat(product-import): 판매기간 임포트 (KST 경계 해석)"
```

---

### Task 7: 생성 경로 배선 — Date 되살리기 + 구매제약 쓰기

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts` (`isProductRecord` export 만)
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes:
  - `record.salesStartDate?: string` / `record.salesEndDate?: string` (Task 6)
  - `record.purchaseConstraint?: NormalizedPurchaseConstraint` (Task 4)
  - `ProductPurchaseConstraintsService.upsertForDraft(masterId: string, versionId: string, input: { requiresMembership: boolean; lifetimeQuantityLimit?: number | null }, tx?: DbTransaction)` — `ProductsModule` 이 이미 export 한다
  - `this.productMastersService.createMaster(userId, tx)` → `{ id, masterId }`
- Produces:
  - `ProductImportManager` 생성자 6번째 인자 `purchaseConstraintsService` (**끝에 추가** — 기존 인자 순서를 흔들지 않는다)
  - `export function isProductRecord(value: unknown): value is ProductRecord` (job.manager.ts) — Task 10 이 쓴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.manager.spec.ts` 의 하네스에 목을 추가하고 생성자 호출을 고친다.

```typescript
  const purchaseConstraintsService = { upsertForDraft: jest.fn(async () => null) } as any;
  const manager = new ProductImportManager(
    db,
    reader,
    productMastersService,
    pricingService,
    pricingBuilder,
    purchaseConstraintsService,
  );
```

그리고 아래 describe 를 추가한다.

```typescript
describe('createFromRecord — v3 3단계 필드', () => {
  function baseRecord(): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A' },
      version: { name: '니트A', seoTitle: '겨울 니트', seoKeywords: ['니트', '겨울'], isWholesaleOnly: true },
      basePrice: 29000,
      categoryIds: ['c-knit', 'c-event'],
      categoryNames: ['여성패션', '니트'],
      primaryCategoryId: 'c-knit',
      options: [],
      variantOverrides: [],
      errors: [],
    };
  }

  it('다중 카테고리와 대표 카테고리를 updateVersion 에 넘긴다', async () => {
    const { manager, productMastersService } = harness();
    await manager.createFromRecord(baseRecord(), 'u1', {} as any);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect(data.categoryIds).toEqual(['c-knit', 'c-event']);
    expect(data.primaryCategoryId).toBe('c-knit');
    expect(data.seoKeywords).toEqual(['니트', '겨울']);
    expect(data.isWholesaleOnly).toBe(true);
  });

  it('ISO 문자열 판매기간을 Date 로 되살려 넘긴다', async () => {
    const { manager, productMastersService } = harness();
    const record = baseRecord();
    // 워커는 항상 jsonb 왕복을 거친 값을 본다 — 그 형태를 그대로 재현한다
    record.salesStartDate = '2026-07-31T15:00:00.000Z';
    record.salesEndDate = '2026-08-31T14:59:59.999Z';

    await manager.createFromRecord(record, 'u1', {} as any);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect(data.salesStartDate).toBeInstanceOf(Date);
    expect((data.salesStartDate as Date).toISOString()).toBe('2026-07-31T15:00:00.000Z');
    expect((data.salesEndDate as Date).toISOString()).toBe('2026-08-31T14:59:59.999Z');
  });

  it('판매기간이 없으면 키 자체를 넣지 않는다 (기존 값을 null 로 덮지 않는다)', async () => {
    const { manager, productMastersService } = harness();
    await manager.createFromRecord(baseRecord(), 'u1', {} as any);

    const [, data] = productMastersService.updateVersion.mock.calls[0];
    expect('salesStartDate' in data).toBe(false);
    expect('salesEndDate' in data).toBe(false);
  });

  it('구매제약이 있으면 draft 에 upsert 한다', async () => {
    const { manager, purchaseConstraintsService } = harness();
    const record = baseRecord();
    record.purchaseConstraint = { requiresMembership: true, lifetimeQuantityLimit: 2 };

    await manager.createFromRecord(record, 'u1', {} as any);

    expect(purchaseConstraintsService.upsertForDraft).toHaveBeenCalledWith(
      'm1',
      'v1',
      { requiresMembership: true, lifetimeQuantityLimit: 2 },
      expect.anything(),
    );
  });

  it('구매제약이 없으면 아예 호출하지 않는다', async () => {
    const { manager, purchaseConstraintsService } = harness();
    await manager.createFromRecord(baseRecord(), 'u1', {} as any);
    expect(purchaseConstraintsService.upsertForDraft).not.toHaveBeenCalled();
  });
});
```

기존 스펙에 `harness()` 팩토리가 없다면(현재는 describe 최상단에 목을 늘어놓는 형태다) 그 목 블록을 함수로 감싸 `{ manager, db, reader, productMastersService, pricingService, pricingBuilder, purchaseConstraintsService }` 를 돌려주게 리팩터한다. 각 `it` 이 목 호출 이력을 공유하지 않아야 `not.toHaveBeenCalled()` 가 의미를 갖는다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.manager" 2>&1 | tail -25
```

기대: FAIL — 생성자 인자 수 불일치 / `salesStartDate` 가 `undefined`.

- [ ] **Step 3: 구현한다**

`product-import.manager.ts` 에 import 를 추가한다.

```typescript
import { ProductPurchaseConstraintsService } from '../../../core/products/services/product-purchase-constraints.service';
```

생성자 **끝에** 주입을 추가한다.

```typescript
    private readonly pricingBuilder: ProductImportPricingBuilder,
    private readonly purchaseConstraintsService: ProductPurchaseConstraintsService,
  ) {}
```

`createFromRecord` 의 `data` 조립과 `updateVersion` 호출부를 교체한다.

```typescript
    const version = await this.productMastersService.createMaster(userId, tx);
    const data: UpdateProductMasterVersion = {
      ...record.version,
      categoryIds: record.categoryIds,
      primaryCategoryId: record.primaryCategoryId,
      // 판매기간은 record 가 ISO **문자열**로 들고 있다 — payload jsonb 왕복에서 Date 가
      // 문자열이 되므로 처음부터 문자열로 두고 여기서만 되살린다. 문자열을 그대로 넘기면
      // drizzle 의 timestamp 매퍼가 값의 .toISOString() 을 불러 TypeError 로 그 행이 죽는다.
      // 값이 없으면 키 자체를 만들지 않는다 — undefined 를 넣으면 drizzle 이 무시하지만,
      // 의도(설정 안 함)와 표현(null 로 덮기)을 구분해 두는 편이 읽기 쉽다.
      ...(record.salesStartDate ? { salesStartDate: new Date(record.salesStartDate) } : {}),
      ...(record.salesEndDate ? { salesEndDate: new Date(record.salesEndDate) } : {}),
      optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
    };
    await this.productMastersService.updateVersion(version.id, data, tx);

    // 구매제약은 버전 스칼라가 아니라 별도 테이블 + 매핑이다. 값이 없을 때 호출하지 않는
    // 이유는 upsertForVersion 의 isDeleteIntent 가 "requiresMembership=false + limit=null" 을
    // **삭제**로 해석하기 때문이다 — 신규 생성엔 지울 것이 없으니 왕복만 늘어난다.
    // publishVersion 은 같은 versionId 의 status 만 뒤집으므로(product-versions.service.ts:302)
    // 여기서 draft 에 심은 매핑이 게시 후에도 그대로 유효하다.
    if (record.purchaseConstraint) {
      await this.purchaseConstraintsService.upsertForDraft(
        version.masterId,
        version.id,
        record.purchaseConstraint,
        tx,
      );
    }
```

- [ ] **Step 4: `isProductRecord` 를 export 한다**

`product-import-job.manager.ts` 의 함수 선언에 `export` 를 붙인다. 신규 필드는 전부 optional 이라 **가드 본문은 바꿀 필요가 없다** — v2 형태 payload 도 그대로 통과해야 하고, 지금 그렇다.

```typescript
export function isProductRecord(value: unknown): value is ProductRecord {
```

- [ ] **Step 5: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -20
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import-job.manager.ts
git commit -m "feat(product-import): 판매기간·구매제약을 생성 경로에 배선"
```

---

### Task 8: 템플릿 워크북 갱신

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.template.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts`

**Interfaces:**
- Consumes: 파서·정규화기·검증기 전체 (템플릿 스펙은 자기 파이프라인을 왕복한다)
- Produces: `generateTemplateWorkbook()` 이 Products 6컬럼 확장 + `Categories`·`Constraints` 시트를 포함한 버퍼

**중요 — 예시 행 배치 규칙**

`Products.categoryPath` 와 `Categories` 시트를 같은 상품(P1)에 동시에 쓰면 Task 3 의 충돌 오류가 난다. 그 오류 메시지에는 한국어 "카테고리"가 없어 기존 템플릿 스펙의 `/카테고리/` 필터에 걸러지지 않고 **테스트가 빨강이 된다.** 그래서 템플릿은 `categoryPath` 칸을 **비우고** 새 `Categories` 시트로 P1 을 지정한다 (컬럼 자체는 하위호환으로 남긴다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.template.spec.ts` 에 추가한다.

```typescript
  it('Products 헤더에 v3 3단계 컬럼 6개가 있다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    const headers = Object.keys(parsed.products[0].cells);
    expect(headers).toEqual(
      expect.arrayContaining([
        'seoTitle',
        'seoDescription',
        'seoKeywords',
        'isWholesaleOnly',
        'salesStartDate',
        'salesEndDate',
      ]),
    );
    // 하위호환 컬럼은 남긴다
    expect(headers).toContain('categoryPath');
  });

  it('Categories·Constraints 예시 시트가 있고 P1 을 가리킨다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    expect(parsed.categories.length).toBeGreaterThanOrEqual(2);
    expect(parsed.categories.every((r) => r.cells.productKey === 'P1')).toBe(true);
    expect(parsed.categories.filter((r) => r.cells.isPrimary === 'Y')).toHaveLength(1);
    expect(parsed.constraints).toHaveLength(1);
    expect(parsed.constraints[0].cells.productKey).toBe('P1');
  });

  it('Products.categoryPath 는 비어 있다 (Categories 시트와 충돌하지 않게)', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    expect(parsed.products[0].cells.categoryPath).toBe('');
  });

  it('예시 판매기간·SEO 가 검증기를 통과한다', async () => {
    const parsed = await new ProductImportParser().parse(await generateTemplateWorkbook());
    const records = new ProductImportValidator().validate(new ProductImportNormalizer().normalize(parsed, []));
    const p1 = records.find((r) => r.productKey === 'P1' && Object.keys(r.raw).length > 0);

    expect(p1!.salesStartDate).toBeDefined();
    expect(p1!.salesEndDate).toBeDefined();
    expect(p1!.version.seoKeywords).toEqual(expect.arrayContaining(['니트']));
    expect(p1!.purchaseConstraint).toEqual({ requiresMembership: false, lifetimeQuantityLimit: 2 });
  });
```

기존 테스트 `'템플릿 예시 행은 자기 파이프라인을 오류 없이 통과한다'` 는 **그대로 초록이어야 한다** — 빈 카테고리 트리(`normalize(parsed, [])`)에서 `Categories` 행은 "카테고리 경로를 해석할 수 없습니다"만 내고, Task 3 이 그 경우 `isPrimary` 개수 오류를 덧붙이지 않게 만들었으므로 `/카테고리/` 필터가 전부 걸러낸다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.template" 2>&1 | tail -25
```

기대: FAIL — 새 헤더가 없고 `parsed.categories` 가 빈 배열.

- [ ] **Step 3: 구현한다**

`product-import.template.ts` 를 아래로 교체한다.

```typescript
import * as ExcelJS from 'exceljs';

const PRODUCT_HEADERS = [
  'productKey',
  'name',
  'basePrice',
  'membershipPrice',
  'productCode',
  'brand',
  'alternativeName',
  'description',
  'material',
  'marketPrice',
  'supplyPrice',
  'productType',
  'fulfillmentKind',
  'salesClassification',
  'purchaseClassification',
  'ageRestriction',
  'minQuantity',
  'maxQuantity',
  'seller',
  'categoryPath',
  'isOverseas',
  'isVisibleToMembersOnly',
  'hideMembershipPriceForNonMembers',
  'seoTitle',
  'seoDescription',
  'seoKeywords',
  'isWholesaleOnly',
  'salesStartDate',
  'salesEndDate',
];

const OPTION_HEADERS = ['productKey', 'optionName', 'optionValues', 'sortOrder'];
const VARIANT_HEADERS = ['productKey', 'optionCombination', 'basePrice', 'membershipPrice', 'variantCode'];
const CATEGORY_HEADERS = ['productKey', 'categoryPath', 'isPrimary'];
const CONSTRAINT_HEADERS = ['productKey', 'requiresMembership', 'lifetimeQuantityLimit'];

export async function generateTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const products = wb.addWorksheet('Products');
  products.addRow(PRODUCT_HEADERS);
  products.addRow([
    'P1',
    '예시 니트',
    '29000',
    '26000',
    'PROD-001',
    'ACME',
    '',
    '부드러운 니트',
    '아크릴 100%',
    '39000',
    '12000',
    'regular_sale',
    'physical',
    '의류',
    '사입',
    '0',
    '1',
    '10',
    'ACME',
    // categoryPath 는 하위호환으로 남긴 단일 지정 컬럼이다. 아래 Categories 시트와
    // **같은 상품에 동시 사용하면 행 오류**라 예시는 시트 쪽만 채운다.
    '',
    'N',
    'N',
    'N',
    '겨울 니트 추천',
    '부드럽고 따뜻한 겨울 니트',
    // '|' 구분 — optionValues 와 같은 규칙
    '니트|겨울|여성니트',
    'N',
    // 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm'. 날짜만 주면 KST 기준으로 시작은 00:00,
    // 종료는 23:59:59 로 해석한다.
    '2026-08-01',
    '2026-12-31',
  ]);

  const options = wb.addWorksheet('Options');
  options.addRow(OPTION_HEADERS);
  options.addRow(['P1', '색상', '빨강|파랑', '0']);
  options.addRow(['P1', '사이즈', 'S|M|L', '1']);

  // 선택 시트. 조합별로 가격을 달리하거나 variantCode 를 심을 때만 채운다.
  // 빈 칸은 Products 기본가를 상속한다. 축 순서는 무시된다.
  const variants = wb.addWorksheet('Variants');
  variants.addRow(VARIANT_HEADERS);
  variants.addRow(['P1', '색상=빨강;사이즈=L', '31000', '', 'KNIT-RD-L']);
  variants.addRow(['P1', '색상=파랑;사이즈=S', '', '', 'KNIT-BL-S']);

  // 선택 시트. 상품 하나를 여러 카테고리에 넣을 때 쓴다. isPrimary 는 **상품당 정확히 1개**.
  // 기존 트리에 이미 있는 카테고리만 지정할 수 있다(임포트가 카테고리를 만들지는 않는다).
  const categories = wb.addWorksheet('Categories');
  categories.addRow(CATEGORY_HEADERS);
  categories.addRow(['P1', '여성패션>니트', 'Y']);
  categories.addRow(['P1', '기획전>겨울신상', 'N']);

  // 선택 시트. 상품당 최대 한 행. 둘 다 비우면 제약을 만들지 않는다.
  const constraints = wb.addWorksheet('Constraints');
  constraints.addRow(CONSTRAINT_HEADERS);
  constraints.addRow(['P1', 'N', '2']);

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -25
```

기대: 템플릿 스펙 전부 PASS, **기존 4개 테스트도 초록 유지**.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.template.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts
git commit -m "feat(product-import): 템플릿에 스칼라 6종 + Categories·Constraints 시트"
```

---

### Task 9: 프리뷰 확장 — 카테고리 개수 + 판매기간

**Files:**
- Modify: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts`
- Modify: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts`
- Modify: `apps/admin-web/src/lib/types/dto/product-import.ts`
- Modify: `apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts`

**Interfaces:**
- Consumes: `record.categoryIds`, `record.categoryNames`, `record.salesStartDate`, `record.salesEndDate`, `formatKstMinutes` (Task 6)
- Produces:
  - `ResolvedPreviewDto.categoryCount: number` — 지정된 카테고리 총 개수 (`categoryNames` 는 그중 **대표**의 조상 경로)
  - `ResolvedPreviewDto.salesPeriod: string | null` — `'YYYY-MM-DD HH:mm ~ YYYY-MM-DD HH:mm'` (KST), 지정 없으면 `null`
  - admin-web 미러 타입 동일 필드

`salesPeriod` 를 프리뷰에 넣는 것이 판매기간의 **유일한 안전장치**다 — 계획 상단 "이 단계가 지불하는 대가" 참고. admin UI 에 편집·해제 수단이 없으므로 커밋 전에 눈으로 확인할 수 있어야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`product-import.service.spec.ts` 에 추가한다 (기존 스펙의 목 하네스를 그대로 쓴다 — `validate()` 는 파이프라인 목을 통해 레코드를 주입받는다).

```typescript
  it('프리뷰가 카테고리 개수와 KST 판매기간을 담는다', async () => {
    const { service, setRecords } = harness();
    setRecords([
      {
        rowNumber: 1,
        productKey: 'P1',
        raw: { name: '니트A' },
        version: { name: '니트A' },
        basePrice: 29000,
        categoryIds: ['c-knit', 'c-event'],
        categoryNames: ['여성패션', '니트'],
        primaryCategoryId: 'c-knit',
        options: [],
        variantOverrides: [],
        errors: [],
        salesStartDate: '2026-07-31T15:00:00.000Z',
        salesEndDate: '2026-08-31T14:59:59.999Z',
      },
    ]);

    const preview = await service.validate(Buffer.from(''));

    expect(preview.rows[0].resolved.categoryCount).toBe(2);
    expect(preview.rows[0].resolved.categoryNames).toEqual(['여성패션', '니트']);
    expect(preview.rows[0].resolved.salesPeriod).toBe('2026-08-01 00:00 ~ 2026-08-31 23:59');
  });

  it('판매기간이 없으면 null 이다', async () => {
    const { service, setRecords } = harness();
    setRecords([
      {
        rowNumber: 1,
        productKey: 'P1',
        raw: { name: '니트A' },
        version: { name: '니트A' },
        basePrice: 29000,
        categoryIds: [],
        categoryNames: [],
        options: [],
        variantOverrides: [],
        errors: [],
      },
    ]);

    const preview = await service.validate(Buffer.from(''));
    expect(preview.rows[0].resolved.salesPeriod).toBeNull();
    expect(preview.rows[0].resolved.categoryCount).toBe(0);
  });
```

기존 스펙에 `harness()`/`setRecords` 가 없으면(파서·정규화기·검증기를 각각 목으로 넘기는 형태다) 그 목 조립을 함수로 감싸고, `validator.validate` 목이 주어진 레코드 배열을 돌려주게 한다.

- [ ] **Step 2: 실패를 확인한다**

```bash
npx jest --testPathPattern="product-import.service" 2>&1 | tail -25
```

기대: FAIL — `categoryCount` 가 `undefined`.

- [ ] **Step 3: core DTO 를 넓힌다**

`import-response.dto.ts` 의 `ResolvedPreviewDto` 에 추가한다 (`@ApiProperty` 는 파일의 기존 관례를 따른다).

```typescript
  @ApiProperty({ description: '지정된 카테고리 총 개수. categoryNames 는 그중 대표 카테고리의 경로다.' })
  categoryCount: number;

  @ApiProperty({
    description: "판매기간 'YYYY-MM-DD HH:mm ~ YYYY-MM-DD HH:mm' (KST). 지정 없으면 null.",
    nullable: true,
  })
  salesPeriod: string | null;
```

- [ ] **Step 4: 서비스 조립을 고친다**

`product-import.service.ts` 의 import 를 넓힌다.

```typescript
import { ProductRecord, formatKstMinutes } from '../dto/import.types';
```

`validate()` 의 `resolved` 를 교체한다.

```typescript
      resolved: {
        name: typeof r.version.name === 'string' ? r.version.name : (r.raw.name ?? ''),
        categoryNames: r.categoryNames,
        categoryCount: r.categoryIds.length,
        salesPeriod: this.salesPeriod(r),
        variantCount: this.variantCount(r),
      },
```

`variantCount` 아래에 메서드를 추가한다.

```typescript
  /**
   * 판매기간을 KST 로 사람이 읽을 수 있게 만든다.
   *
   * 프리뷰에 넣는 이유가 있다 — sales_start_date/sales_end_date 는 **임포트가 유일한 쓰기
   * 경로**이고 admin 화면에 편집·해제 수단이 없다(레포 전체에 다른 write 경로가 없다).
   * 잘못 넣으면 상품은 정상 게시되고 스토어프론트에서만 SALES_ENDED 로 조용히 품절되므로,
   * 커밋 전에 확인할 수 있는 자리가 여기뿐이다.
   */
  private salesPeriod(record: ProductRecord): string | null {
    if (!record.salesStartDate && !record.salesEndDate) return null;
    const start = record.salesStartDate ? formatKstMinutes(record.salesStartDate) : '';
    const end = record.salesEndDate ? formatKstMinutes(record.salesEndDate) : '';
    return `${start} ~ ${end}`;
  }
```

- [ ] **Step 5: core 테스트 통과를 확인한다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -20
npm run type-check:scoped 2>&1 | tail -10
```

기대: 전부 PASS.

- [ ] **Step 6: admin-web 미러 타입을 고친다**

`apps/admin-web/src/lib/types/dto/product-import.ts` 의 `ResolvedPreview` 를 교체한다.

```typescript
export interface ResolvedPreview {
  name: string;
  /** 대표 카테고리의 조상 경로. 지정된 카테고리 총 개수는 categoryCount 에 있다. */
  categoryNames: string[];
  /** 지정된 카테고리 총 개수 (Categories 시트로 다중 지정 가능). */
  categoryCount: number;
  /**
   * 'YYYY-MM-DD HH:mm ~ YYYY-MM-DD HH:mm' (KST). 지정 없으면 null.
   * 임포트가 판매기간의 유일한 쓰기 경로라 화면에서 고칠 수 없다 — 커밋 전에 확인해야 한다.
   */
  salesPeriod: string | null;
  variantCount: number;
}
```

- [ ] **Step 7: 프리뷰 표를 고친다**

`validate-step.tsx` 의 헤더에 컬럼을 추가한다 (`변형 수` 앞).

```tsx
              <th className="p-2">카테고리</th>
              <th className="p-2">판매기간</th>
              <th className="p-2">변형 수</th>
```

그리고 본문 셀을 교체한다.

```tsx
                <td className="p-2">
                  {r.resolved.categoryNames.join(' > ')}
                  {r.resolved.categoryCount > 1 && (
                    <span className="text-muted-foreground">
                      {' '}
                      +{r.resolved.categoryCount - 1}
                    </span>
                  )}
                </td>
                <td className="p-2 whitespace-nowrap">
                  {r.resolved.salesPeriod ?? '-'}
                </td>
                <td className="p-2">{r.resolved.variantCount}</td>
```

- [ ] **Step 8: admin-web 타입 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "product-import|validate-step" ; cd -
```

기대: 위 grep 결과가 **비어 있다.** (admin-web 전역 `type-check` 는 develop 에서도 red 인 상시 debt다 — 변경 파일만 본다.)

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.service.ts \
        apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts \
        apps/admin-web/src/lib/types/dto/product-import.ts \
        apps/admin-web/src/features/mall/product-imports/wizard/validate-step.tsx
git commit -m "feat(product-import): 프리뷰에 카테고리 개수·KST 판매기간 표시"
```

---

### Task 10: payload jsonb 왕복 통합 테스트 (실 Postgres)

목 하네스로는 증명할 수 없는 것 하나를 본다: **`ProductRecord` 를 jsonb 로 넣고 꺼내면 신규 필드가 어떤 타입으로 돌아오는가.** 이 계획의 가장 미묘한 결정(판매기간을 Date 대신 ISO 문자열로 들고 다니기)이 그 답에 의존하고, 틀리면 워커가 매 행에서 TypeError 로 죽는다.

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-payload-roundtrip.integration.spec.ts`
- Modify: `package.json` (npm 스크립트 1줄)

**Interfaces:**
- Consumes: `isProductRecord` (Task 7 에서 export), `catalogSchema`/`PimSchema`/`productImportSessions`/`productImportItems` (기존 스키마 export)
- Produces: `npm run test:product-import-payload:integration`

선례는 `product-import-progress.integration.spec.ts` 다 — 일회용 스키마 + `CREATE TABLE (LIKE public.x INCLUDING ALL)` + `REQUIRE_*_DB` 게이트. 손으로 옮겨 적은 테이블에 대고 통과하는 테스트는 아무 것도 증명하지 않으므로 **실제 DDL 을 복제한다.**

- [ ] **Step 1: 통합 스펙을 쓴다**

```typescript
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { catalogSchema, productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { isProductRecord } from './product-import-job.manager';
import { ProductRecord } from '../dto/import.types';

/**
 * payload jsonb 왕복을 **진짜 Postgres** 에 대고 본다.
 *
 * 목 하네스는 넣은 객체를 그대로 돌려주므로 Date 가 문자열이 되는 것을 볼 수 없다.
 * 이 계획은 판매기간을 ISO 문자열로 들고 다니는 결정을 그 사실 위에 세웠으므로,
 * 그 사실 자체를 여기서 고정한다.
 *
 * **격리**: 일회용 스키마 + search_path (선례: product-import-progress.integration.spec.ts:20-45)
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_PRODUCT_IMPORT_PAYLOAD_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the product import payload roundtrip suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('product import payload jsonb 왕복 (DB 통합)', () => {
  jest.setTimeout(120_000);

  const schemaName = `pi_payload_${randomUUID().replaceAll('-', '')}`;
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof catalogSchema>>;

  beforeAll(async () => {
    const bootstrap = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    await bootstrap.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await bootstrap.end();

    admin = postgres(DATABASE_URL as string, { max: 1, prepare: false, connection: { search_path: schemaName } });
    await admin.unsafe(`CREATE TABLE product_import_sessions (LIKE public.product_import_sessions INCLUDING ALL)`);
    await admin.unsafe(`CREATE TABLE product_import_items (LIKE public.product_import_items INCLUDING ALL)`);

    client = postgres(DATABASE_URL as string, { max: 2, prepare: false, connection: { search_path: schemaName } });
    db = drizzle(client, { schema: catalogSchema });
  });

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    await admin?.end();
  });

  async function roundtrip(record: ProductRecord): Promise<unknown> {
    const [session] = await db
      .insert(productImportSessions)
      .values({ fileName: 'roundtrip.xlsx', totalRows: 1, status: 'completed' })
      .returning();
    const [item] = await db
      .insert(productImportItems)
      .values({ sessionId: session.id, rowNumber: 1, productKey: 'P1', status: 'pending', payload: record })
      .returning();
    const [read] = await db.select().from(productImportItems).where(eq(productImportItems.id, item.id));
    return read.payload;
  }

  function v3Record(): ProductRecord {
    return {
      rowNumber: 1,
      productKey: 'P1',
      raw: { productKey: 'P1', name: '니트A' },
      version: { name: '니트A', seoTitle: '겨울 니트', seoKeywords: ['니트', '겨울'], isWholesaleOnly: true },
      basePrice: 29000,
      membershipPrice: 26000,
      categoryIds: ['c-knit', 'c-event'],
      categoryNames: ['여성패션', '니트'],
      primaryCategoryId: 'c-knit',
      options: [],
      variantOverrides: [],
      errors: [],
      purchaseConstraint: { requiresMembership: true, lifetimeQuantityLimit: 2 },
      salesStartDate: '2026-07-31T15:00:00.000Z',
      salesEndDate: '2026-08-31T14:59:59.999Z',
    };
  }

  it('신규 필드가 값과 타입을 그대로 유지한다', async () => {
    const payload = await roundtrip(v3Record());
    expect(isProductRecord(payload)).toBe(true);

    const record = payload as ProductRecord;
    expect(record.categoryIds).toEqual(['c-knit', 'c-event']);
    expect(record.primaryCategoryId).toBe('c-knit');
    expect(record.purchaseConstraint).toEqual({ requiresMembership: true, lifetimeQuantityLimit: 2 });
    expect(record.version.seoKeywords).toEqual(['니트', '겨울']);
    expect(record.version.isWholesaleOnly).toBe(true);

    // 핵심: 문자열로 넣었으니 문자열로 온다 — manager 가 여기서 Date 로 되살린다.
    expect(typeof record.salesStartDate).toBe('string');
    expect(record.salesStartDate).toBe('2026-07-31T15:00:00.000Z');
    expect(Number.isNaN(new Date(record.salesStartDate as string).getTime())).toBe(false);
  });

  it('Date 를 넣으면 문자열로 돌아온다 — 이 계획이 문자열을 택한 이유', async () => {
    const record = v3Record();
    // 일부러 타입을 어겨 왕복 동작 자체를 고정한다.
    const withDate = { ...record, version: { ...record.version, salesStartDate: new Date('2026-08-01T00:00:00Z') } };
    const payload = (await roundtrip(withDate as ProductRecord)) as { version: Record<string, unknown> };
    expect(typeof payload.version.salesStartDate).toBe('string');
  });

  it('v2 형태 payload(신규 필드 없음)도 그대로 통과한다', async () => {
    const record = v3Record();
    delete record.purchaseConstraint;
    delete record.salesStartDate;
    delete record.salesEndDate;

    const payload = await roundtrip(record);
    expect(isProductRecord(payload)).toBe(true);
    expect((payload as ProductRecord).purchaseConstraint).toBeUndefined();
    expect((payload as ProductRecord).salesStartDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: npm 스크립트를 추가한다**

`package.json` 의 `test:product-import-progress:integration` 바로 아래에 넣는다.

```json
    "test:product-import-payload:integration": "REQUIRE_PRODUCT_IMPORT_PAYLOAD_DB=1 jest --runInBand apps/core/src/modules/catalog/operations/import/services/product-import-payload-roundtrip.integration.spec.ts",
```

- [ ] **Step 3: DB 없이 skip 되는지 확인한다**

```bash
npx jest --testPathPattern="payload-roundtrip" 2>&1 | tail -10
```

기대: `DATABASE_URL` 이 없으면 skip(초록). 있으면 실제로 돌고 PASS.

- [ ] **Step 4: 실제 DB 로 돌린다**

`apps/core/.env` 의 `DATABASE_URL` 을 쓴다.

```bash
npx dotenv -e apps/core/.env -- npm run test:product-import-payload:integration 2>&1 | tail -30
```

기대: 3개 테스트 PASS.

DB 에 닿을 수 없으면 **여기서 멈추고 사람에게 보고한다** — 이 태스크의 존재 이유가 실 DB 확인이므로 skip 을 통과로 세지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-payload-roundtrip.integration.spec.ts \
        package.json
git commit -m "test(product-import): payload jsonb 왕복 통합 테스트"
```

---

### Task 11: 최종 검증 + 스펙 문서 상태 갱신

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md`

**Interfaces:**
- Consumes: Task 1~10 전부
- Produces: 없음 (검증 + 문서)

- [ ] **Step 1: 변경 파일 기준으로 테스트를 돌린다**

```bash
npx jest --testPathPattern="product-import" 2>&1 | tail -15
```

기대: 전 스펙 PASS, skip 은 DB 통합 하나뿐.

- [ ] **Step 2: core 타입 게이트**

```bash
npm run type-check:scoped 2>&1 | tail -20
```

기대: 변경 파일에 대한 신규 error 0건. **전역 `tsc`·전역 `jest`·`nest build core` 는 develop 에서도 red 인 상시 debt 이므로 판정 근거로 쓰지 않는다.**

- [ ] **Step 3: admin-web 타입 게이트 (변경 파일 스코프)**

```bash
cd apps/admin-web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "product-import|validate-step" ; cd -
```

기대: 결과 없음.

- [ ] **Step 4: 변경 파일 lint (전역 `--fix` 를 부르지 않는다)**

```bash
npx eslint $(git diff --name-only develop...HEAD -- '*.ts' '*.tsx' | tr '\n' ' ') 2>&1 | tail -20
```

기대: 변경 파일에 신규 error 0건 (warning 은 레포 관례상 허용).

- [ ] **Step 5: 스펙 문서의 단계 표를 갱신한다**

`docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md` §6 표의 3단계 행을 고친다.

```markdown
| **3** | 순수 스칼라 필드 6종 + `Categories`·`Constraints` 시트 | core → admin-web — **구현 완료(2026-07-30)**, 마이그레이션 0건 |
```

같은 문서 §2.2 표의 "등록 불가한 필드" 에서 3단계가 해결한 항목을 옮긴다 — `seoTitle`/`seoDescription`/`seoKeywords`, `isWholesaleOnly`, `salesStartDate`/`salesEndDate` 를 버전 스칼라 행에서 지우고, 구조적 제약 행의 "카테고리 1개만" 을 "카테고리 신규 생성 불가(기존 트리 해석만)" 로 좁힌다. 구매제약(`requiresMembership`·`lifetimeQuantityLimit`)도 연관 엔티티 행에서 지운다. **남는 것**: `thumbnail`·부가이미지(4단계), 태그, 옵션값별 속성, upsert.

§5 "알려진 결함" 에 한 줄 추가한다.

```markdown
- **판매기간에 편집·해제 UI 가 없다.** `sales_start_date`/`sales_end_date` 는 재고 게이팅이 읽지만(`product-sellable-quantity.calculator.ts:90-96`) 쓰기 경로가 v3 3단계 임포트뿐이다. 잘못 넣으면 화면에서 고칠 수 없고 스토어프론트만 조용히 품절된다 — 3단계는 프리뷰 표시(`resolved.salesPeriod`)로 커밋 전 확인만 제공한다. admin UI 판매기간 편집은 별건.
- **varchar 길이 검증이 seoTitle 에만 있다.** `name`(255)·`brand`(100)·`productCode`(100)·`alternativeName`(255)·`salesClassification`(100)·`purchaseClassification`(100)·`seller`(100) 는 여전히 입구를 통과하고 commit 에서 Postgres 22001 로 그 행만 죽는다. v1 부터 있던 공백이고 5줄짜리 정리 건이다.
```

- [ ] **Step 6: 커밋**

```bash
git add docs/superpowers/specs/2026-07-30-product-bulk-import-v3-fields-and-images-design.md
git commit -m "docs(product-import): v3 3단계 완료 반영 + 판매기간·varchar 공백 기록"
```

- [ ] **Step 7: 사람에게 보고할 것을 정리한다**

머지·배포는 사람의 결정이다. 아래를 정리해 보고한다.

- **마이그레이션 0건** — `apps/core/drizzle/` 에 새 파일이 없음을 확인한다: `git diff --name-only develop...HEAD -- apps/core/drizzle` 가 비어 있어야 한다.
- **배포 결합**: core → admin-web 같은 `sst deploy`. core 가 먼저 떠야 admin-web 프리뷰가 `categoryCount`/`salesPeriod` 를 받는다. 순서가 뒤집히면 그 두 칸이 `undefined`/`-` 로 보일 뿐 깨지지는 않는다.
- **신규 시크릿·env 0건.**
- **미수행**: 브라우저 스모크(프리뷰 표 렌더), dev 환경 실 워크북 1건 임포트(Categories 2행 + Constraints 1행 + 판매기간 → 게시까지). DB 통합 테스트를 돌리지 못했다면 그 사실도 함께 보고한다.

---

## Self-Review

**스펙 커버리지 (§3.1 · §6 3단계)**

| 스펙 요구 | 태스크 |
|---|---|
| Products 신규 컬럼 — `seoTitle`·`seoDescription`·`seoKeywords`(파이프 구분)·`isWholesaleOnly`·`salesStartDate`·`salesEndDate` | 5, 6 |
| `Categories` 시트 (다중 지정, `isPrimary`) | 3 |
| `Constraints` 시트 (`requiresMembership`·`lifetimeQuantityLimit`) | 4 |
| `Products.categoryPath` 유지 + 둘 다 있으면 행 오류 | 3 |
| `Categories.isPrimary` 상품당 정확히 1개 | 3 |
| 행 오류 규칙 계승 (미존재 `productKey`, 해석 불가 경로, 중복) | 3, 4 |
| 템플릿 워크북 갱신 | 8 |
| §7 단위 검증 — `Categories` 다중+isPrimary, `Constraints` 매핑 | 3, 4 |
| §7 타입 게이트 — `type-check:scoped`, 변경파일 차분 | 11 |
| 스코프 밖 유지 — 이미지·태그·`descriptionHtml`·`shippingMethodId`·`supplierId`·옵션값별 속성·upsert·카테고리 신규생성 | 손대지 않음 (Global Constraints 에 명시) |

**스펙에 없지만 이 계획이 추가한 것 (근거 포함)**

1. **Task 2 (엑셀 날짜 셀 정규화)** — 없으면 Excel 자동 서식 때문에 정상 입력이 거부된다. 스펙이 예상하지 못한 통합 지점이다.
2. **`seoTitle` 255자 검증** — `varchar(255)` 초과가 commit 에서 그 행만 죽인다. `basePrice` 를 입구에서 막는 기존 판단과 같은 계열. 다른 varchar 필드까지 넓히는 것은 §5 기록으로만 남긴다(스코프 유지).
3. **`salesStartDate < salesEndDate` 순서 검증 + 프리뷰 `salesPeriod`** — 판매기간이 쓰기 경로 없는 컬럼이라는 실측(Global Constraints)의 직접 대응.
4. **`categoryCount` 프리뷰** — 다중 카테고리를 넣었는데 프리뷰가 한 개만 보여주면 확인이 되지 않는다.
5. **Task 10 (payload 왕복 통합 테스트)** — 스펙 §7 은 이 단계에 통합 테스트를 요구하지 않으나, 판매기간을 문자열로 들고 다니는 결정이 jsonb 왕복 동작에 걸려 있어 목으로는 증명되지 않는다.

**타입 일관성 확인**

- `parseBoolCell` — Task 1 정의, Task 3(`isPrimary`)·Task 4(`requiresMembership`) 사용. 검증기의 기존 `private bool()` 은 그대로 두고(호출부가 여럿) 신규 경로만 공용 헬퍼를 쓴다.
- `formatKstMinutes` — Task 6 정의, Task 9 사용.
- `record.salesStartDate`/`salesEndDate`: 검증기가 넣는 것도(Task 6) manager 가 읽는 것도(Task 7) 통합 테스트가 검사하는 것도(Task 10) 전부 **ISO 문자열**. `version` 에는 절대 들어가지 않는다.
- `NormalizedPurchaseConstraint = { requiresMembership: boolean; lifetimeQuantityLimit: number | null }` — `UpsertPurchaseConstraintDto`(`requiresMembership: boolean; lifetimeQuantityLimit?: number | null`)에 그대로 대입 가능.
- `ResolvedPreviewDto.categoryCount`/`salesPeriod` — core(Task 9 Step 3)와 admin-web 미러(Step 6)가 같은 이름·같은 타입.
- `isProductRecord` — Task 7 에서 export, Task 10 에서 import. 신규 필드가 전부 optional 이라 가드 본문은 불변.
