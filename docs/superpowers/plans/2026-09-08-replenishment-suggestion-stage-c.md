# 재고 보충 제안 재설계 — C 단계 (#743 본체) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재주문 제안을 상수 판정에서 **전사 축(발주) · 판매 창고 축(이동)** 두 판정으로 바꾸고, 공급 파이프라인 ①②③을 반영하며, 같은 질문에 답하던 옛 API 둘을 지운다. 안전재고 입력은 이 단계에서는 `skus.safety_stock` 정적값이다 — 통계 층(A+B)이 다음 단계에서 교체한다.

**Architecture:** 새 모듈 `inventory/replenishment/` (procurement · warehouse-transfer 의 형제). `ReplenishmentStockReader` 가 원장·예약을 집합 질의로 집계하고, `StockProjectionService.getInboundPipeline` 이 ①②③(+ 전 창고 발주잔량)을, `WarehouseTransferReader` 가 draft 지시서 수량을 준다. 순수 함수 `assembleSuggestions` 가 두 축을 판정해 SKU 당 한 행을 만든다. 컨트롤러 → 서비스(2줄) → 리더/조립. admin-web 은 `/inventory/replenishment` 페이지를 새로 만들고 카트 드로어의 "재발주 추천" 탭을 지운다.

**Tech Stack:** NestJS 11 + drizzle-orm(`postgres.js`) · Jest(루트 `npx jest`, 통합은 `describeIfDb`) · Next.js admin-web(TanStack Query, shadcn ui, sonner)

**Spec:** `docs/superpowers/specs/2026-09-08-replenishment-suggestion-design.md` — 결정 D1~D9 · §7(두 축) · §8.2(모듈) · §9(C 단계 자리표시 규칙). 이 플랜은 §9 의 **C 행**만 구현한다. 마이그레이션 0.

## Global Constraints

- 브랜치 `feat/743-replenishment-stage-c` (develop 에서 분기). 모든 태스크는 이 브랜치에 커밋한다.
- 커밋 메시지는 한국어, 본문 마지막 줄에 `Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED`.
- **마이그레이션 0건.** `inventory.schema.ts` 를 수정하지 않는다.
- 레이어 규칙(CLAUDE.md): Controller 는 try/catch 로 상태코드를 매핑하지 않는다. Service 는 2~3줄 위임. DB 접근은 Reader. 도메인 예외는 `@app/shared` 의 `NotFoundError` 등.
- Inventory 질의 규칙: `db.query.*` · `with` 관계 · `any` · `as` 캐스트 금지. `trx.select().from().where()` 와 drizzle 연산자만. DB 주입은 `@InjectTypedDb<typeof wmsSchema>()` + `DbService<typeof wmsSchema>`, 트랜잭션은 `this.dbService.run(fn, tx)`. 공개 메서드는 `tx?: DbTx` 를 마지막 인자로.
- 중첩 DTO 는 전부 별도 클래스. `@ApiProperty({ type: 'object' })` 금지.
- `procurement/` 와 `replenishment/` 는 서로 import 하지 않는다 (Task 9 의 아키텍처 스펙이 고정). `replenishment/` 는 `warehouse-transfer/` 의 **Reader** 만 빌린다.
- 순수 층(`policy/rounding.ts` · `suggestion/suggestion.assembler.ts`)은 `@nestjs/*` · `drizzle-orm` 을 import 하지 않는다.
- C 단계 자리표시 규칙(스펙 §9): 두 축 모두 `safetyStock = reorderPoint = targetLevel = skus.safety_stock`, 발주량 = `roundUp(max(SS − IP_전사, 0))`, 행마다 `legacy_only` 플래그, `demand = { dailyMean: 0, dailyStd: 0 }`, `daysOfCover = null`, 정렬은 `sellable.position − sellable.reorderPoint` 오름차순.
- 검증 게이트: `npm run type-check` 에러 0 · `npx jest --maxWorkers=2` 실패 0 · `cd apps/admin-web && npx tsc --noEmit` 에러 0. 통합 스펙은 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <파일명>` (워크트리에서 `COMPOSE_PROJECT_NAME` 을 빼면 5432 충돌). 스펙 안에서 `dotenv.config()` 를 부르지 않는다.
- admin-web 은 컴포넌트 테스트가 없다. 판정·정렬·표시 변환은 `.ts` 순수 함수로 빼서 `npm run test:admin-web` 으로 검증한다.
- `any`/`as` 캐스트는 스펙 파일의 mock 주입에만 쓴다(기존 관례). 프로덕션 코드엔 넣지 않는다.

---

## File Structure

| 경로 | 책임 | 태스크 |
|---|---|---|
| `apps/core/src/modules/inventory/replenishment/policy/rounding.ts` (신설) | `roundUpToLot` — MOQ · 상자 단위 올림 (순수) | 1 |
| `.../replenishment/policy/rounding.spec.ts` (신설) | 위 스펙 | 1 |
| `.../replenishment/suggestion/suggestion.types.ts` (신설) | 조립 입력·출력 인터페이스 (순수, DTO 아님) | 2 |
| `.../replenishment/suggestion/suggestion.assembler.ts` (신설) | `assembleSuggestions` — 두 축 판정 (순수) | 2 |
| `.../replenishment/suggestion/suggestion.assembler.spec.ts` (신설) | 두 축 4조합 · draft 차감 · 올림 · 정렬 · 플래그 | 2 |
| `.../stock-projection/services/inbound-pipeline.reader.ts` (수정) | `onOrderTotalQty` 항목 추가 | 3 |
| `.../stock-projection/dto/inbound-pipeline.dto.ts` (수정) | 같은 항목 DTO | 3 |
| `.../stock-projection/services/inbound-pipeline.integration.spec.ts` (수정) | 전 창고 합 검증 1건 | 3 |
| `.../warehouse-transfer/services/warehouse-transfer.reader.ts` (수정) | `findDraftPlannedBySku` | 4 |
| `.../warehouse-transfer/services/warehouse-transfer.reader.integration.spec.ts` (신설) | draft 만 세는지 | 4 |
| `.../replenishment/suggestion/replenishment-stock.reader.ts` (신설) | 원장 · 예약 · SKU 마스터 집계 | 5 |
| `.../replenishment/suggestion/replenishment-stock.reader.integration.spec.ts` (신설) | 상태·판매창고별 합, 확정 예약만 | 5 |
| `.../replenishment/dto/replenishment-suggestion.dto.ts` (신설) | 응답 DTO 클래스들 | 6 |
| `.../replenishment/suggestion/replenishment-suggestion.service.ts` (신설) | 재료 수집 → 조립 → DTO | 6 |
| `.../replenishment/suggestion/replenishment-suggestion.integration.spec.ts` (신설) | end-to-end 3장면 | 6 |
| `.../replenishment/controllers/replenishment-suggestion.controller.ts` (신설) | `GET /replenishment/suggestions` · `GET /replenishment/skus/:skuId` | 7 |
| `.../replenishment/replenishment.module.ts` (신설) · `.../inventory/inventory.module.ts` (수정) | 모듈 등록 | 7 |
| `.../procurement/services/reorder-suggestion.reader.ts` (삭제) · `.../procurement/controllers/purchase-order.controller.ts` · `.../procurement/dto/purchase-order.dto.ts` · `.../procurement/procurement.module.ts` · `.../procurement/services/purchase-order.service.ts` (수정) | 옛 재주문 제안 제거 | 8 |
| `.../core/services/safety-stock.service.ts` (삭제) · `.../core/controllers/inventory.controller.ts` · `.../core/inventory.module.ts` (수정) | 옛 안전재고 API 제거 | 8 |
| `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts` (신설) | import 경계 고정 | 9 |
| `apps/admin-web/src/lib/types/dto/inventory.ts` (수정) | 응답 타입 교체 | 10 |
| `apps/admin-web/src/lib/api/domains/inventory/replenishment.client.ts` (신설) · `warehouse-transfers.client.ts` (신설) · `purchase-orders.client.ts` (수정) | API 클라이언트 | 10 |
| `apps/admin-web/src/lib/services/inventory/query-keys.ts` · `queries.ts` · `mutations.ts` (수정) | 훅 | 10 |
| `apps/admin-web/src/features/inventory/replenishment/suggestion-model.ts` (신설) · `.spec.ts` (신설) | 표시 변환 · 카트/이동 페이로드 (순수) | 11 |
| `apps/admin-web/src/features/inventory/replenishment/components/table/index.tsx` · `components/sku-drawer/index.tsx` · `template/index.tsx` (신설) · `apps/admin-web/src/app/(admin)/inventory/replenishment/page.tsx` (신설) · `apps/admin-web/src/lib/utils/menu.ts` · `menu.spec.ts` (수정) | 페이지 | 12 |
| `apps/admin-web/src/features/inventory/purchase-orders/components/cart-drawer/index.tsx` (수정) | 재발주 추천 탭 제거 | 13 |

---

### Task 0: 브랜치

- [ ] **Step 1: develop 에서 분기**

```bash
git checkout develop && git pull --ff-only
git checkout -b feat/743-replenishment-stage-c
```

---

### Task 1: `roundUpToLot` (순수)

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/policy/rounding.ts`
- Test: `apps/core/src/modules/inventory/replenishment/policy/rounding.spec.ts`

**Interfaces:**
- Produces: `roundUpToLot(qty: number, lot: { moq: number | null; packingUnit: number | null }): number`

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/policy/rounding.spec.ts
import { roundUpToLot } from './rounding';

describe('roundUpToLot', () => {
  it('0 이하는 0 — 부족하지 않으면 사지 않는다', () => {
    expect(roundUpToLot(0, { moq: 10, packingUnit: 6 })).toBe(0);
    expect(roundUpToLot(-3, { moq: 10, packingUnit: 6 })).toBe(0);
  });

  it('둘 다 없으면 정수 올림', () => {
    expect(roundUpToLot(7.2, { moq: null, packingUnit: null })).toBe(8);
  });

  it('MOQ 미만이면 MOQ 로 올린다', () => {
    expect(roundUpToLot(3, { moq: 10, packingUnit: null })).toBe(10);
    expect(roundUpToLot(12, { moq: 10, packingUnit: null })).toBe(12);
  });

  it('상자 단위 배수로 올린다', () => {
    expect(roundUpToLot(7, { moq: null, packingUnit: 6 })).toBe(12);
    expect(roundUpToLot(12, { moq: null, packingUnit: 6 })).toBe(12);
  });

  it('MOQ 를 먼저 적용하고 그 결과를 상자 배수로 올린다', () => {
    // 3 → MOQ 10 → 상자 6 배수 → 12
    expect(roundUpToLot(3, { moq: 10, packingUnit: 6 })).toBe(12);
  });

  it('0 이나 음수 lot 값은 없는 것으로 본다', () => {
    expect(roundUpToLot(7, { moq: 0, packingUnit: -1 })).toBe(7);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/rounding.spec.ts`
Expected: FAIL — `Cannot find module './rounding'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/policy/rounding.ts
/**
 * 발주량 올림. 스펙 §5.3 — MOQ 이상으로 올린 뒤 상자(packing_unit) 배수로 다시 올린다.
 * 순수 함수: Nest · drizzle 을 모른다.
 */
export interface LotConstraint {
  moq: number | null;
  packingUnit: number | null;
}

export function roundUpToLot(qty: number, lot: LotConstraint): number {
  if (!(qty > 0)) return 0;
  let result = Math.ceil(qty);
  const moq = lot.moq !== null && lot.moq > 0 ? lot.moq : null;
  const unit = lot.packingUnit !== null && lot.packingUnit > 0 ? lot.packingUnit : null;
  if (moq !== null && result < moq) result = moq;
  if (unit !== null) result = Math.ceil(result / unit) * unit;
  return result;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/policy/rounding.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/policy/
git commit -m "feat(replenishment): 발주량 올림 순수 함수 roundUpToLot (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 2: `assembleSuggestions` (순수) — 두 축 판정

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/suggestion/suggestion.types.ts`
- Create: `apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.ts`
- Test: `apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts`

**Interfaces:**
- Consumes: `roundUpToLot` (Task 1)
- Produces (Task 6 이 그대로 쓴다):

```ts
export type SuggestionFlag = 'default_lead_time' | 'supplier_unknown' | 'low_confidence' | 'legacy_only';

export interface SkuStockInput {
  skuId: string;
  skuCode: string;
  skuName: string;
  supplier: { id: string; name: string } | null;
  /** C 단계: skus.safety_stock. A+B 가 계산값으로 교체 */
  safetyStock: number;
  lot: { moq: number | null; packingUnit: number | null };
  excluded: boolean;
  /** 전 창고 ON_HAND 합 (판매·비판매 모두) */
  onHandTotal: number;
  /** 전 창고 IN_TRANSFER 합 */
  inTransferTotal: number;
  /** 전 창고 확정 예약 합 */
  reservedTotal: number;
  /** 판매 창고 ON_HAND */
  onHandSellable: number;
  /** 판매 창고 확정 예약 */
  reservedSellable: number;
  /** 비판매 창고 ON_HAND 를 (창고, 로케이션) 별로 — 이동 라인 재료 */
  nonSellableOnHand: Array<{ warehouseId: string; locationId: string; qty: number }>;
  /** 파이프라인: 전 창고 발주잔량 / 비판매 창고행 발주잔량 / 판매창고로 이동중 */
  onOrderTotal: number;
  onOrderNonSellable: number;
  inTransitToSellable: number;
  /** draft 이동 지시서에 이미 실린 planned 합 */
  draftTransferPlanned: number;
}

export interface AssembleContext {
  sellableWarehouseId: string;
}

export interface AxisView {
  onHand: number; reserved: number; position: number;
  safetyStock: number; reorderPoint: number; targetLevel: number; leadTimeDays: number;
}
export interface CompanyAxis extends AxisView { inTransfer: number; onOrder: number }
export interface SellableAxis extends AxisView {
  warehouseId: string; inTransit: number; onOrderDirect: number; daysOfCover: number | null;
}
export type SuggestionAction =
  | { type: 'purchase'; qty: number; supplierId: string | null; sourceWarehouseId: string | null }
  | { type: 'transfer'; qty: number; fromWarehouseId: string; toWarehouseId: string;
      lines: Array<{ fromLocationId: string; quantity: number }> };

export interface SuggestionRow {
  skuId: string; skuCode: string; skuName: string;
  supplier: { id: string; name: string } | null;
  pattern: 'insufficient'; grade: 'C'; confidence: 'low';
  demand: { dailyMean: number; dailyStd: number };
  company: CompanyAxis; sellable: SellableAxis;
  actions: SuggestionAction[]; flags: SuggestionFlag[];
  legacyReorderPoint: number;
}

export function assembleSuggestions(inputs: SkuStockInput[], ctx: AssembleContext): SuggestionRow[];
```

C 단계엔 수요 프로필이 없으므로 `pattern`·`grade`·`confidence` 는 리터럴 상수로 고정한다(A+B 가 넓힌다). `sourceWarehouseId` 는 C 단계에서 항상 `null` 이다 — 공급사의 출발 창고는 A+B 의 규칙 층이 정한다.

- [ ] **Step 1: 타입 파일 작성**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/suggestion.types.ts
// (위 Interfaces 블록의 export 들을 그대로 옮긴다 — assembleSuggestions 선언은 제외)
```

- [ ] **Step 2: 실패하는 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts
import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput } from './suggestion.types';

const SELL = 'wh-sell';
const CHINA = 'wh-china';
const LOC_A = 'loc-a';
const LOC_B = 'loc-b';

function sku(overrides: Partial<SkuStockInput> = {}): SkuStockInput {
  return {
    skuId: 'sku-1',
    skuCode: 'S1',
    skuName: 'sku one',
    supplier: { id: 'sup-1', name: 'supplier' },
    safetyStock: 100,
    lot: { moq: null, packingUnit: null },
    excluded: false,
    onHandTotal: 0,
    inTransferTotal: 0,
    reservedTotal: 0,
    onHandSellable: 0,
    reservedSellable: 0,
    nonSellableOnHand: [],
    onOrderTotal: 0,
    onOrderNonSellable: 0,
    inTransitToSellable: 0,
    draftTransferPlanned: 0,
    ...overrides,
  };
}

const ctx = { sellableWarehouseId: SELL };

describe('assembleSuggestions — 두 축 독립', () => {
  it('부천 부족 · 중국 有 → 이동만', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 20, onHandTotal: 220, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 200 }] })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 80, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 80 }] },
    ]);
    expect(row.company.position).toBe(220);
    expect(row.sellable.position).toBe(20);
  });

  it('부천 부족 · 중국 부족 → 이동(있는 만큼) + 발주(전사 부족분)', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 20, onHandTotal: 50, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 30 }] })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'purchase', qty: 50, supplierId: 'sup-1', sourceWarehouseId: null },
      { type: 'transfer', qty: 30, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 30 }] },
    ]);
  });

  it('부천 충분 · 전사 부족(예약이 크다) → 발주만', () => {
    // 전사 IP = 120 − 예약 50 = 70 < 100. 판매 IP = 120 − 50 = 70 < 100 이지만 중국이 0 → 이동 없음.
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 120, onHandTotal: 120, reservedSellable: 50, reservedTotal: 50 })],
      ctx,
    );
    expect(row.actions).toEqual([{ type: 'purchase', qty: 30, supplierId: 'sup-1', sourceWarehouseId: null }]);
  });

  it('둘 다 충분 → 행은 있되 actions 빈 배열', () => {
    const [row] = assembleSuggestions([sku({ onHandSellable: 150, onHandTotal: 150 })], ctx);
    expect(row.actions).toEqual([]);
  });
});

