# PR 2 — 실행 중 배치에 합류 · 집기 전 박스 이탈 (#988) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「작업 시작」 뒤에도 급한 박스를 그 배치에 넣고(합류), 아직 집지 않은 박스를 뺄 수 있다(이탈). 다른 박스의 배정·송장 지문은 흔들리지 않는다.

**Architecture:** 모든 배정 변경은 순수 함수 `reconcileAllocation(목표, 현재 배정, 보관, 가용)` 한 곳이 할 일 목록을 만들고, 실행부 `BoxAllocationManager` 가 잠금 아래에서 적용만 한다. 합류는 목표 0 → 줄 수량(일반 가용에서 배정 + `HAND_IN`), 이탈은 목표 → 0(집지 않은 몫 `HAND_BACK`, 집은 몫이 있으면 `BOX_HAS_PICKED_ITEMS`). 세션 복구·불변식 검사기는 «배정마다 인계 합 − 반납 합 = 현재 배정»과 I1~I3 을 본다. warehouse-app 은 시작된 배치 카드에 「박스 넣기」(주문번호·송장번호 → 송장 발급 → 합류 → 출력)와 「박스 빼기」를 얻는다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · Jest(core) · React 19 + TanStack Query + Vitest(warehouse-app, Tauri)

**Spec:** `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — §1~§5 공통, §7·§8(집기 전 이탈만)·§11(PR 2 행)·§12·§13·§14·§15 PR 2 절. S1 스펙 `2026-09-29-outbound-live-allocation-design.md` §4.3·§5.1·§5.3·§5.4 가 `reconcileAllocation` 의 규칙이다. 실행자는 이 계획과 두 스펙을 **함께** 읽는다.

**트래킹:** #986 / 이 PR: #988. 선행: PR 1 #992(develop `835b53b54`). 참고 계획: `docs/superpowers/plans/2026-09-30-outbound-allocation-before-label-pr1.md`.

## Global Constraints

- core 와 warehouse-app 을 **이 PR 하나에서** 바꾸고 함께 배포한다(스펙 §15). PR 1 이 먼저 배포돼 있어야 한다.
- 스키마 변경은 전부 추가·완화형 — 배포 순서 **`migrate → deploy`**(CLAUDE.md expand phase).
- 서비스 계층은 `@app/shared` 도메인 예외, fulfillment HTTP 오류는 `ConflictException({ code, message })`(목록이 필요하면 `errors` 필드 — 전역 필터가 본문에 그대로 싣는다. `details` 는 준비 차단 전용 허용 목록이라 쓰지 않는다), waybill 오류는 `ConflictError('<CODE>: …')` 메시지 접두어(스펙 §12).
- 트랜잭션: 공개 메서드는 `tx?: DbTx` 마지막 인자 + `this.dbService.run(fn, tx)`, private 헬퍼는 `trx: DbTx` 필수(ADR-0025). `db.query.*`·`with` 금지, `any` 금지, 근거 없는 `as` 금지.
- **잠금 순서(스펙 §13, 이 계획이 합류에 맞춰 구체화):** 구성요소(불변식 검사기) → 작업 항목 → **세션 → 보관 행 → SKU 가용 잠금 → 재고 원장**. 발송(`ShipmentDispatchService`)이 «작업 항목 → 세션 → 보관 → 가용 잠금» 으로 잡으므로 합류도 세션을 가용 잠금보다 **먼저** 잡는다. 시작된 배치로의 합류는 **배치 행과 다른 박스의 작업 항목을 잠그지 않는다** — 세션 잠금이 같은 배치의 합류·발송 완료와 줄을 세운다(Task 6 에 이유).
- 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0(OOM 회피), `npx jest scripts/security`(IDOR 가드는 **서비스 파일 줄번호 좌표**다 — 오케스트레이터·세션 서비스에 줄을 넣으면 깨진다. 실패하면 가드가 알려 주는 대로 좌표를 갱신). 앱은 `cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint`.
- 통합 스펙은 `describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지. 실행은 `npm run test:core:integration:local -- <패턴>`(`--runInBand` 고정). 워크트리에서는 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 앞에 붙인다. 로컬 `core` DB 가 다른 브랜치 마이그 잔재로 `drizzle-kit migrate` 에서 멈추면(PR 1 에서 겪음) 새 DB 를 만든다: `docker compose exec -T postgres createdb -U postgres core_988` → `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_988 npx drizzle-kit migrate --config apps/core/drizzle.config.ts` → `DATABASE_URL=…/core_988 npx jest --testPathPattern=<패턴> --runInBand`.
- 작업자 문구는 «라벨»이 아니라 **«송장»**.
- 코드 좌표는 함수·파일 이름으로 적는다. 줄 번호로 찾지 말 것.
- **이 계획이 정한 것(스펙이 비워 두었거나 PR 2 에 맞게 좁힌 것 — Task 12 가 스펙 본문에 «PR 2 계획이 정함» 으로 반영):**
  1. 합류 실패는 코드 `BATCH_JOIN_BLOCKED`, `errors` 는 시작 실패와 같은 `StartBlockerView[]`(사유 `INBOUND_PENDING`·`STOCK_SHORT`·`WAYBILL_NOT_READY`). 시작 전 배치에 넣기의 오류 모양은 그대로다.
  2. 닫힌 배치(파생 상태 `completed`·`canceled`)와 **세션이 `active` 가 아닌 시작된 배치**는 `BATCH_NOT_JOINABLE`. 옛 `OUTBOUND_BATCH_CLOSED` 는 이 코드로 바뀐다.
  3. 시작된 배치의 박스가 모두 빠지면(포함 박스 0) 파생 상태 `canceled` — 세션은 그 순간 `settled` 라 되살릴 수 없다.
  4. PR 2 의 이탈 결과는 시작 전 제외와 같다: 작업 항목 `excluded`, 박스는 **`planned` 그대로**(예약·송장 유지, 다른 배치에 다시 넣을 수 있다). `exit_to` 는 PR 3.
  5. «집은 몫이 있다» = 박스 줄에 `inspected_qty > 0`, 또는 `reconcileAllocation` 이 `excess`(줄 귀속 보관)나 `cartSurplus`(토탈피킹 카트에 실렸을 수 있는 몫)를 낸다 → `BOX_HAS_PICKED_ITEMS`(목록은 `errors`). 토트 배정·발송 시도·결품 격리(`short_pick_recovery`)는 기존 거절 코드 그대로.
  6. 반납 순서: 한 줄의 배정 행 중 **로케이션 코드 역순**(채운 순서의 반대)으로 줄인다. 반납 → 카트 여분 → 뺄 물건 순.
  7. 세션 이벤트 멱등 키: 합류 인계 `hand-in:<명령 id>:<배정 id>`, 반납 `hand-back:<명령 id>:<배정 id>`. 배치 시작은 기존 `start:<배치 id>:<배정 id>` 그대로. `HAND_BACK` payload 는 `operationId`·`workItemId`·`allocationId`·`shipmentLineId`.
  8. 복구 규칙(스펙 §13 «배정마다 이벤트 합 = 현재 배정»): 배정마다 `HAND_IN` 이 하나 이상 있고 `Σ HAND_IN − Σ HAND_BACK = qty`. `HAND_IN` 의 요청 해시는 **이벤트 수량**으로 계산한다.
  9. 불변식 검사기(`FulfillmentInvariantService`)에 I1(`ALLOCATION_BEFORE_START`)·I2(`ALLOCATION_BELOW_TARGET`)·I3(`CUSTODY_EXCEEDS_ALLOCATION`). **I4 는 넣지 않는다** — 데이터 상태가 아니라 렌더 규칙이고 조립 함수(`assertLabelAllocated`)가 강제한다. 주기 대조 SQL(`FulfillmentReconciliationService`)은 보존식에 `handed_back_qty` 만 더한다.
  10. 앱이 찾는 «주문번호» = `sales_orders.display_order_no` 또는 `channel_order_id`, «송장번호» = 활성 송장 `tracking_no`. 찾기는 새 조회 `GET outbound-batches/:batchId/join-candidates?code=`.
  11. 앱이 합류 전에 발급하는 송장의 택배사는 **`HANJIN`** — 앱이 그릴 수 있는 유일한 택배사다(admin-web 기본값도 같다).
- **이 PR 에서 하지 않는 것(스펙 §15 PR 2 «아직 안 하는 것»):** 집은 몫이 있는 박스의 이탈(`BOX_HAS_PICKED_ITEMS` 로 거절), `withdrawing`·`exit_to`, 되돌림 바구니, 전체 취소 → 이탈 연결(E10), 결품 재배정. 박스 내용 증감(S2).

## Review Focus

1. **합류와 발송이 같은 배치·같은 SKU 에서 겹칠 때** — 합류가 가용 잠금을 세션보다 먼저 잡으면 «세션 → 가용 잠금» 인 발송과 교착한다. 기대: 합류는 세션을 먼저 잡고, 두 합류가 마지막 재고를 다투면 하나만 성공하고 다른 하나는 `BATCH_JOIN_BLOCKED(STOCK_SHORT)` 로 아무것도 안 바꾼다. → Task 6 커밋 동시성 테스트.
2. **빠졌던 박스를 같은 배치에 다시 넣을 때** — 옛 작업 항목의 0 배정 행과 새 작업 항목의 배정 행이 같은 줄·로케이션에 공존한다. 기대: 합류 성공, 복구 `healthy`, 불변식 통과, 세션의 줄 배정 검사(`assertAttributedQuantity`)가 합으로 맞다. → Task 7 테스트.
3. **토탈피킹 배치에서 카트에 이미 실린 SKU 의 박스를 뺄 때** — 누구 몫인지 모르는 카트 물량을 반납으로 처리하면 AT_SOURCE 가 음수가 되거나 원장이 틀어진다. 기대: `BOX_HAS_PICKED_ITEMS`, 무변경. AT_SOURCE 가 그 박스 몫을 덮으면 정상 반납. → Task 1 전수 열거 + Task 7 테스트.
4. **송장이 없는 급한 박스** — 앱이 발급 → 합류 → 출력을 한 동작으로 한다. 발급이 `registered` 가 아니면 합류하지 않고, 합류가 막히면 발급된 송장은 그대로 남아 다음 시도에 쓴다. → Task 10 순수 함수 테스트.
5. **배치의 박스를 전부 뺄 때** — 세션이 `settled` 가 되고 배치 카드가 «작업 시작»으로 되돌아가면 안 된다. 기대: 파생 상태 `canceled`, 다시 넣기는 `BATCH_NOT_JOINABLE`. → Task 7 테스트.

---

## 파일 지도

