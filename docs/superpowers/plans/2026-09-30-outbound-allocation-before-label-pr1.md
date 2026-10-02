# PR 1 — 명시적 작업 시작과 로케이션이 찍힌 송장 (#987) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배치는 「작업 시작」 한 입구로만 시작되고, 시작 때 확정된 배정(로케이션 × SKU × 수량)이 송장 품목 줄에 찍히며, 낡은 종이로는 피킹·검수·발송이 진행되지 않는다.

**Architecture:** 배치 시작(`startBatchPicking`)이 E8 규칙(한 로케이션 전량 우선 → 코드 순)으로 배정하고, 막히면 막힌 박스·SKU·사유를 **전부** 모아 한 번에 거절한다. 송장 쪽은 «현재 내용 조립»(`WaybillLabelContentAssembler.current`) 한 함수가 배정을 읽어 `HanjinLabelContent` 를 만들고, 렌더러·출력 확인·재출력 게이트(`LabelCurrencyGuard`)·송장 스캔 상태(`labelState`)가 모두 그 함수와 그 지문(`labelFingerprint`)을 쓴다. warehouse-app 은 배치 카드의 「작업 시작」, 인쇄 뒤 출력 확인, 송장 스캔 때 `labelState` 에 따른 재출력 화면을 얻는다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · Jest(core) · React 19 + TanStack Query + Vitest(warehouse-app, Tauri)

**Spec:** `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — §1~§5 공통, §6·§10·§11(PR 1 행)·§12·§15 PR 1 절. 실행자는 이 계획과 스펙을 **둘 다** 읽는다.

**트래킹:** #986 / 이 PR: #987. 선행 머지: S1-A PR #984(`09c3d8e15`), 스펙 커밋 `5c1554488`.

## Global Constraints

- core 와 warehouse-app 을 **이 PR 하나에서** 바꾸고 함께 배포한다(스펙 §15).
- 스키마 변경은 전부 추가형 — 배포 순서 **`migrate → deploy`**(CLAUDE.md expand phase).
- 서비스 계층은 `@app/shared` 도메인 예외, fulfillment HTTP 오류는 `ConflictException({ code, message })`, waybill 오류는 `ConflictError('<CODE>: …')` 메시지 접두어(스펙 §12). 이 계획의 새 코드도 그 관례를 따른다.
- 트랜잭션: 공개 메서드는 `tx?: DbTx` 마지막 인자 + `this.dbService.run(fn, tx)`, private 헬퍼는 `trx: DbTx` 필수(ADR-0025). `db.query.*`·`with` 금지, `any` 금지.
- 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0. 앱은 `cd native/warehouse-app && npx tsc -b && npx vitest run`.
- 통합 스펙은 `describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지, 실행은 `npm run test:core:integration:local -- <패턴>`(`--runInBand` 고정).
- 작업자 문구는 «라벨»이 아니라 **«송장»**(사용자 규칙). 기존 문구 중 이 PR 이 만지는 것만 바꾼다.
- 코드 좌표는 함수·파일 이름으로 적는다. 줄 번호로 찾지 말 것.
- **사용자 결정(2026-09-30, 이 계획 작성 중):** 앱이 그릴 수 없는 송장(`source='manual'` 또는 `carrier≠'HANJIN'`)의 박스는 I4·I5 에서 **면제**하고 `labelState='external'` 로 보고한다. 렌더는 지금처럼 `WAYBILL_LABEL_UNAVAILABLE`.
- **이 계획이 코드에서 도출해 정한 것(스펙 §10.4 가 계획에 위임):**
  - 게이트 진입점 = `lockAndAssertPickerClaim` 을 부르는 전략 메서드 7곳 전부(개별 `scan`·`completePick`, 토트 `assignTote`·`toteScan`·`completePick`, 토탈 `sortScan`·`completePick`) + `ShipmentDispatchService.lockAggregate`(검수 스캔·검수 줄·강제 발송·자동 발송이 전부 지남).
  - **토탈피킹 `bulkCartScan` 은 게이트 밖** — 박스 신원이 없는 배치 단위 집품이다. 박스 단위 전진은 그 뒤 `sortScan` 에서 막힌다.
  - **포장 담당 선점(`claimPacker`) 은 게이트 밖** — 스펙이 요구하는 «포장 완료» 는 검수(`lockAggregate`) 가 대신 막는다.
  - 되돌림·중립 명령(`unpickShipment`·`handoff`·`releaseTote`·`toteHandoff`·`cartHandoff`·결품·회수)은 게이트 밖. 가드 스펙이 둘 다 지킨다.
- **이 PR 에서 하지 않는 것(스펙 §15 PR 1 «아직 안 하는 것»):** 시작된 배치에 넣기(여전히 `OUTBOUND_BATCH_ALREADY_STARTED`), 시작된 배치의 제외 동작 변경, 결품 재배정, `reconcileAllocation`, `FulfillmentInvariantService` 의 I4 검사(I4 는 렌더러·조립 함수가 강제한다 — 불변식 검사기 확장은 PR 2 의 `reconcileAllocation` 과 함께).

## Review Focus

1. **같은 내용으로 되돌아온 박스(A→B→A)** — A 를 다시 출력 확인하면 «마지막 출력»이 A 가 돼야 한다. 유니크 (`shipment_id`,`fingerprint`) 에 막혀 조용히 무시되면 B 가 최신으로 남아 박스가 영원히 `reprint_required`. → Task 6 저장소 테스트 + Task 8 통합 테스트가 잡는다(upsert 로 `printed_at` 갱신).
2. **수기 송장 박스가 시작된 배치에 있을 때** — 게이트 통과, 렌더는 `WAYBILL_LABEL_UNAVAILABLE`, 스캔 상태 `external`. 기존 통합 픽스처가 전부 수기 송장이라 여기가 깨지면 스위트 전체가 붉어진다. → Task 9·Task 10 테스트.
3. **작업 도중 수하인·공동현관 비밀번호가 바뀐 박스** — 다음 전진 스캔이 앱이 알아듣는 코드로 거절돼야 한다(`WAYBILL_STALE` 또는 `LABEL_REPRINT_REQUIRED`). `@app/shared ConflictError` 가 그대로 새면 앱은 «다른 작업자가 먼저 변경했어요» 를 띄운다. → Task 9 가 코드를 옮겨 싣고, Task 11 이 문구를 단다.
4. **같은 멱등 키로 다시 보낸 전진 명령** — 이미 처리된 명령의 재전송은 게이트에 막히지 않고 저장된 응답을 돌려줘야 한다(가드를 `commands.execute` 핸들러 **안**에 둔 이유). → Task 9 통합 테스트.
5. **한 박스는 여러 로케이션을 합쳐야 채워지고 다른 박스는 모자란 배치** — 모자란 박스만 보고, 아무것도 쓰지 않고, `started_at` 은 NULL 로 남아야 한다. → Task 2 통합 테스트.

---

## 파일 지도

