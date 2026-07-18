# 스토어 표시상태 V2 재배선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 고객 주문 화면의 대표 이행 상태(`StoreFulfillmentStatus`)를 5단계로 단순화하고, 출고 전은 FO·출고 후는 shipment 소스에서 정확히 도출하도록 재배선한다.

**Architecture:** 도출 로직을 DB 접근이 없는 순수 함수 모듈(`fulfillment-phase.ts`)로 분리한다. 서비스는 FO 행 + (필요 시) 활성 상자 상태만 로드해 `FulfillmentPhaseInput` 을 만들고 순수 함수를 호출한다. "출고 이동한 상자는 dispatch 트랜잭션에서 반드시 FO 를 `partially_shipped`/`completed` 로 만든다"는 원자성 덕분에, FO 상태에 출고 흔적이 없으면 상자 로딩을 건너뛴다(대부분의 준비중 주문).

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), Jest. 참조 스펙: `docs/superpowers/specs/2026-07-18-store-fulfillment-status-v2-rewire-design.md`.

## Global Constraints

- 대상 파일은 `apps/core/src/modules/sales-order/` 하위. 레이어 규칙: 순수 도출은 module-scope 함수(`deriveOverallTrackingStatus` 선례), DB 접근은 서비스.
- `StoreFulfillmentStatus` 최종값: `'not_created' | 'preparing' | 'shipping' | 'delivered' | 'canceled'` (이 5개만).
- 상자 status→단계: `draft`/`planned`/`recovery_required`→준비, `shipped`/`in_transit`→배송중, `delivered`→배송완료. 직배 `directShipStatus`: `pending`→준비, `forwarded`→배송중, `completed`→배송완료, `canceled`→제외.
- 대표 상태 합의 규칙: 모든 활성 유닛 delivered → `delivered`; 하나 이상 이동(배송중/완료) → `shipping`; 그 외 → `preparing`.
- 취소 정책(사용자 결정): 하나라도 출고되면 셀프 취소 불가(`already_shipped`), 피킹 시작(FO `processing`) 후 셀프 취소 불가(`already_processing`).
- raw SQL 조인은 기존 `hasV2OutstandingShipment` 스타일(`this.db.db.execute(sql\`...\`)`)을 따른다.
- TDD: 실패 테스트 먼저 → 최소 구현 → 통과 → 커밋. 커밋은 브랜치 `fix/outbound-v2-followup` 에.

---

### Task 1: 순수 도출 모듈 + DTO 계약 변경

**Files:**
- Modify: `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts` (enum 축소 + `ShipmentProgressDto` + 필드)
- Create: `apps/core/src/modules/sales-order/services/fulfillment-phase.ts` (순수 함수 + 입력 타입)
- Test: `apps/core/src/modules/sales-order/services/fulfillment-phase.spec.ts`

**Interfaces:**
- Produces:
  - `type StoreFulfillmentStatus = 'not_created' | 'preparing' | 'shipping' | 'delivered' | 'canceled'`
  - `class ShipmentProgressDto { total: number; shipped: number; delivered: number }`
  - `interface PhaseFoRow { status: string; directShipStatus: string | null; fulfillmentMode: string | null }`
  - `interface FulfillmentPhaseInput { foCount: number; allFoCanceled: boolean; activeShipmentStatuses: string[]; dropShipStatuses: string[]; anyFoiShipped: boolean }`
  - `interface FulfillmentPhaseResult { phase: StoreFulfillmentStatus; progress: ShipmentProgressDto }`
  - `function deriveFulfillmentPhase(input: FulfillmentPhaseInput): FulfillmentPhaseResult`
  - `function isPickingStarted(fos: { status: string }[]): boolean`
  - `function hasShippedEvidence(input: FulfillmentPhaseInput): boolean`

- [ ] **Step 1: DTO enum + ShipmentProgressDto 변경**

`store-order-actions.dto.ts` 에서 `StoreFulfillmentStatus` 정의(현재 8값)를 교체하고 `ShipmentProgressDto` 를 추가한다.