core (`apps/core/src/modules/fulfillment/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `picking/allocation/reconcile-allocation.ts` (신규) | 목표·배정·보관·가용 → 할 일 목록(순수) | 1 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` · `apps/core/drizzle/*_allocation-hand-back.sql` | 배정 `qty >= 0`, 세션 `handed_back_qty`·보존식 CHECK | 2 |
| `services/batch-inventory-session.service.ts` | `handIn`(실행 중 세션에 인계), `handBack`(`HAND_BACK`), 보존식 | 3 |
| `services/batch-session-recovery.service.ts` | `HAND_BACK` 재생, 배정별 합 규칙 | 4 |
| `services/fulfillment-invariant.service.ts` · `services/fulfillment-reconciliation.service.ts` | I1~I3, 보존식에 반납 | 5 |
| `services/__support__/logistics-assertions.ts` | `assertFulfillmentInvariantsFor` | 5 |
| `picking/allocation/allocation.locks.ts` · `allocation.errors.ts` | `lockSkuCapacities`, `joinBlocked`, `boxHasPickedItems` | 6·7 |
| `services/box-allocation.manager.ts` (신규) | 세션 잠금, 합류 계획·적용, 집기 전 반납 | 6·7 |
| `services/outbound-batch-orchestrator.service.ts` | 시작된 배치 합류·이탈 갈래, `findJoinCandidates`, 파생 상태 | 6·7·8 |
| `services/__support__/simple-outbound-wiring.ts` · `simple-outbound-fixtures.ts` | 배선(`boxes`·`startDeps`), `seedLooseBox` | 6 |
| `fulfillment.module.ts` · 오케스트레이터를 직접 생성하는 스펙 6개 | 생성자 인자 | 6 |
| `services/join-candidate.queries.ts` (신규) · `dto/outbound-batch-v2.dto.ts` · `controllers/outbound-batch-v2.controller.ts` · `reader/shipment-waybill.reader.ts` | 합류 후보 조회 | 8 |

warehouse-app (`native/warehouse-app/src/` 기준)

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `core/data/httpClient.ts` · `core/data/errorMessage.ts` | 새 거절 코드·문구 | 9 |
| `domains/outbound/batchStart.ts` | 차단 묶기를 문구 표 인자로 일반화 | 10 |
| `domains/outbound/batchJoin.ts` (신규) · `JoinBoxPanel.tsx` (신규) | 찾기 → 발급 → 합류 → 출력 | 10 |
| `domains/outbound/batchRemove.ts` (신규) · `RemoveBoxPanel.tsx` (신규) | 송장번호 → 빼기 | 11 |
| `domains/outbound/OutboundQueueScreen.tsx` | 시작된 배치 카드의 두 버튼, 스캔 경로 | 10·11 |

---

### Task 1: `reconcileAllocation` — 배정 증감 규칙(순수)

**Files:**
- Create: `apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.ts`
- Test: `apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.spec.ts`

**Interfaces:**
- Consumes: `allocateLines(lines, capacities, inboundPendingBySku?)`, `AllocatableLine`, `AllocationDraft`(`allocate-lines.ts`), `SourceCapacity`, `LineShortage`(`allocation.types.ts`)
- Produces:
  - `atSourceKey(skuId: string, sourceLocationId: string): string` — `${skuId}|${sourceLocationId}`
  - `ReconcileTarget { shipmentLineId; skuId; targetQty }`
  - `ReconcileAllocationRow { allocationId; shipmentLineId; skuId; sourceLocationId; locationCode; qty; attributedQty }`
  - `AllocationDecrement { allocationId; shipmentLineId; skuId; sourceLocationId; qty }`
  - `ReconcilePlan { handIns: AllocationDraft[]; handBacks: AllocationDecrement[]; cartSurplus: AllocationDecrement[]; excess: AllocationDecrement[]; shortages: LineShortage[] }`
  - `ReconcileInput { workItemId; targets; allocations; atSource: ReadonlyMap<string, number>; capacities; inboundPendingBySku? }`
  - `reconcileAllocation(input: ReconcileInput): ReconcilePlan` — 입력을 바꾸지 않는다, 결정적

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `reconcile-allocation.spec.ts`:

```ts
import { reconcileAllocation, atSourceKey, ReconcileAllocationRow, ReconcileInput, ReconcilePlan } from './reconcile-allocation';
import { SourceCapacity } from './allocation.types';

const cap = (skuId: string, sourceLocationId: string, locationCode: string, remainingQty: number): SourceCapacity => ({
  skuId,
  sourceLocationId,
  locationCode,
  remainingQty,
  stockVersion: 1,
});
const row = (
  allocationId: string,
  sourceLocationId: string,
  locationCode: string,
  qty: number,
  attributedQty = 0,
  shipmentLineId = 'line-1',
  skuId = 'sku',
): ReconcileAllocationRow => ({ allocationId, shipmentLineId, skuId, sourceLocationId, locationCode, qty, attributedQty });
const base = (overrides: Partial<ReconcileInput>): ReconcileInput => ({
  workItemId: 'wi',
  targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: 0 }],
  allocations: [],
  atSource: new Map(),
  capacities: [],
  ...overrides,
});

describe('reconcileAllocation — 사건별', () => {
  it('합류(0 → 줄 수량)는 일반 가용에서 E8 로 배정한다 — 한 로케이션 전량 우선', () => {
    const plan = reconcileAllocation(
      base({
        targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: 2 }],
        capacities: [cap('sku', 'loc-a', 'A-01', 1), cap('sku', 'loc-b', 'B-01', 5)],
      }),
    );
    expect(plan).toEqual({
      handIns: [{ workItemId: 'wi', shipmentLineId: 'line-1', sourceLocationId: 'loc-b', qty: 2, sourceStockVersion: 1 }],
      handBacks: [],
      cartSurplus: [],
      excess: [],
      shortages: [],
    });
  });

  it('합류가 모자라면 배정 없이 모자란 줄과 사유를 돌려준다', () => {
    const plan = reconcileAllocation(
      base({
        targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: 3 }],
        capacities: [cap('sku', 'loc-a', 'A-01', 1)],
        inboundPendingBySku: new Map([['sku', 5]]),
      }),
    );
    expect(plan.handIns).toEqual([]);
    expect(plan.shortages).toEqual([
      { workItemId: 'wi', shipmentLineId: 'line-1', skuId: 'sku', requiredQty: 3, shortQty: 2, reason: 'INBOUND_PENDING' },
    ]);
  });

  it('이탈(→ 0)은 집지 않은 몫을 코드 역순으로 반납한다', () => {
    const plan = reconcileAllocation(
      base({
        allocations: [row('a1', 'loc-a', 'A-01', 1), row('a2', 'loc-b', 'B-01', 2)],
        atSource: new Map([
          [atSourceKey('sku', 'loc-a'), 5],
          [atSourceKey('sku', 'loc-b'), 5],
        ]),
      }),
    );
    expect(plan.handBacks).toEqual([
      { allocationId: 'a2', shipmentLineId: 'line-1', skuId: 'sku', sourceLocationId: 'loc-b', qty: 2 },
      { allocationId: 'a1', shipmentLineId: 'line-1', skuId: 'sku', sourceLocationId: 'loc-a', qty: 1 },
    ]);
    expect([plan.cartSurplus, plan.excess, plan.shortages, plan.handIns]).toEqual([[], [], [], []]);
  });

  it('집은 몫은 반납하지 않고 «뺄 물건»으로 남긴다', () => {
    const plan = reconcileAllocation(
      base({ allocations: [row('a1', 'loc-a', 'A-01', 3, 2)], atSource: new Map([[atSourceKey('sku', 'loc-a'), 1]]) }),
    );
    expect(plan.handBacks.map((d) => d.qty)).toEqual([1]);
    expect(plan.excess.map((d) => d.qty)).toEqual([2]);
  });

  it('미귀속 몫이 AT_SOURCE 에 없으면(토탈피킹 카트에 실림) 카트 여분이다', () => {
    const plan = reconcileAllocation(
      base({ allocations: [row('a1', 'loc-a', 'A-01', 3)], atSource: new Map([[atSourceKey('sku', 'loc-a'), 1]]) }),
    );
    expect(plan.handBacks.map((d) => d.qty)).toEqual([1]);
    expect(plan.cartSurplus.map((d) => d.qty)).toEqual([2]);
    expect(plan.excess).toEqual([]);
  });

  it('같은 (SKU, 로케이션) 의 두 줄은 AT_SOURCE 를 나눠 쓴다 — 합쳐서 넘지 않는다', () => {
    const plan = reconcileAllocation(
      base({
        targets: [
          { shipmentLineId: 'line-1', skuId: 'sku', targetQty: 0 },
          { shipmentLineId: 'line-2', skuId: 'sku', targetQty: 0 },
        ],
        allocations: [row('a1', 'loc-a', 'A-01', 2, 0, 'line-1'), row('a2', 'loc-a', 'A-01', 2, 0, 'line-2')],
        atSource: new Map([[atSourceKey('sku', 'loc-a'), 3]]),
      }),
    );
    expect(plan.handBacks.reduce((t, d) => t + d.qty, 0)).toBe(3);
    expect(plan.cartSurplus.reduce((t, d) => t + d.qty, 0)).toBe(1);
  });

  it('입력을 바꾸지 않고, 입력 순서가 달라도 같은 결과다', () => {
    const allocations = [row('a1', 'loc-a', 'A-01', 1), row('a2', 'loc-b', 'B-01', 2)];
    const atSource = new Map([
      [atSourceKey('sku', 'loc-a'), 1],
      [atSourceKey('sku', 'loc-b'), 1],
    ]);
    const frozen = JSON.stringify({ allocations, atSource: [...atSource] });
    const a = reconcileAllocation(base({ allocations, atSource }));
    const b = reconcileAllocation(base({ allocations: [...allocations].reverse(), atSource }));
    expect(a).toEqual(b);
    expect(JSON.stringify({ allocations, atSource: [...atSource] })).toBe(frozen);
  });
});

/**
 * 전수 열거(스펙 §14): 목표 0~3 × 로케이션 둘(A·B)의 배정 0~2·귀속 0~배정 × 공유 AT_SOURCE 0~2 × 늘릴 가용 0~3.
 * 피킹 방식은 입력이 아니다 — 방식의 차이는 «AT_SOURCE 가 미귀속 몫을 덮는가»로만 드러난다(개별·바구니 피킹은
 * 늘 덮고, 토탈피킹은 카트에 실린 만큼 모자란다). AT_SOURCE 를 0~2 로 돌리면 세 방식이 모두 들어온다.
 */
describe('reconcileAllocation — 전수 열거로 불변식', () => {
  type Case = { input: ReconcileInput; plan: ReconcilePlan };
  const cases: Case[] = [];
  for (let target = 0; target <= 3; target += 1)
    for (let qa = 0; qa <= 2; qa += 1)
      for (let pa = 0; pa <= qa; pa += 1)
        for (let qb = 0; qb <= 2; qb += 1)
          for (let pb = 0; pb <= qb; pb += 1)
            for (let sa = 0; sa <= 2; sa += 1)
              for (let sb = 0; sb <= 2; sb += 1)
                for (let capC = 0; capC <= 3; capC += 1) {
                  const input = base({
                    targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: target }],
                    allocations: [row('a', 'loc-a', 'A-01', qa, pa), row('b', 'loc-b', 'B-01', qb, pb)],
                    atSource: new Map([
                      [atSourceKey('sku', 'loc-a'), sa],
                      [atSourceKey('sku', 'loc-b'), sb],
                    ]),
                    capacities: capC ? [cap('sku', 'loc-c', 'C-01', capC)] : [],
                  });
                  cases.push({ input, plan: reconcileAllocation(input) });
                }
  const sumOf = (rows: Array<{ qty: number }>) => rows.reduce((t, r) => t + r.qty, 0);
  const forRow = (rows: Array<{ allocationId: string; qty: number }>, id: string) =>
    sumOf(rows.filter((r) => r.allocationId === id));

  it('만든 사례가 충분하다', () => expect(cases.length).toBeGreaterThan(3000));

  it.each([
    ['출력 수량은 모두 양수', ({ plan }: Case) =>
      [...plan.handIns, ...plan.handBacks, ...plan.cartSurplus, ...plan.excess].every((e) => e.qty > 0)],
    ['반납 + 카트 여분 ≤ 그 행의 미귀속 몫', ({ input, plan }: Case) =>
      input.allocations.every(
        (r) => forRow(plan.handBacks, r.allocationId) + forRow(plan.cartSurplus, r.allocationId) <= r.qty - r.attributedQty,
      )],
    ['로케이션별 반납 합 ≤ 공유 AT_SOURCE', ({ input, plan }: Case) =>
      [...input.atSource].every(
        ([key, qty]) => sumOf(plan.handBacks.filter((d) => atSourceKey(d.skuId, d.sourceLocationId) === key)) <= qty,
      )],
    ['뺄 물건 ≤ 그 행의 귀속 보관', ({ input, plan }: Case) =>
      input.allocations.every((r) => forRow(plan.excess, r.allocationId) <= r.attributedQty)],
    ['적용 뒤 행마다 보관 ≤ 배정(I3)', ({ input, plan }: Case) =>
      input.allocations.every(
        (r) => r.qty - forRow(plan.handBacks, r.allocationId) - forRow(plan.cartSurplus, r.allocationId) >= r.attributedQty,
      )],
    ['모자람이 없으면 적용 뒤 배정 − 목표 = 뺄 물건(I2)', ({ input, plan }: Case) => {
      if (plan.shortages.length) return true;
      const after =
        sumOf(input.allocations) - sumOf(plan.handBacks) - sumOf(plan.cartSurplus) + sumOf(plan.handIns);
      return after - input.targets[0].targetQty === sumOf(plan.excess) && after >= input.targets[0].targetQty;
    }],
    ['모자라면 배정이 없고 0 < 모자란 양 ≤ 목표 − 현재 배정', ({ input, plan }: Case) => {
      if (!plan.shortages.length) return true;
      const short = sumOf(plan.shortages.map((s) => ({ qty: s.shortQty })));
      return plan.handIns.length === 0 && short > 0 && short <= input.targets[0].targetQty - sumOf(input.allocations);
    }],
    ['카트 여분은 그 로케이션 AT_SOURCE 를 다 쓴 뒤에만', ({ input, plan }: Case) =>
      plan.cartSurplus.every((d) => {
        const key = atSourceKey(d.skuId, d.sourceLocationId);
        return (input.atSource.get(key) ?? 0) - sumOf(plan.handBacks.filter((h) => atSourceKey(h.skuId, h.sourceLocationId) === key)) === 0;
      })],
    ['뺄 물건은 미귀속 몫을 다 줄인 뒤에만', ({ input, plan }: Case) =>
      !plan.excess.length ||
      input.allocations.every(
        (r) => forRow(plan.handBacks, r.allocationId) + forRow(plan.cartSurplus, r.allocationId) === r.qty - r.attributedQty,
      )],
    ['늘릴 때는 줄이지 않는다', ({ input, plan }: Case) =>
      input.targets[0].targetQty <= sumOf(input.allocations) ||
      (plan.handBacks.length === 0 && plan.cartSurplus.length === 0 && plan.excess.length === 0)],
  ])('%s', (_name, holds) => {
    const broken = cases.find((c) => !holds(c));
    expect(broken && { input: { ...broken.input, atSource: [...broken.input.atSource] }, plan: broken.plan }).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.spec.ts`
Expected: FAIL — `Cannot find module './reconcile-allocation'`

- [ ] **Step 3: 구현한다** — `reconcile-allocation.ts`:

```ts
import { AllocatableLine, AllocationDraft, allocateLines } from './allocate-lines';
import { LineShortage, SourceCapacity } from './allocation.types';

/** 목표 한 줄 — 이 작업 항목이 이 줄에 가져야 할 수량. 이탈이면 0. */
export interface ReconcileTarget {
  shipmentLineId: string;
  skuId: string;
  targetQty: number;
}

/** 이 작업 항목의 현재 배정 행 하나와 거기 귀속된 보관(집은 몫). */
export interface ReconcileAllocationRow {
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
  /** 이 줄·로케이션에 귀속된 보관(WORKER·TOTE·SORTING·PACKING·PACKED·RETURN_PENDING·SETTLED) 합. 0 ≤ 이것 ≤ qty(I3). */
  attributedQty: number;
}

export interface AllocationDecrement {
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
}

export interface ReconcilePlan {
  /** 늘릴 몫 — 일반 가용에서 새로 배정하고 인계(HAND_IN). */
  handIns: AllocationDraft[];
  /** 집지 않은 몫 — AT_SOURCE 에서 빼고 배정도 뺀다(HAND_BACK). */
  handBacks: AllocationDecrement[];
  /** 미귀속인데 AT_SOURCE 에 없다 = 토탈피킹 카트에 이미 실렸다. 배정에서 빼고 카트 여분이 된다(S1 §5.4, PR 3). */
  cartSurplus: AllocationDecrement[];
  /** 집은 몫이 목표를 넘는다 = «뺄 물건 남음»(I2). 배정은 그대로 두고 되돌림(PR 3)이 줄인다. */
  excess: AllocationDecrement[];
  /** 늘릴 몫을 못 채운 줄. 하나라도 있으면 handIns 는 비고, 호출자는 아무것도 적용하지 않는다. */
  shortages: LineShortage[];
}

export interface ReconcileInput {
  workItemId: string;
  targets: readonly ReconcileTarget[];
  allocations: readonly ReconcileAllocationRow[];
  /** 세션 공유 AT_SOURCE 잔량(키 `atSourceKey`). 배치의 모든 박스의 미집품 몫이 섞여 있다. */
  atSource: ReadonlyMap<string, number>;
  /** 늘릴 때만 쓴다 — 세션 통제분·적치 대기분을 뺀 로케이션별 일반 가용(`lockSkuCapacities`). */
  capacities: readonly SourceCapacity[];
  inboundPendingBySku?: ReadonlyMap<string, number>;
}

export const atSourceKey = (skuId: string, sourceLocationId: string): string => `${skuId}|${sourceLocationId}`;

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
/** 채울 때는 코드 순(E8) — 줄일 때는 그 반대로, 마지막에 채운 곳부터 비운다. */
const byCodeDescending = (left: ReconcileAllocationRow, right: ReconcileAllocationRow) =>
  compare(right.locationCode, left.locationCode) || compare(right.allocationId, left.allocationId);

function assertInput(input: ReconcileInput): void {
  const lineIds = new Set(input.targets.map((target) => target.shipmentLineId));
  for (const target of input.targets) {
    if (!Number.isSafeInteger(target.targetQty) || target.targetQty < 0) {
      throw new Error(`reconcileAllocation: invalid target for line ${target.shipmentLineId}`);
    }
  }
  for (const row of input.allocations) {
    if (!lineIds.has(row.shipmentLineId)) throw new Error(`reconcileAllocation: allocation ${row.allocationId} has no target`);
    if (!(row.qty >= 0 && row.attributedQty >= 0 && row.attributedQty <= row.qty)) {
      throw new Error(`reconcileAllocation: allocation ${row.allocationId} violates 0 ≤ attributed ≤ qty`);
    }
  }
}

/**
 * 배정 증감의 단일 규칙(스펙 §5 원칙, S1 §5.1). 합류·이탈·결품·내용 변경이 모두 목표만 바꿔 이 함수를 부르고,
 * 실행부(`BoxAllocationManager`)는 결과를 잠금 아래에서 적용만 한다.
 *
 * 줄마다(줄 id 순):
 * - 목표 > 배정: 모자란 만큼을 모아 마지막에 `allocateLines` 한 번으로 채운다(E8). 모자라면 shortages.
 * - 목표 < 배정: 줄일 양을 세 단계로 나눈다. 행 순서는 로케이션 코드 역순.
 *   1) 집지 않은 몫(배정 − 귀속) 중 공유 AT_SOURCE 에 남은 만큼 → 반납(HAND_BACK)
 *   2) 그래도 남은 집지 않은 몫 → 카트 여분(누구 몫인지 모를 카트 물량이 이미 가져갔다)
 *   3) 그래도 남으면 집은 몫 → 뺄 물건(배정 유지)
 */
export function reconcileAllocation(input: ReconcileInput): ReconcilePlan {
  assertInput(input);
  const atSource = new Map(input.atSource);
  const handBacks: AllocationDecrement[] = [];
  const cartSurplus: AllocationDecrement[] = [];
  const excess: AllocationDecrement[] = [];
  const deficits: AllocatableLine[] = [];
  const decrement = (row: ReconcileAllocationRow, qty: number): AllocationDecrement => ({
    allocationId: row.allocationId,
    shipmentLineId: row.shipmentLineId,
    skuId: row.skuId,
    sourceLocationId: row.sourceLocationId,
    qty,
  });

  for (const target of [...input.targets].sort((left, right) => compare(left.shipmentLineId, right.shipmentLineId))) {
    const rows = input.allocations.filter((row) => row.shipmentLineId === target.shipmentLineId).sort(byCodeDescending);
    const allocated = rows.reduce((total, row) => total + row.qty, 0);
    if (target.targetQty > allocated) {
      deficits.push({
        id: target.shipmentLineId,
        skuId: target.skuId,
        qty: target.targetQty - allocated,
        workItemId: input.workItemId,
      });
      continue;
    }
    let reduce = allocated - target.targetQty;
    const unpicked = new Map(rows.map((row) => [row.allocationId, row.qty - row.attributedQty]));
    for (const row of rows) {
      if (reduce === 0) break;
      const key = atSourceKey(row.skuId, row.sourceLocationId);
      const qty = Math.min(reduce, unpicked.get(row.allocationId) ?? 0, atSource.get(key) ?? 0);
      if (qty <= 0) continue;
      handBacks.push(decrement(row, qty));
      atSource.set(key, (atSource.get(key) ?? 0) - qty);
      unpicked.set(row.allocationId, (unpicked.get(row.allocationId) ?? 0) - qty);
      reduce -= qty;
    }
    for (const row of rows) {
      if (reduce === 0) break;
      const qty = Math.min(reduce, unpicked.get(row.allocationId) ?? 0);
      if (qty <= 0) continue;
      cartSurplus.push(decrement(row, qty));
      unpicked.set(row.allocationId, (unpicked.get(row.allocationId) ?? 0) - qty);
      reduce -= qty;
    }
    for (const row of rows) {
      if (reduce === 0) break;
      const qty = Math.min(reduce, row.attributedQty);
      if (qty <= 0) continue;
      excess.push(decrement(row, qty));
      reduce -= qty;
    }
    // 세 단계의 합은 배정 합 = 줄일 양의 상한이라 여기 올 수 없다.
    if (reduce !== 0) throw new Error(`reconcileAllocation: could not account for line ${target.shipmentLineId}`);
  }

  const { drafts, shortages } = deficits.length
    ? allocateLines(deficits, input.capacities, input.inboundPendingBySku)
    : { drafts: [], shortages: [] };
  return { handIns: shortages.length ? [] : drafts, handBacks, cartSurplus, excess, shortages };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.spec.ts apps/core/src/modules/fulfillment/picking/allocation/allocate-lines.spec.ts`
Expected: PASS(전수 열거 사례 5,000 개 안팎)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.ts apps/core/src/modules/fulfillment/picking/allocation/reconcile-allocation.spec.ts
git commit -m "feat(fulfillment): reconcileAllocation — 목표·배정·보관으로 인계·반납·카트 여분·뺄 물건을 정한다 (#988)"
```

---

### Task 2: 스키마 — 배정 `qty >= 0`, 세션 `handed_back_qty`

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`pickingSourceAllocations`, `batchInventorySessions`)
- Create: `apps/core/drizzle/<timestamp>_allocation-hand-back.sql` + `apps/core/drizzle/meta/*` (생성물)
- Test: `apps/core/src/modules/fulfillment/picking/allocation/allocation-hand-back.constraints.integration.spec.ts`

**Interfaces:**
- Produces: `wmsTables.batchInventorySessions.handedBackQty`(int, NOT NULL, 기본 0). 배정 행 `qty` 는 0 을 허용한다(행은 지우지 않는다 — 스펙 §11).

- [ ] **Step 1: 실패하는 제약 테스트를 쓴다** — `allocation-hand-back.constraints.integration.spec.ts`:

```ts
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../services/__support__';
import { seedPickableShipment } from '../../services/__support__/logistics-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('배정 반납 스키마 (PR 2)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('배정 행은 0 을 허용하고 음수는 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 2);
      const values = {
        workItemId: f.workItemId,
        shipmentLineId: f.shipmentLineId,
        sourceLocationId: f.locationId,
        sourceStockVersion: 1,
      };
      await expect(tx.insert(wmsTables.pickingSourceAllocations).values({ ...values, qty: 0 })).resolves.toBeDefined();
      await expect(
        tx.transaction((trx) =>
          trx
            .update(wmsTables.pickingSourceAllocations)
            .set({ qty: -1 })
            .where(eq(wmsTables.pickingSourceAllocations.workItemId, f.workItemId)),
        ),
      ).rejects.toThrow(/ck_picking_source_allocations_qty_nonnegative/);
    });
  });

  it('세션은 handed_back_qty 를 보존식에 넣는다 — 정산+반환+부족+반납 ≤ 인계', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 2);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batchId, handedInQty: 3, handedBackQty: 2, settledQty: 1 })
        .returning();
      expect(session.handedBackQty).toBe(2);
      await expect(
        tx.transaction((trx) =>
          trx
            .update(wmsTables.batchInventorySessions)
            .set({ handedBackQty: 3 })
            .where(eq(wmsTables.batchInventorySessions.id, session.id)),
        ),
      ).rejects.toThrow(/ck_batch_inventory_sessions_settlement/);
      await expect(
        tx.transaction((trx) =>
          trx
            .update(wmsTables.batchInventorySessions)
            .set({ handedBackQty: -1 })
            .where(eq(wmsTables.batchInventorySessions.id, session.id)),
        ),
      ).rejects.toThrow(/ck_batch_inventory_sessions_quantities/);
    });
  });
});
```

- [ ] **Step 2: 스키마를 고친다** — `inventory.schema.ts`:
  - `pickingSourceAllocations` 의 `ckPickingAllocationQty: check('ck_picking_source_allocations_qty_positive', sql\`${t.qty} > 0\`)` 를 `ckPickingAllocationQty: check('ck_picking_source_allocations_qty_nonnegative', sql\`${t.qty} >= 0\`)` 로 바꾸고 바로 위에 주석 `// 반납·이탈로 0 이 된 행은 지우지 않는다 — 이력은 세션 이벤트가, 신원은 이 행이 들고 있다(스펙 §11).`
  - `batchInventorySessions` 에 `handedInQty` 바로 아래 `handedBackQty: integer('handed_back_qty').notNull().default(0),` 을 넣고 두 CHECK 를 바꾼다:

```ts
    ckBatchInventorySessionQuantities: check(
      'ck_batch_inventory_sessions_quantities',
      sql`${t.handedInQty} >= 0 AND ${t.handedBackQty} >= 0 AND ${t.settledQty} >= 0 AND ${t.returnedQty} >= 0 AND ${t.shortageQty} >= 0`,
    ),
    ckBatchInventorySessionSettlement: check(
      'ck_batch_inventory_sessions_settlement',
      sql`${t.settledQty} + ${t.returnedQty} + ${t.shortageQty} + ${t.handedBackQty} <= ${t.handedInQty}`,
    ),
```

- [ ] **Step 3: 마이그레이션을 만든다**

Run: `npm run db:generate:core -- --name allocation-hand-back`
Expected: `apps/core/drizzle/<timestamp>_allocation-hand-back.sql` 하나. 내용이 아래 여섯 가지뿐인지 **눈으로** 확인한다(순서는 달라도 된다): `DROP CONSTRAINT "ck_picking_source_allocations_qty_positive"`, `ADD CONSTRAINT "ck_picking_source_allocations_qty_nonnegative" CHECK (... >= 0)`, `ADD COLUMN "handed_back_qty" integer DEFAULT 0 NOT NULL`, 두 세션 CHECK 의 DROP/ADD. 다른 테이블이 섞이면 `git rm` 하고 원인(다른 브랜치 스키마)을 먼저 푼다. `drizzle-kit` 이 대화형 질문을 내면(이름 바뀜 추정) «create» 를 고른다. 서브에이전트가 대화형 프롬프트를 못 넘기면 멈추고 컨트롤러에게 넘긴다(메모: 서브에이전트는 `db:generate` 를 못 돌린 적이 있다).

- [ ] **Step 4: 적용하고 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- allocation-hand-back.constraints`
Expected: PASS 2

- [ ] **Step 5: 커밋** — schema·SQL·meta 를 **한 커밋**에(CLAUDE.md).

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/fulfillment/picking/allocation/allocation-hand-back.constraints.integration.spec.ts
git commit -m "feat(fulfillment): 배정 행은 0 을 허용하고 세션은 반납 수량을 보존식에 넣는다 (#988)"
```

---

### Task 3: 세션 — 실행 중 인계(`handIn`)와 반납(`handBack`)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts`
- Modify: `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts` (`inventorySession` 타입에 `handedBackQty: number`)
- Test: `apps/core/src/modules/fulfillment/services/batch-inventory-session.integration.spec.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: `SessionStartAllocation`(`allocation.types.ts`)
- Produces:
  - `export type BatchInventorySessionRow = typeof wmsTables.batchInventorySessions.$inferSelect`
  - `handIn(input: { sessionId: string; batchId: string; actorId: string; operationId: string; allocations: SessionStartAllocation[] }, tx: DbTx): Promise<BatchInventorySessionRow>`
  - `export interface HandBackInput { sessionId; operationId; actorId; workItemId; allocationId; shipmentLineId; skuId; sourceLocationId; quantity: number }`
  - `handBack(input: HandBackInput, tx: DbTx)` — `mutate` 결과(`{ session, event, replayed }`)
  - 이벤트 타입 `HAND_BACK`: from `AT_SOURCE`(ref·줄 없음), to 없음. 세션 헤더 `handedBackQty` 증가
  - 보존식: `인계 = 남은 보관 + 정산 + 반환 + 부족 + 반납`

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `batch-inventory-session.integration.spec.ts` 끝에 새 `describe` 를 더한다(파일 머리의 `describeIfDb`·`makeDb`·`inRollbackTx` 를 그대로 쓴다. 없으면 `batch-start.integration.spec.ts` 머리처럼 선언한다):

```ts
import { seedBoxOverSameStock, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

describeIfDb('세션 — 실행 중 인계와 반납 (PR 2)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function startedTwoBoxes(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const started = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId));
    return { first, second, wiring, sessionId: started.sessionId, allocation };
  }

  const atSource = async (tx: DbTx, sessionId: string) =>
    (
      await tx
        .select({ qty: wmsTables.batchInventorySessionBalances.qty })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        )
    ).reduce((total, row) => total + row.qty, 0);

  it('handBack 은 AT_SOURCE 를 줄이고 HAND_BACK 이벤트에 신원을 싣고 헤더 반납 수량을 올린다 — 같은 명령이면 한 번', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId, allocation } = await startedTwoBoxes(tx);
      const input = {
        sessionId,
        operationId: randomUUID(),
        actorId: second.actorId,
        workItemId: second.workItemId,
        allocationId: allocation.id,
        shipmentLineId: second.shipmentLineId,
        skuId: second.skuId,
        sourceLocationId: second.locationId,
        quantity: 1,
      };
      const before = await atSource(tx, sessionId);
      const first = await wiring.sessions.handBack(input, tx);
      const replay = await wiring.sessions.handBack(input, tx);

      expect(first.replayed).toBe(false);
      expect(replay.replayed).toBe(true);
      expect(await atSource(tx, sessionId)).toBe(before - 1);
      expect(first.event.eventType).toBe('HAND_BACK');
      expect(first.event.idempotencyKey).toBe(`hand-back:${input.operationId}:${allocation.id}`);
      expect(first.event.payload).toMatchObject({
        operationId: input.operationId,
        workItemId: second.workItemId,
        allocationId: allocation.id,
        shipmentLineId: second.shipmentLineId,
      });
      expect(first.session.handedBackQty).toBe(1);
      expect(first.session.handedInQty).toBe(3);
    });
  });

  it('handIn 은 실행 중 세션에 이어서 인계한다 — 순번이 이어지고 인계 수량·AT_SOURCE 가 는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, sessionId } = await startedTwoBoxes(tx);
      const third = await seedBoxOverSameStock(tx, first, 2);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ batchId: first.batchId })
        .where(eq(wmsTables.outboundBatchWorkItems.id, third.workItemId));
      const [row] = await tx
        .insert(wmsTables.pickingSourceAllocations)
        .values({
          workItemId: third.workItemId,
          shipmentLineId: third.shipmentLineId,
          sourceLocationId: third.locationId,
          qty: 2,
          sourceStockVersion: 1,
        })
        .returning();
      const [before] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      const operationId = randomUUID();

      const after = await wiring.sessions.handIn(
        {
          sessionId,
          batchId: first.batchId,
          actorId: first.actorId,
          operationId,
          allocations: [
            {
              id: row.id,
              workItemId: third.workItemId,
              shipmentLineId: third.shipmentLineId,
              skuId: third.skuId,
              sourceLocationId: third.locationId,
              quantity: 2,
              sourceStockVersion: 1,
            },
          ],
        },
        tx,
      );

      expect(after.handedInQty).toBe(before.handedInQty + 2);
      expect(after.version).toBe(before.version + 1);
      expect(await atSource(tx, sessionId)).toBe(5);
      const [event] = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.idempotencyKey, `hand-in:${operationId}:${row.id}`));
      expect(event.payload).toMatchObject({ sequence: before.version, workItemId: third.workItemId, allocationId: row.id });
    });
  });

  it('active 가 아닌 세션에는 인계하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, sessionId, allocation } = await startedTwoBoxes(tx);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await expect(
        wiring.sessions.handIn(
          {
            sessionId,
            batchId: first.batchId,
            actorId: first.actorId,
            operationId: randomUUID(),
            allocations: [
              {
                id: allocation.id,
                workItemId: allocation.workItemId!,
                shipmentLineId: allocation.shipmentLineId,
                skuId: first.skuId,
                sourceLocationId: allocation.sourceLocationId,
                quantity: 1,
                sourceStockVersion: 1,
              },
            ],
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SESSION_NOT_MUTABLE' } });
    });
  });
});
```

(`randomUUID`·`and`·`eq`·`DbTx`·`wmsTables` import 는 파일 머리에 없으면 더한다. `wiring.sessions` 는 `assembleOutbound` 가 이미 돌려준다.)

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-inventory-session.integration`
Expected: FAIL — `handBack is not a function` / `handIn is not a function`

- [ ] **Step 3: 구현한다** — `batch-inventory-session.service.ts`:

  (a) 타입: `type SessionRow = …` 아래에 `export type BatchInventorySessionRow = SessionRow;`. 파일 안의 이벤트 타입 유니온 두 곳(`mutate` 의 `input.eventType`, `assertShortageAllocation` 의 인자 타입)을 한 별칭으로 바꾼다:

```ts
type MutationEventType = 'MOVE_CUSTODY' | 'RETURN_TO_SOURCE' | 'SETTLE_FOR_DISPATCH' | 'APPROVE_SHORTAGE' | 'HAND_BACK';
```

  (b) 입력 타입(파일 위 `ReturnShortPickCustodyInput` 뒤):

```ts
/** 집지 않은 몫 반납(HAND_BACK) — AT_SOURCE 에서 빼고 세션 통제를 푼다. 배정 행 감소는 호출자(BoxAllocationManager)의 몫. */
export interface HandBackInput {
  sessionId: string;
  operationId: string;
  actorId: string;
  workItemId: string;
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
}
```

  (c) `startSession` 의 인계 루프를 private 헬퍼로 뽑고, `startSession` 은 세션 행을 만든 뒤 그 헬퍼를 부른다(키는 기존 `start:<batchId>:<allocationId>` 그대로):

```ts
  /**
   * 인계 이벤트·AT_SOURCE 를 쓰고 헤더를 한 번에 올린다(배치 시작·합류 공용). 호출자가 세션 행을 잠갔다.
   * 순번은 세션 version 에서 이어진다 — 복구가 이 순번만 믿는다(batch-session-recovery.service.ts).
   */
  private async appendHandIns(
    tx: DbTx,
    session: SessionRow,
    batchId: string,
    allocations: SessionStartAllocation[],
    idempotencyKeyOf: (allocation: SessionStartAllocation) => string,
  ): Promise<SessionRow> {
    let sequence = session.version;
    const ordered = [...allocations].sort(
      (left, right) =>
        left.sourceLocationId.localeCompare(right.sourceLocationId) ||
        left.shipmentLineId.localeCompare(right.shipmentLineId) ||
        left.id.localeCompare(right.id),
    );
    for (const allocation of ordered) {
      // (기존 startSession 루프 본문 그대로 — idempotencyKey 만 idempotencyKeyOf(allocation), batchId 는 인자)
      sequence += 1;
    }
    const handedInQty = session.handedInQty + ordered.reduce((total, allocation) => total + allocation.quantity, 0);
    const [updated] = await tx
      .update(wmsTables.batchInventorySessions)
      .set({ handedInQty, version: sequence, updatedAt: sql`now()` })
      .where(
        and(
          eq(wmsTables.batchInventorySessions.id, session.id),
          eq(wmsTables.batchInventorySessions.version, session.version),
        ),
      )
      .returning();
    if (!updated) throw this.conflict('SESSION_STALE_VERSION', `Session ${session.id} changed while handing in`);
    await this.assertConservation(updated, tx);
    return updated;
  }
```

  `startSession` 끝부분은 `const started = await this.appendHandIns(tx, session, input.batchId, input.allocations, (a) => \`start:${input.batchId}:${a.id}\`);` 뒤에 기존 감사 로그(`handedInQty: started.handedInQty`, `allocationIds`)를 남긴다.

  (d) 공개 메서드 둘:

```ts
  /**
   * 실행 중 세션에 인계를 더한다(합류, PR 4 의 결품 재배정). 호출자가 이미 «작업 항목 → 세션 → 보관» 순으로 잠갔다.
   * 키는 `hand-in:<명령 id>:<배정 id>` — 같은 배정에 두 번째 인계가 와도 명령이 다르면 다른 키다(스펙 §13).
   */
  async handIn(
    input: { sessionId: string; batchId: string; actorId: string; operationId: string; allocations: SessionStartAllocation[] },
    tx: DbTx,
  ): Promise<SessionRow> {
    if (!tx) throw new Error('handIn requires the caller transaction');
    if (input.allocations.length === 0) {
      throw this.conflict('SESSION_HAND_IN_EMPTY', `Nothing to hand in to session ${input.sessionId}`);
    }
    const session = await this.lockSession(input.sessionId, tx);
    if (session.batchId !== input.batchId) {
      throw this.conflict('SESSION_BATCH_MISMATCH', `Session ${input.sessionId} does not belong to batch ${input.batchId}`);
    }
    if (session.status !== 'active') {
      throw this.conflict('SESSION_NOT_MUTABLE', `Batch inventory session ${input.sessionId} is ${session.status}`);
    }
    const updated = await this.appendHandIns(
      tx,
      session,
      input.batchId,
      input.allocations,
      (allocation) => `hand-in:${input.operationId}:${allocation.id}`,
    );
    await this.audit.logUserActionRequired(
      'batch_inventory_session.hand_in',
      'fulfillment',
      `Handed in ${updated.handedInQty - session.handedInQty} to session ${session.id}`,
      { userId: input.actorId },
      { batchId: input.batchId, operationId: input.operationId, allocationIds: input.allocations.map((a) => a.id) },
      tx,
    );
    return updated;
  }

  /** 집지 않은 몫 반납. 멱등 키 `hand-back:<명령 id>:<배정 id>`. */
  async handBack(input: HandBackInput, tx: DbTx) {
    if (!tx) throw new Error('handBack requires the caller transaction');
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: `hand-back:${input.operationId}:${input.allocationId}`,
        eventType: 'HAND_BACK',
        actorId: input.actorId,
        skuId: input.skuId,
        quantity: input.quantity,
        from: { custodyType: 'AT_SOURCE', custodyRef: null, sourceLocationId: input.sourceLocationId, shipmentLineId: null },
        to: null,
        context: {
          operationId: input.operationId,
          workItemId: input.workItemId,
          allocationId: input.allocationId,
          shipmentLineId: input.shipmentLineId,
        },
      },
      tx,
    );
  }
```

  (e) `mutate` 의 세션 헤더 갱신에 한 줄: `handedBackQty: input.eventType === 'HAND_BACK' ? session.handedBackQty + input.quantity : session.handedBackQty,`
  (f) `assertConservation` 의 `accounted` 에 `+ session.handedBackQty`.
  (g) `dto/outbound-batch-v2.dto.ts` 의 `inventorySession` 타입 `handedInQty: number;` 아래에 `handedBackQty: number;`.

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "batch-inventory-session|batch-start.integration"` 그리고 `npx jest apps/core/src/modules/fulfillment/services/batch-inventory-session.service.spec.ts`
Expected: PASS(기존 시작 테스트 포함 — 시작의 키·payload·순번은 그대로다)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/batch-inventory-session.service.ts apps/core/src/modules/fulfillment/services/batch-inventory-session.integration.spec.ts apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts
git commit -m "feat(fulfillment): 세션이 실행 중 인계(handIn)와 집기 전 반납(HAND_BACK)을 받는다 (#988)"
```

---

### Task 4: 세션 복구 — `HAND_BACK` 재생과 «배정마다 인계 − 반납 = 배정»

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/batch-session-recovery.hand-back.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 3 의 `handBack`·`handIn`, 이벤트 payload(`operationId`·`workItemId`·`allocationId`·`shipmentLineId`)
- Produces: `reconcile(sessionId, tx)` 가 반납이 섞인 세션을 `healthy` 로 판정하고, 배정 행과 이벤트 합이 어긋나면 `allocation <id> quantity … differs from hand-in … − hand-back …` 문제로 잡는다

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — 새 파일:

```ts
import { randomUUID } from 'crypto';
import { eq, sql as rawSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('세션 복구 — 반납이 섞인 세션 (PR 2)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 두 번째 박스 배정 전량을 반납한다. withAllocationUpdate=false 면 배정 행을 그대로 둔다(드리프트). */
  async function handBackSecond(tx: DbTx, withAllocationUpdate: boolean) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const started = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId));
    await wiring.sessions.handBack(
      {
        sessionId: started.sessionId,
        operationId: randomUUID(),
        actorId: second.actorId,
        workItemId: second.workItemId,
        allocationId: allocation.id,
        shipmentLineId: second.shipmentLineId,
        skuId: second.skuId,
        sourceLocationId: second.locationId,
        quantity: allocation.qty,
      },
      tx,
    );
    if (withAllocationUpdate) {
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, allocation.id));
    }
    return { wiring, sessionId: started.sessionId, allocation };
  }

  it('반납과 배정 감소가 함께 있으면 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await handBackSecond(tx, true);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true, issues: [] });
    });
  });

  it('반납은 했는데 배정 행이 그대로면 배정별 합 불일치로 잡는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId, allocation } = await handBackSecond(tx, false);
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.healthy).toBe(false);
      expect(result.issues.join('\n')).toContain(`allocation ${allocation.id} quantity`);
    });
  });

  it('HAND_BACK payload 의 배정 신원이 틀리면 잡는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { wiring, sessionId } = await handBackSecond(tx, true);
      await tx.execute(
        rawSql`UPDATE batch_inventory_session_events
                  SET payload = jsonb_set(payload, '{allocationId}', to_jsonb(${randomUUID()}::text))
                WHERE session_id = ${sessionId}::uuid AND event_type = 'HAND_BACK'`,
      );
      const result = await wiring.recovery.reconcile(sessionId, tx);
      expect(result.issues.join('\n')).toMatch(/HAND_BACK event .* allocation attribution/);
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-session-recovery.hand-back`
Expected: FAIL — 첫 테스트가 `event … has unsupported type HAND_BACK`·`event stream violates session quantity conservation` 로 unhealthy

- [ ] **Step 3: 구현한다** — `batch-session-recovery.service.ts`:

  (a) `ReplayResult` 에 `handedBackQty: number;`. `replay()` 에 `let handedBackQty = 0;` 과 분기:

```ts
      } else if (event.eventType === 'HAND_BACK') {
        if (!from || to || from.custodyType !== 'AT_SOURCE') issues.push(`HAND_BACK event ${event.id} has invalid sides`);
        if (typeof payload.workItemId !== 'string' || typeof payload.allocationId !== 'string') {
          issues.push(`HAND_BACK event ${event.id} has no immutable work item/allocation identity`);
        }
        handedBackQty += event.quantity;
      } else if (event.eventType === 'MOVE_CUSTODY') {
```

  보존식 줄을 `if (handedInQty !== remainingQty + settledQty + returnedQty + shortageQty + handedBackQty)` 로, 반환 객체에 `handedBackQty`.

  (b) `compare()` 헤더 비교에 `session.handedBackQty !== replay.handedBackQty ||`.

  (c) `validatePersistedAllocations()`:
  - HAND_IN 분기에서 `seenAllocationIds` 중복 거절과 `event.quantity !== allocation.quantity` 비교를 **지운다**(배정마다 합으로 본다 — 아래). `seenAllocationIds` 변수도 지운다. 해시는 이벤트 수량으로:

```ts
        expectedHash = handInRequestHash(session.batchId, {
          id: allocation.id,
          // Non-null: the query inner-joins work items on workItemId.
          workItemId: allocation.workItemId!,
          shipmentLineId: allocation.shipmentLineId,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          // 인계 요청의 수량은 이벤트 수량이다 — 배정 행은 반납으로 그 뒤 줄 수 있다(스펙 §13).
          quantity: event.quantity,
          sourceStockVersion: allocation.sourceStockVersion,
        });
```

  - `else` 분기 안, `SETTLE_FOR_DISPATCH` 판정 **앞**에 HAND_BACK 판정:

```ts
        if (event.eventType === 'HAND_BACK') {
          const exactContext = {
            operationId: payload.operationId,
            workItemId: payload.workItemId,
            allocationId: payload.allocationId,
            shipmentLineId: payload.shipmentLineId,
          };
          if (canonicalBatchSessionRequestHash(persistedContext) !== canonicalBatchSessionRequestHash(exactContext)) {
            issues.push(`HAND_BACK event ${event.id} context is not exact`);
          }
          canonicalRequest.context = exactContext;
          const allocation =
            typeof payload.allocationId === 'string' ? allocationById.get(payload.allocationId) : undefined;
          if (
            typeof payload.operationId !== 'string' ||
            !allocation ||
            allocation.workItemId !== payload.workItemId ||
            allocation.shipmentLineId !== payload.shipmentLineId ||
            allocation.skuId !== event.skuId ||
            !from ||
            from.sourceLocationId !== allocation.sourceLocationId
          ) {
            issues.push(`HAND_BACK event ${event.id} has invalid allocation attribution`);
          }
        } else if (event.eventType === 'SETTLE_FOR_DISPATCH') {
```

  (기존 `if (event.eventType === 'SETTLE_FOR_DISPATCH') {` 를 `} else if` 사슬의 둘째로 바꾼다.)

  - 루프 뒤의 `if (startEvents.length !== allocations.length || seenAllocationIds.size !== allocations.length)` 를 배정별 합 규칙으로 바꾼다(`startEvents` 변수는 지운다):

```ts
    const movedByAllocation = (eventType: 'HAND_IN' | 'HAND_BACK', allocationId: string) =>
      events
        .filter((event) => event.eventType === eventType && payloadOf(event.payload).allocationId === allocationId)
        .reduce((total, event) => total + event.quantity, 0);
    for (const allocation of allocations) {
      const handedIn = movedByAllocation('HAND_IN', allocation.id);
      const handedBack = movedByAllocation('HAND_BACK', allocation.id);
      if (handedIn === 0) issues.push(`allocation ${allocation.id} has no HAND_IN event`);
      if (handedIn - handedBack !== allocation.quantity) {
        issues.push(
          `allocation ${allocation.id} quantity ${allocation.quantity} differs from hand-in ${handedIn} − hand-back ${handedBack}`,
        );
      }
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "batch-session-recovery|batch-start.integration|outbound-v2-recovery"`
Expected: PASS(기존 «HAND_IN payload 의 workItemId/batchId 가 다르면 잡는다» 포함)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/batch-session-recovery.service.ts apps/core/src/modules/fulfillment/services/batch-session-recovery.hand-back.integration.spec.ts
git commit -m "feat(fulfillment): 세션 복구가 HAND_BACK 을 재생하고 배정마다 인계 − 반납 = 배정을 본다 (#988)"
```

---

### Task 5: 불변식 검사기 — I1·I2·I3, 보존식에 반납

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.ts` (보존식 SQL 두 곳)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/logistics-assertions.ts`
- Test: `apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`, `fulfillment-reconciliation.service.spec.ts`(개수 표가 리터럴이면 새 kind 0 을 더한다)

**Interfaces:**
- Produces:
  - `FULFILLMENT_INVARIANT_KINDS` 에 `'ALLOCATION_BEFORE_START'`(I1), `'ALLOCATION_BELOW_TARGET'`(I2), `'CUSTODY_EXCEEDS_ALLOCATION'`(I3)
  - `FulfillmentInvariantSnapshot` 에 `batches: Array<{ id: string; startedAt: Date | null }>`, `workItems: Array<{ id; batchId; shipmentId; status }>`, `allocations: Array<{ id; workItemId; batchId; shipmentLineId; skuId; sourceLocationId; qty }>`; `sessions[]` 에 `batchId`·`handedBackQty`; `sessionBalances[]` 에 `skuId`·`sourceLocationId: string | null`·`shipmentLineId: string | null`
  - 테스트 지원 `assertFulfillmentInvariantsFor(tx: DbTx, shipmentIds: string[]): Promise<void>`

- [ ] **Step 1: 실패하는 단위 테스트를 쓴다** — `fulfillment-invariant.service.spec.ts`:
  - `validSnapshot()` 을 새 모양으로 채운다(기존 판정은 그대로 통과해야 한다):

```ts
  sessions: [{ id: 'session-1', batchId: 'batch-1', handedInQty: 7, handedBackQty: 0, settledQty: 2, returnedQty: 1, shortageQty: 1 }],
  sessionBalances: [
    { id: 'balance-1', sessionId: 'session-1', custodyType: 'PACKING', qty: 3, skuId: 'sku-1', sourceLocationId: 'loc-1', shipmentLineId: 'line-1' },
  ],
  batches: [{ id: 'batch-1', startedAt: new Date('2026-09-30T00:00:00Z') }],
  workItems: [{ id: 'wi-1', batchId: 'batch-1', shipmentId: 'shipment-1', status: 'completed' }],
  allocations: [
    { id: 'alloc-1', workItemId: 'wi-1', batchId: 'batch-1', shipmentLineId: 'line-1', skuId: 'sku-1', sourceLocationId: 'loc-1', qty: 7 },
  ],
```

  - 새 `describe`:

```ts
describe('배정 불변식 I1~I3 (스펙 §5)', () => {
  const kinds = (snapshot: FulfillmentInvariantSnapshot) =>
    collectFulfillmentInvariantViolations(snapshot).map((violation) => violation.kind);

  it('I1 — 시작 안 된 배치의 작업 항목에 배정이 있으면 위반', () => {
    const snapshot = validSnapshot();
    snapshot.batches[0].startedAt = null;
    snapshot.workItems[0].status = 'queued';
    expect(kinds(snapshot)).toContain('ALLOCATION_BEFORE_START');
  });

  it('I2 — 시작된 배치의 활성 작업 항목은 줄마다 배정 ≥ 줄 수량', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'picking';
    snapshot.allocations[0].qty = 6;
    expect(kinds(snapshot)).toContain('ALLOCATION_BELOW_TARGET');
    snapshot.allocations[0].qty = 9; // 초과(«뺄 물건 남음»)는 위반이 아니다
    expect(kinds(snapshot)).not.toContain('ALLOCATION_BELOW_TARGET');
  });

  it('I2 — 완료·제외된 작업 항목은 보지 않는다(반납으로 0 이 된 행 포함)', () => {
    const snapshot = validSnapshot();
    snapshot.workItems[0].status = 'excluded';
    snapshot.allocations[0].qty = 0;
    snapshot.sessionBalances = [];
    expect(kinds(snapshot)).not.toContain('ALLOCATION_BELOW_TARGET');
  });

  it('I3 — 줄 귀속 보관이 그 줄·로케이션 배정을 넘으면 위반', () => {
    const snapshot = validSnapshot();
    snapshot.sessionBalances[0].qty = 8;
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('I3 — 공유 보관(AT_SOURCE·BULK_CART)이 (배정 − 귀속 보관) 합을 넘으면 위반', () => {
    const snapshot = validSnapshot();
    snapshot.sessionBalances.push({
      id: 'balance-2',
      sessionId: 'session-1',
      custodyType: 'AT_SOURCE',
      qty: 5,
      skuId: 'sku-1',
      sourceLocationId: 'loc-1',
      shipmentLineId: null,
    });
    // 배정 7 − 귀속 3 = 4 < 5
    expect(kinds(snapshot)).toContain('CUSTODY_EXCEEDS_ALLOCATION');
  });

  it('보존식은 반납을 센다', () => {
    const snapshot = validSnapshot();
    snapshot.sessions[0].handedInQty = 9;
    snapshot.sessions[0].handedBackQty = 2;
    expect(kinds(snapshot)).not.toContain('SESSION_CONSERVATION');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts`
Expected: FAIL — 타입 에러(스냅샷 모양) 또는 새 kind 미검출

- [ ] **Step 3: 구현한다** — `fulfillment-invariant.service.ts`:

  (a) kind 셋을 `FULFILLMENT_INVARIANT_KINDS` 끝에 더하고, 스냅샷 타입을 위 Interfaces 대로 넓힌다.
  (b) `collectFulfillmentInvariantViolations` 의 `SESSION_CONSERVATION` 계산을 `remainingQty + session.settledQty + session.returnedQty + session.shortageQty + session.handedBackQty` 로, 메시지에 `handedBack=${session.handedBackQty}` 를 더한다.
  (c) 같은 함수에서 `SESSION_CONSERVATION` 루프 뒤에:

```ts
  // 스펙 §5 — I1(시작 전 배정 0)·I2(시작된 배치의 활성 작업 항목은 배정 ≥ 목표)·I3(보관 ≤ 배정).
  // I4 는 넣지 않는다: 데이터 상태가 아니라 «그릴 수 있는가»의 규칙이고 송장 조립(assertLabelAllocated)이 강제한다.
  const batchById = new Map(snapshot.batches.map((batch) => [batch.id, batch]));
  for (const item of snapshot.workItems) {
    const itemAllocations = snapshot.allocations.filter((allocation) => allocation.workItemId === item.id);
    if (!batchById.get(item.batchId)?.startedAt) {
      const allocatedQty = sum(itemAllocations, (allocation) => allocation.qty);
      if (allocatedQty > 0) {
        violations.push({
          kind: 'ALLOCATION_BEFORE_START',
          resourceId: item.id,
          message: `batch=${item.batchId}, allocated=${allocatedQty}`,
        });
      }
      continue;
    }
    if (item.status === 'completed' || item.status === 'excluded') continue;
    for (const line of snapshot.shipmentLines.filter((candidate) => candidate.shipmentId === item.shipmentId)) {
      const allocatedQty = sum(
        itemAllocations.filter((allocation) => allocation.shipmentLineId === line.id),
        (allocation) => allocation.qty,
      );
      if (allocatedQty < line.qty) {
        violations.push({
          kind: 'ALLOCATION_BELOW_TARGET',
          resourceId: item.id,
          message: `line=${line.id}, lineQty=${line.qty}, allocated=${allocatedQty}`,
        });
      }
    }
  }
  for (const session of snapshot.sessions) {
    const batchAllocations = snapshot.allocations.filter((allocation) => allocation.batchId === session.batchId);
    const balances = snapshot.sessionBalances.filter((balance) => balance.sessionId === session.id && balance.qty > 0);
    const attributedByLine = new Map<string, number>();
    const attributedBySku = new Map<string, number>();
    const sharedBySku = new Map<string, number>();
    for (const balance of balances) {
      if (!balance.sourceLocationId) continue;
      const skuKey = `${balance.skuId}|${balance.sourceLocationId}`;
      if (balance.shipmentLineId && LINE_ATTRIBUTED_CUSTODY.has(balance.custodyType)) {
        const lineKey = `${balance.shipmentLineId}|${balance.sourceLocationId}`;
        attributedByLine.set(lineKey, (attributedByLine.get(lineKey) ?? 0) + balance.qty);
        attributedBySku.set(skuKey, (attributedBySku.get(skuKey) ?? 0) + balance.qty);
      } else if (SHARED_CUSTODY.has(balance.custodyType)) {
        sharedBySku.set(skuKey, (sharedBySku.get(skuKey) ?? 0) + balance.qty);
      }
    }
    for (const [lineKey, custodyQty] of attributedByLine) {
      const allocatedQty = sum(
        batchAllocations.filter((allocation) => `${allocation.shipmentLineId}|${allocation.sourceLocationId}` === lineKey),
        (allocation) => allocation.qty,
      );
      if (custodyQty > allocatedQty) {
        violations.push({
          kind: 'CUSTODY_EXCEEDS_ALLOCATION',
          resourceId: session.id,
          message: `line|location=${lineKey}, custody=${custodyQty}, allocated=${allocatedQty}`,
        });
      }
    }
    for (const [skuKey, sharedQty] of sharedBySku) {
      const allocatedQty = sum(
        batchAllocations.filter((allocation) => `${allocation.skuId}|${allocation.sourceLocationId}` === skuKey),
        (allocation) => allocation.qty,
      );
      const roomQty = allocatedQty - (attributedBySku.get(skuKey) ?? 0);
      if (sharedQty > roomQty) {
        violations.push({
          kind: 'CUSTODY_EXCEEDS_ALLOCATION',
          resourceId: session.id,
          message: `sku|location=${skuKey}, shared=${sharedQty}, unattributedAllocation=${roomQty}`,
        });
      }
    }
  }
```

  파일 위 상수: `const LINE_ATTRIBUTED_CUSTODY = new Set(['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED', 'RETURN_PENDING', 'SETTLED']);`, `const SHARED_CUSTODY = new Set(['AT_SOURCE', 'BULK_CART']);`

  (d) `assertFulfillmentOrders` 의 적재:
  - `workItems` 조회 select 에 `shipmentId`·`status` 를 더한다(잠금 그대로).
  - `sessions` select 에 `batchId`·`handedBackQty`, `sessionBalances` select 에 `skuId`·`sourceLocationId`·`shipmentLineId`.
  - `sessions` 조회 뒤에 잠그지 않는 두 조회(배정은 작업 항목·세션 잠금 아래에서만 바뀌고 `started_at` 은 한 번만 쓰인다):

```ts
    const batches = batchIds.length
      ? await tx
          .select({ id: wmsTables.outboundBatches.id, startedAt: wmsTables.outboundBatches.startedAt })
          .from(wmsTables.outboundBatches)
          .where(inArray(wmsTables.outboundBatches.id, batchIds))
      : [];
    const allocations = batchIds.length
      ? await tx
          .select({
            id: wmsTables.pickingSourceAllocations.id,
            // holds because the inner join below filters to rows with a work item.
            workItemId: sql<string>`${wmsTables.pickingSourceAllocations.workItemId}`,
            batchId: wmsTables.outboundBatchWorkItems.batchId,
            shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
            skuId: wmsTables.shipmentLines.skuId,
            sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
            qty: wmsTables.pickingSourceAllocations.qty,
          })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.outboundBatchWorkItems,
            eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
          )
          .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId))
          .where(inArray(wmsTables.outboundBatchWorkItems.batchId, batchIds))
      : [];
```

  (`eq` 를 drizzle-orm import 에 더한다.) `collectFulfillmentInvariantViolations({ … })` 호출에 `batches, workItems, allocations` 를 더한다.

  (e) `fulfillment-reconciliation.service.ts` 의 `SESSION_CONSERVATION` 두 식(메시지 `concat` 과 `WHERE`)에 `bis.handed_back_qty` 를 더한다: 메시지 `', handedBack=', bis.handed_back_qty`, 조건 `coalesce(sr.qty, 0) + bis.settled_qty + bis.returned_qty + bis.shortage_qty + bis.handed_back_qty`. 주석 한 줄: `-- 배정 불변식(I1~I3)은 명령 경로의 검사기(FulfillmentInvariantService)가 막는다 — 여기서는 0 으로 보고된다.`

  (f) `__support__/logistics-assertions.ts`:

```ts
/** 시나리오 끝의 불변식 검사기(스펙 §14) — 박스들의 연결 구성요소를 잠그고 FULFILLMENT_INVARIANT_VIOLATION 이면 던진다. */
export async function assertFulfillmentInvariantsFor(tx: DbTx, shipmentIds: string[]): Promise<void> {
  const rows = await tx
    .selectDistinct({ id: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
  await new FulfillmentInvariantService().assertFulfillmentOrders(
    rows.map((row) => row.id),
    tx,
  );
}
```

- [ ] **Step 4: 단위·전체 통합을 돌린다**

Run: `npx jest apps/core/src/modules/fulfillment/services/fulfillment-invariant apps/core/src/modules/fulfillment/services/fulfillment-reconciliation` → PASS
Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local`
Expected: 새 실패 0. **새로 빨개진 통합 스위트가 있으면** 위반 메시지를 읽고 둘 중 하나로 가른다:
  - 픽스처가 현실에 없는 상태를 심었다(예: 배정 없이 보관만 심은 세션) → 픽스처를 현실 모양으로 고친다. 검사기를 느슨하게 하지 않는다.
  - 운영 코드 경로가 I1~I3 을 어긴다 → **멈추고** 컨트롤러에게 보고한다(그 자체가 버그다).
  develop 부터 붉던 스위트는 develop 워크트리에서 같은 명령으로 대조해 목록만 남긴다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.ts apps/core/src/modules/fulfillment/services/fulfillment-invariant.service.spec.ts apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.ts apps/core/src/modules/fulfillment/services/fulfillment-reconciliation.service.spec.ts apps/core/src/modules/fulfillment/services/__support__/logistics-assertions.ts
git commit -m "feat(fulfillment): 불변식 검사기에 배정 불변식 I1~I3 과 반납 보존식 (#988)"
```

---

### Task 6: 합류 — `BoxAllocationManager` 와 시작된 배치에 넣기

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/box-allocation.manager.ts`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.locks.ts` (`lockSkuCapacities`)
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.errors.ts` (`joinBlocked`)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` (`addShipment`, `assertEligible` 분리, 생성자)
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (provider)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-wiring.ts` (`boxes`, `startDeps`)
- Modify: `apps/core/src/modules/fulfillment/services/__support__/simple-outbound-fixtures.ts` (`seedLooseBox`)
- Modify(생성자 인자만): `outbound-batch-orchestrator.service.spec.ts`, `outbound-v2-warehouse-scenarios.integration.spec.ts`, `outbound-v2-lifecycle-scenarios.integration.spec.ts`, `outbound-batch-orchestrator.integration.spec.ts`, `outbound-v2-recovery-scenarios.integration.spec.ts`, `outbound-v2-concurrency.integration.spec.ts` — 목록 도출: `grep -rln "new OutboundBatchOrchestrator(" apps/core/src`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/batch-start.integration.spec.ts` (옛 «시작된 배치에 추가하면 OUTBOUND_BATCH_ALREADY_STARTED» 테스트 삭제 — 아래 합류 테스트가 대체)
- Test: `apps/core/src/modules/fulfillment/services/batch-join.integration.spec.ts` (신규), `apps/core/src/modules/fulfillment/services/batch-join.concurrency.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: `reconcileAllocation`·`ReconcilePlan`(Task 1), `BatchInventorySessionService.handIn`·`BatchInventorySessionRow`(Task 3), `assertFulfillmentInvariantsFor`(Task 5), `describeStartBlockers`·`StartBlocker`(PR 1)
- Produces:
  - `lockSkuCapacities(trx, controlledStock, warehouseId: string, skuIds: readonly string[]): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }>` — `lockSourceCapacities` 는 이것을 부른다
  - `joinBlocked(shipmentId: string, blockers: StartBlockerView[]): ConflictException` — 코드 `BATCH_JOIN_BLOCKED`, `errors`
  - `BoxAllocationManager`:
    - `lockOpenSession(batchId: string, trx: DbTx): Promise<BatchInventorySessionRow | null>` — `active`·`recovery_required` 세션과 그 보관 행을 잠근다
    - `planJoin(input: { warehouseId: string; workItemId: string; lines: Array<{ id: string; skuId: string; qty: number }> }, trx: DbTx): Promise<ReconcilePlan>`
    - `applyJoin(input: { session: BatchInventorySessionRow; batchId: string; actorId: string; operationId: string; plan: ReconcilePlan; lines: Array<{ id: string; skuId: string }> }, trx: DbTx): Promise<void>`
  - `OutboundBatchOrchestrator` 생성자 마지막 인자 `boxes: BoxAllocationManager`
  - 거절 코드: `BATCH_JOIN_BLOCKED`(무변경), `BATCH_NOT_JOINABLE`(닫힌 배치·세션 비활성 — 옛 `OUTBOUND_BATCH_CLOSED` 대체)
  - 테스트 지원: `seedLooseBox(tx, base: PickableShipmentFixture, qty: number): Promise<PickableShipmentFixture>`(어느 배치에도 없는 `planned` 박스), `assembleOutboundWithDb(...)` 반환에 `boxes` 와 `startDeps: BatchStartDeps`

- [ ] **Step 1: 테스트 지원을 먼저 더한다**
  - `simple-outbound-fixtures.ts`:

```ts
/**
 * 어느 배치에도 없는 `planned` 박스 — 합류 대상. `base` 와 같은 SKU·위치·배송 프로필 위에 만들고 자기 작업 항목을 지운다
 * (seedShipmentForExistingStock 이 만든 빈 배치는 남는다 — 롤백 스펙이면 상관없다).
 */
export async function seedLooseBox(tx: DbTx, base: PickableShipmentFixture, qty: number): Promise<PickableShipmentFixture> {
  const box = await seedBoxOverSameStock(tx, base, qty);
  await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
  return box;
}
```

  - `simple-outbound-wiring.ts`: `BoxAllocationManager` 를 만들어 오케스트레이터 마지막 인자로 넘기고, 반환에 `boxes` 와 `startDeps` 를 더한다:

```ts
  const boxes = new BoxAllocationManager(sessions, controlled);
  const batches = new OutboundBatchOrchestrator(dbService, commands, invariant, waybills, audit, workflowGate, moduleRef, boxes);
  // …
  const startDeps: BatchStartDeps = { commands, workflowGate, sessions, invariant, controlledStock: controlled, waybills };
  return { simple, picking, batches, sessions, boxes, startDeps, recovery: …, location: … };
```

- [ ] **Step 2: 실패하는 통합 테스트를 쓴다** — `batch-join.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { startBatchPicking } from '../picking/allocation/batch-start';
import { STRATEGY_BY_PICKING_METHOD } from '../picking/picking-method.contract';
import { assembleLabels, promoteToCarrierWaybill } from '../waybill/__support__/label-fixtures';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { seedLooseBox, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('시작된 배치에 합류 (스펙 §7)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 둘(2·1개)이 시작된 배치 + 같은 재고 위의 떠 있는 박스. 재고 기본 10. */
  async function startedBatchWithLooseBox(tx: DbTx, looseQty = 3, stockQty = 10) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, stockQty);
    const wiring = assembleOutbound(tx);
    const started = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const loose = await seedLooseBox(tx, first, looseQty);
    return { first, second, loose, wiring, sessionId: started.sessionId };
  }

  const allocationsOf = (tx: DbTx, workItemIds: string[]) =>
    tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(inArray(wmsTables.pickingSourceAllocations.workItemId, workItemIds));
  const sessionOf = async (tx: DbTx, sessionId: string) =>
    (await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, sessionId)))[0];

  it('그 박스만 배정·인계하고 다른 박스의 배정은 그대로다 — 복구 healthy, 불변식 통과', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx);
      const othersBefore = await allocationsOf(tx, [first.workItemId, second.workItemId]);

      const joined = await wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, tx);

      expect(joined.workItem).toMatchObject({ batchId: first.batchId, shipmentId: loose.shipmentId, status: 'queued' });
      const own = await allocationsOf(tx, [joined.workItem.id]);
      expect(own.map((row) => [row.shipmentLineId, row.sourceLocationId, row.qty])).toEqual([
        [loose.shipmentLineId, loose.locationId, 3],
      ]);
      expect(await allocationsOf(tx, [first.workItemId, second.workItemId])).toEqual(othersBefore);
      const session = await sessionOf(tx, sessionId);
      expect(session.handedInQty).toBe(6);
      const handIns = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      const joinEvent = handIns.find((event) => event.idempotencyKey.startsWith('hand-in:'));
      expect(joinEvent?.payload).toMatchObject({ batchId: first.batchId, workItemId: joined.workItem.id, allocationId: own[0].id });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId, loose.shipmentId]);
    });
  });

  it('다른 박스의 송장 지문은 변하지 않고, 합류한 박스는 출력 전(never_printed)이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first } = await seedTwoBoxBatch(tx, 1, 10);
      await promoteToCarrierWaybill(tx, first);
      const wiring = assembleOutbound(tx);
      await wiring.picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
      const loose = await seedLooseBox(tx, first, 2);
      await promoteToCarrierWaybill(tx, loose);
      const labels = assembleLabels(ambientDbService(tx));
      const before = await labels.assembler.current(first.shipmentId, tx);

      await wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, tx);

      const after = await labels.assembler.current(first.shipmentId, tx);
      expect(after.kind === 'printable' && before.kind === 'printable' && after.fingerprint === before.fingerprint).toBe(true);
      await expect(labels.states.forShipment(loose.shipmentId, tx)).resolves.toMatchObject({ state: 'never_printed' });
    });
  });

  it('재고가 모자라면 BATCH_JOIN_BLOCKED(STOCK_SHORT) 이고 작업 항목·배정·인계가 남지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx, 3, 5); // 일반 가용 5 − 3 = 2
      const sessionBefore = await sessionOf(tx, sessionId);

      await expect(
        tx.transaction((trx) => wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx)),
      ).rejects.toMatchObject({
        response: {
          code: 'BATCH_JOIN_BLOCKED',
          errors: [expect.objectContaining({ shipmentId: loose.shipmentId, reason: 'STOCK_SHORT', requiredQty: 3, shortQty: 1 })],
        },
      });

      const items = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, loose.shipmentId));
      expect(items).toEqual([]);
      expect(await sessionOf(tx, sessionId)).toEqual(sessionBefore);
    });
  });

  it('송장이 쓸 수 없고 재고도 모자라면 사유를 둘 다 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring } = await startedBatchWithLooseBox(tx, 3, 5);
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, loose.waybillId));

      const error = await tx
        .transaction((trx) => wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx))
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ response: { code: 'BATCH_JOIN_BLOCKED' } });
      const reasons = (error as { response: { errors: Array<{ reason: string }> } }).response.errors.map((b) => b.reason);
      expect(reasons.sort()).toEqual(['STOCK_SHORT', 'WAYBILL_NOT_READY']);
    });
  });

  it('완료된 배치와 세션이 active 가 아닌 배치에는 BATCH_NOT_JOINABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await expect(
        tx.transaction((trx) => wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx)),
      ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_JOINABLE' } });

      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'active', recoveryReason: null })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'completed' })
        .where(inArray(wmsTables.outboundBatchWorkItems.id, [first.workItemId, second.workItemId]));
      await expect(
        tx.transaction((trx) => wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx)),
      ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_JOINABLE' } });
    });
  });

  it('같은 멱등 키로 다시 보내면 같은 작업 항목이고 인계가 늘지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, sessionId } = await startedBatchWithLooseBox(tx);
      const key = `j-${randomUUID()}`;
      const a = await wiring.batches.addShipment(first.batchId, loose.shipmentId, key, actor, tx);
      const b = await wiring.batches.addShipment(first.batchId, loose.shipmentId, key, actor, tx);
      expect(b.workItem.id).toBe(a.workItem.id);
      expect((await sessionOf(tx, sessionId)).handedInQty).toBe(6);
    });
  });

  it.each(['individual', 'multi_order', 'total_picking'] as const)('%s 배치에도 합류한다', async (method) => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: method, cartCapacity: method === 'multi_order' ? 10 : null })
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      const wiring = assembleOutbound(tx);
      // 테스트 배선의 전략 레지스트리는 discrete 만 안다 — 시작 진입점을 직접 부른다(배정은 방식과 무관하다).
      await startBatchPicking(
        wiring.startDeps,
        STRATEGY_BY_PICKING_METHOD[method],
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const loose = await seedLooseBox(tx, first, 2);

      const joined = await wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, tx);

      expect((await allocationsOf(tx, [joined.workItem.id])).reduce((t, r) => t + r.qty, 0)).toBe(2);
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId, loose.shipmentId]);
    });
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-join.integration`
Expected: FAIL — `OUTBOUND_BATCH_ALREADY_STARTED`(또는 `BoxAllocationManager` 없음 컴파일 에러)

- [ ] **Step 4: 잠금 헬퍼와 오류를 더한다**
  - `allocation.locks.ts` — 기존 `lockSourceCapacities` 본문을 `lockSkuCapacities` 로 옮기고(`aggregate.batch.warehouseId` → `warehouseId`, `aggregate.lines` 의 SKU → `skuIds`), 옛 함수는 위임만 한다:

```ts
/** 한 창고의 SKU 들에 대해 가용 잠금 → ON_HAND 원장 잠금 → 로케이션별 일반 가용(세션 통제·적치 대기 제외). */
export async function lockSkuCapacities(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  warehouseId: string,
  skuIds: readonly string[],
): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }> {
  const sorted = uniqueSorted(skuIds);
  // (옛 lockSourceCapacities 본문 — skuIds → sorted, aggregate.batch.warehouseId → warehouseId)
}

export async function lockSourceCapacities(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  aggregate: LockedAggregate,
): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }> {
  return lockSkuCapacities(
    trx,
    controlledStock,
    aggregate.batch.warehouseId,
    aggregate.lines.map((line) => line.skuId),
  );
}
```

  - `allocation.errors.ts`:

```ts
/** 합류 거절 — 아무것도 쓰지 않았다. 모양은 시작 거절과 같다(사유 표 스펙 §6). */
export function joinBlocked(shipmentId: string, blockers: StartBlockerView[]): ConflictException {
  return new ConflictException({
    code: 'BATCH_JOIN_BLOCKED',
    message: `Shipment ${shipmentId} cannot join the running batch: ${blockers.length} blocker(s)`,
    errors: blockers,
  });
}
```

- [ ] **Step 5: `BoxAllocationManager` 를 만든다** — `services/box-allocation.manager.ts`:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { lockSkuCapacities } from '../picking/allocation/allocation.locks';
import { SessionStartAllocation } from '../picking/allocation/allocation.types';
import { ReconcilePlan, reconcileAllocation } from '../picking/allocation/reconcile-allocation';
import { BatchInventorySessionRow, BatchInventorySessionService } from './batch-inventory-session.service';

/**
 * 배정 변경의 실행부(스펙 §5 원칙). 규칙은 `reconcileAllocation` 이 정하고, 여기서는 잠금 아래에서 적용만 한다.
 * 호출자(오케스트레이터)가 구성요소와 작업 항목을 먼저 잡는다 — 이 클래스는 그 뒤의 «세션 → 보관 → 재고» 를 맡는다.
 */
@Injectable()
export class BoxAllocationManager {
  constructor(
    private readonly sessions: BatchInventorySessionService,
    private readonly controlledStock: BatchControlledStockGuard,
  ) {}

  /**
   * 배치의 열린 세션(active·recovery_required)과 그 보관 행을 잠근다. 발송과 같은 «세션 → 보관» 순서다 — 합류는
   * 이 뒤에 가용 잠금을 잡으므로, 세션보다 가용 잠금을 먼저 잡으면 발송(세션 → 가용 잠금)과 교착한다.
   */
  async lockOpenSession(batchId: string, trx: DbTx): Promise<BatchInventorySessionRow | null> {
    const [session] = await trx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, batchId),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .limit(1)
      .for('update');
    if (!session) return null;
    await trx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id))
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
      .for('update');
    return session;
  }

  /** 합류(목표 0 → 줄 수량)의 계획. 쓰지 않는다 — 호출자가 다른 사유(송장)와 묶어 판정한 뒤 applyJoin 한다(스펙 §7-5). */
  async planJoin(
    input: { warehouseId: string; workItemId: string; lines: Array<{ id: string; skuId: string; qty: number }> },
    trx: DbTx,
  ): Promise<ReconcilePlan> {
    const { capacities, inboundPendingBySku } = await lockSkuCapacities(
      trx,
      this.controlledStock,
      input.warehouseId,
      input.lines.map((line) => line.skuId),
    );
    return reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: line.qty })),
      allocations: [],
      atSource: new Map(),
      capacities,
      inboundPendingBySku,
    });
  }

  async applyJoin(
    input: {
      session: BatchInventorySessionRow;
      batchId: string;
      actorId: string;
      operationId: string;
      plan: ReconcilePlan;
      lines: Array<{ id: string; skuId: string }>;
    },
    trx: DbTx,
  ): Promise<void> {
    const { plan } = input;
    if (plan.shortages.length || plan.handBacks.length || plan.cartSurplus.length || plan.excess.length || !plan.handIns.length) {
      throw new Error('applyJoin: a join plan must be a non-empty pure hand-in');
    }
    const inserted = await trx.insert(wmsTables.pickingSourceAllocations).values(plan.handIns).returning();
    const skuByLine = new Map(input.lines.map((line) => [line.id, line.skuId]));
    const allocations: SessionStartAllocation[] = inserted.map((row) => ({
      id: row.id,
      // holds because every inserted row came from plan.handIns, built with the joining work item id.
      workItemId: row.workItemId!,
      shipmentLineId: row.shipmentLineId,
      // holds because plan.handIns came from input.lines (planJoin targets), which built skuByLine.
      skuId: skuByLine.get(row.shipmentLineId)!,
      sourceLocationId: row.sourceLocationId,
      quantity: row.qty,
      sourceStockVersion: row.sourceStockVersion,
    }));
    await this.sessions.handIn(
      { sessionId: input.session.id, batchId: input.batchId, actorId: input.actorId, operationId: input.operationId, allocations },
      trx,
    );
  }
}