core (`apps/core/src/modules/fulfillment/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `picking/allocation/allocate-lines.ts` | E8 배정 + 모자란 줄 전부 보고(순수) | 1 |
| `picking/allocation/allocation.types.ts` | `SourceCapacity.locationCode`, `LineShortage`, `StartBlocker*` | 1·2 |
| `picking/allocation/allocation.locks.ts` | 용량에 코드·적치 대기분, 송장 차단 수집, 차단 설명 | 2 |
| `picking/allocation/allocation.errors.ts` | `startBlocked()` | 2 |
| `picking/allocation/batch-start.ts` | 전부 아니면 전무 | 2 |
| `services/simple-outbound.service.ts` · `services/outbound-preparation.locks.ts` · `services/outbound-preparation-result.ts` | 지연 시작 제거, `BATCH_NOT_STARTED` | 3 |
| `libs/shared/src/filters/http-exception.filter.ts` | 준비 차단 사유 허용 목록에 `BATCH_NOT_STARTED` | 3 |
| `picking/allocation/batch-start-entry.guard.spec.ts` (신규) | «배치 시작 입구는 하나» 가드 | 3 |
| `dto/outbound-batch-v2.dto.ts` · `services/outbound-batch-orchestrator.service.ts` `listBatches` | 목록에 `startedAt` | 3 |
| `waybill/label/label-items.ts` | 품목 줄 = (로케이션, SKU) 배정 행 | 4 |
| `waybill/carrier/hanjin/label/hanjin-label-data.ts` | `HanjinLabelContent` / `HanjinLabelData` 분리 | 4 |
| `waybill/label/label-fingerprint.ts` (신규) | `labelFingerprint` | 4 |
| `waybill/carrier/hanjin/label/hanjin-fs-template.ts` | `[로케이션]` 접두어, `N판` | 5 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | `waybill_label_prints` | 6 |
| `waybill/label/label-print-policy.ts` (신규) | 판차·최신 출력·줄 차이·`labelStateOf`(순수) | 6 |
| `waybill/waybill-label-print.repository.ts` (신규) | 출력 기록 읽기·upsert·작업 항목 잠금 | 6 |
| `waybill/waybill.reader.ts` `loadLabelAllocation` | 배정 행 읽기 | 7 |
| `waybill/waybill-label-content.assembler.ts` (신규) | 현재 내용 조립(단일 함수) | 7 |
| `waybill/waybill-label.manager.ts` · `dto/waybill.dto.ts` | 렌더 = 조립 + 판차 | 7 |
| `waybill/__support__/label-fixtures.ts` (신규) | 한진 송장 승격·라벨 조립 배선 | 7 |
| `waybill/waybill-label-print.manager.ts` (신규) · `waybill-label.controller.ts` · `waybill-label.service.ts` | 출력 확인 API | 8 |
| `waybill/label-currency.guard.ts` (신규) | I5 | 9 |
| `picking/*.strategy.ts` · `services/shipment-dispatch.service.ts` | 게이트 배선 | 9 |
| `picking/label-currency-gate.guard.spec.ts` (신규) | «전진 명령은 게이트를 거친다» | 9 |
| `waybill/waybill-label-state.reader.ts` (신규) · `reader/shipment-waybill.reader.ts` | `labelState` | 10 |

warehouse-app (`native/warehouse-app/src/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `core/data/httpClient.ts` · `core/data/errorMessage.ts` | 새 거절 코드·`errors` 본문·문구 | 11 |
| `domains/outbound/batchStart.ts` (신규) · `StartBatchButton.tsx` (신규) · `OutboundQueueScreen.tsx` · `types.ts` | 「작업 시작」·시작 실패 화면 | 12 |
| `domains/outbound/waybillLabel.ts` · `BatchLabelPrintButton.tsx` · `ReprintLabelButton.tsx` | 출력 확인·판차·재출력 필요 N | 13 |
| `domains/outbound/labelGate.ts` (신규) · `OutboundQueueScreen.tsx` | 송장 스캔 → 재출력 화면 | 14 |

---

### Task 1: `allocateLines` — E8 배정 규칙과 모자란 줄 전부 보고

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.types.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.ts`
- Test: `apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.spec.ts` (전면 교체)

**Interfaces:**
- Consumes: 없음(순수)
- Produces:
  - `SourceCapacity { skuId; sourceLocationId; locationCode: string; stockVersion; remainingQty }`
  - `type StartShortReason = 'INBOUND_PENDING' | 'STOCK_SHORT'`
  - `LineShortage { workItemId; shipmentLineId; skuId; requiredQty: number; shortQty: number; reason: StartShortReason }`
  - `AllocationOutcome { drafts: AllocationDraft[]; shortages: LineShortage[] }`
  - `allocateLines(lines, capacities, inboundPendingBySku?: ReadonlyMap<string, number>): AllocationOutcome` — **더 이상 던지지 않는다**

- [ ] **Step 1: 타입을 더한다** — `allocation.types.ts` 의 `SourceCapacity` 에 `locationCode: string;` 를 `sourceLocationId` 다음에 넣고, 파일 끝에 추가:

```ts
/** 시작·합류가 배정을 못 채운 줄의 사유(스펙 §6 표). 송장 사유는 박스 단위라 여기 없다. */
export type StartShortReason = 'INBOUND_PENDING' | 'STOCK_SHORT';

export interface LineShortage {
  workItemId: string;
  shipmentLineId: string;
  skuId: string;
  requiredQty: number;
  shortQty: number;
  reason: StartShortReason;
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다** — `allocate-lines.spec.ts` 를 통째로 바꾼다:

```ts
import { allocateLines } from './allocate-lines';
import { SourceCapacity } from './allocation.types';

const cap = (
  skuId: string,
  sourceLocationId: string,
  locationCode: string,
  remainingQty: number,
  stockVersion = 1,
): SourceCapacity => ({ skuId, sourceLocationId, locationCode, remainingQty, stockVersion });

const line = (id: string, skuId: string, qty: number, workItemId = `wi-${id}`) => ({ id, skuId, qty, workItemId });

describe('allocateLines — E8 배정 규칙', () => {
  it('한 로케이션에서 줄 전량을 채울 수 있으면 그곳에서만 — 앞 코드의 1개짜리로 쪼개지 않는다', () => {
    const { drafts, shortages } = allocateLines([line('l1', 'sku', 2)], [cap('sku', 'loc-a', 'A-01', 1), cap('sku', 'loc-b', 'B-01', 5)]);
    expect(shortages).toEqual([]);
    expect(drafts).toEqual([
      { workItemId: 'wi-l1', shipmentLineId: 'l1', sourceLocationId: 'loc-b', qty: 2, sourceStockVersion: 1 },
    ]);
  });

  it('전량 가능한 곳이 여럿이면 로케이션 코드 순 첫째(id 순이 아니다)', () => {
    const { drafts } = allocateLines([line('l1', 'sku', 2)], [cap('sku', 'id-1', 'C-01', 9), cap('sku', 'id-9', 'B-01', 9)]);
    expect(drafts.map((d) => d.sourceLocationId)).toEqual(['id-9']);
  });

  it('어디서도 전량이 안 되면 코드 순으로 나눠 채운다', () => {
    const { drafts, shortages } = allocateLines(
      [line('l1', 'sku', 4)],
      [cap('sku', 'loc-c', 'C-01', 3), cap('sku', 'loc-a', 'A-01', 2)],
    );
    expect(shortages).toEqual([]);
    expect(drafts.map((d) => [d.sourceLocationId, d.qty])).toEqual([
      ['loc-a', 2],
      ['loc-c', 2],
    ]);
  });

  it('줄은 줄 id 순으로 처리하고 앞 줄이 쓴 용량은 뒤 줄이 못 쓴다', () => {
    const { drafts } = allocateLines(
      [line('l2', 'sku', 3), line('l1', 'sku', 2)],
      [cap('sku', 'loc-a', 'A-01', 2), cap('sku', 'loc-b', 'B-01', 3)],
    );
    expect(drafts.map((d) => [d.shipmentLineId, d.sourceLocationId, d.qty])).toEqual([
      ['l1', 'loc-a', 2],
      ['l2', 'loc-b', 3],
    ]);
  });

  it('입력 순서를 섞어도 결과가 같다(결정적)', () => {
    const lines = [line('l1', 'sku', 2), line('l2', 'sku', 2)];
    const caps = [cap('sku', 'loc-a', 'A-01', 3), cap('sku', 'loc-b', 'B-01', 3)];
    expect(allocateLines([...lines].reverse(), [...caps].reverse())).toEqual(allocateLines(lines, caps));
  });

  it('다른 SKU 의 용량은 쓰지 않는다', () => {
    const { drafts, shortages } = allocateLines([line('l1', 'sku-1', 1)], [cap('sku-2', 'loc-a', 'A-01', 5)]);
    expect(drafts).toEqual([]);
    expect(shortages).toEqual([
      { workItemId: 'wi-l1', shipmentLineId: 'l1', skuId: 'sku-1', requiredQty: 1, shortQty: 1, reason: 'STOCK_SHORT' },
    ]);
  });

  it('입력 용량 배열을 변경하지 않는다', () => {
    const capacities = [cap('sku', 'loc-a', 'A-01', 5)];
    allocateLines([line('l1', 'sku', 2)], capacities);
    expect(capacities[0].remainingQty).toBe(5);
  });
});

describe('allocateLines — 모자란 줄 보고', () => {
  it('첫 부족에서 멈추지 않고 모자란 줄을 전부 돌려준다', () => {
    const { shortages } = allocateLines(
      [line('l1', 'sku-1', 3), line('l2', 'sku-2', 1), line('l3', 'sku-1', 2)],
      [cap('sku-1', 'loc-a', 'A-01', 2)],
    );
    expect(shortages.map((s) => [s.shipmentLineId, s.shortQty])).toEqual([
      ['l1', 1],
      ['l2', 1],
      ['l3', 2],
    ]);
  });

  it('적치 대기분까지 더하면 채워지면 INBOUND_PENDING, 아니면 STOCK_SHORT', () => {
    const { shortages } = allocateLines(
      [line('l1', 'sku-1', 3), line('l2', 'sku-2', 3)],
      [cap('sku-1', 'loc-a', 'A-01', 1), cap('sku-2', 'loc-a', 'A-01', 1)],
      new Map([
        ['sku-1', 2],
        ['sku-2', 1],
      ]),
    );
    expect(shortages.map((s) => [s.shipmentLineId, s.reason])).toEqual([
      ['l1', 'INBOUND_PENDING'],
      ['l2', 'STOCK_SHORT'],
    ]);
  });

  it('적치 대기분은 줄 사이에 누적 소진된다 — 둘째 줄은 남은 대기분으로 판정', () => {
    const { shortages } = allocateLines(
      [line('l1', 'sku', 2), line('l2', 'sku', 2)],
      [],
      new Map([['sku', 3]]),
    );
    expect(shortages.map((s) => s.reason)).toEqual(['INBOUND_PENDING', 'STOCK_SHORT']);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.spec.ts`
Expected: FAIL — `allocateLines` 가 배열을 돌려주고 모자라면 던진다(`drafts` undefined / ConflictException).

- [ ] **Step 4: 구현** — `allocate-lines.ts` 를 통째로 바꾼다:

```ts
import { LineShortage, SourceCapacity } from './allocation.types';

export interface AllocatableLine {
  id: string;
  skuId: string;
  qty: number;
  workItemId: string;
}

export interface AllocationDraft {
  workItemId: string;
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
}

export interface AllocationOutcome {
  drafts: AllocationDraft[];
  shortages: LineShortage[];
}

const byId = (left: { id: string }, right: { id: string }) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/** 로케이션 코드 순, 같은 코드(다른 창고는 오지 않는다)면 id 순 — 사람이 읽는 순서이자 결정적 순서. */
const byCode = (left: SourceCapacity, right: SourceCapacity) =>
  left.locationCode < right.locationCode
    ? -1
    : left.locationCode > right.locationCode
      ? 1
      : left.sourceLocationId < right.sourceLocationId
        ? -1
        : left.sourceLocationId > right.sourceLocationId
          ? 1
          : 0;

/**
 * 배정 전략의 단일 지점(스펙 E8). 나중에 동선·오래된 재고 먼저 등으로 고도화할 때 이 함수만 바꾼다.
 *
 * 1. 줄은 줄 id 순(결정적)
 * 2. 한 로케이션에서 줄 전량을 채울 수 있으면 그런 곳 중 코드 순 첫째
 * 3. 아니면 코드 순으로 나눠 채운다
 *
 * 모자라도 던지지 않고 모자란 줄을 **전부** 돌려준다(스펙 §6 «사유는 전부»). shortages 가 하나라도 있으면 호출자는
 * drafts 를 쓰지 않는다. 사유는 SKU 별 적치 대기분을 줄 순서대로 누적 소진하며 가른다 — 대기분으로 채워지면
 * INBOUND_PENDING(적치하면 풀린다), 아니면 STOCK_SHORT.
 * 입력 용량은 복사해서 깎는다: 호출자가 같은 용량 목록을 다시 쓰는 일이 있다.
 */
export function allocateLines(
  lines: readonly AllocatableLine[],
  capacities: readonly SourceCapacity[],
  inboundPendingBySku: ReadonlyMap<string, number> = new Map(),
): AllocationOutcome {
  const remaining = capacities.map((capacity) => ({ ...capacity }));
  const pending = new Map(inboundPendingBySku);
  const drafts: AllocationDraft[] = [];
  const shortages: LineShortage[] = [];
  for (const line of [...lines].sort(byId)) {
    const sources = remaining
      .filter((source) => source.skuId === line.skuId && source.remainingQty > 0)
      .sort(byCode);
    const whole = sources.find((source) => source.remainingQty >= line.qty);
    let needed = line.qty;
    for (const source of whole ? [whole] : sources) {
      if (needed === 0) break;
      const quantity = Math.min(needed, source.remainingQty);
      drafts.push({
        workItemId: line.workItemId,
        shipmentLineId: line.id,
        sourceLocationId: source.sourceLocationId,
        qty: quantity,
        sourceStockVersion: source.stockVersion,
      });
      source.remainingQty -= quantity;
      needed -= quantity;
    }
    if (needed > 0) {
      const inbound = pending.get(line.skuId) ?? 0;
      pending.set(line.skuId, Math.max(0, inbound - needed));
      shortages.push({
        workItemId: line.workItemId,
        shipmentLineId: line.id,
        skuId: line.skuId,
        requiredQty: line.qty,
        shortQty: needed,
        reason: inbound >= needed ? 'INBOUND_PENDING' : 'STOCK_SHORT',
      });
    }
  }
  return { drafts, shortages };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.spec.ts`
Expected: PASS (10 tests). `batch-start.ts` 는 아직 옛 반환형을 쓰므로 type-check 는 Task 2 에서 초록이 된다 — 이 태스크에서는 커밋하지 않고 Task 2 와 한 커밋으로 묶는다(중간 커밋이 type-check 를 깨지 않게).

---

### Task 2: 배치 시작 — 전부 아니면 전무, 사유는 전부

**Files:**
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.types.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.errors.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.locks.ts` (`assertStartEligibility`, `lockSourceCapacities`, 신규 `describeStartBlockers`)
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/batch-start.ts`
- Test: `apps/core/src/modules/fulfillment/picking/allocation/batch-start.spec.ts`
- Test: `apps/core/src/modules/fulfillment/picking/allocation/batch-start.integration.spec.ts`
- Test: `apps/core/src/modules/fulfillment/services/inbound-origin-planning.integration.spec.ts`, `services/outbound-preparation.concurrency.integration.spec.ts` (`PICKING_SOURCE_INSUFFICIENT` 기대를 교체)

**Interfaces:**
- Consumes: Task 1 `allocateLines`, `LineShortage`
- Produces (PR 2 가 기댄다 — 스펙 §15 «실패 사유 표»):
  - `type StartBlockReason = StartShortReason | 'WAYBILL_NOT_READY'`
  - `StartBlocker { shipmentId; reason; shipmentLineId: string|null; skuId: string|null; requiredQty: number|null; shortQty: number|null; detail: string|null }`
  - `StartBlockerView = StartBlocker & { trackingNo: string|null; skuCode: string|null; skuName: string|null }`
  - `startBlocked(batchId, blockers: StartBlockerView[]): ConflictException` — 응답 `{ code: 'BATCH_START_BLOCKED', message, errors: StartBlockerView[] }`(전역 필터가 `errors` 를 그대로 싣는다 — `libs/shared/src/filters/http-exception.filter.ts`)
  - `assertStartEligibility(...): Promise<StartBlocker[]>` — 송장 문제는 던지지 않고 모은다. 그 밖(프로필·예약·상태)은 지금처럼 던진다(스펙 §6 «기존 사유: 기존 코드 그대로»)
  - `lockSourceCapacities(...): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }>`
  - `describeStartBlockers(trx, blockers): Promise<StartBlockerView[]>`

- [ ] **Step 1: 타입·오류 생성자** — `allocation.types.ts` 끝에 추가:

```ts
export type StartBlockReason = StartShortReason | 'WAYBILL_NOT_READY';

/** 시작(PR 2 부터는 합류도)을 막은 박스 하나의 사유. 줄 단위 사유면 줄·SKU·수량이 채워진다. */
export interface StartBlocker {
  shipmentId: string;
  reason: StartBlockReason;
  shipmentLineId: string | null;
  skuId: string | null;
  requiredQty: number | null;
  shortQty: number | null;
  /** WAYBILL_NOT_READY 의 원 메시지(`WAYBILL_STALE: …` 등). 줄 사유면 null. */
  detail: string | null;
}

/** 응답용 — 현장이 읽을 수 있게 송장 번호·SKU 코드·이름을 붙인다. */
export interface StartBlockerView extends StartBlocker {
  trackingNo: string | null;
  skuCode: string | null;
  skuName: string | null;
}
```

`allocation.errors.ts` 에 추가:

```ts
import type { StartBlockerView } from './allocation.types';

/**
 * 시작 거절 — 아무것도 쓰지 않았다. `errors` 는 전역 필터가 응답 본문에 그대로 싣는 필드다(`details` 는
 * 준비 차단 전용 허용 목록이라 쓰지 않는다).
 */
export function startBlocked(batchId: string, blockers: StartBlockerView[]): ConflictException {
  return new ConflictException({
    code: 'BATCH_START_BLOCKED',
    message: `Batch ${batchId} cannot start: ${blockers.length} blocker(s)`,
    errors: blockers,
  });
}
```

- [ ] **Step 2: 단위 스펙을 먼저 바꾼다(실패)** — `batch-start.spec.ts` 의 `beforeEach` 모킹을 새 반환형으로 바꾸고, 차단 경로 테스트를 더한다. `beforeEach` 안:

```ts
  mockedLocks.assertStartEligibility.mockResolvedValue([]);
  mockedLocks.lockSourceCapacities.mockResolvedValue({
    capacities: [
      { skuId: 'sku-1', sourceLocationId: 'loc-1', locationCode: 'A-01', stockVersion: 3, remainingQty: 10 },
    ],
    inboundPendingBySku: new Map(),
  });
  mockedLocks.describeStartBlockers.mockImplementation(async (_trx, blockers) =>
    blockers.map((blocker) => ({ ...blocker, trackingNo: null, skuCode: null, skuName: null })),
  );
```

(기존 `lockSourceCapacities.mockResolvedValue([...])` 는 위 모양으로 옮긴다 — 기존 용량 값이 있으면 그대로 `capacities` 안에 `locationCode` 만 더해 넣는다.) 새 테스트:

```ts
  it('모자란 줄이 있으면 배정·세션·started_at 을 아무것도 쓰지 않고 BATCH_START_BLOCKED 로 전부 보고한다', async () => {
    const { trx, inserted, updated } = fakeTrx([[{ id: 'batch-1', startedAt: null, status: 'created' }], [
      { shipmentId: 'shp-1' },
      { shipmentId: 'shp-2' },
    ], []]);
    trxHolder.trx = trx;
    mockedLocks.lockSourceCapacities.mockResolvedValue({ capacities: [], inboundPendingBySku: new Map([['sku-1', 2]]) });
    mockedLocks.assertStartEligibility.mockResolvedValue([
      { shipmentId: 'shp-2', reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, requiredQty: null, shortQty: null, detail: 'WAYBILL_STALE: x' },
    ]);
    const d = deps();

    const error = await startBatchPicking(d, 'discrete', { batchId: 'batch-1', actorId: 'actor', idempotencyKey: 'k' }).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as { code: string; errors: Array<{ shipmentId: string; reason: string }> };
    expect(body.code).toBe('BATCH_START_BLOCKED');
    expect(body.errors.map((b) => [b.shipmentId, b.reason])).toEqual([
      ['shp-1', 'INBOUND_PENDING'],
      ['shp-2', 'STOCK_SHORT'],
      ['shp-2', 'WAYBILL_NOT_READY'],
    ]);
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
    expect(d.sessions.startSession).not.toHaveBeenCalled();
  });
```

(`aggregate` 상수의 줄은 `line-1`(shp-1, qty 2)·`line-2`(shp-2, qty 1) 이다. 대기분 2 는 line-1 을 덮고 line-2 는 못 덮는다. 이 단위 스펙에서 `describeStartBlockers` 는 정렬하지 않는 통과 모킹이라 기대 순서는 조립 순서 — 줄 부족(줄 id 순) 다음 송장 차단 — 이다. 실제 정렬(박스 → 사유 → 줄)은 통합 스펙이 본다. `fakeTrx` 의 select 큐는 기존 성공 테스트가 쓰는 순서를 그대로 따라 맞춘다: 배치 행 → 시작 가능 작업 항목 → `assertNoOpenSession`.)

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/batch-start.spec.ts`
Expected: FAIL — `describeStartBlockers` 가 없어 모킹 불가 / 타입 불일치.

- [ ] **Step 3: `allocation.locks.ts` 수정**

`assertStartEligibility` 반환형을 `Promise<StartBlocker[]>` 로 바꾼다. 함수 맨 앞에 `const blockers: StartBlocker[] = [];` 를 두고, 박스 루프 안의 송장 검사를 다음으로 바꾼다:

```ts
    try {
      await waybills.assertDispatchable(shipment.id, trx);
    } catch (error) {
      // 송장 문제는 박스 사유로 모은다(스펙 §6 WAYBILL_NOT_READY). 인증·SQL 오류는 그대로 샌다.
      if (!(error instanceof ConflictError)) throw error;
      blockers.push({
        shipmentId: shipment.id,
        reason: 'WAYBILL_NOT_READY',
        shipmentLineId: null,
        skuId: null,
        requiredQty: null,
        shortQty: null,
        detail: error.message,
      });
    }
```

함수 끝(예약 검사 뒤)에 `return blockers;`. `PICKING_WAYBILL_NOT_DISPATCHABLE` 코드는 이 파일에서 사라진다.

`lockSourceCapacities` 를 바꾼다 — 반환형과 코드 조회, 적치 대기분 합산:

```ts
export async function lockSourceCapacities(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  aggregate: LockedAggregate,
): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }> {
  // …기존 SKU 잠금·원장 FOR UPDATE 조회 그대로…
  // 코드는 잠그지 않고 따로 읽는다 — 원장 조회에 조인하면 FOR UPDATE 가 locations 행까지 잠근다.
  const locationIds = uniqueSorted(ledgers.map((ledger) => ledger.locationId));
  const codes = locationIds.length
    ? await trx
        .select({ id: wmsTables.locations.id, code: wmsTables.locations.code })
        .from(wmsTables.locations)
        .where(inArray(wmsTables.locations.id, locationIds))
    : [];
  const codeById = new Map(codes.map((row) => [row.id, row.code]));
  const capacities: SourceCapacity[] = [];
  const inboundPendingBySku = new Map<string, number>();
  for (const ledger of ledgers) {
    const availability = await controlledStock.getAvailability(/* 기존 인자 그대로 */);
    if (availability.stockVersion !== ledger.version) {
      throw conflict('PICKING_SOURCE_STALE', 'Source stock changed while locking capacity');
    }
    inboundPendingBySku.set(ledger.skuId, (inboundPendingBySku.get(ledger.skuId) ?? 0) + availability.inboundPendingQty);
    if (availability.generallyAvailableQty > 0) {
      capacities.push({
        skuId: ledger.skuId,
        sourceLocationId: ledger.locationId,
        // holds because locations.id is the FK target of stock_ledgers.location_id (restrict), read in the same tx.
        locationCode: codeById.get(ledger.locationId)!,
        stockVersion: ledger.version,
        remainingQty: availability.generallyAvailableQty,
      });
    }
  }
  return { capacities, inboundPendingBySku };
}
```

파일 끝에 `describeStartBlockers` 를 더한다(단위 스펙이 이 모듈을 통째로 모킹하므로 여기 둔다 — 헤더 주석의 «시작 진입점 테스트가 갈아끼울 수 있어야 한다» 와 같은 이유):

```ts
/**
 * 차단 목록에 현장이 읽을 이름을 붙이고 정렬한다(박스 → 사유 → 줄). 잠그지 않는다 — 거절 직전의 설명일 뿐이다.
 */
export async function describeStartBlockers(trx: DbTx, blockers: StartBlocker[]): Promise<StartBlockerView[]> {
  const skuIds = uniqueSorted(blockers.flatMap((blocker) => (blocker.skuId ? [blocker.skuId] : [])));
  const shipmentIds = uniqueSorted(blockers.map((blocker) => blocker.shipmentId));
  const skus = skuIds.length
    ? await trx
        .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
        .from(wmsTables.skus)
        .where(inArray(wmsTables.skus.id, skuIds))
    : [];
  const waybills = await trx
    .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
    .from(wmsTables.waybills)
    .where(
      and(
        inArray(wmsTables.waybills.shipmentId, shipmentIds),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    );
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const trackingByShipment = new Map(waybills.map((row) => [row.shipmentId, row.trackingNo]));
  const order: Record<StartBlockReason, number> = { INBOUND_PENDING: 0, STOCK_SHORT: 1, WAYBILL_NOT_READY: 2 };
  return blockers
    .map((blocker) => ({
      ...blocker,
      trackingNo: trackingByShipment.get(blocker.shipmentId) ?? null,
      skuCode: blocker.skuId ? (skuById.get(blocker.skuId)?.code ?? null) : null,
      skuName: blocker.skuId ? (skuById.get(blocker.skuId)?.name ?? null) : null,
    }))
    .sort(
      (left, right) =>
        left.shipmentId.localeCompare(right.shipmentId) ||
        order[left.reason] - order[right.reason] ||
        (left.shipmentLineId ?? '').localeCompare(right.shipmentLineId ?? ''),
    );
}
```

import 추가: `notInArray` (drizzle-orm), `WAYBILL_TERMINAL_STATUSES` (`../../waybill/waybill.constants`), `StartBlocker`, `StartBlockReason`, `StartBlockerView`.

- [ ] **Step 4: `batch-start.ts` — 한 번에 모아 거절**

`assertStartEligibility` 호출부터 `allocateLines` 까지를 다음으로 바꾼다:

```ts
      const waybillBlockers = await assertStartEligibility(trx, deps.waybills, aggregate, shipmentIds);

      const workItemByShipment = new Map(aggregate.workItems.map((item) => [item.shipmentId, item.id]));
      const shipmentByLine = new Map(aggregate.lines.map((line) => [line.id, line.shipmentId]));
      const { capacities, inboundPendingBySku } = await lockSourceCapacities(trx, deps.controlledStock, aggregate);
      const { drafts, shortages } = allocateLines(
        aggregate.lines.map((line) => ({
          id: line.id,
          skuId: line.skuId,
          qty: line.qty,
          // holds because assertStartEligibility already proved the startable (queued·picking) work-item set equals
          // the requested shipment set, so every line's shipmentId has a matching work item.
          workItemId: workItemByShipment.get(line.shipmentId)!,
        })),
        capacities,
        inboundPendingBySku,
      );
      const blockers: StartBlocker[] = [
        ...shortages.map((shortage) => ({
          // holds because every shortage came from aggregate.lines, which built shipmentByLine.
          shipmentId: shipmentByLine.get(shortage.shipmentLineId)!,
          reason: shortage.reason,
          shipmentLineId: shortage.shipmentLineId,
          skuId: shortage.skuId,
          requiredQty: shortage.requiredQty,
          shortQty: shortage.shortQty,
          detail: null,
        })),
        ...waybillBlockers,
      ];
      // 전부 아니면 전무(스펙 §6): 여기서 던지면 commands.execute 의 트랜잭션이 통째로 되돌아간다.
      if (blockers.length) throw startBlocked(input.batchId, await describeStartBlockers(trx, blockers));
```

import 에 `startBlocked`, `describeStartBlockers`, `StartBlocker` 추가. 나머지(insert·세션 인계·`started_at`)는 그대로.

- [ ] **Step 5: 단위 스펙 통과**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation`
Expected: PASS. (`allocation.locks.spec.ts` 가 `lockSourceCapacities` 의 옛 반환형을 기대하면 `.capacities` 로 고치고, locations 코드 조회용 select 결과를 가짜 trx 큐에 한 칸 더 넣는다.)

- [ ] **Step 6: 통합 스펙 — 실패부터**

`batch-start.integration.spec.ts` 의 `PICKING_SOURCE_INSUFFICIENT` 기대를 `BATCH_START_BLOCKED` 로 바꾸고, 다음 세 시나리오를 더한다(모두 `inRollbackTx`):

```ts
  it('한 박스는 두 로케이션을 합쳐 채워지고 다른 박스는 모자라면 — 모자란 박스만 보고하고 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      // first 2개 + second 4개 = 6, 재고 5 → second 가 1 모자란다(STOCK_SHORT)
      const { first, second } = await seedTwoBoxBatch(tx, 4, 5);
      const { picking } = assembleOutbound(tx);
      const error = await picking
        .start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ response: { code: 'BATCH_START_BLOCKED' } });
      const errors = (error as { response: { errors: Array<Record<string, unknown>> } }).response.errors;
      expect(errors).toEqual([
        expect.objectContaining({ shipmentId: second.shipmentId, reason: 'STOCK_SHORT', requiredQty: 4, shortQty: 1, skuCode: second.skuCode }),
      ]);
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(rawSql`${wmsTables.pickingSourceAllocations.workItemId} IN (${first.workItemId}::uuid, ${second.workItemId}::uuid)`);
      expect(allocations).toEqual([]);
      const [batch] = await tx.select().from(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, first.batchId));
      expect(batch.startedAt).toBeNull();
    });
  });

  it('송장이 무효인 박스와 재고가 모자란 박스를 한 번에 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 4, 5);
      await tx.update(wmsTables.waybills).set({ status: 'voided', voidedAt: new Date() }).where(eq(wmsTables.waybills.id, first.waybillId));
      const { picking } = assembleOutbound(tx);
      const error = await picking
        .start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx)
        .catch((e: unknown) => e);
      const reasons = (error as { response: { errors: Array<{ shipmentId: string; reason: string }> } }).response.errors
        .map((b) => [b.shipmentId, b.reason])
        .sort();
      expect(reasons).toEqual([[first.shipmentId, 'WAYBILL_NOT_READY'], [second.shipmentId, 'STOCK_SHORT']].sort());
    });
  });

  it('E8: 한 로케이션에서 전량 가능한 곳이 있으면 코드가 앞선 1개짜리 로케이션을 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      // 픽스처 로케이션 코드는 `SIMPLE-ZONE-…` — 그보다 앞서는 `AAA-…` 에 1개를 둔다
      const [early] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: box.warehouseId, code: `AAA-${randomUUID()}`, locationType: 'zone' })
        .returning();
      await tx.insert(wmsTables.stockLedgers).values({ skuId: box.skuId, warehouseId: box.warehouseId, locationId: early.id, stockState: 'ON_HAND', qty: 1 });
      const { picking } = assembleOutbound(tx);
      await picking.start({ batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      expect(allocations.map((row) => [row.sourceLocationId, row.qty])).toEqual([[box.locationId, 2]]);
    });
  });
```

import 에 `seedPickableShipment`(`../../services/__support__`) 추가. `inbound-origin-planning.integration.spec.ts` 의 `PICKING_SOURCE_INSUFFICIENT` 기대는 `{ response: { code: 'BATCH_START_BLOCKED', errors: [expect.objectContaining({ reason: 'INBOUND_PENDING' })] } }` 로 바꾼다 — 그 스펙이 만드는 상황(입고 등록됐지만 적치 전)이 바로 INBOUND_PENDING 이다. `outbound-preparation.concurrency.integration.spec.ts` 의 `PICKING_SOURCE_INSUFFICIENT` 기대는 Task 3 에서 그 테스트째 다시 판정하므로 여기서는 `BATCH_START_BLOCKED` 로만 바꾼다.

- [ ] **Step 7: 통합 스펙 통과**

Run: `npm run test:core:integration:local -- 'batch-start.integration|inbound-origin-planning'`
Expected: PASS. (로컬 core DB 에 다른 브랜치 마이그 잔재가 있으면 `drizzle-kit migrate` 가 조용히 exit 1 한다 — 그때는 빈 DB 를 만들어 `LOCAL_PG` 로 돌린다.)

- [ ] **Step 8: 커밋 (Task 1 + 2)**

```bash
npm run type-check
git add apps/core/src/modules/fulfillment/picking/allocation apps/core/src/modules/fulfillment/services/inbound-origin-planning.integration.spec.ts apps/core/src/modules/fulfillment/services/outbound-preparation.concurrency.integration.spec.ts
git commit -m "feat(fulfillment): 배치 시작이 E8 규칙으로 배정하고 막힌 박스·사유를 전부 보고한다 (#987)"
```

---

### Task 3: 배치 시작 입구는 하나 — `prepare` 의 지연 시작 제거

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/simple-outbound.service.ts` (`prepare`, `preparationFailure`)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-preparation.locks.ts` (`lockPreparation` 삭제)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-preparation-result.ts` (`BATCH_NOT_STARTED` — 타입과 런타임 배열 **둘 다**)
- Modify: `libs/shared/src/filters/http-exception.filter.ts` (준비 차단 사유 허용 목록 — 세 번째 사본)
- Modify: `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts` (`OutboundBatchV2ListItemDto.startedAt`), `services/outbound-batch-orchestrator.service.ts` `listBatches`
- Create: `apps/core/src/modules/fulfillment/picking/allocation/batch-start-entry.guard.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts` (`startBatchFor`)
- Test: 지연 시작에 기대던 통합 스펙 — `services/simple-outbound.service.integration.spec.ts`, `services/outbound-preparation.integration.spec.ts`, `services/outbound-preparation.concurrency.integration.spec.ts`, `services/location-outbound.service.integration.spec.ts`, `services/outbound-v2-warehouse-scenarios.integration.spec.ts`, `reader/shipment-waybill.reader.integration.spec.ts`, `inventory/core/controllers/warehouse-demo-workflow-http.integration.spec.ts`

**Interfaces:**
- Produces: `PreparationBlockReason` 에 `'BATCH_NOT_STARTED'`(recovery 는 `review_batch`). `startBatchFor(tx, fixture: { batchId: string; actorId: string })`(테스트 지원). `OutboundBatchV2ListItemDto.startedAt: Date | null`

- [ ] **Step 1: 가드 스펙을 먼저 쓴다(실패)** — `batch-start-entry.guard.spec.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 스펙 §5 «배치 시작 입구는 하나» — 명시적 시작 명령(`POST /picking/v2/starts`)만 배치를 시작한다.
 * `prepare` 가 첫 스캔의 부수효과로 배치를 시작하던 경로(지연 시작)가 되살아나면 송장 출력 전에 배정이
 * 바뀌는 구조로 돌아간다.
 */
const ROOT = join(__dirname, '../../../../../../..');
const SRC = join(ROOT, 'apps/core/src');

// 테스트 지원(`__support__`)은 명시적 시작을 대신 불러 주는 곳이라 대상이 아니다(`startBatchFor`).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__support__' ? [] : walk(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function filesMatching(pattern: RegExp): string[] {
  return walk(SRC)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('배치 시작 입구', () => {
  it('startBatchPicking 을 부르는 곳은 PickingProcessService 하나뿐이다', () => {
    expect(filesMatching(/\bstartBatchPicking\(/)).toEqual([
      'apps/core/src/modules/fulfillment/picking/allocation/batch-start.ts',
      'apps/core/src/modules/fulfillment/services/picking-process.service.ts',
    ]);
  });

  it('PickingProcessService.start 를 부르는 곳은 시작 컨트롤러뿐이다', () => {
    expect(filesMatching(/\bpicking\.start\(/)).toEqual([
      'apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts',
    ]);
  });

  it('지연 시작의 잠금 헬퍼는 사라졌다', () => {
    expect(filesMatching(/\blockPreparation\b/)).toEqual([]);
  });
});
```

(`ROOT` 계산은 이 파일 위치에서 저장소 루트까지 7단계다: `allocation → picking → fulfillment → modules → src → core → apps → 루트`. 기존 `no-picking-plan-references.spec.ts` 의 `ROOT` 정의를 열어 같은 방식으로 맞춘다.)

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/batch-start-entry.guard.spec.ts`
Expected: FAIL — `simple-outbound.service.ts` 가 `picking.start(` 와 `lockPreparation` 을 쓴다.

- [ ] **Step 2: 준비 차단 사유 `BATCH_NOT_STARTED` 를 세 곳에 더한다**

`outbound-preparation-result.ts`: 타입 유니온과 런타임 `reasons` 배열 **둘 다**에 `'BATCH_NOT_STARTED'` 를 더한다(`preparationBlocked` 는 이 사유에 `review_batch` 를 준다 — 기존 규칙 그대로면 코드 변경 없음). `libs/shared/src/filters/http-exception.filter.ts` 의 `SIMPLE_OUTBOUND_PLAN_INVALIDATED` 사유 허용 배열에도 `'BATCH_NOT_STARTED'` 를 더한다 — 빠지면 앱이 `details` 를 못 받아 «배치 화면에서 작업 시작» 문구 대신 일반 충돌 문구를 띄운다. 그 필터에 스펙이 있으면(`libs/shared/src/filters/*.spec.ts`) 사유 하나를 더한 케이스를 넣는다.

- [ ] **Step 3: `prepare` 에서 지연 시작 분기를 지운다**

`SimpleOutboundService.prepare` 를 다음 모양으로 줄인다(시작된 배치 분기는 그대로 둔다):

```ts
  async prepare(
    shipmentId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: OutboundCommandKey,
    tx: DbTx,
  ): Promise<OutboundPreparationResult> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.prepare');
    if (!actor?.id) throw new UnauthorizedException('Authenticated actor is required');
    const initial = await this.loadWorkItem(shipmentId, tx);
    await this.assertBatchMethodSupported(initial.batchId, tx);
    // 배치 시작은 배치 카드의 「작업 시작」(POST /picking/v2/starts) 하나뿐이다(스펙 §6). 첫 스캔이 배치를 시작하던
    // 지연 시작은 송장 출력보다 배정이 늦게 일어나는 원인이라 없앴다.
    if (!(await isBatchStarted(initial.batchId, tx))) {
      return preparationBlocked(initial.batchId, null, 'BATCH_NOT_STARTED');
    }
    // 시작된 배치: 작업 항목 → 세션 순서를 지킨다.
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, initial.id))
      .for('update');
    if (
      !workItem ||
      workItem.batchId !== initial.batchId ||
      !(PICKABLE_WORK_ITEM_STATUSES as readonly string[]).includes(workItem.status)
    )
      throw this.conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Active preparation changed while acquiring work item');
    const sessionId = await activePreparationSession(workItem.batchId, tx);
    if (!sessionId) return preparationBlocked(workItem.batchId, null, 'ACTIVE_WORK_REQUIRES_REVIEW');
    return this.claimPrepared(workItem, sessionId, actor, idempotencyKey, tx);
  }
```

그 뒤: `preparationFailure` 는 호출자가 없어지므로 삭제. `lockPreparation` import 삭제, `outbound-preparation.locks.ts` 에서 `lockPreparation` 함수 삭제(그 함수만 쓰던 import 도). `PickingStartResult`·`nestedCommandKey`·`UNSTARTED_BATCH_WORK_ITEM_STATUSES` 등이 이 파일에서 더 이상 안 쓰이면 import 정리. `this.picking` 이 `pickScanned`·`settleIfFullyPicked`·`completeAndForceDispatch` 에서 여전히 쓰이는지 확인한다(쓰인다 — `picking.scan`·`picking.completePick`). `this.invariant` 가 더 이상 안 쓰이면 `npm run type-check` 가 알려 준다 — 그때만 생성자에서 빼고 `simple-outbound-wiring.ts` 의 `new SimpleOutboundService(...)` 인자도 뺀다. `loadWorkItem` 근처의 «`.for('update')` 라서» 라는 낡은 주석(실제로는 잠그지 않는다)은 «잠그지 않는다 — 시작된 배치 분기가 따로 잠근다» 로 고친다.

- [ ] **Step 4: 가드 스펙 통과 + 단위 스펙**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/batch-start-entry.guard.spec.ts apps/core/src/modules/fulfillment/services/outbound-preparation-result.spec.ts apps/core/src/modules/fulfillment/services/simple-outbound`
Expected: PASS. 단위 스펙이 `prepare` 의 지연 시작(가짜 `picking.start` 호출 기대)을 검사하고 있으면 그 테스트를 «시작 안 된 배치면 `preparation_blocked` · `BATCH_NOT_STARTED` · `review_batch` 를 돌려주고 `picking.start` 를 부르지 않는다» 로 바꾼다.

- [ ] **Step 5: 목록에 `startedAt`** — `OutboundBatchV2ListItemDto` 에:

```ts
  @ApiPropertyOptional({ type: Date, nullable: true, description: '「작업 시작」 시각. null 이면 시작 전 — 송장 인쇄를 켜지 않는다' })
  startedAt: Date | null;
```

`listBatches` 의 map 에 `startedAt: batch.startedAt,` 한 줄(`scheduledPickingAt` 옆). `outbound-batch-orchestrator.service.spec.ts`·`outbound-batch-v2.controller.spec.ts` 가 목록 모양을 `toEqual` 로 고정하고 있으면 `startedAt: null` 을 더한다.

- [ ] **Step 6: 통합 스펙을 명시적 시작으로 옮긴다**

`simple-outbound-wiring.ts` 에 추가:

```ts
/** 「작업 시작」 — 지연 시작이 사라져 prepare 전에 반드시 불러야 한다(스펙 §6). */
export async function startBatchFor(tx: DbTx, fixture: { batchId: string; actorId: string }) {
  return assembleOutbound(tx).picking.start(
    { batchId: fixture.batchId, actorId: fixture.actorId, idempotencyKey: `start-${randomUUID()}` },
    tx,
  );
}
```

(`randomUUID` 는 `crypto` 에서 import.) 그다음 `npm run test:core:integration:local -- 'fulfillment|warehouse-demo-workflow'` 를 돌리고, 실패마다 둘 중 하나로 판정한다:

- **(a) 시작된 배치가 필요한 흐름**(스캔·강제출고·위치 출고·송장 스캔 조회 등): 픽스처를 만든 직후 `await startBatchFor(tx, fixture);` 한 줄. `seedTwoBoxBatch` 처럼 두 박스가 한 배치면 한 번만 부른다. HTTP 스펙(`warehouse-demo-workflow-http`)은 앱 흐름대로 `POST /picking/v2/starts`(`Idempotency-Key` 헤더, body `{ batchId }`)를 먼저 보낸다.
- **(b) 지연 시작 자체를 검사하던 테스트**(첫 `prepare` 가 배치를 시작한다 / 준비가 `SOURCE_INSUFFICIENT`·`ELIGIBILITY_CHANGED`·`REPLAN_LIMIT_REACHED` 로 막힌다 / 두 첫 준비가 동시에 시작을 다툰다): 그 동작은 사라졌다. 같은 상황을 명시적 시작으로 재현하는 검사가 `batch-start.integration.spec.ts` 에 이미 있으면(Task 2) 삭제하고, 없으면 «시작 안 된 배치의 `prepare` 는 `BATCH_NOT_STARTED` 로 막히고 배정·세션을 만들지 않는다» 한 건으로 바꾼다. 동시 시작 경합은 `picking.start` 두 번(서로 다른 키)이 같은 세션을 돌려주는 기존 멱등 테스트가 덮는다.

지운·바꾼 테스트 이름은 커밋 본문에 목록으로 남긴다(리뷰어가 커버리지 손실을 판정할 수 있게).

Run: `npm run test:core:integration:local -- 'fulfillment|warehouse-demo-workflow'`
Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
npm run type-check && npx jest apps/core/src/modules/fulfillment libs/shared
git add -A apps/core/src/modules/fulfillment apps/core/src/modules/inventory/core/controllers/warehouse-demo-workflow-http.integration.spec.ts libs/shared/src/filters
git commit -m "feat(fulfillment): 배치는 「작업 시작」으로만 시작한다 — prepare 의 지연 시작 제거, BATCH_NOT_STARTED (#987)"
```

---

### Task 4: 송장 내용과 출력 시점 값 분리, 품목 줄 = 배정 행, 지문

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/label/label-items.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/label/label-fingerprint.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/__support__/hanjin-label-fixture.ts`
- Modify: `scripts/ops/hanjin-label-preview/render.ts` (미리보기 데이터에 새 필드)
- Test: `waybill/label/label-items.spec.ts`(교체), `waybill/carrier/hanjin/label/hanjin-label-data.spec.ts`, Create `waybill/label/label-fingerprint.spec.ts`

**Interfaces:**
- Produces:
  - `LabelItem { locationCode: string; skuId: string; name: string; quantity: number }`
  - `AllocatedLabelRow { locationCode: string; skuId: string; skuName: string; qty: number }`
  - `labelItemsOf(rows: readonly AllocatedLabelRow[]): LabelItem[]` — (로케이션, SKU) 로 합치고 로케이션 코드 → 이름(ko) → skuId 순
  - `HanjinLabelContent`(아래), `HanjinLabelData = HanjinLabelContent & { printedDate: string; revision: number }`
  - `buildHanjinLabelContent({ waybill, ctx, config, items }): HanjinLabelContent`
  - `buildHanjinLabelData({ content, now, revision }): HanjinLabelData`
  - `labelFingerprint(content: HanjinLabelContent): string` (64자 hex)

- [ ] **Step 1: 실패하는 테스트** — `label-items.spec.ts` 의 `labelItemsOf` describe 를 교체(`paginate` describe 는 그대로):

```ts
describe('labelItemsOf — 배정 행을 (로케이션, SKU) 로', () => {
  const row = (locationCode: string, skuId: string, skuName: string, qty: number) => ({ locationCode, skuId, skuName, qty });

  it('같은 로케이션·같은 SKU 는 한 줄로 합친다(한 SKU 의 여러 출고 줄)', () => {
    expect(labelItemsOf([row('A-01', 's1', '볼펜', 1), row('A-01', 's1', '볼펜', 2)])).toEqual([
      { locationCode: 'A-01', skuId: 's1', name: '볼펜', quantity: 3 },
    ]);
  });

  it('같은 SKU 라도 로케이션이 다르면 두 줄 — 집는 곳이 다르다', () => {
    expect(labelItemsOf([row('B-02', 's1', '볼펜', 1), row('A-01', 's1', '볼펜', 2)]).map((i) => [i.locationCode, i.quantity])).toEqual([
      ['A-01', 2],
      ['B-02', 1],
    ]);
  });

  it('로케이션 코드 순 → 이름순(ko) → skuId 순, 입력 순서에 흔들리지 않는다', () => {
    const rows = [row('A-01', 's2', '하마', 1), row('A-01', 's1', '가위', 1), row('A-01', 's3', '가위', 1), row('A-00', 's9', '펜', 1)];
    const items = labelItemsOf(rows);
    expect(items.map((i) => `${i.locationCode}/${i.name}/${i.skuId}`)).toEqual(['A-00/펜/s9', 'A-01/가위/s1', 'A-01/가위/s3', 'A-01/하마/s2']);
    expect(labelItemsOf([...rows].reverse())).toEqual(items);
  });

  it('빈 목록은 빈 목록', () => {
    expect(labelItemsOf([])).toEqual([]);
  });
});
```

`label-fingerprint.spec.ts`:

```ts
import { HANJIN_LABEL_FIXTURE } from '../carrier/hanjin/label/__support__/hanjin-label-fixture';
import type { HanjinLabelContent } from '../carrier/hanjin/label/hanjin-label-data';
import { labelFingerprint } from './label-fingerprint';

// 픽스처는 출력 시점 값까지 가진 HanjinLabelData 다 — 내용만 떼어 낸다.
const { printedDate: _printedDate, revision: _revision, ...CONTENT } = HANJIN_LABEL_FIXTURE;
const content: HanjinLabelContent = CONTENT;

describe('labelFingerprint', () => {
  it('같은 내용이면 같은 64자 hex', () => {
    expect(labelFingerprint(content)).toMatch(/^[0-9a-f]{64}$/);
    expect(labelFingerprint({ ...content })).toBe(labelFingerprint(content));
  });

  it.each([
    ['품목 줄 수량', { items: [{ ...content.items[0], quantity: 9 }, ...content.items.slice(1)] }],
    ['품목 줄 로케이션', { items: [{ ...content.items[0], locationCode: 'Z-99' }, ...content.items.slice(1)] }],
    ['수령인', { recipient: { ...content.recipient, detailAddress: '다른 호수' } }],
    ['배송 메시지(공동현관 비밀번호)', { deliveryMessage: '문앞 (공동현관 #9999)' }],
    ['송장 번호', { trackingNo: '999999999999' }],
  ])('%s 가 바뀌면 달라진다', (_label, patch) => {
    expect(labelFingerprint({ ...content, ...patch })).not.toBe(labelFingerprint(content));
  });
});
```

(«출력 시점 값은 못 들어온다» 는 타입이 지킨다 — `labelFingerprint` 의 매개변수가 `HanjinLabelContent` 이고 그 타입에 `printedDate`·`revision` 이 없다. 이 성질은 `npm run type-check` 가 검증하므로 런타임 테스트를 따로 두지 않는다.)

`hanjin-label-data.spec.ts`: `buildHanjinLabelData({ waybill, ctx, config, now })` 호출을 `buildHanjinLabelContent({ waybill, ctx, config, items })` 로 바꾸고(`items` 는 테스트용 `[{ locationCode: 'A-01', skuId: 's1', name: '토익 Speaking', quantity: 1 }]`), 첫 테스트 «품목 줄은 SKU명·수량, 이름순…» 을 다음으로 교체:

```ts
  it('품목 줄은 조립자가 준 배정 행 그대로 — 한진 등록 품명(주문 상품명)과 별개다', () => {
    const items = [{ locationCode: 'A-01', skuId: 's1', name: 'SKU 이름', quantity: 2 }];
    const content = buildHanjinLabelContent({ waybill: WAYBILL, ctx: CTX, config: CONFIG, items });
    expect(content.items).toEqual(items);
    expect(content.commodityName).not.toBe('SKU 이름');
  });
```

«출력일자는 런타임 TZ 와 무관하게 KST 날짜다» 테스트는 `buildHanjinLabelData({ content, now: new Date('2026-09-27T15:30:00Z'), revision: 1 }).printedDate` 를 `'2026-09-28'` 과 비교하도록 옮기고, 판차 테스트를 하나 더한다:

```ts
  it('출력 시점 값(출력일자·판차)은 buildHanjinLabelData 가 붙인다', () => {
    const content = buildHanjinLabelContent({ waybill: WAYBILL, ctx: CTX, config: CONFIG, items: [] });
    expect(buildHanjinLabelData({ content, now: new Date('2026-09-27T01:00:00Z'), revision: 3 })).toEqual({
      ...content,
      printedDate: '2026-09-27',
      revision: 3,
    });
  });
```

(`WAYBILL`·`CTX`·`CONFIG` 는 그 스펙이 이미 쓰는 상수 이름으로 맞춘다.)

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts`
Expected: FAIL (함수·타입 없음).

- [ ] **Step 2: `label-items.ts` 구현** — `LabelItem`·`labelItemsOf` 를 교체한다(`paginate` 는 그대로, `ManifestLineLite` import 삭제):

```ts
/** 송장 품목 줄 한 줄(스펙 §10.1). 송장이 피킹 지시서라 «어디서 무엇을 몇 개» 가 한 줄이다. */
export interface LabelItem {
  locationCode: string;
  skuId: string;
  name: string;
  quantity: number;
}

/** 배정 행 한 줄 — `WaybillReader.loadLabelAllocation` 이 읽는다. */
export interface AllocatedLabelRow {
  locationCode: string;
  skuId: string;
  skuName: string;
  qty: number;
}

const codepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 배정 행을 (로케이션, SKU) 로 합친다 — 한 SKU 가 출고 줄 여럿(FOI 별)이어도 같은 곳에서 집는 동작은 하나다.
 * 로케이션 코드 순(동선이 코드 순이다) → 이름순 → skuId 순. 입력 순서에 흔들리지 않는다(지문이 이 순서를 먹는다).
 */
export function labelItemsOf(rows: readonly AllocatedLabelRow[]): LabelItem[] {
  const byKey = new Map<string, LabelItem>();
  for (const row of rows) {
    const key = `${row.locationCode}\u0000${row.skuId}`;
    const prev = byKey.get(key);
    if (prev) prev.quantity += row.qty;
    else byKey.set(key, { locationCode: row.locationCode, skuId: row.skuId, name: row.skuName, quantity: row.qty });
  }
  return [...byKey.values()].sort(
    (a, b) => codepoint(a.locationCode, b.locationCode) || a.name.localeCompare(b.name, 'ko') || codepoint(a.skuId, b.skuId),
  );
}
```

- [ ] **Step 3: `hanjin-label-data.ts` 분리**

`HanjinLabelData` 인터페이스를 둘로 나눈다 — `printedDate` 를 뺀 나머지 전부가 `HanjinLabelContent`:

```ts
/** 종이에 그려지는 «내용» — 지문의 입력이다. 출력할 때마다 달라지는 값은 여기 넣지 않는다(스펙 §10.2). */
export interface HanjinLabelContent {
  trackingNo: string;
  trackingNoDisplay: string;
  sort: HanjinSortFields;
  regionText: string; // ⑮
  freightText: string; // ⑬
  recipient: { name: string; phone: string; baseAddress: string; detailAddress: string };
  sender: { name: string; phone: string; baseAddress: string };
  deliveryMessage: string; // ⑭ — 공동현관 비밀번호 포함. 바뀌면 종이가 달라지므로 지문도 바뀐다
  commodityName: string; // 한진 등록 품명과 같은 값 — NS·NL 이 찍는다
  items: LabelItem[]; // (로케이션, SKU) 배정 행 — FS 가 찍는다
  boxType: string; // 운임Type
  custOrdNo: string; // 출고번호
  boxIndex: number; // shipment 하나 = 박스 하나
  boxCount: number;
}

/** 출력 시점 값 — 지문 밖. */
export interface HanjinLabelPrintValues {
  printedDate: string; // YYYY-MM-DD, Asia/Seoul
  /** 판차. 1 이면 종이에 찍지 않는다(스펙 §10.1-4). */
  revision: number;
}

/** 템플릿이 그리는 값 전부 — **마스킹 전 원본**이다. 어느 면에 무엇을 가리는지는 면을 아는 템플릿이 정한다. */
export type HanjinLabelData = HanjinLabelContent & HanjinLabelPrintValues;

export interface BuildHanjinLabelContentInput {
  waybill: Pick<WaybillRow, 'trackingNo' | 'custOrdNo' | 'labelData'>;
  ctx: IssueContext;
  config: HanjinConfig;
  items: readonly LabelItem[];
}
```

`buildHanjinLabelData` 의 본문을 `buildHanjinLabelContent(input: BuildHanjinLabelContentInput): HanjinLabelContent` 로 이름을 바꿔 옮기고, 반환 객체에서 `printedDate` 를 빼며 `items: labelItemsOf(ctx.lines)` 를 `items: [...input.items]` 로 바꾼다. 새 `buildHanjinLabelData`:

```ts
export function buildHanjinLabelData(input: {
  content: HanjinLabelContent;
  now: Date;
  revision: number;
}): HanjinLabelData {
  return { ...input.content, printedDate: kstDate(input.now), revision: input.revision };
}
```

`labelItemsOf` import 는 지우고 `type LabelItem` 만 남긴다.

- [ ] **Step 4: `label-fingerprint.ts`**

```ts
import { canonicalFulfillmentRequestHash } from '../../services/fulfillment-command.service';
import type { HanjinLabelContent } from '../carrier/hanjin/label/hanjin-label-data';

/**
 * 송장 내용 지문(스펙 §10.2) — 정규화 JSON(키 정렬)의 SHA-256. 매개변수가 «내용» 타입이라 출력일자·판차가
 * 섞일 수 없다(타입이 지킨다). 렌더러·출력 확인·게이트가 모두 같은 조립 결과에 이 함수를 쓴다.
 */
export function labelFingerprint(content: HanjinLabelContent): string {
  return canonicalFulfillmentRequestHash(content);
}
```

- [ ] **Step 5: 픽스처·미리보기 갱신**

`hanjin-label-fixture.ts` 의 `HANJIN_LABEL_FIXTURE.items` 를 `[{ locationCode: 'A-01-01', skuId: 'sku-1', name: '토익 Speaking', quantity: 1 }, { locationCode: 'B-02-03', skuId: 'sku-2', name: '펜', quantity: 2 }]` 로, 끝에 `revision: 1,` 추가. `HANJIN_LABEL_LONG_FIXTURE.items` 는 `[{ locationCode: 'Z'.repeat(64), skuId: 'sku-long', name: '가'.repeat(100), quantity: 1 }]`(로케이션 코드 최대 길이 varchar 64 로 템플릿을 괴롭힌다). `scripts/ops/hanjin-label-preview/render.ts` 의 `SAMPLE.items`·`SEVEN_ITEMS` 에 `locationCode`(예: `'A-01-0' + n`)·`skuId` 를 더하고 `SAMPLE` 에 `revision: 1` 을 더한다. FS 템플릿 스펙(`hanjin-fs-template.spec.ts`)의 `ITEMS(n)` 헬퍼도 `{ locationCode: \`A-${i + 1}\`, skuId: \`s${i + 1}\`, name: \`품목${i + 1}\`, quantity: i + 1 }` 로 바꾼다(Task 5 가 그 스펙의 기대를 고친다).

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-label-data.spec.ts`
Expected: PASS. `waybill-label.manager.ts` 는 아직 옛 `buildHanjinLabelData` 를 부르므로 type-check 는 Task 7 에서 초록이 된다 — Task 4·5 는 커밋하지 않고 Task 7 커밋에 합친다.

---

### Task 5: FS 템플릿 — 품목 줄의 `[로케이션]` 접두어와 판차

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.ts`
- Test: `apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts`

**Interfaces:**
- Consumes: Task 4 `LabelItem.locationCode`, `HanjinLabelData.revision`
- Produces: `fsItemNameMaxWidthMm(qty: string, locationPrefixWidthMm = 0): number`, `FS_ITEM_LOCATION_MAX_WIDTH_MM = 30`

- [ ] **Step 1: 실패하는 테스트** — `hanjin-fs-template.spec.ts` 의 «품목 줄·추가 쪽» describe 에서 `namesOn` 을 바꾸고 테스트를 더한다:

```ts
  // 줄 = 접두어 요소(x 4.5, 굵게) 바로 뒤의 이름 요소. svgDocument 는 요소를 구분자 없이 잇는다.
  const rowsOn = (page: LabelSpec) =>
    [...page.svg.matchAll(/<text x="4.5" y="[\d.]+"[^>]*font-weight="700"[^>]*>\[([^\]<]*)\]<\/text><text x="[\d.]+" y="[\d.]+"[^>]*>([^<]*)<\/text>/g)].map(
      (m) => `${m[1]}|${m[2]}`,
    );
  const namesOn = (page: LabelSpec) => rowsOn(page).map((row) => row.split('|')[1]);

  it('품목 줄 이름 앞에 [로케이션 코드] 를 찍는다', () => {
    const [first] = renderHanjinFsLabel({ ...DATA, items: [{ locationCode: 'A-01-01', skuId: 's1', name: '볼펜', quantity: 2 }] });
    expect(rowsOn(first)).toEqual(['A-01-01|볼펜']);
  });

  it('로케이션 코드가 길어도 자르지 않고 줄이며, 이름은 수량 앞에서 멈춘다', () => {
    const code = 'Z'.repeat(64);
    const [first] = renderHanjinFsLabel({ ...DATA, items: [{ locationCode: code, skuId: 's1', name: '가'.repeat(100), quantity: 1000 }] });
    expect(first.svg).toContain(`[${code}]`);
    const name = rowsOn(first)[0].split('|')[1];
    expect(name.endsWith('…')).toBe(true);
  });

  it('판차 2 이상이면 모든 쪽의 쪽 표시 앞에 「N판」, 1 이면 찍지 않는다', () => {
    const twice = renderHanjinFsLabel({ ...DATA, revision: 2, items: ITEMS(5) });
    expect(twice.map((p) => /(\d+판 · \d+\/\d+)/.exec(p.svg)?.[1])).toEqual(['2판 · 1/2', '2판 · 2/2']);
    expect(renderHanjinFsLabel({ ...DATA, revision: 1, items: ITEMS(1) })[0].svg).not.toMatch(/\d+판/);
  });
```

기존 «모든 쪽 같은 자리에 4줄씩, 순서대로» 는 `namesOn` 이 바뀐 것만으로 그대로 통과해야 한다. 기존 «쪽 표시» 테스트는 `DATA.revision` 이 1 이므로 그대로다.

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label/hanjin-fs-template.spec.ts`
Expected: FAIL.

- [ ] **Step 2: 구현** — `hanjin-fs-template.ts`:

```ts
/** 로케이션 접두어 칸의 최대 폭 — 코드는 식별자라 자르지 않고 FS_ITEM_MIN_PT 까지 줄인다. */
export const FS_ITEM_LOCATION_MAX_WIDTH_MM = 30;
const FS_ITEM_LOCATION_GAP_MM = 1.5;

/** 품목 이름 칸 폭 — 수량 앞 FS_ITEM_QTY_GAP_MM 에서 멈춘다. 위치 코드 접두어가 붙으면 그 폭(+간격)을 뺀다. */
export function fsItemNameMaxWidthMm(qty: string, locationPrefixWidthMm = 0): number {
  return FS_ITEM_QTY_X_MM - textWidthMm(qty, FS_ITEM_PT) - FS_ITEM_QTY_GAP_MM - FS_ITEM_X_MM - locationPrefixWidthMm;
}

const round1 = (mm: number) => Math.round(mm * 10) / 10;

function itemElements(items: readonly LabelItem[]): string[] {
  return items.flatMap((item, i) => {
    // 부동소수 꼬리(72.60000000000001)가 svg 좌표에 새지 않게 0.1mm 로 반올림한다.
    const y = round1(FS_ITEM_FIRST_BASELINE_MM + i * FS_ITEM_PITCH_MM);
    const qty = String(item.quantity);
    const prefix = `[${item.locationCode}]`;
    const prefixPt = fitSizePt(prefix, FS_ITEM_LOCATION_MAX_WIDTH_MM, FS_ITEM_PT, FS_ITEM_MIN_PT);
    const prefixWidth = textWidthMm(prefix, prefixPt) + FS_ITEM_LOCATION_GAP_MM;
    const maxWidth = fsItemNameMaxWidthMm(qty, prefixWidth);
    const pt = fitSizePt(item.name, maxWidth, FS_ITEM_PT, FS_ITEM_MIN_PT);
    return [
      text({ x: FS_ITEM_X_MM, y, pt: prefixPt, bold: true, text: prefix }),
      text({ x: round1(FS_ITEM_X_MM + prefixWidth), y, pt, text: fitText(item.name, maxWidth, pt) }),
      text({ x: FS_ITEM_QTY_X_MM, y, pt: FS_ITEM_PT, bold: true, anchor: 'end', text: qty }),
    ];
  });
}
```

`renderHanjinFsLabel` 의 쪽 표시 텍스트:

```ts
        text: `${d.revision >= 2 ? `${d.revision}판 · ` : ''}${i + 1}/${pages.length} · 총 ${d.items.length}건 ${qtySum}개`,
```

판차 자리를 쪽 표시 줄 앞에 둔 이유(주석으로 남긴다): 스펙 §10.1-4 가 «위치는 FS 템플릿 계획에서 실측으로 정한다» 고 했고, 이미 실물 출력으로 자리를 확인한 줄(y 80.6)에 붙이면 새 좌표 실측이 필요 없다. 실물 확인은 Task 15 스모크에 넣는다. NS·NL 은 품목 줄·판차를 그리지 않는다(스펙 §10.2, 운영은 FS).

- [ ] **Step 3: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/waybill/carrier/hanjin/label`
Expected: PASS — 잉크가 바코드 quiet zone 에 들어가지 않는지 보는 기존 불변식 테스트(`label-invariants`, «기본 9줄»·긴 픽스처) 포함. 긴 로케이션 코드(64자)로 불변식 테스트가 깨지면 `FS_ITEM_LOCATION_MAX_WIDTH_MM` 을 줄이지 말고, 그 테스트가 실패한 좌표를 보고 원인을 판정한다(품목 영역은 바코드와 세로로 떨어져 있어 깨지면 좌표 계산 버그다).

---

### Task 6: 출력 기록 — 스키마, 저장소, 순수 정책

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`waybillLabelPrints` 테이블 + `wmsTables` 등록 + 타입)
- Create: `apps/core/drizzle/<timestamp>_add-waybill-label-prints.sql` (+ `drizzle/meta/`) — **생성 명령으로만**
- Create: `apps/core/src/modules/fulfillment/waybill/label/label-print-policy.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/waybill-label-print.repository.ts`
- Test: Create `waybill/label/label-print-policy.spec.ts`, Create `waybill/waybill-label-print.repository.integration.spec.ts`

**Interfaces:**
- Produces:
  - 테이블 `waybill_label_prints(id, shipment_id, fingerprint, revision, items_snapshot, printed_by, printed_at)`, 유니크 (`shipment_id`,`fingerprint`)·(`shipment_id`,`revision`)
  - `LabelPrintRecord { fingerprint: string; revision: number; itemsSnapshot: LabelItem[]; printedAt: Date }`
  - `revisionFor(prints, fingerprint): number`, `latestPrint(prints): LabelPrintRecord | null`
  - `type LabelState = 'current' | 'never_printed' | 'reprint_required' | 'not_started' | 'external' | 'unavailable'`
  - `LabelItemChange { locationCode; skuId; name; printedQty: number; currentQty: number }`, `diffLabelItems(printed, current): LabelItemChange[]`
  - `LabelStateView { state: LabelState; changes: LabelItemChange[]; issue: string | null }`
  - `labelStateOf(input): LabelStateView`
  - `WaybillLabelPrintRepository`: `listByShipments(trx, shipmentIds): Promise<Array<LabelPrintRecord & { shipmentId: string }>>`, `record(trx, row): Promise<LabelPrintRecord>`(같은 지문이면 `printed_at`·`printed_by` 갱신), `lockActiveWorkItem(trx, shipmentId): Promise<{ id: string } | null>`

- [ ] **Step 1: 스키마** — `inventory.schema.ts` 의 `waybills` 정의 바로 뒤에:

```ts
/**
 * 송장 출력 기록(스펙 §10.3) — 앱이 프린터 전송에 성공한 뒤에만 남긴다. 박스(shipment) 단위다: 박스가 다른 배치로
 * 옮겨 가 배정이 바뀌면 지문이 달라지므로 따로 무효화할 것이 없다. 같은 내용(지문)을 다시 출력하면 새 행이 아니라
 * printed_at 을 갱신한다 — «마지막 출력»은 printed_at 으로 가린다(A→B→A 로 되돌아온 박스).
 */
export const waybillLabelPrints = pgTable(
  'waybill_label_prints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    revision: integer('revision').notNull(),
    // «바뀐 줄» 표시용 — 그 판에 찍힌 품목 줄(로케이션·SKU·이름·수량).
    itemsSnapshot: jsonb('items_snapshot').notNull(),
    printedBy: uuid('printed_by').notNull(),
    printedAt: timestamp('printed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqShipmentFingerprint: unique('uq_waybill_label_prints_shipment_fingerprint').on(t.shipmentId, t.fingerprint),
    uqShipmentRevision: unique('uq_waybill_label_prints_shipment_revision').on(t.shipmentId, t.revision),
    ckRevision: check('ck_waybill_label_prints_revision', sql`${t.revision} >= 1`),
    ckFingerprint: check('ck_waybill_label_prints_fingerprint', sql`length(${t.fingerprint}) = 64`),
  }),
);
```

`wmsTables` 객체의 `waybills,` 다음 줄에 `waybillLabelPrints,`. 타입 구역(`// Waybill Types`)에 `export type WaybillLabelPrint = InferSelectModel<typeof waybillLabelPrints>;`. `fulfillment/schema/fulfillment.schema.ts` 머리 주석의 테이블 목록에 `waybill_label_prints` 추가.

- [ ] **Step 2: 마이그레이션 생성** — ⚠️ **메인 세션(또는 사람)이 돌린다. 서브에이전트는 `db:generate` 를 못 돌린다(과거 실측).**

```bash
npm run db:generate:core -- --name add-waybill-label-prints
```

생성된 SQL 을 읽는다: `CREATE TABLE "waybill_label_prints"` + FK 1개 + UNIQUE 2개 + CHECK 2개 **만** 있어야 한다. 다른 테이블의 ALTER 가 섞였으면 스냅샷 체인이 어긋난 것이다 — 파일을 `git rm` 하고 원인(다른 브랜치 스냅샷)을 먼저 푼다. 손으로 고치지 않는다.

- [ ] **Step 3: 순수 정책 — 실패하는 테스트** `label-print-policy.spec.ts`:

```ts
import { diffLabelItems, labelStateOf, latestPrint, revisionFor } from './label-print-policy';

const item = (locationCode: string, skuId: string, quantity: number, name = skuId) => ({ locationCode, skuId, name, quantity });
const print = (fingerprint: string, revision: number, printedAt: string, itemsSnapshot = [item('A', 's1', 1)]) => ({
  fingerprint,
  revision,
  itemsSnapshot,
  printedAt: new Date(printedAt),
});

describe('revisionFor', () => {
  it('첫 판은 1', () => expect(revisionFor([], 'f1')).toBe(1));
  it('같은 지문이 출력된 적 있으면 그 판차', () => {
    expect(revisionFor([print('f1', 1, '2026-09-30T00:00:00Z'), print('f2', 2, '2026-09-30T01:00:00Z')], 'f1')).toBe(1);
  });
  it('새 지문이면 최대 판차 + 1', () => {
    expect(revisionFor([print('f1', 1, '2026-09-30T00:00:00Z'), print('f2', 2, '2026-09-30T01:00:00Z')], 'f3')).toBe(3);
  });
});

describe('latestPrint', () => {
  it('없으면 null', () => expect(latestPrint([])).toBeNull());
  it('printed_at 이 가장 늦은 기록 — 판차가 아니다(A→B→A 로 A 를 다시 출력한 박스)', () => {
    const a = print('fa', 1, '2026-09-30T03:00:00Z');
    const b = print('fb', 2, '2026-09-30T02:00:00Z');
    expect(latestPrint([b, a])?.fingerprint).toBe('fa');
  });
});

describe('diffLabelItems', () => {
  it('(로케이션, SKU) 로 맞춰 수량이 다른 줄만, 로케이션 코드 순', () => {
    expect(
      diffLabelItems([item('A', 's1', 2), item('B', 's2', 1)], [item('A', 's1', 2), item('C', 's2', 1)]),
    ).toEqual([
      { locationCode: 'B', skuId: 's2', name: 's2', printedQty: 1, currentQty: 0 },
      { locationCode: 'C', skuId: 's2', name: 's2', printedQty: 0, currentQty: 1 },
    ]);
  });
});

describe('labelStateOf', () => {
  const printable = { kind: 'printable' as const, fingerprint: 'f2', items: [item('A', 's1', 3)] };
  it.each([
    ['시작 전 배치', { batchStarted: false, current: printable, prints: [] }, 'not_started'],
    ['앱이 못 그리는 송장', { batchStarted: true, current: { kind: 'external' as const }, prints: [] }, 'external'],
    ['조립 실패', { batchStarted: true, current: { kind: 'unavailable' as const, issue: 'WAYBILL_STALE' }, prints: [] }, 'unavailable'],
    ['출력 기록 없음', { batchStarted: true, current: printable, prints: [] }, 'never_printed'],
    ['마지막 출력 = 현재', { batchStarted: true, current: printable, prints: [print('f2', 1, '2026-09-30T00:00:00Z')] }, 'current'],
    ['지문이 바뀜', { batchStarted: true, current: printable, prints: [print('f1', 1, '2026-09-30T00:00:00Z')] }, 'reprint_required'],
  ])('%s → %s', (_label, input, state) => {
    expect(labelStateOf(input).state).toBe(state);
  });

  it('reprint_required 는 마지막 출력 스냅샷과 현재 줄의 차이를 싣는다', () => {
    const view = labelStateOf({ batchStarted: true, current: printable, prints: [print('f1', 1, '2026-09-30T00:00:00Z', [item('A', 's1', 1)])] });
    expect(view.changes).toEqual([{ locationCode: 'A', skuId: 's1', name: 's1', printedQty: 1, currentQty: 3 }]);
  });

  it('unavailable 은 사유 코드를 issue 로 싣는다', () => {
    expect(labelStateOf({ batchStarted: true, current: { kind: 'unavailable', issue: 'WAYBILL_STALE' }, prints: [] }).issue).toBe('WAYBILL_STALE');
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/label/label-print-policy.spec.ts` → FAIL.

- [ ] **Step 4: 구현** `label-print-policy.ts`:

```ts
import type { LabelItem } from './label-items';

export interface LabelPrintRecord {
  fingerprint: string;
  revision: number;
  itemsSnapshot: LabelItem[];
  printedAt: Date;
}

/** 판차(스펙 §10.3): 같은 지문의 기록이 있으면 그 번호, 없으면 최대 판차 + 1(첫 판 1). */
export function revisionFor(prints: readonly Pick<LabelPrintRecord, 'fingerprint' | 'revision'>[], fingerprint: string): number {
  const same = prints.find((p) => p.fingerprint === fingerprint);
  if (same) return same.revision;
  return prints.reduce((max, p) => Math.max(max, p.revision), 0) + 1;
}

/** 마지막으로 출력이 확인된 판 — printed_at 기준. 같은 내용을 다시 출력하면 그 행의 printed_at 이 갱신된다. */
export function latestPrint<T extends Pick<LabelPrintRecord, 'printedAt' | 'revision'>>(prints: readonly T[]): T | null {
  return prints.reduce<T | null>(
    (latest, p) =>
      !latest || p.printedAt.getTime() > latest.printedAt.getTime() || (p.printedAt.getTime() === latest.printedAt.getTime() && p.revision > latest.revision)
        ? p
        : latest,
    null,
  );
}

export type LabelState = 'current' | 'never_printed' | 'reprint_required' | 'not_started' | 'external' | 'unavailable';

export interface LabelItemChange {
  locationCode: string;
  skuId: string;
  name: string;
  printedQty: number;
  currentQty: number;
}

export interface LabelStateView {
  state: LabelState;
  changes: LabelItemChange[];
  /** unavailable 의 사유 코드(`WAYBILL_STALE` 등). 그 밖엔 null. */
  issue: string | null;
}

const keyOf = (i: Pick<LabelItem, 'locationCode' | 'skuId'>) => `${i.locationCode}\u0000${i.skuId}`;

/** «바뀐 줄»(스펙 §10.5) — (로케이션, SKU) 로 맞춰 수량이 다른 줄만. 사라진 줄은 currentQty 0, 새 줄은 printedQty 0. */
export function diffLabelItems(printed: readonly LabelItem[], current: readonly LabelItem[]): LabelItemChange[] {
  const rows = new Map<string, LabelItemChange>();
  for (const i of printed) rows.set(keyOf(i), { locationCode: i.locationCode, skuId: i.skuId, name: i.name, printedQty: i.quantity, currentQty: 0 });
  for (const i of current) {
    const prev = rows.get(keyOf(i));
    if (prev) prev.currentQty = i.quantity;
    else rows.set(keyOf(i), { locationCode: i.locationCode, skuId: i.skuId, name: i.name, printedQty: 0, currentQty: i.quantity });
  }
  return [...rows.values()]
    .filter((row) => row.printedQty !== row.currentQty)
    .sort((a, b) => (a.locationCode < b.locationCode ? -1 : a.locationCode > b.locationCode ? 1 : a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0));
}

export type CurrentLabelSummary =
  | { kind: 'printable'; fingerprint: string; items: LabelItem[] }
  | { kind: 'external' }
  | { kind: 'unavailable'; issue: string };

/** 송장 스캔 상태(스펙 §10.5 + 사용자 결정 external). 조회 전용 — 아무것도 바꾸지 않는다. */
export function labelStateOf(input: {
  batchStarted: boolean;
  current: CurrentLabelSummary;
  prints: readonly LabelPrintRecord[];
}): LabelStateView {
  if (!input.batchStarted) return { state: 'not_started', changes: [], issue: null };
  if (input.current.kind === 'external') return { state: 'external', changes: [], issue: null };
  if (input.current.kind === 'unavailable') return { state: 'unavailable', changes: [], issue: input.current.issue };
  const latest = latestPrint(input.prints);
  if (!latest) return { state: 'never_printed', changes: [], issue: null };
  if (latest.fingerprint === input.current.fingerprint) return { state: 'current', changes: [], issue: null };
  return { state: 'reprint_required', changes: diffLabelItems(latest.itemsSnapshot, input.current.items), issue: null };
}
```

Run 같은 명령 → PASS.

- [ ] **Step 5: 저장소** `waybill-label-print.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { LabelItem } from './label/label-items';
import type { LabelPrintRecord } from './label/label-print-policy';

const P = wmsTables.waybillLabelPrints;

function isLabelItem(value: unknown): value is LabelItem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.locationCode === 'string' && typeof v.skuId === 'string' && typeof v.name === 'string' && typeof v.quantity === 'number';
}

/** jsonb 는 우리가 쓴 모양이지만 타입은 unknown 이다 — 캐스팅 대신 좁힌다. 모양이 깨졌으면 스냅샷만 비운다(«바뀐 줄» 표시만 잃는다). */
function snapshotOf(value: unknown): LabelItem[] {
  return Array.isArray(value) && value.every(isLabelItem) ? value : [];
}

@Injectable()
export class WaybillLabelPrintRepository {
  async listByShipments(trx: DbTx, shipmentIds: readonly string[]): Promise<Array<LabelPrintRecord & { shipmentId: string }>> {
    if (!shipmentIds.length) return [];
    const rows = await trx
      .select()
      .from(P)
      .where(inArray(P.shipmentId, [...shipmentIds]))
      .orderBy(asc(P.shipmentId), asc(P.revision));
    return rows.map((row) => ({
      shipmentId: row.shipmentId,
      fingerprint: row.fingerprint,
      revision: row.revision,
      itemsSnapshot: snapshotOf(row.itemsSnapshot),
      printedAt: row.printedAt,
    }));
  }

  /** 같은 지문이면 printed_at·printed_by 만 갱신한다 — 판차는 그대로(같은 내용 = 같은 종이). */
  async record(
    trx: DbTx,
    row: { shipmentId: string; fingerprint: string; revision: number; itemsSnapshot: LabelItem[]; printedBy: string },
  ): Promise<LabelPrintRecord> {
    const [saved] = await trx
      .insert(P)
      .values(row)
      .onConflictDoUpdate({ target: [P.shipmentId, P.fingerprint], set: { printedAt: sql`now()`, printedBy: row.printedBy } })
      .returning();
    return { fingerprint: saved.fingerprint, revision: saved.revision, itemsSnapshot: snapshotOf(saved.itemsSnapshot), printedAt: saved.printedAt };
  }

  /** 출력 확인은 박스의 활성 작업 항목 잠금에서 줄을 선다(스펙 §13). 작업 항목이 없으면 null — 조립이 I4 로 거절한다. */
  async lockActiveWorkItem(trx: DbTx, shipmentId: string): Promise<{ id: string } | null> {
    const [item] = await trx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          notInArray(wmsTables.outboundBatchWorkItems.status, ['completed', 'excluded']),
        ),
      )
      .limit(1)
      .for('update');
    return item ?? null;
  }
}
```

(`isLabelItem` 안의 `as Record<string, unknown>` 은 `typeof === 'object'` 로 좁힌 뒤의 인덱스 접근용이다 — `reader/shipment-waybill.reader.ts` 의 `isRecipientRecord` 처럼 타입 가드 함수로 바꿔 캐스팅을 없애도 된다. 그쪽이 저장소 관례면 그쪽을 따른다.)

- [ ] **Step 6: 저장소 통합 스펙** `waybill-label-print.repository.integration.spec.ts` — `describeIfDb`, `inRollbackTx`, `seedPickableShipment` 로 박스 하나:

```ts
  it('같은 지문을 다시 기록하면 행이 늘지 않고 printed_at 이 갱신돼 «마지막 출력»이 된다(A→B→A)', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 1);
      const repo = new WaybillLabelPrintRepository();
      const base = { shipmentId: box.shipmentId, itemsSnapshot: [], printedBy: box.actorId };
      await repo.record(tx, { ...base, fingerprint: 'a'.repeat(64), revision: 1 });
      await tx.execute(rawSql`select pg_sleep(0.01)`);
      await repo.record(tx, { ...base, fingerprint: 'b'.repeat(64), revision: 2 });
      // 한 트랜잭션 안의 now() 는 같다 — 되돌아온 A 가 더 늦게 찍히게 printed_at 을 과거로 민다.
      await tx.update(wmsTables.waybillLabelPrints).set({ printedAt: new Date('2026-01-01T00:00:00Z') }).where(eq(wmsTables.waybillLabelPrints.shipmentId, box.shipmentId));
      const again = await repo.record(tx, { ...base, fingerprint: 'a'.repeat(64), revision: 1 });
      const rows = await repo.listByShipments(tx, [box.shipmentId]);
      expect(rows).toHaveLength(2);
      expect(again.revision).toBe(1);
      expect(latestPrint(rows)?.fingerprint).toBe('a'.repeat(64));
    });
  });

  it('다른 지문이 같은 판차를 쓰면 유니크 위반 — 판차는 박스 안에서 유일하다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 1);
      const repo = new WaybillLabelPrintRepository();
      const base = { shipmentId: box.shipmentId, itemsSnapshot: [], printedBy: box.actorId, revision: 1 };
      await repo.record(tx, { ...base, fingerprint: 'a'.repeat(64) });
      await expect(tx.transaction((sp) => repo.record(sp, { ...base, fingerprint: 'b'.repeat(64) }))).rejects.toThrow(/uq_waybill_label_prints_shipment_revision/);
    });
  });
```

(`pg_sleep` 줄은 필요 없으면 지운다 — 핵심은 `printedAt` 을 과거로 민 뒤 A 를 다시 기록하면 A 가 최신이 되는 것이다.)

Run: `npm run test:core:integration:local -- waybill-label-print.repository`
Expected: PASS(마이그가 적용된 DB 에서).

- [ ] **Step 7: 커밋하지 않는다** — 정책·저장소가 Task 4 의 새 `LabelItem`(locationCode·skuId) 을 import 하고, Task 4 는 Task 7 전까지 type-check 를 깬다. 그래서 **Task 4·5·6·7 은 Task 7 끝에서 한 커밋**으로 묶는다. 그 커밋이 스키마 + 생성 SQL + `drizzle/meta` 를 함께 담으므로 CLAUDE.md 의 «schema.ts 와 마이그는 한 커밋» 도 지켜진다.

---

### Task 7: 현재 내용 조립 — 렌더러가 배정을 찍는다 (I4)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.constants.ts` (`LABEL_NOT_ALLOCATED`, `LABEL_CONTENT_CHANGED`)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.reader.ts` (`loadLabelAllocation`)
- Create: `apps/core/src/modules/fulfillment/waybill/waybill-label-content.assembler.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/dto/waybill.dto.ts` (`WaybillLabelResponseDto.fingerprint`, `.revision`)
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.module.ts`
- Create: `apps/core/src/modules/fulfillment/waybill/__support__/label-fixtures.ts`
- Test: `waybill/waybill-label.manager.spec.ts`, `waybill/waybill-label.manager.integration.spec.ts`, Create `waybill/waybill-label-content.assembler.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`buildHanjinLabelContent`, `buildHanjinLabelData`, `labelItemsOf`, `labelFingerprint`), Task 6 (`WaybillLabelPrintRepository`, `revisionFor`)
- Produces (PR 2 가 기댄다 — «현재 내용 조립 함수»):
  - `LabelAllocation { workItemId: string | null; batchStarted: boolean; lines: { id: string; qty: number }[]; rows: Array<AllocatedLabelRow & { shipmentLineId: string }> }`
  - `WaybillReader.loadLabelAllocation(trx, shipmentId): Promise<LabelAllocation>`
  - `assertLabelAllocated(shipmentId, allocation): asserts allocation is LabelAllocation & { workItemId: string }`
  - `isAppPrintable(waybill): boolean`
  - `type CurrentLabel = { kind: 'external'; waybill: WaybillRow } | PrintableLabel`, `PrintableLabel = { kind: 'printable'; waybill: WaybillRow; workItemId: string; content: HanjinLabelContent; fingerprint: string }`
  - `WaybillLabelContentAssembler.current(shipmentId, trx): Promise<CurrentLabel>`
  - `requirePrintable(current): PrintableLabel` (external 이면 `WAYBILL_LABEL_UNAVAILABLE` ConflictError)
  - `WaybillLabel` 응답에 `fingerprint: string; revision: number`
  - 테스트 지원: `promoteToCarrierWaybill(tx, fixture: { waybillId: string })`, `assembleLabels(dbService, now?)`

- [ ] **Step 1: 상수** — `WAYBILL.ERROR` 에:

```ts
    // 시작된 배치의 활성 작업 항목이면서 배정이 줄 수량을 덮은 박스만 송장을 그린다(스펙 I4).
    LABEL_NOT_ALLOCATED: 'WAYBILL_LABEL_NOT_ALLOCATED',
    // 출력 확인의 지문이 현재 내용과 다르다 — 앱은 다시 렌더한다(스펙 §10.3).
    LABEL_CONTENT_CHANGED: 'LABEL_CONTENT_CHANGED',
```

- [ ] **Step 2: 조립자 단위 테스트(실패)** `waybill-label-content.assembler.spec.ts` — 순수 부분(`assertLabelAllocated`, `isAppPrintable`, `requirePrintable`)만:

```ts
import { ConflictError } from '@app/shared';
import { assertLabelAllocated, isAppPrintable, requirePrintable } from './waybill-label-content.assembler';

const allocation = (over = {}) => ({
  workItemId: 'wi-1',
  batchStarted: true,
  lines: [{ id: 'l1', qty: 2 }],
  rows: [{ shipmentLineId: 'l1', locationCode: 'A-01', skuId: 's1', skuName: '펜', qty: 2 }],
  ...over,
});

describe('assertLabelAllocated (I4)', () => {
  it('시작된 배치의 활성 작업 항목이 줄 수량을 덮으면 통과', () => {
    expect(() => assertLabelAllocated('shp', allocation())).not.toThrow();
  });
  it.each([
    ['작업 항목 없음', { workItemId: null }],
    ['시작 전 배치', { batchStarted: false }],
    ['배정 < 줄 수량', { rows: [{ shipmentLineId: 'l1', locationCode: 'A-01', skuId: 's1', skuName: '펜', qty: 1 }] }],
    ['배정 없는 줄', { lines: [{ id: 'l1', qty: 2 }, { id: 'l2', qty: 1 }] }],
  ])('%s 이면 409 WAYBILL_LABEL_NOT_ALLOCATED', (_label, over) => {
    const run = () => assertLabelAllocated('shp', allocation(over));
    expect(run).toThrow(ConflictError);
    expect(run).toThrow(/^WAYBILL_LABEL_NOT_ALLOCATED:/);
  });
});

describe('isAppPrintable', () => {
  it.each([
    [{ source: 'carrier' as const, carrier: 'HANJIN' as const }, true],
    [{ source: 'manual' as const, carrier: 'HANJIN' as const }, false],
    [{ source: 'carrier' as const, carrier: 'CJ' as const }, false],
  ])('%o → %s', (wb, expected) => expect(isAppPrintable(wb)).toBe(expected));
});

describe('requirePrintable', () => {
  it('external 이면 409 WAYBILL_LABEL_UNAVAILABLE', () => {
    const run = () => requirePrintable({ kind: 'external', waybill: { id: 'w', source: 'manual', carrier: 'HANJIN' } as never });
    expect(run).toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/waybill/waybill-label-content.assembler.spec.ts` → FAIL.

- [ ] **Step 3: `WaybillReader.loadLabelAllocation`** — `waybill.reader.ts` 에 추가(`loadIssueContext` 아래):

```ts
  /**
   * 송장 품목 줄의 원천 — 박스의 활성 작업 항목에 매단 배정(수량 > 0)을 로케이션 코드·SKU 이름과 함께 읽는다.
   * 잠그지 않는다: 렌더·상태 조회는 읽기이고, 출력 확인·게이트는 호출자가 작업 항목 잠금을 이미 쥐고 있다.
   */
  async loadLabelAllocation(trx: DbTx, shipmentId: string): Promise<LabelAllocation> {
    const WI = inventoryTables.outboundBatchWorkItems;
    const A = inventoryTables.pickingSourceAllocations;
    const lines = await trx
      .select({ id: inventoryTables.shipmentLines.id, qty: inventoryTables.shipmentLines.qty })
      .from(inventoryTables.shipmentLines)
      .where(eq(inventoryTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(inventoryTables.shipmentLines.id));
    const [item] = await trx
      .select({ id: WI.id, batchStartedAt: inventoryTables.outboundBatches.startedAt })
      .from(WI)
      .innerJoin(inventoryTables.outboundBatches, eq(inventoryTables.outboundBatches.id, WI.batchId))
      .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
      .limit(1);
    if (!item) return { workItemId: null, batchStarted: false, lines, rows: [] };
    const rows = await trx
      .select({
        shipmentLineId: A.shipmentLineId,
        locationCode: inventoryTables.locations.code,
        skuId: inventoryTables.shipmentLines.skuId,
        skuName: inventoryTables.skus.name,
        qty: A.qty,
      })
      .from(A)
      .innerJoin(inventoryTables.locations, eq(inventoryTables.locations.id, A.sourceLocationId))
      .innerJoin(inventoryTables.shipmentLines, eq(inventoryTables.shipmentLines.id, A.shipmentLineId))
      .innerJoin(inventoryTables.skus, eq(inventoryTables.skus.id, inventoryTables.shipmentLines.skuId))
      .where(and(eq(A.workItemId, item.id), gt(A.qty, 0)))
      .orderBy(asc(inventoryTables.locations.code), asc(inventoryTables.shipmentLines.skuId));
    return { workItemId: item.id, batchStarted: item.batchStartedAt !== null, lines, rows };
  }
```

`LabelAllocation` 인터페이스는 `waybill.types.ts` 에 둔다(`import type { AllocatedLabelRow } from './label/label-items'`):

```ts
export interface LabelAllocation {
  workItemId: string | null;
  batchStarted: boolean;
  lines: { id: string; qty: number }[];
  rows: Array<AllocatedLabelRow & { shipmentLineId: string }>;
}
```

import 추가: `gt`(drizzle-orm). (`gt(A.qty, 0)` 은 PR 2 가 CHECK 를 `qty >= 0` 으로 풀고 0 행을 남기기 시작해도 맞는 조건이다.)

- [ ] **Step 4: 조립자** `waybill-label-content.assembler.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbTx } from '../../inventory/schema/inventory.schema';
import type { HanjinConfig } from './carrier/hanjin/hanjin.config';
import { buildHanjinLabelContent, type HanjinLabelContent } from './carrier/hanjin/label/hanjin-label-data';
import { labelFingerprint } from './label/label-fingerprint';
import { labelItemsOf } from './label/label-items';
import { WAYBILL } from './waybill.constants';
import { assertContextMatchesWaybill, assertLabelAvailable } from './waybill-label.manager';
import { WaybillManager } from './waybill.manager';
import { WaybillReader } from './waybill.reader';
import { HANJIN_CONFIG } from './waybill.tokens';
import type { LabelAllocation, WaybillRow } from './waybill.types';

export interface PrintableLabel {
  kind: 'printable';
  waybill: WaybillRow;
  workItemId: string;
  content: HanjinLabelContent;
  fingerprint: string;
}
export type CurrentLabel = { kind: 'external'; waybill: WaybillRow } | PrintableLabel;

/** 앱이 그릴 수 있는 송장인가 — 한진이 발급한 것만(사용자 결정: 그 밖은 I4·I5 면제, labelState external). */
export function isAppPrintable(wb: Pick<WaybillRow, 'source' | 'carrier'>): boolean {
  return wb.source === 'carrier' && wb.carrier === 'HANJIN';
}

/** I4 — 시작된 배치의 활성 작업 항목이면서 배정 합이 줄 수량을 덮은 박스만 그린다. */
export function assertLabelAllocated(
  shipmentId: string,
  allocation: LabelAllocation,
): asserts allocation is LabelAllocation & { workItemId: string } {
  if (!allocation.workItemId || !allocation.batchStarted) {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_NOT_ALLOCATED}: shipment ${shipmentId} is not in a started batch`);
  }
  const allocated = new Map<string, number>();
  for (const row of allocation.rows) allocated.set(row.shipmentLineId, (allocated.get(row.shipmentLineId) ?? 0) + row.qty);
  const short = allocation.lines.find((line) => (allocated.get(line.id) ?? 0) < line.qty);
  if (short) {
    throw new ConflictError(`${WAYBILL.ERROR.LABEL_NOT_ALLOCATED}: shipment line ${short.id} is not fully allocated`);
  }
}