describe('assembleSuggestions — 재고 위치 재료', () => {
  it('전사 IP 는 ON_HAND + IN_TRANSFER + 발주잔량(전 창고) − 확정예약', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandTotal: 10, inTransferTotal: 20, onOrderTotal: 30, reservedTotal: 5 })],
      ctx,
    );
    expect(row.company).toMatchObject({ onHand: 10, inTransfer: 20, onOrder: 30, reserved: 5, position: 55 });
  });

  it('판매 IP 는 판매창고 ON_HAND − 예약 + 이동중 + 판매창고행 발주잔량', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 10, reservedSellable: 4, inTransitToSellable: 20, onOrderTotal: 30, onOrderNonSellable: 25 })],
      ctx,
    );
    expect(row.sellable).toMatchObject({ onHand: 10, reserved: 4, inTransit: 20, onOrderDirect: 5, position: 31 });
  });

  it('발주잔량이 전사 부족을 덮으면 발주 제안 없음', () => {
    const [row] = assembleSuggestions([sku({ onHandTotal: 10, onOrderTotal: 100 })], ctx);
    expect(row.actions.some((a) => a.type === 'purchase')).toBe(false);
  });
});

describe('assembleSuggestions — 이동 제안 세부', () => {
  it('draft 지시서에 실린 수량은 이동가능에서 뺀다', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 0, onHandTotal: 200, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 200 }], draftTransferPlanned: 150 })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 50, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 50 }] },
    ]);
  });

  it('로케이션이 여럿이면 큰 곳부터 채운다', () => {
    const [row] = assembleSuggestions(
      [
        sku({
          onHandSellable: 0,
          onHandTotal: 90,
          nonSellableOnHand: [
            { warehouseId: CHINA, locationId: LOC_B, qty: 30 },
            { warehouseId: CHINA, locationId: LOC_A, qty: 60 },
          ],
        }),
      ],
      ctx,
    );
    expect(row.actions).toEqual([
      {
        type: 'transfer',
        qty: 90,
        fromWarehouseId: CHINA,
        toWarehouseId: SELL,
        lines: [
          { fromLocationId: LOC_A, quantity: 60 },
          { fromLocationId: LOC_B, quantity: 30 },
        ],
      },
    ]);
  });

  it('이동량은 올리지 않는다 — 있는 만큼만', () => {
    const [row] = assembleSuggestions(
      [sku({ lot: { moq: 50, packingUnit: 12 }, onHandSellable: 0, onHandTotal: 7, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 7 }] })],
      ctx,
    );
    const transfer = row.actions.find((a) => a.type === 'transfer');
    expect(transfer).toMatchObject({ qty: 7 });
  });
});