export function notJoinable(batchId: string, why: string): ConflictException {
  return new ConflictException({ code: 'BATCH_NOT_JOINABLE', message: `Batch ${batchId} is not joinable: ${why}` });
}
```

  `fulfillment.module.ts` providers 에 `BoxAllocationManager` 를 `OutboundBatchOrchestrator` 바로 앞에 더한다(`BatchControlledStockGuard` 는 inventory 모듈이 export 한다 — `PickingProcessService` 가 이미 주입받는다).

- [ ] **Step 6: 오케스트레이터를 고친다** — `outbound-batch-orchestrator.service.ts`:
  - 생성자 마지막에 `private readonly boxes: BoxAllocationManager,`. 오케스트레이터를 직접 만드는 스펙 6개(Files 목록)에 `new BoxAllocationManager(<그 파일의 세션 서비스>, new BatchControlledStockGuard())` 를 마지막 인자로 넘긴다(단위 스펙은 `{} as never`).
  - `assertEligible` 을 둘로 나눈다. 본문에서 마지막 `assertDispatchable` 두 줄만 남기고 앞부분 전체를 `assertJoinableBox` 로 옮긴다:

```ts
  /** 송장을 뺀 박스 조건 — 시작 전 추가·합류·합류 후보 조회가 같이 쓴다. */
  private async assertJoinableBox(
    batch: BatchRow,
    aggregate: EligibilityAggregate,
    tx: DbTx,
    lockExecutionInputs = true,
  ): Promise<void> {
    // (옛 assertEligible 의 상태·창고·프로필·수령인·예약·SKU·활성 작업 항목·발송 시도 검사 그대로)
  }

  private async assertEligible(
    batch: BatchRow,
    aggregate: EligibilityAggregate,
    tx: DbTx,
    lockExecutionInputs = true,
  ): Promise<{ waybillId: string; trackingNo: string }> {
    await this.assertJoinableBox(batch, aggregate, tx, lockExecutionInputs);
    // assertFulfillmentOrders locked invoice rows before this validation, closing the add-vs-void TOCTOU window.
    const waybill = await this.waybills.assertDispatchable(aggregate.shipment.id, tx);
    return { waybillId: waybill.id, trackingNo: waybill.trackingNo ?? '' };
  }

  /** 합류의 송장 사유(스펙 §6 WAYBILL_NOT_READY) — 막지 않고 모은다. 인증·SQL 오류는 그대로 샌다. */
  private async waybillBlockers(shipmentId: string, tx: DbTx): Promise<StartBlocker[]> {
    try {
      await this.waybills.assertDispatchable(shipmentId, tx);
      return [];
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      return [
        { shipmentId, reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, requiredQty: null, shortQty: null, detail: error.message },
      ];
    }
  }