export function requirePrintable(current: CurrentLabel): PrintableLabel {
  if (current.kind === 'printable') return current;
  assertLabelAvailable(current.waybill); // external 이면 여기서 WAYBILL_LABEL_UNAVAILABLE 로 던진다
  throw new Error(`waybill ${current.waybill.id} classified external but passed assertLabelAvailable`);
}

/**
 * «현재 내용 조립»의 단일 지점(스펙 §10.4 끝). 렌더러·출력 확인·재출력 게이트·송장 스캔 상태가 모두 이 함수를
 * 부른다 — 그리는 입력과 비교하는 입력이 같은 객체에서 나오므로 둘이 어긋나지 않는다.
 */
@Injectable()
export class WaybillLabelContentAssembler {
  constructor(
    private readonly waybills: WaybillManager,
    private readonly reader: WaybillReader,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
  ) {}

  async current(shipmentId: string, trx: DbTx): Promise<CurrentLabel> {
    const waybill = await this.waybills.assertDispatchable(shipmentId, trx);
    if (!isAppPrintable(waybill)) return { kind: 'external', waybill };
    assertLabelAvailable(waybill);
    const ctx = await this.reader.loadIssueContext(trx, shipmentId);
    assertContextMatchesWaybill(waybill, ctx, (snapshot) => this.reader.recipientHashOf(snapshot));
    const allocation = await this.reader.loadLabelAllocation(trx, shipmentId);
    assertLabelAllocated(shipmentId, allocation);
    const content = buildHanjinLabelContent({ waybill, ctx, config: this.config, items: labelItemsOf(allocation.rows) });
    return { kind: 'printable', waybill, workItemId: allocation.workItemId, content, fingerprint: labelFingerprint(content) };
  }
}
```

(`assertLabelAvailable`·`assertContextMatchesWaybill` 는 `waybill-label.manager.ts` 에 그대로 둔다 — 기존 스펙이 거기서 import 한다. 조립자와 매니저의 순환 import 가 생기면 두 함수를 `waybill/label/label-guards.ts` 로 옮기고 매니저에서 re-export 한다.)

- [ ] **Step 5: 렌더러** — `WaybillLabelManager` 를 조립자 위로 옮긴다:

```ts
export interface WaybillLabel {
  waybillId: string;
  trackingNo: string;
  format: 'zpl';
  /** 쪽마다 ^XA…^XZ 를 이어 붙인 문자열 — 앱은 통째로 인쇄한다. */
  data: string;
  pages: number;
  /** 이 종이의 내용 지문 — 앱이 프린터 전송에 성공한 뒤 출력 확인(POST label-prints)에 그대로 보낸다. */
  fingerprint: string;
  /** 판차. 같은 지문이 출력된 적 있으면 그 번호, 없으면 최대 + 1. GET 이라 계산만 하고 쓰지 않는다. */
  revision: number;
}