교체 전(제거):
```typescript
export type StoreFulfillmentStatus =
  | 'not_created'
  | 'awaiting_matching'
  | 'created'
  | 'picking'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'canceled';
```
교체 후:
```typescript
export type StoreFulfillmentStatus =
  | 'not_created' // FO 없음 = 결제완료·출고대기
  | 'preparing' // 상품 준비 중 (예약/피킹/패킹/복구 흡수)
  | 'shipping' // 배송 중 (하나 이상 상자 이동)
  | 'delivered' // 배송 완료 (모든 활성 상자 배송완료)
  | 'canceled'; // 이행 취소 (모든 FO canceled)
```
`RefundSummaryDto` 클래스 정의 바로 앞에 추가:
```typescript
export class ShipmentProgressDto {
  @ApiProperty({ description: '활성 상자 수 (canceled/superseded 제외)' })
  total: number;

  @ApiProperty({ description: '이동한 상자 수 (배송중+배송완료)' })
  shipped: number;

  @ApiProperty({ description: '배송완료 상자 수' })
  delivered: number;
}
```
`StoreOrderActionsResponseDto` 의 `fulfillmentStatus` `@ApiProperty` enum 배열(현재 `['not_created','awaiting_matching','created','picking','packed','shipped','delivered','canceled']`)을 `['not_created','preparing','shipping','delivered','canceled']` 로 바꾸고, `fulfillmentStatus` 필드 바로 아래에 추가:
```typescript
  @ApiPropertyOptional({ type: ShipmentProgressDto, description: '분할/합배송 진행 요약 (활성 상자 0개면 생략)' })
  shipmentProgress?: ShipmentProgressDto;
```

- [ ] **Step 2: fulfillment-phase.spec.ts 실패 테스트 작성**

`fulfillment-phase.spec.ts` 생성:
```typescript
import { deriveFulfillmentPhase, isPickingStarted, hasShippedEvidence, FulfillmentPhaseInput } from './fulfillment-phase';

function input(over: Partial<FulfillmentPhaseInput> = {}): FulfillmentPhaseInput {
  return { foCount: 1, allFoCanceled: false, activeShipmentStatuses: [], dropShipStatuses: [], anyFoiShipped: false, ...over };
}

describe('deriveFulfillmentPhase', () => {
  it('FO 없음 → not_created', () => {
    expect(deriveFulfillmentPhase(input({ foCount: 0 })).phase).toBe('not_created');
  });
  it('모든 FO canceled → canceled', () => {
    expect(deriveFulfillmentPhase(input({ allFoCanceled: true })).phase).toBe('canceled');
  });
  it('FO 있고 활성 유닛 0 → preparing', () => {
    expect(deriveFulfillmentPhase(input()).phase).toBe('preparing');
  });
  it('단일 상자 draft → preparing', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['draft'] })).phase).toBe('preparing');
  });
  it('단일 상자 shipped → shipping', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['shipped'] })).phase).toBe('shipping');
  });
  it('단일 상자 delivered → delivered', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered'] })).phase).toBe('delivered');
  });
  it('분할: A shipped·B preparing → shipping + progress{2,1,0}', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['shipped', 'planned'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 1, delivered: 0 });
  });
  it('분할: A delivered·B shipped → shipping + progress{2,2,1}', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered', 'shipped'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 2, delivered: 1 });
  });
  it('전량 배송완료 → delivered + progress{2,2,2}', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['delivered', 'delivered'] }));
    expect(r.phase).toBe('delivered');
    expect(r.progress).toEqual({ total: 2, shipped: 2, delivered: 2 });
  });
  it('recovery_required 상자는 준비중으로 숨김', () => {
    expect(deriveFulfillmentPhase(input({ activeShipmentStatuses: ['recovery_required'] })).phase).toBe('preparing');
  });
  it('직배 forwarded → shipping', () => {
    expect(deriveFulfillmentPhase(input({ dropShipStatuses: ['forwarded'] })).phase).toBe('shipping');
  });
  it('직배 completed → delivered', () => {
    expect(deriveFulfillmentPhase(input({ dropShipStatuses: ['completed'] })).phase).toBe('delivered');
  });
  it('혼합: 창고 preparing + 직배 forwarded → shipping', () => {
    const r = deriveFulfillmentPhase(input({ activeShipmentStatuses: ['draft'], dropShipStatuses: ['forwarded'] }));
    expect(r.phase).toBe('shipping');
    expect(r.progress).toEqual({ total: 2, shipped: 1, delivered: 0 });
  });
});

describe('isPickingStarted', () => {
  it('FO processing 있으면 true', () => {
    expect(isPickingStarted([{ status: 'ready' }, { status: 'processing' }])).toBe(true);
  });
  it('processing 없으면 false', () => {
    expect(isPickingStarted([{ status: 'ready' }, { status: 'partially_reserved' }])).toBe(false);
  });
});

describe('hasShippedEvidence', () => {
  it('상자 이동(shipped) → true', () => {
    expect(hasShippedEvidence(input({ activeShipmentStatuses: ['shipped'], anyFoiShipped: true }))).toBe(true);
  });
  it('직배 forwarded → true', () => {
    expect(hasShippedEvidence(input({ dropShipStatuses: ['forwarded'] }))).toBe(true);
  });
  it('anyFoiShipped=true → true', () => {
    expect(hasShippedEvidence(input({ anyFoiShipped: true }))).toBe(true);
  });
  it('준비중만 → false', () => {
    expect(hasShippedEvidence(input({ activeShipmentStatuses: ['draft', 'planned'] }))).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx jest --testPathPattern=fulfillment-phase.spec -c apps/core`