```

  - `lockOpenBatch` 의 `OUTBOUND_BATCH_CLOSED` 를 `BATCH_NOT_JOINABLE` 로(메시지 그대로).
  - `addShipment` 핸들러를 갈래로 나눈다. `assertNoActiveWorkItem` 뒤:

```ts
        // started_at 은 한 번만 쓰인다 — 잠그지 않은 읽기로 갈래를 정해도 «시작됨» 은 뒤집히지 않는다.
        const [peek] = await trx
          .select({ startedAt: wmsTables.outboundBatches.startedAt })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, batchId))
          .limit(1);
        if (!peek) throw new NotFoundException(`Outbound batch ${batchId} not found`);
        if (peek.startedAt) return this.joinStartedBatch(batchId, aggregate, actor, commandRequestId, trx);
        const batch = await this.lockOpenBatch(batchId, trx);
        // 잠금을 기다리는 사이 시작됐다 — 합류로 간다. 배치·작업 항목 잠금을 쥔 채 세션을 잡아도 발송(작업 항목 → 세션)과 같은 방향이다.
        if (batch.startedAt) return this.joinStartedBatch(batchId, aggregate, actor, commandRequestId, trx);
        // (이하 기존 시작 전 본문: assertCartCapacity → assertEligible → 작업 항목 insert → audit → response)