@Injectable()
export class WaybillLabelManager {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
    private readonly rasterizer: SvgRasterizer,
    @Inject(HANJIN_CONFIG) private readonly config: HanjinConfig,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
    @Optional() @Inject(WAYBILL_LABEL_CLOCK) private readonly now: () => Date = () => new Date(),
  ) {}

  async render(shipmentId: string, tx?: DbTx): Promise<WaybillLabel> {
    const { label, revision } = await this.dbService.run(async (trx) => {
      const label = requirePrintable(await this.assembler.current(shipmentId, trx));
      const prints = await this.prints.listByShipments(trx, [shipmentId]);
      return { label, revision: revisionFor(prints, label.fingerprint) };
    }, tx);
    const pages = renderHanjinLabel(
      this.config.labelType,
      buildHanjinLabelData({ content: label.content, now: this.now(), revision }),
    );
    const data = encodeLabelPages(pages, this.rasterizer, WAYBILL.LABEL_ZPL_COMPRESS);
    return {
      waybillId: label.waybill.id,
      trackingNo: label.waybill.trackingNo ?? '',
      format: 'zpl',
      data,
      pages: pages.length,
      fingerprint: label.fingerprint,
      revision,
    };
  }
}
```

클래스 JSDoc 을 갱신한다: «라벨은 현재 shipment 와 **현재 배정**으로 다시 조립한다. 조립은 `WaybillLabelContentAssembler` 한 곳». `WaybillManager`·`WaybillReader` import 가 매니저에서 더 이상 안 쓰이면 뺀다.

`WaybillLabelResponseDto` 에:

```ts
  @ApiProperty({ description: '송장 내용 지문(64자 hex). 인쇄 성공 뒤 POST shipments/:id/waybill/label-prints 에 그대로 보낸다' })
  fingerprint: string;

  @ApiProperty({ description: '판차. 2 이상이면 종이에 「N판」 이 찍힌다' })
  revision: number;