describe('assembleSuggestions — 발주량 · 예외 · 플래그 · 정렬', () => {
  it('발주량은 MOQ · 상자 단위로 올린다', () => {
    const [row] = assembleSuggestions([sku({ lot: { moq: 50, packingUnit: 12 }, onHandTotal: 90 })], ctx);
    // 부족 10 → MOQ 50 → 상자 12 배수 → 60
    expect(row.actions).toEqual([{ type: 'purchase', qty: 60, supplierId: 'sup-1', sourceWarehouseId: null }]);
  });

  it('excluded 인 SKU 는 결과에서 빠진다', () => {
    expect(assembleSuggestions([sku({ excluded: true })], ctx)).toEqual([]);
  });

  it('공급사 미정이면 supplier_unknown 플래그, supplierId null', () => {
    const [row] = assembleSuggestions([sku({ supplier: null })], ctx);
    expect(row.flags).toEqual(expect.arrayContaining(['supplier_unknown', 'legacy_only']));
    expect(row.actions).toEqual([{ type: 'purchase', qty: 100, supplierId: null, sourceWarehouseId: null }]);
  });

  it('C 단계 자리표시: legacy_only · demand 0 · daysOfCover null · 세 수준이 같다', () => {
    const [row] = assembleSuggestions([sku()], ctx);
    expect(row.flags).toContain('legacy_only');
    expect(row.demand).toEqual({ dailyMean: 0, dailyStd: 0 });
    expect(row.sellable.daysOfCover).toBeNull();
    expect(row.company).toMatchObject({ safetyStock: 100, reorderPoint: 100, targetLevel: 100, leadTimeDays: 0 });
    expect(row.sellable).toMatchObject({ safetyStock: 100, reorderPoint: 100, targetLevel: 100, leadTimeDays: 0 });
    expect(row.legacyReorderPoint).toBe(100);
    expect(row.pattern).toBe('insufficient');
    expect(row.grade).toBe('C');
    expect(row.confidence).toBe('low');
  });

  it('판매창고 (위치 − 재주문점) 오름차순 — 가장 급한 것이 먼저', () => {
    const rows = assembleSuggestions(
      [
        sku({ skuId: 'a', onHandSellable: 80, onHandTotal: 80 }),
        sku({ skuId: 'b', onHandSellable: 10, onHandTotal: 10 }),
        sku({ skuId: 'c', onHandSellable: 40, onHandTotal: 40 }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.skuId)).toEqual(['b', 'c', 'a']);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts`
Expected: FAIL — `Cannot find module './suggestion.assembler'`

- [ ] **Step 4: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.ts
import { roundUpToLot } from '../policy/rounding';
import {
  AssembleContext,
  CompanyAxis,
  SellableAxis,
  SkuStockInput,
  SuggestionAction,
  SuggestionFlag,
  SuggestionRow,
} from './suggestion.types';

/**
 * 두 축 판정 (스펙 §7.2). 순수 함수 — Nest · drizzle 을 모른다.
 *
 * C 단계 자리표시 규칙(스펙 §9): 안전재고 = 재주문점 = 목표수준 = skus.safety_stock,
 * 리드타임 0, 수요 0. A+B 단계가 프로필과 규칙으로 이 상수들을 교체한다. 그때 바뀌는 것은
 * `levelsFor` 하나여야 한다 — 축 판정 자체는 그대로다.
 */
export function assembleSuggestions(inputs: SkuStockInput[], ctx: AssembleContext): SuggestionRow[] {
  const rows = inputs.filter((input) => !input.excluded).map((input) => assembleOne(input, ctx));
  rows.sort((a, b) => a.sellable.position - a.sellable.reorderPoint - (b.sellable.position - b.sellable.reorderPoint));
  return rows;
}

function assembleOne(input: SkuStockInput, ctx: AssembleContext): SuggestionRow {
  const levels = levelsFor(input);

  const company: CompanyAxis = {
    onHand: input.onHandTotal,
    inTransfer: input.inTransferTotal,
    onOrder: input.onOrderTotal,
    reserved: input.reservedTotal,
    position: input.onHandTotal + input.inTransferTotal + input.onOrderTotal - input.reservedTotal,
    ...levels,
  };

  const onOrderDirect = input.onOrderTotal - input.onOrderNonSellable;
  const sellable: SellableAxis = {
    warehouseId: ctx.sellableWarehouseId,
    onHand: input.onHandSellable,
    reserved: input.reservedSellable,
    inTransit: input.inTransitToSellable,
    onOrderDirect,
    position: input.onHandSellable - input.reservedSellable + input.inTransitToSellable + onOrderDirect,
    daysOfCover: null,
    ...levels,
  };

  const actions: SuggestionAction[] = [];

  if (company.position <= company.reorderPoint) {
    const qty = roundUpToLot(company.targetLevel - company.position, input.lot);
    if (qty > 0) {
      actions.push({ type: 'purchase', qty, supplierId: input.supplier?.id ?? null, sourceWarehouseId: null });
    }
  }

  if (sellable.position <= sellable.reorderPoint) {
    const transfer = planTransfer(input, ctx, Math.ceil(sellable.targetLevel - sellable.position));
    if (transfer) actions.push(transfer);
  }

  const flags: SuggestionFlag[] = ['legacy_only'];
  if (!input.supplier) flags.push('supplier_unknown');

  return {
    skuId: input.skuId,
    skuCode: input.skuCode,
    skuName: input.skuName,
    supplier: input.supplier,
    pattern: 'insufficient',
    grade: 'C',
    confidence: 'low',
    demand: { dailyMean: 0, dailyStd: 0 },
    company,
    sellable,
    actions,
    flags,
    legacyReorderPoint: levels.reorderPoint,
  };
}

/** C 단계: 세 수준이 전부 정적 안전재고다. */
function levelsFor(input: SkuStockInput) {
  return {
    safetyStock: input.safetyStock,
    reorderPoint: input.safetyStock,
    targetLevel: input.safetyStock,
    leadTimeDays: 0,
  };
}

/**
 * 이동가능 = 비판매 ON_HAND − draft 지시서 planned. 큰 로케이션부터 채운다.
 * 이동량은 올리지 않는다 — 있는 만큼만 옮긴다(스펙 §5.3).
 */
function planTransfer(input: SkuStockInput, ctx: AssembleContext, need: number): SuggestionAction | null {
  const movableTotal = input.nonSellableOnHand.reduce((sum, row) => sum + row.qty, 0) - input.draftTransferPlanned;
  const qty = Math.min(movableTotal, need);
  if (qty <= 0) return null;

  const sources = [...input.nonSellableOnHand].sort((a, b) => b.qty - a.qty);
  const fromWarehouseId = sources[0].warehouseId;
  const lines: Array<{ fromLocationId: string; quantity: number }> = [];
  let remaining = qty;
  for (const source of sources) {
    if (remaining <= 0) break;
    if (source.warehouseId !== fromWarehouseId) continue;
    const take = Math.min(source.qty, remaining);
    if (take <= 0) continue;
    lines.push({ fromLocationId: source.locationId, quantity: take });
    remaining -= take;
  }
  const lineTotal = lines.reduce((sum, line) => sum + line.quantity, 0);
  return { type: 'transfer', qty: lineTotal, fromWarehouseId, toWarehouseId: ctx.sellableWarehouseId, lines };
}
```

> 출발 창고가 둘 이상이면(비판매 창고가 여럿) 가장 큰 로케이션이 속한 창고 한 곳에서만 낸다 — 이동 지시서는 창고 쌍 단위 문서라 한 제안 = 한 지시서다. `qty` 는 실제 라인 합으로 다시 계산해 draft 차감 뒤 그 창고에 부족한 경우를 정직하게 낸다.

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/suggestion/suggestion.assembler.spec.ts`
Expected: PASS (15 tests)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/suggestion/
git commit -m "feat(replenishment): 두 축(전사·판매창고) 제안 조립 순수 함수 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 3: `InboundPipelineReader` 에 전 창고 발주잔량 `onOrderTotalQty` 추가

**Files:**
- Modify: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.reader.ts`
- Modify: `apps/core/src/modules/inventory/stock-projection/dto/inbound-pipeline.dto.ts`
- Test: `apps/core/src/modules/inventory/stock-projection/services/inbound-pipeline.integration.spec.ts` (기존 파일에 1건 추가)

**Interfaces:**
- Produces: `InboundPipelineRow.onOrderTotalQty: number` — `status='pending'` 계획 아이템의 `expected_qty − received_qty` 합, **창고 불문**. 기존 `onOrderQty`(비판매 창고행만)는 그대로. 판매창고행 발주잔량 = `onOrderTotalQty − onOrderQty`.

- [ ] **Step 1: 실패하는 통합 테스트 추가**

기존 스펙의 `it('세 단계를 각각 수량과 예정일로 낸다', …)` 는 이미 (a) 부천 진열 111 과 (b) 부천 직행 국내 발주 77 을 심는다. 그 테스트의 마지막 `expect` 근처에 다음 단언을 **추가**한다(해당 테스트가 `reader.read(...)` 결과를 `rows` 또는 `[row]` 로 받고 있으니 같은 변수를 쓴다):

```ts
      // 전 창고 발주잔량 = 중국행 300 + 부천 직행 77. 기존 ①(onOrderQty)은 300 그대로.
      expect(row.onOrderTotalQty).toBe(377);
      expect(row.onOrderQty).toBe(300);
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-pipeline.integration`
Expected: FAIL — `onOrderTotalQty` 가 undefined (또는 타입 에러)

- [ ] **Step 3: 리더 수정**

`InboundPipelineRow` 에 필드를 더하고, `read()` 안에서 전 창고 합을 한 번 더 읽는다.

```ts
// inbound-pipeline.reader.ts — InboundPipelineRow
export interface InboundPipelineRow {
  skuId: string;
  onOrderQty: number;
  onOrderEta: Date | null;
  /** 창고 불문 pending 계획 잔량. 전사 축(#743)이 쓴다. 판매창고행 = onOrderTotalQty − onOrderQty. */
  onOrderTotalQty: number;
  awaitingTransferQty: number;
  inTransitQty: number;
  inTransitEta: Date | null;
}
```

```ts
// read() 본문
      const onOrder = await this.readOnOrder(trx, skuIds);
      const onOrderTotal = await this.readOnOrderTotal(trx, skuIds);
      const awaiting = await this.readAwaitingTransfer(trx, skuIds);
      const inTransit = await this.readInTransit(trx, skuIds, input.toWarehouseId);

      return skuIds.map((skuId) => ({
        skuId,
        onOrderQty: onOrder.get(skuId)?.qty ?? 0,
        onOrderEta: onOrder.get(skuId)?.eta ?? null,
        onOrderTotalQty: onOrderTotal.get(skuId) ?? 0,
        awaitingTransferQty: awaiting.get(skuId) ?? 0,
        inTransitQty: inTransit.get(skuId)?.qty ?? 0,
        inTransitEta: inTransit.get(skuId)?.eta ?? null,
      }));
```

```ts
  /**
   * 전 창고 pending 계획 잔량. ①과 달리 판매 창고행(국내 직행 발주)도 센다 — 전사 축은
   * "회사가 이미 산 것" 전부가 필요하다. ①의 비판매 조건을 지우는 게 아니라 항목을 하나 더 낸다.
   */
  private async readOnOrderTotal(trx: DbTx, skuIds: string[]): Promise<Map<string, number>> {
    const items = wmsTables.inboundPlanItems;
    const rows = await trx
      .select({
        skuId: items.skuId,
        qty: sql<number>`SUM(${items.expectedQty} - ${items.receivedQty})::int`,
      })
      .from(items)
      .where(and(eq(items.status, 'pending'), inArray(items.skuId, skuIds)))
      .groupBy(items.skuId);
    return new Map(rows.map((row) => [row.skuId, Number(row.qty)]));
  }
```

- [ ] **Step 4: DTO 수정**

```ts
// inbound-pipeline.dto.ts — InboundPipelineItemDto 에 추가 (onOrderEta 아래)
  @ApiProperty({ description: '발주 잔량 (창고 불문, 전사 축용)' })
  onOrderTotalQty: number;
```

- [ ] **Step 5: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-pipeline.integration`
Expected: PASS
Run: `npm run type-check`
Expected: 에러 0 (`stock-projection.controller.spec.ts` 가 행을 직접 만든다면 필드 추가로 깨질 수 있다 — 그 픽스처에 `onOrderTotalQty: 0` 을 더한다)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/stock-projection/
git commit -m "feat(stock-projection): 공급 파이프라인에 전 창고 발주잔량 onOrderTotalQty (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 4: `WarehouseTransferReader.findDraftPlannedBySku`

**Files:**
- Modify: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.ts`
- Test: `apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.integration.spec.ts` (신설)

**Interfaces:**
- Produces: `findDraftPlannedBySku(tx: DbTx, skuIds: string[]): Promise<Map<string, number>>` — `transfer_orders.status='draft'` 인 지시서의 `transfer_order_lines.planned_qty` 합, SKU 별. 빈 입력은 빈 Map.

- [ ] **Step 1: 실패하는 통합 테스트**

```ts
// apps/core/src/modules/inventory/warehouse-transfer/services/warehouse-transfer.reader.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
} from '../../../fulfillment/services/__support__';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { WarehouseTransferManager } from './warehouse-transfer.manager';
import { WarehouseTransferReader } from './warehouse-transfer.reader';

/**
 * draft 지시서에 실린 planned 합. 보충 제안(#743)이 "어제 제안으로 이미 초안을 만든 수량"을
 * 이동가능에서 빼기 위해 쓴다. 선적된 지시서는 세지 않는다 — 그 물량은 이미 IN_TRANSFER 라
 * 원장에서 빠져 있고, 여기서도 세면 이중 차감이다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.reader.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WarehouseTransferReader.findDraftPlannedBySku (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  it('draft 지시서의 planned 만 SKU 별로 합한다 — 선적된 것은 제외', async () => {
    await inRollbackTx(db, async (trx) => {
      const source = await seedWarehouseWithZone(trx);
      await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, source.warehouseId));
      const dest = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const { skuId: otherSkuId } = await seedSku(trx, holderId);
      await receiveStock(w.command, trx, { skuId, warehouseId: source.warehouseId, locationId: source.locationId, quantity: 500 });

      const dbService = boundDbService(trx);
      const manager = new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
      const reader = new WarehouseTransferReader(dbService);

      // draft 두 건 (30 + 20)
      await manager.createOrder(
        { fromWarehouseId: source.warehouseId, toWarehouseId: dest.warehouseId, lines: [{ skuId, fromLocationId: source.locationId, quantity: 30 }] },
        trx,
      );
      await manager.createOrder(
        { fromWarehouseId: source.warehouseId, toWarehouseId: dest.warehouseId, lines: [{ skuId, fromLocationId: source.locationId, quantity: 20 }] },
        trx,
      );
      // 선적된 한 건 (40) — 세면 안 된다
      const shipped = await manager.createOrder(
        { fromWarehouseId: source.warehouseId, toWarehouseId: dest.warehouseId, lines: [{ skuId, fromLocationId: source.locationId, quantity: 40 }] },
        trx,
      );
      await manager.ship({ transferOrderId: shipped.transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);

      const result = await reader.findDraftPlannedBySku(trx, [skuId, otherSkuId]);
      expect(result.get(skuId)).toBe(50);
      expect(result.has(otherSkuId)).toBe(false);
    });
  });

  it('빈 입력은 빈 Map', async () => {
    await inRollbackTx(db, async (trx) => {
      const reader = new WarehouseTransferReader(boundDbService(trx));
      expect((await reader.findDraftPlannedBySku(trx, [])).size).toBe(0);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.reader.integration`
Expected: FAIL — `reader.findDraftPlannedBySku is not a function`

- [ ] **Step 3: 구현**

```ts
// warehouse-transfer.reader.ts — import 에 and, inArray 추가
import { and, eq, gt, inArray, sql } from 'drizzle-orm';

  /**
   * draft 지시서에 실린 planned 합, SKU 별. 보충 제안이 이동가능(비판매 ON_HAND)에서 뺀다 —
   * 초안은 원장을 안 움직이므로 원장만 보면 어제 낸 제안이 오늘 또 뜬다(#743 §7.2).
   * 선적된 지시서는 세지 않는다: 그 물량은 이미 IN_TRANSFER 로 원장에서 빠져 있다.
   */
  async findDraftPlannedBySku(tx: DbTx, skuIds: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const lines = wmsTables.transferOrderLines;
      const orders = wmsTables.transferOrders;
      const rows = await trx
        .select({ skuId: lines.skuId, qty: sql<number>`SUM(${lines.plannedQty})::int` })
        .from(lines)
        .innerJoin(orders, eq(orders.id, lines.transferOrderId))
        .where(and(eq(orders.status, 'draft'), inArray(lines.skuId, unique)))
        .groupBy(lines.skuId);
      return new Map(rows.map((row) => [row.skuId, Number(row.qty)]));
    }, tx);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- warehouse-transfer.reader.integration`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/warehouse-transfer/services/
git commit -m "feat(warehouse-transfer): draft 지시서 planned 합 findDraftPlannedBySku (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 5: `ReplenishmentStockReader` — 원장 · 예약 · SKU 마스터 집계

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-stock.reader.ts`
- Test: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-stock.reader.integration.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface SkuMasterRow {
  skuId: string; skuCode: string; skuName: string; safetyStock: number;
  moq: number | null; packingUnit: number | null;
  supplier: { id: string; name: string } | null;
}
export interface LedgerAggregate {
  onHandTotal: number; inTransferTotal: number; onHandSellable: number;
  nonSellableOnHand: Array<{ warehouseId: string; locationId: string; qty: number }>;
}
export interface ReservationAggregate { reservedTotal: number; reservedSellable: number }

class ReplenishmentStockReader {
  /** is_deleted=false 인 SKU 전부(또는 skuIds 로 좁힘). 공급사는 최근 ordered 발주 라인 → 유일한 sku_suppliers 순. */
  listSkuMasters(tx: DbTx, skuIds?: string[]): Promise<SkuMasterRow[]>;
  readLedgerAggregates(tx: DbTx, skuIds: string[]): Promise<Map<string, LedgerAggregate>>;
  readConfirmedReservations(tx: DbTx, skuIds: string[]): Promise<Map<string, ReservationAggregate>>;
  /** is_sellable=true 창고. 정확히 하나가 아니면 던진다(C 단계 전제, 스펙 §7.2). */
  findSingleSellableWarehouseId(tx: DbTx): Promise<string>;
}
```

- [ ] **Step 1: 실패하는 통합 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/replenishment-stock.reader.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
  seedShipmentLineFor,
} from '../../../fulfillment/services/__support__';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { WarehouseTransferManager } from '../../warehouse-transfer/services/warehouse-transfer.manager';
import { ReplenishmentStockReader } from './replenishment-stock.reader';

/**
 * 보충 제안의 재고 재료. 원장을 SKU × 판매창고여부 × 상태로 집계하고 확정 예약만 뺀다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-stock.reader.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentStockReader (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  async function seedWorld(trx: DbTx) {
    const china = await seedWarehouseWithZone(trx);
    await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, china.warehouseId));
    const bucheon = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId, skuCode } = await seedSku(trx, holderId);
    return { china, bucheon, skuId, skuCode, holderId };
  }

  it('원장을 판매/비판매 · ON_HAND/IN_TRANSFER 로 나눠 합한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx);
      await receiveStock(w.command, trx, { skuId, warehouseId: bucheon.warehouseId, locationId: bucheon.locationId, quantity: 100 });
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 250 });
      // 중국 250 중 50 선적 → 중국 ON_HAND 200, IN_TRANSFER 50
      const dbService = boundDbService(trx);
      const manager = new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
      const { transferOrderId } = await manager.createOrder(
        { fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ skuId, fromLocationId: china.locationId, quantity: 50 }] },
        trx,
      );
      await manager.ship({ transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);

      const reader = new ReplenishmentStockReader(dbService);
      const agg = (await reader.readLedgerAggregates(trx, [skuId])).get(skuId);
      expect(agg).toEqual({
        onHandTotal: 300,
        inTransferTotal: 50,
        onHandSellable: 100,
        nonSellableOnHand: [{ warehouseId: china.warehouseId, locationId: china.locationId, qty: 200 }],
      });
    });
  });

  it('확정 예약만 센다 — pending 은 제외, 판매창고분을 따로 낸다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx);
      await receiveStock(w.command, trx, { skuId, warehouseId: bucheon.warehouseId, locationId: bucheon.locationId, quantity: 100 });
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 100 });
      const lineSell = await seedShipmentLineFor(trx, { skuId, warehouseId: bucheon.warehouseId, qty: 7 });
      const lineChina = await seedShipmentLineFor(trx, { skuId, warehouseId: china.warehouseId, qty: 3 });
      const linePending = await seedShipmentLineFor(trx, { skuId, warehouseId: bucheon.warehouseId, qty: 9 });
      await trx.insert(wmsTables.stockReservations).values([
        { targetType: 'SHIPMENT_LINE', targetId: lineSell, shipmentLineId: lineSell, skuId, warehouseId: bucheon.warehouseId, quantity: 7, status: 'confirmed' },
        { targetType: 'SHIPMENT_LINE', targetId: lineChina, shipmentLineId: lineChina, skuId, warehouseId: china.warehouseId, quantity: 3, status: 'confirmed' },
        { targetType: 'SHIPMENT_LINE', targetId: linePending, shipmentLineId: linePending, skuId, warehouseId: bucheon.warehouseId, quantity: 9, status: 'pending' },
      ]);

      const reader = new ReplenishmentStockReader(boundDbService(trx));
      const agg = (await reader.readConfirmedReservations(trx, [skuId])).get(skuId);
      expect(agg).toEqual({ reservedTotal: 10, reservedSellable: 7 });
    });
  });

  it('SKU 마스터: 공급사는 최근 ordered 발주 라인 → 유일한 sku_suppliers 순, packing_unit 은 primary 바코드', async () => {
    await inRollbackTx(db, async (trx) => {
      const { bucheon, skuId, skuCode, holderId } = await seedWorld(trx);
      await trx.update(wmsTables.skus).set({ safetyStock: 40, moq: 12 }).where(eq(wmsTables.skus.id, skuId));
      await trx.insert(wmsTables.skuBarcodes).values([
        { skuId, barcode: `B-${randomUUID()}`, isPrimary: false, packingUnit: 99 },
        { skuId, barcode: `B-${randomUUID()}`, isPrimary: true, packingUnit: 6 },
      ]);
      const [supA] = await trx.insert(wmsTables.suppliers).values({ name: 'A' }).returning({ id: wmsTables.suppliers.id });
      const [supB] = await trx.insert(wmsTables.suppliers).values({ name: 'B' }).returning({ id: wmsTables.suppliers.id });
      await trx.insert(wmsTables.skuSuppliers).values([{ skuId, supplierId: supA.id }, { skuId, supplierId: supB.id }]);
      // 최근 ordered 라인은 B
      const [po] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({ type: 'domestic', supplierId: supB.id, sourceWarehouseId: bucheon.warehouseId, destinationWarehouseId: bucheon.warehouseId })
        .returning({ id: wmsTables.purchaseOrders.id });
      await trx.insert(wmsTables.purchaseOrderLines).values({ poId: po.id, skuId, quantity: 5, status: 'ordered', orderedQty: 5, orderedAt: new Date() });

      // 유일한 sku_suppliers 만 있는 두 번째 SKU
      const { skuId: skuOnly } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.skuSuppliers).values({ skuId: skuOnly, supplierId: supA.id });
      // 공급사가 둘이고 발주 이력이 없는 세 번째 SKU → 미정
      const { skuId: skuAmbiguous } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.skuSuppliers).values([{ skuId: skuAmbiguous, supplierId: supA.id }, { skuId: skuAmbiguous, supplierId: supB.id }]);

      const reader = new ReplenishmentStockReader(boundDbService(trx));
      const rows = await reader.listSkuMasters(trx, [skuId, skuOnly, skuAmbiguous]);
      const byId = new Map(rows.map((r) => [r.skuId, r]));
      expect(byId.get(skuId)).toEqual({
        skuId, skuCode, skuName: 'it-sku', safetyStock: 40, moq: 12, packingUnit: 6,
        supplier: { id: supB.id, name: 'B' },
      });
      expect(byId.get(skuOnly)?.supplier).toEqual({ id: supA.id, name: 'A' });
      expect(byId.get(skuAmbiguous)?.supplier).toBeNull();
    });
  });

  it('삭제된 SKU 는 목록에서 빠진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { skuId } = await seedWorld(trx);
      await trx.update(wmsTables.skus).set({ isDeleted: true }).where(eq(wmsTables.skus.id, skuId));
      const reader = new ReplenishmentStockReader(boundDbService(trx));
      expect(await reader.listSkuMasters(trx, [skuId])).toEqual([]);
    });
  });

  it('판매 창고가 정확히 하나여야 한다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 롤백 트랜잭션 안에서 기존 판매 창고를 전부 끄고 하나만 켠다
      await trx.update(wmsTables.warehouses).set({ isSellable: false });
      const only = await seedWarehouseWithZone(trx);
      const reader = new ReplenishmentStockReader(boundDbService(trx));
      expect(await reader.findSingleSellableWarehouseId(trx)).toBe(only.warehouseId);

      await seedWarehouseWithZone(trx); // 둘째 판매 창고
      await expect(reader.findSingleSellableWarehouseId(trx)).rejects.toThrow(/판매 창고/);
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-stock.reader.integration`
Expected: FAIL — `Cannot find module './replenishment-stock.reader'`

- [ ] **Step 3: 구현**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/replenishment-stock.reader.ts
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';

export interface SkuMasterRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  safetyStock: number;
  moq: number | null;
  packingUnit: number | null;
  supplier: { id: string; name: string } | null;
}

export interface LedgerAggregate {
  onHandTotal: number;
  inTransferTotal: number;
  onHandSellable: number;
  nonSellableOnHand: Array<{ warehouseId: string; locationId: string; qty: number }>;
}

export interface ReservationAggregate {
  reservedTotal: number;
  reservedSellable: number;
}

/**
 * 보충 제안의 재고 재료 (스펙 §7.1). 읽기 전용. 원장 쓰기 없음.
 * 판매/비판매 판정은 `inSellableWarehouse()` 한 곳만 쓴다.
 */
@Injectable()
export class ReplenishmentStockReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async listSkuMasters(tx: DbTx, skuIds?: string[]): Promise<SkuMasterRow[]> {
    return this.dbService.run(async (trx) => {
      const skus = wmsTables.skus;
      const conditions = [eq(skus.isDeleted, false)];
      if (skuIds) {
        if (skuIds.length === 0) return [];
        conditions.push(inArray(skus.id, skuIds));
      }
      const base = await trx
        .select({ skuId: skus.id, skuCode: skus.code, skuName: skus.name, safetyStock: skus.safetyStock, moq: skus.moq })
        .from(skus)
        .where(and(...conditions));
      if (base.length === 0) return [];
      const ids = base.map((row) => row.skuId);

      const packing = await this.readPrimaryPackingUnit(trx, ids);
      const suppliers = await this.resolveSuppliers(trx, ids);

      return base.map((row) => ({
        skuId: row.skuId,
        skuCode: row.skuCode,
        skuName: row.skuName,
        safetyStock: row.safetyStock,
        moq: row.moq ?? null,
        packingUnit: packing.get(row.skuId) ?? null,
        supplier: suppliers.get(row.skuId) ?? null,
      }));
    }, tx);
  }

  async readLedgerAggregates(tx: DbTx, skuIds: string[]): Promise<Map<string, LedgerAggregate>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const ledgers = wmsTables.stockLedgers;
      const rows = await trx
        .select({
          skuId: ledgers.skuId,
          warehouseId: ledgers.warehouseId,
          locationId: ledgers.locationId,
          stockState: ledgers.stockState,
          qty: sql<number>`SUM(${ledgers.qty})::int`,
          sellable: sql<boolean>`${inSellableWarehouse(ledgers.warehouseId)}`,
        })
        .from(ledgers)
        .where(and(inArray(ledgers.skuId, unique), inArray(ledgers.stockState, ['ON_HAND', 'IN_TRANSFER'])))
        .groupBy(ledgers.skuId, ledgers.warehouseId, ledgers.locationId, ledgers.stockState);

      const result = new Map<string, LedgerAggregate>();
      for (const row of rows) {
        const agg = result.get(row.skuId) ?? { onHandTotal: 0, inTransferTotal: 0, onHandSellable: 0, nonSellableOnHand: [] };
        const qty = Number(row.qty);
        if (row.stockState === 'IN_TRANSFER') {
          agg.inTransferTotal += qty;
        } else {
          agg.onHandTotal += qty;
          if (row.sellable) agg.onHandSellable += qty;
          else if (qty > 0) agg.nonSellableOnHand.push({ warehouseId: row.warehouseId, locationId: row.locationId, qty });
        }
        result.set(row.skuId, agg);
      }
      return result;
    }, tx);
  }

  async readConfirmedReservations(tx: DbTx, skuIds: string[]): Promise<Map<string, ReservationAggregate>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const reservations = wmsTables.stockReservations;
      const rows = await trx
        .select({
          skuId: reservations.skuId,
          sellable: sql<boolean>`${inSellableWarehouse(reservations.warehouseId)}`,
          qty: sql<number>`SUM(${reservations.quantity})::int`,
        })
        .from(reservations)
        .where(and(inArray(reservations.skuId, unique), eq(reservations.status, 'confirmed')))
        .groupBy(reservations.skuId, sql`${inSellableWarehouse(reservations.warehouseId)}`);

      const result = new Map<string, ReservationAggregate>();
      for (const row of rows) {
        const agg = result.get(row.skuId) ?? { reservedTotal: 0, reservedSellable: 0 };
        const qty = Number(row.qty);
        agg.reservedTotal += qty;
        if (row.sellable) agg.reservedSellable += qty;
        result.set(row.skuId, agg);
      }
      return result;
    }, tx);
  }

  /** C 단계 전제: 판매 창고 하나. 둘 이상이면 제안이 창고별 수요를 알 수 없으므로 거부한다(스펙 §7.2). */
  async findSingleSellableWarehouseId(tx: DbTx): Promise<string> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({ id: wmsTables.warehouses.id })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.isSellable, true));
      if (rows.length !== 1) {
        throw new ConflictError(`보충 제안은 판매 창고가 정확히 하나일 때만 계산한다 (현재 ${rows.length}개)`);
      }
      return rows[0].id;
    }, tx);
  }

  private async readPrimaryPackingUnit(trx: DbTx, skuIds: string[]): Promise<Map<string, number>> {
    const barcodes = wmsTables.skuBarcodes;
    const rows = await trx
      .select({ skuId: barcodes.skuId, packingUnit: barcodes.packingUnit })
      .from(barcodes)
      .where(and(inArray(barcodes.skuId, skuIds), eq(barcodes.isPrimary, true)));
    const result = new Map<string, number>();
    for (const row of rows) if (row.packingUnit !== null) result.set(row.skuId, row.packingUnit);
    return result;
  }

  /**
   * SKU 의 공급사 (스펙 §4.4): 가장 최근 `ordered` 발주 라인의 공급사 → 없으면 `sku_suppliers` 가
   * 정확히 하나일 때 그것 → 아니면 미정(null).
   */
  private async resolveSuppliers(trx: DbTx, skuIds: string[]): Promise<Map<string, { id: string; name: string }>> {
    const lines = wmsTables.purchaseOrderLines;
    const orders = wmsTables.purchaseOrders;
    const suppliers = wmsTables.suppliers;

    const ordered = await trx
      .select({ skuId: lines.skuId, supplierId: suppliers.id, supplierName: suppliers.name, orderedAt: lines.orderedAt })
      .from(lines)
      .innerJoin(orders, eq(orders.id, lines.poId))
      .innerJoin(suppliers, eq(suppliers.id, orders.supplierId))
      .where(and(inArray(lines.skuId, skuIds), eq(lines.status, 'ordered')))
      .orderBy(desc(lines.orderedAt));

    const result = new Map<string, { id: string; name: string }>();
    for (const row of ordered) {
      if (!result.has(row.skuId)) result.set(row.skuId, { id: row.supplierId, name: row.supplierName });
    }

    const unresolved = skuIds.filter((id) => !result.has(id));
    if (unresolved.length === 0) return result;

    const links = await trx
      .select({ skuId: wmsTables.skuSuppliers.skuId, supplierId: suppliers.id, supplierName: suppliers.name })
      .from(wmsTables.skuSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, wmsTables.skuSuppliers.supplierId))
      .where(inArray(wmsTables.skuSuppliers.skuId, unresolved));

    const grouped = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of links) {
      const list = grouped.get(row.skuId) ?? [];
      list.push({ id: row.supplierId, name: row.supplierName });
      grouped.set(row.skuId, list);
    }
    for (const [skuId, list] of grouped) {
      if (list.length === 1) result.set(skuId, list[0]);
    }
    return result;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-stock.reader.integration`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/suggestion/replenishment-stock.reader*.ts
git commit -m "feat(replenishment): 원장·예약·SKU 마스터 집계 리더 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 6: DTO + `ReplenishmentSuggestionService` + end-to-end 통합 스펙

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/dto/replenishment-suggestion.dto.ts`
- Create: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.service.ts`
- Test: `apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.integration.spec.ts`

**Interfaces:**
- Consumes: `assembleSuggestions` (Task 2) · `StockProjectionService.getInboundPipeline` (Task 3 의 `onOrderTotalQty` 포함) · `WarehouseTransferReader.findDraftPlannedBySku` (Task 4) · `ReplenishmentStockReader` (Task 5)
- Produces:

```ts
class ReplenishmentSuggestionService {
  listSuggestions(filter: { action: 'purchase' | 'transfer' | 'all' }, tx?: DbTx): Promise<ReplenishmentSuggestionListDto>;
  getSku(skuId: string, tx?: DbTx): Promise<ReplenishmentSuggestionRowDto>;   // 없으면 NotFoundError
}
```

- [ ] **Step 1: DTO 작성**

```ts
// apps/core/src/modules/inventory/replenishment/dto/replenishment-suggestion.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const SUGGESTION_ACTION_FILTERS = ['purchase', 'transfer', 'all'] as const;
export type SuggestionActionFilter = (typeof SUGGESTION_ACTION_FILTERS)[number];

