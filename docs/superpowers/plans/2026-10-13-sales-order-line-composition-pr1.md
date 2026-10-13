# 판매주문 라인 구성 PR 1 (판정·굳히기·백필) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매주문 라인마다 «적용 구성»을 기록으로 굳히고, 라인이 «해결됐나»를 판정하는 자리 다섯을 그 기록 하나로 모은다(수정 API·화면은 PR 2·3).

**Architecture:** 순수 판정 함수 `resolveLineComposition` 과 SQL 술어 `lineResolvedSql` 이 한 쌍이고, 주문 단위로 그 함수를 돌리는 `LineCompositionReader` 를 FO 생성·리컨실러가 쓴다. 굳히기는 `LineCompositionManager.freezeFromMatching` 하나만 쓰며 FO 생성이 판매주문 잠금 아래에서 부른다. 옛 라인 칸(`product_matching_id`·`mapping_snapshot_id`)은 쓰기·읽기만 멈추고 컬럼은 PR 4 가 지운다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), Jest(ts-jest), drizzle-kit, Next.js(admin-web 한 파일)

**Spec:** `docs/superpowers/specs/2026-10-13-sales-order-line-composition-design.md` (이슈 #1063, #1016 14번 행)

## Global Constraints

- 검증 게이트: `npm run type-check` 에러 0 · `npx jest` 실패 0 · admin-web `cd apps/admin-web && npx tsc --noEmit` 0 (CLAUDE.md «검증 게이트»)
- 스키마 변경 = `schema.ts` + 생성 SQL + `drizzle/meta/` 를 **한 커밋**에. 생성은 `npm run db:generate:core -- --name <kebab>`. 생성된 SQL 을 손으로 고치지 않는다
- 이 PR 의 마이그레이션은 **additive 만**(칸 추가·테이블 추가·enum 값 추가). 배포 순서는 `migrate → deploy`
- 통합 스펙은 `describeIfDb`(`process.env.DATABASE_URL` 가드)로 쓰고 스펙 안에서 `dotenv.config()` 를 부르지 않는다
- 통합 스펙은 **스크래치 DB** 로 돌린다(로컬 공유 `core` DB 는 다른 브랜치 마이그 잔재로 migrate 가 멈춘다):
  ```bash
  docker exec almondyoung-server-postgres-1 psql -U postgres -c 'CREATE DATABASE core_1063'
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath <파일>
  ```
  마이그레이션을 새로 만들면(Task 1) 이 DB 에 다시 `migrate` 한다
- `any`·`as` 캐스팅 금지(문서화된 이유 없이). 인벤토리 쿼리는 `db.query.*`·`with` 금지 — `trx.select().from().where()` 꼴
- 코드 주석은 한국어로 «왜»만. 채팅 서식(화살표·굵게) 금지
- 구성 출처 값은 정확히 `'matching'` | `'operator'`. 테이블 이름 `sales_order_line_compositions`, 칸 `composition_source`·`composition_set_at`·`composition_set_by`·`qty_per_unit`
- 박스 오퍼레이션 enum 에 더하는 값은 정확히 `'amend'`(PR 2 가 쓴다)

## Review Focus

- 전량 취소된(유효 수량 0) 미매칭 라인은 FO 생성도 리컨실러도 «막힘»으로 보지 않는다 — 둘이 갈리면 주문이 매칭 대기에서 영원히 안 깨어난다 → Task 5 테스트
- 운영자가 굳힌 라인은 상품매칭이 void·미해결·다른 SKU 여도 굳힌 구성이 이긴다 → Task 4 테스트
- 굳힌 라인과 아직 안 굳힌 라인이 섞인 주문의 FO 생성은 안 굳힌 라인만 굳히고 굳힌 라인을 덮어쓰지 않는다 → Task 4 테스트
- FO 생성이 굳힌 뒤 같은 트랜잭션의 뒤 검증(창고·직배송 혼합 SKU)에서 실패하면 굳힌 것도 함께 롤백된다 → Task 4 테스트
- void 상품매칭으로 해결된 라인이 주문 목록에서 «매칭 대기»로 보이지 않는다(옛 코드는 `productMatchingId` 만 봐서 보였다) → Task 6 테스트

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` (수정) | 라인 칸 셋, `salesOrderLineCompositions` 테이블, `shipment_operation_type` 에 `'amend'` |
| `apps/core/drizzle/<ts>_add-sales-order-line-compositions.sql` (생성) | 위 변경의 마이그레이션 |
| `apps/core/src/modules/product-matching/line-composition/line-composition.ts` (생성) | 순수 판정: `resolveLineComposition`·`matchingFailureReason`·`isDigitalFulfillmentLine`·`blocksFulfillment` |
| `apps/core/src/modules/product-matching/line-composition/partial-cancellation.ts` (생성) | 부분 취소 메타데이터 → 라인별 취소 수량 합(리더와 백필 스크립트가 같이 쓴다) |
| `apps/core/src/modules/product-matching/line-composition/line-composition.reader.ts` (생성) | 주문 하나의 라인 전부 → `{ line, fulfillableQuantity, resolution }[]` |
| `apps/core/src/modules/product-matching/line-composition/line-composition.manager.ts` (생성) | 굳히기 쓰기의 유일한 자리 |
| `apps/core/src/modules/product-matching/line-composition/line-resolved.sql.ts` (생성) | `lineResolvedSql()` — 판정의 SQL 짝 |
| `apps/core/src/modules/product-matching/line-composition/__support__/composition-invariant.ts` (생성) | 테스트용 불변식 검사 쿼리(PR 2 도 쓴다) |
| `apps/core/src/modules/product-matching/product-matching.module.ts` (수정) | 리더·매니저 등록·export |
| `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` (수정) | FO 생성이 리더로 판정·굳히기, 스냅샷 분기 삭제 |
| `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts` (수정) | 테스트 그래프에 리더·매니저 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts` (수정) | 리더로 판정·지문 |
| `apps/core/src/modules/product-matching/services/product-matching.service.ts` (수정) | 매칭체크 `excludeMatched` 를 술어로, `compositionSource` 반환 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (수정) | 14번 필터, 라인 `matchingResolved`, 옛 칸 쓰기 중단, `confirm` 스냅샷 삭제 |
| `apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts` (수정) | 라인 `productMatchingId` 일괄 덮어쓰기 삭제 |
| `apps/admin-web/src/features/order/history/hooks/demo-order-line.ts` (수정) | 배지가 `matchingResolved` 를 본다 |
| `scripts/ops/1016-14-line-composition-backfill.ts` (생성) | 백필 역산 순수 함수 |
| `scripts/ops/1016-14-backfill-line-compositions.ts` (생성) | 백필 실행 스크립트(dry-run 기본) |

---

### Task 1: 스키마와 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`shipmentOperationTypeEnum` ~231, `salesOrderLines` ~1354-1400, `wmsTables` ~3548, 타입 export ~4733)
- Create: `apps/core/drizzle/<timestamp>_add-sales-order-line-compositions.sql` (생성기가 만든다)

**Interfaces:**
- Produces: `wmsTables.salesOrderLineCompositions`(칸 `id`·`salesOrderLineId`·`skuId`·`qtyPerUnit`·`createdAt`), `wmsTables.salesOrderLines.compositionSource: 'matching' | 'operator' | null`·`compositionSetAt: Date | null`·`compositionSetBy: string | null`, `export type SalesOrderLineComposition`

- [ ] **Step 1: 작업 브랜치·워크트리 만들기**

```bash
git -C /home/pauseb/workspace/almondyoung-server worktree add .claude/worktrees/feat-1063-line-composition-pr1 -b feat/1063-line-composition-pr1 origin/develop
cd /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1063-line-composition-pr1
npm ci
ln -s ../../../../native/warehouse-app/node_modules native/warehouse-app/node_modules 2>/dev/null || true
```

- [ ] **Step 2: enum 값 더하기**

`shipmentOperationTypeEnum` 배열 끝(`'recall',` 다음)에 한 줄:

```ts
  'recall',
  // #1063: 작성 중 박스를 목표 내용에 맞춘 기록(라인 구성 변경·S2 주문 수정). PR 2 부터 쓴다.
  'amend',
]);
```

- [ ] **Step 3: 라인 칸 셋과 CHECK 더하기**

`salesOrderLines` 의 `mappingSnapshotId` 정의 바로 아래에:

```ts
    // #1063: 이 라인에 적용할 SKU 구성을 굳혔는지·누가 굳혔는지. NULL 이면 아직 현재 상품매칭을 따른다.
    // 구성 행은 sales_order_line_compositions 에 있고, 출처가 있으면 행이 1개 이상이다(LineCompositionManager 만 쓴다).
    compositionSource: varchar('composition_source', { length: 16 }).$type<'matching' | 'operator'>(),
    compositionSetAt: timestamp('composition_set_at', { withTimezone: true }),
    compositionSetBy: uuid('composition_set_by'),
```

같은 테이블 extras 객체(`uqSalesOrderChannelItem` 다음)에:

```ts
    compositionSourceCheck: check(
      'sales_order_lines_composition_source_check',
      sql`${t.compositionSource} IN ('matching', 'operator')`,
    ),
```

- [ ] **Step 4: 구성 테이블 더하기**

`salesOrderLines` 테이블 정의가 끝나는 `);` 바로 다음에:

```ts
/**
 * 판매주문 라인의 «적용 구성»(SKU × 판매 1개당 수량). 출처는 sales_order_lines.composition_source(#1063 스펙 §4).
 * 현재 값만 든다 — 바뀐 이력은 sales_order_amendments 가 든다.
 */
export const salesOrderLineCompositions = pgTable(
  'sales_order_line_compositions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderLineId: uuid('sales_order_line_id')
      .references(() => salesOrderLines.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    qtyPerUnit: integer('qty_per_unit').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // (라인, SKU) 유일 — 라인별 조회도 이 인덱스의 앞 칸으로 탄다
    uqLineSku: unique('uq_sales_order_line_compositions_line_sku').on(t.salesOrderLineId, t.skuId),
    ckQtyPerUnitPositive: check('ck_sales_order_line_compositions_qty_per_unit_positive', sql`${t.qtyPerUnit} > 0`),
  }),
);
```

`wmsTables` 객체의 `salesOrderLines,` 다음 줄에 `salesOrderLineCompositions,` 를 더한다.
`export type SalesOrderLine = InferSelectModel<typeof salesOrderLines>;` 다음 줄에:

```ts
export type SalesOrderLineComposition = InferSelectModel<typeof salesOrderLineCompositions>;
```

- [ ] **Step 5: 타입 확인**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 6: 마이그레이션 생성·검토**

Run: `npm run db:generate:core -- --name add-sales-order-line-compositions`
Expected: `apps/core/drizzle/<timestamp>_add-sales-order-line-compositions.sql` 하나와 `meta/` 갱신. SQL 에 다음만 있어야 한다(순서 무관):
`ALTER TYPE "public"."shipment_operation_type" ADD VALUE 'amend';` · `CREATE TABLE "sales_order_line_compositions"` · `ALTER TABLE "sales_order_lines" ADD COLUMN` ×3 · FK 2개 · `sales_order_lines_composition_source_check` · unique·check 제약. `DROP` 이 있으면 멈추고 schema 를 고친다.

- [ ] **Step 7: 스크래치 DB 에 적용**

Global Constraints 의 세 줄 중 앞 두 줄을 실행한다.
Expected: migrate 성공(에러 없이 종료)

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle
git commit -m "feat(core): 판매주문 라인 구성 테이블·출처 칸·박스 amend 오퍼레이션 (#1063)"
```

---

### Task 2: 순수 판정 함수

**Files:**
- Create: `apps/core/src/modules/product-matching/line-composition/line-composition.ts`
- Create: `apps/core/src/modules/product-matching/line-composition/partial-cancellation.ts`
- Test: `apps/core/src/modules/product-matching/line-composition/line-composition.spec.ts`
- Test: `apps/core/src/modules/product-matching/line-composition/partial-cancellation.spec.ts`

**Interfaces:**
- Consumes: `MatchingForFulfillment`, `isVoidMatching`, `physicalSkuLinks` from `apps/core/src/modules/product-matching/fulfillable-matching.ts`
- Produces:
  ```ts
  export type CompositionSource = 'matching' | 'operator';
  export interface CompositionItem { skuId: string; qtyPerUnit: number }
  export type MatchingFailureReason = 'NO_PRODUCT_SKU_MATCHING' | 'LEGACY_PRODUCT_MATCHING_IGNORED' | 'PRODUCT_MATCHING_UNRESOLVED' | 'PRODUCT_MATCHING_STRATEGY_UNRESOLVED';
  export type LineCompositionResolution =
    | { kind: 'digital' } | { kind: 'frozen'; source: CompositionSource; items: CompositionItem[] }
    | { kind: 'follow'; items: CompositionItem[] } | { kind: 'void' } | { kind: 'missing'; reason: MatchingFailureReason };
  export interface LineForComposition { id: string; fulfillmentKind: string | null; requiresShipping: boolean | null; compositionSource: CompositionSource | null }
  export function isDigitalFulfillmentLine(line: { fulfillmentKind?: string | null; requiresShipping?: boolean | null }): boolean
  export function matchingFailureReason(matching: MatchingForFulfillment): MatchingFailureReason
  export function resolveLineComposition(line: LineForComposition, frozen: readonly CompositionItem[], matching: MatchingForFulfillment): LineCompositionResolution
  export function blocksFulfillment(r: { fulfillableQuantity: number; resolution: LineCompositionResolution }): boolean
  // partial-cancellation.ts
  export function sumCancelledByLine(metadatas: readonly unknown[]): Map<string, number>
  ```

- [ ] **Step 1: 판정 스펙 쓰기**

`line-composition.spec.ts`:

```ts
import {
  blocksFulfillment,
  isDigitalFulfillmentLine,
  LineForComposition,
  matchingFailureReason,
  resolveLineComposition,
} from './line-composition';

const physical: LineForComposition = { id: 'l1', fulfillmentKind: null, requiresShipping: null, compositionSource: null };
const variant = (links: Array<{ skuId: string; quantity: number }>) => ({ status: 'matched', strategy: 'variant', links });

describe('resolveLineComposition', () => {
  it('디지털 라인은 매칭을 보지 않고 digital', () => {
    expect(resolveLineComposition({ ...physical, fulfillmentKind: 'digital' }, [], null)).toEqual({ kind: 'digital' });
    expect(resolveLineComposition({ ...physical, requiresShipping: false }, [], null)).toEqual({ kind: 'digital' });
  });

  it('굳힌 라인은 상품매칭이 무엇이든 굳힌 구성을 쓴다(SKU 순 정렬)', () => {
    const r = resolveLineComposition(
      { ...physical, compositionSource: 'operator' },
      [
        { skuId: 'b', qtyPerUnit: 1 },
        { skuId: 'a', qtyPerUnit: 2 },
      ],
      { status: 'matched', strategy: 'void', links: [] },
    );
    expect(r).toEqual({
      kind: 'frozen',
      source: 'operator',
      items: [
        { skuId: 'a', qtyPerUnit: 2 },
        { skuId: 'b', qtyPerUnit: 1 },
      ],
    });
  });

  it('출처가 있는데 구성 행이 없으면 불변식 위반으로 던진다', () => {
    expect(() => resolveLineComposition({ ...physical, compositionSource: 'matching' }, [], null)).toThrow(
      /invariant/i,
    );
  });

  it('안 굳힌 라인은 실물 링크가 있으면 follow — 수량 0·누락은 1 로 읽는다(옛 FO 생성과 같다)', () => {
    const r = resolveLineComposition(physical, [], variant([{ skuId: 's1', quantity: 0 }, { skuId: 's2', quantity: 3 }]));
    expect(r).toEqual({
      kind: 'follow',
      items: [
        { skuId: 's1', qtyPerUnit: 1 },
        { skuId: 's2', qtyPerUnit: 3 },
      ],
    });
  });

  it('안 굳힌 라인의 void 매칭은 void', () => {
    expect(resolveLineComposition(physical, [], { status: 'matched', strategy: 'void', links: [] })).toEqual({
      kind: 'void',
    });
  });

  it('그 밖은 missing + 사유', () => {
    expect(resolveLineComposition(physical, [], null)).toEqual({ kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' });
    expect(resolveLineComposition(physical, [], variant([]))).toEqual({
      kind: 'missing',
      reason: 'NO_PRODUCT_SKU_MATCHING',
    });
  });
});

describe('matchingFailureReason', () => {
  it('옛 FO 생성의 사유 규칙을 그대로 낸다', () => {
    expect(matchingFailureReason(null)).toBe('NO_PRODUCT_SKU_MATCHING');
    expect(matchingFailureReason({ status: 'ignored', strategy: 'variant', links: [{ skuId: 's', quantity: 1 }] })).toBe(
      'LEGACY_PRODUCT_MATCHING_IGNORED',
    );
    expect(matchingFailureReason({ status: 'pending', strategy: null })).toBe('PRODUCT_MATCHING_UNRESOLVED');
    expect(matchingFailureReason({ status: 'matched', strategy: 'option' })).toBe('PRODUCT_MATCHING_STRATEGY_UNRESOLVED');
    expect(matchingFailureReason({ status: 'matched', strategy: 'variant', links: [] })).toBe('NO_PRODUCT_SKU_MATCHING');
  });
});

describe('isDigitalFulfillmentLine', () => {
  it('null 은 물리로 본다', () => {
    expect(isDigitalFulfillmentLine({ fulfillmentKind: null, requiresShipping: null })).toBe(false);
  });
});

describe('blocksFulfillment', () => {
  it('유효 수량이 남은 missing 만 FO 생성을 막는다', () => {
    const missing = { kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' } as const;
    expect(blocksFulfillment({ fulfillableQuantity: 1, resolution: missing })).toBe(true);
    expect(blocksFulfillment({ fulfillableQuantity: 0, resolution: missing })).toBe(false);
    expect(blocksFulfillment({ fulfillableQuantity: 1, resolution: { kind: 'void' } })).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/product-matching/line-composition/line-composition.spec.ts`
Expected: FAIL — `Cannot find module './line-composition'`

- [ ] **Step 3: 판정 구현**

`line-composition.ts`:

```ts
import { MatchingForFulfillment, isVoidMatching, physicalSkuLinks } from '../fulfillable-matching';

/**
 * 판매주문 라인의 «적용 구성» 판정(#1063 스펙 §5.1). FO 생성·리컨실러·화면이 모두 이 판정 하나를 쓴다 —
 * 자리마다 판정을 따로 가지면 1회 지정으로 풀린 주문이 어느 화면에선 여전히 «미매칭»이 된다(14번 행이 그 증상이었다).
 * SQL 짝은 line-resolved.sql.ts — 둘이 같은 답을 내는지는 parity 통합 스펙이 지킨다.
 */
export type CompositionSource = 'matching' | 'operator';

export interface CompositionItem {
  skuId: string;
  qtyPerUnit: number;
}

export type MatchingFailureReason =
  | 'NO_PRODUCT_SKU_MATCHING'
  | 'LEGACY_PRODUCT_MATCHING_IGNORED'
  | 'PRODUCT_MATCHING_UNRESOLVED'
  | 'PRODUCT_MATCHING_STRATEGY_UNRESOLVED';

export type LineCompositionResolution =
  | { kind: 'digital' }
  | { kind: 'frozen'; source: CompositionSource; items: CompositionItem[] }
  | { kind: 'follow'; items: CompositionItem[] }
  | { kind: 'void' }
  | { kind: 'missing'; reason: MatchingFailureReason };

export interface LineForComposition {
  id: string;
  fulfillmentKind: string | null;
  requiresShipping: boolean | null;
  compositionSource: CompositionSource | null;
}

// null(미지정 — 기존 데이터·외부 채널)은 물리로 간주한다.
export function isDigitalFulfillmentLine(line: {
  fulfillmentKind?: string | null;
  requiresShipping?: boolean | null;
}): boolean {
  return line.fulfillmentKind === 'digital' || line.requiresShipping === false;
}

export function matchingFailureReason(matching: MatchingForFulfillment): MatchingFailureReason {
  if (!matching) return 'NO_PRODUCT_SKU_MATCHING';
  if (matching.status === 'ignored') return 'LEGACY_PRODUCT_MATCHING_IGNORED';
  if (matching.status !== 'matched') return 'PRODUCT_MATCHING_UNRESOLVED';
  if (matching.strategy !== 'variant') return 'PRODUCT_MATCHING_STRATEGY_UNRESOLVED';
  return 'NO_PRODUCT_SKU_MATCHING';
}

// 지문·비교가 순서에 흔들리지 않게 SKU 순으로 둔다
function sortItems(items: readonly CompositionItem[]): CompositionItem[] {
  return [...items].sort((a, b) => a.skuId.localeCompare(b.skuId));
}

export function resolveLineComposition(
  line: LineForComposition,
  frozen: readonly CompositionItem[],
  matching: MatchingForFulfillment,
): LineCompositionResolution {
  if (isDigitalFulfillmentLine(line)) return { kind: 'digital' };
  if (line.compositionSource !== null) {
    // 출처가 있는데 행이 없으면 쓰는 쪽(LineCompositionManager)의 결함이다 — 상품매칭으로 슬쩍 대신하면 결함이 숨는다
    if (frozen.length === 0) {
      throw new Error(`Line composition invariant violated: line ${line.id} has source ${line.compositionSource} but no rows`);
    }
    return { kind: 'frozen', source: line.compositionSource, items: sortItems(frozen) };
  }
  if (isVoidMatching(matching)) return { kind: 'void' };
  const links = physicalSkuLinks(matching);
  if (links.length > 0) {
    // 링크 수량 0·누락을 1 로 읽는 것은 옛 FO 생성(`Math.max(1, link.quantity || 1)`)과 같은 규칙이다
    return {
      kind: 'follow',
      items: sortItems(links.map((l) => ({ skuId: l.skuId, qtyPerUnit: Math.max(1, l.quantity || 1) }))),
    };
  }
  return { kind: 'missing', reason: matchingFailureReason(matching) };
}

/** FO 생성을 막는 라인인가. 전량 취소된 라인은 미매칭이어도 막지 않는다 — FO 생성과 리컨실러가 이 함수 하나로 판정한다. */
export function blocksFulfillment(r: { fulfillableQuantity: number; resolution: LineCompositionResolution }): boolean {
  return r.fulfillableQuantity > 0 && r.resolution.kind === 'missing';
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/product-matching/line-composition/line-composition.spec.ts`
Expected: PASS

- [ ] **Step 5: 부분 취소 합산 스펙 쓰기**

`partial-cancellation.spec.ts`:

```ts
import { sumCancelledByLine } from './partial-cancellation';

describe('sumCancelledByLine', () => {
  it('취소 메타데이터의 cancelledLines 를 라인별로 더한다', () => {
    const result = sumCancelledByLine([
      { cancelledLines: [{ salesOrderLineId: 'a', quantity: 1 }, { salesOrderLineId: 'b', quantity: 2 }] },
      { cancelledLines: [{ salesOrderLineId: 'a', quantity: 3 }] },
    ]);
    expect([...result.entries()].sort()).toEqual([
      ['a', 4],
      ['b', 2],
    ]);
  });

  it('형식이 아닌 값은 건너뛴다', () => {
    const result = sumCancelledByLine([
      null,
      {},
      { cancelledLines: 'x' },
      { cancelledLines: [null, { salesOrderLineId: 1, quantity: 1 }, { salesOrderLineId: 'a', quantity: '2' }] },
    ]);
    expect(result.size).toBe(0);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx jest apps/core/src/modules/product-matching/line-composition/partial-cancellation.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 7: 구현**

`partial-cancellation.ts`:

```ts
/**
 * 판매주문 부분 취소(`sales_order_cancellations.metadata.cancelledLines`)를 라인별 취소 수량으로 더한다.
 * 리더와 백필 스크립트가 같이 쓴다 — 유효 수량을 두 군데서 따로 세면 둘의 판정이 갈린다.
 * metadata 는 jsonb 라 형식이 보장되지 않는다. 형식이 아닌 항목은 건너뛴다(옛 FO 생성과 같은 규칙).
 */
export function sumCancelledByLine(metadatas: readonly unknown[]): Map<string, number> {
  const cancelledByLine = new Map<string, number>();
  for (const metadata of metadatas) {
    if (!metadata || typeof metadata !== 'object') continue;
    const lines: unknown = Reflect.get(metadata, 'cancelledLines');
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      const lineId: unknown = Reflect.get(line, 'salesOrderLineId');
      const quantity: unknown = Reflect.get(line, 'quantity');
      if (typeof lineId !== 'string' || typeof quantity !== 'number') continue;
      cancelledByLine.set(lineId, (cancelledByLine.get(lineId) ?? 0) + quantity);
    }
  }
  return cancelledByLine;
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/core/src/modules/product-matching/line-composition/`
Expected: PASS (두 파일)

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/product-matching/line-composition
git commit -m "feat(core): 라인 구성 판정 순수 함수·부분 취소 합산 (#1063)"
```

---

### Task 3: 리더·매니저·모듈 배선

**Files:**
- Create: `apps/core/src/modules/product-matching/line-composition/line-composition.reader.ts`
- Create: `apps/core/src/modules/product-matching/line-composition/line-composition.manager.ts`
- Create: `apps/core/src/modules/product-matching/line-composition/__support__/composition-invariant.ts`
- Modify: `apps/core/src/modules/product-matching/product-matching.module.ts`
- Modify: `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts` (`Wired` 인터페이스와 `wireLogistics` 반환값)
- Test: `apps/core/src/modules/product-matching/line-composition/line-composition.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `resolveLineComposition`·`sumCancelledByLine`·`CompositionItem`·`LineCompositionResolution`; `ProductSkuMappingService.getByVariant(variantId: string, tx?: AnyTx)`
- Produces:
  ```ts
  export interface ResolvedSalesOrderLine { line: SalesOrderLine; fulfillableQuantity: number; resolution: LineCompositionResolution }
  class LineCompositionReader { resolveForOrder(salesOrderId: string, tx?: DbTx): Promise<ResolvedSalesOrderLine[]> }
  class LineCompositionManager { freezeFromMatching(entries: ReadonlyArray<{ salesOrderLineId: string; items: readonly CompositionItem[] }>, tx?: DbTx): Promise<void> }
  export async function findCompositionInvariantViolations(tx: DbTx): Promise<string[]>  // 위반 라인 id
  // Wired 에 추가: lineCompositions: LineCompositionReader; lineCompositionManager: LineCompositionManager
  ```

- [ ] **Step 1: 통합 스펙 쓰기**

`line-composition.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { findCompositionInvariantViolations } from './__support__/composition-invariant';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function twoSkus(tx: DbTx) {
  const { holderId } = await seedHolder(tx);
  const a = await seedSku(tx, holderId);
  const b = await seedSku(tx, holderId);
  return { a: a.skuId, b: b.skuId };
}

describeIfDb('LineCompositionReader / LineCompositionManager (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });
  const wire = () => wireLogistics(makeDbService(db));

  it('라인마다 판정과 유효 수량(주문 수량 − 부분 취소)을 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const matched = randomUUID();
      const unmatched = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: matched, quantity: 3 },
          { variantId: unmatched, quantity: 2 },
        ],
      });
      await seedMatching(tx, { variantId: matched, skuId: sku.a, quantity: 2 });
      await tx.insert(wmsTables.salesOrderCancellations).values({
        salesOrderId,
        cancellationScope: 'partial',
        reasonCode: 'it',
        metadata: { cancelledLines: [{ salesOrderLineId: lineIds[1], quantity: 2 }] },
      });

      const resolved = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      const byLine = new Map(resolved.map((r) => [r.line.id, r]));
      expect(byLine.get(lineIds[0])).toMatchObject({
        fulfillableQuantity: 3,
        resolution: { kind: 'follow', items: [{ skuId: sku.a, qtyPerUnit: 2 }] },
      });
      expect(byLine.get(lineIds[1])).toMatchObject({
        fulfillableQuantity: 0,
        resolution: { kind: 'missing', reason: 'NO_PRODUCT_SKU_MATCHING' },
      });
    });
  });

  it('굳히기는 출처 NULL 라인만 matching 으로 굳히고, 굳힌 뒤엔 상품매칭이 바뀌어도 굳힌 구성을 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
      const { matchingId } = await seedMatching(tx, { variantId, skuId: sku.a });

      await w.lineCompositionManager.freezeFromMatching(
        [{ salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] }],
        tx,
      );
      // 상품매칭을 다른 SKU 로 바꾼다
      await tx
        .update(wmsTables.productVariantSkuLinks)
        .set({ skuId: sku.b })
        .where(eq(wmsTables.productVariantSkuLinks.productMatchingId, matchingId));

      const [r] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      expect(r.resolution).toEqual({ kind: 'frozen', source: 'matching', items: [{ skuId: sku.a, qtyPerUnit: 1 }] });
      const [line] = await tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, lineIds[0]));
      expect(line.compositionSource).toBe('matching');
      expect(line.compositionSetAt).toBeInstanceOf(Date);
      expect(line.compositionSetBy).toBeNull();
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('이미 굳힌 라인을 다시 굳히려 하면 던진다 — 판매주문 잠금 아래에선 경합이 아니라 결함이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const sku = await twoSkus(tx);
      const { lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      const entry = { salesOrderLineId: lineIds[0], items: [{ skuId: sku.a, qtyPerUnit: 1 }] };
      await w.lineCompositionManager.freezeFromMatching([entry], tx);
      await expect(w.lineCompositionManager.freezeFromMatching([entry], tx)).rejects.toThrow(/already frozen/);
    });
  });

  it('구성이 빈 굳히기는 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire();
      const { lineIds } = await seedSalesOrder(tx, { lines: [{ variantId: randomUUID(), quantity: 1 }] });
      await expect(
        w.lineCompositionManager.freezeFromMatching([{ salesOrderLineId: lineIds[0], items: [] }], tx),
      ).rejects.toThrow(/empty/);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/product-matching/line-composition/line-composition.integration.spec.ts`
Expected: FAIL — `Cannot find module './__support__/composition-invariant'` 또는 `w.lineCompositions` undefined

- [ ] **Step 3: 리더 구현**

`line-composition.reader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, SalesOrderLine, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ProductSkuMappingService } from '../services/product-sku-mapping.service';
import {
  CompositionItem,
  isDigitalFulfillmentLine,
  LineCompositionResolution,
  resolveLineComposition,
} from './line-composition';
import { sumCancelledByLine } from './partial-cancellation';

export interface ResolvedSalesOrderLine {
  line: SalesOrderLine;
  /** 주문 수량 − 부분 취소. 0 이하면 FO 대상이 아니다 */
  fulfillableQuantity: number;
  resolution: LineCompositionResolution;
}

/**
 * 주문 하나의 라인 전부를 읽어 «적용 구성»을 판정한다(#1063 스펙 §5.1). FO 생성과 리컨실러가 이 리더만 부른다 —
 * 둘이 라인·유효 수량을 각자 읽으면 «워커는 풀리는데 리컨실러는 안 풀림» 같은 엇갈림이 생긴다.
 */
@Injectable()
export class LineCompositionReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly productSkuMapping: ProductSkuMappingService,
  ) {}

  async resolveForOrder(salesOrderId: string, tx?: DbTx): Promise<ResolvedSalesOrderLine[]> {
    return this.dbService.run(async (trx) => {
      const lines = await trx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
      if (lines.length === 0) return [];

      const frozenRows = await trx
        .select({
          salesOrderLineId: wmsTables.salesOrderLineCompositions.salesOrderLineId,
          skuId: wmsTables.salesOrderLineCompositions.skuId,
          qtyPerUnit: wmsTables.salesOrderLineCompositions.qtyPerUnit,
        })
        .from(wmsTables.salesOrderLineCompositions)
        .where(
          inArray(
            wmsTables.salesOrderLineCompositions.salesOrderLineId,
            lines.map((line) => line.id),
          ),
        );
      const frozenByLine = new Map<string, CompositionItem[]>();
      for (const row of frozenRows) {
        const items = frozenByLine.get(row.salesOrderLineId) ?? [];
        items.push({ skuId: row.skuId, qtyPerUnit: row.qtyPerUnit });
        frozenByLine.set(row.salesOrderLineId, items);
      }

      const cancellations = await trx
        .select({ metadata: wmsTables.salesOrderCancellations.metadata })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
      const cancelledByLine = sumCancelledByLine(cancellations.map((c) => c.metadata));

      const resolved: ResolvedSalesOrderLine[] = [];
      for (const line of lines) {
        // 굳힌 라인·디지털 라인은 상품매칭을 읽지 않는다 — 판정에 안 쓰는 조회를 줄인다
        const needsMatching = line.compositionSource === null && !isDigitalFulfillmentLine(line);
        const matching = needsMatching ? await this.productSkuMapping.getByVariant(line.variantId, trx) : null;
        resolved.push({
          line,
          fulfillableQuantity: line.quantity - (cancelledByLine.get(line.id) ?? 0),
          resolution: resolveLineComposition(line, frozenByLine.get(line.id) ?? [], matching),
        });
      }
      return resolved;
    }, tx);
  }
}
```

- [ ] **Step 4: 매니저 구현**

`line-composition.manager.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionItem } from './line-composition';

/**
 * 라인 구성(sales_order_lines.composition_* 와 sales_order_line_compositions)을 쓰는 유일한 자리(#1063 스펙 §4.3).
 * «출처가 있으면 행이 1개 이상»은 테이블을 건너는 조건이라 DB 가 못 지킨다 — 쓰는 곳을 여기 하나로 묶어 지킨다.
 */
@Injectable()
export class LineCompositionManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * FO 생성이 그 순간의 상품매칭을 라인에 굳힌다. 호출자는 판매주문을 이미 잠갔다 — 그래서 출처 NULL 조건이 0행이면
   * 경합이 아니라 «리더가 follow 라고 한 라인이 이미 굳어 있다»는 결함이다. 조용히 넘기면 FO 항목과 라인 구성이 갈린다.
   */
  async freezeFromMatching(
    entries: ReadonlyArray<{ salesOrderLineId: string; items: readonly CompositionItem[] }>,
    tx?: DbTx,
  ): Promise<void> {
    await this.dbService.run(async (trx) => {
      const now = new Date();
      for (const entry of entries) {
        if (entry.items.length === 0) {
          throw new Error(`Refusing to freeze an empty composition for line ${entry.salesOrderLineId}`);
        }
        const claimed = await trx
          .update(wmsTables.salesOrderLines)
          .set({ compositionSource: 'matching', compositionSetAt: now, compositionSetBy: null, updatedAt: now })
          .where(
            and(
              eq(wmsTables.salesOrderLines.id, entry.salesOrderLineId),
              isNull(wmsTables.salesOrderLines.compositionSource),
            ),
          )
          .returning({ id: wmsTables.salesOrderLines.id });
        if (claimed.length === 0) {
          throw new Error(`Line ${entry.salesOrderLineId} is already frozen or missing`);
        }
        await trx.insert(wmsTables.salesOrderLineCompositions).values(
          entry.items.map((item) => ({
            salesOrderLineId: entry.salesOrderLineId,
            skuId: item.skuId,
            qtyPerUnit: item.qtyPerUnit,
          })),
        );
      }
    }, tx);
  }
}
```

- [ ] **Step 5: 불변식 검사 헬퍼**

`__support__/composition-invariant.ts`:

```ts
import { sql } from 'drizzle-orm';
import { DbTx } from '../../../inventory/schema/inventory.schema';

/** «출처가 있으면 구성 행 ≥ 1, 없으면 0»(#1063 스펙 §4.3)을 어긴 라인 id. 통합 스펙이 시나리오 끝에 0 을 확인한다. */
export async function findCompositionInvariantViolations(tx: DbTx): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT l.id
    FROM sales_order_lines l
    LEFT JOIN sales_order_line_compositions c ON c.sales_order_line_id = l.id
    GROUP BY l.id, l.composition_source
    HAVING (l.composition_source IS NULL) <> (count(c.id) = 0)
  `);
  return rows.map((row) => row.id);
}
```

- [ ] **Step 6: 모듈에 등록**

`product-matching.module.ts` — import 두 줄을 더하고 providers·exports 에 넣는다:

```ts
import { LineCompositionReader } from './line-composition/line-composition.reader';
import { LineCompositionManager } from './line-composition/line-composition.manager';
```

```ts
  providers: [
    ProductMatchingService,
    ProductSkuMappingService,
    MatchingLinkResolver,
    LineCompositionReader,
    LineCompositionManager,
  ],
  exports: [
    ProductMatchingService, // Catalog BC (variant 생성 시 직접 호출)
    ProductSkuMappingService, // Fulfillment BC (FO 생성 시 SKU 조회)
    LineCompositionReader, // Fulfillment BC (FO 생성·리컨실러가 라인 구성 판정)
    LineCompositionManager, // Fulfillment BC (FO 생성이 라인 구성을 굳힌다)
  ],
```

- [ ] **Step 7: 테스트 그래프에 추가**

`logistics-wiring.ts` — import:

```ts
import { LineCompositionReader } from '../../../product-matching/line-composition/line-composition.reader';
import { LineCompositionManager } from '../../../product-matching/line-composition/line-composition.manager';
```

`Wired` 인터페이스에 `lineCompositions: LineCompositionReader; lineCompositionManager: LineCompositionManager;` 를 더하고, `wireLogistics` 에서 `productSkuMapping` 을 만든 줄 바로 뒤에:

```ts
  const lineCompositions = new LineCompositionReader(dbService, productSkuMapping);
  const lineCompositionManager = new LineCompositionManager(dbService);
```

반환 객체에 `lineCompositions, lineCompositionManager,` 를 더한다. (Task 4 가 `FulfillmentsService` 생성자에 이 둘을 넘긴다.)

- [ ] **Step 8: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/product-matching/line-composition/line-composition.integration.spec.ts`
Expected: PASS (4 tests)

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 9: Commit**

```bash
git add apps/core/src/modules/product-matching apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts
git commit -m "feat(core): 라인 구성 리더·매니저 — 판정은 리더 하나, 굳히기는 매니저 하나 (#1063)"
```

---

### Task 4: FO 생성이 리더로 판정하고 굳힌다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.ts` (생성자 ~74-83, `requiresPhysicalFulfillmentOrder` ~85, `createV2` ~152-210, `hasWarehouseControlledDemandPreflight` ~330, `buildItemsFromSalesOrder` ~433-525, `loadPartialCancelledLineQuantities` ~527-548, `isVoidMatching`·`isDigitalFulfillmentLine`·`getPhysicalSkuLinks`·`getMatchingFailureReason` ~550-590)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/logistics-wiring.ts` (`new FulfillmentsService(` 인자)
- Modify: `apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts` (가짜 상태·`makeService`·새 테스트)
- Test: `apps/core/src/modules/fulfillment/services/fulfillments.line-composition.integration.spec.ts`

**Interfaces:**
- Consumes: `LineCompositionReader.resolveForOrder`, `LineCompositionManager.freezeFromMatching`, `blocksFulfillment`, `CompositionItem` (Task 2·3)
- Produces: `FulfillmentsService` 생성자 = `(db, reservationLifecycle, lineCompositions: LineCompositionReader, fulfillmentsV1, workflowGate, lineCompositionManager: LineCompositionManager, shipmentReservation?, fulfillmentProgress?)`. `productSkuMapping` 인자는 빠진다(이 서비스에서 더 쓰지 않는다)

- [ ] **Step 1: 통합 스펙 쓰기**

`fulfillments.line-composition.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { findCompositionInvariantViolations } from '../../product-matching/line-composition/__support__/composition-invariant';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function freezeAsOperator(tx: DbTx, lineId: string, skuId: string, qtyPerUnit: number) {
  // 운영자 지정 API 는 PR 2 다 — 여기선 그 결과 상태를 직접 만든다
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ compositionSource: 'operator', compositionSetAt: new Date(), compositionSetBy: randomUUID() })
    .where(eq(wmsTables.salesOrderLines.id, lineId));
  await tx.insert(wmsTables.salesOrderLineCompositions).values({ salesOrderLineId: lineId, skuId, qtyPerUnit });
}

async function foItems(tx: DbTx, salesOrderId: string) {
  return tx
    .select({
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      skuId: wmsTables.fulfillmentOrderItems.skuId,
      qty: wmsTables.fulfillmentOrderItems.qty,
    })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderId, salesOrderId));
}

async function compositionOf(tx: DbTx, lineId: string) {
  const [line] = await tx
    .select({ source: wmsTables.salesOrderLines.compositionSource })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.id, lineId));
  const rows = await tx
    .select({ skuId: wmsTables.salesOrderLineCompositions.skuId, qtyPerUnit: wmsTables.salesOrderLineCompositions.qtyPerUnit })
    .from(wmsTables.salesOrderLineCompositions)
    .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, lineId));
  return { source: line.source, rows };
}

describeIfDb('FO 생성의 라인 구성 판정·굳히기 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function world(tx: DbTx) {
    const { warehouseId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const a = (await seedSku(tx, holderId)).skuId;
    const b = (await seedSku(tx, holderId)).skuId;
    return { warehouseId, a, b };
  }

  it('상품매칭을 따르는 라인을 FO 생성 순간에 matching 으로 굳히고 그 구성으로 FO 항목을 만든다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a } = await world(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 2 }] });
      await seedMatching(tx, { variantId, skuId: a, quantity: 3 });

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      expect(await compositionOf(tx, lineIds[0])).toEqual({ source: 'matching', rows: [{ skuId: a, qtyPerUnit: 3 }] });
      expect(await foItems(tx, salesOrderId)).toEqual([{ salesOrderLineId: lineIds[0], skuId: a, qty: 6 }]);
      expect(await findCompositionInvariantViolations(tx)).toEqual([]);
    });
  });

  it('운영자가 굳힌 라인은 상품매칭이 없어도 그 구성으로 나가고, 섞인 다른 라인만 새로 굳힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a, b } = await world(tx);
      const operatorVariant = randomUUID();
      const followVariant = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: operatorVariant, quantity: 1 },
          { variantId: followVariant, quantity: 1 },
        ],
      });
      await freezeAsOperator(tx, lineIds[0], b, 2);
      await seedMatching(tx, { variantId: followVariant, skuId: a });

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      expect(await compositionOf(tx, lineIds[0])).toEqual({ source: 'operator', rows: [{ skuId: b, qtyPerUnit: 2 }] });
      expect(await compositionOf(tx, lineIds[1])).toEqual({ source: 'matching', rows: [{ skuId: a, qtyPerUnit: 1 }] });
      const items = await foItems(tx, salesOrderId);
      expect(items).toHaveLength(2);
      expect(items).toEqual(
        expect.arrayContaining([
          { salesOrderLineId: lineIds[0], skuId: b, qty: 2 },
          { salesOrderLineId: lineIds[1], skuId: a, qty: 1 },
        ]),
      );
    });
  });

  it('운영자가 굳힌 라인은 상품매칭이 void 여도 굳힌 구성으로 나간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a } = await world(tx);
      const variantId = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
      await seedMatching(tx, { variantId, skuId: a, strategy: 'void' });
      await freezeAsOperator(tx, lineIds[0], a, 1);

      await w.fulfillments.create({ salesOrderId, warehouseId }, tx);

      expect(await foItems(tx, salesOrderId)).toEqual([{ salesOrderLineId: lineIds[0], skuId: a, qty: 1 }]);
    });
  });

  it('미매칭 라인이 있으면 아무것도 굳히지 않고 그 라인만 missingLines 로 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { warehouseId, a } = await world(tx);
      const matched = randomUUID();
      const missing = randomUUID();
      const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
        lines: [
          { variantId: matched, quantity: 1 },
          { variantId: missing, quantity: 1 },
        ],
      });
      await seedMatching(tx, { variantId: matched, skuId: a });

      const error = await w.fulfillments.create({ salesOrderId, warehouseId }, tx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        missingLines: [{ salesOrderLineId: lineIds[1], variantId: missing, reason: 'NO_PRODUCT_SKU_MATCHING' }],
      });
      expect((await compositionOf(tx, lineIds[0])).source).toBeNull();
    });
  });

  it('굳힌 뒤 같은 트랜잭션의 검증(창고 SKU·직배송 SKU 혼합)이 실패하면 굳힌 것도 남지 않는다', async () => {
    const { warehouseId, salesOrderId } = await db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const seeded = await world(tx);
      await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, seeded.b));
      const v1 = randomUUID();
      const v2 = randomUUID();
      const order = await seedSalesOrder(tx, {
        lines: [
          { variantId: v1, quantity: 1 },
          { variantId: v2, quantity: 1 },
        ],
      });
      await seedMatching(tx, { variantId: v1, skuId: seeded.a });
      await seedMatching(tx, { variantId: v2, skuId: seeded.b });
      return { ...seeded, ...order };
    });
    try {
      const w = wireLogistics(makeDbService(db));
      // tx 없이 부르면 create 가 자기 트랜잭션을 연다 — 실패 시 그 트랜잭션 전체가 롤백되는지 본다
      await expect(w.fulfillments.create({ salesOrderId, warehouseId })).rejects.toMatchObject({
        response: { code: 'V2_MIXED_DIRECT_AND_WAREHOUSE_FULFILLMENT' },
      });
      const lines = await db
        .select({ source: wmsTables.salesOrderLines.compositionSource })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId));
      expect(lines.map((l) => l.source)).toEqual([null, null]);
    } finally {
      await db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId));
    }
  });
});
```

마지막 테스트는 커밋된 데이터를 쓰므로 `finally` 에서 판매주문을 지운다(라인·구성은 cascade). 픽스처 창고·SKU·매칭 행은 다른 스펙과 겹치지 않는 임의 이름이라 남겨도 된다.

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/fulfillments.line-composition.integration.spec.ts`
Expected: FAIL — 첫 테스트의 `source` 가 `null`(아직 굳히지 않는다)

- [ ] **Step 3: 생성자 바꾸기**

`fulfillments.service.ts` import 정리 — 지울 것: `isVoidMatching, physicalSkuLinks`(fulfillable-matching), `ProductSkuMappingService`. 더할 것:

```ts
import { LineCompositionReader } from '../../product-matching/line-composition/line-composition.reader';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { blocksFulfillment, CompositionItem } from '../../product-matching/line-composition/line-composition';
```

`type VariantSkuMatching = …`·`type PartialCancelledLineQuantity = …` 두 타입을 지운다. 생성자:

```ts
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly reservationLifecycle: ReservationLifecycleService,
    private readonly lineCompositions: LineCompositionReader,
    @InjectPublisher(FULFILLMENT_STREAM)
    private readonly fulfillmentsV1: PublisherFor<typeof FULFILLMENT_STREAM>,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly lineCompositionManager: LineCompositionManager,
    @Optional() private readonly shipmentReservation?: ShipmentReservationService,
    @Optional() private readonly fulfillmentProgress?: FulfillmentProgressService,
  ) {}
```

`UnmatchedSalesOrderLine.reason` 의 타입을 `MatchingFailureReason` 으로 좁히려면 import 에 `MatchingFailureReason` 을 더하고 `reason: MatchingFailureReason;` 로 바꾼다.

- [ ] **Step 4: `buildItemsFromSalesOrder` 를 리더로**

메서드 전체를 바꾼다:

```ts
  /**
   * 판매주문 → FO 항목. 판정은 LineCompositionReader 하나가 한다(#1063 스펙 §5.3-1). 이 메서드는 읽기만 한다 —
   * 미리 판정(requiresPhysicalFulfillmentOrder·preflight)에서도 불리므로, 굳히기는 잠금을 쥔 createV2 가 `freeze` 를 받아서 한다.
   */
  private async buildItemsFromSalesOrder(
    salesOrderId: string,
    trx: DbTx,
  ): Promise<{
    items: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[];
    freeze: Array<{ salesOrderLineId: string; items: CompositionItem[] }>;
  }> {
    const resolved = await this.lineCompositions.resolveForOrder(salesOrderId, trx);
    if (resolved.length === 0) {
      throw new BadRequestException(`Sales order ${salesOrderId} has no lines`);
    }

    const items: Omit<FulfillmentOrderItemInsert, 'fulfillmentOrderId'>[] = [];
    const missingLines: UnmatchedSalesOrderLine[] = [];
    const freeze: Array<{ salesOrderLineId: string; items: CompositionItem[] }> = [];

    for (const entry of resolved) {
      const { line, fulfillableQuantity, resolution } = entry;
      if (blocksFulfillment(entry) && resolution.kind === 'missing') {
        missingLines.push({ salesOrderLineId: line.id, variantId: line.variantId, reason: resolution.reason });
        continue;
      }
      if (fulfillableQuantity <= 0) continue;
      // 디지털 라인은 물리 출고 대상이 아니다 — digital-only 주문은 결과가 비어 backlog not_required 로 닫힌다
      if (resolution.kind === 'digital' || resolution.kind === 'void' || resolution.kind === 'missing') continue;
      if (resolution.kind === 'follow') freeze.push({ salesOrderLineId: line.id, items: resolution.items });
      for (const item of resolution.items) {
        items.push({
          salesOrderId,
          salesOrderLineId: line.id,
          mappingSnapshotId: null,
          variantId: line.variantId,
          skuId: item.skuId,
          qty: fulfillableQuantity * item.qtyPerUnit,
          reservedQty: 0,
          pickedQty: 0,
          shippedQty: 0,
          status: 'pending',
        });
      }
    }

    if (missingLines.length > 0) {
      throw new BadRequestException({
        code: 'PRODUCT_SKU_MATCHING_REQUIRED',
        message: 'Cannot create fulfillment order because some sales order lines have no SKU matching',
        missingLines,
      });
    }

    return { items, freeze };
  }
```

`loadPartialCancelledLineQuantities`·`isVoidMatching`·`isDigitalFulfillmentLine`·`getPhysicalSkuLinks`·`getMatchingFailureReason` 다섯 private 메서드를 지운다(리더·순수 함수로 옮겨 갔다). 지우기 전에 `grep -n "loadPartialCancelledLineQuantities\|isDigitalFulfillmentLine\|getPhysicalSkuLinks\|getMatchingFailureReason\|this.isVoidMatching" apps/core/src/modules/fulfillment/services/fulfillments.service.ts` 로 다른 사용처가 없는지 확인한다 — 있으면 그 자리는 순수 함수(`isDigitalFulfillmentLine` 등)를 import 해 쓴다.

- [ ] **Step 5: 세 호출부 고치기**

`requiresPhysicalFulfillmentOrder`:

```ts
      const { items } = await this.buildItemsFromSalesOrder(salesOrderId, trx);
      return items.length > 0;
```

`hasWarehouseControlledDemandPreflight` 의 salesOrderId 분기:

```ts
      const { items } = await this.buildItemsFromSalesOrder(dto.salesOrderId, executor);
      skuIds = items.map((item) => item.skuId);
```

`createV2` — `let itemsToInsert …;` 선언 줄 바로 아래에 `let freeze: Array<{ salesOrderLineId: string; items: CompositionItem[] }> = [];` 를 두고, salesOrderId 분기를:

```ts
      } else if (dto.salesOrderId) {
        const built = await this.buildItemsFromSalesOrder(dto.salesOrderId, trx);
        itemsToInsert = built.items;
        freeze = built.freeze;
      } else {
```

`if (itemsToInsert.length === 0) throw new BadRequestException('Fulfillment order items cannot be empty');` 줄 바로 다음에:

```ts
      // 판매주문 잠금 아래에서 굳힌다(#1063 스펙 §5.4). 뒤 검증이 실패하면 이 트랜잭션과 함께 롤백된다.
      if (freeze.length > 0) await this.lineCompositionManager.freezeFromMatching(freeze, trx);
```

- [ ] **Step 6: 테스트 그래프 생성자 인자**

`logistics-wiring.ts` 의 `new FulfillmentsService(` 를:

```ts
  const fulfillments = new FulfillmentsService(
    dbService,
    lifecycle,
    lineCompositions,
    fulfillmentV1Publisher,
    workflowGate,
    lineCompositionManager,
    shipmentReservations,
    progress,
  );
```

(`lineCompositions`·`lineCompositionManager` 는 Task 3 에서 이 줄보다 위에 만들었다.)

- [ ] **Step 7: 단위 스펙 가짜 고치기**

`fulfillments.service.spec.ts`:

1. 맨 위 import 에 `import { LineCompositionReader } from '../../product-matching/line-composition/line-composition.reader';`
2. `FakeState` 에 `salesOrderLineCompositions: Array<Record<string, any>>;` 를, `selectRowsFor` 에 `if (table === wmsTables.salesOrderLineCompositions) return state.salesOrderLineCompositions;` 를 더한다
3. `makeService` options 에 `lineCompositions?: Array<Record<string, any>>;` 를 더하고, `mappingSnapshots` option 과 `productSkuMapping.getMappingSnapshot` 목을 지운다
4. state 의 `salesOrderLines` 를 출처 기본값이 붙게:
   ```ts
      salesOrderLines: (options.lines ?? [
        { id: salesOrderLineId, salesOrderId, variantId, quantity: 1 },
      ]).map((line) => ({ compositionSource: null, ...line })),
      salesOrderLineCompositions: options.lineCompositions ?? [],
   ```
   그리고 테스트들의 `lines` 항목에 남은 `mappingSnapshotId: null,` 줄을 지운다
5. 생성자 호출을:
   ```ts
    const lineCompositionManager = { freezeFromMatching: jest.fn().mockResolvedValue(undefined) };
    const service = new FulfillmentsService(
      db as any,
      reservationLifecycle as any,
      new LineCompositionReader(db as any, productSkuMapping as any),
      outbox as any,
      {
        assertV2MutationAllowed: jest.fn(),
        assertOperationalMutationAllowed: jest.fn(),
      } as any,
      lineCompositionManager as any,
      shipmentReservation as any,
      fulfillmentProgress as any,
    );
   ```
   반환 객체에 `lineCompositionManager` 를 더한다

이 파일의 기존 `as any` 는 가짜 db 를 넘기는 이 스펙의 기존 관례다 — 새로 더한 두 곳도 같은 이유다.

- [ ] **Step 8: 단위 스펙에 새 테스트**

`it('sales order line 이 없으면 빈 FO를 만들지 않는다'` 바로 위에:

```ts
  it('상품매칭을 따르는 라인만 굳히기로 넘기고, 이미 굳힌 라인은 굳힌 구성으로 FO 항목을 만든다', async () => {
    const frozenLineId = '88888888-8888-8888-8888-888888888888';
    const frozenSkuId = '99999999-9999-9999-9999-999999999999';
    const { service, state, lineCompositionManager } = makeService({
      lines: [
        { id: salesOrderLineId, salesOrderId, variantId, quantity: 1 },
        { id: frozenLineId, salesOrderId, variantId: voidVariantId, quantity: 2, compositionSource: 'operator' },
      ],
      skus: [
        { id: skuId, holderId: null },
        { id: frozenSkuId, holderId: null },
      ],
      lineCompositions: [{ salesOrderLineId: frozenLineId, skuId: frozenSkuId, qtyPerUnit: 1 }],
      links: [{ skuId, quantity: 2 }],
    });

    await service.create({ salesOrderId, warehouseId });

    expect(lineCompositionManager.freezeFromMatching).toHaveBeenCalledWith(
      [{ salesOrderLineId, items: [{ skuId, qtyPerUnit: 2 }] }],
      expect.anything(),
    );
    expect(state.fulfillmentOrderItems.map((i) => [i.salesOrderLineId, i.skuId, i.qty])).toEqual([
      [salesOrderLineId, skuId, 2],
      [frozenLineId, frozenSkuId, 2],
    ]);
  });
```

가짜 `select().from(salesOrderLineCompositions).where()` 는 where 를 무시하고 전부 돌려준다 — 그래서 여기 구성 행은 굳힌 라인 것 하나만 둔다.

- [ ] **Step 9: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillments.service.spec.ts`
Expected: PASS (기존 테스트 전부 + 새 1개)

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/fulfillments.line-composition.integration.spec.ts`
Expected: PASS (5 tests)

Run: `npm run type-check`
Expected: 에러 0 — 다른 곳에서 `new FulfillmentsService(` 를 부르면 여기서 잡힌다(`grep -rn "new FulfillmentsService(" apps/core/src` 로 확인, 계획 작성 시점엔 wiring·단위 스펙 두 곳)

- [ ] **Step 10: 기존 FO 생성 통합 스펙 회귀**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts apps/core/src/modules/fulfillment/services/shipment-reservation.integration.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-order-creation-backlog`
Expected: develop 과 같은 결과(새 실패 0). develop 에서 이미 빨간 스펙은 메모리 `core-integration-tests-local` 목록·PR #1004 본문의 base-red 목록과 대조한다.

- [ ] **Step 11: Commit**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(core): FO 생성이 라인 구성 리더로 판정하고 상품매칭을 라인에 굳힌다 (#1063)"
```

---

### Task 5: 리컨실러 12번이 리더로 판정한다

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts`

**Interfaces:**
- Consumes: `LineCompositionReader.resolveForOrder`, `blocksFulfillment`, `LineCompositionResolution`
- Produces: `WakeAwaitingMatchingRule` 생성자 = `(backlog, workflowGate, lineCompositions: LineCompositionReader)`

- [ ] **Step 1: 스펙에 새 테스트 셋**

`wake-awaiting-matching.rule.integration.spec.ts` — `wire()` 의 규칙 생성을 `new WakeAwaitingMatchingRule(w.backlog, gate(mode), w.lineCompositions)` 로 바꾸고, `describeIfDb` 안 마지막에 더한다:

```ts
  it('상품매칭은 미해결이어도 운영자가 라인을 굳혔으면 풀린 주문이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      const [line] = await tx
        .select({ id: wmsTables.salesOrderLines.id })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, o.salesOrderId));
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: 'operator', compositionSetAt: new Date() })
        .where(eq(wmsTables.salesOrderLines.id, line.id));
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: line.id, skuId: world.skuId, qtyPerUnit: 1 });

      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
    });
  });

  it('전량 취소된 미매칭 라인은 막지 않는다 — FO 생성과 같은 판정', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const o = await seedAwaiting(tx);
      const [line] = await tx
        .select({ id: wmsTables.salesOrderLines.id, quantity: wmsTables.salesOrderLines.quantity })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, o.salesOrderId));
      await tx.insert(wmsTables.salesOrderCancellations).values({
        salesOrderId: o.salesOrderId,
        cancellationScope: 'partial',
        reasonCode: 'it',
        metadata: { cancelledLines: [{ salesOrderLineId: line.id, quantity: line.quantity }] },
      });
      expect(await rule.check(o.salesOrderId, tx)).toBe(true);
    });
  });

  it('지문은 라인을 굳히면 바뀐다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { rule } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      const before = await rule.fingerprint(o.salesOrderId, tx);
      const [line] = await tx
        .select({ id: wmsTables.salesOrderLines.id })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.salesOrderId, o.salesOrderId));
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ compositionSource: 'operator', compositionSetAt: new Date() })
        .where(eq(wmsTables.salesOrderLines.id, line.id));
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: line.id, skuId: world.skuId, qtyPerUnit: 1 });
      expect(await rule.fingerprint(o.salesOrderId, tx)).not.toBe(before);
    });
  });
```

기존 테스트 `'기다리는 variant 가 비었거나 배열이 아니면 not_needed'` 는 이제 대기 목록이 아니라 라인을 보므로 이름만 `'라인이 미매칭이면 대기 목록 모양과 무관하게 not_needed'` 로 바꾼다(단언은 그대로 — 두 주문의 라인이 미매칭이다).

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts`
Expected: FAIL — 생성자 인자 타입 에러 또는 새 테스트 셋 실패

- [ ] **Step 3: 규칙 구현**

`wake-awaiting-matching.rule.ts` — import 에서 `isFulfillableMatching`·`ProductSkuMappingService` 를 지우고:

```ts
import { blocksFulfillment, LineCompositionResolution } from '../../../product-matching/line-composition/line-composition';
import { LineCompositionReader } from '../../../product-matching/line-composition/line-composition.reader';
```

생성자의 `private readonly skuMapping: ProductSkuMappingService,` 를 `private readonly lineCompositions: LineCompositionReader,` 로 바꾸고, `fingerprint`·`check`·`waitingVariantIds` 와 파일 끝 `parseVariantIds` 를 다음으로 바꾼다:

```ts
  /**
   * 라인별 판정 결과(종류·구성·사유)와 유효 수량. 운영자가 상품매칭을 손보거나 라인을 굳히면 바뀌어 횟수·포기가 리셋된다.
   * 대기 목록(waitingVariantIds)을 보지 않는다 — 1회 지정은 variant 가 아니라 라인을 푼다(#1063 스펙 §5.3-2).
   */
  async fingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    const resolved = await this.lineCompositions.resolveForOrder(salesOrderId, tx);
    return resolved
      .map((r) => `${r.line.id}:${r.fulfillableQuantity}:${describeResolution(r.resolution)}`)
      .sort()
      .join(';');
  }

  async check(salesOrderId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다(§4.4-5)
    if (!this.workflowGate.shouldRunFoCreation()) return false;
    const backlog = await this.backlog.findBySalesOrderId(salesOrderId, tx);
    if (!backlog || backlog.status !== 'awaiting_matching') return false;
    const resolved = await this.lineCompositions.resolveForOrder(salesOrderId, tx);
    return resolved.length > 0 && !resolved.some(blocksFulfillment);
  }
```

`act` 는 그대로 둔다. 파일 끝에:

```ts
function describeResolution(resolution: LineCompositionResolution): string {
  switch (resolution.kind) {
    case 'frozen':
      return `frozen/${resolution.source}/${resolution.items.map((i) => `${i.skuId}x${i.qtyPerUnit}`).join(',')}`;
    case 'follow':
      return `follow/${resolution.items.map((i) => `${i.skuId}x${i.qtyPerUnit}`).join(',')}`;
    case 'missing':
      return `missing/${resolution.reason}`;
    default:
      return resolution.kind;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
Expected: PASS. 기존 지문 테스트(`'지문은 기존 매칭의 링크를 upsert 로 고치면 바뀌고, 그대로면 같다'`)도 통과해야 한다 — follow 구성이 바뀌므로.

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile
git commit -m "feat(core): 리컨실러 12번이 라인 구성 리더로 판정 — 1회 지정으로 풀린 주문도 깨운다 (#1063)"
```

---

### Task 6: SQL 술어와 화면 판정 둘(매칭체크·주문 목록 배지)

**Files:**
- Create: `apps/core/src/modules/product-matching/line-composition/line-resolved.sql.ts`
- Test: `apps/core/src/modules/product-matching/line-composition/line-resolved.parity.integration.spec.ts`
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts` (`getOrderLines` ~689-850)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`getOne` ~758-776, `list` 라인 조회 ~1107)
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-response.dto.ts` (`SalesOrderLineResponseDto`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts`
- Modify: `apps/admin-web/src/features/order/history/hooks/demo-order-line.ts`, `demo-order-line.spec.ts`

**Interfaces:**
- Consumes: 리더(parity 비교용), Task 1 의 `compositionSource`
- Produces: `export function lineResolvedSql(): SQL<boolean>` — `sales_order_lines` 가 별칭 없이 FROM 에 있는 쿼리에서 쓴다. 판매주문 목록·상세 응답의 라인에 `matchingResolved: boolean`. 매칭체크 응답 행에 `compositionSource?: 'matching' | 'operator'`

- [ ] **Step 1: parity 스펙 쓰기**

`line-resolved.parity.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  seedHolder,
  seedSalesOrder,
  seedSku,
  wireLogistics,
} from '../../fulfillment/services/__support__';
import { lineResolvedSql } from './line-resolved.sql';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type MatchingSeed =
  | null
  | { status: 'pending' | 'matched' | 'ignored'; strategy: 'variant' | 'void' | null; links: number };

const CASES: Array<{ name: string; matching: MatchingSeed; operator?: boolean }> = [
  { name: '매칭 없음', matching: null },
  { name: 'pending', matching: { status: 'pending', strategy: null, links: 0 } },
  { name: 'ignored + 링크', matching: { status: 'ignored', strategy: 'variant', links: 1 } },
  { name: 'matched variant 링크 0', matching: { status: 'matched', strategy: 'variant', links: 0 } },
  { name: 'matched variant 링크 1', matching: { status: 'matched', strategy: 'variant', links: 1 } },
  { name: 'matched void', matching: { status: 'matched', strategy: 'void', links: 0 } },
  { name: 'matched strategy null', matching: { status: 'matched', strategy: null, links: 0 } },
  { name: '운영자 지정 + 매칭 없음', matching: null, operator: true },
  { name: '운영자 지정 + pending', matching: { status: 'pending', strategy: null, links: 0 }, operator: true },
];

async function seedCase(tx: DbTx, skuId: string, c: (typeof CASES)[number]) {
  const variantId = randomUUID();
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity: 1 }] });
  if (c.matching) {
    const [m] = await tx
      .insert(wmsTables.productMatchings)
      .values({ variantId, status: c.matching.status, strategy: c.matching.strategy, isResolved: c.matching.status === 'matched' })
      .returning();
    for (let i = 0; i < c.matching.links; i += 1) {
      await tx.insert(wmsTables.productVariantSkuLinks).values({ productMatchingId: m.id, skuId, quantity: 1 });
    }
  }
  if (c.operator) {
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ compositionSource: 'operator', compositionSetAt: new Date() })
      .where(inArray(wmsTables.salesOrderLines.id, lineIds));
    await tx.insert(wmsTables.salesOrderLineCompositions).values({ salesOrderLineId: lineIds[0], skuId, qtyPerUnit: 1 });
  }
  return { salesOrderId, lineId: lineIds[0] };
}

describeIfDb('lineResolvedSql ↔ resolveLineComposition parity (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it.each(CASES)('$name: SQL 술어와 TS 판정이 같은 답', async (c) => {
    await inRollbackTx(db, async (tx) => {
      const w = wireLogistics(makeDbService(db));
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const { salesOrderId, lineId } = await seedCase(tx, skuId, c);

      const [ts] = await w.lineCompositions.resolveForOrder(salesOrderId, tx);
      const tsResolved = ts.resolution.kind === 'frozen' || ts.resolution.kind === 'follow' || ts.resolution.kind === 'void';
      const [row] = await tx
        .select({ resolved: lineResolvedSql() })
        .from(wmsTables.salesOrderLines)
        .where(inArray(wmsTables.salesOrderLines.id, [lineId]));
      expect(row.resolved).toBe(tsResolved);
    });
  });
});
```

`matchingStrategyEnum` 은 `['void', 'variant']` 뿐이다 — 그 밖의 전략 문자열은 DB 에 들어갈 수 없어 parity 케이스에 없다.

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/product-matching/line-composition/line-resolved.parity.integration.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 술어 구현**

`line-resolved.sql.ts`:

```ts
import { SQL, sql } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * «이 라인은 매칭이 해결됐나» — resolveLineComposition 의 SQL 짝(#1063 스펙 §5.2). TS 에서 frozen·follow·void 인 라인이 참이다.
 * 목록 화면은 SQL 로 걸러야 해서 이 술어가 따로 있다 — 둘이 같은 답을 내는지는 line-resolved.parity.integration.spec.ts 가 지킨다.
 *
 * 조인을 요구하지 않는다(상관 서브쿼리) — 조인을 요구하면 쓰는 쿼리마다 모양이 갈린다. `sales_order_lines` 가 별칭 없이
 * FROM 에 있는 쿼리에서만 쓴다. 서브쿼리 별칭(resolved_pm·resolved_k)은 바깥 쿼리가 product_matchings 를 조인해도 섞이지 않게 붙였다.
 */
export function lineResolvedSql(): SQL<boolean> {
  const line = wmsTables.salesOrderLines;
  return sql<boolean>`(${line.compositionSource} IS NOT NULL OR EXISTS (
    SELECT 1 FROM product_matchings resolved_pm
    WHERE resolved_pm.variant_id = ${line.variantId}
      AND resolved_pm.status = 'matched'
      AND (
        resolved_pm.strategy = 'void'
        OR (
          resolved_pm.strategy = 'variant'
          AND EXISTS (SELECT 1 FROM product_variant_sku_links resolved_k WHERE resolved_k.product_matching_id = resolved_pm.id)
        )
      )
  ))`;
}
```

- [ ] **Step 4: parity 통과 확인**

Run: (Step 2 와 같다)
Expected: PASS (케이스 전부)

- [ ] **Step 5: 매칭체크 목록을 술어로**

`product-matching.service.ts` `getOrderLines` — import 에 `import { lineResolvedSql } from '../line-composition/line-resolved.sql';` 를 더하고, `else if (excludeMatched) { … }` 블록 전체를:

```ts
      } else if (excludeMatched) {
        // «해결된 라인 제외» 판정은 라인 구성 판정의 SQL 짝 하나로 한다(#1063) — 1회 지정·void 로 풀린 라인도 빠진다
        conditions.push(sql`NOT ${lineResolvedSql()}`);
      }
```

rows 의 select 에 `compositionSource: salesOrderLines.compositionSource,` 를, `data` 매핑에 `compositionSource: row.compositionSource ?? undefined,` 를 더한다. 이 블록에서만 쓰던 `or`·`ne`·`isNull` import 가 남지 않았는지 `npm run type-check`·lint 로 확인한다(다른 곳에서 쓰면 그대로 둔다).

- [ ] **Step 6: 판매주문 라인에 `matchingResolved`**

`sales-orders.service.ts` — import 에 `getTableColumns`(drizzle-orm)와 `import { lineResolvedSql } from '../../product-matching/line-composition/line-resolved.sql';` 를 더한다.

`getOne` 의 라인 조회를:

```ts
    // 라인 배지(«매칭 대기»)는 이 값을 본다 — 옛 product_matching_id 는 #1063 부터 쓰이지 않는다
    const lines = await db
      .select({ ...getTableColumns(wmsTables.salesOrderLines), matchingResolved: lineResolvedSql() })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, id));
```

`list` 의 `const lines = await trx.select().from(S.salesOrderLines).where(inArray(S.salesOrderLines.salesOrderId, orderIds));` 를:

```ts
      const lines = await trx
        .select({ ...getTableColumns(S.salesOrderLines), matchingResolved: lineResolvedSql() })
        .from(S.salesOrderLines)
        .where(inArray(S.salesOrderLines.salesOrderId, orderIds));
```

`sales-order-response.dto.ts` 의 `SalesOrderLineResponseDto` 에 (`mappingSnapshotId` 다음):

```ts
  @ApiProperty({ description: '매칭 해결 여부 — 라인 구성을 굳혔거나 상품매칭이 실물/void 로 해결됨(#1063)' })
  matchingResolved: boolean;
```

`npm run type-check` 가 이 DTO 를 다른 곳에서 만드는 자리를 잡으면, 그 자리도 같은 select 로 바꾸거나 거기가 라인 응답이 아니면 DTO 사용을 확인한다.

- [ ] **Step 7: 목록 통합 스펙에 단언**

`sales-orders.list.integration.spec.ts` 의 `insertLine` 이 받는 Partial 에 `compositionSource?: 'matching' | 'operator' | null` 은 넣지 않는다(이 스펙은 상품매칭으로 확인한다). 새 테스트를 `'keyword: 상품명 …'` 테스트 위에 더한다:

```ts
  it('라인마다 matchingResolved 를 낸다 — void 상품매칭도 해결로 본다', async () => {
    await run(async (tx, svc, tag) => {
      const voidVariant = randomUUID();
      await tx
        .insert(wmsTables.productMatchings)
        .values({ variantId: voidVariant, status: 'matched', strategy: 'void', isResolved: true });
      const order = await insertOrder(tx, { channelOrderId: `${tag}-resolved` });
      await tx.insert(wmsTables.salesOrderLines).values({
        salesOrderId: order,
        variantId: voidVariant,
        productName: 'void line',
        quantity: 1,
      });
      await insertLine(tx, order, { productName: 'unmatched line' });

      const res = await listByKeyword(svc, tx, { keyword: tag });
      const lines = res.data[0].lines as Array<{ productName: string; matchingResolved: boolean }>;
      expect(Object.fromEntries(lines.map((l) => [l.productName, l.matchingResolved]))).toEqual({
        'void line': true,
        'unmatched line': false,
      });
    });
  });
```

(`run`·`listByKeyword`·`insertOrder`·`insertLine` 은 이 파일의 기존 헬퍼다. 기존 테스트들처럼 `channelOrderId` 에 tag 를 넣고 keyword 로 tag 를 주면 이 테스트가 만든 주문만 나온다.)

- [ ] **Step 8: admin-web 배지**

`demo-order-line.ts`:

```ts
export function isOrderLineMatched(
  line: { matchingResolved?: boolean | null; variantId?: string | null },
  stage: string | undefined
): boolean {
  // core 가 라인 구성 판정으로 내려준 값을 본다(#1063). 옛 productMatchingId 는 더 쓰이지 않는다.
  // Demo orders already select a catalog variant and do not need a legacy channel matching record.
  return !!line.matchingResolved || (stage === 'demo' && !!line.variantId);
}
```

`demo-order-line.spec.ts` 의 마지막 테스트를:

```ts
  it('outside demo, follows the core matchingResolved flag', () => {
    expect(isOrderLineMatched({ variantId: 'variant' }, 'live')).toBe(false);
    expect(isOrderLineMatched({ variantId: 'variant', matchingResolved: false }, 'live')).toBe(false);
    expect(isOrderLineMatched({ matchingResolved: true }, 'live')).toBe(true);
  });
```

- [ ] **Step 9: 통과 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts apps/core/src/modules/product-matching/line-composition/line-resolved.parity.integration.spec.ts`
Expected: PASS

Run: `npx jest apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts apps/core/src/modules/product-matching`
Expected: PASS — 단위 가짜는 select 인자를 무시하므로 `getOne` 테스트가 그대로 돈다

Run: `npm run test:admin-web -- demo-order-line`
Expected: PASS

Run: `npm run type-check && (cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 10: Commit**

```bash
git add apps/core/src/modules/product-matching apps/core/src/modules/sales-order apps/admin-web/src/features/order/history/hooks
git commit -m "feat(core,admin-web): 라인 해결 SQL 술어 — 매칭체크·주문 목록 배지가 라인 구성 판정을 본다 (#1063)"
```

---

### Task 7: 14번 필터 — «매칭 대기 주문»

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`list` 의 `case 'unmatched'` ~932)
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-filter.dto.ts` (주석 한 줄)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts` (`'typeGroup: unmatched …'` 테스트)

**Interfaces:**
- Consumes: 없음(백로그 테이블 직접)
- Produces: `typeGroup: 'unmatched'` = `fulfillment_order_creation_backlogs.status = 'awaiting_matching'` 인 주문

- [ ] **Step 1: 테스트 바꾸기**

기존 `'typeGroup: unmatched 는 미매칭 라인이 있는 주문만'` 테스트를 통째로 교체:

```ts
  it('typeGroup: unmatched 는 매칭이 없어 FO 생성을 기다리는 주문만(라인 칸이 아니라 출고 대기열 기준)', async () => {
    await run(async (tx, svc, tag) => {
      const waiting = await insertOrder(tx, { channelOrderId: `${tag}-waiting` });
      await insertLine(tx, waiting);
      await tx
        .insert(wmsTables.fulfillmentOrderCreationBacklogs)
        .values({ salesOrderId: waiting, status: 'awaiting_matching', waitingVariantIds: [] });

      // 라인 product_matching_id 가 NULL 이어도 대기열이 끝났으면 «매칭안됨» 이 아니다 — 14번 행의 오탐
      const done = await insertOrder(tx, { channelOrderId: `${tag}-done` });
      await insertLine(tx, done, { productMatchingId: null });
      await tx
        .insert(wmsTables.fulfillmentOrderCreationBacklogs)
        .values({ salesOrderId: done, status: 'completed', waitingVariantIds: [] });

      const res = await listByKeyword(svc, tx, { keyword: tag, typeGroup: 'unmatched' });
      expect(res.data.map((d: { id: string }) => d.id)).toEqual([waiting]);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts -t "typeGroup: unmatched"`
Expected: FAIL — `done` 도 결과에 나온다

- [ ] **Step 3: 구현**

`case 'unmatched':` 블록을:

```ts
        case 'unmatched': // 매칭안됨: 매칭이 없어 FO 생성을 기다리는 주문. 대기열이 라인 구성 판정의 결과다(#1063 스펙 D8)
          conditions.push(
            exists(
              trx
                .select({ x: sql`1` })
                .from(S.fulfillmentOrderCreationBacklogs)
                .where(
                  and(
                    eq(S.fulfillmentOrderCreationBacklogs.salesOrderId, S.salesOrders.id),
                    eq(S.fulfillmentOrderCreationBacklogs.status, 'awaiting_matching'),
                  ),
                ),
            ),
          );
          break;
```

`sales-order-filter.dto.ts` 의 `'unmatched', // 매칭안됨 (미매칭 라인 존재)` 주석을 `// 매칭안됨 (매칭이 없어 FO 생성을 기다리는 주문)` 으로 바꾼다.

- [ ] **Step 4: 통과 확인**

Run: (Step 2 에서 `-t` 를 뺀 명령)
Expected: PASS (파일 전체)

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/sales-order
git commit -m "fix(core): 주문 목록 «매칭안됨» 필터를 매칭 대기 출고 대기열 기준으로 (#1016 14번, #1063)"
```

---

### Task 8: 옛 라인 칸 쓰기 멈추기

**Files:**
- Modify: `apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts` (`upsert` 의 라인 update ~429-431, `createSnapshotForVariant` ~495-588, `getMappingSnapshot` ~642-684)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`create` 의 `productMatchingId:` ~305, `confirm` ~405-460)
- Modify: `apps/core/src/modules/sales-order/dto/create-sales-order.dto.ts` (`productMatchingId?` ~41)
- Modify: `apps/admin-web/src/lib/types/dto/orders.ts` (~98)
- Test: 기존 `product-sku-mapping.service.spec.ts`, `sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `SalesOrdersService.confirm(id: string, tx?: DbTx)` — `warehouseId` 인자 삭제. `ProductSkuMappingService` 에서 `createSnapshotForVariant`·`getMappingSnapshot` 삭제

- [ ] **Step 1: 남은 사용처 확인**

Run: `grep -rn "createSnapshotForVariant\|getMappingSnapshot\|productMatchingId\b" apps/core/src apps/admin-web/src --include=*.ts --include=*.tsx | grep -v "\.spec\.\|schema.ts\|response.dto"`
Expected: `product-sku-mapping.service.ts`(upsert·두 메서드), `sales-orders.service.ts`(create·confirm), `create-sales-order.dto.ts`, admin-web `orders.ts`, 그리고 `product-variant-sku-links` 쪽(`productVariantSkuLinks.productMatchingId` — **이건 상품매칭 링크 칸이라 건드리지 않는다**). 이 밖의 자리가 나오면 멈추고 보고한다.

- [ ] **Step 2: 상품매칭 저장의 라인 일괄 덮어쓰기 삭제**

`upsert` 안의 블록을 지운다:

```ts
        await trx
          .update(wmsTables.salesOrderLines)
          .set({ productMatchingId: matchingId })
          .where(eq(wmsTables.salesOrderLines.variantId, variantId));
```

그 자리에 주석 한 줄:

```ts
        // 라인에는 쓰지 않는다 — 라인 구성은 FO 생성이 굳히고(#1063), 이미 굳힌 라인을 바꾸는 건 «기존 출고에도 적용»(PR 2)이다
```

- [ ] **Step 3: 스냅샷 메서드 둘 삭제**

`createSnapshotForVariant`·`getMappingSnapshot` 메서드 전체를 지운다. 이 둘만 쓰던 import(`desc` 등)가 남으면 지운다(type-check·lint 로 확인). `getActiveMapping` 은 다른 사용처를 Step 1 처럼 grep 해서 0 이면 지우지 않고 남긴다 — 옛 «창고별 SKU 매핑» 정리는 이 PR 범위 밖(스펙 §11).

- [ ] **Step 4: `confirm` 의 스냅샷 블록 삭제**

`confirm(id: string, warehouseId?: string, tx?: DbTx)` 를 `confirm(id: string, tx?: DbTx)` 로 바꾸고, `if (warehouseId && lines.length > 0) { … }` 블록 전체와, 그 블록만 쓰던 `const lines = await trx.select()…` 조회를 지운다(조회 결과를 아래에서 또 쓰면 남긴다). 호출부 `sales-orders.controller.ts:57` 은 `this.service.confirm(id)` 그대로다. `grep -rn "\.confirm(" apps/core/src --include=*.ts` 로 세 번째 인자를 넘기던 곳이 없는지 확인한다.

- [ ] **Step 5: 주문 생성의 `productMatchingId` 쓰기 삭제**

`create` 의 라인 values 에서 `productMatchingId: l.productMatchingId ?? null,` 줄을 지운다. `create-sales-order.dto.ts` 의 `productMatchingId?: string;` 필드와 그 데코레이터를 지운다. admin-web `lib/types/dto/orders.ts` 의 `productMatchingId?: string;` 줄을 지운다.

- [ ] **Step 6: 테스트·타입 확인**

Run: `npx jest apps/core/src/modules/product-matching apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts`
Expected: PASS. 실패하면 그 테스트가 라인 `productMatchingId` 덮어쓰기나 스냅샷을 단언하던 것이다 — 그 단언을 지우고(동작이 사라졌다) 커밋 메시지에 남긴다.

Run: `npm run type-check && (cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0

- [ ] **Step 7: Commit**

```bash
git add apps/core/src apps/admin-web/src/lib/types/dto/orders.ts
git commit -m "refactor(core): 옛 라인 매칭 칸 쓰기 중단 — 상품매칭 저장의 라인 덮어쓰기·확정 스냅샷 삭제 (#1063)"
```

---

### Task 9: 백필 — FO 가 있는 옛 라인을 굳힌다

**Files:**
- Create: `scripts/ops/1016-14-line-composition-backfill.ts` (순수 역산)
- Test: `scripts/ops/1016-14-line-composition-backfill.spec.ts`
- Create: `scripts/ops/1016-14-backfill-line-compositions.ts` (실행)

**Interfaces:**
- Consumes: `sumCancelledByLine` (Task 2)
- Produces:
  ```ts
  export interface BackfillLine { lineId: string; quantity: number; cancelledQty: number; foItems: Array<{ skuId: string; qty: number }> }
  export type BackfillDecision =
    | { kind: 'ok'; lineId: string; items: Array<{ skuId: string; qtyPerUnit: number }> }
    | { kind: 'ambiguous'; lineId: string; candidates: number[] }
    | { kind: 'indivisible'; lineId: string };
  export function deriveComposition(line: BackfillLine): BackfillDecision
  ```

- [ ] **Step 1: 역산 스펙 쓰기**

`1016-14-line-composition-backfill.spec.ts`:

```ts
import { deriveComposition } from './1016-14-line-composition-backfill';

describe('deriveComposition', () => {
  it('부분 취소가 없으면 주문 수량으로 나눈다', () => {
    expect(deriveComposition({ lineId: 'l', quantity: 2, cancelledQty: 0, foItems: [{ skuId: 'a', qty: 6 }] })).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [{ skuId: 'a', qtyPerUnit: 3 }],
    });
  });

  it('FO 생성 전 부분 취소였으면 유효 수량으로만 나눠떨어진다', () => {
    // 주문 3, 취소 1 → FO 는 유효 2 × 1개당 1 = 2
    expect(deriveComposition({ lineId: 'l', quantity: 3, cancelledQty: 1, foItems: [{ skuId: 'a', qty: 2 }] })).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [{ skuId: 'a', qtyPerUnit: 1 }],
    });
  });

  it('두 후보가 모두 나눠떨어지고 답이 다르면 ambiguous', () => {
    // 주문 4, 취소 2, FO 4: 4÷4=1(FO 뒤 취소) 또는 4÷2=2(FO 전 취소)
    expect(deriveComposition({ lineId: 'l', quantity: 4, cancelledQty: 2, foItems: [{ skuId: 'a', qty: 4 }] })).toEqual({
      kind: 'ambiguous',
      lineId: 'l',
      candidates: [4, 2],
    });
  });

  it('어느 후보로도 나눠떨어지지 않으면 indivisible', () => {
    expect(deriveComposition({ lineId: 'l', quantity: 2, cancelledQty: 0, foItems: [{ skuId: 'a', qty: 3 }] })).toEqual({
      kind: 'indivisible',
      lineId: 'l',
    });
  });

  it('여러 SKU 는 모두 같은 후보로 나눠떨어져야 한다', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 0,
        foItems: [
          { skuId: 'b', qty: 2 },
          { skuId: 'a', qty: 4 },
        ],
      }),
    ).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [
        { skuId: 'a', qtyPerUnit: 2 },
        { skuId: 'b', qtyPerUnit: 1 },
      ],
    });
  });

  it('유효 수량 0 이하 후보는 쓰지 않는다', () => {
    expect(deriveComposition({ lineId: 'l', quantity: 1, cancelledQty: 1, foItems: [{ skuId: 'a', qty: 1 }] })).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [{ skuId: 'a', qtyPerUnit: 1 }],
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest scripts/ops/1016-14-line-composition-backfill.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 역산 구현**

`1016-14-line-composition-backfill.ts`:

```ts
/**
 * #1063 백필의 역산(스펙 §9.1). FO 항목 수량 = FO 생성 당시 유효 수량 × 1개당 수량 이었다. 그런데 FO 생성 «전» 부분 취소가
 * 있었는지는 기록으로 구분되지 않는다 — 그래서 «주문 수량»과 «주문 수량 − 부분 취소 합» 두 후보를 다 대 보고,
 * 하나만 맞으면 쓰고, 둘 다 맞는데 답이 다르면 사람에게 넘긴다.
 */
export interface BackfillLine {
  lineId: string;
  quantity: number;
  cancelledQty: number;
  foItems: Array<{ skuId: string; qty: number }>;
}

export type BackfillDecision =
  | { kind: 'ok'; lineId: string; items: Array<{ skuId: string; qtyPerUnit: number }> }
  | { kind: 'ambiguous'; lineId: string; candidates: number[] }
  | { kind: 'indivisible'; lineId: string };

function divide(foItems: BackfillLine['foItems'], units: number): Array<{ skuId: string; qtyPerUnit: number }> | null {
  if (units <= 0) return null;
  if (foItems.some((item) => item.qty % units !== 0 || item.qty <= 0)) return null;
  return foItems
    .map((item) => ({ skuId: item.skuId, qtyPerUnit: item.qty / units }))
    .sort((a, b) => a.skuId.localeCompare(b.skuId));
}

export function deriveComposition(line: BackfillLine): BackfillDecision {
  const candidates = [...new Set([line.quantity, line.quantity - line.cancelledQty])].filter((u) => u > 0);
  const fits = candidates
    .map((units) => ({ units, items: divide(line.foItems, units) }))
    .filter((c): c is { units: number; items: Array<{ skuId: string; qtyPerUnit: number }> } => c.items !== null);
  if (fits.length === 0) return { kind: 'indivisible', lineId: line.lineId };
  if (fits.length > 1) return { kind: 'ambiguous', lineId: line.lineId, candidates: fits.map((f) => f.units) };
  return { kind: 'ok', lineId: line.lineId, items: fits[0].items };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest scripts/ops/1016-14-line-composition-backfill.spec.ts`
Expected: PASS

- [ ] **Step 5: 실행 스크립트**

`1016-14-backfill-line-compositions.ts`:

```ts
/**
 * #1063 백필(스펙 §9.1) — PR 1 배포(`migrate → deploy`) **뒤 한 번**.
 *
 * FO 항목이 있는데 구성 출처가 NULL 인 라인을 FO 항목에서 역산해 `matching` 으로 굳힌다. 이게 끝나야 PR 2 의 주문별 수정이
 * 그 라인을 `COMPOSITION_NOT_FROZEN` 으로 거절하지 않는다. 출고에는 영향이 없다(FO 는 이미 만들어졌다).
 * 역산이 안 되는 라인(ambiguous·indivisible)은 쓰지 않고 목록만 찍는다 — 사람이 판단한다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-14-backfill-line-compositions.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-14-backfill-line-compositions.ts --apply  # 실제 굳히기
 */
import postgres from 'postgres';
import { Resource } from 'sst';
import { sumCancelledByLine } from '../../apps/core/src/modules/product-matching/line-composition/partial-cancellation';
import { BackfillLine, deriveComposition } from './1016-14-line-composition-backfill';

const APPLY = process.argv.includes('--apply');

type FoItemRow = { lineId: string; salesOrderId: string; quantity: number; skuId: string; qty: number };
type CancellationRow = { salesOrderId: string; metadata: unknown };

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 기존 ops 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const sql = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'core',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    // fulfillment_order_items.sales_order_line_id 는 varchar 라 uuid 를 text 로 맞춘다
    const rows = await sql<FoItemRow[]>`
      SELECT l.id AS "lineId", l.sales_order_id AS "salesOrderId", l.quantity,
             foi.sku_id AS "skuId", SUM(foi.qty)::int AS qty
      FROM sales_order_lines l
      JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text
      WHERE l.composition_source IS NULL
      GROUP BY l.id, l.sales_order_id, l.quantity, foi.sku_id
      ORDER BY l.id`;
    const orderIds = [...new Set(rows.map((r) => r.salesOrderId))];
    const cancellations =
      orderIds.length === 0
        ? []
        : await sql<CancellationRow[]>`
            SELECT sales_order_id AS "salesOrderId", metadata
            FROM sales_order_cancellations WHERE sales_order_id = ANY(${orderIds}::uuid[])`;
    const cancelledByLine = sumCancelledByLine(cancellations.map((c) => c.metadata));

    const lines = new Map<string, BackfillLine>();
    for (const row of rows) {
      const line = lines.get(row.lineId) ?? {
        lineId: row.lineId,
        quantity: row.quantity,
        cancelledQty: cancelledByLine.get(row.lineId) ?? 0,
        foItems: [],
      };
      line.foItems.push({ skuId: row.skuId, qty: row.qty });
      lines.set(row.lineId, line);
    }

    const decisions = [...lines.values()].map(deriveComposition);
    const ok = decisions.filter((d) => d.kind === 'ok');
    const rest = decisions.filter((d) => d.kind !== 'ok');
    console.log(`대상 라인 ${decisions.length} · 역산 가능 ${ok.length} · 사람 판단 ${rest.length}`);
    for (const d of rest) console.log(`  ${d.kind}\t${d.lineId}${d.kind === 'ambiguous' ? `\t후보 ${d.candidates.join('/')}` : ''}`);

    if (!APPLY) return;

    let written = 0;
    for (const d of ok) {
      if (d.kind !== 'ok') continue;
      await sql.begin(async (tx) => {
        // 출처 NULL 조건 — 그새 FO 생성·운영자가 굳혔으면 건드리지 않는다
        const claimed = await tx`
          UPDATE sales_order_lines
          SET composition_source = 'matching', composition_set_at = now(), updated_at = now()
          WHERE id = ${d.lineId} AND composition_source IS NULL
          RETURNING id`;
        if (claimed.length === 0) return;
        for (const item of d.items) {
          await tx`
            INSERT INTO sales_order_line_compositions (sales_order_line_id, sku_id, qty_per_unit)
            VALUES (${d.lineId}, ${item.skuId}, ${item.qtyPerUnit})`;
        }
        written += 1;
      });
    }
    console.log(`\n굳힘 ${written} / ${ok.length}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 6: 로컬 스크래치 DB 로 한 번 돌려 보기**

`Resource` 대신 로컬에서 돌리려면 스크립트를 바꾸지 말고, 같은 SELECT 를 스크래치 DB 에 직접 실행해 문법만 확인한다:

```bash
docker exec almondyoung-server-postgres-1 psql -U postgres -d core_1063 -c "SELECT l.id, l.quantity, foi.sku_id, SUM(foi.qty)::int FROM sales_order_lines l JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text WHERE l.composition_source IS NULL GROUP BY l.id, l.quantity, foi.sku_id LIMIT 5"
```

Expected: 에러 없이 0행 이상

Run: `npm run type-check` — 루트 tsconfig 가 `scripts/` 를 검사 범위에 넣는다
Expected: 에러 0

- [ ] **Step 7: Commit**

```bash
git add scripts/ops/1016-14-*
git commit -m "chore(ops): 라인 구성 백필 — FO 항목에서 역산, 모호하면 사람에게 (#1063)"
```

---

### Task 10: 최종 게이트와 PR

**Files:** 없음(검증·PR 본문)

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest
(cd apps/admin-web && npx tsc --noEmit)
npm run test:admin-web
```

Expected: type-check 0 · jest 실패 0 · admin tsc 0 · admin jest 실패 0. jest 가 메모리 부족으로 죽으면 `npx jest --maxWorkers=2`.

- [ ] **Step 2: 이 PR 이 건드린 통합 스펙 전부**

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_1063 npx jest --runInBand \
  apps/core/src/modules/product-matching \
  apps/core/src/modules/fulfillment/services/fulfillments.line-composition.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile \
  apps/core/src/modules/sales-order/services/sales-orders.list.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/shipment-planning.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/shipment-reservation.integration.spec.ts
```

Expected: 새 실패 0(develop base-red 와 대조)

- [ ] **Step 3: 라이브 확인 SQL 을 PR 본문에**

PR 본문 «배포 전 라이브 확인»에 넣을 SQL(읽기 전용, `sst shell` 로 `core` DB):

```sql
-- 백필 대상 라인 수
SELECT count(DISTINCT l.id) FROM sales_order_lines l
JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text;
-- 옛 칸을 아직 읽는 코드가 없는지는 SQL 이 아니라 grep:
--   grep -rn "productMatchingId\|mappingSnapshotId" apps/core/src apps/admin-web/src --include=*.ts --include=*.tsx | grep -v "spec\|schema.ts\|response.dto\|productVariantSkuLinks"
```

백필 «사람 판단» 건수는 배포 뒤 dry-run 이 낸다(이슈 #1063 운영 작업 체크박스).

- [ ] **Step 4: push·PR**

```bash
git push -u origin feat/1063-line-composition-pr1
gh pr create --base develop --title "feat(core): 판매주문 라인 구성 PR 1 — 판정·굳히기·백필 (#1063)" --body-file <scratchpad>/pr-1063-1-body.md
```

PR 본문: 요약(스펙 경로·이슈 #1063·#1016 14번), 배포 순서 **`migrate → deploy` → 백필 dry-run → `--apply`**, 마이그레이션 1건(additive), 이 PR 로 바뀌는 화면 둘(매칭체크 «매칭된 것 제외»·주문 목록 «매칭안됨» 필터와 라인 배지), 알고 남기는 것(백필 전 FO 라인은 PR 2 수정 API 가 거절 — PR 2 미배포라 지금은 영향 없음), 라이브 확인 SQL, 게이트 결과. 끝에 세션 링크 줄.