```

`waybill.module.ts` providers 에 `WaybillLabelContentAssembler`, `WaybillLabelPrintRepository` 추가.

- [ ] **Step 6: 테스트 지원** `waybill/__support__/label-fixtures.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import type { HanjinConfig } from '../carrier/hanjin/hanjin.config';
import { SvgRasterizer } from '../label/svg-rasterizer';
import { WaybillLabelContentAssembler } from '../waybill-label-content.assembler';
import { WaybillLabelManager } from '../waybill-label.manager';
import { WaybillLabelPrintRepository } from '../waybill-label-print.repository';
import { WaybillManager } from '../waybill.manager';
import { WaybillReader } from '../waybill.reader';
import { WaybillRepository } from '../waybill.repository';

export const HANJIN_LABEL_DATA = {
  hub_cod: 'NX', tml_cod: '150', tml_nam: '중구', dom_mid: 'Z', cen_cod: '1050', cen_nam: '해운(집)',
  grp_rnk: 'A1', es_nam: '권순천', es_cod: '888', prt_add: '세종대로 1', dom_rgn: '1', s_tml_cod: '000', s_tml_nam: '본사',
};

export const LABEL_TEST_CONFIG: HanjinConfig = {
  clientId: 'CID', apiKey: 'AK', secretKey: 'SK', contractNo: 'CN', orderBaseUrl: 'https://o', printBaseUrl: 'https://p',
  timeoutMs: 15000,
  sender: { name: '보내는이', zip: '06236', baseAddress: '서울특별시 강남구 테헤란로 1', detailAddress: '10층', tel: '02-100-2000' },
  boxType: 'A', payType: 'CD', labelType: 'FS',
};

/**
 * 공용 출고 픽스처의 수기 송장을 «한진이 발급한» 송장으로 바꾼다 — 수기 송장은 I4·I5 면제라 게이트·렌더를
 * 시험하려면 이게 필요하다. 수하인 해시·매니페스트 버전은 픽스처 값 그대로라 assertDispatchable 을 통과한다.
 */
export async function promoteToCarrierWaybill(tx: DbTx, fixture: { waybillId: string }): Promise<{ trackingNo: string }> {
  const trackingNo = String(100_000_000_000 + Math.floor(Math.random() * 899_999_999_999));
  await tx
    .update(wmsTables.waybills)
    .set({
      source: 'carrier',
      trackingNo,
      custOrdNo: `AY${randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase()}`,
      labelData: HANJIN_LABEL_DATA,
      issuedAt: new Date(),
    })
    .where(eq(wmsTables.waybills.id, fixture.waybillId));
  return { trackingNo };
}

/** 송장 조립·렌더·출력 확인·게이트·상태 조회를 한 DbService 위에 배선한다(발급 경로는 stub). */
export function assembleLabels(dbService: DbService<typeof wmsSchema>, now: () => Date = () => new Date('2026-09-30T01:00:00Z')) {
  const reader = new WaybillReader(dbService);
  const waybills = new WaybillManager(reader, new WaybillRepository(dbService), {} as never, {} as never, {} as never, {} as never, dbService);
  const assembler = new WaybillLabelContentAssembler(waybills, reader, LABEL_TEST_CONFIG);
  const prints = new WaybillLabelPrintRepository();
  return {
    assembler,
    prints,
    render: new WaybillLabelManager(assembler, prints, new SvgRasterizer(), LABEL_TEST_CONFIG, dbService, now),
  };
}
```

(Task 8·9·10 이 반환 객체에 `confirm`·`guard`·`states` 를 더한다. `WaybillManager` 생성자 인자 순서는 `waybill-label.manager.integration.spec.ts` 의 `build()` 와 같게 맞춘다 — 발급·등록 경로를 부르지 않으므로 나머지는 `{} as never`, `simple-outbound-wiring.ts` 가 이미 쓰는 방식이다.)

- [ ] **Step 7: 렌더러 스펙 갱신**

`waybill-label.manager.spec.ts` 의 «render — labelType 배선» describe: 매니저를 `new WaybillLabelManager(assembler, prints, rasterizer, config, dbService, now)` 로 만들고, `assembler.current` 는 `{ kind: 'printable', waybill: WAYBILL_ROW, workItemId: 'wi', content: buildHanjinLabelContent({ waybill: WAYBILL_ROW, ctx: CTX, config, items: [{ locationCode: 'A-01', skuId: 's1', name: '펜', quantity: 1 }] }), fingerprint: 'f'.repeat(64) }` 를 돌려주는 가짜, `prints.listByShipments` 는 `[]` 를 돌려주는 가짜, `dbService.run` 은 `(fn, tx) => fn(tx ?? {})`. 기대에 `fingerprint: 'f'.repeat(64)`, `revision: 1` 을 더한다. 테스트 하나 추가:

```ts
  it('같은 지문이 2판으로 출력된 적 있으면 revision 2 를 싣고 FS 쪽 표시에 「2판」 이 찍힌다', async () => {
    // prints 가짜가 [{ fingerprint: 'a'.repeat(64), revision: 1 }, { fingerprint: 'f'.repeat(64), revision: 2 }] 를 돌려주게 한다
    const label = await manager('FS', prints2).render('shp-1');
    expect(label.revision).toBe(2);
  });
```

(FS 형 ZPL 은 래스터라 텍스트 검사가 어렵다 — 판차가 종이에 찍히는 것은 Task 5 템플릿 스펙이 본다. 여기서는 배선만.)

`waybill-label.manager.integration.spec.ts` 를 다시 쓴다. 옛 «발급만 된 계획 박스에 렌더» 는 이제 I4 로 거절되는 게 맞다. 새 시나리오(`inRollbackTx` + `ambientDbService` + `assembleLabels`):

```ts
  it('시작된 배치의 한진 송장 박스면 ZPL 과 지문·판차 1 을 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      const label = await render.render(box.shipmentId, tx);
      expect(label).toMatchObject({ trackingNo, format: 'zpl', revision: 1 });
      expect(label.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(label.data).toContain(`^FD${trackingNo}^FS`);
    });
  });

  it('시작 전 배치의 박스는 409 WAYBILL_LABEL_NOT_ALLOCATED (I4)', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(box.shipmentId, tx)).rejects.toThrow(/^WAYBILL_LABEL_NOT_ALLOCATED:/);
    });
  });

  it('지문은 배정 로케이션이 바뀌면 달라지고, 같으면 몇 번 그려도 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      const a = await render.render(box.shipmentId, tx);
      const b = await render.render(box.shipmentId, tx);
      expect(b.fingerprint).toBe(a.fingerprint);
      await tx.update(wmsTables.locations).set({ code: `MOVED-${randomUUID()}` }).where(eq(wmsTables.locations.id, box.locationId));
      expect((await render.render(box.shipmentId, tx)).fingerprint).not.toBe(a.fingerprint);
    });
  });

  it('수기 송장은 409 WAYBILL_LABEL_UNAVAILABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await startBatchFor(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(box.shipmentId, tx)).rejects.toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
    });
  });
```

기존의 «운송장 없음 409 WAYBILL_NOT_DISPATCHABLE», «수하인 변경 409 WAYBILL_STALE», «없는 shipment 404» 는 조립 순서상 I4 보다 먼저 걸리므로 시드를 새 방식으로 바꿔 유지한다(수하인 변경은 `startBatchFor` 뒤 `shipments.recipientSnapshot` 을 바꾼다).

- [ ] **Step 8: 통과 + 커밋 (Task 4·5·6·7 한 커밋)**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/waybill && npm run test:core:integration:local -- 'waybill-label'`
Expected: 모두 PASS.

```bash
git add -A apps/core/src/modules/fulfillment/waybill apps/core/src/modules/fulfillment/schema/fulfillment.schema.ts apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle scripts/ops/hanjin-label-preview
git commit -m "feat(waybill): 송장 품목 줄에 배정 로케이션을 찍고 내용 지문·판차·출력 기록을 싣는다 (#987)"
```

---

### Task 8: 출력 확인 API

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill-label-print.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.service.ts`, `waybill-label.controller.ts`, `dto/waybill.dto.ts`, `waybill.module.ts`, `__support__/label-fixtures.ts`
- Test: Create `waybill/waybill-label-print.manager.integration.spec.ts`, 컨트롤러 스펙이 있으면 라우트 한 건

**Interfaces:**
- Consumes: Task 7 `WaybillLabelContentAssembler.current`, `requirePrintable`; Task 6 저장소·`revisionFor`
- Produces:
  - `POST shipments/:shipmentId/waybill/label-prints` body `{ fingerprint }` → 201 `{ fingerprint, revision, printedAt }`
  - `WaybillLabelPrintManager.confirm(shipmentId, fingerprint, actor: { id: string }, tx?): Promise<LabelPrintConfirmation>`
  - `LabelPrintConfirmation { fingerprint: string; revision: number; printedAt: string }`

- [ ] **Step 1: 실패하는 통합 테스트** `waybill-label-print.manager.integration.spec.ts`:

```ts
describeIfDb('송장 출력 확인', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => sql.end({ timeout: 5 }));

  async function startedCarrierBox(tx: DbTx) {
    const box = await seedPickableShipment(tx, 2);
    await promoteToCarrierWaybill(tx, box);
    await startBatchFor(tx, box);
    return { box, labels: assembleLabels(ambientDbService(tx)) };
  }

  it('렌더한 지문을 확인하면 판차 1 로 기록한다 — 같은 지문을 두 번 확인해도 한 행', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, labels } = await startedCarrierBox(tx);
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      const first = await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      const second = await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      expect([first.revision, second.revision]).toEqual([1, 1]);
      expect(await labels.prints.listByShipments(tx, [box.shipmentId])).toHaveLength(1);
    });
  });

  it('렌더 뒤 내용이 바뀌었으면 409 LABEL_CONTENT_CHANGED — 기록하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, labels } = await startedCarrierBox(tx);
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await tx.update(wmsTables.shipments).set({ entrancePassword: '#9999' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      await expect(labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx)).rejects.toThrow(/^LABEL_CONTENT_CHANGED:/);
      expect(await labels.prints.listByShipments(tx, [box.shipmentId])).toEqual([]);
    });
  });

  it('내용이 바뀐 뒤 새로 렌더해 확인하면 판차 2, 원래 내용으로 되돌아와 다시 확인하면 판차 1 이 «마지막 출력»이 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, labels } = await startedCarrierBox(tx);
      const a = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, a.fingerprint, { id: box.actorId }, tx);
      await tx.update(wmsTables.shipments).set({ entrancePassword: '#9999' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      const b = await labels.render.render(box.shipmentId, tx);
      expect(b.revision).toBe(2);
      await labels.confirm.confirm(box.shipmentId, b.fingerprint, { id: box.actorId }, tx);
      await tx.update(wmsTables.waybillLabelPrints).set({ printedAt: new Date('2026-01-01T00:00:00Z') }).where(eq(wmsTables.waybillLabelPrints.shipmentId, box.shipmentId));
      await tx.update(wmsTables.shipments).set({ entrancePassword: null }).where(eq(wmsTables.shipments.id, box.shipmentId));
      const again = await labels.render.render(box.shipmentId, tx);
      expect(again).toMatchObject({ fingerprint: a.fingerprint, revision: 1 });
      await labels.confirm.confirm(box.shipmentId, again.fingerprint, { id: box.actorId }, tx);
      expect(latestPrint(await labels.prints.listByShipments(tx, [box.shipmentId]))?.fingerprint).toBe(a.fingerprint);
    });
  });
});
```

(픽스처의 `entrancePassword` 초기값이 NULL 인지 `seedShipmentForExistingStock` 에서 확인한다 — 아니면 «원래 값» 으로 되돌린다. `entrancePassword` 는 `composeMessage` 로 ⑭ 에 들어가므로 지문을 바꾼다.)

Run: `npm run test:core:integration:local -- waybill-label-print.manager` → FAIL.

- [ ] **Step 2: 매니저**

```ts
import { Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, inventorySchema } from '../../inventory/schema/inventory.schema';
import { revisionFor } from './label/label-print-policy';
import { WAYBILL } from './waybill.constants';
import { requirePrintable, WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

export interface LabelPrintConfirmation {
  fingerprint: string;
  revision: number;
  printedAt: string;
}

/**
 * 출력 확인(스펙 §10.3) — 앱이 프린터 전송에 **성공한 뒤에만** 부른다. 현재 지문과 같을 때만 기록한다.
 * 박스의 활성 작업 항목 잠금에서 줄을 서므로(스펙 §13) 같은 지문의 동시 확인은 한 행·같은 판차가 된다.
 * 알고 남기는 위험: 전송은 성공했는데 용지가 걸린 경우 — 재출력 버튼으로 대응한다.
 */
@Injectable()
export class WaybillLabelPrintManager {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  async confirm(shipmentId: string, fingerprint: string, actor: { id: string }, tx?: DbTx): Promise<LabelPrintConfirmation> {
    return this.dbService.run(async (trx) => {
      await this.prints.lockActiveWorkItem(trx, shipmentId);
      const label = requirePrintable(await this.assembler.current(shipmentId, trx));
      if (label.fingerprint !== fingerprint) {
        throw new ConflictError(`${WAYBILL.ERROR.LABEL_CONTENT_CHANGED}: shipment ${shipmentId} label changed since it was rendered`);
      }
      const existing = await this.prints.listByShipments(trx, [shipmentId]);
      const saved = await this.prints.record(trx, {
        shipmentId,
        fingerprint,
        revision: revisionFor(existing, fingerprint),
        itemsSnapshot: label.content.items,
        printedBy: actor.id,
      });
      return { fingerprint: saved.fingerprint, revision: saved.revision, printedAt: saved.printedAt.toISOString() };
    }, tx);
  }
}
```

- [ ] **Step 3: 서비스·컨트롤러·DTO·모듈**

`dto/waybill.dto.ts`:

```ts
export class ConfirmLabelPrintDto {
  @ApiProperty({ description: '렌더 응답의 fingerprint 그대로' })
  @IsString()
  @Length(64, 64)
  fingerprint: string;
}

export class LabelPrintConfirmationDto {
  @ApiProperty() fingerprint: string;
  @ApiProperty() revision: number;
  @ApiProperty() printedAt: string;
}
```

`WaybillLabelService` 에 `WaybillLabelPrintManager` 를 주입하고 `confirmPrint(shipmentId, fingerprint, actor, tx?)` 로 위임. `WaybillLabelController`:

```ts
  // 앱이 프린터 전송에 성공한 뒤에만 부른다. 현재 내용과 다르면 409 LABEL_CONTENT_CHANGED → 앱이 다시 렌더한다.
  @Post('shipments/:shipmentId/waybill/label-prints')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: LabelPrintConfirmationDto })
  confirmPrint(@Param('shipmentId') shipmentId: string, @Body() dto: ConfirmLabelPrintDto, @User() user: AuthenticatedUser) {
    const id = user?.id ?? user?.userId ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return this.labels.confirmPrint(shipmentId, dto.fingerprint, { id });
  }