```

  `OUTBOUND_BATCH_ALREADY_STARTED` 거절 블록은 지운다.
  - 새 private 메서드:

```ts
  /**
   * 합류(스펙 §7) — 한 트랜잭션: 박스 조건 → 세션 잠금 → 닫힘 판정 → 작업 항목 → 배정 계획 → (막히면 전부 보고) → 배정·인계.
   *
   * 배치 행과 다른 박스의 작업 항목은 잠그지 않는다. 발송은 «작업 항목 → 세션» 으로 잡는데 여기서 세션을 쥔 채 다른 박스의
   * 작업 항목을 잠그면 교착한다. 대신 세션 잠금이 같은 배치의 합류·발송 완료와 줄을 세운다 — 그 아래에서 읽는 작업 항목
   * 상태(닫힘 판정·카트 정원)는 동시 합류가 바꿀 수 없고, 발송 완료가 우리보다 늦게 커밋되면 새 박스가 배치를 연 채로 둔다.
   * 불변식 검사기가 이 박스의 옛 배치 세션을 이미 잠갔을 수 있다(재합류) — 그래도 방향은 «구성요소 → 세션» 하나다.
   */
  private async joinStartedBatch(
    batchId: string,
    aggregate: EligibilityAggregate,
    actor: OutboundBatchActor,
    commandRequestId: string,
    trx: DbTx,
  ): Promise<{ response: OutboundBatchCommandResponseDto; resourceType: string; resourceId: string }> {
    const shipmentId = aggregate.shipment.id;
    const [batch] = await trx.select().from(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, batchId)).limit(1);
    if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
    await this.assertJoinableBox(batch, aggregate, trx);
    const session = await this.boxes.lockOpenSession(batchId, trx);
    const workItems = await trx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId));
    const status = this.derivedBatchStatus(batch, workItems);
    if (status === 'completed' || status === 'canceled') throw notJoinable(batchId, status);
    if (!session || session.status !== 'active') throw notJoinable(batchId, `inventory session is ${session?.status ?? 'missing'}`);
    await this.assertCartCapacity(batch, trx);
    const waybillBlockers = await this.waybillBlockers(shipmentId, trx);

    let workItem: WorkItemRow;
    try {
      [workItem] = await trx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({ batchId, shipmentId, status: 'queued' })
        .returning();
    } catch (error) {
      if (this.isActiveWorkItemUniqueViolation(error)) {
        throw this.conflict('SHIPMENT_ACTIVE_WORK_ITEM', `Shipment ${shipmentId} already belongs to an active batch work item`);
      }
      throw error;
    }
    const lines = aggregate.lines.map((line) => ({ id: line.id, skuId: line.skuId, qty: line.qty }));
    const plan = await this.boxes.planJoin({ warehouseId: batch.warehouseId, workItemId: workItem.id, lines }, trx);
    const blockers: StartBlocker[] = [
      ...plan.shortages.map((shortage) => ({
        shipmentId,
        reason: shortage.reason,
        shipmentLineId: shortage.shipmentLineId,
        skuId: shortage.skuId,
        requiredQty: shortage.requiredQty,
        shortQty: shortage.shortQty,
        detail: null,
      })),
      ...waybillBlockers,
    ];
    // 전부 아니면 전무(스펙 §7-5): 여기서 던지면 명령 트랜잭션이 작업 항목까지 되돌린다.
    if (blockers.length) throw joinBlocked(shipmentId, await describeStartBlockers(trx, blockers));
    await this.boxes.applyJoin({ session, batchId, actorId: actor.id, operationId: commandRequestId, plan, lines }, trx);
    await this.auditCommand(trx, actor, 'outbound_batch.shipment.join', workItem.id, {
      commandRequestId,
      batchId,
      shipmentId,
      sessionId: session.id,
      allocatedQty: plan.handIns.reduce((total, draft) => total + draft.qty, 0),
    });
    return {
      response: { operationId: commandRequestId, workItem: this.workItemResponse(workItem) },
      resourceType: 'outbound_batch_work_item',
      resourceId: workItem.id,
    };
  }
```

  import: `ConflictError`(`@app/shared`), `BoxAllocationManager`·`notJoinable`(`./box-allocation.manager`), `joinBlocked`(`../picking/allocation/allocation.errors`), `describeStartBlockers`(`../picking/allocation/allocation.locks`), `StartBlocker`(`../picking/allocation/allocation.types`). `auditCommand` 의 액션 이름 타입이 유니온이면 `'outbound_batch.shipment.join'` 을 더한다.
  - `batch-start.integration.spec.ts` 의 «시작된 배치에 박스를 추가하면 OUTBOUND_BATCH_ALREADY_STARTED» 테스트를 지운다(위 합류 테스트가 대체). `outbound-batch-orchestrator.integration.spec.ts` 의 `OUTBOUND_BATCH_CLOSED`·`OUTBOUND_BATCH_ALREADY_STARTED` 기대를 각각 `BATCH_NOT_JOINABLE`·합류 성공으로 고친다(그 테스트가 무엇을 검사하려 했는지 읽고, 합류가 성공하는 것이 새 계약이면 성공 기대로).

- [ ] **Step 7: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "batch-join.integration|batch-start|outbound-batch-orchestrator|outbound-v2"` 그리고 `npx jest apps/core/src/modules/fulfillment scripts/security --maxWorkers=2`, `npm run type-check`
Expected: 모두 PASS. `scripts/security` 가 좌표 불일치로 실패하면 가드 메시지대로 좌표를 갱신한다.

- [ ] **Step 8: 커밋 동시성 테스트를 쓴다** — `batch-join.concurrency.integration.spec.ts`. `outbound-preparation.concurrency.integration.spec.ts` 의 `overlap` 헬퍼를 `services/__support__/committed-overlap.ts` 로 옮겨 `export async function overlap<T, U>(observer: ReturnType<typeof makeDb>, first, second)` 로 내보내고, 옛 스펙은 그것을 import 하게 고친다(동작 불변). 새 스펙:

```ts
describeDb('합류 커밋 동시성', () => {
  const observer = makeDb(DATABASE_URL!);
  afterAll(() => observer.sql.end());

  it('같은 배치의 마지막 재고를 두 합류가 다투면 하나만 성공하고 다른 하나는 무변경 STOCK_SHORT', async () => {
    // 커밋형 픽스처: 시작된 배치(2·1개, 재고 6 → 일반 가용 3) + 떠 있는 박스 둘(각 2개)
    const setup = await observer.db.transaction(async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 6);
      await assembleOutbound(tx).picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      return { first, second, a: await seedLooseBox(tx, first, 2), b: await seedLooseBox(tx, first, 2) };
    });
    try {
      const add = (shipmentId: string) => (tx: DbTx) =>
        assembleOutbound(tx).batches.addShipment(setup.first.batchId, shipmentId, `j-${randomUUID()}`, actor, tx);
      const { first, second } = await overlap(observer, add(setup.a.shipmentId), add(setup.b.shipmentId));
      expect(first.workItem.shipmentId).toBe(setup.a.shipmentId);
      expect(second.ok).toBe(false);
      expect(second.ok ? null : second.error).toMatchObject({
        response: { code: 'BATCH_JOIN_BLOCKED', errors: [expect.objectContaining({ reason: 'STOCK_SHORT' })] },
      });
      await observer.db.transaction(async (tx) => {
        const items = await tx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, setup.b.shipmentId));
        expect(items.filter((item) => item.batchId === setup.first.batchId)).toEqual([]);
      });
    } finally {
      await observer.db.transaction((tx) => cleanupPreparationFixture(tx, setup.first, [setup.second, setup.a, setup.b]));
    }
  });
});
```

  `overlap` 은 두 번째 트랜잭션이 첫 번째에 **막혔는지**(`pg_blocking_pids`)까지 단언한다 — 합류가 세션 잠금에서 줄을 서는 증거다. `cleanupPreparationFixture` 가 합류로 생긴 작업 항목·배정(첫 배치에 매달린 것)을 지우지 못하면 거기에 더한다(배치 id 로 작업 항목 → 배정 순서로 삭제). 머리의 import·`describeDb`·`actor` 는 옛 동시성 스펙과 같게.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "batch-join.concurrency|outbound-preparation.concurrency"`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 시작된 배치에 박스를 합류시킨다 — 그 박스만 배정·인계, 막히면 사유 전부 (#988)"
```

---

### Task 7: 집기 전 이탈 — 반납하고 즉시 `excluded`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/box-allocation.manager.ts` (`withdrawUnpicked`)
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.errors.ts` (`boxHasPickedItems`)
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` (`excludeShipment` 갈래, `derivedBatchStatus`)
- Test: `apps/core/src/modules/fulfillment/services/batch-withdraw.integration.spec.ts` (신규)

**Interfaces:**
- Consumes: `reconcileAllocation`·`atSourceKey`(Task 1), `handBack`(Task 3), `lockOpenSession`(Task 6)
- Produces:
  - `BoxAllocationManager.withdrawUnpicked(input: { session: BatchInventorySessionRow; shipmentId: string; workItemId: string; lines: Array<{ id: string; skuId: string }>; actorId: string; operationId: string }, trx: DbTx): Promise<{ handedBackQty: number }>`
  - `boxHasPickedItems(shipmentId: string, items: AllocationDecrement[]): ConflictException` — 코드 `BOX_HAS_PICKED_ITEMS`, `errors: items`
  - `excludeShipment(batchId, shipmentId, dto, idempotencyKey, actor, tx?: DbTx)` — 시작된 배치면 반납 후 `excluded`
  - 파생 상태: 시작된 배치의 포함 박스가 0 이면 `canceled`

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `batch-withdraw.integration.spec.ts`(머리 import 는 Task 6 합류 스펙과 같게 + `BatchControlledStockGuard`):

```ts
describeIfDb('시작된 배치에서 집기 전 이탈 (스펙 §8, PR 2)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function started(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    return { first, second, wiring, sessionId: run.sessionId };
  }
  const exclude = (wiring: ReturnType<typeof assembleOutbound>, batchId: string, shipmentId: string, tx: DbTx, key = `x-${randomUUID()}`) =>
    wiring.batches.excludeShipment(batchId, shipmentId, { reason: '급한 변경' }, key, actor, tx);
  const general = (tx: DbTx, f: { skuId: string; warehouseId: string; locationId: string }) =>
    new BatchControlledStockGuard().getAvailability({ skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.locationId }, tx);

  it('집지 않은 박스는 반납하고 excluded — 배정 행은 0 으로 남고 박스는 planned·예약 그대로, 재고는 일반 가용으로', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      const firstBefore = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId));
      const availableBefore = (await general(tx, second)).generallyAvailableQty;

      const result = await exclude(wiring, first.batchId, second.shipmentId, tx);

      expect(result.workItem.status).toBe('excluded');
      const rows = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId));
      expect(rows.map((row) => row.qty)).toEqual([0]);
      const handBacks = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_BACK'),
          ),
        );
      expect(handBacks.map((event) => [event.quantity, (event.payload as Record<string, unknown>).allocationId])).toEqual([[1, rows[0].id]]);
      expect((await general(tx, second)).generallyAvailableQty).toBe(availableBefore + 1);
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      expect(shipment.status).toBe('planned');
      const reservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId));
      expect(reservations.map((r) => r.status)).toEqual(['confirmed']);
      expect(
        await tx.select().from(wmsTables.pickingSourceAllocations).where(eq(wmsTables.pickingSourceAllocations.workItemId, first.workItemId)),
      ).toEqual(firstBefore);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('집은 몫이 있으면 BOX_HAS_PICKED_ITEMS 이고 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: second.actorId,
          quantity: 1,
          from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: second.skuId,
            sourceLocationId: second.locationId,
            custodyType: 'WORKER',
            custodyRef: second.actorId,
            shipmentLineId: second.shipmentLineId,
          },
        },
        tx,
      );

      await expect(tx.transaction((trx) => exclude(wiring, first.batchId, second.shipmentId, trx))).rejects.toMatchObject({
        response: { code: 'BOX_HAS_PICKED_ITEMS', errors: [expect.objectContaining({ shipmentLineId: second.shipmentLineId, qty: 1 })] },
      });
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId));
      expect(item.status).toBe('queued');
    });
  });

  it('토탈피킹: AT_SOURCE 가 그 박스 몫을 덮으면 반납, 카트에 다 실렸으면 BOX_HAS_PICKED_ITEMS', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      await tx
        .update(wmsTables.outboundBatches)
        .set({ pickingMethod: 'total_picking' })
        .where(eq(wmsTables.outboundBatches.id, first.batchId));
      const wiring = assembleOutbound(tx);
      const run = await startBatchPicking(
        wiring.startDeps,
        'aggregate_then_sort',
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      // AT_SOURCE 3 중 3 을 카트로 — 누구 몫인지 모른다.
      await wiring.sessions.moveCustody(
        {
          sessionId: run.sessionId,
          idempotencyKey: `m-${randomUUID()}`,
          actorId: first.actorId,
          quantity: 3,
          from: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'AT_SOURCE' },
          to: { skuId: first.skuId, sourceLocationId: first.locationId, custodyType: 'BULK_CART', custodyRef: 'CART-1' },
        },
        tx,
      );
      await expect(tx.transaction((trx) => exclude(wiring, first.batchId, second.shipmentId, trx))).rejects.toMatchObject({
        response: { code: 'BOX_HAS_PICKED_ITEMS' },
      });
    });
  });

  it('빠진 박스는 같은 배치에 다시 합류할 수 있다 — 옛 0 행과 새 배정이 공존해도 healthy', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await exclude(wiring, first.batchId, second.shipmentId, tx);

      const rejoined = await wiring.batches.addShipment(first.batchId, second.shipmentId, `j-${randomUUID()}`, actor, tx);

      expect(rejoined.workItem.id).not.toBe(second.workItemId);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('박스를 모두 빼면 세션은 settled, 배치는 canceled 로 보이고 다시 넣을 수 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      await exclude(wiring, first.batchId, first.shipmentId, tx);
      await exclude(wiring, first.batchId, second.shipmentId, tx);

      const [session] = await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.status).toBe('settled');
      const listed = await wiring.batches.listBatches({ warehouseId: first.warehouseId }, tx);
      expect(listed.find((batch) => batch.id === first.batchId)?.status).toBe('canceled');
      await expect(
        tx.transaction((trx) => wiring.batches.addShipment(first.batchId, second.shipmentId, `j-${randomUUID()}`, actor, trx)),
      ).rejects.toMatchObject({ response: { code: 'BATCH_NOT_JOINABLE' } });
    });
  });

  it('같은 멱등 키로 다시 보내면 반납이 한 번이다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId } = await started(tx);
      const key = `x-${randomUUID()}`;
      await exclude(wiring, first.batchId, second.shipmentId, tx, key);
      await exclude(wiring, first.batchId, second.shipmentId, tx, key);
      const [session] = await tx.select().from(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session.handedBackQty).toBe(1);
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- batch-withdraw`
Expected: FAIL — `WORK_ITEM_ALLOCATED`

- [ ] **Step 3: 반납 실행부를 더한다**
  - `allocation.errors.ts`:

```ts
/** PR 2: 집은 몫이 있는 박스의 이탈 거절(PR 3 이 되돌림으로 연다). errors = 줄·로케이션·수량. */
export function boxHasPickedItems(shipmentId: string, items: AllocationDecrement[]): ConflictException {
  return new ConflictException({
    code: 'BOX_HAS_PICKED_ITEMS',
    message: `Shipment ${shipmentId} has picked items; they must be returned before it can leave the batch`,
    errors: items,
  });
}
```

  (`AllocationDecrement` 는 `./reconcile-allocation` 에서 type import.)
  - `BoxAllocationManager` 에 메서드와 상수:

```ts
const LINE_ATTRIBUTED_CUSTODY = ['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED', 'RETURN_PENDING', 'SETTLED'] as const;

  /**
   * 집기 전 이탈(목표 → 0). 호출자가 구성요소·작업 항목·세션을 잠갔다. 집은 몫이나 카트에 실렸을 수 있는 몫이 있으면
   * 아무것도 바꾸지 않고 BOX_HAS_PICKED_ITEMS(PR 3 이 되돌림으로 연다). 아니면 배정마다 HAND_BACK 하고 배정을 줄인다 —
   * 반납된 재고는 세션 통제가 풀려 그 자리에서 일반 가용이 된다.
   */
  async withdrawUnpicked(
    input: {
      session: BatchInventorySessionRow;
      shipmentId: string;
      workItemId: string;
      lines: Array<{ id: string; skuId: string }>;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<{ handedBackQty: number }> {
    const lineIds = input.lines.map((line) => line.id);
    const rows = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        skuId: wmsTables.shipmentLines.skuId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        locationCode: wmsTables.locations.code,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId))
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
      .where(and(eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId), gt(wmsTables.pickingSourceAllocations.qty, 0)));
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(and(eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id), gt(wmsTables.batchInventorySessionBalances.qty, 0)));
    const attributed = new Map<string, number>();
    const atSource = new Map<string, number>();
    for (const balance of balances) {
      if (!balance.sourceLocationId) continue;
      if (balance.custodyType === 'AT_SOURCE') {
        const key = atSourceKey(balance.skuId, balance.sourceLocationId);
        atSource.set(key, (atSource.get(key) ?? 0) + balance.qty);
      } else if (
        balance.shipmentLineId &&
        lineIds.includes(balance.shipmentLineId) &&
        (LINE_ATTRIBUTED_CUSTODY as readonly string[]).includes(balance.custodyType)
      ) {
        const key = `${balance.shipmentLineId}|${balance.sourceLocationId}`;
        attributed.set(key, (attributed.get(key) ?? 0) + balance.qty);
      }
    }
    const plan = reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: 0 })),
      allocations: rows.map((row) => ({
        ...row,
        // I3 이 지켜졌다면 귀속 ≤ 배정이다. 넘으면 reconcileAllocation 이 입력 오류로 던진다 — 조용히 자르지 않는다.
        attributedQty: attributed.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0,
      })),
      atSource,
      capacities: [],
    });
    if (plan.excess.length || plan.cartSurplus.length) {
      throw boxHasPickedItems(input.shipmentId, [...plan.excess, ...plan.cartSurplus]);
    }
    for (const back of plan.handBacks) {
      await this.sessions.handBack(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId: input.workItemId,
          allocationId: back.allocationId,
          shipmentLineId: back.shipmentLineId,
          skuId: back.skuId,
          sourceLocationId: back.sourceLocationId,
          quantity: back.qty,
        },
        trx,
      );
      const [reduced] = await trx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: sql`${wmsTables.pickingSourceAllocations.qty} - ${back.qty}` })
        .where(and(eq(wmsTables.pickingSourceAllocations.id, back.allocationId), gte(wmsTables.pickingSourceAllocations.qty, back.qty)))
        .returning({ id: wmsTables.pickingSourceAllocations.id });
      if (!reduced) throw new ConflictException({ code: 'PICKING_ALLOCATION_STALE', message: `Allocation ${back.allocationId} changed` });
    }
    return { handedBackQty: plan.handBacks.reduce((total, back) => total + back.qty, 0) };
  }
```

  (import 에 `gt`·`gte`·`sql`, `atSourceKey`, `boxHasPickedItems` 추가.)

- [ ] **Step 4: 오케스트레이터를 고친다**
  - `excludeShipment` 시그니처 끝에 `tx?: DbTx` 를 더하고 `this.commands.execute(…, tx)` 로 넘긴다(대기 오퍼레이션 재개 `resumeWaitingOperationIfReady(…, tx)` 도).
  - 배치 조회 select 에 `startedAt` 을 더하고, `assertWaitingOperationOwnership` 뒤를 갈래로:

```ts
        if (!batch.startedAt) {
          await this.assertExcludable(aggregate, trx);
        } else {
          await this.withdrawFromStartedBatch(batchId, aggregate, workItem, actor, commandRequestId, trx);
        }
        const now = await this.databaseNow(trx);
        // (이하 기존 excluded 전이·감사·응답 그대로)
```

  - 새 private 메서드:

```ts
  /**
   * 시작된 배치에서의 이탈(스펙 §8, PR 2 = 집기 전만). 결과는 시작 전 제외와 같다 — 박스는 planned 로 남아
   * 예약·송장을 그대로 들고 배치 전 풀로 돌아간다(exit_to 는 PR 3).
   */
  private async withdrawFromStartedBatch(
    batchId: string,
    aggregate: EligibilityAggregate,
    workItem: WorkItemRow,
    actor: OutboundBatchActor,
    commandRequestId: string,
    trx: DbTx,
  ): Promise<void> {
    if (workItem.status === 'short_pick_recovery') {
      throw this.conflict('WORK_ITEM_ALLOCATED', 'Work item is in short-pick recovery; use short-pick recovery');
    }
    const [attempt, toteAssignment] = await Promise.all([
      trx
        .select({ id: wmsTables.dispatchAttempts.id })
        .from(wmsTables.dispatchAttempts)
        .where(and(eq(wmsTables.dispatchAttempts.shipmentId, aggregate.shipment.id), ne(wmsTables.dispatchAttempts.status, 'recalled')))
        .limit(1),
      trx
        .select({ id: wmsTables.shipmentToteAssignments.id })
        .from(wmsTables.shipmentToteAssignments)
        .where(and(eq(wmsTables.shipmentToteAssignments.shipmentId, aggregate.shipment.id), isNull(wmsTables.shipmentToteAssignments.releasedAt)))
        .limit(1),
    ]);
    if (attempt[0]) throw this.conflict('WORK_ITEM_DISPATCH_EXISTS', 'A dispatched shipment cannot be excluded from a batch');
    if (toteAssignment[0]) {
      throw this.conflict('WORK_ITEM_TOTE_RELEASE_REQUIRED', 'Active physical tote assignments must be released before exclusion');
    }
    if (aggregate.lines.some((line) => line.inspectedQty > 0)) {
      throw boxHasPickedItems(aggregate.shipment.id, []);
    }
    const session = await this.boxes.lockOpenSession(batchId, trx);
    if (!session) throw this.conflict('PICKING_SESSION_NOT_ACTIVE', `Batch ${batchId} has no open inventory session`);
    await this.boxes.withdrawUnpicked(
      {
        session,
        shipmentId: aggregate.shipment.id,
        workItemId: workItem.id,
        lines: aggregate.lines.map((line) => ({ id: line.id, skuId: line.skuId })),
        actorId: actor.id,
        operationId: commandRequestId,
      },
      trx,
    );
  }
```

  - `derivedBatchStatus` — 포함 박스가 없을 때:

```ts
    // 시작된 배치의 박스가 모두 빠지면 세션은 반납으로 settled 가 되어 다시 열 수 없다 — «시작 전»으로 보이면 안 된다.
    if (!included.length) return batch.startedAt ? 'canceled' : 'created';
```

- [ ] **Step 5: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- "batch-withdraw|batch-join|outbound-batch-orchestrator|outbound-v2|shipment-planning|consolidation"` 그리고 `npx jest apps/core/src/modules/fulfillment scripts/security --maxWorkers=2`, `npm run type-check`
Expected: PASS. `outbound-batch-orchestrator.integration.spec.ts` 의 `WORK_ITEM_ALLOCATED` 기대(시작된 배치에서 제외 시도)는 새 계약으로 바뀐다 — 그 테스트가 «집은 몫 없음»이면 성공 기대로, «집은 몫 있음»이면 `BOX_HAS_PICKED_ITEMS` 로 고친다. `WORK_ITEM_UNPICK_REQUIRED` 기대는 시작 전 배치 경로라 그대로다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 시작된 배치에서 집기 전 박스를 뺀다 — HAND_BACK 으로 즉시 반납, 집은 몫이면 BOX_HAS_PICKED_ITEMS (#988)"
```

---

### Task 8: 합류 후보 조회 — 주문번호·송장번호로 박스 찾기

**Files:**
- Create: `apps/core/src/modules/fulfillment/services/join-candidate.queries.ts`
- Modify: `apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator.service.ts` (`findJoinCandidates`)
- Modify: `apps/core/src/modules/fulfillment/dto/outbound-batch-v2.dto.ts` (`JoinCandidateResponseDto` 등)
- Modify: `apps/core/src/modules/fulfillment/controllers/outbound-batch-v2.controller.ts` (`GET outbound-batches/:batchId/join-candidates`)
- Modify: `apps/core/src/modules/fulfillment/reader/shipment-waybill.reader.ts` (`maskName`·`readRecipientName` export)
- Test: `apps/core/src/modules/fulfillment/services/join-candidates.integration.spec.ts` (신규), `controllers/outbound-batch-v2.controller.spec.ts`(빈 코드 400)

**Interfaces:**
- Consumes: `assertJoinableBox`·`loadEligibilityAggregate`(오케스트레이터 private), `isAppPrintable`(`waybill/waybill-label-content.assembler.ts`)
- Produces:
  - `findShipmentIdsByCode(trx: DbTx, warehouseId: string, code: string): Promise<string[]>` — 창고 안, 생성 순, 최대 20
  - `OutboundBatchOrchestrator.findJoinCandidates(batchId: string, code: string, tx?: DbTx): Promise<JoinCandidateResponseDto[]>`
  - DTO:

```ts
export class JoinCandidateLineDto { skuCode: string; skuName: string; qty: number; }
export class JoinCandidateWaybillDto {
  id: string; trackingNo: string | null; status: string; source: string; carrier: string;
  /** 앱이 그릴 수 있는 송장인가(한진 발급). 아니면 합류 뒤 출력 없이 진행한다(labelState external). */
  printable: boolean;
}
export class JoinCandidateResponseDto {
  shipmentId: string; shipmentStatus: string; manifestVersion: number;
  orderNos: string[]; recipientMasked: string; totalQty: number;
  lines: JoinCandidateLineDto[];
  waybill: JoinCandidateWaybillDto | null;
  /** 송장 밖의 합류 불가 사유 코드(SHIPMENT_ACTIVE_WORK_ITEM 등). null 이면 송장만 보면 된다. */
  issue: string | null;
  /** 활성 송장이 있는데 발송할 수 없는 사유 코드(WAYBILL_STALE 등). 송장이 없으면 null — 앱이 발급한다. */
  waybillIssue: string | null;
}
```

  (각 필드에 `@ApiProperty` — 파일의 다른 DTO 관례대로. 중첩은 별도 클래스, `type: 'object'` 금지.)

- [ ] **Step 1: 실패하는 통합 테스트를 쓴다** — `join-candidates.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { seedLooseBox, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('합류 후보 조회 (스펙 §7 앱 「이 배치에 넣기」)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function fixture(tx: DbTx) {
    const { first } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    await wiring.picking.start({ batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` }, tx);
    const loose = await seedLooseBox(tx, first, 2);
    const [order] = await tx
      .select({ id: wmsTables.salesOrders.id, channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
      .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrderItems.salesOrderId))
      .where(eq(wmsTables.shipmentLines.shipmentId, loose.shipmentId));
    return { first, loose, wiring, order };
  }

  it('표시 주문번호·채널 주문번호·송장번호로 같은 박스를 찾는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, order } = await fixture(tx);
      const displayNo = `D${Date.now()}`;
      await tx.update(wmsTables.salesOrders).set({ displayOrderNo: displayNo }).where(eq(wmsTables.salesOrders.id, order.id));
      for (const code of [displayNo, order.channelOrderId, loose.trackingNo]) {
        const found = await wiring.batches.findJoinCandidates(first.batchId, code, tx);
        expect(found).toEqual([
          expect.objectContaining({
            shipmentId: loose.shipmentId,
            orderNos: [displayNo],
            totalQty: 2,
            issue: null,
            waybillIssue: null,
            waybill: expect.objectContaining({ trackingNo: loose.trackingNo, printable: false }),
          }),
        ]);
      }
    });
  });

  it('이미 배치에 있는 박스는 issue=SHIPMENT_ACTIVE_WORK_ITEM', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await fixture(tx);
      const [found] = await wiring.batches.findJoinCandidates(first.batchId, first.trackingNo, tx);
      expect(found).toMatchObject({ shipmentId: first.shipmentId, issue: 'SHIPMENT_ACTIVE_WORK_ITEM' });
    });
  });

  it('송장이 없으면 waybill=null 이고 막는 사유가 없다 — 앱이 발급한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring, order } = await fixture(tx);
      await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.id, loose.waybillId));
      const [found] = await wiring.batches.findJoinCandidates(first.batchId, order.channelOrderId, tx);
      expect(found).toMatchObject({ waybill: null, issue: null, waybillIssue: null });
    });
  });

  it('수령인이 바뀐 송장은 waybillIssue=WAYBILL_STALE', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, wiring } = await fixture(tx);
      await tx.update(wmsTables.waybills).set({ recipientHash: 'changed' }).where(eq(wmsTables.waybills.id, loose.waybillId));
      const [found] = await wiring.batches.findJoinCandidates(first.batchId, loose.trackingNo, tx);
      expect(found.waybillIssue).toBe('WAYBILL_STALE');
    });
  });

  it('다른 창고의 박스는 찾지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring } = await fixture(tx);
      const other = await seedPickableShipment(tx, 1);
      await expect(wiring.batches.findJoinCandidates(first.batchId, other.trackingNo, tx)).resolves.toEqual([]);
    });
  });
});
```

(`waybillIssue` 가 `WAYBILL_STALE` 이 아니라 다른 코드로 나오면 `assertDispatchable` 이 recipient 불일치에 내는 실제 접두어를 확인하고 테스트를 거기에 맞춘다 — `waybill.constants.ts` 의 `WAYBILL.ERROR`.)

- [ ] **Step 2: 실패를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- join-candidates`
Expected: FAIL — `findJoinCandidates is not a function`

- [ ] **Step 3: 구현한다**
  - `join-candidate.queries.ts`:

```ts
import { and, asc, eq, inArray, notInArray, or } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

/**
 * 현장이 부르는 번호로 박스를 찾는다 — 주문번호(표시 번호 `display_order_no` 또는 채널 주문 id)나 활성 송장 번호.
 * 송장 번호는 하이픈을 떼고도 맞춘다(종이의 4-4-4 표기). 잠그지 않는다 — 결과는 안내용이고 합류가 다시 잠가 판정한다.
 */
export async function findShipmentIdsByCode(trx: DbTx, warehouseId: string, code: string): Promise<string[]> {
  const trimmed = code.trim();
  const trackingCodes = [...new Set([trimmed, trimmed.replace(/-/g, '')])];
  const byOrder = trx
    .select({ id: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
    .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrderItems.salesOrderId))
    .where(or(eq(wmsTables.salesOrders.displayOrderNo, trimmed), eq(wmsTables.salesOrders.channelOrderId, trimmed)));
  const byTracking = trx
    .select({ id: wmsTables.waybills.shipmentId })
    .from(wmsTables.waybills)
    .where(and(inArray(wmsTables.waybills.trackingNo, trackingCodes), notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES])));
  const rows = await trx
    .select({ id: wmsTables.shipments.id })
    .from(wmsTables.shipments)
    .where(
      and(
        eq(wmsTables.shipments.warehouseId, warehouseId),
        or(inArray(wmsTables.shipments.id, byOrder), inArray(wmsTables.shipments.id, byTracking)),
      ),
    )
    .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id))
    .limit(20);
  return rows.map((row) => row.id);
}
```

  (`fulfillmentOrderItems.salesOrderId` 가 nullable 이면 조인은 그대로 둔다 — 없는 행은 안 걸린다. `waybills.shipmentId` 가 nullable 이라 `inArray(subquery)` 타입이 안 맞으면 서브쿼리에 `isNotNull(wmsTables.waybills.shipmentId)` 조건을 더하고 select 를 `sql<string>` 로 좁힌다.)
  - `shipment-waybill.reader.ts`: `function maskName` 과 `function readRecipientName` 앞에 `export`.
  - 오케스트레이터:

```ts
  /** 「이 배치에 넣기」의 찾기(스펙 §7). 조회 전용 — 판정은 합류 명령이 잠금 아래에서 다시 한다. */
  async findJoinCandidates(batchId: string, code: string, tx?: DbTx): Promise<JoinCandidateResponseDto[]> {
    return this.dbService.run(async (trx) => {
      const [batch] = await trx.select().from(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, batchId)).limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      const ids = await findShipmentIdsByCode(trx, batch.warehouseId, code);
      const result: JoinCandidateResponseDto[] = [];
      for (const shipmentId of ids) {
        const aggregate = await this.loadEligibilityAggregate(shipmentId, trx);
        const issue = await this.rejectionCode(() => this.assertJoinableBox(batch, aggregate, trx, false));
        const [waybill] = await trx
          .select()
          .from(wmsTables.waybills)
          .where(and(eq(wmsTables.waybills.shipmentId, shipmentId), notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES])))
          .limit(1);
        const waybillIssue = waybill
          ? await this.rejectionCode(async () => {
              await this.waybills.assertDispatchable(shipmentId, trx);
            })
          : null;
        const lines = await trx
          .select({ skuCode: wmsTables.skus.code, skuName: wmsTables.skus.name, qty: wmsTables.shipmentLines.qty })
          .from(wmsTables.shipmentLines)
          .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
          .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
          .orderBy(asc(wmsTables.shipmentLines.id));
        const orders = await trx
          .selectDistinct({ displayOrderNo: wmsTables.salesOrders.displayOrderNo, channelOrderId: wmsTables.salesOrders.channelOrderId })
          .from(wmsTables.shipmentLines)
          .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
          .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrderItems.salesOrderId))
          .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
        result.push({
          shipmentId,
          shipmentStatus: aggregate.shipment.status,
          manifestVersion: aggregate.shipment.manifestVersion,
          orderNos: [...new Set(orders.map((order) => order.displayOrderNo ?? order.channelOrderId))].sort(),
          recipientMasked: maskName(readRecipientName(aggregate.shipment.recipientSnapshot)),
          totalQty: lines.reduce((total, line) => total + line.qty, 0),
          lines,
          waybill: waybill
            ? {
                id: waybill.id,
                trackingNo: waybill.trackingNo,
                status: waybill.status,
                source: waybill.source,
                carrier: waybill.carrier,
                printable: isAppPrintable(waybill),
              }
            : null,
          issue,
          waybillIssue,
        });
      }
      return result;
    }, tx);
  }

  /** 거절이면 그 코드(Nest `response.code` 또는 `CODE:` 메시지 접두어), 통과면 null. 그 밖의 오류는 그대로 샌다. */
  private async rejectionCode(check: () => Promise<unknown>): Promise<string | null> {
    try {
      await check();
      return null;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof BadRequestException || error instanceof NotFoundException) {
        const body = error.getResponse();
        const code = typeof body === 'object' && body !== null && 'code' in body ? (body as { code: unknown }).code : null;
        return typeof code === 'string' ? code : error.message;
      }
      if (error instanceof ApplicationException) return /^([A-Z][A-Z_]+):/.exec(error.message)?.[1] ?? error.message;
      throw error;
    }
  }
```

  (`body as { code: unknown }` 는 `'code' in body` 로 좁힌 뒤의 읽기다 — 주석 한 줄로 근거를 단다. `loadEligibilityAggregate` 는 줄 없는 박스에서 404 를 던진다 — 그런 박스는 `rejectionCode` 로 감싸 건너뛰지 말고 목록에서 뺀다: `ids` 루프 첫 줄을 try/catch(NotFoundException → continue) 로.)
  - 컨트롤러:

```ts
  @Get('outbound-batches/:batchId/join-candidates')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: [JoinCandidateResponseDto] })
  findJoinCandidates(@Param('batchId') batchId: string, @Query('code') code: string | undefined) {
    if (!code?.trim()) throw new BadRequestException('code is required');
    return this.batches.findJoinCandidates(batchId, code);
  }
```

  (컨트롤러 스펙에 «code 가 비면 400» 한 건을 더한다. 라우트·스코프를 열거하는 권한 스펙(`outbound-v2-authorization.spec.ts`·`scripts/security`)이 새 라우트를 요구하면 목록에 더한다.)

- [ ] **Step 4: 통과를 확인한다**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- join-candidates` 그리고 `npx jest apps/core/src/modules/fulfillment scripts/security --maxWorkers=2`, `npm run type-check`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(fulfillment): 주문번호·송장번호로 합류 후보 박스를 찾는 조회 (#988)"
```

---

### Task 9: 앱 — 새 거절 코드와 문구

**Files:**
- Modify: `native/warehouse-app/src/core/data/httpClient.ts` (확정 거절 목록)
- Modify: `native/warehouse-app/src/core/data/errorMessage.ts` (`OUTBOUND_CONFLICT_MESSAGES`)
- Test: `native/warehouse-app/src/core/data/httpClient.test.ts`, `errorMessage.test.ts`

**Interfaces:**
- Produces: 아래 코드의 409 는 `outcome === 'rejected'`(재시도 대상 아님), `errorMessage(error, 'outbound')` 는 아래 문구