Expected: FAIL — `Cannot find module './fulfillment-phase'`

- [ ] **Step 4: fulfillment-phase.ts 구현**

```typescript
import { StoreFulfillmentStatus, ShipmentProgressDto } from '../dto/store-order-actions.dto';

export interface PhaseFoRow {
  status: string;
  directShipStatus: string | null;
  fulfillmentMode: string | null;
}

export interface FulfillmentPhaseInput {
  foCount: number;
  allFoCanceled: boolean;
  /** canceled/superseded 제외한 상자 status 목록 */
  activeShipmentStatuses: string[];
  /** 직배(drop_ship) FO 의 directShipStatus (canceled 제외; 상자 없음) */
  dropShipStatuses: string[];
  /** FO 가 출고 흔적(partially_shipped/completed/shipped)을 가지는가 = FOI shippedQty>0 */
  anyFoiShipped: boolean;
}

export interface FulfillmentPhaseResult {
  phase: StoreFulfillmentStatus;
  progress: ShipmentProgressDto;
}

type UnitPhase = 'preparing' | 'shipping' | 'delivered';

const MOVED_SHIPMENT_STATUSES = new Set(['shipped', 'in_transit', 'delivered']);
const MOVED_DROPSHIP_STATUSES = new Set(['forwarded', 'completed']);

function shipmentUnitPhase(status: string): UnitPhase {
  if (status === 'delivered') return 'delivered';
  if (status === 'shipped' || status === 'in_transit') return 'shipping';
  return 'preparing'; // draft, planned, recovery_required
}

function dropShipUnitPhase(status: string): UnitPhase {
  if (status === 'completed') return 'delivered';
  if (status === 'forwarded') return 'shipping';
  return 'preparing'; // pending
}

/**
 * 대표 이행 상태 + 진행 요약. 순수 함수 — DB 접근 없음.
 * 합의(consensus) 규칙: 모든 활성 유닛 delivered → delivered; 하나라도 이동 → shipping; 그 외 preparing.
 */
export function deriveFulfillmentPhase(input: FulfillmentPhaseInput): FulfillmentPhaseResult {
  const empty: ShipmentProgressDto = { total: 0, shipped: 0, delivered: 0 };
  if (input.foCount === 0) return { phase: 'not_created', progress: empty };
  if (input.allFoCanceled) return { phase: 'canceled', progress: empty };

  const units: UnitPhase[] = [
    ...input.activeShipmentStatuses.map(shipmentUnitPhase),
    ...input.dropShipStatuses.map(dropShipUnitPhase),
  ];
  if (units.length === 0) return { phase: 'preparing', progress: empty };

  const delivered = units.filter((u) => u === 'delivered').length;
  const shipped = units.filter((u) => u === 'delivered' || u === 'shipping').length;
  const progress: ShipmentProgressDto = { total: units.length, shipped, delivered };

  if (units.every((u) => u === 'delivered')) return { phase: 'delivered', progress };
  if (shipped > 0) return { phase: 'shipping', progress };
  return { phase: 'preparing', progress };
}

/** 피킹/패킹 시작 여부 = FO status 'processing' (fulfillment-progress: "picking/packing/inspection has begun") */
export function isPickingStarted(fos: { status: string }[]): boolean {
  return fos.some((fo) => fo.status === 'processing');
}

/** 하나라도 출고 증거가 있는가 (부분 출고 포함) */
export function hasShippedEvidence(input: FulfillmentPhaseInput): boolean {
  if (input.anyFoiShipped) return true;
  if (input.activeShipmentStatuses.some((s) => MOVED_SHIPMENT_STATUSES.has(s))) return true;
  if (input.dropShipStatuses.some((s) => MOVED_DROPSHIP_STATUSES.has(s))) return true;
  return false;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx jest --testPathPattern=fulfillment-phase.spec -c apps/core`