```

(`AuthenticatedUser` 타입과 actor 추출은 `waybill.controller.ts` 의 `actor()` 와 같은 모양으로 — 그 컨트롤러의 private `actor` 를 열어 필드 우선순위를 그대로 따른다.) `waybill.module.ts` providers 에 `WaybillLabelPrintManager`. `label-fixtures.ts` 의 `assembleLabels` 반환에 `confirm: new WaybillLabelPrintManager(assembler, prints, dbService)` 추가.

스코프 가드 감사(`apps/core/src/platform/auth/scope-guard-binding.spec.ts`)와 IDOR 감사(`npx jest scripts/security`)가 새 라우트를 보고 실패하면 그 스펙이 요구하는 등록(허용 목록·감사 표)을 한다 — 이 라우트는 `WAREHOUSE_OPERATE` 스코프이고 shipment 소유권 개념이 없는 창고 내부 명령이다(같은 컨트롤러의 GET 라벨과 같은 분류).

- [ ] **Step 4: 통과 + 커밋**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/waybill apps/core/src/platform/auth scripts/security && npm run test:core:integration:local -- waybill-label-print`
Expected: PASS.

```bash
git add -A apps/core/src/modules/fulfillment/waybill
git commit -m "feat(waybill): 송장 출력 확인 API — 인쇄 성공 뒤 지문과 판차를 기록한다 (#987)"
```

---

### Task 9: 재출력 게이트 (I5)

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/label-currency.guard.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.module.ts` (provider + **export**), `__support__/label-fixtures.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/discrete-picking.strategy.ts` (`scan`, `completePick`), `picking/pick-to-tote.strategy.ts` (`assignTote`, `toteScan`, `completePick`), `picking/aggregate-then-sort.strategy.ts` (`sortScan`, `completePick`)
- Modify: `apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts` (`lockAggregate`)
- Modify (생성자 인자 추가 배선): `services/__support__/simple-outbound-wiring.ts`, `services/location-outbound.service.integration.spec.ts`, `services/outbound-v2-concurrency.integration.spec.ts`, `services/outbound-v2-lifecycle-scenarios.integration.spec.ts`, `services/outbound-v2-recovery-scenarios.integration.spec.ts`, `services/outbound-v2-scenarios.integration.spec.ts`, `services/outbound-v2-warehouse-scenarios.integration.spec.ts`, `services/shipment-dispatch.integration.spec.ts`, `services/shipment-dispatch.service.spec.ts`, 전략 단위 스펙들(`picking/*.strategy.spec.ts`)
- Create: `apps/core/src/modules/fulfillment/picking/label-currency-gate.guard.spec.ts`
- Test: Create `apps/core/src/modules/fulfillment/waybill/label-currency.guard.integration.spec.ts`

**Interfaces:**
- Consumes: Task 7 조립자, Task 6 저장소·`latestPrint`
- Produces (PR 2 가 기댄다): `LabelCurrencyGuard.assertCurrent(workItemId: string, trx: DbTx): Promise<void>` — 거절은 `ConflictException({ code: 'LABEL_REPRINT_REQUIRED', message })`; 조립이 `WAYBILL_*` ConflictError 로 실패하면 같은 코드를 `ConflictException({ code, message })` 로 옮겨 싣는다(앱이 코드를 읽을 수 있게 — Review Focus 3)

- [ ] **Step 1: 가드 스펙(실패)** `picking/label-currency-gate.guard.spec.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/**
 * 스펙 I5 — 박스의 «전진» 명령은 재출력 게이트를 지난다. 게이트 진입점은 계획이 코드에서 도출했다:
 * 작업 항목을 잠그는 `lockAndAssertPickerClaim` 을 부르는 전략 메서드 전부 + 검수·발송의 `lockAggregate`.
 * 되돌림 명령은 게이트를 지나면 안 된다 — 막으면 빼는 일이 끝나지 않는다(스펙 §10.4).
 */
const DIR = join(__dirname);
const STRATEGIES = ['discrete-picking.strategy.ts', 'pick-to-tote.strategy.ts', 'aggregate-then-sort.strategy.ts'];
const ROLLBACK = ['unpickShipment', 'handoff', 'releaseTote', 'toteHandoff', 'cartHandoff'];
const GATE = 'this.labels.assertCurrent(';

function methodBodies(path: string): Map<string, string> {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const bodies = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.body && ts.isIdentifier(node.name)) {
      bodies.set(node.name.text, node.body.getText(src));
    }
    node.forEachChild(visit);
  };
  visit(src);
  return bodies;
}

describe('재출력 게이트 배선', () => {
  it.each(STRATEGIES)('%s: lockAndAssertPickerClaim 을 부르는 메서드는 그 뒤에 게이트를 부른다', (file) => {
    const offenders = [...methodBodies(join(DIR, file))]
      .filter(([, body]) => body.includes('lockAndAssertPickerClaim('))
      .filter(([, body]) => {
        const claim = body.indexOf('lockAndAssertPickerClaim(');
        const gate = body.indexOf(GATE);
        return gate === -1 || gate < claim;
      })
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });

  it.each(STRATEGIES)('%s: 되돌림 메서드는 게이트를 부르지 않는다', (file) => {
    const bodies = methodBodies(join(DIR, file));
    expect(ROLLBACK.filter((name) => bodies.get(name)?.includes(GATE))).toEqual([]);
  });

  it('검수·발송 공통 잠금(lockAggregate)이 작업 항목 잠금 뒤에 게이트를 부른다', () => {
    const body = methodBodies(join(DIR, '../services/shipment-dispatch.service.ts')).get('lockAggregate') ?? '';
    expect(body).toContain('this.labels.assertCurrent(workItem.id');
  });

  it('게이트 진입 메서드 수가 도출 목록과 같다 — 새 전진 명령이 생기면 이 목록과 계획을 같이 고친다', () => {
    const gated = STRATEGIES.flatMap((file) =>
      [...methodBodies(join(DIR, file))].filter(([, body]) => body.includes(GATE)).map(([name]) => `${file}#${name}`),
    ).sort();
    expect(gated).toEqual(
      [
        'aggregate-then-sort.strategy.ts#completePick',
        'aggregate-then-sort.strategy.ts#sortScan',
        'discrete-picking.strategy.ts#completePick',
        'discrete-picking.strategy.ts#scan',
        'pick-to-tote.strategy.ts#assignTote',
        'pick-to-tote.strategy.ts#completePick',
        'pick-to-tote.strategy.ts#toteScan',
      ].sort(),
    );
  });
});
```

Run: `npx jest apps/core/src/modules/fulfillment/picking/label-currency-gate.guard.spec.ts` → FAIL.

- [ ] **Step 2: 게이트** `waybill/label-currency.guard.ts`:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { latestPrint } from './label/label-print-policy';
import { WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

/** 조립 실패(`WAYBILL_STALE: …`)를 fulfillment 관례(`{ code }`)로 옮긴다 — 앱은 code 로 문구를 고른다. */
function asCodedConflict(error: unknown): unknown {
  if (!(error instanceof ConflictError)) return error;
  const code = /^([A-Z][A-Z_]+):/.exec(error.message)?.[1];
  return code ? new ConflictException({ code, message: error.message }) : error;
}

/**
 * I5(스펙 §10.4) — 현재 지문 ≠ 마지막 출력 지문이면(출력 안 됨 포함) 박스의 전진 명령을 거절한다.
 * 호출자는 작업 항목을 이미 잠갔고, `commands.execute` 핸들러 **안**에서 부른다 — 멱등 재전송은 핸들러를
 * 다시 돌지 않으므로 막히지 않는다. 앱이 그릴 수 없는 송장(수기·한진 외)은 면제(사용자 결정).
 * 정합성은 «배정된 로케이션만 받는 스캔»이 지키고, 이 게이트는 낡은 종이로 헛걸음하는 것을 막는다(스펙 §5).
 */
@Injectable()
export class LabelCurrencyGuard {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
  ) {}

  async assertCurrent(workItemId: string, trx: DbTx): Promise<void> {
    const [item] = await trx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
      .limit(1);
    if (!item) throw new Error(`LabelCurrencyGuard: work item ${workItemId} vanished under its own lock`);
    const current = await this.assembler.current(item.shipmentId, trx).catch((error: unknown) => {
      throw asCodedConflict(error);
    });
    if (current.kind === 'external') return;
    const latest = latestPrint(await this.prints.listByShipments(trx, [item.shipmentId]));
    if (latest?.fingerprint === current.fingerprint) return;
    throw new ConflictException({
      code: 'LABEL_REPRINT_REQUIRED',
      message: latest
        ? `Shipment ${item.shipmentId} label changed — print the new revision before continuing`
        : `Shipment ${item.shipmentId} label has not been printed yet`,
    });
  }
}
```

`waybill.module.ts`: providers 와 exports 에 `LabelCurrencyGuard` 추가. `label-fixtures.ts` 의 `assembleLabels` 반환에 `guard: new LabelCurrencyGuard(assembler, prints)`.

- [ ] **Step 3: 배선** — 세 전략의 생성자 끝에 `private readonly labels: LabelCurrencyGuard,` 를 더하고, 7개 메서드에서 `lockAndAssertPickerClaim(trx, <workItemId 인자>, …)` 호출 **바로 다음 줄**에:

```ts
        // 낡은 송장으로는 진행하지 않는다(스펙 I5). 작업 항목 잠금 뒤, 명령 핸들러 안.
        await this.labels.assertCurrent(<같은 workItemId 인자>, trx);
```

(`<workItemId 인자>` 는 그 메서드가 `lockAndAssertPickerClaim` 에 넘긴 바로 그 표현식 — 대개 `input.workItemId`. 트랜잭션 변수 이름도 그 핸들러의 것을 쓴다.) `bulkCartScan`·`cartHandoff`·`handoff`·`unpickShipment`·`releaseTote`·`toteHandoff`·`registerTote` 에는 넣지 않는다.

`ShipmentDispatchService`: 생성자 끝에 `private readonly labels: LabelCurrencyGuard,`. `lockAggregate` 에서 작업 항목 `FOR UPDATE` 조회 직후(세션 잠금 전 — 잠금 순서 «작업 항목 → 세션» 을 지키고, 게이트는 새 잠금을 잡지 않는다)에:

```ts
    // 검수·검수 줄·강제 발송·자동 발송이 모두 이 잠금을 지난다 — 낡은 송장으로는 발송하지 않는다(스펙 I5).
    await this.labels.assertCurrent(workItem.id, tx);
```

Nest DI 는 `FulfillmentModule` 이 `WaybillModule` 을 import 하므로 export 만으로 풀린다. `PickToToteStrategy`·`AggregateThenSortStrategy` 가 `FulfillmentModule` 이 아닌 다른 모듈에 등록돼 있으면 그 모듈의 imports 를 확인한다(`grep -rn "PickToToteStrategy" apps/core/src --include=*.module.ts`).

- [ ] **Step 4: 테스트 배선** — `npm run type-check` 가 알려 주는 모든 `new DiscretePickingStrategy(`·`new PickToToteStrategy(`·`new AggregateThenSortStrategy(`·`new ShipmentDispatchService(` 에 인자를 더한다:
  - 실 DB 통합 스펙·`simple-outbound-wiring.ts`: `assembleLabels(dbService).guard` — 픽스처가 수기 송장이라 게이트는 면제로 통과한다(기존 시나리오가 그대로 초록이어야 한다 — 그게 Review Focus 2 의 검증이다).
  - 가짜 기반 단위 스펙: `{ assertCurrent: jest.fn(async () => undefined) } as never` (기존 스펙이 다른 협력자를 `as never` 로 넘기는 방식 그대로).

- [ ] **Step 5: 게이트 통합 테스트** `waybill/label-currency.guard.integration.spec.ts`:

```ts
describeIfDb('재출력 게이트 (I5)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => sql.end({ timeout: 5 }));
  const actorOf = (box: { actorId: string }) => ({ id: box.actorId, roles: ['logistics_worker'] });

  it('한진 송장 박스는 출력 확인 전에는 피킹 스캔이 LABEL_REPRINT_REQUIRED, 확인 뒤엔 진행된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { simple } = assembleOutbound(tx);
      const labels = assembleLabels(ambientDbService(tx));
      await expect(
        simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: `scan-${randomUUID()}` }, tx),
      ).rejects.toMatchObject({ response: { code: 'LABEL_REPRINT_REQUIRED' } });
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      const state = await simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: `scan-${randomUUID()}` }, tx);
      expect(isPreparationBlocked(state)).toBe(false);
    });
  });

  it('송장 내용이 바뀌면 다음 스캔이 막히고, 이미 처리된 스캔의 같은 키 재전송은 막히지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { simple } = assembleOutbound(tx);
      const labels = assembleLabels(ambientDbService(tx));
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      const key = `scan-${randomUUID()}`;
      const first = await simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: key }, tx);
      await tx.update(wmsTables.shipments).set({ entrancePassword: '#9999' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      const replay = await simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: key }, tx);
      expect(replay).toEqual(first);
      await expect(
        simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: `scan-${randomUUID()}` }, tx),
      ).rejects.toMatchObject({ response: { code: 'LABEL_REPRINT_REQUIRED' } });
    });
  });

  it('작업 도중 수하인이 바뀌면 전진 스캔은 WAYBILL_STALE 코드로 거절된다(앱이 읽는 code)', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { simple } = assembleOutbound(tx);
      const labels = assembleLabels(ambientDbService(tx));
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      await tx.update(wmsTables.shipments).set({ recipientSnapshot: rawSql`recipient_snapshot || '{"detailAddress":"CHANGED"}'::jsonb` }).where(eq(wmsTables.shipments.id, box.shipmentId));
      await expect(
        simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: `scan-${randomUUID()}` }, tx),
      ).rejects.toMatchObject({ response: { code: 'WAYBILL_STALE' } });
    });
  });

  it('수기 송장 박스는 출력 기록 없이도 끝까지 출고된다(면제)', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 1);
      await startBatchFor(tx, box);
      const { simple } = assembleOutbound(tx);
      const state = await simple.scan(box.shipmentId, { barcode: box.barcode, quantity: 1, actor: actorOf(box), idempotencyKey: `scan-${randomUUID()}` }, tx);
      if (isPreparationBlocked(state)) throw new Error('Expected prepared outbound state');
      expect(state.status).toBe('shipped');
    });
  });
});
```

(«같은 키 재전송» 이 `simple.scan` 수준에서 저장된 응답을 돌려주는지는 `SimpleOutboundService.scan` 의 `commands.execute` 멱등 경로에 달렸다. `toEqual(first)` 가 실패하면 먼저 그 서비스가 재전송에 무엇을 돌려주도록 설계됐는지(기존 멱등 테스트)를 읽고 기대를 그것에 맞춘다 — 판정 기준은 «재전송이 LABEL_REPRINT_REQUIRED 로 거절되지 않는다» 다. 검수·발송 쪽은 첫 시나리오의 수량을 끝까지 채우면 `lockAggregate` 게이트를 지나 `shipped` 가 된다 — 수기 송장 시나리오가 그 경로의 면제를, 첫 시나리오가 한진 송장의 통과를 본다.)

`inRollbackTx` 안에서 거절을 기대한 뒤 같은 tx 를 계속 쓰는데, 거절이 SQL 오류가 아니라 앱 예외이고 `commands.execute` 가 세이브포인트로 감싸므로 tx 는 살아 있다. tx 가 aborted 로 끝나면 시나리오를 `it` 둘로 쪼갠다.

- [ ] **Step 6: 통과 + 커밋**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment && npm run test:core:integration:local -- fulfillment`
Expected: PASS.

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 낡은 송장으로는 피킹·검수·발송이 진행되지 않는다 — 재출력 게이트 I5 (#987)"
```

---

### Task 10: 송장 상태 — 송장 스캔 응답과 배치별 목록

**Files:**
- Create: `apps/core/src/modules/fulfillment/waybill/waybill-label-state.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill-label.controller.ts`, `waybill-label.service.ts`, `waybill.module.ts`(provider + export), `__support__/label-fixtures.ts`
- Modify: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts`
- Test: Create `waybill/waybill-label-state.reader.integration.spec.ts`; Modify `reader/shipment-waybill.reader.integration.spec.ts`

**Interfaces:**
- Consumes: Task 6 `labelStateOf`, Task 7 조립자
- Produces (PR 2·3 이 `withdrawing`·`withdrawn` 을 더한다):
  - `WaybillLabelStateReader.forShipment(shipmentId, tx?): Promise<LabelStateView | null>` (활성 작업 항목 없으면 null)
  - `WaybillLabelStateReader.forBatch(batchId, tx?): Promise<Array<{ shipmentId: string; workItemId: string } & LabelStateView>>`
  - `GET outbound-batches/:batchId/waybill-label-states`
  - `ShipmentByWaybillResult` 에 `labelState: LabelState | null; labelChanges: LabelItemChange[]; labelIssue: string | null`

- [ ] **Step 1: 실패하는 통합 테스트** `waybill-label-state.reader.integration.spec.ts` — 표 하나로 상태 전이를 훑는다:

```ts
  it('not_started → never_printed → current → reprint_required(바뀐 줄) — 조회는 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      const labels = assembleLabels(ambientDbService(tx));
      expect((await labels.states.forShipment(box.shipmentId, tx))?.state).toBe('not_started');
      await startBatchFor(tx, box);
      expect((await labels.states.forShipment(box.shipmentId, tx))?.state).toBe('never_printed');
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      expect((await labels.states.forShipment(box.shipmentId, tx))?.state).toBe('current');
      const newCode = `MOVED-${randomUUID()}`;
      await tx.update(wmsTables.locations).set({ code: newCode }).where(eq(wmsTables.locations.id, box.locationId));
      const view = await labels.states.forShipment(box.shipmentId, tx);
      expect(view?.state).toBe('reprint_required');
      expect(view?.changes.map((c) => [c.printedQty, c.currentQty])).toEqual([[2, 0], [0, 2]]);
      expect(await labels.prints.listByShipments(tx, [box.shipmentId])).toHaveLength(1);
    });
  });

  it('수기 송장은 external, 송장이 무효화된 박스는 unavailable + 사유 코드', async () => {
    await inRollbackTx(db, async (tx) => {
      const manual = await seedPickableShipment(tx, 1);
      await startBatchFor(tx, manual);
      const labels = assembleLabels(ambientDbService(tx));
      expect((await labels.states.forShipment(manual.shipmentId, tx))?.state).toBe('external');
      await tx.update(wmsTables.waybills).set({ status: 'voided', voidedAt: new Date() }).where(eq(wmsTables.waybills.id, manual.waybillId));
      expect(await labels.states.forShipment(manual.shipmentId, tx)).toMatchObject({ state: 'unavailable', issue: 'WAYBILL_NOT_DISPATCHABLE' });
    });
  });

  it('forBatch 는 배치의 활성 박스마다 상태를 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      await promoteToCarrierWaybill(tx, first);
      await startBatchFor(tx, first);
      const labels = assembleLabels(ambientDbService(tx));
      const states = await labels.states.forBatch(first.batchId, tx);
      expect(states.map((s) => [s.shipmentId, s.state]).sort()).toEqual([[first.shipmentId, 'never_printed'], [second.shipmentId, 'external']].sort());
    });
  });
```

Run: `npm run test:core:integration:local -- waybill-label-state` → FAIL.

- [ ] **Step 2: 상태 리더**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConflictError } from '@app/shared';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { DbTx, inventorySchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CurrentLabelSummary, labelStateOf, LabelStateView } from './label/label-print-policy';
import { WaybillLabelContentAssembler } from './waybill-label-content.assembler';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

const WI = wmsTables.outboundBatchWorkItems;

/**
 * 송장 상태(스펙 §10.5) — 조회 전용. 몇 번을 어느 PC 에서 불러도 같은 결과이고 아무것도 바꾸지 않는다.
 * 조립이 도메인 거절(ConflictError)로 실패하면 `unavailable` 로 보고한다 — 송장 스캔 자체를 실패시키지 않는다.
 */
@Injectable()
export class WaybillLabelStateReader {
  constructor(
    private readonly assembler: WaybillLabelContentAssembler,
    private readonly prints: WaybillLabelPrintRepository,
    @InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>,
  ) {}

  async forShipment(shipmentId: string, tx?: DbTx): Promise<LabelStateView | null> {
    return this.dbService.run(async (trx) => {
      const [item] = await trx
        .select({ batchStartedAt: wmsTables.outboundBatches.startedAt })
        .from(WI)
        .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, WI.batchId))
        .where(and(eq(WI.shipmentId, shipmentId), notInArray(WI.status, ['completed', 'excluded'])))
        .limit(1);
      if (!item) return null;
      return this.stateOf(trx, shipmentId, item.batchStartedAt !== null);
    }, tx);
  }

  async forBatch(batchId: string, tx?: DbTx): Promise<Array<{ shipmentId: string; workItemId: string } & LabelStateView>> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx
        .select({ startedAt: wmsTables.outboundBatches.startedAt })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const items = await trx
        .select({ id: WI.id, shipmentId: WI.shipmentId })
        .from(WI)
        .where(and(eq(WI.batchId, batchId), notInArray(WI.status, ['completed', 'excluded'])))
        .orderBy(asc(WI.shipmentId));
      const views = [];
      for (const item of items) {
        views.push({ shipmentId: item.shipmentId, workItemId: item.id, ...(await this.stateOf(trx, item.shipmentId, batch.startedAt !== null)) });
      }
      return views;
    }, tx);
  }

  private async stateOf(trx: DbTx, shipmentId: string, batchStarted: boolean): Promise<LabelStateView> {
    if (!batchStarted) return labelStateOf({ batchStarted, current: { kind: 'external' }, prints: [] });
    let current: CurrentLabelSummary;
    try {
      const label = await this.assembler.current(shipmentId, trx);
      current = label.kind === 'external' ? { kind: 'external' } : { kind: 'printable', fingerprint: label.fingerprint, items: label.content.items };
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      current = { kind: 'unavailable', issue: /^([A-Z][A-Z_]+):/.exec(error.message)?.[1] ?? 'CONFLICT' };
    }
    const prints = await this.prints.listByShipments(trx, [shipmentId]);
    return labelStateOf({ batchStarted, current, prints });
  }
}
```