| 코드 | 문구 |
| --- | --- |
| `BATCH_NOT_JOINABLE` | `이 배치에는 더 넣을 수 없어요(끝났거나 멈춘 배치). 다른 배치를 골라 주세요.` |
| `BOX_HAS_PICKED_ITEMS` | `이미 상품을 담은 박스라 지금은 뺄 수 없어요. 관리자에게 문의해 주세요.` |
| `SHIPMENT_ACTIVE_WORK_ITEM` | `이미 다른 배치에 들어 있는 박스예요.` |
| `OUTBOUND_BATCH_CART_CAPACITY_EXCEEDED` | `이 배치의 카트 바구니가 다 찼어요.` |
| `WORK_ITEM_TOTE_RELEASE_REQUIRED` | `바구니 배정을 먼저 풀어야 뺄 수 있어요. 관리자에게 문의해 주세요.` |
| `WORK_ITEM_DISPATCH_EXISTS` | `이미 출고 처리된 박스라 뺄 수 없어요.` |
| `WORK_ITEM_ALLOCATED` | `결품 처리 중인 박스예요. 관리자에게 문의해 주세요.` |

(`BATCH_JOIN_BLOCKED` 는 목록에만 넣는다 — 화면은 `errors` 를 사유별로 묶어 보여 준다(Task 10).)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `httpClient.test.ts` 에 기존 `BATCH_START_BLOCKED` 확정 거절 테스트와 같은 모양으로 `it.each([...위 7개, 'BATCH_JOIN_BLOCKED'])('%s 409 는 확정 거절', …)`, `errorMessage.test.ts` 에 `it.each(표)('%s 문구', (code, text) => expect(errorMessage(new ConflictError('m', code), 'outbound')).toBe(text))`.

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/core/data`
Expected: FAIL

- [ ] **Step 3: 구현한다** — `httpClient.ts` 의 `rejected` 배열 끝(`'WAYBILL_LABEL_NOT_ALLOCATED',` 뒤)에 8개 코드, `errorMessage.ts` 의 `OUTBOUND_CONFLICT_MESSAGES` 끝에 7개 문구.

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/core/data && npx tsc -b`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/core/data
git commit -m "feat(warehouse-app): 합류·이탈 거절 코드를 확정 거절로 받고 현장 문구를 단다 (#988)"
```

---

### Task 10: 앱 — 「박스 넣기」: 찾기 → 송장 발급 → 합류 → 출력

**Files:**
- Modify: `native/warehouse-app/src/domains/outbound/batchStart.ts` (차단 묶기를 문구 표 인자로)
- Create: `native/warehouse-app/src/domains/outbound/batchJoin.ts`, `batchJoin.test.ts`
- Create: `native/warehouse-app/src/domains/outbound/JoinBoxPanel.tsx`, `JoinBoxPanel.test.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx` (시작된 배치 카드에 버튼, 스캔 경로)

**Interfaces:**
- Consumes: `printOneLabel`·`fetchWaybillLabel`·`confirmLabelPrinted`·`labelErrorMessage`(`waybillLabel.ts`), `readLabelPrinter`·`PrintRaw`(`labelPrinter`), `StartBlocker`·`BlockerGroup`(`batchStart.ts`), `errorMessage`, core `GET outbound-batches/:batchId/join-candidates?code=`, `POST shipments/:id/waybills`, `POST outbound-batches/:batchId/shipments/:shipmentId`
- Produces:
  - `batchStart.ts`: `export type BlockerText = Record<StartBlockReason, { title: string; guidance: string }>`, `export function groupBlockers(blockers, text: BlockerText): BlockerGroup[]`, `export function blockersOf(error: unknown, code: string): StartBlocker[] | null` — `groupStartBlockers`·`startBlockersOf` 는 이것들에 위임(동작 불변)
  - `batchJoin.ts`: `JoinCandidate`(core DTO 모양), `fetchJoinCandidates(api, batchId, code)`, `JoinOutcome`, `joinBoxIntoBatch(deps, batchId, candidate): Promise<JoinOutcome>`, `JOIN_BLOCKER_TEXT`
  - `JoinBoxPanel({ batchId, prefs?, print?, labelPrinting, onClose })`

- [ ] **Step 1: `batchStart.ts` 를 일반화한다** — `GROUP_TEXT` 를 `const START_BLOCKER_TEXT: BlockerText = …` 로 이름 바꾸고:

```ts
export type BlockerText = Record<StartBlockReason, { title: string; guidance: string }>;

/** 409 본문의 errors 가 차단 목록이면 그 목록, 아니면 null. 시작(BATCH_START_BLOCKED)·합류(BATCH_JOIN_BLOCKED) 공용. */
export function blockersOf(error: unknown, code: string): StartBlocker[] | null {
  if (!(error instanceof ConflictError) || error.code !== code || !Array.isArray(error.errors)) return null;
  return error.errors.filter(isBlocker);
}

export function startBlockersOf(error: unknown): StartBlocker[] | null {
  return blockersOf(error, 'BATCH_START_BLOCKED');
}

export function groupBlockers(blockers: readonly StartBlocker[], text: BlockerText): BlockerGroup[] {
  return REASONS.flatMap((reason) => {
    const rows = blockers.filter((b) => b.reason === reason).map(rowOf);
    return rows.length ? [{ reason, ...text[reason], rows }] : [];
  });
}

/** 사유별로 묶는다(스펙 §6 «앱은 사유별로 묶어 안내한다»). 순서는 적치 대기 → 재고 부족 → 송장. */
export function groupStartBlockers(blockers: readonly StartBlocker[]): BlockerGroup[] {
  return groupBlockers(blockers, START_BLOCKER_TEXT);
}
```

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/batchStart.test.ts src/domains/outbound/StartBatchButton.test.tsx` → PASS(동작 불변)

- [ ] **Step 2: 순수 흐름의 실패하는 테스트를 쓴다** — `batchJoin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import { joinBoxIntoBatch, type JoinCandidate } from './batchJoin';

const candidate = (over: Partial<JoinCandidate> = {}): JoinCandidate => ({
  shipmentId: 's-1',
  shipmentStatus: 'planned',
  manifestVersion: 3,
  orderNos: ['3900'],
  recipientMasked: '홍**',
  totalQty: 2,
  lines: [{ skuCode: 'K', skuName: '볼펜', qty: 2 }],
  waybill: null,
  issue: null,
  waybillIssue: null,
  ...over,
});

function fakeApi(handler: (o: { method?: string; path: string; body?: unknown }) => unknown) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api: ApiClient = {
    request: (async (o: { method?: string; path: string; body?: unknown }) => {
      calls.push({ method: o.method ?? 'GET', path: o.path, body: o.body });
      return handler(o);
    }) as ApiClient['request'],
  };
  return { api, calls };
}
const label = { waybillId: 'w', format: 'zpl', data: 'ZPL', fingerprint: 'fp', revision: 1, trackingNo: '452716978431', pages: 1 };

describe('joinBoxIntoBatch', () => {
  it('송장이 없으면 HANJIN 으로 발급 → 합류 → 출력·출력 확인', async () => {
    const printed: string[] = [];
    const { api, calls } = fakeApi((o) => {
      if (o.path === '/shipments/s-1/waybills') return { status: 'registered', source: 'carrier', carrier: 'HANJIN', trackingNo: '452716978431' };
      if (o.path.endsWith('/waybill/label')) return label;
      return {};
    });
    const outcome = await joinBoxIntoBatch(
      { api, print: async (_t, data) => void printed.push(data), printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate(),
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /shipments/s-1/waybills',
      'POST /outbound-batches/b-1/shipments/s-1',
      'GET /shipments/s-1/waybill/label',
      'POST /shipments/s-1/waybill/label-prints',
    ]);
    expect(calls[0].body).toEqual({ carrier: 'HANJIN', expectedManifestVersion: 3 });
    expect(printed).toEqual(['ZPL']);
    expect(outcome).toMatchObject({ kind: 'joined', print: 'printed', shipmentId: 's-1' });
  });

  it('발급이 registered 가 아니면 합류하지 않는다', async () => {
    const { api, calls } = fakeApi(() => ({ status: 'pending', source: 'carrier', carrier: 'HANJIN', trackingNo: null }));
    const outcome = await joinBoxIntoBatch({ api, print: async () => {}, printer: 'ZD', newKey: () => 'k' }, 'b-1', candidate());
    expect(outcome.kind).toBe('blocked');
    expect(calls).toHaveLength(1);
  });

  it('후보에 막는 사유가 있으면 아무 요청도 보내지 않는다', async () => {
    const { api, calls } = fakeApi(() => ({}));
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate({ issue: 'SHIPMENT_ACTIVE_WORK_ITEM' }),
    );
    expect(outcome).toEqual({ kind: 'blocked', message: '이미 다른 배치에 들어 있는 박스예요.' });
    expect(calls).toEqual([]);
  });

  it('합류가 막히면 사유별 묶음을 돌려준다', async () => {
    const { api } = fakeApi((o) => {
      if (o.path.startsWith('/outbound-batches/')) {
        throw new ConflictError('m', 'BATCH_JOIN_BLOCKED', undefined, [
          { shipmentId: 's-1', reason: 'STOCK_SHORT', shipmentLineId: 'l', skuId: 'k', requiredQty: 2, shortQty: 1, detail: null, trackingNo: null, skuCode: 'K', skuName: '볼펜' },
        ]);
      }
      return {};
    });
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate({ waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'carrier', carrier: 'HANJIN', printable: true } }),
    );
    expect(outcome).toMatchObject({ kind: 'join_blocked', groups: [{ reason: 'STOCK_SHORT' }] });
  });

  it('수기 송장이면 합류하고 출력하지 않는다', async () => {
    const { api, calls } = fakeApi(() => ({}));
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate({ waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'manual', carrier: 'HANJIN', printable: false } }),
    );
    expect(outcome).toMatchObject({ kind: 'joined', print: 'external' });
    expect(calls.map((c) => c.path)).toEqual(['/outbound-batches/b-1/shipments/s-1']);
  });

  it('프린터가 없으면 합류만 하고 «프린터 있는 자리에서» 를 안내한다', async () => {
    const { api } = fakeApi(() => ({}));
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: null, newKey: () => 'k' },
      'b-1',
      candidate({ waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'carrier', carrier: 'HANJIN', printable: true } }),
    );
    expect(outcome).toMatchObject({ kind: 'joined', print: 'no_printer' });
  });
});
```

(`fetchWaybillLabel`·`confirmLabelPrinted` 의 실제 경로는 `waybillLabel.ts` 를 확인해 기대 경로를 맞춘다 — PR 1 의 `GET shipments/:id/waybill/label`, `POST shipments/:id/waybill/label-prints`.)

- [ ] **Step 3: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/batchJoin.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: 구현한다** — `batchJoin.ts`:

```ts
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import { errorMessage, WAYBILL_NOT_DISPATCHABLE_MESSAGE, WAYBILL_STALE_MESSAGE } from '../../core/data/errorMessage';
import type { PrintRaw } from '../../core/hardware/print/labelPrinter';
import { blockersOf, groupBlockers, type BlockerGroup, type BlockerText } from './batchStart';
import { confirmLabelPrinted, fetchWaybillLabel, labelErrorMessage, printOneLabel } from './waybillLabel';

/** core `JoinCandidateResponseDto` 와 같은 모양(dto/outbound-batch-v2.dto.ts). */
export interface JoinCandidate {
  shipmentId: string;
  shipmentStatus: string;
  manifestVersion: number;
  orderNos: string[];
  recipientMasked: string;
  totalQty: number;
  lines: Array<{ skuCode: string; skuName: string; qty: number }>;
  waybill: { id: string; trackingNo: string | null; status: string; source: string; carrier: string; printable: boolean } | null;
  issue: string | null;
  waybillIssue: string | null;
}

export function fetchJoinCandidates(api: ApiClient, batchId: string, code: string): Promise<JoinCandidate[]> {
  const qs = new URLSearchParams({ code: code.trim() });
  return api.request<JoinCandidate[]>({ path: `/outbound-batches/${batchId}/join-candidates?${qs.toString()}` });
}

export const JOIN_BLOCKER_TEXT: BlockerText = {
  INBOUND_PENDING: { title: '적치 대기 중인 상품', guidance: '적치를 끝낸 뒤 다시 넣어 주세요.' },
  STOCK_SHORT: { title: '재고 부족', guidance: '재고가 모자라 이 배치에 넣을 수 없어요. 관리자에게 문의해 주세요.' },
  WAYBILL_NOT_READY: { title: '송장 재발급 필요', guidance: '관리자에게 송장 재발급을 요청한 뒤 다시 넣어 주세요.' },
};

const ISSUE_TEXT: Record<string, string> = {
  SHIPMENT_ACTIVE_WORK_ITEM: '이미 다른 배치에 들어 있는 박스예요.',
  SHIPMENT_NOT_PLANNED: '출고 계획이 끝나지 않았거나 이미 출고된 박스예요.',
  SHIPMENT_NOT_FULLY_RESERVED: '재고 예약이 끝나지 않은 박스예요. 관리자에게 문의해 주세요.',
  SHIPMENT_NOT_FULLY_RESERVED_PHYSICAL: '재고 예약이 끝나지 않은 박스예요. 관리자에게 문의해 주세요.',
  SHIPMENT_DISPATCH_EXISTS: '이미 출고 처리된 박스예요.',
};
const WAYBILL_ISSUE_TEXT: Record<string, string> = {
  WAYBILL_STALE: WAYBILL_STALE_MESSAGE,
  WAYBILL_NOT_DISPATCHABLE: WAYBILL_NOT_DISPATCHABLE_MESSAGE,
};

export type JoinOutcome =
  | { kind: 'blocked'; message: string }
  | { kind: 'join_blocked'; groups: BlockerGroup[] }
  | {
      kind: 'joined';
      shipmentId: string;
      print: 'printed' | 'external' | 'no_printer' | 'failed';
      message: string;
    };

export interface JoinDeps {
  api: ApiClient;
  print: PrintRaw;
  /** 이 기기의 송장 프린터. 없거나 출력 기능이 꺼진 기기면 null. */
  printer: string | null;
  newKey: () => string;
}

/**
 * 「이 배치에 넣기」 한 동작(스펙 §7, E9): 송장이 없으면 한진으로 발급 → 합류 → 출력. 출력은 합류가 성공한 뒤에만 한다 —
 * 합류 전의 종이는 로케이션이 없다(I4). 발급된 송장은 합류가 막혀도 그대로 남아 다음 시도에 쓰인다.
 */
export async function joinBoxIntoBatch(deps: JoinDeps, batchId: string, candidate: JoinCandidate): Promise<JoinOutcome> {
  if (candidate.issue) {
    return { kind: 'blocked', message: ISSUE_TEXT[candidate.issue] ?? `이 박스는 넣을 수 없어요 — 관리자에게 문의해 주세요 (${candidate.issue})` };
  }
  if (candidate.waybill && candidate.waybillIssue) {
    return {
      kind: 'blocked',
      message: WAYBILL_ISSUE_TEXT[candidate.waybillIssue] ?? '송장을 쓸 수 없는 상태예요. 관리자에게 송장 상태를 확인해 달라고 해 주세요.',
    };
  }
  let printable = candidate.waybill?.printable ?? false;
  if (!candidate.waybill) {
    try {
      const issued = await deps.api.request<{ status: string; source: string; carrier: string }>({
        method: 'POST',
        path: `/shipments/${candidate.shipmentId}/waybills`,
        body: { carrier: 'HANJIN', expectedManifestVersion: candidate.manifestVersion },
        idempotencyKey: deps.newKey(),
      });
      if (issued.status !== 'registered') {
        return { kind: 'blocked', message: '송장 발급이 끝나지 않았어요(한진 응답 대기·실패). 잠시 뒤 다시 시도하거나 관리자에게 문의해 주세요.' };
      }
      printable = issued.source === 'carrier' && issued.carrier === 'HANJIN';
    } catch (error) {
      return { kind: 'blocked', message: errorMessage(error, 'outbound') };
    }
  }
  try {
    await deps.api.request({
      method: 'POST',
      path: `/outbound-batches/${batchId}/shipments/${candidate.shipmentId}`,
      idempotencyKey: deps.newKey(),
    });
  } catch (error) {
    const blockers = blockersOf(error, 'BATCH_JOIN_BLOCKED');
    if (blockers) return { kind: 'join_blocked', groups: groupBlockers(blockers, JOIN_BLOCKER_TEXT) };
    return { kind: 'blocked', message: errorMessage(error, 'outbound') };
  }
  const joined = { kind: 'joined' as const, shipmentId: candidate.shipmentId };
  if (!printable) return { ...joined, print: 'external', message: '배치에 넣었어요. 수기 송장 박스라 출력 없이 진행해요.' };
  if (!deps.printer) {
    return {
      ...joined,
      print: 'no_printer',
      message: '배치에 넣었어요. 이 PC 에는 송장 프린터가 없어요 — 프린터 있는 자리에서 송장을 출력해야 피킹할 수 있어요.',
    };
  }
  try {
    const label = await printOneLabel(
      {
        fetchLabel: (id) => fetchWaybillLabel(deps.api, id),
        confirm: (id, fingerprint) => confirmLabelPrinted(deps.api, id, fingerprint),
        print: deps.print,
        target: deps.printer,
      },
      candidate.shipmentId,
    );
    return { ...joined, print: 'printed', message: `배치에 넣고 송장을 출력했어요 (${label.trackingNo}). 이 송장으로 작업하세요.` };
  } catch (error) {
    return { ...joined, print: 'failed', message: `배치에 넣었어요. 송장 출력은 실패했어요: ${labelErrorMessage(error)} 아래에서 다시 출력해 주세요.` };
  }
}
```

(`ConflictError` import 는 쓰지 않으면 지운다.)

- [ ] **Step 5: 패널을 만든다** — `JoinBoxPanel.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { localStoragePrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { errorMessage } from '../../core/data/errorMessage';
import { Button } from '../../core/design/Button';
import { printRaw, readLabelPrinter, type PrintRaw } from '../../core/hardware/print/labelPrinter';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { fetchJoinCandidates, joinBoxIntoBatch, type JoinCandidate, type JoinOutcome } from './batchJoin';
import { ReprintLabelButton } from './ReprintLabelButton';

const NOT_FOUND = '이 번호로 넣을 수 있는 박스를 찾지 못했어요. 이 창고의 출고 대상인지 확인해 주세요.';

/** 시작된 배치에 급한 박스를 넣는다(스펙 §7). 주문번호·송장번호 입력이나 스캔 → 찾기 → (여럿이면 고르기) → 넣기·출력. */
export function JoinBoxPanel({
  batchId,
  prefs = localStoragePrefs,
  print = printRaw,
  labelPrinting,
  onClose,
}: {
  batchId: string;
  prefs?: DevicePrefs;
  print?: PrintRaw;
  labelPrinting: boolean;
  onClose: () => void;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [candidates, setCandidates] = useState<JoinCandidate[] | null>(null);
  const [outcome, setOutcome] = useState<JoinOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // state 는 다음 렌더에야 보인다 — 같은 틱의 연타로 같은 박스를 두 번 넣거나 송장을 두 장 뽑지 않게 ref 로 막는다.
  const running = useRef(false);

  const guarded = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  const runJoin = async (candidate: JoinCandidate) => {
    const result = await joinBoxIntoBatch(
      {
        api,
        print,
        printer: labelPrinting ? readLabelPrinter(prefs) : null,
        newKey: () => crypto.randomUUID(),
      },
      batchId,
      candidate,
    );
    setOutcome(result);
    setCandidates(null);
    if (result.kind === 'joined') {
      await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
      await queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
    }
  };

  const join = (candidate: JoinCandidate) => guarded(() => runJoin(candidate));

  const find = (value: string) =>
    guarded(async () => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setOutcome(null);
      setNotice(null);
      setCandidates(null);
      try {
        const found = await fetchJoinCandidates(api, batchId, trimmed);
        if (found.length === 0) setNotice(NOT_FOUND);
        else if (found.length > 1) setCandidates(found);
        else await runJoin(found[0]);
      } catch (error) {
        setNotice(errorMessage(error, 'outbound'));
      }
    });

  useScanner((event) => void find(event.code));

  return (
    <section className="space-y-2 rounded border border-blue-300 px-3 py-2">
      <p className="font-medium">이 배치에 박스 넣기</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find(code);
        }}
      >
        <input
          className="flex-1 rounded border px-3 py-2"
          aria-label="주문번호 또는 송장번호"
          placeholder="주문번호 또는 송장번호"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          찾기
        </Button>
      </form>
      {notice !== null && <p role="alert">{notice}</p>}
      {candidates !== null && (
        <ul className="space-y-1">
          {candidates.map((candidate) => (
            <li key={candidate.shipmentId} className="rounded border px-2 py-1">
              <p className="text-sm">
                주문 {candidate.orderNos.join(', ')} · {candidate.recipientMasked} · {candidate.totalQty}개
              </p>
              <p className="text-xs text-neutral-500">
                {candidate.lines.map((line) => `${line.skuName} ${line.qty}`).join(', ')}
              </p>
              <Button type="button" disabled={busy} onClick={() => void join(candidate)}>
                이 박스 넣기
              </Button>
            </li>
          ))}
        </ul>
      )}
      {outcome?.kind === 'blocked' && <p role="alert">{outcome.message}</p>}
      {outcome?.kind === 'join_blocked' && (
        <div role="alert" className="space-y-1">
          <p className="font-medium">넣지 못했어요 — 아래 사유를 먼저 처리해 주세요</p>
          {outcome.groups.map((group) => (
            <div key={group.reason}>
              <p className="text-sm font-medium">{group.title}</p>
              <ul className="text-sm">
                {group.rows.map((row, index) => (
                  <li key={`${index}-${row}`}>{row}</li>
                ))}
              </ul>
              <p className="text-sm text-neutral-500">{group.guidance}</p>
            </div>
          ))}
        </div>
      )}
      {outcome?.kind === 'joined' && (
        <div className="space-y-1">
          <p role="status">{outcome.message}</p>
          {labelPrinting && (outcome.print === 'failed' || outcome.print === 'no_printer') && (
            <ReprintLabelButton shipmentId={outcome.shipmentId} prefs={prefs} print={print} />
          )}
        </div>
      )}
      <Button type="button" className="border border-gray-300 bg-white text-gray-700" onClick={onClose}>
        닫기
      </Button>
    </section>
  );
}
```

  `JoinBoxPanel.test.tsx`(StartBatchButton.test.tsx 의 `mount` 래퍼를 그대로 쓰고 `render(<JoinBoxPanel batchId="b-1" labelPrinting={false} onClose={() => {}} />)`):

