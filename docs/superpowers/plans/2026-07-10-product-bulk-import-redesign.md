# 판매상품 대량등록(엑셀 임포트) 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공급사 엑셀 워크북을 받아 풀상품(필드+카테고리+옵션→variant)을 세션 단위로 대량 등록하고, 성공/실패를 한 화면에서 리뷰한 뒤 일괄 publish 하는 기능을 구현하고, 기존 부실 CSV 모듈을 제거한다.

**Architecture:** canonical 단건 등록 경로(`ProductMastersService.createMaster` + `updateVersion`)를 **그대로 재사용**하는 얇은 오케스트레이터. 신규 `catalog/operations/import` 모듈이 파싱(exceljs)→정규화→검증→커밋만 담당하고, 상품 생성은 canonical 서비스에 위임한다. 동기 2단계(무상태 validate → 세션 commit), 행별 독립 트랜잭션.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), `exceljs`(이미 의존성), Jest. 설계 문서: `docs/superpowers/specs/2026-07-10-product-bulk-import-redesign-design.md`.

## Global Constraints

모든 task 는 아래를 암묵적으로 포함한다 (CLAUDE.md):

- 레이어: **Controller → Service(포트, 2~3줄) → Reader/Manager/Validator → 기존 Repository/Service**. Controller 는 에러→상태 매핑용 try/catch 금지(글로벌 필터 위임). Service 는 `@app/shared` 도메인 예외만 throw, `HttpException`/drizzle/Express 타입 import 금지.
- 도메인 예외: `import { BadRequestError, NotFoundError, ConflictError } from '@app/shared'`.
- DB: `@InjectTypedDb<typeof pimSchema>()` 또는 `@InjectDb()` 로 `DbService<PimSchema>` 주입. 트랜잭션은 `this.db.run(fn, tx?)` **단일 러너**만. 자체 `inTx` 헬퍼 금지.
- 타입 안전: 정당화 없는 `any`/`as` 금지. nullable 정규화(`string ?? ''`, `number ?? 0`, `date ?? undefined`).
- DTO: `@ApiProperty({ type: 'object' })` 금지 — 중첩 DTO 는 별도 클래스로.
- 스키마: 스칼라 필드/테이블은 `snake_case` 컬럼 + camelCase export. 새 스키마는 additive.
- 상한(정확값): 상품 행 수 `MAX_PRODUCT_ROWS = 1000`, 상품당 variant 조합 `MAX_VARIANT_COMBINATIONS = 100`, 옵션값 구분자 `'|'`.
- 테스트 실행: `npx jest --testPathPattern=<name>` (repo 루트에서).
- 커밋: 각 task 마지막 스텝에서 커밋. 메시지 말미에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**신규 (모두 `apps/core/src/modules/catalog/operations/import/` 하위):**
- `dto/import.types.ts` — 내부 타입 (ParsedWorkbook, RawRow, CategoryNode, NormalizedOption, RowError, ProductRecord)
- `dto/import-response.dto.ts` — HTTP 응답 DTO 클래스
- `dto/index.ts` — 배럴
- `services/product-import.parser.ts` — exceljs 워크북 → RawRow[] (워크북 레벨 가드)
- `services/product-import.normalizer.ts` — RawRow → ProductRecord (카테고리 해석·옵션 링크)
- `services/product-import.validator.ts` — 행별 필드/비즈니스 검증
- `services/product-import.template.ts` — 템플릿 워크북 생성
- `services/product-import-session.reader.ts` — 카테고리 트리·세션 조회
- `services/product-import.manager.ts` — commit 루프 + publishSession (canonical 위임 + 세션 기록)
- `services/product-import.service.ts` — 포트 (validate/commit/getSessions/getSession/publishSession)
- `product-import.controller.ts` — HTTP 경계
- `product-import.module.ts` — 모듈
- 각 로직 파일 옆 `*.spec.ts`

**수정:**
- `apps/core/src/modules/catalog/schema/catalog.schema.ts` — 테이블 2 + enum 2 추가, `catalogSchema` 객체에 등록
- `apps/core/src/modules/catalog/catalog.module.ts` — `CsvModule` 제거, `ProductImportModule` 추가
- `apps/core/drizzle/<ts>_add-product-import-session.sql` + `drizzle/meta/` (생성물)

**삭제:**
- `apps/core/src/modules/catalog/operations/csv/` 전체

---

## Task 1: 스키마 & 마이그레이션 (import 세션 테이블)

**Files:**
- Modify: `apps/core/src/modules/catalog/schema/catalog.schema.ts` (enum/테이블 추가; `catalogSchema` 객체 `:976`)
- Create(생성물): `apps/core/drizzle/<timestamp>_add-product-import-session.sql`, `drizzle/meta/*`

**Interfaces:**
- Produces: 테이블 `productImportSessions`, `productImportItems`; enum `productImportSessionStatusEnum`, `productImportItemStatusEnum`. 컬럼: sessions(`id, fileName, uploadedBy, totalRows, createdCount, failedCount, status, createdAt, committedAt`), items(`id, sessionId, rowNumber, productKey, status, masterId, errorMessage, createdAt`).

- [ ] **Step 1: 테이블/enum 정의 추가**

`catalog.schema.ts` 의 `catalogSchema` 객체 정의(`:976`) **바로 앞**에 추가 (import `pgEnum, pgTable, uuid, varchar, integer, text, timestamp, index` 는 이미 파일 상단에 있음, `uuidv7` 도 있음):

```ts
// ===== PRODUCT IMPORT (엑셀 대량등록 세션) =====
export const productImportSessionStatusEnum = pgEnum('product_import_session_status', ['completed', 'archived']);
export const productImportItemStatusEnum = pgEnum('product_import_item_status', ['created', 'failed']);

export const productImportSessions = pgTable(
  'product_import_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    fileName: varchar('file_name', { length: 500 }),
    uploadedBy: uuid('uploaded_by'),
    totalRows: integer('total_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    status: productImportSessionStatusEnum('status').notNull().default('completed'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    committedAt: timestamp('committed_at'),
  },
  (table) => [
    index('idx_import_sessions_uploaded_by').on(table.uploadedBy),
    index('idx_import_sessions_created_at').on(table.createdAt),
  ],
);

export const productImportItems = pgTable(
  'product_import_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => productImportSessions.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    productKey: varchar('product_key', { length: 255 }),
    status: productImportItemStatusEnum('status').notNull(),
    masterId: uuid('master_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('idx_import_items_session').on(table.sessionId)],
);
```

- [ ] **Step 2: `catalogSchema` 객체에 테이블 등록**

`catalog.schema.ts:976` 의 `export const catalogSchema = {` 객체 안, 마지막 테이블 뒤에 **테이블 2개만** 추가:

```ts
  productImportSessions,
  productImportItems,
```

> ⚠️ pgEnum(`productImportSessionStatusEnum`, `productImportItemStatusEnum`)은 `catalogSchema` 에 넣지 **않는다**. `DrizzleSchema`(`libs/db/src/types.ts`)는 table/relation/view 만 허용하므로 enum 을 등록하면 catalog 전역이 TS2344 로 깨진다. 이는 이 파일의 기존 관례와도 일치(기존 standalone enum `ProductMasterVersionStatusEnum` 등도 `catalogSchema` 에 미등록). enum 은 정의·export·컬럼 사용만 하면 된다.

- [ ] **Step 3: 타입체크로 스키마 유효성 확인**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 신규 테이블 관련 에러 없음 (기존 레포 debt 외 신규 에러 0).

- [ ] **Step 4: 마이그레이션 생성 후 SQL 리뷰**

Run: `npm run db:generate:core -- --name add-product-import-session`
Expected: `apps/core/drizzle/<ts>_add-product-import-session.sql` 생성. 파일을 열어 `CREATE TYPE ... product_import_session_status`, `CREATE TABLE product_import_sessions`, `CREATE TABLE product_import_items`, FK/인덱스가 포함됐는지 확인. `DROP` 문이 없어야 함(순수 additive).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/schema/catalog.schema.ts apps/core/drizzle
git commit -m "$(printf 'feat(catalog): add product import session schema\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: 내부 타입 (`import.types.ts`)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/dto/import.types.ts`

**Interfaces:**
- Produces: `ParsedWorkbook`, `RawRow`, `CategoryNode`, `NormalizedOption`, `RowError`, `ProductRecord`. 이후 모든 task 가 이 타입을 소비한다.