(배치 하나에 박스 수백 개면 박스마다 조립 쿼리 5~6개다. 명시적 새로고침에서만 부르므로 이 PR 에서는 둔다 — 느리면 PR 2 이후 일괄 조회로 바꾼다. 커밋 본문에 적는다.)

`waybill.module.ts`: providers + exports 에 `WaybillLabelStateReader`. `WaybillLabelService.statesForBatch(batchId)` 위임. 컨트롤러:

```ts
  // 배치 카드의 «재출력 필요 N» 과 「실패·미인쇄만 다시」 대상(never_printed·reprint_required). 조회 전용.
  @Get('outbound-batches/:batchId/waybill-label-states')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  labelStates(@Param('batchId') batchId: string) {
    return this.labels.statesForBatch(batchId);
  }
```

`label-fixtures.ts` 반환에 `states: new WaybillLabelStateReader(assembler, prints, dbService)`.

- [ ] **Step 3: 송장 스캔 응답** — `ShipmentByWaybillResult` 에:

```ts
  /** 송장 상태(스펙 §10.5). 활성 작업 항목이 없으면 null. */
  labelState: LabelState | null;
  /** reprint_required 일 때 마지막 출력과 현재 품목 줄의 차이. */
  labelChanges: LabelItemChange[];
  /** unavailable 의 사유 코드. */
  labelIssue: string | null;
```

`ShipmentWaybillReader` 생성자에 `private readonly labelStates: WaybillLabelStateReader` 를 더하고, `byTrackingNo` 의 `dbService.run` 안에서 결과를 만들기 직전에 `const label = workItem ? await this.labelStates.forShipment(shipment.id, trx) : null;` 을 부르고 세 필드를 `label?.state ?? null`, `label?.changes ?? []`, `label?.issue ?? null` 로 채운다(변수 이름은 그 메서드의 것을 쓴다). `reader/shipment-waybill.reader.integration.spec.ts` 의 `new ShipmentWaybillReader(db)` 는 `new ShipmentWaybillReader(db, assembleLabels(db).states)` 로, 응답을 `toEqual` 로 고정한 곳에는 세 필드(수기 송장 픽스처라 시작된 배치면 `'external'`, 아니면 `'not_started'`)를 더한다. 새 테스트 하나: «시작된 배치의 한진 송장 박스를 조회하면 `labelState: 'never_printed'`».

- [ ] **Step 4: 통과 + 커밋**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment apps/core/src/platform/auth scripts/security && npm run test:core:integration:local -- 'waybill-label-state|shipment-waybill.reader'`
Expected: PASS.

```bash
git add -A apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 송장 스캔과 배치별 조회가 송장 상태(labelState)를 싣는다 (#987)"
```

---

### Task 11: 앱 — 오류 계약(새 거절 코드·`errors` 본문·문구)

**Files:**
- Modify: `native/warehouse-app/src/core/data/httpClient.ts`
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts`
- Test: `native/warehouse-app/src/core/data/httpClient.test.ts`, `native/warehouse-app/src/core/data/errorMessage.test.ts`

**Interfaces:**
- Produces: `ApiError.errors?: unknown`(409 본문의 `errors` 그대로), `ConflictError(message, code?, preparation?, errors?)`, `PreparationBlockReason` 에 `'BATCH_NOT_STARTED'`, `rejected` 로 분류되는 코드에 `BATCH_START_BLOCKED`·`LABEL_REPRINT_REQUIRED`·`LABEL_CONTENT_CHANGED`·`WAYBILL_STALE`·`WAYBILL_NOT_DISPATCHABLE`·`WAYBILL_LABEL_NOT_ALLOCATED`

- [ ] **Step 1: 실패하는 테스트** — `httpClient.test.ts` 에(기존 409 테스트의 가짜 fetch 헬퍼를 그대로 쓴다):

```ts
  it('409 본문의 errors 를 ConflictError.errors 로 싣는다(배치 시작 차단 목록)', async () => {
    const api = clientReturning(409, { code: 'BATCH_START_BLOCKED', message: 'x', errors: [{ shipmentId: 's1', reason: 'STOCK_SHORT' }] });
    const error = await api.request({ method: 'POST', path: '/picking/v2/starts' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).errors).toEqual([{ shipmentId: 's1', reason: 'STOCK_SHORT' }]);
    expect((error as ConflictError).outcome).toBe('rejected');
  });

  it.each(['LABEL_REPRINT_REQUIRED', 'LABEL_CONTENT_CHANGED', 'WAYBILL_STALE', 'WAYBILL_NOT_DISPATCHABLE', 'WAYBILL_LABEL_NOT_ALLOCATED'])(
    '%s 409 는 rejected — 오프라인 작업 큐가 재시도하지 않는다',
    (code) => {
      expect(new ConflictError('m', code).outcome).toBe('rejected');
    },
  );

  it('BATCH_NOT_STARTED 준비 차단을 파싱한다', () => {
    expect(parsePreparationRejection({ reasonCode: 'BATCH_NOT_STARTED', recovery: 'review_batch' })).toEqual({ reasonCode: 'BATCH_NOT_STARTED', recovery: 'review_batch' });
  });
```

(`clientReturning` 은 그 테스트 파일에 이미 있는 가짜 fetch 조립 방식 이름으로 맞춘다 — 없으면 `createApiClient({ baseUrl: 'http://x', getToken: async () => 't', authMode: 'bearer', doFetch: async () => new Response(JSON.stringify(body), { status }) as never })`.)

`errorMessage.test.ts` 에:

```ts
  it.each([
    [new ApiError('작업이 반영되지 않았어요.', 400, 'SIMPLE_OUTBOUND_PLAN_INVALIDATED', { reasonCode: 'BATCH_NOT_STARTED', recovery: 'review_batch' }), '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.'],
    [new ConflictError('m', 'LABEL_REPRINT_REQUIRED'), '송장이 바뀌었거나 아직 출력하지 않았어요. 송장을 다시 스캔해 출력한 뒤 계속해 주세요.'],
    [new ConflictError('m', 'WAYBILL_STALE'), '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.'],
    [new ConflictError('m', 'WAYBILL_LABEL_NOT_ALLOCATED'), '작업이 시작되지 않은 박스예요. 배치 화면에서 「작업 시작」을 먼저 눌러 주세요.'],
  ])('출고 문구 %#', (error, expected) => {
    expect(errorMessage(error, 'outbound')).toBe(expected);
  });
```

Run: `cd native/warehouse-app && npx vitest run src/core/data` → FAIL.

- [ ] **Step 2: 구현**

`httpClient.ts`:
- `preparationReasons` 배열에 `'BATCH_NOT_STARTED'`(주석 «Keep aligned with outbound-preparation-result.ts and the HTTP exception filter» 대로 core 두 곳과 같은 PR 에서 맞춘다).
- `ApiError` 에 `readonly errors?: unknown;` 필드와 생성자 5번째 인자 `errors?: unknown`(`this.errors = errors;`). `ConflictError` 생성자에 4번째 인자 `errors?: unknown` 를 받아 `super(message, 409, code, preparation, errors)`.
- rejected 코드 목록 배열에 `'BATCH_START_BLOCKED'`, `'LABEL_REPRINT_REQUIRED'`, `'LABEL_CONTENT_CHANGED'`, `'WAYBILL_STALE'`, `'WAYBILL_NOT_DISPATCHABLE'`, `'WAYBILL_LABEL_NOT_ALLOCATED'` 추가.
- `request()` 의 409 분기에서 본문 타입에 `errors?: unknown;` 를 더하고 `throw new ConflictError(body.message ?? 'version conflict', body.code ?? body.error, parsePreparationRejection(body.details), body.errors);`

`errorMessage.ts`:
- 준비 차단 분기에서 `review_batch` 검사 **앞에**: `if (error.preparation.reasonCode === 'BATCH_NOT_STARTED') return '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.';`
- `OUTBOUND_CONFLICT_MESSAGES` 에:

```ts
  LABEL_REPRINT_REQUIRED:
    '송장이 바뀌었거나 아직 출력하지 않았어요. 송장을 다시 스캔해 출력한 뒤 계속해 주세요.',
  WAYBILL_STALE:
    '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
  WAYBILL_NOT_DISPATCHABLE:
    '한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.',
  WAYBILL_LABEL_NOT_ALLOCATED:
    '작업이 시작되지 않은 박스예요. 배치 화면에서 「작업 시작」을 먼저 눌러 주세요.',
```

(`WAYBILL_STALE`·`WAYBILL_NOT_DISPATCHABLE` 문구는 `domains/outbound/waybillLabel.ts` 의 `CONFLICT_MESSAGES` 와 같은 문장이다 — 한쪽만 고쳐 갈리지 않게 `waybillLabel.ts` 가 이 두 값을 `errorMessage.ts` 에서 export 한 상수로 가져오게 바꾼다.)

- [ ] **Step 3: 통과 + 커밋**

Run: `cd native/warehouse-app && npx vitest run src/core/data && npx tsc -b` 그리고 루트에서 `npm run type-check`(백엔드 통합 스펙 두 개가 `httpClient` 를 import 한다).
Expected: PASS.

```bash
git add native/warehouse-app/src/core/data native/warehouse-app/src/domains/outbound/waybillLabel.ts
git commit -m "feat(warehouse-app): 작업 시작·재출력 게이트의 거절 코드와 문구 (#987)"
```

---

### Task 12: 앱 — 배치 카드의 「작업 시작」과 시작 실패 화면

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/batchStart.ts`
- Create: `native/warehouse-app/src/domains/outbound/StartBatchButton.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/types.ts` (`OutboundBatchSummary.startedAt`)
- Modify: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`
- Test: Create `batchStart.test.ts`, Create `StartBatchButton.test.tsx`, Modify `OutboundQueueScreen.test.tsx`

**Interfaces:**
- Consumes: Task 11 `ConflictError.errors`, core `POST /picking/v2/starts`, 목록의 `startedAt`
- Produces: `startBatch(api, batchId, idempotencyKey)`, `startBlockersOf(error): StartBlocker[] | null`, `groupStartBlockers(blockers): BlockerGroup[]`, `<StartBatchButton batchId onStarted? />`

- [ ] **Step 1: 순수 함수 테스트(실패)** `batchStart.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/data/httpClient';
import { groupStartBlockers, startBlockersOf, type StartBlocker } from './batchStart';

const blocker = (over: Partial<StartBlocker>): StartBlocker => ({
  shipmentId: 's1', reason: 'STOCK_SHORT', shipmentLineId: 'l1', skuId: 'k1', requiredQty: 3, shortQty: 1,
  detail: null, trackingNo: '452716978431', skuCode: 'SKU-1', skuName: '볼펜', ...over,
});

describe('startBlockersOf', () => {
  it('BATCH_START_BLOCKED 409 의 errors 를 꺼낸다', () => {
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [blocker({})]))).toEqual([blocker({})]);
  });
  it.each([
    ['다른 코드', new ConflictError('m', 'CONFLICT', undefined, [blocker({})])],
    ['errors 가 배열이 아님', new ConflictError('m', 'BATCH_START_BLOCKED', undefined, { x: 1 })],
    ['일반 오류', new Error('x')],
  ])('%s → null', (_label, error) => expect(startBlockersOf(error)).toBeNull());
  it('모양이 깨진 항목은 버린다', () => {
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [{ reason: 'STOCK_SHORT' }, blocker({})]))).toEqual([blocker({})]);
  });
});

describe('groupStartBlockers', () => {
  it('사유별로 묶고 적치 대기 → 재고 부족 → 송장 순, 줄 문구에 송장 번호·상품·수량', () => {
    const groups = groupStartBlockers([
      blocker({ reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'WAYBILL_STALE: x' }),
      blocker({ reason: 'STOCK_SHORT' }),
      blocker({ reason: 'INBOUND_PENDING', shortQty: 2 }),
    ]);
    expect(groups.map((g) => g.reason)).toEqual(['INBOUND_PENDING', 'STOCK_SHORT', 'WAYBILL_NOT_READY']);
    expect(groups[1].rows).toEqual(['4527-1697-8431 · 볼펜 3개 중 1개 부족']);
    expect(groups[2].rows).toEqual(['4527-1697-8431 · 송장 재발급 필요']);
  });
});
```

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/batchStart.test.ts` → FAIL.

- [ ] **Step 2: 구현** `batchStart.ts`:

```ts
import { ConflictError, type ApiClient } from '../../core/data/httpClient';

export type StartBlockReason = 'INBOUND_PENDING' | 'STOCK_SHORT' | 'WAYBILL_NOT_READY';

/** core `StartBlockerView` 와 같은 모양(picking/allocation/allocation.types.ts). */
export interface StartBlocker {
  shipmentId: string;
  reason: StartBlockReason;
  shipmentLineId: string | null;
  skuId: string | null;
  requiredQty: number | null;
  shortQty: number | null;
  detail: string | null;
  trackingNo: string | null;
  skuCode: string | null;
  skuName: string | null;
}

export interface BatchStartResult {
  state: 'started';
  batchId: string;
  sessionId: string;
}

/** 「작업 시작」 — 멱등. 같은 배치에 다시 보내도 같은 세션이다. 키는 누를 때마다 새로 만든다. */
export function startBatch(api: ApiClient, batchId: string, idempotencyKey: string): Promise<BatchStartResult> {
  return api.request<BatchStartResult>({ method: 'POST', path: '/picking/v2/starts', body: { batchId }, idempotencyKey });
}

const REASONS: readonly StartBlockReason[] = ['INBOUND_PENDING', 'STOCK_SHORT', 'WAYBILL_NOT_READY'];

function isBlocker(value: unknown): value is StartBlocker {
  if (typeof value !== 'object' || value === null) return false;
  const v: { shipmentId?: unknown; reason?: unknown } = value;
  return typeof v.shipmentId === 'string' && REASONS.some((r) => r === v.reason);
}

/** 시작 거절(BATCH_START_BLOCKED)이면 막힌 박스 목록, 아니면 null. */
export function startBlockersOf(error: unknown): StartBlocker[] | null {
  if (!(error instanceof ConflictError) || error.code !== 'BATCH_START_BLOCKED' || !Array.isArray(error.errors)) return null;
  return error.errors.filter(isBlocker);
}

export interface BlockerGroup {
  reason: StartBlockReason;
  title: string;
  guidance: string;
  rows: string[];
}

const GROUP_TEXT: Record<StartBlockReason, { title: string; guidance: string }> = {
  INBOUND_PENDING: {
    title: '적치 대기 중인 상품',
    guidance: '적치를 끝낸 뒤 다시 「작업 시작」을 누르거나, 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
  },
  STOCK_SHORT: { title: '재고 부족', guidance: '관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.' },
  WAYBILL_NOT_READY: {
    title: '송장 미발급·재발급 필요',
    guidance: '송장을 발급(재발급)한 뒤 다시 시작하거나, 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
  },
};

const tracking = (b: StartBlocker) =>
  b.trackingNo && /^\d{12}$/.test(b.trackingNo)
    ? b.trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3')
    : (b.trackingNo ?? `박스 ${b.shipmentId.slice(0, 8)}`);

function rowOf(b: StartBlocker): string {
  if (b.reason === 'WAYBILL_NOT_READY') return `${tracking(b)} · 송장 재발급 필요`;
  return `${tracking(b)} · ${b.skuName ?? b.skuCode ?? '상품'} ${b.requiredQty ?? '?'}개 중 ${b.shortQty ?? '?'}개 부족`;
}

/** 사유별로 묶는다(스펙 §6 «앱은 사유별로 묶어 안내한다»). 순서는 적치 대기 → 재고 부족 → 송장. */
export function groupStartBlockers(blockers: readonly StartBlocker[]): BlockerGroup[] {
  return REASONS.flatMap((reason) => {
    const rows = blockers.filter((b) => b.reason === reason).map(rowOf);
    return rows.length ? [{ reason, ...GROUP_TEXT[reason], rows }] : [];
  });
}
```

(«이 박스 빼기» 버튼은 PR 2 의 범위다(스펙 §8). 이 PR 은 안내만 한다 — 시작 전 배치의 제외는 관리자 화면이 이미 한다.)

- [ ] **Step 3: 버튼 컴포넌트 테스트(실패)** `StartBatchButton.test.tsx` — `BatchLabelPrintButton.test.tsx` 의 `mount` 방식(SessionProvider·QueryClientProvider·ApiClientProvider + 가짜 클라이언트)을 그대로 쓴다:

```tsx
  it('누르면 POST /picking/v2/starts 를 보내고 배치 목록을 무효화한다', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const { client, user } = mount({ request: async (o) => { calls.push({ path: o.path, body: o.body }); return { state: 'started', batchId: 'b-1', sessionId: 'x' }; } });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(calls).toEqual([{ path: '/picking/v2/starts', body: { batchId: 'b-1' } }]);
    expect(client.getQueryState(['outbound-batches', 'wh-1', 'created'])?.isInvalidated).toBe(true);
  });

  it('막히면 사유별 묶음과 안내를 보여 주고, 다시 누를 수 있다', async () => {
    const { user } = mount({
      request: async () => {
        throw new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [
          { shipmentId: 's1', reason: 'INBOUND_PENDING', shipmentLineId: 'l1', skuId: 'k', requiredQty: 2, shortQty: 2, detail: null, trackingNo: '452716978431', skuCode: 'K', skuName: '볼펜' },
        ]);
      },
    });
    await user.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(await screen.findByText('적치 대기 중인 상품')).toBeInTheDocument();
    expect(screen.getByText('4527-1697-8431 · 볼펜 2개 중 2개 부족')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeEnabled();
  });
```

(`mount` 가 미리 `['outbound-batches', 'wh-1', 'created']` 캐시를 채워 두게 한다. 헬퍼 모양은 기존 테스트 파일을 열어 맞춘다.)

- [ ] **Step 4: 구현** `StartBatchButton.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { groupStartBlockers, startBatch, startBlockersOf, type BlockerGroup } from './batchStart';

/**
 * 배치 카드의 「작업 시작」(스펙 E6). 이 버튼만 배치를 시작한다 — 시작되면 재고 통제와 배정이 확정되고,
 * 그 뒤에만 「송장 인쇄」가 켜진다. 막히면 막힌 박스를 사유별로 전부 보여 준다(E7).
 */