export class ListSuggestionsQueryDto {
  @ApiPropertyOptional({ enum: SUGGESTION_ACTION_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(SUGGESTION_ACTION_FILTERS)
  action?: SuggestionActionFilter;
}

export class SuggestionSupplierDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class SuggestionDemandDto {
  @ApiProperty({ description: '일평균 수요. C 단계는 0' }) dailyMean: number;
  @ApiProperty({ description: '일 수요 표준편차. C 단계는 0' }) dailyStd: number;
}

export class CompanyAxisDto {
  @ApiProperty() onHand: number;
  @ApiProperty() inTransfer: number;
  @ApiProperty() onOrder: number;
  @ApiProperty() reserved: number;
  @ApiProperty({ description: 'ON_HAND + IN_TRANSFER + 발주잔량 − 확정예약' }) position: number;
  @ApiProperty() safetyStock: number;
  @ApiProperty() reorderPoint: number;
  @ApiProperty() targetLevel: number;
  @ApiProperty() leadTimeDays: number;
}

export class SellableAxisDto {
  @ApiProperty() warehouseId: string;
  @ApiProperty() onHand: number;
  @ApiProperty() reserved: number;
  @ApiProperty() inTransit: number;
  @ApiProperty({ description: '판매창고로 직행하는 발주잔량' }) onOrderDirect: number;
  @ApiProperty({ description: 'ON_HAND − 예약 + 이동중 + 직행 발주잔량' }) position: number;
  @ApiProperty() safetyStock: number;
  @ApiProperty() reorderPoint: number;
  @ApiProperty() targetLevel: number;
  @ApiProperty() leadTimeDays: number;
  @ApiPropertyOptional({ nullable: true, description: '예상 커버 일수. C 단계는 null' }) daysOfCover: number | null;
}

export class TransferLineSuggestionDto {
  @ApiProperty() fromLocationId: string;
  @ApiProperty() quantity: number;
}

export class SuggestionActionDto {
  @ApiProperty({ enum: ['purchase', 'transfer'] }) type: 'purchase' | 'transfer';
  @ApiProperty() qty: number;
  @ApiPropertyOptional({ nullable: true }) supplierId?: string | null;
  @ApiPropertyOptional({ nullable: true }) sourceWarehouseId?: string | null;
  @ApiPropertyOptional() fromWarehouseId?: string;
  @ApiPropertyOptional() toWarehouseId?: string;
  @ApiPropertyOptional({ type: [TransferLineSuggestionDto] }) lines?: TransferLineSuggestionDto[];
}

export const SUGGESTION_FLAGS = ['default_lead_time', 'supplier_unknown', 'low_confidence', 'legacy_only'] as const;

export class ReplenishmentSuggestionRowDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiPropertyOptional({ type: SuggestionSupplierDto, nullable: true }) supplier: SuggestionSupplierDto | null;
  @ApiProperty({ enum: ['smooth', 'intermittent', 'erratic', 'lumpy', 'insufficient', 'none'] }) pattern: string;
  @ApiProperty({ enum: ['A', 'B', 'C'] }) grade: string;
  @ApiProperty({ enum: ['normal', 'low'] }) confidence: string;
  @ApiProperty({ type: SuggestionDemandDto }) demand: SuggestionDemandDto;
  @ApiProperty({ type: CompanyAxisDto }) company: CompanyAxisDto;
  @ApiProperty({ type: SellableAxisDto }) sellable: SellableAxisDto;
  @ApiProperty({ type: [SuggestionActionDto] }) actions: SuggestionActionDto[];
  @ApiProperty({ enum: SUGGESTION_FLAGS, isArray: true }) flags: string[];
  @ApiProperty({ description: '레거시 방식 재주문점 (μ_D·μ_L). C 단계는 안전재고와 같다' }) legacyReorderPoint: number;
}

export class ReplenishmentSuggestionListDto {
  @ApiProperty({ type: [ReplenishmentSuggestionRowDto] }) items: ReplenishmentSuggestionRowDto[];
  @ApiProperty({ description: '판정한 SKU 수 (excluded 제외)' }) evaluated: number;
}
```

- [ ] **Step 2: 실패하는 end-to-end 통합 테스트**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
} from '../../../fulfillment/services/__support__';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { WarehouseTransferManager } from '../../warehouse-transfer/services/warehouse-transfer.manager';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import { InboundPipelineReader } from '../../stock-projection/services/inbound-pipeline.reader';
import { StockProjectionService } from '../../stock-projection/services/stock-projection.service';
import { StockProjectionReader } from '../../stock-projection/services/stock-projection.reader';
import { StockProjectionManager } from '../../stock-projection/services/stock-projection.manager';
import { ReplenishmentStockReader } from './replenishment-stock.reader';
import { ReplenishmentSuggestionService } from './replenishment-suggestion.service';

/**
 * 스펙 §10 의 end-to-end 3장면. 롤백 트랜잭션 안에서 판매 창고를 하나로 만든다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-suggestion.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentSuggestionService (DB integration, end-to-end)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    const transferReader = new WarehouseTransferReader(dbService);
    const pipeline = new InboundPipelineReader(dbService, transferReader);
    const projection = new StockProjectionService(
      new StockProjectionReader(dbService),
      new StockProjectionManager(dbService as never),
      pipeline,
      dbService,
    );
    const manager = new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
    const service = new ReplenishmentSuggestionService(dbService, new ReplenishmentStockReader(dbService), projection, transferReader);
    return { service, manager };
  }

  /** 롤백 트랜잭션 안에서 판매 창고를 부천 하나로 만든다 — 라이브 판매 창고 행이 있어도 스펙이 성립한다. */
  async function seedWorld(trx: DbTx, safetyStock: number) {
    await trx.update(wmsTables.warehouses).set({ isSellable: false });
    const china = await seedWarehouseWithZone(trx);
    await trx.update(wmsTables.warehouses).set({ isSellable: false }).where(eq(wmsTables.warehouses.id, china.warehouseId));
    const bucheon = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    await trx.update(wmsTables.skus).set({ safetyStock }).where(eq(wmsTables.skus.id, skuId));
    return { china, bucheon, skuId };
  }

  async function seedPendingPlan(trx: DbTx, input: { skuId: string; warehouseId: string; destinationWarehouseId: string; qty: number }) {
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${randomUUID().slice(0, 8)}`, defaultWarehouseId: input.warehouseId })
      .returning({ id: wmsTables.suppliers.id });
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'confirmed',
        sourceWarehouseId: input.warehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        requiresTransfer: input.warehouseId !== input.destinationWarehouseId,
      })
      .returning({ id: wmsTables.purchaseOrders.id });
    await trx.insert(wmsTables.purchaseOrderLines).values({ poId: po.id, skuId: input.skuId, quantity: input.qty });
    const [plan] = await trx
      .insert(wmsTables.inboundPlans)
      .values({
        planType: 'source',
        status: 'pending',
        warehouseId: input.warehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        linkedPurchaseOrderId: po.id,
        requiresTransfer: input.warehouseId !== input.destinationWarehouseId,
      })
      .returning({ id: wmsTables.inboundPlans.id });
    await trx.insert(wmsTables.inboundPlanItems).values({ planId: plan.id, skuId: input.skuId, expectedQty: input.qty, receivedQty: 0, status: 'pending' });
  }

  it('장면 1: 중국 有 · 부천 부족 → 이동만', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await receiveStock(w.command, trx, { skuId, warehouseId: bucheon.warehouseId, locationId: bucheon.locationId, quantity: 20 });
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 300 });

      const { service } = build(trx);
      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      const row = items.find((r) => r.skuId === skuId);
      expect(row?.actions).toEqual([
        { type: 'transfer', qty: 80, fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ fromLocationId: china.locationId, quantity: 80 }] },
      ]);
      expect(row?.sellable.warehouseId).toBe(bucheon.warehouseId);
      expect(row?.flags).toContain('legacy_only');
    });
  });

  it('장면 2: 둘 다 부족 → 이동(있는 만큼) + 발주 — draft 지시서분은 이동에서 빠진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await receiveStock(w.command, trx, { skuId, warehouseId: bucheon.warehouseId, locationId: bucheon.locationId, quantity: 10 });
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 50 });
      const { service, manager } = build(trx);
      // 어제 제안으로 만든 draft 20
      await manager.createOrder(
        { fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ skuId, fromLocationId: china.locationId, quantity: 20 }] },
        trx,
      );

      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      const row = items.find((r) => r.skuId === skuId);
      expect(row?.company.position).toBe(60);
      expect(row?.actions).toEqual([
        { type: 'purchase', qty: 40, supplierId: null, sourceWarehouseId: null },
        { type: 'transfer', qty: 30, fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ fromLocationId: china.locationId, quantity: 30 }] },
      ]);
      expect(row?.flags).toEqual(expect.arrayContaining(['legacy_only', 'supplier_unknown']));

      // action 필터
      const purchaseOnly = await service.listSuggestions({ action: 'purchase' }, trx);
      expect(purchaseOnly.items.find((r) => r.skuId === skuId)?.actions.map((a) => a.type)).toEqual(['purchase']);
    });
  });

  it('장면 3: 발주잔량이 덮고 이동중이 덮음 → 제안 없음, getSku 는 행을 준다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await receiveStock(w.command, trx, { skuId, warehouseId: china.warehouseId, locationId: china.locationId, quantity: 150 });
      const { service, manager } = build(trx);
      // 중국 150 전량 선적 → 부천행 이동중 150
      const { transferOrderId } = await manager.createOrder(
        { fromWarehouseId: china.warehouseId, toWarehouseId: bucheon.warehouseId, lines: [{ skuId, fromLocationId: china.locationId, quantity: 150 }] },
        trx,
      );
      await manager.ship({ transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);
      // 전사 축엔 발주잔량 100 이 추가로 옴
      await seedPendingPlan(trx, { skuId, warehouseId: china.warehouseId, destinationWarehouseId: bucheon.warehouseId, qty: 100 });

      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      expect(items.find((r) => r.skuId === skuId)).toBeUndefined();

      const row = await service.getSku(skuId, trx);
      expect(row.actions).toEqual([]);
      expect(row.company).toMatchObject({ onHand: 0, inTransfer: 150, onOrder: 100, position: 250 });
      expect(row.sellable).toMatchObject({ onHand: 0, inTransit: 150, onOrderDirect: 0, position: 150 });
    });
  });

  it('getSku: 없는 SKU 는 NotFoundError', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedWorld(trx, 1);
      const { service } = build(trx);
      await expect(service.getSku(randomUUID(), trx)).rejects.toThrow(/SKU/);
    });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-suggestion.integration`
Expected: FAIL — `Cannot find module './replenishment-suggestion.service'`

- [ ] **Step 4: 서비스 구현**

```ts
// apps/core/src/modules/inventory/replenishment/suggestion/replenishment-suggestion.service.ts
import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockProjectionService } from '../../stock-projection/services/stock-projection.service';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import { ReplenishmentStockReader, SkuMasterRow } from './replenishment-stock.reader';
import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput, SuggestionRow } from './suggestion.types';
import {
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
  SuggestionActionFilter,
} from '../dto/replenishment-suggestion.dto';