- [ ] **Step 1: 타입 파일 작성** (로직 없음 — 테스트 불필요, 다음 task 들의 계약)

```ts
export interface RawRow {
  /** 시트 데이터 행 번호 (헤더 제외, 엑셀 기준 1-based data index) */
  rowNumber: number;
  /** 헤더명 → trim 된 셀 문자열 */
  cells: Record<string, string>;
}

export interface ParsedWorkbook {
  products: RawRow[];
  options: RawRow[];
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface NormalizedOption {
  displayName: string;
  values: { displayName: string }[];
}

export interface RowError {
  sheet: 'Products' | 'Options';
  rowNumber: number;
  message: string;
}

/** 정규화+검증 파이프라인의 상품 단위 레코드 */
export interface ProductRecord {
  rowNumber: number;
  productKey: string;
  /** Products 시트 원본 셀 (validator 가 coerce/validate 시 참조) */
  raw: Record<string, string>;
  /** validator 가 채우는 updateVersion 스칼라 필드 */
  version: Record<string, unknown>;
  categoryIds: string[];
  categoryNames: string[];
  primaryCategoryId?: string;
  options: NormalizedOption[];
  errors: RowError[];
}
```

- [ ] **Step 2: 타입체크**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 신규 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/dto/import.types.ts
git commit -m "$(printf 'feat(catalog): add product import internal types\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: 파서 (`product-import.parser.ts`)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook`, `RawRow` (Task 2).
- Produces: `class ProductImportParser { async parse(buffer: Buffer): Promise<ParsedWorkbook> }`. 워크북 레벨 위반은 `BadRequestError` throw. 상수 `MAX_PRODUCT_ROWS = 1000` export.

- [ ] **Step 1: 실패 테스트 작성**

`product-import.parser.spec.ts`:

```ts
import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ProductImportParser } from './product-import.parser';

async function workbookBuffer(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

describe('ProductImportParser', () => {
  const parser = new ProductImportParser();

  it('Products/Options 두 시트를 헤더 기준으로 파싱한다', async () => {
    const buf = await workbookBuffer((wb) => {
      const p = wb.addWorksheet('Products');
      p.addRow(['productKey', 'name', 'marketPrice']);
      p.addRow(['P1', '니트', '19000']);
      const o = wb.addWorksheet('Options');
      o.addRow(['productKey', 'optionName', 'optionValues']);
      o.addRow(['P1', '색상', '빨강|파랑']);
    });

    const parsed = await parser.parse(buf);

    expect(parsed.products).toEqual([{ rowNumber: 1, cells: { productKey: 'P1', name: '니트', marketPrice: '19000' } }]);
    expect(parsed.options).toEqual([{ rowNumber: 1, cells: { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑' } }]);
  });

  it('Products 시트가 없으면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet('Sheet1').addRow(['a']));
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('필수 헤더(name)가 없으면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => {
      const p = wb.addWorksheet('Products');
      p.addRow(['productKey', 'brand']);
      p.addRow(['P1', 'ACME']);
    });
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('Products 데이터가 0행이면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => wb.addWorksheet('Products').addRow(['productKey', 'name']));
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('상품 행이 상한을 초과하면 BadRequestError', async () => {
    const buf = await workbookBuffer((wb) => {
      const p = wb.addWorksheet('Products');
      p.addRow(['productKey', 'name']);
      for (let i = 0; i < 1001; i++) p.addRow([`P${i}`, `n${i}`]);
    });
    await expect(parser.parse(buf)).rejects.toBeInstanceOf(BadRequestError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import.parser`
Expected: FAIL — `Cannot find module './product-import.parser'`.

- [ ] **Step 3: 파서 구현**

`product-import.parser.ts`:

```ts
import * as ExcelJS from 'exceljs';
import { BadRequestError } from '@app/shared';
import { ParsedWorkbook, RawRow } from '../dto/import.types';

export const MAX_PRODUCT_ROWS = 1000;

const REQUIRED_PRODUCT_HEADERS = ['productKey', 'name'];

export class ProductImportParser {
  async parse(buffer: Buffer): Promise<ParsedWorkbook> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new BadRequestError('유효한 엑셀(.xlsx) 파일이 아닙니다.');
    }

    const productsSheet = wb.getWorksheet('Products');
    if (!productsSheet) {
      throw new BadRequestError('필수 시트 "Products" 가 없습니다.');
    }

    const products = this.readSheet(productsSheet);
    const productHeaders = Object.keys(products[0]?.cells ?? {});
    const missing = REQUIRED_PRODUCT_HEADERS.filter((h) => !productHeaders.includes(h));
    if (products.length === 0) {
      throw new BadRequestError('Products 시트에 데이터 행이 없습니다.');
    }
    if (missing.length > 0) {
      throw new BadRequestError(`Products 시트 필수 헤더 누락: ${missing.join(', ')}`);
    }
    if (products.length > MAX_PRODUCT_ROWS) {
      throw new BadRequestError(`상품 행이 상한(${MAX_PRODUCT_ROWS})을 초과했습니다. 파일을 나눠 올려주세요.`);
    }

    const optionsSheet = wb.getWorksheet('Options');
    const options = optionsSheet ? this.readSheet(optionsSheet) : [];

    return { products, options };
  }

  /** 1행=헤더, 이후=데이터. 빈 행은 건너뛰고 rowNumber 는 데이터 기준 1-based. */
  private readSheet(sheet: ExcelJS.Worksheet): RawRow[] {
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      headers[col] = String(cell.text ?? '').trim();
    });

    const rows: RawRow[] = [];
    let dataIndex = 0;
    const lastRow = sheet.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      const cells: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, col) => {
        if (!header) return;
        const value = String(row.getCell(col).text ?? '').trim();
        cells[header] = value;
        if (value !== '') hasValue = true;
      });
      if (!hasValue) continue; // 완전 빈 행 skip
      dataIndex += 1;
      rows.push({ rowNumber: dataIndex, cells });
    }
    return rows;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import.parser`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.parser.ts apps/core/src/modules/catalog/operations/import/services/product-import.parser.spec.ts apps/core/src/modules/catalog/operations/import/dto/import.types.ts
git commit -m "$(printf 'feat(catalog): product import excel parser\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: 정규화기 (`product-import.normalizer.ts`)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts`

**Interfaces:**
- Consumes: `ParsedWorkbook`, `CategoryNode`, `ProductRecord`, `NormalizedOption` (Task 2).
- Produces: `class ProductImportNormalizer { normalize(parsed: ParsedWorkbook, categories: CategoryNode[]): ProductRecord[] }`. 카테고리 해석·옵션 링크·중복/고아 검출까지. field coerce/range 는 validator 담당. `raw`/`categoryIds`/`categoryNames`/`options`/`errors` 채우고 `version` 은 `{}`.

- [ ] **Step 1: 실패 테스트 작성**

`product-import.normalizer.spec.ts`:

```ts
import { ProductImportNormalizer } from './product-import.normalizer';
import { CategoryNode } from '../dto/import.types';

const CATEGORIES: CategoryNode[] = [
  { id: 'c-women', name: '여성패션', slug: 'women', parentId: null },
  { id: 'c-knit', name: '니트', slug: 'women-knit', parentId: 'c-women' },
  { id: 'c-men', name: '남성패션', slug: 'men', parentId: null },
  { id: 'c-knit2', name: '니트', slug: 'men-knit', parentId: 'c-men' }, // 동명 형제(다른 부모)
];

function parsed(products: Record<string, string>[], options: Record<string, string>[] = []) {
  return {
    products: products.map((cells, i) => ({ rowNumber: i + 1, cells })),
    options: options.map((cells, i) => ({ rowNumber: i + 1, cells })),
  };
}

describe('ProductImportNormalizer', () => {
  const normalizer = new ProductImportNormalizer();

  it('categoryPath(이름 경로)를 leaf id 로 해석하고 이름도 기록한다', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: '니트A', categoryPath: '여성패션>니트' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual(['c-knit']);
    expect(rec.primaryCategoryId).toBe('c-knit');
    expect(rec.categoryNames).toEqual(['여성패션', '니트']);
    expect(rec.errors).toEqual([]);
  });

  it('해석 불가 categoryPath 는 에러', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: 'x', categoryPath: '없는>경로' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual([]);
    expect(rec.errors.some((e) => e.sheet === 'Products' && /카테고리/.test(e.message))).toBe(true);
  });

  it('slug 정확 매칭도 허용한다', () => {
    const [rec] = normalizer.normalize(parsed([{ productKey: 'P1', name: 'x', categoryPath: 'men-knit' }]), CATEGORIES);
    expect(rec.categoryIds).toEqual(['c-knit2']);
  });

  it('Options 행을 productKey 로 묶어 옵션그룹을 만든다', () => {
    const [rec] = normalizer.normalize(
      parsed(
        [{ productKey: 'P1', name: 'x' }],
        [
          { productKey: 'P1', optionName: '색상', optionValues: '빨강|파랑' },
          { productKey: 'P1', optionName: '사이즈', optionValues: 'S|M|L' },
        ],
      ),
      CATEGORIES,
    );
    expect(rec.options).toEqual([
      { displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '파랑' }] },
      { displayName: '사이즈', values: [{ displayName: 'S' }, { displayName: 'M' }, { displayName: 'L' }] },
    ]);
  });

  it('파일 내 중복 productKey 는 에러', () => {
    const recs = normalizer.normalize(parsed([{ productKey: 'P1', name: 'a' }, { productKey: 'P1', name: 'b' }]), CATEGORIES);
    expect(recs[1].errors.some((e) => /중복/.test(e.message))).toBe(true);
  });

  it('존재하지 않는 productKey 를 참조하는 Options 행은 invalid 레코드로 surface 한다', () => {
    const recs = normalizer.normalize(
      parsed([{ productKey: 'P1', name: 'a' }], [{ productKey: 'GHOST', optionName: '색상', optionValues: '빨강' }]),
      CATEGORIES,
    );
    const ghost = recs.find((r) => r.productKey === 'GHOST');
    expect(ghost).toBeDefined();
    expect(ghost!.errors.some((e) => e.sheet === 'Options')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import.normalizer`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 정규화기 구현**

`product-import.normalizer.ts`:

```ts
import { ParsedWorkbook, CategoryNode, ProductRecord, NormalizedOption, RowError } from '../dto/import.types';

const VALUE_DELIMITER = '|';

export class ProductImportNormalizer {
  normalize(parsed: ParsedWorkbook, categories: CategoryNode[]): ProductRecord[] {
    const bySlug = new Map(categories.map((c) => [c.slug, c]));
    const byParent = new Map<string | null, CategoryNode[]>();
    for (const c of categories) {
      const list = byParent.get(c.parentId) ?? [];
      list.push(c);
      byParent.set(c.parentId, list);
    }
    const byId = new Map(categories.map((c) => [c.id, c]));

    const records: ProductRecord[] = [];
    const byKey = new Map<string, ProductRecord>();
    const seenKeys = new Set<string>();

    for (const row of parsed.products) {
      const productKey = row.cells.productKey ?? '';
      const record: ProductRecord = {
        rowNumber: row.rowNumber,
        productKey,
        raw: row.cells,
        version: {},
        categoryIds: [],
        categoryNames: [],
        options: [],
        errors: [],
      };

      if (productKey && seenKeys.has(productKey)) {
        record.errors.push({ sheet: 'Products', rowNumber: row.rowNumber, message: `중복 productKey: ${productKey}` });
      }
      if (productKey) {
        seenKeys.add(productKey);
        if (!byKey.has(productKey)) byKey.set(productKey, record);
      }

      const path = (row.cells.categoryPath ?? '').trim();
      if (path) {
        const resolved = this.resolveCategory(path, bySlug, byParent, byId);
        if (resolved) {
          record.categoryIds = [resolved.id];
          record.primaryCategoryId = resolved.id;
          record.categoryNames = resolved.names;
        } else {
          record.errors.push({
            sheet: 'Products',
            rowNumber: row.rowNumber,
            message: `카테고리 경로를 해석할 수 없습니다(미존재 또는 동명 모호): ${path}`,
          });
        }
      }

      records.push(record);
    }

    for (const row of parsed.options) {
      const productKey = row.cells.productKey ?? '';
      const optionName = (row.cells.optionName ?? '').trim();
      const values = (row.cells.optionValues ?? '')
        .split(VALUE_DELIMITER)
        .map((v) => v.trim())
        .filter((v) => v !== '');
      const option: NormalizedOption = { displayName: optionName, values: values.map((displayName) => ({ displayName })) };

      const target = byKey.get(productKey);
      if (!target) {
        const stub: ProductRecord = {
          rowNumber: row.rowNumber,
          productKey,
          raw: {},
          version: {},
          categoryIds: [],
          categoryNames: [],
          options: [option],
          errors: [
            {
              sheet: 'Options',
              rowNumber: row.rowNumber,
              message: `존재하지 않는 productKey 참조: ${productKey || '(빈 값)'}`,
            },
          ],
        };
        records.push(stub);
        continue;
      }
      target.options.push(option);
    }

    return records;
  }

  private resolveCategory(
    path: string,
    bySlug: Map<string, CategoryNode>,
    byParent: Map<string | null, CategoryNode[]>,
    byId: Map<string, CategoryNode>,
  ): { id: string; names: string[] } | null {
    const bySlugHit = bySlug.get(path.trim());
    if (bySlugHit) {
      const names = this.ancestorNames(bySlugHit, byId);
      return { id: bySlugHit.id, names };
    }

    const segments = path.split('>').map((s) => s.trim()).filter((s) => s !== '');
    if (segments.length === 0) return null;

    let parentId: string | null = null;
    let current: CategoryNode | null = null;
    for (const segment of segments) {
      const siblings = (byParent.get(parentId) ?? []).filter((c) => c.name === segment);
      if (siblings.length !== 1) return null; // 미존재 또는 모호
      current = siblings[0];
      parentId = current.id;
    }
    if (!current) return null;
    return { id: current.id, names: this.ancestorNames(current, byId) };
  }

  private ancestorNames(node: CategoryNode, byId: Map<string, CategoryNode>): string[] {
    const names: string[] = [];
    let cursor: CategoryNode | undefined = node;
    while (cursor) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return names;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import.normalizer`