export function StartBatchButton({ batchId, onStarted }: { batchId: string; onStarted?: () => void }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [groups, setGroups] = useState<BlockerGroup[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => startBatch(api, batchId, crypto.randomUUID()),
    onSuccess: async () => {
      setGroups(null);
      setNotice(null);
      await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
      onStarted?.();
    },
    onError: (error) => {
      const blockers = startBlockersOf(error);
      if (blockers) {
        setGroups(groupStartBlockers(blockers));
        setNotice(null);
      } else {
        setGroups(null);
        setNotice(errorMessage(error, 'outbound'));
      }
    },
  });
  return (
    <div className="space-y-2">
      <Button onClick={() => start.mutate()} disabled={start.isPending}>
        작업 시작
      </Button>
      {notice !== null && <p role="alert">{notice}</p>}
      {groups !== null && (
        <section role="alert" className="space-y-2 rounded border border-red-300 px-3 py-2">
          <p className="font-medium">시작하지 못했어요 — 아래 박스를 먼저 처리해 주세요</p>
          {groups.map((group) => (
            <div key={group.reason}>
              <p className="text-sm font-medium">{group.title}</p>
              <ul className="text-sm">
                {group.rows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
              <p className="text-sm text-neutral-500">{group.guidance}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
```

(`Button` 의 `disabled`·`onClick` props 이름은 `core/design/Button` 을 열어 맞춘다. `rows` 에 같은 문구가 둘이면 key 가 겹친다 — `key={\`${index}-${row}\`}` 로 둔다.)

- [ ] **Step 5: 카드 배선** — `types.ts` `OutboundBatchSummary` 에 `startedAt: string | null;`. `OutboundQueueScreen.tsx` 의 배치 `<li>` 안 `labelPrinting && <BatchLabelPrintButton …/>` 를:

```tsx
              {batch.startedAt === null ? (
                <StartBatchButton batchId={batch.id} />
              ) : (
                labelPrinting && (
                  <BatchLabelPrintButton
                    batchId={batch.id}
                    prefs={prefs}
                    print={print}
                    disabled={printingBatch !== null && printingBatch !== batch.id}
                    onRunningChange={(running) => onLabelRunChange(batch.id, running)}
                  />
                )
              )}
```

(「작업 시작」은 모든 기기에 보인다 — 시작은 인쇄와 달리 프린터가 필요 없다. 시작 전 배치에서 송장 인쇄는 보이지 않는다(E6).) `OutboundQueueScreen.test.tsx` 의 배치 목록 가짜 응답에 `startedAt` 을 넣고 두 케이스를 더한다: «시작 전 배치에는 「작업 시작」만 있고 송장 인쇄는 없다(station 이어도)», «시작된 배치에는 「작업 시작」이 없고 station 이면 송장 인쇄가 있다».

- [ ] **Step 6: 통과 + 커밋**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound && npx tsc -b`
Expected: PASS.

```bash
git add native/warehouse-app/src/domains/outbound
git commit -m "feat(warehouse-app): 배치 카드의 「작업 시작」과 막힌 박스 사유별 안내 (#987)"
```

---

### Task 13: 앱 — 인쇄 뒤 출력 확인, 판차, «재출력 필요 N»

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/waybillLabel.ts`
- Modify: `native/warehouse-app/src/domains/outbound/BatchLabelPrintButton.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/ReprintLabelButton.tsx`
- Test: `waybillLabel.test.ts`, `BatchLabelPrintButton.test.tsx`, `ReprintLabelButton.test.tsx`

**Interfaces:**
- Consumes: core `GET …/waybill/label`(fingerprint·revision), `POST …/waybill/label-prints`, `GET outbound-batches/:batchId/waybill-label-states`
- Produces:
  - `WaybillLabel` 에 `fingerprint: string; revision: number`
  - `confirmLabelPrinted(api, shipmentId, fingerprint): Promise<void>`
  - `LabelPrintDeps` 에 `confirm: (shipmentId: string, fingerprint: string) => Promise<void>`
  - `class LabelConfirmError extends Error { pages: number; cause: unknown }`
  - `BatchLabelState { shipmentId; workItemId; state: LabelState; changes: LabelItemChange[]; issue: string | null }`, `fetchBatchLabelStates(api, batchId)`, `reprintTargets(states): string[]`
  - `type LabelState`, `LabelItemChange` 은 Task 14 의 `labelGate.ts` 가 import 한다 — 여기 `waybillLabel.ts` 에서 export

- [ ] **Step 1: 실패하는 테스트** — `waybillLabel.test.ts`:

```ts
describe('printOneLabel — 출력 확인', () => {
  const label = { waybillId: 'w', trackingNo: 't', format: 'zpl', data: '^XA^XZ', pages: 1, fingerprint: 'f'.repeat(64), revision: 2 };

  it('프린터 전송이 성공한 뒤에만 그 지문으로 확인한다', async () => {
    const order: string[] = [];
    await printOneLabel(
      { fetchLabel: async () => label, print: async () => void order.push('print'), confirm: async (_id, fp) => void order.push(`confirm:${fp.slice(0, 2)}`), target: 'p' },
      's1',
    );
    expect(order).toEqual(['print', 'confirm:ff']);
  });

  it('프린터가 실패하면 확인하지 않는다', async () => {
    const confirm = vi.fn();
    await expect(printOneLabel({ fetchLabel: async () => label, print: async () => { throw new PrinterError('x'); }, confirm, target: 'p' }, 's1')).rejects.toBeInstanceOf(PrinterError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('확인이 실패하면 LabelConfirmError(쪽 수 포함) — 종이는 이미 나왔다', async () => {
    const error = await printOneLabel(
      { fetchLabel: async () => label, print: async () => {}, confirm: async () => { throw new ConflictError('LABEL_CONTENT_CHANGED: x', 'CONFLICT'); }, target: 'p' },
      's1',
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LabelConfirmError);
    expect((error as LabelConfirmError).pages).toBe(1);
  });
});

describe('labelErrorMessage — 확인 실패', () => {
  it.each([
    [new LabelConfirmError(1, new ConflictError('LABEL_CONTENT_CHANGED: x', 'CONFLICT')), '인쇄하는 사이 송장 내용이 바뀌었어요. 방금 나온 송장은 버리고 다시 인쇄해 주세요.'],
    [new LabelConfirmError(1, new Error('network')), '송장은 나왔지만 출력 확인을 저장하지 못했어요. 다시 인쇄해 주세요.'],
    [new ConflictError('WAYBILL_LABEL_NOT_ALLOCATED: x', 'CONFLICT'), '작업이 시작되지 않은 박스예요. 배치 화면에서 「작업 시작」을 먼저 눌러 주세요.'],
  ])('%#', (error, expected) => expect(labelErrorMessage(error)).toBe(expected));
});

describe('runBatchLabelPrint — 확인 실패는 건너뛰되 장수는 센다', () => {
  it('확인 실패 건은 skipped 이고 sheets 에 들어간다', async () => {
    const result = await runBatchLabelPrint({
      shipmentIds: ['s1'],
      fetchLabel: async () => ({ waybillId: 'w', trackingNo: 't', format: 'zpl', data: 'x', pages: 2, fingerprint: 'f'.repeat(64), revision: 1 }),
      print: async () => {},
      confirm: async () => { throw new Error('network'); },
      target: 'p',
    });
    expect(result.skipped.map((s) => s.shipmentId)).toEqual(['s1']);
    expect(result.sheets).toBe(2);
  });
});

describe('reprintTargets', () => {
  it('never_printed·reprint_required 만', () => {
    const s = (shipmentId: string, state: LabelState) => ({ shipmentId, workItemId: `w-${shipmentId}`, state, changes: [], issue: null });
    expect(reprintTargets([s('a', 'current'), s('b', 'never_printed'), s('c', 'reprint_required'), s('d', 'external'), s('e', 'unavailable')])).toEqual(['b', 'c']);
  });
});
```

기존 테스트의 `LabelPrintDeps` 리터럴·라벨 픽스처에는 `confirm: async () => {}` 와 `fingerprint`·`revision` 을 더한다. `labelErrorMessage` 의 `WAYBILL_LABEL_NOT_ALLOCATED` 는 접두어 정규식이 이미 `WAYBILL_` 로 읽는다 — 문구만 더한다.

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/waybillLabel.test.ts` → FAIL.

- [ ] **Step 2: 구현** — `waybillLabel.ts`:

`WaybillLabel` 에 필드 추가(주석: «이 종이의 내용 지문 — 인쇄 성공 뒤 그대로 확인에 보낸다», «판차 — 2 이상이면 종이에 N판»). 추가 export:

```ts
export type LabelState = 'current' | 'never_printed' | 'reprint_required' | 'not_started' | 'external' | 'unavailable';

export interface LabelItemChange {
  locationCode: string;
  skuId: string;
  name: string;
  printedQty: number;
  currentQty: number;
}

export interface BatchLabelState {
  shipmentId: string;
  workItemId: string;
  state: LabelState;
  changes: LabelItemChange[];
  issue: string | null;
}

export function confirmLabelPrinted(api: ApiClient, shipmentId: string, fingerprint: string): Promise<void> {
  return api.request<void>({ method: 'POST', path: `/shipments/${shipmentId}/waybill/label-prints`, body: { fingerprint } });
}

export function fetchBatchLabelStates(api: ApiClient, batchId: string): Promise<BatchLabelState[]> {
  return api.request<BatchLabelState[]>({ path: `/outbound-batches/${batchId}/waybill-label-states` });
}

/** 「실패·미인쇄만 다시」 대상(스펙 §10.5) — 서버가 판정한 상태로. 이 기기의 지난 실행 결과가 아니다. */
export function reprintTargets(states: readonly BatchLabelState[]): string[] {
  return states.filter((s) => s.state === 'never_printed' || s.state === 'reprint_required').map((s) => s.shipmentId);
}

```

`LabelConfirmError` — `tsconfig.app.json` 이 `erasableSyntaxOnly: true` 라 생성자 매개변수 프로퍼티를 못 쓴다. 필드 선언 + 대입으로 쓰고, `Error.cause` 와 겹치지 않게 원인은 `reason` 에 둔다:

```ts
/** 종이는 나왔는데 출력 확인을 못 남겼다. 장수는 세되 건은 «다시» 대상으로 남긴다. */
export class LabelConfirmError extends Error {
  readonly pages: number;
  readonly reason: unknown;
  constructor(pages: number, reason: unknown) {
    super('label printed but confirmation failed');
    this.name = 'LabelConfirmError';
    this.pages = pages;
    this.reason = reason;
  }
}
```

`LabelPrintDeps` 에 `confirm` 추가. `printOneLabel`:

```ts
export async function printOneLabel(deps: LabelPrintDeps, shipmentId: string): Promise<WaybillLabel> {
  const label = await deps.fetchLabel(shipmentId);
  if (!label.data) throw new EmptyLabelError(`empty label for shipment ${shipmentId}`);
  await deps.print(deps.target, label.data);
  // 전송 성공 뒤에만 확인한다(스펙 §10.3). 실패해도 종이는 이미 나왔다 — 장수는 세고 «다시» 대상으로 남긴다.
  try {
    await deps.confirm(shipmentId, label.fingerprint);
  } catch (error) {
    throw new LabelConfirmError(label.pages ?? 1, error);
  }
  return label;
}
```

`labelErrorMessage` 맨 앞(프린터 검사 다음)에:

```ts
  if (error instanceof LabelConfirmError) {
    return error.reason instanceof ConflictError && /^LABEL_CONTENT_CHANGED:/.test(error.reason.message)
      ? '인쇄하는 사이 송장 내용이 바뀌었어요. 방금 나온 송장은 버리고 다시 인쇄해 주세요.'
      : '송장은 나왔지만 출력 확인을 저장하지 못했어요. 다시 인쇄해 주세요.';
  }
```

`CODE_PREFIX` 를 `/^((?:WAYBILL|LABEL)_[A-Z_]+):/` 로 넓히고 `CONFLICT_MESSAGES` 에 `WAYBILL_LABEL_NOT_ALLOCATED` 문구(Task 11 의 `errorMessage.ts` 상수)를 더한다. `runBatchLabelPrint` 의 catch 에서 `PrinterError` 검사 다음에:

```ts
      if (error instanceof LabelConfirmError) result.sheets += error.pages;
```

(그다음 줄의 `result.skipped.push(...)` 는 그대로 — 확인 실패도 건너뛴 건이다.)

- [ ] **Step 3: 일괄 인쇄 버튼** — `BatchLabelPrintButton.tsx`:
  - `useQuery({ queryKey: ['waybill-label-states', batchId], queryFn: () => fetchBatchLabelStates(api, batchId) })` 로 상태를 읽고, 버튼 옆에 `재출력 필요 {reprintTargets(states).length}`(0 이면 숨김)를 보인다.
  - `runBatchLabelPrint` 에 `confirm: (id, fp) => confirmLabelPrinted(api, id, fp)` 를 넘긴다.
  - 실행이 끝나면(`finally`) `queryClient.invalidateQueries({ queryKey: ['waybill-label-states', batchId] })`.
  - 「실패·미인쇄만 다시」는 `retryTargets(lastResult)` 대신 **새로 받은** `reprintTargets(states)` 를 대상으로 한다(서버 판정이 정본 — 이 기기가 모르는 다른 PC 의 출력도 반영). 대상이 0 이면 버튼을 숨긴다. `retryTargets` 가 다른 곳에서 안 쓰이면 지우고 그 테스트도 지운다.
  - `printableShipmentIds`(첫 인쇄 대상)는 그대로 — 첫 인쇄는 활성 박스 전부다.

`BatchLabelPrintButton.test.tsx` 의 가짜 클라이언트에 `/outbound-batches/b-1/waybill-label-states` 와 `POST /shipments/:id/waybill/label-prints` 경로를 더하고, 테스트 두 건: «인쇄한 건마다 지문으로 출력 확인을 보낸다», «재출력 필요 N 을 보이고, 다시 누르면 그 N 건만 인쇄한다».

- [ ] **Step 4: 단건 재출력 버튼** — `ReprintLabelButton.tsx`: `printOneLabel` 에 `confirm` 을 넘기고, 성공 문구를 `송장을 다시 인쇄했어요 (${label.trackingNo}${label.revision >= 2 ? ` · ${label.revision}판` : ''}).`, 버튼 이름을 `송장 재출력` 으로(작업자 문구 규칙). 테스트의 기대 문구·버튼 이름을 함께 바꾼다. 성공 뒤 `queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] })`.

- [ ] **Step 5: 통과 + 커밋**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound && npx tsc -b`
Expected: PASS.

```bash
git add native/warehouse-app/src/domains/outbound
git commit -m "feat(warehouse-app): 인쇄 뒤 출력 확인과 판차, 배치별 재출력 필요 건수 (#987)"
```

---

### Task 14: 앱 — 송장 스캔 때 `labelState` 로 화면을 가른다

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/labelGate.ts`
- Modify: `native/warehouse-app/src/domains/outbound/types.ts` (`ShipmentByWaybill` 에 세 필드)
- Modify: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx` (`open`)
- Test: Create `labelGate.test.ts`, Modify `OutboundQueueScreen.test.tsx`

**Interfaces:**
- Consumes: Task 13 `LabelState`, `LabelItemChange`; Task 10 by-waybill 응답
- Produces: `labelGateOf(found, canPrint): LabelGateDecision` — `{ kind: 'open' } | { kind: 'print'; message; changes } | { kind: 'blocked'; message }`

- [ ] **Step 1: 표 테스트(실패)** `labelGate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { labelGateOf } from './labelGate';

const found = (labelState: string | null, over = {}) => ({ labelState, labelChanges: [], labelIssue: null, ...over }) as Parameters<typeof labelGateOf>[0];
const change = { locationCode: 'A-01', skuId: 's', name: '볼펜', printedQty: 1, currentQty: 2 };

describe('labelGateOf', () => {
  it.each([
    ['current', true, { kind: 'open' }],
    ['external', false, { kind: 'open' }],
    [null, false, { kind: 'open' }],
    ['never_printed', true, { kind: 'print', message: '송장을 아직 출력하지 않았어요. 출력한 뒤 송장을 다시 스캔해 주세요.', changes: [] }],
    ['never_printed', false, { kind: 'blocked', message: '송장을 아직 출력하지 않았어요. 프린터 있는 자리에서 출력해 주세요.' }],
    ['reprint_required', false, { kind: 'blocked', message: '송장이 바뀌었어요. 프린터 있는 자리에서 새 송장을 출력해 주세요.' }],
    ['not_started', true, { kind: 'blocked', message: '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.' }],
    ['unavailable', true, { kind: 'blocked', message: '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.' }],
  ])('%s (프린터 %s) → %o', (state, canPrint, expected) => {
    expect(labelGateOf(found(state), canPrint)).toEqual(expected);
  });

  it('reprint_required 는 바뀐 줄을 싣고 옛 송장을 버리라고 한다', () => {
    expect(labelGateOf(found('reprint_required', { labelChanges: [change] }), true)).toEqual({
      kind: 'print',
      message: '송장이 바뀌었어요. 새 송장을 출력하고 옛 송장은 버려 주세요.',
      changes: [change],
    });
  });

  it('unavailable 이 WAYBILL_STALE 이면 재발급 안내', () => {
    expect(labelGateOf(found('unavailable', { labelIssue: 'WAYBILL_STALE' }), true)).toEqual({
      kind: 'blocked',
      message: '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
    });
  });
});
```

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/labelGate.test.ts` → FAIL.

- [ ] **Step 2: 구현** `labelGate.ts`:

```ts
import type { ShipmentByWaybill } from './types';
import type { LabelItemChange } from './waybillLabel';
import { WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';

export type LabelGateDecision =
  | { kind: 'open' }
  | { kind: 'print'; message: string; changes: LabelItemChange[] }
  | { kind: 'blocked'; message: string };

/**
 * 송장 스캔 결과 → 화면(스펙 §10.5). 서버의 전진 명령도 같은 조건으로 막으므로(I5) 이건 헛걸음 방지다 —
 * 작업 화면에 들어가 첫 스캔에서 거절당하기 전에 입구에서 알려 준다.
 */
export function labelGateOf(
  found: Pick<ShipmentByWaybill, 'labelState' | 'labelChanges' | 'labelIssue'>,
  canPrint: boolean,
): LabelGateDecision {
  switch (found.labelState) {
    case 'never_printed':
      return canPrint
        ? { kind: 'print', message: '송장을 아직 출력하지 않았어요. 출력한 뒤 송장을 다시 스캔해 주세요.', changes: [] }
        : { kind: 'blocked', message: '송장을 아직 출력하지 않았어요. 프린터 있는 자리에서 출력해 주세요.' };
    case 'reprint_required':
      return canPrint
        ? { kind: 'print', message: '송장이 바뀌었어요. 새 송장을 출력하고 옛 송장은 버려 주세요.', changes: found.labelChanges }
        : { kind: 'blocked', message: '송장이 바뀌었어요. 프린터 있는 자리에서 새 송장을 출력해 주세요.' };
    case 'not_started':
      return { kind: 'blocked', message: '배치 화면에서 「작업 시작」을 먼저 눌러 주세요.' };
    case 'unavailable':
      return {
        kind: 'blocked',
        message: found.labelIssue === 'WAYBILL_STALE' ? WAYBILL_STALE_MESSAGE : '송장 상태를 확인할 수 없어요. 관리자에게 문의해 주세요.',
      };
    default:
      return { kind: 'open' };
  }
}
```

(`WAYBILL_STALE_MESSAGE` 는 Task 11 에서 `errorMessage.ts` 가 export 한 상수 이름으로 맞춘다.) `types.ts` `ShipmentByWaybill` 에:

```ts
  labelState: LabelState | null;
  labelChanges: LabelItemChange[];
  labelIssue: string | null;
```

(`import type { LabelItemChange, LabelState } from './waybillLabel'`.) `lastBox.ts` 가 `ShipmentByWaybill` 을 기기에 저장하므로 옛 저장본에는 세 필드가 없다 — `readLastBox` 는 재개 때 다시 조회하므로(`resumeWork` → `open`) 저장본의 이 필드는 읽지 않는다. 타입만 맞추면 된다.

- [ ] **Step 3: 화면 배선** — `OutboundQueueScreen.tsx` 의 `open` 에서 `workItemId === null` 검사 다음에:

```tsx
      const gate = labelGateOf(found, labelPrinting);
      if (gate.kind === 'blocked') {
        setNotice(gate.message);
        return;
      }
      if (gate.kind === 'print') {
        setPrintGate({ shipmentId: found.shipmentId, message: gate.message, changes: gate.changes });
        return;
      }
      setPrintGate(null);
```

상태 `const [printGate, setPrintGate] = useState<{ shipmentId: string; message: string; changes: LabelItemChange[] } | null>(null);` 와 알림 아래에 패널:

```tsx
      {printGate !== null && (
        <section role="alert" className="space-y-2 rounded border border-amber-400 px-3 py-2">
          <p className="font-medium">{printGate.message}</p>
          {printGate.changes.length > 0 && (
            <ul className="text-sm">
              {printGate.changes.map((c) => (
                <li key={`${c.locationCode}-${c.skuId}`}>
                  [{c.locationCode}] {c.name} {c.printedQty}개 → {c.currentQty}개
                </li>
              ))}
            </ul>
          )}
          <ReprintLabelButton shipmentId={printGate.shipmentId} prefs={prefs} print={print} />
        </section>
      )}
```

(`ReprintLabelButton` 의 `print` prop 은 기존 시그니처에 이미 있다. 새 스캔이 시작되면 `setPrintGate(null)` 을 `open` 첫머리(`setNotice(null)` 옆)에서 부른다.) 출력한 뒤에는 작업자가 송장을 다시 스캔한다 — 그때 `current` 가 되어 작업 화면이 열린다(스캔은 조회 전용이라 몇 번 해도 같다).

`OutboundQueueScreen.test.tsx` 에 세 케이스: «station 에서 `never_printed` 송장을 스캔하면 작업 화면으로 가지 않고 출력 패널을 보인다», «비station 에서 `reprint_required` 면 안내만», «`not_started` 면 작업 시작 안내». 기존 by-waybill 가짜 응답에는 `labelState: 'current', labelChanges: [], labelIssue: null` 을 더한다.

- [ ] **Step 4: 통과 + 커밋**

Run: `cd native/warehouse-app && npx vitest run && npx tsc -b && npx oxlint`
Expected: PASS.

```bash
git add native/warehouse-app/src
git commit -m "feat(warehouse-app): 송장 스캔 때 미출력·바뀐 송장은 작업 전에 출력 화면으로 (#987)"
```

---

### Task 15: 마무리 — 게이트, 문서, 스모크 체크리스트, PR

**Files:**
- Modify: `apps/core/src/modules/fulfillment/waybill/README.md` (출력 기록·게이트·상태 한 절)
- Modify: `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — **진행 상태는 적지 않는다**(스펙 §0). 이 계획이 스펙과 다르게 정한 것(사용자 결정 external, 게이트 진입점 목록, 판차 자리)은 스펙 본문에 «PR 1 계획이 정함» 으로 반영한다 — §10.4 «정확한 진입점 목록은 PR 1 계획이 코드에서 도출해 적고» 가 그 자리를 비워 뒀다
- 없음(검증만): 전체 게이트

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npm run test:core:integration:local
cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint
```

Expected: type-check 0, jest 실패 0, 통합 실패 0(develop 부터 붉던 스위트가 있으면 `git stash` 없이 develop 워크트리에서 같은 명령으로 대조해 «이 PR 이 만든 것 아님» 을 PR 본문에 적는다), 앱 전부 초록.

- [ ] **Step 2: 스펙·README 갱신** — README 에 «송장 = 피킹 지시서: 조립은 `WaybillLabelContentAssembler` 한 곳, 지문·출력 기록·재출력 게이트(I5)·`labelState`, 수기·한진 외 송장은 면제» 를 짧게. 스펙 §10.4 의 «정확한 진입점 목록은 PR 1 계획이 …» 문장 뒤에 도출 결과(전략 7곳 + `lockAggregate`, `bulkCartScan`·`claimPacker` 제외와 이유)와, §10.5 표에 `external`·`unavailable` 두 행(사용자 결정 2026-09-30 / 조립 실패)을 더한다. §10.1-4 판차 자리(쪽 표시 줄 앞)도 적는다.

- [ ] **Step 3: 커밋 + PR**

```bash
git add apps/core/src/modules/fulfillment/waybill/README.md docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md
git commit -m "docs(fulfillment): PR 1 이 정한 게이트 진입점·external 상태·판차 자리를 스펙에 반영 (#987)"
```

PR 본문(한국어)에 반드시 넣는다:
- `Closes #987`, 트래킹 #986
- **배포 순서: `db:migrate`(core, `add-waybill-label-prints`) → `sst deploy`** — 추가형(expand)
- **배포 전 확인(스펙 §15 PR 1):** 라이브에 시작된 배치(`outbound_batches.started_at IS NOT NULL` 이고 완료·취소 아님)의 활성 박스가 있는지 `sst shell` 로 센다. 있으면 그 박스는 출력 기록이 없어 I5 에 막힌다 → 배포 직후 그 배치에서 「송장 인쇄」를 한 번 누르면 풀린다. 시작 전인데 스캔으로 진행되던 배치는 이제 「작업 시작」을 먼저 눌러야 한다. (현재 라이브 출고는 셀메이트 수기이고 warehouse-app 출고는 컷오버 #923 전 — 배포 시점에 다시 확인)
- 운영 env `HANJIN_LABEL_TYPE=FS` 가 아니면 품목 줄·로케이션·판차가 종이에 안 나온다(NS·NL 은 품목 줄을 그리지 않는다)
- **로컬 E2E 사람 스모크 체크리스트**(스펙 §14 «배선은 사람 스모크», 브라우저·앱 로그인은 사람이):
  1. 배치 카드: 시작 전 배치엔 「작업 시작」만, 송장 인쇄 없음
  2. 재고가 모자란 박스를 넣은 배치에서 「작업 시작」 → 사유별 묶음(적치 대기 / 재고 부족 / 송장), 아무것도 시작 안 됨
  3. 정상 배치 「작업 시작」 → 카드에 송장 인쇄 + «재출력 필요 N»(= 박스 수)
  4. 일괄 인쇄 → FS 실물에 품목 줄마다 `[로케이션]` 이 찍히고 이름이 수량과 겹치지 않음, «재출력 필요» 0
  5. 인쇄 안 한 박스 송장 스캔(station) → 출력 패널, 인쇄 후 재스캔 → 작업 화면
  6. 관리자 DB 에서 그 박스 공동현관 비밀번호를 바꾸고 재스캔 → «송장이 바뀌었어요» + 재출력 → 새 종이에 `2판`(실물로 쪽 표시 줄 자리 확인)
  7. 낡은 종이(1판)만 들고 상품 스캔 시도 → «송장이 바뀌었거나…» 거절
  8. 수기 송장 박스 → 출력 없이 끝까지 출고
  9. 시작 안 된 배치 박스의 「출고 준비」 → «배치 화면에서 「작업 시작」을 먼저…»
- 알고 남기는 것: 배치별 상태 조회는 박스마다 조립 쿼리를 돈다(명시적 새로고침에서만), 용지 걸림은 출력 확인으로 못 잡는다(스펙 §16), `bulkCartScan`·`claimPacker` 는 게이트 밖(이유는 스펙 §10.4)

---

## Self-Review 기록

- **스펙 커버리지(§15 PR 1 범위):** §6 명시적 시작(T3)·E8(T1)·사유 전부 보고(T1·T2)·지연 시작 제거·`BATCH_NOT_STARTED`(T3) / §10.1 렌더러 로케이션·I4(T4·T5·T7) / §10.2 지문(T4) / §10.3 `waybill_label_prints`·출력 확인·판차 응답(T6·T7·T8) / §10.4 게이트·진입점 도출·가드 스펙(T9) / §10.5 `current`·`never_printed`·`reprint_required`·`not_started`(T10, + 사용자 결정 `external`, 조립 실패 `unavailable`) / 앱: 작업 시작 버튼·시작 실패 화면(T12), 인쇄 뒤 출력 확인·재출력 필요 N·판차 표기(T13), 재출력 화면(T14) / §11 PR 1 행(T6) / §12 PR 1 코드(`WAYBILL_LABEL_NOT_ALLOCATED`·`LABEL_CONTENT_CHANGED`·`LABEL_REPRINT_REQUIRED`·`BATCH_NOT_STARTED`·시작 실패 상세). §13 «박스에 닿는 연산은 작업 항목 잠금에서 줄을 선다» — 출력 확인(T8)·게이트(T9, 호출자 잠금 뒤) / §14 순수·가드·통합·앱 표 테스트.
- **범위 밖으로 둔 것(스펙이 PR 1 에서 뺀 것):** 합류·이탈·결품 재배정·`reconcileAllocation`·불변식 검사기의 I4.
- **타입 이름 일관성:** `StartBlocker`/`StartBlockerView`(core) ↔ `StartBlocker`(앱, View 모양) / `LabelItem{locationCode,skuId,name,quantity}` / `LabelStateView{state,changes,issue}` ↔ by-waybill `labelState/labelChanges/labelIssue` ↔ 앱 `BatchLabelState` / `LabelCurrencyGuard.assertCurrent(workItemId, trx)` / `WaybillLabelContentAssembler.current(shipmentId, trx)`.