Expected: PASS (all)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts \
        apps/core/src/modules/sales-order/services/fulfillment-phase.ts \
        apps/core/src/modules/sales-order/services/fulfillment-phase.spec.ts
git commit -m "feat(store-order): 이행 상태 도출 순수 모듈 + 5단계 DTO 계약

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: buildActionsView 표시 경로 재배선

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts`
- Test: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: `deriveFulfillmentPhase`, `isPickingStarted`, `hasShippedEvidence`, `PhaseFoRow`, `FulfillmentPhaseInput` (Task 1).
- Produces (Task 3 도 재사용):
  - `private loadFoRows(salesOrderId: string): Promise<PhaseFoRow[]>`
  - `private loadFulfillmentPhaseInput(salesOrderId: string, foRows: PhaseFoRow[]): Promise<FulfillmentPhaseInput>`
  - `private loadActiveShipmentStatuses(salesOrderId: string): Promise<string[]>`
  - `buildActionsView` 가 `fulfillmentStatus`(5값) + `shipmentProgress` 를 반환.

- [ ] **Step 1: 서비스 spec mock 을 execute 기반 상자 상태에 대응하도록 수정 (실패 유도)**

`store-sales-orders.service.spec.ts` 의 `makeContext` 를 수정한다. (1) `fos` 픽스처에 `directShipStatus`/`fulfillmentMode` 기본값 추가, (2) `execute` mock 이 활성 상자 상태 행을 돌려주도록 옵션 추가, (3) 옵션 타입에서 `v2Outstanding` 제거하고 `activeShipmentStatuses` 추가.

`makeContext` 옵션 타입 교체:
```typescript
  options: {
    so?: ReturnType<typeof makeSo>;
    fos?: { status: string; directShipStatus?: string | null; fulfillmentMode?: string | null }[];
    activeShipmentStatuses?: string[];
    walletOutcome?: WalletRefundOutcome;
    cancelError?: Error;
    businessLinkError?: Error;
    cancellationReplay?: boolean;
    replayError?: Error;
  } = {},
```
`fos` 정규화 (기본 direct/mode 채움):
```typescript
  const fos = (options.fos ?? []).map((fo) => ({
    directShipStatus: null,
    fulfillmentMode: null,
    shippedAt: null,
    ...fo,
  }));
```
`execute` mock 교체 (활성 상자 status 행 반환):
```typescript
      execute: jest.fn().mockResolvedValue(
        (options.activeShipmentStatuses ?? []).map((status) => ({ id: `sh-${status}`, status })),
      ),