Expected: PASS (6 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.ts apps/core/src/modules/catalog/operations/import/services/product-import.normalizer.spec.ts
git commit -m "$(printf 'feat(catalog): product import normalizer\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: 검증기 (`product-import.validator.ts`)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord` (Task 2).
- Produces: `class ProductImportValidator { validate(records: ProductRecord[]): ProductRecord[] }`. 각 레코드의 `raw` 를 coerce→검증해 `version` 을 채우고 `errors` 에 필드/비즈니스 위반을 append. 상수 `MAX_VARIANT_COMBINATIONS = 100` export. 이미 `errors` 있는 stub(고아 옵션) 도 그대로 통과시킴(version 은 비움).

- [ ] **Step 1: 실패 테스트 작성**

`product-import.validator.spec.ts`:

```ts
import { ProductImportValidator } from './product-import.validator';
import { ProductRecord } from '../dto/import.types';

function record(raw: Record<string, string>, options: ProductRecord['options'] = []): ProductRecord {
  return {
    rowNumber: 1,
    productKey: raw.productKey ?? 'P1',
    raw,
    version: {},
    categoryIds: [],
    categoryNames: [],
    options,
    errors: [],
  };
}

describe('ProductImportValidator', () => {
  const validator = new ProductImportValidator();

  it('유효 행은 version 스칼라를 채우고 에러가 없다', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: '니트', marketPrice: '19000', productType: 'regular_sale', isOverseas: 'Y' }),
    ]);
    expect(rec.errors).toEqual([]);
    expect(rec.version).toMatchObject({ name: '니트', marketPrice: 19000, productType: 'regular_sale', isOverseas: true });
  });

  it('name 누락은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '  ' })]);
    expect(rec.errors.some((e) => /name/.test(e.message))).toBe(true);
  });

  it('음수/NaN 가격은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', marketPrice: '-5' })]);
    expect(rec.errors.some((e) => /marketPrice/.test(e.message))).toBe(true);
  });

  it('정의되지 않은 enum 은 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', productType: 'weird' })]);
    expect(rec.errors.some((e) => /productType/.test(e.message))).toBe(true);
  });

  it('maxQuantity < minQuantity 는 에러', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x', minQuantity: '5', maxQuantity: '2' })]);
    expect(rec.errors.some((e) => /maxQuantity/.test(e.message))).toBe(true);
  });

  it('옵션값 중복은 에러', () => {
    const [rec] = validator.validate([
      record({ productKey: 'P1', name: 'x' }, [{ displayName: '색상', values: [{ displayName: '빨강' }, { displayName: '빨강' }] }]),
    ]);
    expect(rec.errors.some((e) => e.sheet === 'Options' && /중복/.test(e.message))).toBe(true);
  });

  it('variant 조합이 상한(100)을 넘으면 에러', () => {
    const many = { displayName: '색상', values: Array.from({ length: 11 }, (_, i) => ({ displayName: `c${i}` })) };
    const many2 = { displayName: '사이즈', values: Array.from({ length: 11 }, (_, i) => ({ displayName: `s${i}` })) };
    const [rec] = validator.validate([record({ productKey: 'P1', name: 'x' }, [many, many2])]);
    expect(rec.errors.some((e) => /조합/.test(e.message))).toBe(true);
  });

  it('빈 name 도 기본값(productType=regular_sale, minQuantity=1)은 채운다', () => {
    const [rec] = validator.validate([record({ productKey: 'P1', name: '니트' })]);
    expect(rec.version).toMatchObject({ productType: 'regular_sale', fulfillmentKind: 'physical', ageRestriction: 0, minQuantity: 1 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import.validator`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 검증기 구현**

`product-import.validator.ts`:

```ts
import { ProductRecord, RowError } from '../dto/import.types';

export const MAX_VARIANT_COMBINATIONS = 100;

const PRODUCT_TYPES = ['regular_sale', 'limited_edition'];
const FULFILLMENT_KINDS = ['physical', 'digital'];

const STRING_FIELDS = [
  'productCode',
  'name',
  'alternativeName',
  'description',
  'brand',
  'material',
  'salesClassification',
  'purchaseClassification',
  'seller',
];

export class ProductImportValidator {
  validate(records: ProductRecord[]): ProductRecord[] {
    for (const record of records) {
      // 고아 옵션 stub 등 productKey 만 있는 레코드(raw 비어있음)는 필드 검증 skip
      if (Object.keys(record.raw).length === 0) continue;
      this.validateFields(record);
      this.validateOptions(record);
    }
    return records;
  }

  private validateFields(record: ProductRecord): void {
    const raw = record.raw;
    const errors = record.errors;
    const version: Record<string, unknown> = {};
    const push = (message: string) => errors.push({ sheet: 'Products', rowNumber: record.rowNumber, message });

    if (!record.productKey || record.productKey.trim() === '') push('productKey 는 필수입니다.');

    const name = (raw.name ?? '').trim();
    if (name === '') push('name 은 필수입니다.');
    else version.name = name;

    for (const field of STRING_FIELDS) {
      if (field === 'name') continue;
      const value = (raw[field] ?? '').trim();
      if (value !== '') version[field] = value;
    }

    version.marketPrice = this.optionalMoney(raw.marketPrice, 'marketPrice', push);
    version.supplyPrice = this.optionalMoney(raw.supplyPrice, 'supplyPrice', push);

    version.ageRestriction = this.intInRange(raw.ageRestriction, 'ageRestriction', 0, 100, 0, push);
    version.minQuantity = this.intInRange(raw.minQuantity, 'minQuantity', 1, Number.MAX_SAFE_INTEGER, 1, push);
    const maxRaw = (raw.maxQuantity ?? '').trim();
    if (maxRaw !== '') {
      const max = this.intInRange(raw.maxQuantity, 'maxQuantity', 1, Number.MAX_SAFE_INTEGER, undefined, push);
      if (typeof max === 'number' && typeof version.minQuantity === 'number' && max < version.minQuantity) {
        push('maxQuantity 는 minQuantity 이상이어야 합니다.');
      }
      version.maxQuantity = max;
    }

    version.productType = this.enumOrDefault(raw.productType, 'productType', PRODUCT_TYPES, 'regular_sale', push);
    version.fulfillmentKind = this.enumOrDefault(raw.fulfillmentKind, 'fulfillmentKind', FULFILLMENT_KINDS, 'physical', push);

    version.isOverseas = this.bool(raw.isOverseas);
    version.isVisibleToMembersOnly = this.bool(raw.isVisibleToMembersOnly);
    version.hideMembershipPriceForNonMembers = this.bool(raw.hideMembershipPriceForNonMembers);

    record.version = version;
  }

  private validateOptions(record: ProductRecord): void {
    const seenNames = new Set<string>();
    let combinations = 1;
    for (const option of record.options) {
      const push = (message: string) => record.errors.push({ sheet: 'Options', rowNumber: record.rowNumber, message });
      if (option.displayName.trim() === '') push('optionName 은 필수입니다.');
      if (seenNames.has(option.displayName)) push(`옵션명 중복: ${option.displayName}`);
      seenNames.add(option.displayName);

      if (option.values.length === 0) push(`옵션값이 비어있습니다: ${option.displayName}`);
      const seenValues = new Set<string>();
      for (const v of option.values) {
        if (seenValues.has(v.displayName)) push(`옵션값 중복: ${option.displayName}=${v.displayName}`);
        seenValues.add(v.displayName);
      }
      combinations *= Math.max(option.values.length, 1);
    }
    if (combinations > MAX_VARIANT_COMBINATIONS) {
      record.errors.push({
        sheet: 'Options',
        rowNumber: record.rowNumber,
        message: `variant 조합 수(${combinations})가 상한(${MAX_VARIANT_COMBINATIONS})을 초과했습니다.`,
      });
    }
  }

  private optionalMoney(raw: string | undefined, field: string, push: (m: string) => void): number | undefined {
    const value = (raw ?? '').trim();
    if (value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      push(`${field} 는 0 이상의 숫자여야 합니다: ${value}`);
      return undefined;
    }
    return n;
  }

  private intInRange(
    raw: string | undefined,
    field: string,
    min: number,
    max: number,
    fallback: number | undefined,
    push: (m: string) => void,
  ): number | undefined {
    const value = (raw ?? '').trim();
    if (value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
      push(`${field} 는 ${min}~${max === Number.MAX_SAFE_INTEGER ? '∞' : max} 범위의 정수여야 합니다: ${value}`);
      return fallback;
    }
    return n;
  }

  private enumOrDefault(
    raw: string | undefined,
    field: string,
    allowed: string[],
    fallback: string,
    push: (m: string) => void,
  ): string {
    const value = (raw ?? '').trim();
    if (value === '') return fallback;
    if (!allowed.includes(value)) {
      push(`${field} 는 [${allowed.join(', ')}] 중 하나여야 합니다: ${value}`);
      return fallback;
    }
    return value;
  }

  private bool(raw: string | undefined): boolean {
    const value = (raw ?? '').trim().toLowerCase();
    return value === 'y' || value === 'true' || value === '1';
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import.validator`
Expected: PASS (8 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.validator.ts apps/core/src/modules/catalog/operations/import/services/product-import.validator.spec.ts
git commit -m "$(printf 'feat(catalog): product import row validator\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: 세션 리더 (`product-import-session.reader.ts`)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.spec.ts`

**Interfaces:**
- Consumes: `CategoryNode` (Task 2), `pimSchema`/`DbService` (`@app/db`).
- Produces: `class ProductImportSessionReader`:
  - `loadCategoryTree(tx?): Promise<CategoryNode[]>`
  - `getSessions(page, limit, tx?): Promise<{ data: SessionRow[]; total: number; page: number; limit: number }>`
  - `getSession(sessionId, tx?): Promise<{ session: SessionRow; items: ItemRow[] }>` (없으면 `NotFoundError`)
  - `getDraftVersionId(masterId, tx?): Promise<string | null>`
  - 타입 `SessionRow = typeof productImportSessions.$inferSelect`, `ItemRow = typeof productImportItems.$inferSelect`.

- [ ] **Step 1: 실패 테스트 작성** (mocked db — bulk spec 패턴)

`product-import-session.reader.spec.ts`:

```ts
import { NotFoundError } from '@app/shared';
import { ProductImportSessionReader } from './product-import-session.reader';

/** 체이닝 select 를 흉내내는 최소 mock. 각 테스트가 결과 배열을 주입. */
function makeDb(rows: any[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => Promise.resolve(rows),
  };
  return { run: (fn: any, t?: any) => (t ? fn(t) : fn({ select: () => chain })) } as any;
}

describe('ProductImportSessionReader.getSession', () => {
  it('세션이 없으면 NotFoundError', async () => {
    const reader = new ProductImportSessionReader(makeDb([]));
    await expect(reader.getSession('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import-session.reader`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 리더 구현**

`product-import-session.reader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  type PimSchema,
  productCategories,
  productImportSessions,
  productImportItems,
  productMasterVersions,
} from '../../../schema/catalog.schema';
import { CategoryNode } from '../dto/import.types';
import { DbTransaction } from '../../../catalog.types';

export type SessionRow = typeof productImportSessions.$inferSelect;
export type ItemRow = typeof productImportItems.$inferSelect;

@Injectable()
export class ProductImportSessionReader {
  constructor(@InjectDb() private readonly db: DbService<PimSchema>) {}

  loadCategoryTree(tx?: DbTransaction): Promise<CategoryNode[]> {
    return this.db.run(
      (trx) =>
        trx
          .select({
            id: productCategories.id,
            name: productCategories.name,
            slug: productCategories.slug,
            parentId: productCategories.parentId,
          })
          .from(productCategories),
      tx,
    );
  }

  async getSessions(page = 1, limit = 20, tx?: DbTransaction) {
    const offset = (page - 1) * limit;
    const data = await this.db.run(
      (trx) =>
        trx.select().from(productImportSessions).orderBy(desc(productImportSessions.createdAt)).limit(limit).offset(offset),
      tx,
    );
    return { data, total: data.length, page, limit };
  }

  async getSession(sessionId: string, tx?: DbTransaction): Promise<{ session: SessionRow; items: ItemRow[] }> {
    return this.db.run(async (trx) => {
      const [session] = await trx
        .select()
        .from(productImportSessions)
        .where(eq(productImportSessions.id, sessionId))
        .limit(1);
      if (!session) throw new NotFoundError(`임포트 세션을 찾을 수 없습니다: ${sessionId}`);
      const items = await trx
        .select()
        .from(productImportItems)
        .where(eq(productImportItems.sessionId, sessionId))
        .orderBy(productImportItems.rowNumber);
      return { session, items };
    }, tx);
  }

  async getDraftVersionId(masterId: string, tx?: DbTransaction): Promise<string | null> {
    return this.db.run(async (trx) => {
      const [row] = await trx
        .select({ id: productMasterVersions.id })
        .from(productMasterVersions)
        .where(
          and(
            eq(productMasterVersions.masterId, masterId),
            eq(productMasterVersions.status, 'draft'),
            isNull(productMasterVersions.deletedAt),
          ),
        )
        .orderBy(desc(productMasterVersions.version))
        .limit(1);
      return row?.id ?? null;
    }, tx);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import-session.reader`
Expected: PASS (1 test). (mock 의 `getSession` 경로가 빈 배열→NotFoundError 를 검증.)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.ts apps/core/src/modules/catalog/operations/import/services/product-import-session.reader.spec.ts
git commit -m "$(printf 'feat(catalog): product import session reader\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: 매니저 (`product-import.manager.ts`) — commit 루프 + publishSession

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts`

**Interfaces:**
- Consumes: `ProductRecord` (Task 2), `ProductImportSessionReader` (Task 6), `ProductMastersService.createMaster/updateVersion`, `ProductVersionsService.publishVersion`, `DbService<PimSchema>`.
- Produces: `class ProductImportManager`:
  - `commit(input: { fileName: string; userId: string; records: ProductRecord[] }): Promise<CommitResult>` where `CommitResult = { sessionId: string; createdCount: number; failedCount: number; items: CommitItem[] }`, `CommitItem = { rowNumber: number; productKey: string; status: 'created' | 'failed'; masterId?: string; errorMessage?: string }`.
  - `publishSession(sessionId: string): Promise<{ published: number; failed: { masterId: string; reason: string }[] }>`.
- 행별 독립 트랜잭션(부분 성공 영속). `errors` 있는 레코드는 create 시도 없이 `failed` 아이템으로 기록.

- [ ] **Step 1: 실패 테스트 작성** (event-contracts 가상 mock — bulk spec 패턴)

`product-import.manager.spec.ts`:

```ts
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import { ProductImportManager } from './product-import.manager';
import { ProductRecord } from '../dto/import.types';

function validRecord(over: Partial<ProductRecord> = {}): ProductRecord {
  return {
    rowNumber: 1,
    productKey: 'P1',
    raw: { productKey: 'P1', name: '니트' },
    version: { name: '니트' },
    categoryIds: [],
    categoryNames: [],
    options: [],
    errors: [],
    ...over,
  };
}

/** 삽입된 아이템을 수집하는 db mock. run(fn) 은 fn(trx) 를 실행; trx.insert 는 values 를 기록. */
function makeHarness(createMasterImpl?: (userId: string) => any) {
  const inserted: any[] = [];
  const sessions: any[] = [];
  const trx = {
    insert: (table: any) => ({
      values: (v: any) => {
        (table === 'SESSIONS' ? sessions : inserted).push(v);
        return { returning: () => Promise.resolve([{ ...v, id: 'sess-1' }]) };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  // insert 대상 테이블을 태그로 식별하기 위한 매핑 주입
  const db = {
    run: (fn: any, t?: any) => (t ? fn(t) : fn(trx)),
  } as any;
  const productMastersService = {
    createMaster: jest.fn(async (userId: string) => (createMasterImpl ? createMasterImpl(userId) : { id: 'v1', masterId: 'm1' })),
    updateVersion: jest.fn(async () => ({ id: 'v1', masterId: 'm1' })),
  } as any;
  const productVersionsService = { publishVersion: jest.fn(async () => undefined) } as any;
  const reader = {
    getSession: jest.fn(),
    getDraftVersionId: jest.fn(),
  } as any;
  const manager = new ProductImportManager(db, reader, productMastersService, productVersionsService);
  return { manager, inserted, productMastersService, productVersionsService, reader };
}

describe('ProductImportManager.commit', () => {
  it('errors 있는 레코드는 create 시도 없이 failed 로 기록한다', async () => {
    const { manager, productMastersService } = makeHarness();
    const bad = validRecord({ productKey: 'BAD', errors: [{ sheet: 'Products', rowNumber: 2, message: 'name 필수' }] });
    const result = await manager.commit({ fileName: 'f.xlsx', userId: 'u1', records: [bad] });

    expect(productMastersService.createMaster).not.toHaveBeenCalled();
    expect(result.failedCount).toBe(1);
    expect(result.createdCount).toBe(0);
    expect(result.items[0]).toMatchObject({ productKey: 'BAD', status: 'failed' });
  });

  it('한 레코드 실패가 나머지를 막지 않는다(행별 격리)', async () => {
    let call = 0;
    const { manager } = makeHarness(() => {
      call += 1;
      if (call === 2) throw new Error('boom');
      return { id: `v${call}`, masterId: `m${call}` };
    });
    const result = await manager.commit({
      fileName: 'f.xlsx',
      userId: 'u1',
      records: [validRecord({ productKey: 'A' }), validRecord({ productKey: 'B' }), validRecord({ productKey: 'C' })],
    });

    expect(result.createdCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.items.map((i) => i.status)).toEqual(['created', 'failed', 'created']);
  });

  it('createMaster→updateVersion 에 카테고리·optionDiff 를 전달한다', async () => {
    const { manager, productMastersService } = makeHarness();
    await manager.commit({
      fileName: 'f.xlsx',
      userId: 'u1',
      records: [
        validRecord({
          categoryIds: ['c1'],
          primaryCategoryId: 'c1',
          options: [{ displayName: '색상', values: [{ displayName: '빨강' }] }],
        }),
      ],
    });
    expect(productMastersService.updateVersion).toHaveBeenCalledWith(
      'v1',
      expect.objectContaining({ categoryIds: ['c1'], primaryCategoryId: 'c1', optionDiff: { add: [{ displayName: '색상', values: [{ displayName: '빨강' }] }] } }),
      expect.anything(),
    );
  });
});
```

> 참고: 위 mock 은 `insert` 대상 테이블을 태그로 구분하지 않는다. 구현 시 세션 insert 와 아이템 insert 를 모두 통과시키되 반환 카운트/`items` 배열로 검증한다. 세션 id 는 `returning()` 이 `[{ id: 'sess-1' }]` 를 주도록 구현이 첫 insert 를 세션으로 취급.

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import.manager`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 매니저 구현**

`product-import.manager.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDb, DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { type PimSchema, productImportSessions, productImportItems } from '../../../schema/catalog.schema';
import { UpdateProductMasterVersion, DbTransaction } from '../../../catalog.types';
import { ProductMastersService } from '../../../core/products/services/product-masters.service';
import { ProductVersionsService } from '../../../core/products/services/product-versions.service';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductRecord } from '../dto/import.types';

export interface CommitItem {
  rowNumber: number;
  productKey: string;
  status: 'created' | 'failed';
  masterId?: string;
  errorMessage?: string;
}

export interface CommitResult {
  sessionId: string;
  createdCount: number;
  failedCount: number;
  items: CommitItem[];
}

@Injectable()
export class ProductImportManager {
  constructor(
    @InjectDb() private readonly db: DbService<PimSchema>,
    private readonly reader: ProductImportSessionReader,
    private readonly productMastersService: ProductMastersService,
    private readonly productVersionsService: ProductVersionsService,
  ) {}

  async commit(input: { fileName: string; userId: string; records: ProductRecord[] }): Promise<CommitResult> {
    const { fileName, userId, records } = input;

    const [session] = await this.db.run((trx) =>
      trx
        .insert(productImportSessions)
        .values({ fileName, uploadedBy: userId, totalRows: records.length, status: 'completed' })
        .returning(),
    );
    const sessionId = session.id;

    const items: CommitItem[] = [];
    let createdCount = 0;
    let failedCount = 0;

    for (const record of records) {
      if (record.errors.length > 0) {
        const errorMessage = record.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`).join('; ');
        await this.recordItem(sessionId, record, 'failed', null, errorMessage);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'failed', errorMessage });
        failedCount += 1;
        continue;
      }

      try {
        const masterId = await this.db.run(async (trx) => {
          const version = await this.productMastersService.createMaster(userId, trx);
          const data: UpdateProductMasterVersion = {
            ...record.version,
            categoryIds: record.categoryIds,
            primaryCategoryId: record.primaryCategoryId,
            optionDiff: record.options.length > 0 ? { add: record.options } : undefined,
          };
          await this.productMastersService.updateVersion(version.id, data, trx);
          await trx.insert(productImportItems).values({
            sessionId,
            rowNumber: record.rowNumber,
            productKey: record.productKey,
            status: 'created',
            masterId: version.masterId,
          });
          return version.masterId;
        });
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'created', masterId });
        createdCount += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
        await this.recordItem(sessionId, record, 'failed', null, errorMessage);
        items.push({ rowNumber: record.rowNumber, productKey: record.productKey, status: 'failed', errorMessage });
        failedCount += 1;
      }
    }

    await this.db.run((trx) =>
      trx
        .update(productImportSessions)
        .set({ createdCount, failedCount, committedAt: new Date() })
        .where(eq(productImportSessions.id, sessionId)),
    );

    return { sessionId, createdCount, failedCount, items };
  }

  private recordItem(
    sessionId: string,
    record: ProductRecord,
    status: 'created' | 'failed',
    masterId: string | null,
    errorMessage: string | null,
    tx?: DbTransaction,
  ) {
    return this.db.run(
      (trx) =>
        trx.insert(productImportItems).values({
          sessionId,
          rowNumber: record.rowNumber,
          productKey: record.productKey,
          status,
          masterId: masterId ?? undefined,
          errorMessage: errorMessage ?? undefined,
        }),
      tx,
    );
  }

  async publishSession(sessionId: string): Promise<{ published: number; failed: { masterId: string; reason: string }[] }> {
    const { items } = await this.reader.getSession(sessionId);
    const created = items.filter((i) => i.status === 'created' && i.masterId);

    let published = 0;
    const failed: { masterId: string; reason: string }[] = [];

    for (const item of created) {
      const masterId = item.masterId as string;
      const draftVersionId = await this.reader.getDraftVersionId(masterId);
      if (!draftVersionId) continue; // 이미 publish 됨(active) → skip (멱등)
      try {
        await this.db.run((trx) => this.productVersionsService.publishVersion(draftVersionId, trx));
        published += 1;
      } catch (error) {
        failed.push({ masterId, reason: error instanceof Error ? error.message : '알 수 없는 오류' });
      }
    }

    return { published, failed };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import.manager`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.manager.ts apps/core/src/modules/catalog/operations/import/services/product-import.manager.spec.ts
git commit -m "$(printf 'feat(catalog): product import commit manager\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 8: 템플릿 생성기 + 응답 DTO

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import.template.ts`
- Create: `apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts`
- Create: `apps/core/src/modules/catalog/operations/import/dto/index.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts`

**Interfaces:**
- Produces:
  - `async function generateTemplateWorkbook(): Promise<Buffer>` — Products/Options 시트 + 헤더 + 예시행.
  - DTO 클래스: `ValidatePreviewRowDto`, `ResolvedPreviewDto`, `ValidatePreviewDto`, `CommitItemDto`, `CommitResultDto`, `SessionSummaryDto`, `SessionDetailDto`, `PublishFailureDto`, `PublishResultDto`.
- Consumes: `ProductImportParser` (Task 3, 라운드트립 테스트용).

- [ ] **Step 1: 템플릿 실패 테스트 작성** (파서로 라운드트립 검증)

`product-import.template.spec.ts`:

```ts
import { generateTemplateWorkbook } from './product-import.template';
import { ProductImportParser } from './product-import.parser';

describe('generateTemplateWorkbook', () => {
  it('생성한 템플릿은 파서가 읽을 수 있고 필수 헤더를 갖는다', async () => {
    const buf = await generateTemplateWorkbook();
    const parsed = await new ProductImportParser().parse(buf);
    const headers = Object.keys(parsed.products[0].cells);
    expect(headers).toEqual(expect.arrayContaining(['productKey', 'name', 'categoryPath', 'marketPrice']));
    expect(parsed.products.length).toBeGreaterThanOrEqual(1); // 예시행 존재
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import.template`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 템플릿 생성기 구현**

`product-import.template.ts`:

```ts
import * as ExcelJS from 'exceljs';

const PRODUCT_HEADERS = [
  'productKey',
  'name',
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
];

const OPTION_HEADERS = ['productKey', 'optionName', 'optionValues', 'sortOrder'];

export async function generateTemplateWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const products = wb.addWorksheet('Products');
  products.addRow(PRODUCT_HEADERS);
  products.addRow([
    'P1',
    '예시 니트',
    'PROD-001',
    'ACME',
    '',
    '부드러운 니트',
    '아크릴 100%',
    '19000',
    '12000',
    'regular_sale',
    'physical',
    '의류',
    '사입',
    '0',
    '1',
    '10',
    'ACME',
    '여성패션>니트',
    'N',
    'N',
    'N',
  ]);

  const options = wb.addWorksheet('Options');
  options.addRow(OPTION_HEADERS);
  options.addRow(['P1', '색상', '빨강|파랑|검정', '0']);
  options.addRow(['P1', '사이즈', 'S|M|L', '1']);

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import.template`
Expected: PASS (1 test).

- [ ] **Step 5: 응답 DTO 작성** (로직 없음)

`import-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class ResolvedPreviewDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ type: [String] })
  categoryNames: string[];

  @ApiProperty()
  variantCount: number;
}

export class ValidatePreviewRowDto {
  @ApiProperty()
  rowNumber: number;

  @ApiProperty()
  productKey: string;

  @ApiProperty({ enum: ['valid', 'invalid'] })
  status: 'valid' | 'invalid';

  @ApiProperty({ type: [String] })
  errors: string[];

  @ApiProperty({ type: ResolvedPreviewDto })
  resolved: ResolvedPreviewDto;
}

export class ValidatePreviewDto {
  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  validCount: number;

  @ApiProperty()
  invalidCount: number;

  @ApiProperty({ type: [ValidatePreviewRowDto] })
  rows: ValidatePreviewRowDto[];
}

export class CommitItemDto {
  @ApiProperty()
  rowNumber: number;

  @ApiProperty()
  productKey: string;

  @ApiProperty({ enum: ['created', 'failed'] })
  status: 'created' | 'failed';

  @ApiProperty({ required: false })
  masterId?: string;

  @ApiProperty({ required: false })
  errorMessage?: string;
}

export class CommitResultDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  createdCount: number;

  @ApiProperty()
  failedCount: number;

  @ApiProperty({ type: [CommitItemDto] })
  items: CommitItemDto[];
}

export class SessionSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  fileName: string | null;

  @ApiProperty()
  totalRows: number;

  @ApiProperty()
  createdCount: number;

  @ApiProperty()
  failedCount: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;
}

export class SessionDetailDto extends SessionSummaryDto {
  @ApiProperty({ type: [CommitItemDto] })
  items: CommitItemDto[];
}

export class PublishFailureDto {
  @ApiProperty()
  masterId: string;

  @ApiProperty()
  reason: string;
}

export class PublishResultDto {
  @ApiProperty()
  published: number;

  @ApiProperty({ type: [PublishFailureDto] })
  failed: PublishFailureDto[];
}
```

`dto/index.ts`:

```ts
export * from './import.types';
export * from './import-response.dto';
```

- [ ] **Step 6: 타입체크 + 커밋**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 신규 에러 없음.

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.template.ts apps/core/src/modules/catalog/operations/import/services/product-import.template.spec.ts apps/core/src/modules/catalog/operations/import/dto/import-response.dto.ts apps/core/src/modules/catalog/operations/import/dto/index.ts
git commit -m "$(printf 'feat(catalog): product import template and response dtos\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 9: 서비스 포트 (`product-import.service.ts`)

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/services/product-import.service.ts`
- Test: `apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts`

**Interfaces:**
- Consumes: parser/normalizer/validator/reader/manager (Task 3–8), 응답 DTO (Task 8).
- Produces: `class ProductImportService`:
  - `validate(buffer: Buffer): Promise<ValidatePreviewDto>`
  - `commit(buffer: Buffer, fileName: string, userId: string): Promise<CommitResultDto>`
  - `getSessions(page: number, limit: number): Promise<{ data: SessionSummaryDto[]; total: number; page: number; limit: number }>`
  - `getSession(sessionId: string): Promise<SessionDetailDto>`
  - `publishSession(sessionId: string): Promise<PublishResultDto>`
  - `getTemplate(): Promise<Buffer>`

- [ ] **Step 1: 실패 테스트 작성** (event-contracts 가상 mock)

`product-import.service.spec.ts`:

```ts
jest.mock(
  '@packages/event-contracts',
  () => ({ PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' } }),
  { virtual: true },
);

import * as ExcelJS from 'exceljs';
import { ProductImportService } from './product-import.service';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';

async function buf(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const p = wb.addWorksheet('Products');
  p.addRow(['productKey', 'name', 'marketPrice']);
  rows.forEach((r) => p.addRow(r));
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

function makeService() {
  const reader = { loadCategoryTree: jest.fn(async () => []) } as any;
  const manager = { commit: jest.fn(async () => ({ sessionId: 's1', createdCount: 1, failedCount: 0, items: [] })) } as any;
  const service = new ProductImportService(
    new ProductImportParser(),
    new ProductImportNormalizer(),
    new ProductImportValidator(),
    reader,
    manager,
  );
  return { service, manager };
}

describe('ProductImportService.validate', () => {
  it('유효/무효 행을 집계한 프리뷰를 DB 쓰기 없이 반환한다', async () => {
    const { service, manager } = makeService();
    const preview = await service.validate(await buf([['P1', '니트', '19000'], ['P2', '', '-1']]));

    expect(preview.totalRows).toBe(2);
    expect(preview.validCount).toBe(1);
    expect(preview.invalidCount).toBe(1);
    expect(manager.commit).not.toHaveBeenCalled();
    const invalid = preview.rows.find((r) => r.productKey === 'P2');
    expect(invalid!.status).toBe('invalid');
    expect(invalid!.errors.length).toBeGreaterThan(0);
  });
});

describe('ProductImportService.commit', () => {
  it('정규화·검증 후 manager.commit 에 레코드를 넘긴다', async () => {
    const { service, manager } = makeService();
    const result = await service.commit(await buf([['P1', '니트', '19000']]), 'f.xlsx', 'u1');
    expect(manager.commit).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'f.xlsx', userId: 'u1' }));
    expect(result.sessionId).toBe('s1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=product-import.service`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 서비스 구현**

`product-import.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ProductImportParser } from './product-import.parser';
import { ProductImportNormalizer } from './product-import.normalizer';
import { ProductImportValidator } from './product-import.validator';
import { ProductImportSessionReader } from './product-import-session.reader';
import { ProductImportManager } from './product-import.manager';
import { generateTemplateWorkbook } from './product-import.template';
import { ProductRecord } from '../dto/import.types';
import {
  ValidatePreviewDto,
  ValidatePreviewRowDto,
  CommitResultDto,
  SessionSummaryDto,
  SessionDetailDto,
  PublishResultDto,
} from '../dto/import-response.dto';

@Injectable()
export class ProductImportService {
  constructor(
    private readonly parser: ProductImportParser,
    private readonly normalizer: ProductImportNormalizer,
    private readonly validator: ProductImportValidator,
    private readonly reader: ProductImportSessionReader,
    private readonly manager: ProductImportManager,
  ) {}

  private async pipeline(buffer: Buffer): Promise<ProductRecord[]> {
    const parsed = await this.parser.parse(buffer);
    const categories = await this.reader.loadCategoryTree();
    return this.validator.validate(this.normalizer.normalize(parsed, categories));
  }

  async validate(buffer: Buffer): Promise<ValidatePreviewDto> {
    const records = await this.pipeline(buffer);
    const rows: ValidatePreviewRowDto[] = records.map((r) => ({
      rowNumber: r.rowNumber,
      productKey: r.productKey,
      status: r.errors.length === 0 ? 'valid' : 'invalid',
      errors: r.errors.map((e) => `[${e.sheet} ${e.rowNumber}행] ${e.message}`),
      resolved: {
        name: String(r.version.name ?? r.raw.name ?? ''),
        categoryNames: r.categoryNames,
        variantCount: this.variantCount(r),
      },
    }));
    const validCount = rows.filter((r) => r.status === 'valid').length;
    return { totalRows: records.length, validCount, invalidCount: records.length - validCount, rows };
  }

  async commit(buffer: Buffer, fileName: string, userId: string): Promise<CommitResultDto> {
    const records = await this.pipeline(buffer);
    return this.manager.commit({ fileName, userId, records });
  }

  async getSessions(page: number, limit: number): Promise<{ data: SessionSummaryDto[]; total: number; page: number; limit: number }> {
    const { data, total } = await this.reader.getSessions(page, limit);
    return { data: data.map((s) => this.toSummary(s)), total, page, limit };
  }

  async getSession(sessionId: string): Promise<SessionDetailDto> {
    const { session, items } = await this.reader.getSession(sessionId);
    return {
      ...this.toSummary(session),
      items: items.map((i) => ({
        rowNumber: i.rowNumber,
        productKey: i.productKey ?? '',
        status: i.status,
        masterId: i.masterId ?? undefined,
        errorMessage: i.errorMessage ?? undefined,
      })),
    };
  }

  publishSession(sessionId: string): Promise<PublishResultDto> {
    return this.manager.publishSession(sessionId);
  }

  getTemplate(): Promise<Buffer> {
    return generateTemplateWorkbook();
  }

  private variantCount(record: ProductRecord): number {
    if (record.options.length === 0) return 1;
    return record.options.reduce((acc, o) => acc * Math.max(o.values.length, 1), 1);
  }

  private toSummary(session: {
    id: string;
    fileName: string | null;
    totalRows: number;
    createdCount: number;
    failedCount: number;
    status: string;
    createdAt: Date;
  }): SessionSummaryDto {
    return {
      id: session.id,
      fileName: session.fileName,
      totalRows: session.totalRows,
      createdCount: session.createdCount,
      failedCount: session.failedCount,
      status: session.status,
      createdAt: session.createdAt,
    };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=product-import.service`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/services/product-import.service.ts apps/core/src/modules/catalog/operations/import/services/product-import.service.spec.ts
git commit -m "$(printf 'feat(catalog): product import service port\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 10: 컨트롤러 + 모듈 배선

**Files:**
- Create: `apps/core/src/modules/catalog/operations/import/product-import.controller.ts`
- Create: `apps/core/src/modules/catalog/operations/import/product-import.module.ts`
- Modify: `apps/core/src/modules/catalog/catalog.module.ts` (`ProductImportModule` 추가)

**Interfaces:**
- Consumes: `ProductImportService` (Task 9), `ProductsModule`(export: ProductMastersService, ProductVersionsService).
- Produces: `ProductImportController`(base `/product-imports`), `ProductImportModule`.

- [ ] **Step 1: 컨트롤러 구현** (try/catch 없음 — 글로벌 필터 위임)

`product-import.controller.ts`:

```ts
import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { User } from '@app/authorization';
import { ProductImportService } from './services/product-import.service';
import { ValidatePreviewDto, CommitResultDto, SessionDetailDto, PublishResultDto } from './dto';

@ApiTags('Product Import')
@Controller('product-imports')
export class ProductImportController {
  constructor(private readonly service: ProductImportService) {}

  @Get('template')
  @ApiOperation({ summary: '대량등록 엑셀 템플릿 다운로드' })
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.service.getTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=product-import-template.xlsx');
    res.send(buffer);
  }

  @Post('validate')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '워크북 검증(무상태 프리뷰, DB 쓰기 없음)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 200, type: ValidatePreviewDto })
  async validate(@UploadedFile() file: Express.Multer.File): Promise<ValidatePreviewDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.validate(file.buffer);
  }

  @Post('commit')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: '워크북 커밋(세션 생성 + draft 상품 일괄 생성)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } })
  @ApiResponse({ status: 201, type: CommitResultDto })
  async commit(@UploadedFile() file: Express.Multer.File, @User() user: { userId: string }): Promise<CommitResultDto> {
    if (!file) throw new BadRequestException('file is required');
    return this.service.commit(file.buffer, file.originalname, user.userId);
  }

  @Get()
  @ApiOperation({ summary: '임포트 세션 목록' })
  async getSessions(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.service.getSessions(Number(page), Number(limit));
  }

  @Get(':sessionId')
  @ApiOperation({ summary: '임포트 세션 상세(성공/실패 아이템 전체)' })
  @ApiResponse({ status: 200, type: SessionDetailDto })
  async getSession(@Param('sessionId') sessionId: string): Promise<SessionDetailDto> {
    return this.service.getSession(sessionId);
  }

  @Post(':sessionId/publish')
  @ApiOperation({ summary: '세션 내 draft 일괄 publish' })
  @ApiResponse({ status: 201, type: PublishResultDto })
  async publish(@Param('sessionId') sessionId: string): Promise<PublishResultDto> {
    return this.service.publishSession(sessionId);
  }
}
```

- [ ] **Step 2: 모듈 구현**

`product-import.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ProductImportController } from './product-import.controller';
import { ProductImportService } from './services/product-import.service';
import { ProductImportParser } from './services/product-import.parser';
import { ProductImportNormalizer } from './services/product-import.normalizer';
import { ProductImportValidator } from './services/product-import.validator';
import { ProductImportSessionReader } from './services/product-import-session.reader';
import { ProductImportManager } from './services/product-import.manager';
import { ProductsModule } from '../../core/products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [ProductImportController],
  providers: [
    ProductImportService,
    ProductImportParser,
    ProductImportNormalizer,
    ProductImportValidator,
    ProductImportSessionReader,
    ProductImportManager,
  ],
  exports: [ProductImportService],
})
export class ProductImportModule {}
```

- [ ] **Step 3: CatalogModule 에 등록**

`catalog.module.ts` 수정: line 17 의 `import { CsvModule } ...` 를 아래로 교체하고, imports 배열의 `CsvModule`(`:42`) 을 `ProductImportModule` 로 교체.

```ts
// (line 17 교체)
import { ProductImportModule } from './operations/import/product-import.module';
```
```ts
    // (imports 배열: CsvModule → ProductImportModule)
    ProductImportModule,
```

- [ ] **Step 4: 빌드 확인**

Run: `npx nest build core`
Expected: 성공(신규 에러 0). 실패 시 import 경로/타입 수정.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/catalog/operations/import/product-import.controller.ts apps/core/src/modules/catalog/operations/import/product-import.module.ts apps/core/src/modules/catalog/catalog.module.ts
git commit -m "$(printf 'feat(catalog): wire product import controller and module\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 11: CSV 모듈 제거

**Files:**
- Delete: `apps/core/src/modules/catalog/operations/csv/` (전체)
- Modify: `apps/core/src/modules/catalog/catalog.module.ts` (Task 10 에서 이미 CsvModule import/등록 제거됨 — 잔여 참조만 확인)

**Interfaces:**
- Produces: 없음(제거). `/products/csv/*` 엔드포인트 소멸.

- [ ] **Step 1: 잔여 참조 확인**

Run: `grep -rn "operations/csv\|CsvModule\|ProductCsvService\|ProductCsvController\|products/csv" apps/core/src`
Expected: `catalog.module.ts` 는 이미 정리됨. 다른 참조가 있으면 각 파일에서 제거.

- [ ] **Step 2: papaparse 사용처 확인**

Run: `grep -rln "papaparse" apps/core/src`
Expected: csv 모듈 외 사용처가 없으면 안심. (의존성 자체 제거는 별도 판단 — 다른 앱에서 쓰면 유지.)

- [ ] **Step 3: 디렉터리 삭제**

Run: `git rm -r apps/core/src/modules/catalog/operations/csv`
Expected: controller/service/module/dto/spec 삭제됨.

- [ ] **Step 4: 빌드 + 타입체크**

Run: `npx nest build core`
Expected: 성공(누락 import 에러 0). 실패 시 잔여 참조 제거.

- [ ] **Step 5: 커밋**

```bash
git add -A apps/core/src/modules/catalog
git commit -m "$(printf 'refactor(catalog): remove legacy CSV bulk import module\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 12: 최종 통합 검증

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: import 모듈 전체 테스트**

Run: `npx jest --testPathPattern=operations/import`
Expected: parser/normalizer/validator/reader/manager/template/service 전부 PASS.

- [ ] **Step 2: 전체 빌드**

Run: `npx nest build core`
Expected: 성공.

- [ ] **Step 3: 변경 파일 린트(스코프 한정)**

Run: `npx eslint apps/core/src/modules/catalog/operations/import --ext .ts`
Expected: 신규 error 0 (repo 상시 debt 는 스코프 밖).

- [ ] **Step 4: dev DB 에 마이그레이션 적용(수동/선택)**

Run: `npm run db:setup -- --stage dev --deployment lcnine-services`
Expected: Task 1 의 add-product-import-session 마이그레이션 적용(인터랙티브 프롬프트 응답). 새 테이블 2개 생성 확인.

- [ ] **Step 5: 실제 왕복 스모크(수동/선택)**

`/product-imports/template` 로 템플릿 받아 1~2행 채운 뒤 `validate`→`commit`→`GET /:sessionId`→`publish` 를 순서대로 호출해 draft 생성·publish(→ Medusa/검색 동기화 이벤트)까지 확인. verify 스킬로 대체 가능.

---

## Self-Review (작성자 확인 완료)

**Spec coverage:** 설계 문서 각 섹션 매핑 — §4 아키텍처/모듈→Task 10, §5 데이터모델→Task 1, §6 포맷/정규화→Task 3·4, §7 API/흐름→Task 9·10, §8 검증/에러(행별 tx)→Task 5·7, §9 CSV 제거→Task 11, §10 테스트→각 Task TDD + Task 12. 누락 없음.

**Placeholder scan:** "TBD/TODO/적절히 처리" 없음. 모든 코드 스텝에 실제 코드 포함.

**Type consistency:** `ProductRecord`(Task 2)를 3·4·5·7·9 가 동일 사용. `createMaster(userId,tx)→{id,masterId}`, `updateVersion(id,data,tx)`, `publishVersion(id,tx)` 시그니처는 실제 코드(`product-masters.service.ts:179,806`, `product-versions.service.ts:256`)와 일치. `CommitResult`/`CommitItem`(Task 7)을 Task 9 응답 DTO(`CommitResultDto`/`CommitItemDto`)가 필드 동형으로 매핑. `optionDiff:{add:NormalizedOption[]}` 는 `OptionDiff.add: AddOptionDto[]`(`{displayName, values:[{displayName}]}`)와 정합.
