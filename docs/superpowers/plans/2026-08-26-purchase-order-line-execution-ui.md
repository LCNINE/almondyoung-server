# 발주 라인 실행 UI 구현 계획 (#724 항목 12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** admin-web 에 발주 라인별 실행/불가 기록 UI 를 붙여, 라이브에 배포돼 있으나 호출 경로가 없는 라인 생명주기 백엔드를 실제로 쓸 수 있게 한다.

**Architecture:** 발주 상세 드로어의 「발주 라인」 섹션을 라인 상태·실행 기록을 보여주는 목록으로 바꾸고, `requested` 라인에만 `[실행][불가]` 버튼을 달아 작은 다이얼로그를 연다. 입고 도메인의 기존 패턴(`inbound/components/line-action-menu/`)과 같은 구조다. 사실상 일괄 실행이던 「운영 상태 변경」 드롭다운은 제거하고, 헤더 상태는 라인에서 파생된 읽기 전용 표시로 남긴다. admin-web 은 `.tsx` 가 jest transform 밖이므로 모든 **판정 로직은 `.ts` 순수 함수로 분리**해 단위 테스트로 고정하고, `.tsx` 는 그 함수를 부르는 껍데기만 담는다.

**Tech Stack:** Next.js (App Router) · TypeScript · TanStack Query · shadcn/ui (Radix) · sonner · jest + ts-jest

**Spec:** [`docs/superpowers/specs/2026-08-25-purchase-order-line-lifecycle-design.md`](../specs/2026-08-25-purchase-order-line-lifecycle-design.md) — 이 계획은 그 스펙 §5 의 **PR 4 (admin-web — 라인 실행 UI, 상태 드롭다운 정리)** 를 구현한다. 스펙 §5 「변경」 절과 §7 단계표를 함께 읽을 것.