```
그리고 `.then()` 이 `fos` 를 돌려주는 부분(현재 89행)은 그대로 두되, `fos` 에 direct/mode 필드가 포함되도록 위 정규화가 반영되게 한다. `deriveFulfillmentStatus`(picking) 를 기대하던 기존 테스트(라인 289/504 는 Task 3 에서 다룸)를 제외하고, 표시 관련 기대값을 5값으로 갱신할 준비를 한다.

- [ ] **Step 2: 표시 경로 기대 테스트 추가 (실패 확인)**

`store-sales-orders.service.spec.ts` 의 `describe('StoreSalesOrdersService')` 안에 추가:
```typescript
  describe('buildActionsView fulfillmentStatus (V2)', () => {
    it('FO 없음 → not_created', async () => {
      const { service } = makeContext({ fos: [] });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.fulfillmentStatus).toBe('not_created');
    });
    it('FO ready, 상자 미로드 → preparing', async () => {
      const { service } = makeContext({ fos: [{ status: 'ready' }] });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.fulfillmentStatus).toBe('preparing');
      expect(r.availableActions).toContain('cancel');
    });
    it('FO processing → preparing + already_processing (셀프취소 불가)', async () => {
      const { service } = makeContext({ fos: [{ status: 'processing' }] });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.fulfillmentStatus).toBe('preparing');
      expect(r.availableActions).not.toContain('cancel');
      expect(r.cancelUnavailableReason).toBe('already_processing');
    });
    it('FO partially_shipped + 상자 shipped → shipping + already_shipped', async () => {
      const { service } = makeContext({ fos: [{ status: 'partially_shipped' }], activeShipmentStatuses: ['shipped', 'draft'] });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.fulfillmentStatus).toBe('shipping');
      expect(r.shipmentProgress).toEqual({ total: 2, shipped: 1, delivered: 0 });
      expect(r.availableActions).not.toContain('cancel');
      expect(r.cancelUnavailableReason).toBe('already_shipped');
    });
    it('FO completed + 상자 전량 delivered → delivered + 반품/교환 노출', async () => {
      const { service } = makeContext({ fos: [{ status: 'completed' }], activeShipmentStatuses: ['delivered'] });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r.fulfillmentStatus).toBe('delivered');
      expect(r.availableActions).toEqual(expect.arrayContaining(['return', 'exchange']));
    });
  });
```
(진입 public 메서드: `getActionsByChannelOrder(channelOrderId, customerId)` — `store-sales-orders.service.ts:404`, `buildActionsView` 호출. by-id 경로는 `getActions(orderId, customerId)`.)

Run: `npx jest --testPathPattern=store-sales-orders.service.spec -c apps/core`
Expected: FAIL (신규 표시 기대값이 아직 구 로직과 불일치)

- [ ] **Step 3: 상수/도출 함수 제거 + 로더 추가 + buildActionsView 재배선**

`store-sales-orders.service.ts` 상단 import 에 추가:
```typescript
import {
  deriveFulfillmentPhase,
  isPickingStarted,
  hasShippedEvidence as hasShippedEvidenceFrom,
  PhaseFoRow,
  FulfillmentPhaseInput,
} from './fulfillment-phase';
```
`ShipmentProgressDto` 를 DTO import 에 추가.

상수 4개(`FO_DELIVERED_STATUSES`/`FO_SHIPPED_STATUSES`/`FO_PACKED_STATUSES`/`FO_PICKING_STATUSES`, 현재 `:42-45`) 삭제. `type FoRow`(`:29`) 삭제(이후 `PhaseFoRow` 사용).

`buildActionsView` 의 FO 로드(현재 `:474-483`)를 교체:
```typescript
    const foRows = await this.loadFoRows(so.id);
    const phaseInput = await this.loadFulfillmentPhaseInput(so.id, foRows);
    const { phase: fulfillmentStatus, progress } = deriveFulfillmentPhase(phaseInput);
    const shipmentProgress = progress.total > 0 ? progress : undefined;
    const hasShippedEvidence = hasShippedEvidenceFrom(phaseInput);
    const isChannelOrder = so.salesChannel !== 'medusa';