/**
 * 재료 수집 → 순수 조립 → DTO. 쓰기 없음. procurement · warehouse-transfer 의 실행 API 를
 * 부르지 않는다 — 실행은 화면이 기존 API 로 한다(스펙 §8.2).
 */
@Injectable()
export class ReplenishmentSuggestionService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly stockReader: ReplenishmentStockReader,
    private readonly stockProjection: StockProjectionService,
    private readonly transferReader: WarehouseTransferReader,
  ) {}

  async listSuggestions(filter: { action: SuggestionActionFilter }, tx?: DbTx): Promise<ReplenishmentSuggestionListDto> {
    return this.dbService.run(async (trx) => {
      const rows = await this.assemble(trx);
      const wanted = filter.action === 'all' ? null : filter.action;
      const items = rows
        .map((row) => (wanted ? { ...row, actions: row.actions.filter((a) => a.type === wanted) } : row))
        .filter((row) => row.actions.length > 0)
        .map(toDto);
      return { items, evaluated: rows.length };
    }, tx);
  }

  async getSku(skuId: string, tx?: DbTx): Promise<ReplenishmentSuggestionRowDto> {
    return this.dbService.run(async (trx) => {
      const [row] = await this.assemble(trx, [skuId]);
      if (!row) throw new NotFoundError(`SKU not found: ${skuId}`);
      return toDto(row);
    }, tx);
  }

  private async assemble(trx: DbTx, skuIds?: string[]): Promise<SuggestionRow[]> {
    const sellableWarehouseId = await this.stockReader.findSingleSellableWarehouseId(trx);
    const masters = await this.stockReader.listSkuMasters(trx, skuIds);
    if (masters.length === 0) return [];
    const ids = masters.map((m) => m.skuId);

    const ledgers = await this.stockReader.readLedgerAggregates(trx, ids);
    const reservations = await this.stockReader.readConfirmedReservations(trx, ids);
    const pipeline = await this.stockProjection.getInboundPipeline({ skuIds: ids, toWarehouseId: sellableWarehouseId }, trx);
    const pipelineBySku = new Map(pipeline.items.map((item) => [item.skuId, item]));
    const drafts = await this.transferReader.findDraftPlannedBySku(trx, ids);

    const inputs: SkuStockInput[] = masters.map((master) => {
      const ledger = ledgers.get(master.skuId);
      const reserved = reservations.get(master.skuId);
      const pipe = pipelineBySku.get(master.skuId);
      return {
        ...identity(master),
        onHandTotal: ledger?.onHandTotal ?? 0,
        inTransferTotal: ledger?.inTransferTotal ?? 0,
        reservedTotal: reserved?.reservedTotal ?? 0,
        onHandSellable: ledger?.onHandSellable ?? 0,
        reservedSellable: reserved?.reservedSellable ?? 0,
        nonSellableOnHand: ledger?.nonSellableOnHand ?? [],
        onOrderTotal: pipe?.onOrderTotalQty ?? 0,
        onOrderNonSellable: pipe?.onOrderQty ?? 0,
        inTransitToSellable: pipe?.inTransitQty ?? 0,
        draftTransferPlanned: drafts.get(master.skuId) ?? 0,
      };
    });

    return assembleSuggestions(inputs, { sellableWarehouseId });
  }
}

/** C 단계엔 SKU 예외 테이블이 없다 — excluded 는 항상 false. A+B 가 규칙 층에서 채운다. */
function identity(master: SkuMasterRow) {
  return {
    skuId: master.skuId,
    skuCode: master.skuCode,
    skuName: master.skuName,
    supplier: master.supplier,
    safetyStock: master.safetyStock,
    lot: { moq: master.moq, packingUnit: master.packingUnit },
    excluded: false,
  };
}