```tsx
describe('JoinBoxPanel', () => {
  const candidate = {
    shipmentId: 's-1', shipmentStatus: 'planned', manifestVersion: 1, orderNos: ['3900'], recipientMasked: '홍**',
    totalQty: 2, lines: [{ skuCode: 'K', skuName: '볼펜', qty: 2 }], issue: null, waybillIssue: null,
    waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'manual', carrier: 'HANJIN', printable: false },
  };

  it('후보가 하나면 바로 넣고 결과 문구를 보여 준다', async () => {
    const calls: string[] = [];
    const { user } = mount({
      request: async (o) => {
        calls.push(o.path);
        return o.path.includes('join-candidates') ? [candidate] : {};
      },
    });
    await user.type(screen.getByLabelText('주문번호 또는 송장번호'), '3900');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByRole('status')).toHaveTextContent('배치에 넣었어요');
    expect(calls).toEqual(['/outbound-batches/b-1/join-candidates?code=3900', '/outbound-batches/b-1/shipments/s-1']);
  });

  it('후보가 없으면 안내한다', async () => {
    const { user } = mount({ request: async () => [] });
    await user.type(screen.getByLabelText('주문번호 또는 송장번호'), 'X');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('찾지 못했어요');
  });

  it('후보가 여럿이면 고른 박스만 넣는다', async () => {
    const calls: string[] = [];
    const { user } = mount({
      request: async (o) => {
        calls.push(o.path);
        return o.path.includes('join-candidates') ? [candidate, { ...candidate, shipmentId: 's-2', recipientMasked: '김**' }] : {};
      },
    });
    await user.type(screen.getByLabelText('주문번호 또는 송장번호'), '3900');
    await user.click(screen.getByRole('button', { name: '찾기' }));
    const buttons = await screen.findAllByRole('button', { name: '이 박스 넣기' });
    await user.click(buttons[1]);
    await screen.findByRole('status');
    expect(calls.at(-1)).toBe('/outbound-batches/b-1/shipments/s-2');
  });
});
```

  (`mount` 는 StartBatchButton.test.tsx 의 것을 이 파일에 복사하되 렌더 대상만 바꾼다. 스캔 버스를 쓰는 `useScanner` 가 테스트 래퍼에 `ScanProvider` 를 요구하면 `OutboundQueueScreen.test.tsx` 의 래퍼를 따른다.)
  - `OutboundQueueScreen.tsx`:
    - 상태 `const [panel, setPanel] = useState<{ kind: 'join' | 'remove'; batchId: string } | null>(null);` 와 `const panelOpen = useRef(false); panelOpen.current = panel !== null;`
    - 화면 스캐너를 `useScanner((event) => { if (panelOpen.current) return; void open(event.code); });` 로 — 패널이 열려 있으면 패널의 스캐너만 받는다.
    - 시작된 배치 카드(`batch.startedAt !== null`)에 `BatchLabelPrintButton` 옆으로 「박스 넣기」 버튼(`onClick={() => setPanel({ kind: 'join', batchId: batch.id })}`), 그 카드 아래 `panel?.kind === 'join' && panel.batchId === batch.id` 이면 `<JoinBoxPanel batchId={batch.id} prefs={prefs} print={print} labelPrinting={labelPrinting} onClose={() => setPanel(null)} />`. (「박스 빼기」 는 Task 11.)
  - `OutboundQueueScreen.test.tsx` 에 한 건: 시작된 배치 카드에 「박스 넣기」가 보이고 시작 전 카드에는 없다. 패널이 열린 동안 스캔은 박스 열기(`by-waybill`)로 가지 않는다.

- [ ] **Step 6: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound && npx tsc -b && npx oxlint`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound
git commit -m "feat(warehouse-app): 시작된 배치에 「박스 넣기」 — 찾기·송장 발급·합류·출력을 한 동작으로 (#988)"
```

---

### Task 11: 앱 — 「박스 빼기」

**Files:**
- Create: `native/warehouse-app/src/domains/outbound/batchRemove.ts`, `batchRemove.test.ts`
- Create: `native/warehouse-app/src/domains/outbound/RemoveBoxPanel.tsx`, `RemoveBoxPanel.test.tsx`
- Modify: `native/warehouse-app/src/domains/outbound/OutboundQueueScreen.tsx`

**Interfaces:**
- Consumes: core `GET shipments/by-waybill?trackingNo=&warehouseId=`(`ShipmentByWaybill`), `DELETE outbound-batches/:batchId/shipments/:shipmentId { reason }`
- Produces: `removeBoxFromBatch(deps: { api: ApiClient; newKey: () => string }, input: { batchId: string; warehouseId: string; trackingNo: string; reason: string }): Promise<RemoveOutcome>`, `RemoveOutcome = { kind: 'removed' | 'blocked'; message: string }`, `RemoveBoxPanel({ batchId, onClose })`

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `batchRemove.test.ts`(Task 10 의 `fakeApi` 모양):

```ts
describe('removeBoxFromBatch', () => {
  const found = (over: Partial<ShipmentByWaybill> = {}) => ({
    shipmentId: 's-1', batchId: 'b-1', workItemId: 'wi-1', warehouseId: 'wh', trackingNo: '1', carrier: 'HANJIN',
    waybillStatus: 'registered', shipmentStatus: 'planned', workItemStatus: 'queued', recipientMasked: '', lines: [],
    labelState: 'current', labelChanges: [], labelIssue: null, ...over,
  });

  it('송장번호로 박스를 찾아 사유와 함께 뺀다', async () => {
    const { api, calls } = fakeApi((o) => (o.path.startsWith('/shipments/by-waybill') ? found() : {}));
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: '고객 요청' });
    expect(calls[1]).toEqual({ method: 'DELETE', path: '/outbound-batches/b-1/shipments/s-1', body: { reason: '고객 요청' } });
    expect(outcome).toEqual({ kind: 'removed', message: '박스를 뺐어요. 이 박스의 송장은 버려 주세요.' });
  });

  it('다른 배치의 박스면 보내지 않는다', async () => {
    const { api, calls } = fakeApi(() => found({ batchId: 'b-2' }));
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({ kind: 'blocked', message: '이 배치에 있는 박스가 아니에요.' });
    expect(calls).toHaveLength(1);
  });

  it('집은 몫이 있으면 거절 문구', async () => {
    const { api } = fakeApi((o) => {
      if (o.method === 'DELETE') throw new ConflictError('m', 'BOX_HAS_PICKED_ITEMS');
      return found();
    });
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({ kind: 'blocked', message: '이미 상품을 담은 박스라 지금은 뺄 수 없어요. 관리자에게 문의해 주세요.' });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound/batchRemove.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현한다** — `batchRemove.ts`:

```ts
import type { ApiClient } from '../../core/data/httpClient';
import { errorMessage } from '../../core/data/errorMessage';
import type { ShipmentByWaybill } from './types';

export type RemoveOutcome = { kind: 'removed' | 'blocked'; message: string };

/**
 * 「박스 빼기」(스펙 §8, PR 2 = 집기 전만). 시작된 배치의 박스는 송장이 늘 있으므로 송장번호로 찾는다.
 * 서버가 집은 몫을 확인한다 — 앱은 거절 문구만 보여 준다.
 */
export async function removeBoxFromBatch(
  deps: { api: ApiClient; newKey: () => string },
  input: { batchId: string; warehouseId: string; trackingNo: string; reason: string },
): Promise<RemoveOutcome> {
  try {
    const qs = new URLSearchParams({ trackingNo: input.trackingNo.trim(), warehouseId: input.warehouseId });
    const found = await deps.api.request<ShipmentByWaybill>({ path: `/shipments/by-waybill?${qs.toString()}` });
    if (found.batchId !== input.batchId || !found.workItemId) return { kind: 'blocked', message: '이 배치에 있는 박스가 아니에요.' };
    await deps.api.request({
      method: 'DELETE',
      path: `/outbound-batches/${input.batchId}/shipments/${found.shipmentId}`,
      body: { reason: input.reason.trim() },
      idempotencyKey: deps.newKey(),
    });
    return { kind: 'removed', message: '박스를 뺐어요. 이 박스의 송장은 버려 주세요.' };
  } catch (error) {
    return { kind: 'blocked', message: errorMessage(error, 'outbound') };
  }
}
```

  `RemoveBoxPanel.tsx`:

```tsx
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWarehouse } from '../../app/warehouse-context';
import { useApiClient } from '../../core/data/ApiClientProvider';
import { Button } from '../../core/design/Button';
import { useScanner } from '../../core/hardware/scan/useScanner';
import { removeBoxFromBatch, type RemoveOutcome } from './batchRemove';

/** 시작된 배치에서 집기 전 박스를 뺀다(스펙 §8, PR 2). 송장번호(스캔 가능)와 사유가 둘 다 있어야 보낸다. */
export function RemoveBoxPanel({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { warehouseId } = useWarehouse();
  const [trackingNo, setTrackingNo] = useState('');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<RemoveOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  useScanner((event) => setTrackingNo(event.code));

  const submit = async () => {
    if (running.current || !warehouseId || !trackingNo.trim() || !reason.trim()) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await removeBoxFromBatch(
        { api, newKey: () => crypto.randomUUID() },
        { batchId, warehouseId, trackingNo, reason },
      );
      setOutcome(result);
      if (result.kind === 'removed') {
        setTrackingNo('');
        await queryClient.invalidateQueries({ queryKey: ['outbound-batches'] });
        await queryClient.invalidateQueries({ queryKey: ['waybill-label-states'] });
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded border border-amber-300 px-3 py-2">
      <p className="font-medium">이 배치에서 박스 빼기</p>
      <p className="text-sm text-neutral-500">아직 상품을 담지 않은 박스만 뺄 수 있어요.</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="w-full rounded border px-3 py-2"
          aria-label="송장번호"
          placeholder="송장번호 (스캔)"
          value={trackingNo}
          onChange={(e) => setTrackingNo(e.target.value)}
        />
        <input
          className="w-full rounded border px-3 py-2"
          aria-label="빼는 이유"
          placeholder="예: 고객 요청, 급한 변경"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" disabled={busy || !trackingNo.trim() || !reason.trim()}>
          빼기
        </Button>
      </form>
      {outcome && <p role={outcome.kind === 'removed' ? 'status' : 'alert'}>{outcome.message}</p>}
      <Button type="button" className="border border-gray-300 bg-white text-gray-700" onClick={onClose}>
        닫기
      </Button>
    </section>
  );
}
```

  `OutboundQueueScreen.tsx`: 시작된 배치 카드에 「박스 빼기」(`onClick={() => setPanel({ kind: 'remove', batchId: batch.id })}`)와 `panel?.kind === 'remove' && panel.batchId === batch.id` 일 때 `<RemoveBoxPanel batchId={batch.id} onClose={() => setPanel(null)} />`.
  `RemoveBoxPanel.test.tsx`(`JoinBoxPanel.test.tsx` 의 `mount` + 창고 컨텍스트 `wh`):

```tsx
describe('RemoveBoxPanel', () => {
  it('사유가 비면 「빼기」가 꺼져 있고, 채우면 DELETE 를 보내 성공 문구를 보인다', async () => {
    const calls: Array<{ method?: string; path: string }> = [];
    const { user } = mount({
      request: async (o) => {
        calls.push({ method: o.method, path: o.path });
        return o.path.startsWith('/shipments/by-waybill') ? { shipmentId: 's-1', batchId: 'b-1', workItemId: 'wi' } : {};
      },
    });
    await user.type(screen.getByLabelText('송장번호'), '452716978431');
    expect(screen.getByRole('button', { name: '빼기' })).toBeDisabled();
    await user.type(screen.getByLabelText('빼는 이유'), '고객 요청');
    await user.click(screen.getByRole('button', { name: '빼기' }));
    expect(await screen.findByRole('status')).toHaveTextContent('박스를 뺐어요');
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: '/outbound-batches/b-1/shipments/s-1' });
  });
});
```

  (창고 선택은 `useWarehouse()` 가 읽는 컨텍스트다 — `OutboundQueueScreen.test.tsx` 가 창고를 심는 방식(프로바이더 또는 prefs)을 그대로 따른다.)

- [ ] **Step 4: 통과를 확인한다**

Run: `cd native/warehouse-app && npx vitest run src/domains/outbound && npx tsc -b && npx oxlint`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add native/warehouse-app/src/domains/outbound
git commit -m "feat(warehouse-app): 시작된 배치에서 「박스 빼기」 — 송장번호와 사유로 집기 전 박스를 뺀다 (#988)"
```

---

### Task 12: 마무리 — 게이트, 스펙 반영, 스모크 체크리스트, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md` — **진행 상태는 적지 않는다**(스펙 §0). Global Constraints 의 «이 계획이 정한 것» 1~11 을 본문 해당 절에 «PR 2 계획이 정함» 으로 넣는다
- Modify: `apps/core/src/modules/fulfillment/waybill/README.md` 는 건드리지 않는다(송장 쪽 변경 없음)

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest --maxWorkers=2
npx jest scripts/security
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local
cd native/warehouse-app && npx tsc -b && npx vitest run && npx oxlint
```

Expected: type-check 0, jest 실패 0, 통합 실패 0(develop 부터 붉던 스위트는 develop 워크트리에서 같은 명령으로 대조해 «이 PR 이 만든 것 아님» 을 PR 본문에 목록으로), 앱 전부 초록.

- [ ] **Step 2: 스펙을 고친다** — 넣을 자리:
  - §7 끝: 1(`BATCH_JOIN_BLOCKED`), 2(`BATCH_NOT_JOINABLE` 범위·옛 코드 대체), 10(찾기 조회·번호 정의), 11(택배사 `HANJIN`), 그리고 합류 잠금 순서(세션 → 보관 → 가용 잠금 → 원장, 배치 행·다른 박스 작업 항목은 잠그지 않는 이유 한 문장)
  - §8 끝: 3(전부 빠지면 파생 `canceled`), 4(PR 2 이탈 결과 = planned 그대로), 5(«집은 몫» 정의와 거절 코드), 6(반납 순서)
  - §12 표에 행 `BATCH_JOIN_BLOCKED` — «§7 합류 실패 | 무변경, 시작과 같은 박스·SKU·수량 목록»
  - §13: 7(멱등 키 형식), 8(복구 규칙 — 인계 해시는 이벤트 수량), 9(검사기 I1~I3, I4 는 조립 함수가 강제, 주기 대조 SQL 은 보존식만)
  - §16 에 한 줄: «합류가 명시적으로 잡는 세션 잠금과 불변식 검사기가 박스 이력으로 잡는 세션 잠금(id 순)은, 두 박스가 서로 다른 옛 배치 이력을 엇갈려 공유할 때 드물게 교착할 수 있다 — Postgres 가 한쪽을 40P01 로 끊고 재시도로 풀린다»

- [ ] **Step 3: 커밋 + PR**

```bash
git add docs/superpowers/specs/2026-09-30-outbound-allocation-before-label-design.md
git commit -m "docs(fulfillment): PR 2 가 정한 합류·이탈 계약을 스펙에 반영 (#988)"
```

PR 본문(한국어)에 반드시 넣는다:
- `Closes #988`, 트래킹 #986
- **배포 순서: PR 1 배포가 먼저. 그 뒤 `db:migrate`(core, `allocation-hand-back`) → `sst deploy`(core + warehouse-app 릴리스)** — 추가·완화형(expand)
- **배포 전 확인:** 라이브에 시작된 배치(`outbound_batches.started_at IS NOT NULL`)의 활성 박스 중 배정 행이 `work_item_id IS NULL`(S1-A 이전 옛 행)인 것이 있는지 `sst shell` 로 센다. 있으면 I2 검사기가 그 박스들의 명령을 `FULFILLMENT_INVARIANT_VIOLATION` 으로 막는다 → 배포 전에 그 배치를 끝내거나 비운다(현재 라이브 출고는 셀메이트 수기, warehouse-app 출고는 컷오버 #923 전 — 0 이 기대값)
- 새 거절 코드: `BATCH_JOIN_BLOCKED`, `BATCH_NOT_JOINABLE`(옛 `OUTBOUND_BATCH_CLOSED` 대체 — admin-web 이 옛 코드를 문자열로 비교하는 곳이 있는지 `grep -rn OUTBOUND_BATCH_CLOSED apps/admin-web` 로 확인해 적는다), `BOX_HAS_PICKED_ITEMS`
- 지운·바꾼 테스트 목록(리뷰어 판정용): «시작된 배치에 추가하면 OUTBOUND_BATCH_ALREADY_STARTED»(→ 합류 성공 테스트), 오케스트레이터 통합 스펙의 `OUTBOUND_BATCH_CLOSED`·`WORK_ITEM_ALLOCATED` 기대 변경과 이유
- **로컬 E2E 사람 스모크 체크리스트**(브라우저·앱 로그인은 사람이):
  1. 시작된 배치 카드에만 「박스 넣기」「박스 빼기」가 보인다
  2. 송장 없는 급한 주문의 주문번호 입력 → 발급 → 합류 → 송장 출력(FS 실물에 `[로케이션]`), 배치 카드 박스 수 +1
  3. 방금 넣은 박스 송장 스캔 → 평소 작업 화면, 끝까지 출고
  4. 같은 배치의 다른 박스 송장 스캔 → «재출력 필요» 없이 평소 작업(지문 불변)
  5. 재고가 모자란 박스 넣기 → «재고 부족» 묶음, 배치 카드 박스 수 그대로
  6. 아직 스캔 안 한 박스 「박스 빼기」(사유 입력) → «송장은 버려 주세요», 관리자 화면에서 그 박스가 배치 전 목록(planned)으로 돌아옴, 재고 화면 가용 수량 증가
  7. 상품을 한 개 스캔한 박스 「박스 빼기」 → «이미 상품을 담은 박스라…»
  8. 6 에서 뺀 박스를 다시 「박스 넣기」 → 합류·출력
  9. 배치의 박스를 전부 빼면 카드가 목록에서 사라짐(파생 canceled)
- 알고 남기는 것: 집은 몫이 있는 박스의 이탈·되돌림 바구니(PR 3), 전체 취소 → 이탈 연결(PR 3), 합류 교착의 드문 경우(스펙 §16)

---

## Self-Review 기록

- **스펙 커버리지(§15 PR 2 범위):** `reconcileAllocation`(T1) + `BoxAllocationManager`(T6·T7) / §7 합류 전부 — 시작 전 갈래 유지·시작 후 합류·닫힌 배치 `BATCH_NOT_JOINABLE`(T6), 한 트랜잭션 1~5(T6), 합류 직후 I5(출력 전 피킹 불가 — PR 1 게이트가 그대로 막는다, T6 이 `never_printed` 확인), 앱 「이 배치에 넣기」 발급 → 합류 → 출력(T8·T10) / §8 중 집은 몫 없는 이탈 `HAND_BACK` 즉시 `excluded`(T7), 앱 「이 박스 빼기」(T11) / §11 PR 2 행 — `qty >= 0`·`HAND_BACK`·payload 신원·`handed_back_qty`·보존식 CHECK(T2·T3) / §12 `BOX_HAS_PICKED_ITEMS`·`BATCH_NOT_JOINABLE`(+ 이 계획의 `BATCH_JOIN_BLOCKED`) / §13 작업 항목 잠금에서 줄 서기·가용 잠금·멱등 키·복구 규칙·검사기(T3~T7) / §14 순수 전수 열거(T1)·통합 시작·합류·이탈 × 세 방식(합류 T6, 이탈은 개별 + 토탈피킹 카트 T7)·모든 시나리오 끝 검사기(T5 헬퍼, T6·T7 사용)·커밋 경합(T6)·앱 순수 함수 표 테스트(T10·T11).
- **범위 밖으로 둔 것:** `withdrawing`·`exit_to`·되돌림·전체 취소 연결(PR 3), 결품 재배정(PR 4). 이탈 통합 테스트의 «× 세 방식» 중 바구니 피킹은 토트 배정 해제가 선행 조건이라 기존 `WORK_ITEM_TOTE_RELEASE_REQUIRED` 경로로 남는다 — 토트 배정 없는 바구니 피킹 박스의 반납은 개별 피킹과 같은 코드 경로다.
- **타입 이름 일관성:** `ReconcilePlan{handIns,handBacks,cartSurplus,excess,shortages}` / `AllocationDecrement{allocationId,shipmentLineId,skuId,sourceLocationId,qty}` / `BatchInventorySessionRow` / `HandBackInput` / `lockOpenSession`·`planJoin`·`applyJoin`·`withdrawUnpicked` / `joinBlocked`·`boxHasPickedItems`·`notJoinable` / 앱 `JoinCandidate`(core `JoinCandidateResponseDto`)·`JoinOutcome`·`RemoveOutcome`·`blockersOf`·`groupBlockers`.