```
표시 취소 게이트(현재 `:617`)를 교체:
```typescript
    } else if (isPickingStarted(foRows)) {
      // 피킹 시작 이후 고객 셀프 취소 불가 — 고객센터 문의 안내
      availableActions.push('receipt');
      cancelUnavailableReason = 'already_processing';
```
DTO 반환 객체(현재 `:626-635` 부근)에 `shipmentProgress` 추가:
```typescript
    return {
      orderId: so.id,
      channelOrderId: so.channelOrderId,
      orderStatus: so.status,
      fulfillmentStatus,
      shipmentProgress,
      refundStatus,
      refundSummary,
      claimStatus,
      availableActions,
      // ...(이하 기존 필드 유지)
```
`buildActionsView` 안 `hasShippedEvidence` 를 쓰던 분기(현재 `:576` `else if (hasShippedEvidence)`)는 지역 변수명이 동일하므로 그대로 동작. `deriveFulfillmentStatus`(`:993`)와 `hasShippedEvidence`(`:1005`) 구 메서드는 삭제.

로더 세 개를 `buildActionsView` 아래(private 영역)에 추가:
```typescript
  private async loadFoRows(salesOrderId: string): Promise<PhaseFoRow[]> {
    return this.db.db
      .select({
        status: inventoryTables.fulfillmentOrders.status,
        directShipStatus: inventoryTables.fulfillmentOrders.directShipStatus,
        fulfillmentMode: inventoryTables.fulfillmentOrders.fulfillmentMode,
      })
      .from(inventoryTables.fulfillmentOrders)
      .where(eq(inventoryTables.fulfillmentOrders.salesOrderId, salesOrderId));
  }

  private async loadFulfillmentPhaseInput(salesOrderId: string, foRows: PhaseFoRow[]): Promise<FulfillmentPhaseInput> {
    const foCount = foRows.length;
    const allFoCanceled = foCount > 0 && foRows.every((fo) => fo.status === 'canceled');
    const dropShipStatuses = foRows
      .filter((fo) => fo.fulfillmentMode === 'drop_ship' && fo.directShipStatus != null && fo.directShipStatus !== 'canceled')
      .map((fo) => fo.directShipStatus as string);

    // 출고 이동 상자는 dispatch 트랜잭션에서 반드시 FO 를 partially_shipped/completed/shipped 로 만든다.
    // 그 흔적이 없으면 활성 상자는 전부 준비중이므로 상자 로드를 생략한다.
    const anyFoiShipped = foRows.some(
      (fo) => fo.status === 'shipped' || fo.status === 'partially_shipped' || fo.status === 'completed',
    );
    const activeShipmentStatuses = anyFoiShipped ? await this.loadActiveShipmentStatuses(salesOrderId) : [];

    return { foCount, allFoCanceled, activeShipmentStatuses, dropShipStatuses, anyFoiShipped };
  }

  private async loadActiveShipmentStatuses(salesOrderId: string): Promise<string[]> {
    const rows = await this.db.db.execute(sql`
      SELECT DISTINCT s.id, s.status
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
       WHERE fo.sales_order_id = ${salesOrderId}
         AND s.status NOT IN ('canceled', 'superseded')
    `);
    return Array.from(rows as unknown as ArrayLike<{ status: string }>).map((r) => r.status);
  }
```

- [ ] **Step 4: 표시 경로 테스트 통과 확인**

Run: `npx jest --testPathPattern=store-sales-orders.service.spec -c apps/core -t "fulfillmentStatus (V2)"`
Expected: PASS (신규 describe 블록). 이 시점에 `processCancelRequest` 관련 기존 테스트(picking)는 아직 실패할 수 있음 — Task 3 에서 처리.

- [ ] **Step 5: 타입/빌드 확인**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 성공 (제거된 상수/메서드/타입 참조 없음). 남은 참조 오류가 있으면 해당 라인을 새 헬퍼로 교체 후 재실행.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/store-sales-orders.service.ts \
        apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts
git commit -m "feat(store-order): buildActionsView 를 V2 상자 기준 도출로 재배선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: processCancelRequest 취소 게이트 재배선

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts`
- Test: `apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: `loadFulfillmentPhaseInput`, `isPickingStarted`, `hasShippedEvidence` (Task 1·2).
- Produces: `processCancelRequest` 가 §5c 정책으로 셀프 취소를 게이팅; `hasV2OutstandingShipment` 삭제.

- [ ] **Step 1: 취소 게이트 테스트 갱신/추가 (실패 확인)**

`store-sales-orders.service.spec.ts` 에서 `fos: [{ status: 'picking', ... }]` 를 기대하던 기존 테스트(현재 라인 289·504 부근)를 V2 값으로 교체하고 케이스를 보강한다. 교체 예:
```typescript
    it('피킹 시작(FO processing) 주문은 셀프 취소 시 400', async () => {
      const { service, salesOrdersServiceMock } = makeContext({ fos: [{ status: 'processing' }] });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '피킹이 시작된',
      );
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
    });
    it('부분 출고(상자 shipped) 주문은 셀프 취소 시 400', async () => {
      const { service, salesOrdersServiceMock } = makeContext({
        fos: [{ status: 'partially_shipped' }],
        activeShipmentStatuses: ['shipped', 'draft'],
      });
      await expect(service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {})).rejects.toThrow(
        '이미 출고',
      );
      expect(salesOrdersServiceMock.cancel).not.toHaveBeenCalled();
    });
    it('준비중(FO ready, 미피킹) 주문은 셀프 취소 성공', async () => {
      const { service, salesOrdersServiceMock } = makeContext({ fos: [{ status: 'ready' }] });
      const r = await service.cancelRequestByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID, {});
      expect(salesOrdersServiceMock.cancel).toHaveBeenCalled();
      expect(r.orderStatus).toBe('cancelled');
    });