function toDto(row: SuggestionRow): ReplenishmentSuggestionRowDto {
  return {
    skuId: row.skuId,
    skuCode: row.skuCode,
    skuName: row.skuName,
    supplier: row.supplier,
    pattern: row.pattern,
    grade: row.grade,
    confidence: row.confidence,
    demand: row.demand,
    company: row.company,
    sellable: row.sellable,
    actions: row.actions.map((action) =>
      action.type === 'purchase'
        ? { type: 'purchase', qty: action.qty, supplierId: action.supplierId, sourceWarehouseId: action.sourceWarehouseId }
        : { type: 'transfer', qty: action.qty, fromWarehouseId: action.fromWarehouseId, toWarehouseId: action.toWarehouseId, lines: action.lines },
    ),
    flags: [...row.flags],
    legacyReorderPoint: row.legacyReorderPoint,
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-suggestion.integration`
Expected: PASS (4 tests)

> `StockProjectionManager` 생성자 인자가 `dbService` 하나가 아니면 `build()` 의 `new StockProjectionManager(...)` 를 실제 시그니처에 맞춘다 — `stock-projection.manager.ts` 의 constructor 를 확인. 이 스펙은 manager 를 호출하지 않으므로 mock(`{} as never`) 도 허용된다(스펙 파일의 캐스트 관례).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/
git commit -m "feat(replenishment): 제안 서비스 + 응답 DTO + end-to-end 3장면 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 7: 컨트롤러 + 모듈 등록

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment/controllers/replenishment-suggestion.controller.ts`
- Create: `apps/core/src/modules/inventory/replenishment/replenishment.module.ts`
- Modify: `apps/core/src/modules/inventory/inventory.module.ts`
- Test: `apps/core/src/modules/inventory/replenishment/controllers/replenishment-suggestion.controller.spec.ts`

**Interfaces:**
- Produces: `GET /replenishment/suggestions?action=purchase|transfer|all` → `ReplenishmentSuggestionListDto` · `GET /replenishment/skus/:skuId` → `ReplenishmentSuggestionRowDto`. 둘 다 `INVENTORY_SCOPE.MANAGE`.

- [ ] **Step 1: 실패하는 컨트롤러 스펙 (위임만 검증)**

```ts
// apps/core/src/modules/inventory/replenishment/controllers/replenishment-suggestion.controller.spec.ts
import { ReplenishmentSuggestionController } from './replenishment-suggestion.controller';
import { ReplenishmentSuggestionService } from '../suggestion/replenishment-suggestion.service';

describe('ReplenishmentSuggestionController', () => {
  const service = {
    listSuggestions: jest.fn().mockResolvedValue({ items: [], evaluated: 0 }),
    getSku: jest.fn().mockResolvedValue({ skuId: 'sku-1' }),
  } as unknown as ReplenishmentSuggestionService;
  const controller = new ReplenishmentSuggestionController(service);

  it('action 미지정은 all 로 위임한다', async () => {
    await controller.list({});
    expect(service.listSuggestions).toHaveBeenCalledWith({ action: 'all' });
  });

  it('action 을 그대로 넘긴다', async () => {
    await controller.list({ action: 'transfer' });
    expect(service.listSuggestions).toHaveBeenCalledWith({ action: 'transfer' });
  });

  it('skuId 를 그대로 넘긴다', async () => {
    await expect(controller.getSku('sku-1')).resolves.toEqual({ skuId: 'sku-1' });
    expect(service.getSku).toHaveBeenCalledWith('sku-1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/controllers`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 컨트롤러 구현**

```ts
// apps/core/src/modules/inventory/replenishment/controllers/replenishment-suggestion.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard } from '@app/authorization';
import { INVENTORY_SCOPE } from '../../../../platform/auth/inventory-scopes';
import { ReplenishmentSuggestionService } from '../suggestion/replenishment-suggestion.service';
import {
  ListSuggestionsQueryDto,
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
} from '../dto/replenishment-suggestion.dto';

/**
 * 보충 제안 HTTP 표면 (#743). 읽기 전용. 상태코드 매핑 try/catch 없음 — GlobalExceptionFilter 가 한다.
 */
@ApiTags('Inventory - Replenishment')
@Controller('replenishment')
@UseGuards(ScopeGuard)
export class ReplenishmentSuggestionController {
  constructor(private readonly service: ReplenishmentSuggestionService) {}

  @Get('suggestions')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: '보충 제안 목록 — 발주 제안과 이동 제안', description: 'actions 가 하나 이상인 SKU 만 낸다. 판매창고 (재고위치 − 재주문점) 오름차순.' })
  @ApiResponse({ status: 200, type: ReplenishmentSuggestionListDto })
  @ApiResponse({ status: 403, description: '재고 마스터데이터 관리 권한이 없습니다.' })
  @ApiResponse({ status: 409, description: '판매 창고가 정확히 하나가 아닙니다.' })
  list(@Query() query: ListSuggestionsQueryDto): Promise<ReplenishmentSuggestionListDto> {
    return this.service.listSuggestions({ action: query.action ?? 'all' });
  }

  @Get('skus/:skuId')
  @RequireScopes(INVENTORY_SCOPE.MANAGE)
  @ApiOperation({ summary: 'SKU 한 건의 보충 판정 — 제안이 없어도 행을 준다' })
  @ApiParam({ name: 'skuId' })
  @ApiResponse({ status: 200, type: ReplenishmentSuggestionRowDto })
  @ApiResponse({ status: 404, description: 'SKU 없음' })
  getSku(@Param('skuId') skuId: string): Promise<ReplenishmentSuggestionRowDto> {
    return this.service.getSku(skuId);
  }
}
```

- [ ] **Step 4: 모듈**

```ts
// apps/core/src/modules/inventory/replenishment/replenishment.module.ts
import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { StockProjectionModule } from '../stock-projection/stock-projection.module';
import { WarehouseTransferModule } from '../warehouse-transfer/warehouse-transfer.module';
import { ReplenishmentSuggestionController } from './controllers/replenishment-suggestion.controller';
import { ReplenishmentSuggestionService } from './suggestion/replenishment-suggestion.service';
import { ReplenishmentStockReader } from './suggestion/replenishment-stock.reader';

/**
 * 재고 보충 제안 (#743, 스펙 2026-09-08). procurement · warehouse-transfer 의 형제.
 *
 * - `ProcurementModule` 을 import 하지 않는다. 제안은 읽기 전용이고 실행(카트·이동 지시서)은
 *   화면이 기존 API 를 부른다. `replenishment-boundary.arch.spec.ts` 가 이 0 을 고정한다.
 * - `WarehouseTransferModule` 은 draft 지시서 planned 합을 Reader 에서 빌리기 위해서다 —
 *   `StockProjectionModule` 이 파이프라인 ③ 때문에 같은 모듈을 빌리는 것과 같은 형태.
 * - C 단계: 안전재고 = `skus.safety_stock` 정적값. A+B 단계가 demand/ · policy/ · rules/ 를 더한다.
 */
@Module({
  imports: [SharedModule, CoreInventoryModule, StockProjectionModule, WarehouseTransferModule],
  controllers: [ReplenishmentSuggestionController],
  providers: [ReplenishmentSuggestionService, ReplenishmentStockReader],
  exports: [ReplenishmentSuggestionService],
})
export class ReplenishmentModule {}
```

`inventory.module.ts` 의 imports 에 `ReplenishmentModule` 을 `ProcurementModule` 다음에 추가한다(exports 에는 넣지 않는다 — 밖에서 쓰는 곳이 없다).

```ts
import { ReplenishmentModule } from './replenishment/replenishment.module';
// imports: [..., ProcurementModule, ReplenishmentModule, MovementModule, ...]
```

- [ ] **Step 5: 통과 확인 + 부팅 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment/controllers`
Expected: PASS (3 tests)
Run: `npm run type-check`
Expected: 에러 0
Run: `nest build core`
Expected: 성공

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment/ apps/core/src/modules/inventory/inventory.module.ts
git commit -m "feat(replenishment): GET /replenishment/suggestions · /replenishment/skus/:skuId + 모듈 등록 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 8: 옛 답 둘 삭제 — `ReorderSuggestionReader` · `SafetyStockService`

**Files:**
- Delete: `apps/core/src/modules/inventory/procurement/services/reorder-suggestion.reader.ts`
- Modify: `apps/core/src/modules/inventory/procurement/controllers/purchase-order.controller.ts` (import · 생성자 주입 · `GET suggestions/reorder` 핸들러 · `StockReorderSuggestion` import 제거)
- Modify: `apps/core/src/modules/inventory/procurement/dto/purchase-order.dto.ts` (`StockReorderSuggestion` 클래스 삭제)
- Modify: `apps/core/src/modules/inventory/procurement/procurement.module.ts` (providers · exports 에서 제거)
- Modify: `apps/core/src/modules/inventory/procurement/services/purchase-order.service.ts` (docstring의 `ReorderSuggestionReader` 언급 제거)
- Delete: `apps/core/src/modules/inventory/core/services/safety-stock.service.ts`
- Modify: `apps/core/src/modules/inventory/core/controllers/inventory.controller.ts` (`GET /below-safety-stock` · `GET /safety-stock-status/:skuId` 핸들러와 주입 제거)
- Modify: `apps/core/src/modules/inventory/core/inventory.module.ts` (providers · exports 에서 제거)

- [ ] **Step 1: 삭제 대상 소비자 확인 (0 이어야 한다)**

```bash
grep -rn "ReorderSuggestionReader\|StockReorderSuggestion\|SafetyStockService\|below-safety-stock\|safety-stock-status" apps/ libs/ --include=*.ts --include=*.tsx | grep -v "reorder-suggestion.reader.ts\|safety-stock.service.ts\|purchase-order.controller.ts\|purchase-order.dto.ts\|procurement.module.ts\|purchase-order.service.ts\|inventory.controller.ts\|core/inventory.module.ts"
```

Expected: admin-web 의 `purchase-orders.client.ts` · `queries.ts` · `query-keys.ts` · `types/dto/inventory.ts` · `cart-drawer/index.tsx` 만 (Task 10·13 이 처리). core 안엔 0.

- [ ] **Step 2: 삭제와 수정**

```bash
git rm apps/core/src/modules/inventory/procurement/services/reorder-suggestion.reader.ts
git rm apps/core/src/modules/inventory/core/services/safety-stock.service.ts
```

`purchase-order.controller.ts`: `ReorderSuggestionReader` import 줄, 생성자의 `private readonly reorderReader: ReorderSuggestionReader,`, `StockReorderSuggestion` import, 그리고 `// ========== 재주문 제안 ==========` 부터 `getReorderSuggestions` 메서드 끝까지 블록을 지운다. `ApiQuery` import 가 다른 곳에서 안 쓰이면 함께 지운다.

`purchase-order.dto.ts`: `StockReorderSuggestion` 클래스와 그 위 주석 블록을 지운다.

`procurement.module.ts`: import 줄과 providers · exports 의 `ReorderSuggestionReader` 를 지운다. docstring 은 그대로(경계 서술은 여전히 참).

`purchase-order.service.ts` docstring: `카트(\`PurchaseOrderCartService\`)와 재주문 제안(\`ReorderSuggestionReader\`)은 컨트롤러가 직접 주입받는다` → `카트(\`PurchaseOrderCartService\`)는 컨트롤러가 직접 주입받는다 — 이 포트를 거치지 않는다. 재주문 제안은 \`inventory/replenishment/\` 로 나갔다(#743).`

`inventory.controller.ts`: `SafetyStockService` import 와 생성자 주입, `getSafetyStockWarnings` · `getSafetyStockStatus` 두 핸들러(각 데코레이터 포함)를 지운다. 남는 미사용 import(`ApiParam` 등)를 정리한다.

`core/inventory.module.ts`: import 줄과 providers · exports 의 `SafetyStockService` 를 지운다.

- [ ] **Step 3: 게이트**

Run: `npm run type-check`
Expected: 에러 0
Run: `npx jest apps/core/src/modules/inventory --maxWorkers=2`
Expected: 실패 0 (`purchase-order.dto.spec.ts` · `stock-projection.controller.spec.ts` 가 깨지면 삭제된 타입 참조를 그 스펙에서 지운다)
Run: `npm run lint`
Expected: 미사용 import 0

- [ ] **Step 4: 커밋**

```bash
git add -A apps/core/src/modules/inventory/procurement apps/core/src/modules/inventory/core
git commit -m "refactor(inventory): 재주문 제안·안전재고 옛 API 삭제 — 답은 replenishment 하나 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 9: 아키텍처 스펙 — `replenishment ↔ procurement` import 0 · 순수 층 격리

**Files:**
- Create: `apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts`

- [ ] **Step 1: 스펙 작성 (바로 통과해야 한다 — 회귀 방지용)**

```ts
// apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, sep } from 'path';

const INVENTORY_ROOT = __dirname;
const REPLENISHMENT = join(INVENTORY_ROOT, 'replenishment');
const PROCUREMENT = join(INVENTORY_ROOT, 'procurement');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

function importLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^\s*import\s/.test(line) || /\brequire\(/.test(line));
}

/**
 * 스펙 §8.2: replenishment 는 procurement 를 import 하지 않고, procurement 도 replenishment 를
 * import 하지 않는다. 제안은 읽기 전용이고 실행은 화면이 기존 API 로 한다. 첫 위반이 생기면
 * 이 스펙보다 먼저 스펙 문서를 고칠 것.
 */
describe('replenishment boundary (arch)', () => {
  it('replenishment/ 는 procurement/ 를 import 하지 않는다', () => {
    const violations = collectTsFiles(REPLENISHMENT).flatMap((file) =>
      importLines(file)
        .filter((line) => /\/procurement\//.test(line) || /['"]\.\.\/procurement/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });

  it('procurement/ 는 replenishment/ 를 import 하지 않는다', () => {
    const violations = collectTsFiles(PROCUREMENT).flatMap((file) =>
      importLines(file)
        .filter((line) => /\/replenishment\//.test(line) || /['"]\.\.\/replenishment/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });

  it('순수 층(policy/ · suggestion.assembler · suggestion.types)은 Nest · drizzle 을 모른다', () => {
    const pure = collectTsFiles(REPLENISHMENT).filter(
      (file) =>
        file.includes(`${sep}policy${sep}`) ||
        file.endsWith('suggestion.assembler.ts') ||
        file.endsWith('suggestion.types.ts'),
    );
    expect(pure.length).toBeGreaterThan(0);
    const violations = pure.flatMap((file) =>
      importLines(file)
        .filter((line) => /@nestjs\//.test(line) || /drizzle-orm/.test(line) || /@app\/db/.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 2: 통과 확인**

Run: `npx jest apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 3: 커밋**

```bash
git add apps/core/src/modules/inventory/replenishment-boundary.arch.spec.ts
git commit -m "test(inventory): replenishment↔procurement import 경계와 순수 층 격리를 스펙으로 고정 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 10: admin-web — 타입 · 클라이언트 · 훅

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (`StockReorderSuggestionDto` 삭제, 새 타입 추가)
- Create: `apps/admin-web/src/lib/api/domains/inventory/replenishment.client.ts`
- Create: `apps/admin-web/src/lib/api/domains/inventory/warehouse-transfers.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts` (`suggestions.reorder` 삭제)
- Modify: `apps/admin-web/src/lib/services/inventory/query-keys.ts` (`reorderSuggestions` 삭제, `replenishment*` 추가)
- Modify: `apps/admin-web/src/lib/services/inventory/queries.ts` (`useReorderSuggestions` 삭제, `useReplenishmentSuggestions` · `useReplenishmentSku` 추가)
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts` (`useCreateTransferOrder` 추가)

**Interfaces:**
- Produces (Task 11·12 가 쓴다): `ReplenishmentSuggestionRowDto` · `ReplenishmentSuggestionListDto` · `SuggestionActionDto` · `CreateTransferOrderRequest` (TS 타입) · `replenishmentClient.list(action)` · `replenishmentClient.getSku(skuId)` · `warehouseTransfersClient.create(body)` · 훅 `useReplenishmentSuggestions(action)` · `useReplenishmentSku(skuId | null)` · `useCreateTransferOrder()`

- [ ] **Step 1: 타입**

`inventory.ts` 의 `StockReorderSuggestionDto` 인터페이스(1377~1386행 부근)를 지우고 같은 자리에:

```ts
// ===== 보충 제안 (replenishment, #743) =====

export type SuggestionActionFilter = 'purchase' | 'transfer' | 'all';
export type SuggestionFlag = 'default_lead_time' | 'supplier_unknown' | 'low_confidence' | 'legacy_only';

export interface SuggestionSupplierDto { id: string; name: string }
export interface SuggestionDemandDto { dailyMean: number; dailyStd: number }

export interface CompanyAxisDto {
  onHand: number; inTransfer: number; onOrder: number; reserved: number; position: number;
  safetyStock: number; reorderPoint: number; targetLevel: number; leadTimeDays: number;
}
export interface SellableAxisDto {
  warehouseId: string; onHand: number; reserved: number; inTransit: number; onOrderDirect: number; position: number;
  safetyStock: number; reorderPoint: number; targetLevel: number; leadTimeDays: number; daysOfCover: number | null;
}
export interface TransferLineSuggestionDto { fromLocationId: string; quantity: number }
export type SuggestionActionDto =
  | { type: 'purchase'; qty: number; supplierId: string | null; sourceWarehouseId: string | null }
  | { type: 'transfer'; qty: number; fromWarehouseId: string; toWarehouseId: string; lines: TransferLineSuggestionDto[] };

export interface ReplenishmentSuggestionRowDto {
  skuId: string; skuCode: string; skuName: string;
  supplier: SuggestionSupplierDto | null;
  pattern: 'smooth' | 'intermittent' | 'erratic' | 'lumpy' | 'insufficient' | 'none';
  grade: 'A' | 'B' | 'C';
  confidence: 'normal' | 'low';
  demand: SuggestionDemandDto;
  company: CompanyAxisDto;
  sellable: SellableAxisDto;
  actions: SuggestionActionDto[];
  flags: SuggestionFlag[];
  legacyReorderPoint: number;
}
export interface ReplenishmentSuggestionListDto { items: ReplenishmentSuggestionRowDto[]; evaluated: number }

// ===== 이동 지시서 생성 =====
export interface CreateTransferOrderLineRequest { skuId: string; fromLocationId: string; quantity: number }
export interface CreateTransferOrderRequest {
  fromWarehouseId: string; toWarehouseId: string; eta?: string; memo?: string; lines: CreateTransferOrderLineRequest[];
}
export interface CreateTransferOrderResponseDto { transferOrderId: string }
```

- [ ] **Step 2: 클라이언트 둘 신설, 옛 함수 삭제**

```ts
// apps/admin-web/src/lib/api/domains/inventory/replenishment.client.ts
'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
  SuggestionActionFilter,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/replenishment`;

export const replenishmentClient = {
  list: async (action: SuggestionActionFilter): Promise<ReplenishmentSuggestionListDto> => {
    const response = await client.get(`${BASE}/suggestions?action=${action}`);
    return response.data;
  },
  getSku: async (skuId: string): Promise<ReplenishmentSuggestionRowDto> => {
    const response = await client.get(`${BASE}/skus/${encodeURIComponent(skuId)}`);
    return response.data;
  },
};
```

```ts
// apps/admin-web/src/lib/api/domains/inventory/warehouse-transfers.client.ts
'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { CreateTransferOrderRequest, CreateTransferOrderResponseDto } from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/warehouse-transfers`;

export const warehouseTransfersClient = {
  create: async (data: CreateTransferOrderRequest): Promise<CreateTransferOrderResponseDto> => {
    const response = await client.post(BASE, data);
    return response.data;
  },
};
```

`purchase-orders.client.ts`: `StockReorderSuggestionDto` import 와 `suggestions: { reorder: … }` 블록을 지운다.

- [ ] **Step 3: 쿼리 키 · 훅**

`query-keys.ts`: `reorderSuggestions` 항목을 지우고 추가:

```ts
  replenishmentSuggestions: (action: string) => ['replenishment', 'suggestions', action] as const,
  replenishmentSku: (skuId: string) => ['replenishment', 'sku', skuId] as const,
```

`queries.ts`: `useReorderSuggestions` 를 지우고, `replenishmentClient` import 후 추가:

```ts
export const useReplenishmentSuggestions = (action: SuggestionActionFilter) =>
  useQuery({
    queryKey: inventoryQueryKeys.replenishmentSuggestions(action),
    queryFn: () => replenishmentClient.list(action),
    staleTime: 60 * 1000,
  });

export const useReplenishmentSku = (skuId: string | null) =>
  useQuery({
    queryKey: inventoryQueryKeys.replenishmentSku(skuId ?? ''),
    queryFn: () => replenishmentClient.getSku(skuId as string),
    enabled: !!skuId,
  });
```

`mutations.ts`: `warehouseTransfersClient` import 후 추가:

```ts
export const useCreateTransferOrder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransferOrderRequest) => warehouseTransfersClient.create(data),
    onSuccess: () => {
      // 초안이 생기면 이동가능이 줄어 제안이 바뀐다.
      queryClient.invalidateQueries({ queryKey: ['replenishment'] });
    },
  });
};
```

`useAddToCart` 의 `onSuccess` 에도 `queryClient.invalidateQueries({ queryKey: ['replenishment'] });` 를 더한다 — 카트에 담겨도 원장은 안 변하므로 제안이 사라지진 않지만, 목록의 신선도 기대를 맞추기 위해서다. (기존 `onSuccess` 가 없다면 만든다.)

- [ ] **Step 4: 타입체크**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: `cart-drawer/index.tsx` 의 `useReorderSuggestions` 참조 오류만 남는다 (Task 13 이 지운다). 다른 오류 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib
git commit -m "feat(admin-web): 보충 제안·이동 지시서 API 클라이언트와 훅, 옛 재주문 제안 제거 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 11: admin-web — 표시 모델 (순수, 테스트)

**Files:**
- Create: `apps/admin-web/src/features/inventory/replenishment/suggestion-model.ts`
- Test: `apps/admin-web/src/features/inventory/replenishment/suggestion-model.spec.ts`

**Interfaces:**
- Produces:

```ts
export function purchaseAction(row): Extract<SuggestionActionDto, { type: 'purchase' }> | null;
export function transferAction(row): Extract<SuggestionActionDto, { type: 'transfer' }> | null;
export function summarizeActions(row): string;                     // "발주 60 · 이동 30" / "발주 60" / "—"
export function toCartPayload(row, purchase, type: 'domestic' | 'foreign'): AddToCartRequest;
export function toTransferPayload(row, transfer, memo?: string): CreateTransferOrderRequest;
export const FLAG_LABELS: Record<SuggestionFlag, string>;
export function urgencyLabel(row): string;                         // 판매창고 위치 − 재주문점 → "부족 40" / "여유 12"
```

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/admin-web/src/features/inventory/replenishment/suggestion-model.spec.ts
import type { ReplenishmentSuggestionRowDto } from '@/lib/types/dto/inventory';
import {
  FLAG_LABELS,
  purchaseAction,
  summarizeActions,
  toCartPayload,
  toTransferPayload,
  transferAction,
  urgencyLabel,
} from './suggestion-model';

function row(overrides: Partial<ReplenishmentSuggestionRowDto> = {}): ReplenishmentSuggestionRowDto {
  return {
    skuId: 'sku-1',
    skuCode: 'S1',
    skuName: 'sku one',
    supplier: { id: 'sup-1', name: 'A' },
    pattern: 'insufficient',
    grade: 'C',
    confidence: 'low',
    demand: { dailyMean: 0, dailyStd: 0 },
    company: { onHand: 0, inTransfer: 0, onOrder: 0, reserved: 0, position: 0, safetyStock: 100, reorderPoint: 100, targetLevel: 100, leadTimeDays: 0 },
    sellable: { warehouseId: 'wh-sell', onHand: 60, reserved: 0, inTransit: 0, onOrderDirect: 0, position: 60, safetyStock: 100, reorderPoint: 100, targetLevel: 100, leadTimeDays: 0, daysOfCover: null },
    actions: [
      { type: 'purchase', qty: 60, supplierId: 'sup-1', sourceWarehouseId: null },
      { type: 'transfer', qty: 30, fromWarehouseId: 'wh-china', toWarehouseId: 'wh-sell', lines: [{ fromLocationId: 'loc-a', quantity: 30 }] },
    ],
    flags: ['legacy_only'],
    legacyReorderPoint: 100,
    ...overrides,
  };
}

describe('suggestion-model', () => {
  it('액션을 종류별로 꺼낸다', () => {
    expect(purchaseAction(row())?.qty).toBe(60);
    expect(transferAction(row())?.qty).toBe(30);
    expect(purchaseAction(row({ actions: [] }))).toBeNull();
  });

  it('요약 문구', () => {
    expect(summarizeActions(row())).toBe('발주 60 · 이동 30');
    expect(summarizeActions(row({ actions: [{ type: 'purchase', qty: 60, supplierId: null, sourceWarehouseId: null }] }))).toBe('발주 60');
    expect(summarizeActions(row({ actions: [] }))).toBe('—');
  });

  it('카트 페이로드는 공급사를 싣고, 없으면 생략한다', () => {
    const r = row();
    expect(toCartPayload(r, purchaseAction(r)!, 'foreign')).toEqual({ skuId: 'sku-1', quantity: 60, type: 'foreign', supplierId: 'sup-1' });
    const noSup = row({ supplier: null, actions: [{ type: 'purchase', qty: 5, supplierId: null, sourceWarehouseId: null }] });
    expect(toCartPayload(noSup, purchaseAction(noSup)!, 'domestic')).toEqual({ skuId: 'sku-1', quantity: 5, type: 'domestic' });
  });

  it('이동 지시서 페이로드는 제안 라인을 그대로 싣는다', () => {
    const r = row();
    expect(toTransferPayload(r, transferAction(r)!, '보충 제안')).toEqual({
      fromWarehouseId: 'wh-china',
      toWarehouseId: 'wh-sell',
      memo: '보충 제안',
      lines: [{ skuId: 'sku-1', fromLocationId: 'loc-a', quantity: 30 }],
    });
  });

  it('긴급도 문구는 판매창고 위치 − 재주문점', () => {
    expect(urgencyLabel(row())).toBe('부족 40');
    expect(urgencyLabel(row({ sellable: { ...row().sellable, position: 112 } }))).toBe('여유 12');
  });

  it('플래그 라벨은 전부 한국어', () => {
    expect(FLAG_LABELS.legacy_only).toBe('정적 안전재고');
    expect(FLAG_LABELS.supplier_unknown).toBe('공급사 미정');
    expect(Object.keys(FLAG_LABELS).sort()).toEqual(['default_lead_time', 'legacy_only', 'low_confidence', 'supplier_unknown']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- suggestion-model`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
// apps/admin-web/src/features/inventory/replenishment/suggestion-model.ts
import type {
  AddToCartRequest,
  CreateTransferOrderRequest,
  PurchaseOrderType,
  ReplenishmentSuggestionRowDto,
  SuggestionActionDto,
  SuggestionFlag,
} from '@/lib/types/dto/inventory';

type PurchaseAction = Extract<SuggestionActionDto, { type: 'purchase' }>;
type TransferAction = Extract<SuggestionActionDto, { type: 'transfer' }>;

export function purchaseAction(row: ReplenishmentSuggestionRowDto): PurchaseAction | null {
  const found = row.actions.find((a): a is PurchaseAction => a.type === 'purchase');
  return found ?? null;
}

export function transferAction(row: ReplenishmentSuggestionRowDto): TransferAction | null {
  const found = row.actions.find((a): a is TransferAction => a.type === 'transfer');
  return found ?? null;
}

export function summarizeActions(row: ReplenishmentSuggestionRowDto): string {
  const parts: string[] = [];
  const purchase = purchaseAction(row);
  const transfer = transferAction(row);
  if (purchase) parts.push(`발주 ${purchase.qty}`);
  if (transfer) parts.push(`이동 ${transfer.qty}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function toCartPayload(
  row: ReplenishmentSuggestionRowDto,
  purchase: PurchaseAction,
  type: PurchaseOrderType,
): AddToCartRequest {
  const payload: AddToCartRequest = { skuId: row.skuId, quantity: purchase.qty, type };
  if (purchase.supplierId) payload.supplierId = purchase.supplierId;
  return payload;
}

export function toTransferPayload(
  row: ReplenishmentSuggestionRowDto,
  transfer: TransferAction,
  memo?: string,
): CreateTransferOrderRequest {
  return {
    fromWarehouseId: transfer.fromWarehouseId,
    toWarehouseId: transfer.toWarehouseId,
    ...(memo ? { memo } : {}),
    lines: transfer.lines.map((line) => ({ skuId: row.skuId, fromLocationId: line.fromLocationId, quantity: line.quantity })),
  };
}

export function urgencyLabel(row: ReplenishmentSuggestionRowDto): string {
  const gap = row.sellable.position - row.sellable.reorderPoint;
  return gap < 0 ? `부족 ${-gap}` : `여유 ${gap}`;
}

export const FLAG_LABELS: Record<SuggestionFlag, string> = {
  default_lead_time: '기본 리드타임',
  supplier_unknown: '공급사 미정',
  low_confidence: '신뢰도 낮음',
  legacy_only: '정적 안전재고',
};
```

> `AddToCartRequest` 의 실제 필드가 `supplierId?: string` 인지 `inventory.ts` 에서 확인한다. 다르면 페이로드 함수와 스펙을 그 모양에 맞춘다.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- suggestion-model`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/inventory/replenishment/
git commit -m "feat(admin-web): 보충 제안 표시 모델 순수 함수 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 12: admin-web — 페이지 · 표 · 드로어 · 메뉴

**Files:**
- Create: `apps/admin-web/src/features/inventory/replenishment/components/table/index.tsx`
- Create: `apps/admin-web/src/features/inventory/replenishment/components/sku-drawer/index.tsx`
- Create: `apps/admin-web/src/features/inventory/replenishment/template/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/inventory/replenishment/page.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (발주관리 다음에 항목 추가)
- Modify: `apps/admin-web/src/lib/utils/menu.spec.ts` (항목 1건 검증 추가)

- [ ] **Step 1: 메뉴 스펙에 실패하는 단언 추가**

`menu.spec.ts` 의 `describe('admin menu navigation', …)` 안에 추가:

```ts
  it('재고관리 아래에 보충 제안이 발주관리 바로 다음에 있다', () => {
    expect(getActiveMenuAndItem('/inventory/replenishment')).toEqual({
      menuId: 'inventory-product',
      itemId: 'inventory-replenishment',
    });
    const inventory = getMenuById('inventory-product');
    const ids = (inventory?.items ?? []).map((item) => item.id);
    expect(ids.indexOf('inventory-replenishment')).toBe(ids.indexOf('inventory-purchase-orders') + 1);
  });
```

Run: `npm run test:admin-web -- menu.spec`
Expected: FAIL

> `getMenuById` 가 반환하는 객체의 하위 항목 필드명이 `items` 가 아니면(`menu.ts` 의 타입을 본다) 그 이름으로 바꾼다.

- [ ] **Step 2: 메뉴 항목 추가**

`menu.ts` 의 `inventory-purchase-orders` 항목 바로 다음에:

```ts
      {
        id: 'inventory-replenishment',
        title: '보충 제안',
        path: '/inventory/replenishment',
      },
```

Run: `npm run test:admin-web -- menu.spec`
Expected: PASS

- [ ] **Step 3: 표 컴포넌트**

```tsx
// apps/admin-web/src/features/inventory/replenishment/components/table/index.tsx
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useReplenishmentSuggestions, useAddToCart, useCreateTransferOrder } from '@/lib/services/inventory';
import type { ReplenishmentSuggestionRowDto, SuggestionActionFilter } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  FLAG_LABELS,
  purchaseAction,
  summarizeActions,
  toCartPayload,
  toTransferPayload,
  transferAction,
  urgencyLabel,
} from '../../suggestion-model';
import { ReplenishmentSkuDrawer } from '../sku-drawer';

const FILTERS: Array<{ value: SuggestionActionFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'purchase', label: '발주' },
  { value: 'transfer', label: '이동' },
];

export function ReplenishmentTable() {
  const [action, setAction] = useState<SuggestionActionFilter>('all');
  const [detailSkuId, setDetailSkuId] = useState<string | null>(null);
  const { data, isLoading, isError } = useReplenishmentSuggestions(action);
  const addToCart = useAddToCart();
  const createTransfer = useCreateTransferOrder();

  const handleCart = async (row: ReplenishmentSuggestionRowDto) => {
    const purchase = purchaseAction(row);
    if (!purchase) return;
    try {
      // C 단계엔 출발 창고 정보가 없어 유형을 해외로 둔다 — 카트에서 바꿀 수 있다.
      await addToCart.mutateAsync(toCartPayload(row, purchase, 'foreign'));
      toast.success(`${row.skuName} ${purchase.qty}개를 카트에 담았습니다.`);
    } catch {
      toast.error('카트 담기에 실패했습니다.');
    }
  };

  const handleTransfer = async (row: ReplenishmentSuggestionRowDto) => {
    const transfer = transferAction(row);
    if (!transfer) return;
    try {
      const { transferOrderId } = await createTransfer.mutateAsync(toTransferPayload(row, transfer, '보충 제안'));
      toast.success(`이동 지시서 초안을 만들었습니다 (${transferOrderId.slice(0, 8)}…).`);
    } catch {
      toast.error('이동 지시서 생성에 실패했습니다. 재고 원장 조정 권한이 필요합니다.');
    }
  };

  const rows = data?.items ?? [];

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-4">
        <Tabs value={action} onValueChange={(v) => setAction(v as SuggestionActionFilter)}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {data && <p className="text-xs text-muted-foreground">판정 {data.evaluated} · 제안 {rows.length}</p>}
      </div>

      {isError ? (
        <p className="p-4 text-sm text-destructive">제안을 불러오지 못했습니다. 판매 창고가 하나인지 확인하세요.</p>
      ) : isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">로딩 중...</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">제안이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>판매창고 재고</TableHead>
              <TableHead>긴급도</TableHead>
              <TableHead>전사 위치</TableHead>
              <TableHead>제안</TableHead>
              <TableHead>플래그</TableHead>
              <TableHead className="text-right">액션</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.skuId} className="cursor-pointer" onClick={() => setDetailSkuId(row.skuId)}>
                <TableCell>
                  <div className="font-medium">{row.skuName}</div>
                  <div className="text-xs text-muted-foreground">{row.skuCode}{row.supplier ? ` · ${row.supplier.name}` : ''}</div>
                </TableCell>
                <TableCell>
                  {row.sellable.onHand}
                  <span className="text-xs text-muted-foreground"> / 예약 {row.sellable.reserved} · 이동중 {row.sellable.inTransit}</span>
                </TableCell>
                <TableCell>{urgencyLabel(row)}</TableCell>
                <TableCell>
                  {row.company.position}
                  <span className="text-xs text-muted-foreground"> / 발주잔량 {row.company.onOrder}</span>
                </TableCell>
                <TableCell>{summarizeActions(row)}</TableCell>
                <TableCell className="space-x-1">
                  {row.flags.map((flag) => (
                    <Badge key={flag} variant="outline">{FLAG_LABELS[flag]}</Badge>
                  ))}
                </TableCell>
                <TableCell className="space-x-1 text-right" onClick={(e) => e.stopPropagation()}>
                  {purchaseAction(row) && (
                    <Button size="sm" variant="outline" disabled={addToCart.isPending} onClick={() => handleCart(row)}>
                      카트
                    </Button>
                  )}
                  {transferAction(row) && (
                    <Button size="sm" variant="outline" disabled={createTransfer.isPending} onClick={() => handleTransfer(row)}>
                      이동 초안
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ReplenishmentSkuDrawer skuId={detailSkuId} onOpenChange={(open) => { if (!open) setDetailSkuId(null); }} />
    </>
  );
}
```

- [ ] **Step 4: 드로어**

```tsx
// apps/admin-web/src/features/inventory/replenishment/components/sku-drawer/index.tsx
'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useReplenishmentSku } from '@/lib/services/inventory';
import type { CompanyAxisDto, SellableAxisDto } from '@/lib/types/dto/inventory';
import { FLAG_LABELS, summarizeActions } from '../../suggestion-model';

type Props = { skuId: string | null; onOpenChange: (open: boolean) => void };

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AxisBlock({ title, axis }: { title: string; axis: CompanyAxisDto | SellableAxisDto }) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <Row label="재고 위치" value={axis.position} />
      <Row label="보유" value={axis.onHand} />
      <Row label="확정 예약" value={axis.reserved} />
      {'inTransfer' in axis && <Row label="운송중(전사)" value={axis.inTransfer} />}
      {'onOrder' in axis && <Row label="발주잔량(전사)" value={axis.onOrder} />}
      {'inTransit' in axis && <Row label="이동중(도착 예정)" value={axis.inTransit} />}
      {'onOrderDirect' in axis && <Row label="직행 발주잔량" value={axis.onOrderDirect} />}
      <Row label="안전재고" value={axis.safetyStock} />
      <Row label="재주문점" value={axis.reorderPoint} />
      <Row label="목표 수준" value={axis.targetLevel} />
      <Row label="리드타임(일)" value={axis.leadTimeDays} />
      {'daysOfCover' in axis && <Row label="예상 커버(일)" value={axis.daysOfCover ?? '—'} />}
    </div>
  );
}

export function ReplenishmentSkuDrawer({ skuId, onOpenChange }: Props) {
  const { data, isLoading } = useReplenishmentSku(skuId);
  return (
    <Sheet open={!!skuId} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{data ? `${data.skuName} (${data.skuCode})` : '보충 판정'}</SheetTitle>
        </SheetHeader>
        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground">로딩 중...</p>
        ) : (
          <div className="space-y-4">
            <div className="space-x-1">
              <Badge variant="secondary">{data.pattern}</Badge>
              <Badge variant="secondary">등급 {data.grade}</Badge>
              {data.flags.map((flag) => (
                <Badge key={flag} variant="outline">{FLAG_LABELS[flag]}</Badge>
              ))}
            </div>
            <Row label="제안" value={summarizeActions(data)} />
            <Row label="공급사" value={data.supplier?.name ?? '미정'} />
            <Row label="레거시 재주문점" value={data.legacyReorderPoint} />
            <Row label="일평균 수요" value={data.demand.dailyMean} />
            <Separator />
            <AxisBlock title="전사 축 (발주 판정)" axis={data.company} />
            <Separator />
            <AxisBlock title="판매창고 축 (이동 판정)" axis={data.sellable} />
            <p className="text-xs text-muted-foreground">
              이 단계의 안전재고는 SKU 에 입력된 정적값입니다. 수요 통계 기반 계산은 다음 단계에서 들어옵니다.
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 5: 템플릿과 페이지**

```tsx
// apps/admin-web/src/features/inventory/replenishment/template/index.tsx
'use client';

import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { ReplenishmentTable } from '../components/table';

export default function ReplenishmentTemplate() {
  return (
    <Container>
      <Header
        title="보충 제안"
        subtitle="판매 창고 부족은 이동으로, 전사 부족은 발주로. 발주잔량·이동중·중국 재고를 반영합니다."
      />
      <ReplenishmentTable />
    </Container>
  );
}
```

```tsx
// apps/admin-web/src/app/(admin)/inventory/replenishment/page.tsx
import { Suspense } from 'react';
import RouteGuard from '@/components/layout/route-guard';
import ReplenishmentTemplate from '@/features/inventory/replenishment/template';

export default function InventoryReplenishmentPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
        <Suspense>
          <ReplenishmentTemplate />
        </Suspense>
      </div>
    </RouteGuard>
  );
}
```

- [ ] **Step 6: 타입체크 · 테스트**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: `cart-drawer/index.tsx` 오류만 남음 (Task 13)
Run: `npm run test:admin-web`
Expected: 실패 0

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/features/inventory/replenishment "apps/admin-web/src/app/(admin)/inventory/replenishment" apps/admin-web/src/lib/utils/menu.ts apps/admin-web/src/lib/utils/menu.spec.ts
git commit -m "feat(admin-web): 보충 제안 페이지 — 발주·이동 제안 표, SKU 판정 드로어, 메뉴 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 13: admin-web — 카트 드로어의 "재발주 추천" 탭 제거

**Files:**
- Modify: `apps/admin-web/src/features/inventory/purchase-orders/components/cart-drawer/index.tsx`

- [ ] **Step 1: 제거**

- import 에서 `useReorderSuggestions` · `useWarehouses` · `Select*` · `Plus` 를 지운다(다른 곳에서 안 쓰이면).
- `reorderWarehouseId` state, `suggestions` 쿼리, `handleAddSuggestionToCart` 함수를 지운다.
- `<TabsTrigger value="reorder">` 와 `<TabsContent value="reorder">` 블록을 지운다. 탭이 하나만 남으면 `Tabs` 를 걷어내고 카트 내용만 남겨도 된다 — 더 단순한 쪽을 택한다.
- 카트 탭 하단(또는 헤더)에 링크 한 줄을 둔다:

```tsx
import Link from 'next/link';
// ...
<p className="text-xs text-muted-foreground">
  재발주 추천은 <Link href="/inventory/replenishment" className="underline">보충 제안</Link> 페이지로 옮겼습니다.
</p>
```

- [ ] **Step 2: 게이트**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 에러 0
Run: `npm run test:admin-web`
Expected: 실패 0

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/features/inventory/purchase-orders/components/cart-drawer/index.tsx
git commit -m "refactor(admin-web): 카트 드로어의 재발주 추천 탭 제거 — 보충 제안 페이지로 (#743)

Claude-Session: https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED"
```

---

### Task 14: 전체 게이트 · 이슈 갱신 · PR

- [ ] **Step 1: 세 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
cd apps/admin-web && npx tsc --noEmit && cd ../..
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "replenishment|inbound-pipeline|warehouse-transfer.reader"
```

Expected: 전부 0 실패.

- [ ] **Step 2: 로컬 스모크 (사람 확인용, 결과를 PR 본문에 적는다)**

`npm run start:main:dev` 와 `npm run start:admin-web:dev` 를 띄우고:
1. `/inventory/replenishment` 가 열리고 표가 뜬다(판매 창고가 하나가 아니면 409 문구가 보인다).
2. 행 클릭 → 드로어에 두 축이 보인다.
3. 발주 제안 행에서 "카트" → 발주 카트에 들어간다.
4. 이동 제안 행에서 "이동 초안" → `transfer_orders` 에 draft 가 생기고, 새로고침하면 그 SKU 의 이동 제안 수량이 줄어 있다.
5. 발주관리 카트 드로어에 "재발주 추천" 탭이 없다.

- [ ] **Step 3: 이슈 #743 코멘트**

```bash
gh issue comment 743 --body "$(cat <<'EOF'
C 단계(본체) 구현 브랜치 `feat/743-replenishment-stage-c`.

- 새 모듈 `inventory/replenishment/` — 전사 축(발주) · 판매 창고 축(이동) 두 판정, 파이프라인 ①②③ + 전 창고 발주잔량 + draft 지시서 차감 반영
- `GET /replenishment/suggestions` · `GET /replenishment/skus/:skuId` 신설. `GET /purchase-orders/suggestions/reorder` · `GET /inventory/below-safety-stock` · `SafetyStockService` 삭제
- admin-web `/inventory/replenishment` 페이지(카트 담기 · 이동 초안), 카트 드로어의 재발주 추천 탭 제거
- 안전재고는 이 단계에서 `skus.safety_stock` 정적값(행마다 `legacy_only`). 수요 통계·규칙은 A+B 단계(스펙 §9)
- 마이그레이션 0. 설계: `docs/superpowers/specs/2026-09-08-replenishment-suggestion-design.md`
EOF
)"
```

- [ ] **Step 4: PR**

```bash
git push -u origin feat/743-replenishment-stage-c
gh pr create --base develop --title "feat(replenishment): 재고 보충 제안 — 발주·이동 두 축, 파이프라인 반영, 옛 API 삭제 (#743 C 단계)" --body "$(cat <<'EOF'
## 무엇

이슈 #743 의 C 단계(스펙 §9). 마이그레이션 0.

- `inventory/replenishment/` 신설 — `assembleSuggestions`(순수) 가 전사 축 · 판매 창고 축을 독립 판정
- 재료: 원장(ON_HAND/IN_TRANSFER × 판매창고여부) · 확정 예약 · 파이프라인(①②③ + `onOrderTotalQty`) · draft 이동 지시서 planned
- 삭제: `ReorderSuggestionReader`(안전재고 10 · 20−현재고 하드코딩) · `SafetyStockService`(두 번째 답)
- admin-web: `/inventory/replenishment` 페이지, 카트 드로어 재발주 탭 제거

## 왜 지금

재발주 오판(중국 재고 무시)은 사람이 발주를 시작하는 첫날 발생한다. 통계 층(A+B) 없이도 이 단계가 그 사고를 막는다.

## 안 한 것

- 안전재고 계산(수요 프로필 · 규칙) — A+B 단계. 지금은 `skus.safety_stock` 정적값이고 행마다 `legacy_only` 플래그
- 🔴 라이브 확정 예약 허수(94%) 청소 — 선행조건, 이 PR 대상 아님. 청소 전엔 발주 제안이 과대

## 배포

core 와 admin-web 이 한 스택. 옛 라우트 삭제 + 새 라우트 추가가 같은 배포에 실려 잠깐 한쪽이 404 를 볼 수 있다(읽기 전용 페이지).

## 검증

- `npm run type-check` 0 · `npx jest --maxWorkers=2` 0 · admin-web tsc 0
- 통합 스펙: `replenishment-stock.reader` · `replenishment-suggestion`(3장면) · `warehouse-transfer.reader` · `inbound-pipeline`
- 로컬 스모크 5항목: (결과 기입)

https://claude.ai/code/session_01Y5Bthz8rSpjhTgrZTzGBED
EOF
)"
```

---

## Self-Review (작성자가 수행)

**Spec coverage (C 행 기준):**
- 모듈 골격 → Task 7. 두 축 판정 → Task 2 · 6. 파이프라인 배선(`onOrderTotalQty` · `findDraftPlannedBySku`) → Task 3 · 4. 옛 API 둘 삭제 → Task 8. 제안 목록 화면 교체 → Task 10~13. 자리표시 규칙(정적 안전재고 · `legacy_only` · demand 0 · daysOfCover null · 정렬) → Task 2. 응답 모양(§7.3) → Task 6 DTO. API 라우트·스코프(§7.4) → Task 7. 아키텍처 스펙(§10) → Task 9. 판매 창고 하나 전제(§7.2) → Task 5 `findSingleSellableWarehouseId`.
- 스펙에 없었지만 실행에 필요해 더한 것: 이동 제안의 `lines[{fromLocationId, quantity}]` (이동 지시서 API 가 로케이션을 요구). 스펙 §7.2 · §7.3 에 반영해 이 플랜과 같은 커밋에 넣었다.

**Placeholder scan:** 없음. Task 3 Step 1 · Task 8 Step 2 · Task 13 Step 1 은 기존 파일의 정확한 위치를 실행자가 확인해야 하는 수정이라 지시문 형태이지만, 지울 식별자와 남길 문장을 전부 명시했다.

**Type consistency:** `SkuStockInput` 필드명(Task 2) = Task 6 의 매핑 · `InboundPipelineRow.onOrderTotalQty`(Task 3) = Task 6 `pipe?.onOrderTotalQty` · `findDraftPlannedBySku(tx, skuIds)`(Task 4) = Task 6 호출 · `ReplenishmentSuggestionRowDto` 필드(Task 6) = admin-web 타입(Task 10) = 모델 스펙 픽스처(Task 11). `SuggestionActionDto` 는 core 에서는 optional 필드 클래스, admin-web 에서는 판별 유니온 — 와이어 포맷은 같다.