**이슈:** [#724 항목 12](https://github.com/LCNINE/almondyoung-server/issues/724)

## Global Constraints

- **범위는 `apps/admin-web` 뿐이다.** core 변경 0, 마이그레이션 0, SST 시크릿 0, 이벤트 계약 변경 0. 백엔드 라우트는 2026-08-26 05:00 KST 배포로 이미 라이브다.
- **배포 순서 제약 없음.** admin-web 단독 배포로 끝난다.
- 라인 상태 리터럴은 정확히 `'requested' | 'ordered' | 'unavailable'` 세 개다. 새 값을 만들지 말 것.
- 발주 헤더 상태는 `'created' | 'confirmed' | 'received'` 이고 **라인에서 파생된다**(core `refreshHeaderStatus`). 화면은 이 값을 **읽기만** 한다.
- **날짜는 `'YYYY-MM-DD'` 문자열로만 다룬다.** `new Date(v)` 왕복 금지 — 런타임 TZ 에 따라 달력 하루가 밀린다(#724 발견 ⑪ 와 같은 부류). 잘라낼 때는 `slice(0, 10)`.
  - 라인 `expectedArrival` 은 Postgres `date` 컬럼이라 API 응답에서 이미 `'2026-08-30'` 이다.
  - 헤더 `expectedArrival` 은 `timestamp` 라 JSON 에서 `'2026-08-30T00:00:00.000Z'` 로 온다.
- 서버 에러 문구는 새로 만들지 말고 `getServerDenyMessage`(`@/lib/api/server-error`)를 쓴다 — 403/409 를 이미 한국어로 감싼다.
- 토스트는 `sonner` 의 `toast`, 다이얼로그는 `@/components/ui/dialog`, 그 외 UI 는 `@/components/ui/*` 를 쓴다. 새 UI 라이브러리 도입 금지.
- 되돌릴 수 없는 액션(라인 실행·라인 불가)은 반드시 다이얼로그를 거치고 본문에 그 사실을 적는다.
- 게이트는 **셋 다 0** 이어야 한다:
  - `npm run type-check` (루트 — **admin-web 을 제외한다**)
  - `cd apps/admin-web && npx tsc --noEmit` (**admin-web 의 유일한 타입 게이트**)
  - `npx jest --maxWorkers=2` (루트 jest 는 `apps/**/*.spec.ts` 를 잡으므로 admin-web 순수 함수 스펙도 여기 포함된다)
- 커밋 메시지는 저장소 규약대로 한국어 conventional commit 이고, 본문 끝에 다음 줄을 붙인다:
  `Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud`

## 왜 이 순서인가

각 중간 커밋에서도 화면이 **서버가 거부할 동작을 제안하지 않아야** 한다. 그래서 모델·배선(1·2) → 다이얼로그(3) → 드로어 재배선(4) → 어긋난 기존 화면 정리(5·6·7) 순으로 간다. 4번이 일괄 확정 드롭다운을 지우는 커밋이고, 그 시점에 라인별 실행이 이미 붙어 있어 확정 수단이 끊기지 않는다.

---

### Task 1: 라인 실행 판정 모델 + 타입 미러

admin-web 의 `PurchaseOrderLineDto` 는 아직 라인 생명주기 이전 모델이라 화면이 라인 상태를 볼 수조차 없다. 이 태스크가 타입을 맞추고, 이후 모든 태스크가 쓸 판정 함수를 순수 함수로 만든다.

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts:1399-1461`
- Create: `apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.ts`
- Test: `apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.spec.ts`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable'`
  - `interface PurchaseOrderLineDto` — `status` / `orderedQty` / `expectedArrival` / `orderedAt` / `orderedBy` / `unavailableReason` 추가
  - `interface OrderPurchaseOrderLineRequest { orderedQty: number; unitPrice?: number; expectedArrival?: string }`
  - `interface MarkLineUnavailableRequest { reason?: string }`
  - `type LineProgress = { total: number; requested: number; ordered: number; unavailable: number }`
  - `summarizeLines(lines: PurchaseOrderLineDto[]): LineProgress`
  - `formatLineProgress(progress: LineProgress): string`
  - `sortLinesForExecution(lines: PurchaseOrderLineDto[]): PurchaseOrderLineDto[]`
  - `canExecuteLines(poStatus: PurchaseOrderStatus): boolean`
  - `isLineExecutable(poStatus: PurchaseOrderStatus, line: PurchaseOrderLineDto): boolean`
  - `toCalendarDate(value: string | null | undefined): string`
  - `orderDialogDefaults(po: PurchaseOrderDto, line: PurchaseOrderLineDto): OrderDialogDefaults`
  - `buildOrderLinePayload(values: OrderLineFormValues): OrderLinePayloadResult`
  - `partitionLinesForEdit(lines: PurchaseOrderLineDto[]): { editable: PurchaseOrderLineDto[]; closed: PurchaseOrderLineDto[] }`

- [ ] **Step 1: 타입 미러를 core 응답 DTO 에 맞춘다**

`apps/admin-web/src/lib/types/dto/inventory.ts` 에서 `PurchaseOrderLineDto` 를 아래로 교체하고, 바로 위에 `PurchaseOrderLineStatus` 를 추가한다. 근거는 core 의 `apps/core/src/modules/inventory/inbound/dto/purchase-order/purchase-order-response.dto.ts` 다.

```typescript
export type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable';

export interface PurchaseOrderLineDto {
  skuId: string;
  /** 요청 수량 — 실행이 덮어쓰지 않는다. 실제로 발주한 양은 orderedQty. */
  quantity: number;
  status: PurchaseOrderLineStatus;
  /** 실제로 발주한 수량. 아직 실행 전이거나 불가로 종결된 라인은 null. */
  orderedQty: number | null;
  unitPrice: number | null;
  /** 이 품목의 도착예정일. core 가 date 컬럼을 그대로 내보내므로 'YYYY-MM-DD' 다. */
  expectedArrival: string | null;
  /** 라인 실행(발주 또는 불가 종결)이 끝난 시각. ISO 문자열. */
  orderedAt: string | null;
  orderedBy: string | null;
  unavailableReason: string | null;
  sku?: {
    name: string;
    barcode: string | null;
  };
}
```

같은 파일의 발주 요청 타입 블록(`UpdatePurchaseOrderLinesRequest` 아래)에 두 개를 추가한다:

```typescript
export interface OrderPurchaseOrderLineRequest {
  orderedQty: number;
  unitPrice?: number;
  /** 'YYYY-MM-DD'. core 가 @Validate(IsCalendarDateConstraint) 로 형식을 강제한다. */
  expectedArrival?: string;
}

export interface MarkLineUnavailableRequest {
  /** 품절·단종 등. 최대 500자. */
  reason?: string;
}
```

`UpdatePurchaseOrderStatusRequest` 는 **이 태스크에서 지우지 않는다** — Task 4 가 마지막 호출자를 없앤 뒤 같은 커밋에서 지운다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.spec.ts`:

```typescript
import type { PurchaseOrderDto, PurchaseOrderLineDto } from '@/lib/types/dto/inventory';
import {
  buildOrderLinePayload,
  canExecuteLines,
  formatLineProgress,
  isLineExecutable,
  orderDialogDefaults,
  partitionLinesForEdit,
  sortLinesForExecution,
  summarizeLines,
  toCalendarDate,
} from './line-execution-model';

function line(overrides: Partial<PurchaseOrderLineDto> = {}): PurchaseOrderLineDto {
  return {
    skuId: 'sku-1',
    quantity: 10,
    status: 'requested',
    orderedQty: null,
    unitPrice: null,
    expectedArrival: null,
    orderedAt: null,
    orderedBy: null,
    unavailableReason: null,
    ...overrides,
  };
}

function po(overrides: Partial<PurchaseOrderDto> = {}): PurchaseOrderDto {
  return {
    id: 'po-1',
    type: 'domestic',
    supplierId: 'sup-1',
    expectedArrival: null,
    status: 'created',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lines: [],
    ...overrides,
  };
}

describe('summarizeLines / formatLineProgress', () => {
  it('상태별로 센다', () => {
    const progress = summarizeLines([
      line({ skuId: 'a', status: 'ordered' }),
      line({ skuId: 'b', status: 'unavailable' }),
      line({ skuId: 'c', status: 'requested' }),
    ]);

    expect(progress).toEqual({ total: 3, requested: 1, ordered: 1, unavailable: 1 });
  });

  it('불가가 있으면 진행 문구에 함께 적는다', () => {
    expect(formatLineProgress({ total: 5, requested: 1, ordered: 3, unavailable: 1 })).toBe(
      '3/5 실행 · 1 불가'
    );
  });

  it('불가가 없으면 실행분만 적는다', () => {
    expect(formatLineProgress({ total: 2, requested: 2, ordered: 0, unavailable: 0 })).toBe(
      '0/2 실행'
    );
  });

  it('라인이 없으면 그렇게 말한다', () => {
    expect(formatLineProgress({ total: 0, requested: 0, ordered: 0, unavailable: 0 })).toBe(
      '라인 없음'
    );
  });
});

describe('sortLinesForExecution', () => {
  it('아직 처리할 라인을 위로 올린다', () => {
    const sorted = sortLinesForExecution([
      line({ skuId: 'a', status: 'unavailable' }),
      line({ skuId: 'b', status: 'ordered' }),
      line({ skuId: 'c', status: 'requested' }),
    ]);

    expect(sorted.map((l) => l.skuId)).toEqual(['c', 'b', 'a']);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const input = [line({ skuId: 'a', status: 'ordered' }), line({ skuId: 'b' })];
    sortLinesForExecution(input);
    expect(input.map((l) => l.skuId)).toEqual(['a', 'b']);
  });
});

describe('canExecuteLines / isLineExecutable', () => {
  it('received 발주는 라인 실행이 막힌다', () => {
    // core lockPurchaseOrderForLineExecution 이 BadRequestError 를 던진다.
    expect(canExecuteLines('received')).toBe(false);
    expect(canExecuteLines('created')).toBe(true);
    expect(canExecuteLines('confirmed')).toBe(true);
  });

  it('requested 라인만 실행 대상이다', () => {
    expect(isLineExecutable('created', line({ status: 'requested' }))).toBe(true);
    expect(isLineExecutable('created', line({ status: 'ordered' }))).toBe(false);
    expect(isLineExecutable('created', line({ status: 'unavailable' }))).toBe(false);
    expect(isLineExecutable('received', line({ status: 'requested' }))).toBe(false);
  });
});

describe('toCalendarDate / orderDialogDefaults', () => {
  it('ISO 타임스탬프에서 달력 날짜만 잘라낸다', () => {
    // new Date() 왕복이면 TZ 에 따라 하루가 밀린다 — 자르기만 한다.
    expect(toCalendarDate('2026-08-30T00:00:00.000Z')).toBe('2026-08-30');
    expect(toCalendarDate('2026-08-30')).toBe('2026-08-30');
    expect(toCalendarDate(null)).toBe('');
  });

  it('라인 값이 있으면 라인을 쓰고, 없으면 헤더 날짜로 떨어진다', () => {
    expect(
      orderDialogDefaults(po({ expectedArrival: '2026-09-01T00:00:00.000Z' }), line({ expectedArrival: '2026-08-30' }))
    ).toEqual({ orderedQty: '10', unitPrice: '', expectedArrival: '2026-08-30' });

    expect(
      orderDialogDefaults(po({ expectedArrival: '2026-09-01T00:00:00.000Z' }), line({ unitPrice: 3000 }))
    ).toEqual({ orderedQty: '10', unitPrice: '3000', expectedArrival: '2026-09-01' });
  });
});

describe('buildOrderLinePayload', () => {
  it('선택 항목이 비면 본문에서 뺀다', () => {
    expect(buildOrderLinePayload({ orderedQty: '6', unitPrice: '', expectedArrival: '' })).toEqual({
      ok: true,
      payload: { orderedQty: 6 },
    });
  });

  it('채워진 선택 항목은 숫자·문자열로 싣는다', () => {
    expect(
      buildOrderLinePayload({ orderedQty: '6', unitPrice: '2800', expectedArrival: '2026-08-30' })
    ).toEqual({ ok: true, payload: { orderedQty: 6, unitPrice: 2800, expectedArrival: '2026-08-30' } });
  });

  it('실발주 수량 0 은 거부한다 — 그건 불가 처리로 해야 한다', () => {
    // core: BadRequestError('orderedQty must be at least 1; use the unavailable action instead')
    expect(buildOrderLinePayload({ orderedQty: '0', unitPrice: '', expectedArrival: '' })).toEqual({
      ok: false,
      reason: '실발주 수량은 1 이상의 정수여야 합니다.',
    });
  });

  it('정수가 아닌 수량·단가를 거부한다', () => {
    expect(buildOrderLinePayload({ orderedQty: '1.5', unitPrice: '', expectedArrival: '' }).ok).toBe(false);
    expect(buildOrderLinePayload({ orderedQty: '3', unitPrice: '9.9', expectedArrival: '' }).ok).toBe(false);
  });

  it('YYYY-MM-DD 가 아닌 날짜를 거부한다', () => {
    // core 는 오프셋이 붙은 문자열을 IsCalendarDateConstraint 로 막는다. 화면도 같은 문을 세운다.
    expect(
      buildOrderLinePayload({ orderedQty: '3', unitPrice: '', expectedArrival: '2026-08-30T00:00:00+09:00' }).ok
    ).toBe(false);
  });
});

describe('partitionLinesForEdit', () => {
  it('종결된 라인은 편집 대상에서 뺀다', () => {
    // core updatePurchaseOrderLines 가 closedSkuIds 로 걸러내므로,
    // 폼에 실어 보내면 편집이 조용히 버려진다.
    const { editable, closed } = partitionLinesForEdit([
      line({ skuId: 'a', status: 'requested' }),
      line({ skuId: 'b', status: 'ordered' }),
      line({ skuId: 'c', status: 'unavailable' }),
    ]);

    expect(editable.map((l) => l.skuId)).toEqual(['a']);
    expect(closed.map((l) => l.skuId)).toEqual(['b', 'c']);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
npx jest apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.spec.ts
```

Expected: FAIL — `Cannot find module './line-execution-model'`

- [ ] **Step 4: 모델을 구현한다**

`apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.ts`:

```typescript
import type {
  PurchaseOrderDto,
  PurchaseOrderLineDto,
  PurchaseOrderLineStatus,
  PurchaseOrderStatus,
} from '@/lib/types/dto/inventory';

export type LineProgress = {
  total: number;
  requested: number;
  ordered: number;
  unavailable: number;
};

export function summarizeLines(lines: PurchaseOrderLineDto[]): LineProgress {
  return lines.reduce<LineProgress>(
    (acc, line) => {
      acc.total += 1;
      acc[line.status] += 1;
      return acc;
    },
    { total: 0, requested: 0, ordered: 0, unavailable: 0 }
  );
}

export function formatLineProgress(progress: LineProgress): string {
  if (progress.total === 0) return '라인 없음';
  const parts = [`${progress.ordered}/${progress.total} 실행`];
  if (progress.unavailable > 0) parts.push(`${progress.unavailable} 불가`);
  return parts.join(' · ');
}

const STATUS_ORDER: Record<PurchaseOrderLineStatus, number> = {
  requested: 0,
  ordered: 1,
  unavailable: 2,
};

/** 아직 처리할 라인을 위로. 같은 상태끼리는 품목명(없으면 SKU ID) 사전순. */
export function sortLinesForExecution(lines: PurchaseOrderLineDto[]): PurchaseOrderLineDto[] {
  return [...lines].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return (a.sku?.name ?? a.skuId).localeCompare(b.sku?.name ?? b.skuId, 'ko');
  });
}

/**
 * received 는 입고 경로가 소유한 종결 상태다. core 의
 * lockPurchaseOrderForLineExecution 이 그 상태의 라인 실행을 400 으로 막으므로,
 * 화면은 버튼을 눌러 실패를 보여주는 대신 아예 감춘다.
 */
export function canExecuteLines(poStatus: PurchaseOrderStatus): boolean {
  return poStatus !== 'received';
}

export function isLineExecutable(
  poStatus: PurchaseOrderStatus,
  line: PurchaseOrderLineDto
): boolean {
  return canExecuteLines(poStatus) && line.status === 'requested';
}

/**
 * 달력 날짜만 잘라낸다. `new Date(v)` 왕복을 쓰지 않는 이유는 그것이 런타임 TZ 에
 * 따라 하루를 밀기 때문이다 (#724 발견 ⑪). ISO 8601 은 어떤 형태든 앞 10자가
 * 그 달력 날짜라는 성질만 쓴다.
 */
export function toCalendarDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export type OrderDialogDefaults = {
  orderedQty: string;
  unitPrice: string;
  expectedArrival: string;
};

export function orderDialogDefaults(
  po: PurchaseOrderDto,
  line: PurchaseOrderLineDto
): OrderDialogDefaults {
  return {
    orderedQty: String(line.quantity),
    unitPrice: line.unitPrice != null ? String(line.unitPrice) : '',
    expectedArrival: toCalendarDate(line.expectedArrival ?? po.expectedArrival),
  };
}

export type OrderLineFormValues = {
  orderedQty: string;
  unitPrice: string;
  expectedArrival: string;
};

export type OrderLinePayload = {
  orderedQty: number;
  unitPrice?: number;
  expectedArrival?: string;
};

export type OrderLinePayloadResult =
  | { ok: true; payload: OrderLinePayload }
  | { ok: false; reason: string };

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 폼 문자열을 요청 본문으로 옮긴다. 검사 기준은 core 의 OrderPurchaseOrderLineDto 와
 * 같다 — @IsInt @Min(1) / @IsInt @Min(0) / @Validate(IsCalendarDateConstraint).
 * 서버가 어차피 막지만, 되돌릴 수 없는 액션이라 왕복 전에 여기서도 막는다.
 */
export function buildOrderLinePayload(values: OrderLineFormValues): OrderLinePayloadResult {
  const orderedQty = Number(values.orderedQty);
  if (!Number.isInteger(orderedQty) || orderedQty < 1) {
    return { ok: false, reason: '실발주 수량은 1 이상의 정수여야 합니다.' };
  }

  const payload: OrderLinePayload = { orderedQty };

  if (values.unitPrice.trim()) {
    const unitPrice = Number(values.unitPrice);
    if (!Number.isInteger(unitPrice) || unitPrice < 0) {
      return { ok: false, reason: '단가는 0 이상의 정수여야 합니다.' };
    }
    payload.unitPrice = unitPrice;
  }

  if (values.expectedArrival.trim()) {
    if (!CALENDAR_DATE.test(values.expectedArrival)) {
      return { ok: false, reason: '도착예정일은 YYYY-MM-DD 형식이어야 합니다.' };
    }
    payload.expectedArrival = values.expectedArrival;
  }

  return { ok: true, payload };
}

/**
 * 「라인 수정」(PUT /:id/lines)은 아직 requested 인 라인만 갈아끼운다. 종결된 라인을
 * 폼에 실어 보내면 core 가 closedSkuIds 로 걸러내 편집이 조용히 사라진다 —
 * 성공 토스트가 뜨고 값은 되돌아온다. 그래서 폼에 아예 싣지 않는다.
 */
export function partitionLinesForEdit(lines: PurchaseOrderLineDto[]): {
  editable: PurchaseOrderLineDto[];
  closed: PurchaseOrderLineDto[];
} {
  return {
    editable: lines.filter((line) => line.status === 'requested'),
    closed: lines.filter((line) => line.status !== 'requested'),
  };
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
npx jest apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.spec.ts
```

Expected: PASS (모든 테스트 통과)

- [ ] **Step 6: 타입 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: 출력 없음(에러 0). 기존 화면이 새 필드를 요구하지 않으므로 이 시점에 깨지는 곳은 없어야 한다.

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src/lib/types/dto/inventory.ts \
        apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.ts \
        apps/admin-web/src/features/inventory/purchase-orders/line-execution-model.spec.ts
git commit -m "$(cat <<'MSG'
feat(admin-web): 발주 라인 실행 판정 모델과 타입 미러 (#724 항목 12)

admin-web 의 PurchaseOrderLineDto 가 라인 생명주기 이전 모델이라 화면이
라인 상태를 볼 수 없었다. core 응답 DTO 에 맞추고, 이후 화면들이 쓸
판정 로직을 순수 함수로 분리한다 — admin-web 은 .tsx 가 jest transform
밖이라 .ts 로 뽑아야 테스트로 고정된다.

날짜는 slice(0,10) 로만 다룬다. new Date() 왕복은 런타임 TZ 에 따라
달력 하루를 민다(#724 발견 ⑪ 와 같은 부류).

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 2: API 클라이언트 + 라인 실행 뮤테이션

라인 실행은 **첫 실행에서 입고 계획을 만든다**(core `ensurePlanForPurchaseOrder`). 발주 쿼리만 무효화하면 입고 화면이 stale 해진다 — 그 사실을 테스트로 고정한다.

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts`
- Create: `apps/admin-web/src/lib/services/inventory/line-execution-invalidation.ts`
- Test: `apps/admin-web/src/lib/services/inventory/line-execution-invalidation.spec.ts`
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts:639-650`

**Interfaces:**
- Consumes: Task 1 의 `OrderPurchaseOrderLineRequest`, `MarkLineUnavailableRequest`
- Produces:
  - `purchaseOrdersClient.orderLine(poId: string, skuId: string, data: OrderPurchaseOrderLineRequest): Promise<PurchaseOrderDto>`
  - `purchaseOrdersClient.markLineUnavailable(poId: string, skuId: string, data: MarkLineUnavailableRequest): Promise<PurchaseOrderDto>`
  - `lineExecutionInvalidationKeys(poId: string): readonly (readonly unknown[])[]`
  - `useOrderPurchaseOrderLine()` — `mutateAsync({ poId, skuId, data })`
  - `useMarkPurchaseOrderLineUnavailable()` — `mutateAsync({ poId, skuId, data })`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/admin-web/src/lib/services/inventory/line-execution-invalidation.spec.ts`:

```typescript
import { inventoryQueryKeys } from './query-keys';
import { lineExecutionInvalidationKeys } from './line-execution-invalidation';

describe('lineExecutionInvalidationKeys', () => {
  const keys = lineExecutionInvalidationKeys('po-1');

  it('발주 목록과 해당 발주 상세를 무효화한다', () => {
    expect(keys).toContainEqual(inventoryQueryKeys.purchaseOrders());
    expect(keys).toContainEqual(inventoryQueryKeys.purchaseOrder('po-1'));
  });

  it('입고 쿼리 전체를 무효화한다', () => {
    // 첫 라인 실행이 core ensurePlanForPurchaseOrder 로 입고 계획을 만든다.
    // 발주 쿼리만 무효화하면 입고 대기 목록이 방금 생긴 계획을 못 본다.
    // 입고 키는 전부 ['inbounds', ...] 로 시작하므로 루트 하나로 서브트리를 덮는다.
    expect(keys).toContainEqual(inventoryQueryKeys.inbounds);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
npx jest apps/admin-web/src/lib/services/inventory/line-execution-invalidation.spec.ts
```

Expected: FAIL — `Cannot find module './line-execution-invalidation'`

- [ ] **Step 3: 무효화 키 함수를 구현한다**

`apps/admin-web/src/lib/services/inventory/line-execution-invalidation.ts`:

```typescript
import { inventoryQueryKeys } from './query-keys';

/**
 * 라인 실행(발주 기록·불가 종결) 뒤에 다시 읽어야 하는 것들.
 *
 * 입고 쿼리가 목록에 있는 이유: 라인 실행은 발주만 바꾸는 게 아니다. core 가
 * 첫 실행에서 ensurePlanForPurchaseOrder 로 입고 계획을 만들고, 이후 실행마다
 * 계획 아이템을 붙인다. 발주 키만 무효화하면 입고 대기 화면이 옛 목록을 보여준다.
 */
export function lineExecutionInvalidationKeys(poId: string): readonly (readonly unknown[])[] {
  return [
    inventoryQueryKeys.purchaseOrders(),
    inventoryQueryKeys.purchaseOrder(poId),
    inventoryQueryKeys.inbounds,
  ];
}
```

반환 타입이 `readonly (readonly unknown[])[]` 인 이유: `inventoryQueryKeys.*` 는 전부 `as const` 튜플이라 `unknown[][]` 에 대입되지 않는다(readonly → mutable 불가). TanStack Query 의 `QueryKey` 자체가 `readonly unknown[]` 이므로 이 형태가 그대로 맞는다.

`inventoryQueryKeys.purchaseOrders()` 는 인자 없이 부르면 `['purchase-orders', undefined]` 를 준다. TanStack Query 는 접두사 일치로 무효화하므로 필터가 실린 목록 쿼리도 함께 무효화된다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

```bash
npx jest apps/admin-web/src/lib/services/inventory/line-execution-invalidation.spec.ts
```

Expected: PASS

- [ ] **Step 5: 클라이언트 메서드를 추가한다**

`apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts` 의 `updateLines` 바로 아래에 넣는다. import 목록에도 두 타입을 추가한다.

```typescript
  orderLine: async (
    poId: string,
    skuId: string,
    data: OrderPurchaseOrderLineRequest
  ): Promise<PurchaseOrderDto> => {
    const response = await client.post(
      `${BASE}/${encodeURIComponent(poId)}/lines/${encodeURIComponent(skuId)}/order`,
      data
    );
    return response.data;
  },

  markLineUnavailable: async (
    poId: string,
    skuId: string,
    data: MarkLineUnavailableRequest
  ): Promise<PurchaseOrderDto> => {
    const response = await client.post(
      `${BASE}/${encodeURIComponent(poId)}/lines/${encodeURIComponent(skuId)}/unavailable`,
      data
    );
    return response.data;
  },
```

- [ ] **Step 6: 뮤테이션 훅을 추가한다**

`apps/admin-web/src/lib/services/inventory/mutations.ts` 의 `useUpdatePurchaseOrderLines` 바로 아래에 넣는다. 파일 상단 import 에 `lineExecutionInvalidationKeys` 와 두 요청 타입을 추가한다.

```typescript
export const useOrderPurchaseOrderLine = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      skuId,
      data,
    }: {
      poId: string;
      skuId: string;
      data: OrderPurchaseOrderLineRequest;
    }) => purchaseOrdersClient.orderLine(poId, skuId, data),
    onSuccess: (_res, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export const useMarkPurchaseOrderLineUnavailable = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      skuId,
      data,
    }: {
      poId: string;
      skuId: string;
      data: MarkLineUnavailableRequest;
    }) => purchaseOrdersClient.markLineUnavailable(poId, skuId, data),
    onSuccess: (_res, { poId }) => {
      for (const queryKey of lineExecutionInvalidationKeys(poId)) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};
```

- [ ] **Step 7: 배럴 재수출을 확인한다**

`apps/admin-web/src/lib/services/inventory/index.ts` 는 `export * from './mutations'` 이므로 **추가 작업이 없다.** 확인만 한다:

```bash
grep -n "export \* from './mutations'" apps/admin-web/src/lib/services/inventory/index.ts
```

Expected: 한 줄 출력. 없다면(누가 명시적 나열식으로 바꿨다면) 두 훅 이름을 그 목록에 추가한다.

- [ ] **Step 8: 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
npx jest apps/admin-web --maxWorkers=2
```

Expected: 타입 에러 0, 테스트 실패 0

- [ ] **Step 9: 커밋**

```bash
git add apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts \
        apps/admin-web/src/lib/services/inventory/line-execution-invalidation.ts \
        apps/admin-web/src/lib/services/inventory/line-execution-invalidation.spec.ts \
        apps/admin-web/src/lib/services/inventory/mutations.ts \
        apps/admin-web/src/lib/services/inventory/index.ts
git commit -m "$(cat <<'MSG'
feat(admin-web): 발주 라인 실행 API 배선 (#724 항목 12)

POST /purchase-orders/:poId/lines/:skuId/{order,unavailable} 두 라우트를
클라이언트와 뮤테이션으로 잇는다.

무효화 대상에 입고 쿼리 서브트리를 포함한다 — 첫 라인 실행이
ensurePlanForPurchaseOrder 로 입고 계획을 만들기 때문에, 발주 키만
무효화하면 입고 대기 화면이 방금 생긴 계획을 못 본다. 그 판단을
순수 함수로 뽑아 스펙으로 고정했다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 3: 라인 실행·불가 다이얼로그

입고 도메인의 `line-action-menu/` 와 같은 구조·같은 파일 배치로 만든다. 판정 로직은 Task 1 이 이미 테스트로 덮었으므로 이 파일들은 폼 상태와 렌더링만 담는다.

> **이 태스크에 자동 테스트가 없는 이유**: `.tsx` 는 루트 jest 의 transform(`^.+\.(t|j)s$`) 밖이고, Radix Dialog 는 포털·레이아웃 효과에 의존해 `renderToStaticMarkup` 으로 의미 있는 단언을 만들기 어렵다. 값 검증·기본값은 전부 Task 1 의 순수 함수에 있고, 여기 남은 것은 그 함수를 부르는 배선이다. 검증은 타입 게이트 + Task 8 의 수동 스모크가 맡는다.

**Files:**
- Create: `apps/admin-web/src/features/inventory/purchase-orders/components/line-execution/order-dialog.tsx`
- Create: `apps/admin-web/src/features/inventory/purchase-orders/components/line-execution/unavailable-dialog.tsx`

**Interfaces:**
- Consumes: Task 1 의 `orderDialogDefaults`, `buildOrderLinePayload`; Task 2 의 `useOrderPurchaseOrderLine`, `useMarkPurchaseOrderLineUnavailable`
- Produces:
  - `<OrderLineDialog po={PurchaseOrderDto} line={PurchaseOrderLineDto | null} open onOpenChange />`
  - `<MarkLineUnavailableDialog po={PurchaseOrderDto} line={PurchaseOrderLineDto | null} open onOpenChange />`

- [ ] **Step 1: 실행 다이얼로그를 만든다**

`apps/admin-web/src/features/inventory/purchase-orders/components/line-execution/order-dialog.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useOrderPurchaseOrderLine } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import {
  buildOrderLinePayload,
  orderDialogDefaults,
  type OrderLineFormValues,
} from '../../line-execution-model';

type Props = {
  po: PurchaseOrderDto;
  line: PurchaseOrderLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const EMPTY: OrderLineFormValues = { orderedQty: '', unitPrice: '', expectedArrival: '' };

export function OrderLineDialog({ po, line, open, onOpenChange }: Props) {
  const [values, setValues] = useState<OrderLineFormValues>(EMPTY);
  const mutation = useOrderPurchaseOrderLine();

  // 다이얼로그가 열릴 때마다 그 라인의 값으로 되돌린다. 닫았다 다른 라인을 열면
  // 앞 라인의 입력이 남아 있으면 안 된다 — 되돌릴 수 없는 기록이라 특히 그렇다.
  useEffect(() => {
    if (open && line) setValues(orderDialogDefaults(po, line));
  }, [open, line, po]);

  if (!line) return null;

  const handleSubmit = async () => {
    const result = buildOrderLinePayload(values);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }

    try {
      await mutation.mutateAsync({ poId: po.id, skuId: line.skuId, data: result.payload });
      toast.success('발주 실행이 기록되었습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '발주 실행 기록에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>발주 실행 기록 — {line.sku?.name ?? line.skuId}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            요청 수량 <strong>{line.quantity}</strong> 개. 실제로 발주한 값을 기록합니다 —
            <strong> 되돌릴 수 없습니다.</strong>
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="ordered-qty">실발주 수량</Label>
            <Input
              id="ordered-qty"
              type="number"
              min={1}
              value={values.orderedQty}
              onChange={(e) => setValues((prev) => ({ ...prev, orderedQty: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="unit-price">실제 단가 (선택)</Label>
            <Input
              id="unit-price"
              type="number"
              min={0}
              placeholder="비워두면 기존 단가를 유지합니다"
              value={values.unitPrice}
              onChange={(e) => setValues((prev) => ({ ...prev, unitPrice: e.target.value }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="expected-arrival">도착 예정일 (선택)</Label>
            <Input
              id="expected-arrival"
              type="date"
              value={values.expectedArrival}
              onChange={(e) => setValues((prev) => ({ ...prev, expectedArrival: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '기록 중…' : '실행 기록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 불가 다이얼로그를 만든다**

`apps/admin-web/src/features/inventory/purchase-orders/components/line-execution/unavailable-dialog.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getServerDenyMessage } from '@/lib/api/server-error';
import { useMarkPurchaseOrderLineUnavailable } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderLineDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  po: PurchaseOrderDto;
  line: PurchaseOrderLineDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function MarkLineUnavailableDialog({ po, line, open, onOpenChange }: Props) {
  const [reason, setReason] = useState('');
  const mutation = useMarkPurchaseOrderLineUnavailable();

  useEffect(() => {
    if (open) setReason('');
  }, [open, line]);

  if (!line) return null;

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        poId: po.id,
        skuId: line.skuId,
        data: reason.trim() ? { reason: reason.trim() } : {},
      });
      toast.success('발주하지 못한 품목으로 종결했습니다.');
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(getServerDenyMessage(e, '라인 종결에 실패했습니다.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>발주 불가 — {line.sku?.name ?? line.skuId}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            이 품목을 끝내 발주하지 못했다고 종결합니다. <strong>되돌릴 수 없습니다</strong> —
            다시 사려면 새 발주서를 만들어야 합니다.
          </p>

          <div className="flex flex-col gap-1">
            <Label htmlFor="unavailable-reason">사유 (선택, 500자 이내)</Label>
            <Textarea
              id="unavailable-reason"
              maxLength={500}
              placeholder="품절 / 단종 / 공급처 미응답 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? '처리 중…' : '불가로 종결'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: `Textarea` 컴포넌트가 있는지 확인한다**

```bash
ls apps/admin-web/src/components/ui/textarea.tsx
```

Expected: 파일 존재. 없으면 `Input` 으로 바꾸고 `maxLength={500}` 을 유지한다 (shadcn 컴포넌트를 새로 추가하지 말 것).

- [ ] **Step 4: 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: 에러 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/inventory/purchase-orders/components/line-execution/
git commit -m "$(cat <<'MSG'
feat(admin-web): 발주 라인 실행·불가 다이얼로그 (#724 항목 12)

입고의 line-action-menu 와 같은 구조. 되돌릴 수 없는 액션이므로 둘 다
본문에 그 사실을 적고 다이얼로그를 거치게 한다.

값 검사는 line-execution-model 의 순수 함수가 하고(core DTO 와 같은
기준), 서버 거부 문구는 getServerDenyMessage 를 재사용한다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 4: 라인 목록 컴포넌트 + 드로어 재배선 (일괄 확정 경로 제거)

이 태스크가 항목 12 의 본체다. 라인 목록을 **별도 컴포넌트로 분리**하는 이유는, 라인이 많아져 드로어가 좁아지면 나중에 전용 페이지로 옮길 때 감싸는 껍데기만 바꾸면 되게 하기 위해서다.

같은 커밋에서 「운영 상태 변경」 드롭다운을 제거한다. 그 드롭다운의 `확정됨` 은 상태 변경이 아니라 **남은 requested 라인을 요청 수량 그대로 전부 실행**하는 일괄 경로였고, `생성됨` 으로의 강등은 헤더만 되돌려 파생값과 어긋난 상태를 영구히 남겼다(남은 requested 라인이 없으면 `refreshHeaderStatus` 를 다시 부를 경로가 없다).

**Files:**
- Create: `apps/admin-web/src/features/inventory/purchase-orders/components/line-list/index.tsx`
- Modify: `apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-detail-drawer/index.tsx` (전면 개편)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts` (`updateStatus` 제거)
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts` (`useUpdatePurchaseOrderStatus` 제거)
- Modify: `apps/admin-web/src/lib/types/dto/inventory.ts` (`UpdatePurchaseOrderStatusRequest` 제거)

**Interfaces:**
- Consumes: Task 1 의 `summarizeLines`/`formatLineProgress`/`sortLinesForExecution`/`isLineExecutable`/`toCalendarDate`; Task 3 의 다이얼로그 2개
- Produces: `<PurchaseOrderLineList po={PurchaseOrderDto} />`

- [ ] **Step 1: 라인 목록 컴포넌트를 만든다**

`apps/admin-web/src/features/inventory/purchase-orders/components/line-list/index.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type {
  PurchaseOrderDto,
  PurchaseOrderLineDto,
  PurchaseOrderLineStatus,
} from '@/lib/types/dto/inventory';
import {
  isLineExecutable,
  sortLinesForExecution,
  toCalendarDate,
} from '../../line-execution-model';
import { OrderLineDialog } from '../line-execution/order-dialog';
import { MarkLineUnavailableDialog } from '../line-execution/unavailable-dialog';

const LINE_STATUS_LABELS: Record<PurchaseOrderLineStatus, string> = {
  requested: '요청됨',
  ordered: '발주됨',
  unavailable: '불가',
};

const LINE_STATUS_VARIANTS: Record<
  PurchaseOrderLineStatus,
  'outline' | 'secondary' | 'destructive'
> = {
  requested: 'outline',
  ordered: 'secondary',
  unavailable: 'destructive',
};

type LineAction = 'order' | 'unavailable';

export function PurchaseOrderLineList({ po }: { po: PurchaseOrderDto }) {
  const [activeLine, setActiveLine] = useState<PurchaseOrderLineDto | null>(null);
  const [activeAction, setActiveAction] = useState<LineAction | null>(null);

  const openAction = (line: PurchaseOrderLineDto, action: LineAction) => {
    setActiveLine(line);
    setActiveAction(action);
  };

  const closeAction = () => {
    setActiveLine(null);
    setActiveAction(null);
  };

  if (po.lines.length === 0) {
    return <p className="text-sm text-muted-foreground">라인 없음</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {sortLinesForExecution(po.lines).map((line) => (
          <div key={line.skuId} className="rounded-md border p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{line.sku?.name ?? line.skuId}</span>
                  <Badge variant={LINE_STATUS_VARIANTS[line.status]} className="text-xs">
                    {LINE_STATUS_LABELS[line.status]}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  <span>
                    요청 {line.quantity}
                    {line.orderedQty != null && ` → 실발주 ${line.orderedQty}`}
                  </span>
                  {line.unitPrice != null && (
                    <span>단가 {line.unitPrice.toLocaleString('ko-KR')}원</span>
                  )}
                  {line.expectedArrival && <span>도착예정 {toCalendarDate(line.expectedArrival)}</span>}
                </div>

                {line.unavailableReason && (
                  <span className="text-xs text-destructive">사유: {line.unavailableReason}</span>
                )}
                {line.orderedAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(line.orderedAt).toLocaleString('ko-KR')}
                    {line.orderedBy && ` · ${line.orderedBy}`}
                  </span>
                )}
              </div>

              {isLineExecutable(po.status, line) && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="outline" onClick={() => openAction(line, 'order')}>
                    실행
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openAction(line, 'unavailable')}>
                    불가
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <OrderLineDialog
        po={po}
        line={activeLine}
        open={activeAction === 'order'}
        onOpenChange={(o) => {
          if (!o) closeAction();
        }}
      />
      <MarkLineUnavailableDialog
        po={po}
        line={activeLine}
        open={activeAction === 'unavailable'}
        onOpenChange={(o) => {
          if (!o) closeAction();
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: 드로어를 다시 짠다**

`apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-detail-drawer/index.tsx` 를 아래로 **전면 교체**한다. `Select`·`Separator` 중 쓰지 않게 된 import 와 `useUpdatePurchaseOrderStatus` 를 함께 지운다.

```typescript
'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { usePurchaseOrder } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderStatus } from '@/lib/types/dto/inventory';
import { PurchaseOrderFormDialog } from '../purchase-order-form-dialog';
import { PurchaseOrderLineList } from '../line-list';
import { canExecuteLines, formatLineProgress, summarizeLines, toCalendarDate } from '../../line-execution-model';

type Props = {
  row: PurchaseOrderDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function PurchaseOrderDetailDrawer({ row, open, onOpenChange }: Props) {
  const [editLinesOpen, setEditLinesOpen] = useState(false);
  const { data: detail } = usePurchaseOrder(row?.id ?? '');
  const po = detail ?? row;

  if (!po) return null;

  const progress = summarizeLines(po.lines);
  // 요청 라인이 하나도 없으면 수정할 대상이 없다 — 새 SKU 를 얹는 것도
  // 종결된 발주에 요청 라인을 되살리는 셈이라 막는다.
  const canEditLines = canExecuteLines(po.status) && progress.requested > 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[640px] max-w-full overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>발주 상세</SheetTitle>
          </SheetHeader>

          <div className="space-y-5">
            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">기본 정보</p>
              <InfoRow label="발주번호" value={po.id} />
              <InfoRow label="공급처" value={po.supplier?.name ?? po.supplierId ?? undefined} />
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">유형</span>
                <Badge variant="outline">{po.type === 'domestic' ? '국내' : '해외'}</Badge>
              </div>
              {/* 상태는 라인에서 파생된 값이라 화면에서 바꾸지 않는다 (core refreshHeaderStatus).
                  옛 「운영 상태 변경」 드롭다운은 사실 일괄 실행이었고, 강등 선택지는
                  헤더를 파생값과 어긋난 채로 영구히 남겼다. 라인 실행이 그 자리를 대신한다. */}
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">운영 상태</span>
                <Badge variant="secondary">{STATUS_LABELS[po.status]}</Badge>
                {progress.requested > 0 && (
                  <span className="text-xs text-muted-foreground">
                    요청 남음 {progress.requested}건
                  </span>
                )}
              </div>
              <InfoRow label="입고 예정일" value={toCalendarDate(po.expectedArrival) || undefined} />
            </section>

            <Separator />

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">발주 라인</p>
                  <span className="text-xs text-muted-foreground">{formatLineProgress(progress)}</span>
                </div>
                {canEditLines && (
                  <Button size="sm" variant="outline" onClick={() => setEditLinesOpen(true)}>
                    라인 수정
                  </Button>
                )}
              </div>

              <PurchaseOrderLineList po={po} />
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <PurchaseOrderFormDialog
        open={editLinesOpen}
        onOpenChange={setEditLinesOpen}
        editLinesFor={po}
      />
    </>
  );
}
```

- [ ] **Step 3: 일괄 확정 배선을 지운다**

호출자가 사라졌으므로 셋을 함께 지운다:

1. `apps/admin-web/src/lib/services/inventory/mutations.ts` — `useUpdatePurchaseOrderStatus` 훅 전체와 `UpdatePurchaseOrderStatusRequest` import
2. `apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts` — `updateStatus` 메서드와 그 타입 import
3. `apps/admin-web/src/lib/types/dto/inventory.ts` — `UpdatePurchaseOrderStatusRequest` 인터페이스

- [ ] **Step 4: 호출자가 정말 0인지 확인한다**

```bash
cd apps/admin-web && grep -rn "useUpdatePurchaseOrderStatus\|UpdatePurchaseOrderStatusRequest\|purchaseOrdersClient.updateStatus" src
```

Expected: 출력 없음

- [ ] **Step 5: 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
cd /home/pauseb/workspace/almondyoung-server && npx jest apps/admin-web --maxWorkers=2
```

Expected: 타입 에러 0, 테스트 실패 0

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src/features/inventory/purchase-orders/components/line-list/ \
        apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-detail-drawer/index.tsx \
        apps/admin-web/src/lib/api/domains/inventory/purchase-orders.client.ts \
        apps/admin-web/src/lib/services/inventory/mutations.ts \
        apps/admin-web/src/lib/types/dto/inventory.ts
git commit -m "$(cat <<'MSG'
feat(admin-web): 발주 상세에 라인 실행 UI, 일괄 확정 드롭다운 제거 (#724 항목 12)

라인마다 상태·요청↔실발주 대조·종결 정보를 보여주고, requested 라인에만
[실행][불가] 를 단다. 라인 목록은 별도 컴포넌트로 분리했다 — 라인이 많아져
전용 페이지로 옮길 때 감싸는 껍데기만 바뀌게 하려는 것이다.

「운영 상태 변경」 드롭다운을 지운다. 그 확정 선택지는 상태 변경이 아니라
남은 requested 라인을 요청 수량 그대로 전부 실행하는 일괄 경로였고,
생성됨으로의 강등은 헤더를 파생값과 어긋난 채로 영구히 남겼다(요청 라인이
없으면 refreshHeaderStatus 를 다시 부를 경로가 없다). 이제 라인 실행이
유일한 확정 수단이다.

PUT /purchase-orders/:id/status 의 admin-web 호출자가 0이 됐다 —
#724 항목 9 의 3단계(확정 수동 설정 차단)가 그만큼 쉬워진다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 5: 「라인 수정」 다이얼로그 — 종결 라인 제외

`PUT /:id/lines` 는 `requested` 라인만 갈아끼운다. 지금 폼은 종결된 라인까지 전부 프리필하므로, 운영자가 실행된 라인의 수량을 고치면 **성공 토스트가 뜨고 값은 조용히 되돌아온다**(core 가 `closedSkuIds` 로 걸러낸다). 항목 12 가 종결 라인을 실제로 만들기 시작하므로 여기서 함께 고친다.

**Files:**
- Modify: `apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-form-dialog/index.tsx:60-75, 199-235`

**Interfaces:**
- Consumes: Task 1 의 `partitionLinesForEdit`

- [ ] **Step 1: 프리필을 요청 라인으로 좁힌다**

`useEffect` 안의 `editLinesFor.lines.map(...)` 를 `partitionLinesForEdit(editLinesFor.lines).editable.map(...)` 으로 바꾼다. 파일 상단에 import 를 추가한다:

```typescript
import { partitionLinesForEdit } from '../../line-execution-model';
```

편집 가능 라인이 0개면 빈 배열 대신 빈 라인 하나(`[{ ...EMPTY_LINE }]`)를 넣어 기존 동작(항상 한 줄은 보임)을 유지한다.

- [ ] **Step 2: 종결 라인을 읽기 전용으로 보여준다**

라인 입력 목록(`lines.map((line, i) => ...)`) 바로 위에, 편집 대상이 아닌 라인이 있으면 그 사실을 적는다:

컴포넌트 본문에서 한 번만 계산한다 (`return` 위):

```typescript
  const closedLines =
    isEditLines && editLinesFor ? partitionLinesForEdit(editLinesFor.lines).closed : [];
```

그리고 라인 입력 목록 바로 위에 놓는다:

```typescript
{closedLines.length > 0 && (
  <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
    <p className="mb-1">
      이미 처리된 라인 {closedLines.length}건은 수정할 수 없어 목록에서 제외했습니다.
    </p>
    <ul className="list-inside list-disc text-xs">
      {closedLines.map((line) => (
        <li key={line.skuId}>
          {line.sku?.name ?? line.skuId} — {line.status === 'ordered' ? '발주됨' : '불가'}
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 3: 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: 에러 0

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/features/inventory/purchase-orders/components/purchase-order-form-dialog/index.tsx
git commit -m "$(cat <<'MSG'
fix(admin-web): 라인 수정 폼에서 종결된 라인 제외 (#724 항목 12)

PUT /:id/lines 는 requested 라인만 갈아끼운다. 종결 라인까지 프리필하면
운영자가 그 수량을 고쳐도 core 가 closedSkuIds 로 걸러내 편집이 조용히
사라진다 — 성공 토스트가 뜨고 값은 되돌아온다. 폼에서 빼고, 제외했다는
사실과 목록을 함께 보여준다.

항목 12 가 종결 라인을 실제로 만들기 시작하므로 지금 고친다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 6: 발주 목록 「라인 진행」 컬럼

목록에서 어느 발주가 아직 손이 필요한지 보이지 않는다. 「라인 수」 컬럼을 진행도로 바꾼다.

**Files:**
- Modify: `apps/admin-web/src/hooks/table/columns/use-purchase-orders-table-columns.tsx:56-61`

**Interfaces:**
- Consumes: Task 1 의 `summarizeLines`, `formatLineProgress`

- [ ] **Step 1: 컬럼을 교체한다**

`lines` accessor 컬럼을 아래로 바꾸고, 파일 상단에 import 를 추가한다:

```typescript
import {
  formatLineProgress,
  summarizeLines,
} from '@/features/inventory/purchase-orders/line-execution-model';
```

```typescript
      columnHelper.accessor('lines', {
        header: '라인 진행',
        cell: ({ getValue }) => (
          <span className="text-sm">{formatLineProgress(summarizeLines(getValue() ?? []))}</span>
        ),
      }),
```

- [ ] **Step 2: 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
```

Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add apps/admin-web/src/hooks/table/columns/use-purchase-orders-table-columns.tsx
git commit -m "$(cat <<'MSG'
feat(admin-web): 발주 목록에 라인 진행 컬럼 (#724 항목 12)

라인 수 대신 "3/5 실행 · 1 불가" 를 보여준다. 헤더 상태가 라인에서
파생되는 모델이라, 어느 발주에 아직 손이 필요한지는 진행도가 답한다.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 7: 입고 「계획 등록」 탭 제거

이 탭은 살릴 길이 없다. 조사 결과(2026-08-26):

- `CreateInboundPlanDto` 가 `warehouseId` · `destinationWarehouseId` · `planType` 을 **`(무시됨)`** 이라고 스스로 문서화한다 — core 가 연결된 발주에서 도출한다. 그런데 탭의 제출 가드는 `!warehouseId` 로 **버려지는 필드를 필수로 요구해** 막고 있다.
- `linkedPurchaseOrderId` 가 필수라 "발주 없는 입고 예정" 용도로 재해석할 수도 없다.
- 목록에 띄우는 `confirmed` 발주는 곧 라인이 전부 종결됐다는 뜻이고, 라인이 하나라도 실행됐다면 계획이 이미 있어 **409** 다(`inbound-plan-port-invariant` 스펙이 그 불변식을 지킨다). 전 라인이 `unavailable` 인 발주라면 아이템 0개짜리 **유령 계획**이 생긴다.
- SKU 를 UUID 로 손 타이핑하게 되어 있다.
- `POST /inbound/plans` 를 부르는 곳은 이 탭 하나뿐이다. warehouse-app 은 `/inbound/plans/receive` 와 `/inbound/plans/$planId` 만 쓴다.

core 라우트는 **그대로 둔다** — 호출자 0 으로 남기고 처분은 #724 항목 5·8 에서 판단한다.

**Files:**
- Delete: `apps/admin-web/src/features/inventory/inbound/components/plan-create-tab/index.tsx`
- Modify: `apps/admin-web/src/features/inventory/inbound/template/index.tsx`
- Modify: `apps/admin-web/src/lib/services/inventory/mutations.ts` (`useCreateInboundPlan`, `useAddInboundPlanItems` — 호출자 0 확인 후 제거)
- Modify: `apps/admin-web/src/lib/api/domains/inventory/*` (위 훅이 쓰던 클라이언트 메서드 — 다른 호출자가 없을 때만)

- [ ] **Step 1: 탭을 지운다**

```bash
git rm apps/admin-web/src/features/inventory/inbound/components/plan-create-tab/index.tsx
```

`apps/admin-web/src/features/inventory/inbound/template/index.tsx` 에서:
- `import { PlanCreateTab } from '../components/plan-create-tab';` 삭제
- `type InboundTab = 'pending' | 'create' | 'history';` → `'pending' | 'history'`
- `<TabsTrigger value="create">계획 등록</TabsTrigger>` 삭제
- `<TabsContent value="create"><PlanCreateTab /></TabsContent>` 삭제
- `Header` 의 `subtitle` 을 `"입고 처리와 입고 이력을 관리합니다."` 로 고친다 (계획 등록이 더는 없다)

- [ ] **Step 2: URL 이 `?tab=create` 로 들어와도 깨지지 않는지 확인한다**

`const tab = (searchParams.get('tab') as InboundTab) ?? 'pending';` 이므로 `?tab=create` 는 어느 `TabsContent` 에도 맞지 않아 **빈 화면**이 된다. 알려지지 않은 값을 기본 탭으로 떨어뜨린다:

```typescript
const TAB_VALUES = ['pending', 'history'] as const;
type InboundTab = (typeof TAB_VALUES)[number];

function parseTab(value: string | null): InboundTab {
  return TAB_VALUES.includes(value as InboundTab) ? (value as InboundTab) : 'pending';
}

const tab = parseTab(searchParams.get('tab'));
```

- [ ] **Step 3: 죽은 훅의 호출자가 0인지 확인한다**

```bash
cd apps/admin-web && grep -rn "useCreateInboundPlan\|useAddInboundPlanItems" src
```

Expected: `src/lib/services/inventory/mutations.ts` 의 정의부만 나온다. 그러면 두 훅과, 그 훅만 쓰던 클라이언트 메서드를 지운다. 다른 호출자가 하나라도 나오면 **훅 삭제는 건너뛰고** 탭 제거만 커밋한다.

- [ ] **Step 4: 게이트**

```bash
cd apps/admin-web && npx tsc --noEmit
cd /home/pauseb/workspace/almondyoung-server && npx jest apps/admin-web --maxWorkers=2
```

Expected: 타입 에러 0, 테스트 실패 0

- [ ] **Step 5: 커밋**

```bash
git add -A apps/admin-web/src/features/inventory/inbound/ \
           apps/admin-web/src/lib/services/inventory/mutations.ts \
           apps/admin-web/src/lib/api/domains/inventory/
git commit -m "$(cat <<'MSG'
refactor(admin-web): 입고 「계획 등록」 탭 제거 (#724 항목 12)

이 탭은 살릴 길이 없다. CreateInboundPlanDto 가 warehouseId·
destinationWarehouseId·planType 을 스스로 (무시됨) 이라 적어놨는데
탭의 제출 가드는 그 버려지는 필드를 필수로 요구해 막고 있었고,
linkedPurchaseOrderId 는 필수라 발주 없는 입고 예정으로 쓸 수도 없다.

거기에 라인 생명주기가 마지막 용도까지 걷어갔다 — 계획은 첫 라인 실행에서
자동으로 생기므로, 목록에 뜨는 confirmed 발주는 이미 계획을 갖고 있어
409 이고(전 라인 unavailable 이면 아이템 0개짜리 유령 계획), SKU 는
UUID 손입력이었다.

POST /inbound/plans 의 호출자는 이 탭뿐이었다(warehouse-app 은 receive 와
조회만 쓴다). core 라우트는 남긴다 — 처분은 #724 항목 5·8 에서.

Claude-Session: https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
MSG
)"
```

---

### Task 8: 전체 게이트 + 수동 스모크 + 이슈 갱신

**Files:**
- Modify: 없음 (검증과 기록만)

- [ ] **Step 1: 전체 게이트를 돌린다**

```bash
cd /home/pauseb/workspace/almondyoung-server
npm run type-check
cd apps/admin-web && npx tsc --noEmit
cd /home/pauseb/workspace/almondyoung-server && npx jest --maxWorkers=2
```

Expected: 셋 다 에러/실패 0. `npx jest` 는 OOM 을 피하려 `--maxWorkers=2` 를 반드시 붙인다.

- [ ] **Step 2: admin-web 을 띄워 스모크한다**

```bash
npm run start:admin-web:dev
```

**라이브·dev DB 모두 발주가 0건이다.** 그래서 스모크의 첫 항목이 발주 생성이다 — 이걸 건너뛰면 나머지를 볼 수 없다.

- [ ] 1. 발주관리 → 「발주 생성」 으로 라인 3개짜리 발주를 만든다 (공급처에 기본 창고가 설정돼 있어야 한다 — 없으면 core 가 그 사실을 문장으로 알려준다)
- [ ] 2. 목록의 「라인 진행」 컬럼이 `0/3 실행` 으로 보인다
- [ ] 3. 상세 드로어를 연다 — 「운영 상태 변경」 드롭다운이 **없다**, 「운영 상태」 옆에 `요청 남음 3건` 이 보인다
- [ ] 4. 라인 하나에서 「실행」 → 수량이 요청 수량으로 프리필돼 있다 → 수량을 줄이고(예: 10 → 6) 도착예정일을 넣어 기록한다
- [ ] 5. 그 라인이 `발주됨` 배지 + `요청 10 → 실발주 6` + 도착예정일 + 실행 시각/사람으로 바뀐다
- [ ] 6. 같은 라인에 「실행」 버튼이 더는 없다
- [ ] 7. 입고 관리 → 「입고 대기」 탭에 방금 발주의 계획이 나타난다 (무효화가 작동하는지 — 새로고침 없이)
- [ ] 8. 다른 라인에서 「불가」 → 사유를 넣고 종결 → `불가` 배지 + 사유가 보인다
- [ ] 9. 「라인 수정」 을 연다 — 종결된 라인 2건이 폼에 없고, "이미 처리된 라인 2건은 수정할 수 없어 제외했습니다" 안내와 목록이 보인다
- [ ] 10. 남은 마지막 라인을 실행한다 → 헤더 상태가 `확정됨` 으로 바뀌고 `요청 남음` 표시가 사라진다
- [ ] 11. 목록의 「라인 진행」 이 `2/3 실행 · 1 불가` 로 보인다
- [ ] 12. 「라인 수정」 버튼이 사라졌다 (요청 라인 0건)
- [ ] 13. 입고 관리 화면에 「계획 등록」 탭이 없고, `?tab=create` 로 직접 들어가도 「입고 대기」 가 뜬다
- [ ] 14. 실행 다이얼로그에서 수량 `0` 을 넣으면 "실발주 수량은 1 이상의 정수여야 합니다." 토스트가 뜨고 요청이 나가지 않는다
- [ ] 15. 두 브라우저 탭에서 같은 라인을 실행하면 뒤에 온 쪽이 409 문구("다른 작업으로 상태가 변경되어…")를 받는다

- [ ] **Step 3: 이슈 #724 현황판을 갱신한다**

항목 12 행의 상태를 🟩 로 바꾸고 계획서 링크와 PR 번호를 적는다. 「다음 작업」 절의 권장 순서에서 항목 12 줄을 지우고 다음 차례(항목 9의 3단계)를 `← 지금 여기` 로 옮긴다. 코멘트로 아래를 남긴다:

- `PUT /purchase-orders/:id/status` 의 admin-web 호출자가 0이 됐다는 사실 — 항목 9의 3단계가 걱정하던 "먼저 차단하면 라이브에서 확정이 불가능해진다" 는 우려가 소멸했다
- 입고 「계획 등록」 탭 제거와 그 근거 — `POST /inbound/plans` 가 호출자 0 이 됐으므로 항목 5·8 에서 라우트 처분을 판단할 것
- 스모크 15항목의 실제 수행 결과 (했으면 했다고, 안 했으면 안 했다고 — 이 저장소는 미수행 스모크를 배포한 전력이 있다)

- [ ] **Step 4: PR 을 연다**

```bash
gh pr create --base develop \
  --title "feat(admin-web): 발주 라인 실행 UI (#724 항목 12)" \
  --body "$(cat <<'BODY'
## 무엇

#724 항목 12. 라이브에 배포돼 있으나 호출 경로가 없던 발주 라인 생명주기 백엔드에
admin-web 화면을 붙인다. 라이브 `purchase_orders` 행이 0인 이유가 이것이었다 —
발주를 만들 수는 있어도 라인을 실행할 경로가 없었다.

## 범위

- 발주 상세 드로어: 라인별 상태·요청↔실발주 대조·실행/불가 액션
- 「운영 상태 변경」 드롭다운 제거 (사실상 일괄 실행이었고, 강등은 헤더를 파생값과
  어긋난 채로 남겼다). `PUT /:id/status` 호출자 0
- 「라인 수정」 폼에서 종결 라인 제외 (편집이 조용히 버려지던 경로)
- 발주 목록 「라인 진행」 컬럼
- 입고 「계획 등록」 탭 제거 (입력 5개 중 3개를 core 가 이미 무시했고, 계획 자동
  생성이 마지막 용도를 걷어갔다)

## 배포

core 변경 0 · 마이그레이션 0 · 시크릿 0. admin-web 단독 배포, 순서 제약 없음.

## 검증

- `npm run type-check` / `cd apps/admin-web && npx tsc --noEmit` / `npx jest --maxWorkers=2` 전부 0
- 수동 스모크 15항목: 계획서 Task 8 참조

https://claude.ai/code/session_01WovGgrH4KMgQCsbo1anCud
BODY
)"
```

---

## 이 계획이 남기는 후속

| 무엇 | 어디로 |
|---|---|
| `PUT /:id/status` 호출자 0 — 확정 수동 설정 차단 | #724 항목 9의 3단계 |
| `POST /inbound/plans` · `POST /inbound/plans/items` 호출자 0 — 라우트 처분 | #724 항목 5·8 |
| 라인 수가 많아지면 드로어 → 전용 페이지 | 라인 목록이 이미 분리돼 있어 껍데기만 교체 |
| 헤더 `expectedArrival` 격하 (라인별 날짜가 진실) | #724 항목 9의 3단계 |