```
Run: `npx jest --testPathPattern=store-sales-orders.service.spec -c apps/core`
Expected: FAIL (구 게이트가 `processing`/`partially_shipped` 를 다루지 못함, 또는 picking 픽스처 제거로 컴파일/기대 불일치)

- [ ] **Step 2: processCancelRequest 게이트 재작성 + hasV2OutstandingShipment 삭제**

`processCancelRequest` 의 FO 로드·게이트(현재 `:665-680`)를 교체 (Task 2 의 `loadFoRows`/`loadFulfillmentPhaseInput` 재사용):
```typescript
    const foRows = await this.loadFoRows(so.id);
    const phaseInput = await this.loadFulfillmentPhaseInput(so.id, foRows);
    if (hasShippedEvidenceFrom(phaseInput)) {
      throw new BadRequestException('이미 출고된 주문은 취소할 수 없습니다. 고객센터로 문의해 주세요.');
    }
    if (isPickingStarted(foRows)) {
      throw new BadRequestException('피킹이 시작된 주문은 직접 취소할 수 없습니다. 고객센터로 문의해 주세요.');
    }
```
`hasV2OutstandingShipment` private 메서드(현재 `:726-739`)를 삭제한다. (execute 는 이제 `loadActiveShipmentStatuses` 만 사용.)

- [ ] **Step 3: 취소 게이트 테스트 통과 확인**

Run: `npx jest --testPathPattern=store-sales-orders.service.spec -c apps/core`
Expected: PASS (전체 파일)

- [ ] **Step 4: 스토어 전체 스펙 + 트래킹 통합 스펙 회귀 확인**

Run: `npx jest --testPathPattern="store-sales-orders.service.spec|store-order-tracking.integration.spec" -c apps/core`
Expected: PASS. (트래킹 스펙이 표시값 어휘 변화로 깨지면 5값 어휘로 기대 갱신 — 트래킹 자체 로직은 미변경이라 대개 무영향.)

- [ ] **Step 5: 타입/빌드 최종 확인**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: 성공 (`hasV2OutstandingShipment`·`FoRow`·구 상수 참조 0)

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/store-sales-orders.service.ts \
        apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts
git commit -m "feat(store-order): 셀프 취소 게이트를 V2 출고 증거/피킹 시작 기준으로 재배선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Post-implementation (범위 밖, 별도 조율)

- **외부 storefront**: `fulfillmentStatus` 소비 매핑을 5값으로 갱신(`awaiting_matching/created/picking/packed→preparing`, `shipped→shipping`), 신규 `shipmentProgress` 활용(선택). Core 와 배포 순서 조율. 이 저장소 범위 밖.
- **관찰 기록**: `cancelByWalletIntentAfterRefund`(`:219`)의 dead SO.status 출고 가드는 별건(스펙 §10).

## Self-Review (작성자 점검 결과)

- **스펙 커버리지**: §3 계약→Task 1 Step1; §4 도출→Task 1; §5a hasShippedEvidence→Task 1+2; §5b isPickingStarted→Task 1; §5c 취소 게이트→Task 3; §5d 반품/교환 게이트→Task 2 Step2(delivered 케이스, `:581` 미변경); §6 로더/short-circuit→Task 2 Step3; §8 정리(상수/메서드/타입 삭제)→Task 2·3. 누락 없음.
- **플레이스홀더**: 각 스텝에 실제 코드/명령/기대 포함. Task 2 Step2 의 public 진입 메서드명만 실제 이름 확인 지시를 남김(코드 확인 필요 지점).
- **타입 일관성**: `deriveFulfillmentPhase`/`isPickingStarted`/`hasShippedEvidence`/`PhaseFoRow`/`FulfillmentPhaseInput`/`ShipmentProgressDto` 시그니처가 Task 1 정의와 Task 2·3 사용에서 일치. 서비스는 `hasShippedEvidence` 를 `hasShippedEvidenceFrom` 별칭으로 import 해 지역 변수 `hasShippedEvidence` 와 충돌 회피.
