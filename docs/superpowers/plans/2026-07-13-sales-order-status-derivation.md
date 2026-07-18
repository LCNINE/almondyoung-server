# 작업 15 — SO 상태 도출 (저장 최소 선언 + FO 기준) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SO 저장 상태를 `pending→confirmed→cancelled/timeout` 로 최소 선언하고, 출고완료 통계를 FO 출고 증거에서 도출해 유일 실 결함(`getStats().outboundComplete` 항상 0)을 해소한다.

**Architecture:** `processing/shipped/delivered` 는 producer 0 인 dead 저장 상태다. 이를 채우는 대신(A안 기각), 표시 레이어가 이미 쓰는 출고 증거 정의(`fulfillmentOrders.status ∈ {shipped,completed} OR shippedAt≠null`)를 `getStats` 도 공유해 단일 SoT(FO)에서 도출한다. dead 값은 물리 제거 대신 마커로 잠그고, ADR-0017/0010 을 코드 현실에 맞춰 정정한다.

**Tech Stack:** NestJS · Drizzle ORM(postgres.js) · Jest.

**설계 spec:** `docs/superpowers/specs/2026-07-13-sales-order-status-derivation-design.md`
**브랜치:** `feat/sales-order-status-derivation` (spec 커밋 `265e8107f` 위에 이어서)

## Global Constraints

- **스키마 무변경** — pgEnum 값 물리 추가/제거 없음. 마이그레이션 생성 금지.
- **admin-web 무변경** — `getStats` 반환 shape(필드명) 불변이므로 프론트 수정 없음.
- **새 컨슈머/이벤트 없음** — SO.status 전이를 쓰지 않는다(A안 기각분).
- **검증은 변경 파일 신규 eslint error 만** — repo 전역 lint 는 상시 debt, 판정 대상 아님.
- **arch 경계** `apps/core/src/modules/inventory/__tests__/inventory-write-boundary.arch.spec.ts` (또는 현 위치) PASS 유지.
- **`nest build core` exit 0** 유지.
- dev DB 부재 — 스키마 무변경이라 dev DB 의존 ⏸ 항목 없음. 통합 spec 신설 안 함(작업 11·13 판례: 신규 전부 유닛).

---

### Task 1: getStats `outboundComplete` FO 기준 재구현 (TDD)

`outboundComplete` 를 `byStatus('processing')+byStatus('shipped')+byStatus('delivered')`(항상 0) 에서 FO 출고 증거 도출로 전환. `outboundRequested`(=`byStatus('confirmed')`)는 유지 → `완료 ⊆ 요청` 중첩.

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (import 줄 5, `getStats()` 742-833)
- Test: `apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts` (신규 describe 추가, 파일 끝)

**Interfaces:**
- Consumes: `wmsTables.salesOrders`, `wmsTables.fulfillmentOrders`(컬럼 `salesOrderId`/`status`/`shippedAt`), drizzle `and/or/eq/gte/inArray/isNotNull`.
- Produces: `getStats()` 반환 shape 불변 — `{ todayCount, outboundRequested, directShip, cannotShip, partialOutbound, waitingMatching, outboundComplete }`. `outboundComplete` 의 산출식만 변경.

- [ ] **Step 1: 실패 테스트 작성** — `sales-orders.service.spec.ts` 파일 끝에 아래 describe 를 추가한다. dead status 합(9)과 FO 도출(2)을 구분하는 것이 핵심.

```typescript
describe('SalesOrdersService.getStats() — 출고완료 FO 도출 (작업 15)', () => {
  // getStats 의 6개 쿼리 체인을 (from 테이블, innerJoin 테이블, groupBy 여부)로 판별해
  // 캔드 결과를 돌려주는 목. drizzle 연산자(and/or/eq/inArray/isNotNull)는 실제 실행돼도
  // AST 만 만들고 DB 를 건드리지 않으므로 목이 인자를 무시하면 된다.
  function makeStatsService(canned: {
    today: number;
    statusCounts: Array<{ status: string; cnt: number }>;
    waitingMatch: unknown[];
    cannotShip: unknown[];
    directShip: unknown[];
    outboundComplete: unknown[];
  }): SalesOrdersService {
    function builder() {
      const state: { from?: unknown; joins: unknown[]; grouped: boolean } = { joins: [], grouped: false };
      const resolveRows = (): unknown[] => {
        const { from, joins } = state;
        if (from === wmsTables.salesOrders && joins.length === 0) {
          return state.grouped ? canned.statusCounts : [{ cnt: canned.today }];
        }
        if (from === wmsTables.salesOrders && joins.includes(wmsTables.fulfillmentOrders)) {
          return canned.outboundComplete;
        }
        if (from === wmsTables.salesOrders && joins.includes(wmsTables.salesOrderLines)) {
          return canned.cannotShip;
        }
        if (from === wmsTables.fulfillmentOrders && joins.includes(wmsTables.salesOrders)) {
          return canned.directShip;
        }
        if (from === wmsTables.fulfillmentOrderCreationBacklogs && joins.includes(wmsTables.salesOrders)) {
          return canned.waitingMatch;
        }
        return [];
      };
      const b: any = {
        from: (t: unknown) => { state.from = t; return b; },
        innerJoin: (t: unknown) => { state.joins.push(t); return b; },
        where: () => b,
        groupBy: () => { state.grouped = true; return b; },
        then: (onF: any, onR: any) => Promise.resolve(resolveRows()).then(onF, onR),
      };
      return b;
    }
    const db = { db: { select: () => builder() } };
    return new SalesOrdersService(
      db as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  }

  it('outboundComplete 는 FO 출고행 수이며 dead SO.status 합(processing/shipped/delivered)과 무관하다', async () => {
    const service = makeStatsService({
      today: 3,
      // OLD 코드라면 shipped(5)+delivered(3)+processing(1)=9 를 반환했을 것
      statusCounts: [
        { status: 'confirmed', cnt: 10 },
        { status: 'shipped', cnt: 5 },
        { status: 'delivered', cnt: 3 },
        { status: 'processing', cnt: 1 },
      ],
      waitingMatch: [],
      cannotShip: [], // 비우면 partialOutbound 2차 쿼리 스킵
      directShip: [],
      outboundComplete: [{ id: 'so-a' }, { id: 'so-b' }], // FO 출고 증거 있는 confirmed SO 2건
    });

    const stats = await service.getStats();

    expect(stats.outboundComplete).toBe(2); // FO 도출 — dead status 합(9)이 아님
    expect(stats.outboundRequested).toBe(10); // byStatus('confirmed') 유지
    expect(stats.outboundComplete).toBeLessThanOrEqual(stats.outboundRequested); // 완료 ⊆ 요청
    expect(stats.todayCount).toBe(3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts -t "출고완료 FO 도출" 2>&1 | tail -20`
Expected: FAIL — `Expected: 2, Received: 9` (현행은 dead status 합).

- [ ] **Step 3: import 에 `isNotNull` 추가** — `sales-orders.service.ts` 5번 줄.

기존:
```typescript
import { eq, inArray, desc, and, or, gte, lte, count, sql, type InferInsertModel, type SQL } from 'drizzle-orm';
```
변경:
```typescript
import { eq, inArray, desc, and, or, gte, lte, count, sql, isNotNull, type InferInsertModel, type SQL } from 'drizzle-orm';
```

- [ ] **Step 4: outboundComplete 쿼리 추가** — `getStats()` 의 `directShipRows` 블록 직후(현 812-822), `return {` 직전에 삽입.

```typescript
    // 출고완료: confirmed SO 중 FO 가 출고 증거를 가진 건수. SO.status 는 processing/shipped/
    // delivered 로 전이하지 않으므로(작업 15, ADR-0017) FO(status + shippedAt)에서 도출한다.
    // 표시 레이어(deriveFulfillmentStatus/hasShippedEvidence)와 동일한 출고 증거 정의.
    const outboundCompleteRows = await db
      .select({ id: wmsTables.salesOrders.id })
      .from(wmsTables.salesOrders)
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.salesOrderId, wmsTables.salesOrders.id),
      )
      .where(
        and(
          gte(wmsTables.salesOrders.orderDate, fourteenDaysAgo),
          eq(wmsTables.salesOrders.status, 'confirmed'),
          or(
            inArray(wmsTables.fulfillmentOrders.status, ['shipped', 'completed']),
            isNotNull(wmsTables.fulfillmentOrders.shippedAt),
          ),
        ),
      )
      .groupBy(wmsTables.salesOrders.id); // DISTINCT so.id — 미래 SO:다중 FO 이중계산 방지
```

- [ ] **Step 5: 반환 필드 변경** — `getStats()` 반환 객체의 outboundComplete 줄(현 831).

기존:
```typescript
      outboundComplete: byStatus('processing') + byStatus('shipped') + byStatus('delivered'),
```
변경:
```typescript
      outboundComplete: outboundCompleteRows.length,
```

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts -t "출고완료 FO 도출" 2>&1 | tail -20`
Expected: PASS (1 passed).

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order/services/sales-orders.service.ts \
        apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts
git commit -m "feat(core): getStats 출고완료를 FO 출고증거로 도출 (작업 15, P1-7)

byStatus(processing/shipped/delivered) 합(항상 0) → confirmed SO 중
FO shipped-evidence 보유 건수. outboundRequested 유지(완료 ⊆ 요청 중첩).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BRB7ymjR9Mu47PU11FVKR"
```

---

### Task 2: dead 저장 상태 공식 선언 (코드, 동작 무변경)

enum 마커 + 가드 주석 + 죽은 OR-폴백 제거. 전부 behavior-neutral(세 상태 producer 0 확정).

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:120-128` (enum 마커)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:328` (NON_CONFIRMABLE 주석)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:546,551` (OR-폴백 제거)

**Interfaces:**
- Produces: 없음(주석/dead-branch 정리만). `buildActionsView` 의 분기 결과는 FO 도출값으로 불변.

- [ ] **Step 1: orderStatusEnum 마커** — `inventory.schema.ts` 120-128.

기존:
```typescript
export const orderStatusEnum = pgEnum('order_status', [
  'pending', // 주문 생성 (결제 대기)
  'confirmed', // 주문 확정 (결제 완료)
  'processing', // 처리 중 (일괄주문확정 완료)
  'shipped', // 출고 완료
  'delivered', // 배송 완료
  'cancelled', // 취소
  'timeout', // 타임아웃
]);
```
변경:
```typescript
export const orderStatusEnum = pgEnum('order_status', [
  'pending', // 주문 생성 (결제 대기)
  'confirmed', // 주문 확정 (결제 완료)
  // DEAD 값(producer 0, 작업 15) — SO 출고/배송 진실은 FO(fulfillmentOrders.status + shippedAt)
  // 도출이 SoT 다(ADR-0017). 저장 SO.status 는 pending→confirmed→cancelled/timeout 만 전이한다.
  // 재사용 금지. 물리 제거(pgEnum recast)는 destructive·저가치라 비목표(구 8b 판례).
  'processing', // [DEAD] 미사용 — 도달 불가
  'shipped', // [DEAD] 미사용 — FO 도출로 대체
  'delivered', // [DEAD] 미사용 — FO 도출로 대체
  'cancelled', // 취소
  'timeout', // 타임아웃
]);
```

- [ ] **Step 2: NON_CONFIRMABLE 주석** — `sales-orders.service.ts:328`.

기존:
```typescript
      const NON_CONFIRMABLE = new Set(['cancelled', 'shipped', 'delivered', 'timeout', 'processing']);
```
변경:
```typescript
      // shipped/delivered/processing 는 producer 0(작업 15, ADR-0017)이라 도달 불가하나,
      // 미래 값 부활 시 confirm 재진입을 막도록 방어적으로 존치한다.
      const NON_CONFIRMABLE = new Set(['cancelled', 'shipped', 'delivered', 'timeout', 'processing']);
```

- [ ] **Step 3: 죽은 OR-폴백 제거** — `store-sales-orders.service.ts` 546, 551. 세 dead 상태 producer 0 이라 두 폴백 항은 항상 false → FO 도출값(`hasShippedEvidence`/`fulfillmentStatus`)만 남긴다(결과 불변).

기존(546):
```typescript
    } else if (hasShippedEvidence || so.status === 'shipped' || so.status === 'delivered') {
```
변경:
```typescript
    } else if (hasShippedEvidence) {
```

기존(551):
```typescript
      const isDelivered = so.status === 'delivered' || fulfillmentStatus === 'delivered';
```
변경:
```typescript
      const isDelivered = fulfillmentStatus === 'delivered';
```

- [ ] **Step 4: 빌드/타입 검증** (동작 무변경이라 신규 테스트 없음 — 컴파일 + 기존 스위트로 회귀 가드)

Run: `npx nest build core 2>&1 | tail -5`
Expected: exit 0, 에러 없음.

Run: `npx jest apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts 2>&1 | tail -8`
Expected: 기존 confirm 가드 스위트 포함 전부 PASS(회귀 0).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts \
        apps/core/src/modules/sales-order/services/sales-orders.service.ts \
        apps/core/src/modules/sales-order/services/store-sales-orders.service.ts
git commit -m "refactor(core): SO dead 상태(processing/shipped/delivered) 선언 + 죽은 폴백 제거 (작업 15)

enum 마커(재사용 잠금, 8b 판례) + NON_CONFIRMABLE 방어 주석 +
store 표시 도출의 죽은 SO.status OR-폴백 제거(동작 무변경). 스키마 무변경.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BRB7ymjR9Mu47PU11FVKR"
```

---

### Task 3: ADR 정정 (D2 · D3)

코드 현실(FO 도출 SoT, confirm≠FO 트리거)에 맞춰 두 ADR 정정.

**Files:**
- Modify: `docs/adr/0017-order-status-action-matrix.md` (D2)
- Modify: `docs/adr/0010-library-grant-trigger-on-order-created.md` (D3)

- [ ] **Step 1: ADR-0017 — 상태 레이어 표 뒤 정정 문단 삽입** — `## 표시 상태 정의` 헤딩(현 L18) 바로 앞에 삽입.

```markdown
> **작업 15 (2026-07-13) 정정 (D2):** `sales_orders.status` 의 `processing / shipped / delivered` 는 enum 정의만 존재하고 **producer 가 0** 이다(전이시키는 코드 없음). SO 의 출고/배송 진실은 저장 상태가 아니라 **`fulfillmentOrders.status` + `shippedAt` 에서 도출**하는 것이 SoT 다 — 고객 배송조회(`deriveOverallTrackingStatus`)·관리자 표시(`deriveFulfillmentStatus`)·`getStats().outboundComplete` 전부 FO 에서 도출한다. SO 저장 상태의 실 lifecycle 는 `pending → confirmed → cancelled/timeout` 이다. 세 dead 값의 물리 제거는 비목표(마커로 재사용 잠금).
```

- [ ] **Step 2: ADR-0017 — 표시 상태 정의 표의 DELIVERED/SHIPPING 조건 정정** — 현 L33-34.

기존:
```markdown
| `DELIVERED` | SO `delivered` | 배송 완료 | 배송 완료 |
| `SHIPPING` | SO `shipped` | 배송 중 | 출고 완료 / 배송 중 |
```
변경:
```markdown
| `DELIVERED` | FO `completed` (배송완료) | 배송 완료 | 배송 완료 |
| `SHIPPING` | FO shipped-evidence (`status ∈ {shipped, completed}` 또는 `shippedAt ≠ null`) | 배송 중 | 출고 완료 / 배송 중 |
```

- [ ] **Step 3: ADR-0017 — 각주(L40)를 도출 규칙으로 승격**

기존:
```markdown
> **참고**: FO 중 하나라도 `shipped`/`completed` 이면 SO가 `confirmed`여도 `SHIPPING` 이상으로 처리한다.
```
변경:
```markdown
> **도출 규칙 (SoT):** 출고/배송 표시는 `SO.status` 가 아니라 FO 에서 도출한다. FO 중 하나라도 shipped-evidence(`status ∈ {shipped, completed}` 또는 `shippedAt ≠ null`)이면 `SHIPPING`, FO 가 `completed` 면 `DELIVERED`. `SO.status` 는 `processing`/`shipped`/`delivered` 로 전이하지 않는다(작업 15).
```

- [ ] **Step 4: ADR-0010 — confirm≠FO 트리거 명확화(W10/D3)** — `## Consequences` 마지막 bullet(현 L74 `- 별도 backfill...`) 뒤에 새 bullet 추가.

```markdown
- **작업 15 (2026-07-13) 명확화 (W10/D3):** `confirm()` 은 **출고주문(FO) 생성 트리거가 아니다**. FO 생성은 `OrderCreated` 도착 시점의 backlog(`order-events.consumer.ts:103` → FO 생성 백로그 워커)이며, `confirm()`(`sales-orders.service.ts:306-361`)은 매핑 스냅샷 생성 + row lock + `pending→confirmed` 전이만 수행한다. §"발견된 용어 충돌" 표의 "출고 확정 = 이 SO 를 창고에 보내 처리한다"는 FO 를 만든다는 뜻이 아니라, 운영자가 출고 처리 의사를 확정하는 사건을 가리킨다.
```

- [ ] **Step 5: 정합 확인** — 두 ADR 을 다시 읽어 삽입 위치·표 정렬·마크다운 렌더 확인. `git diff docs/adr/` 로 의도한 앵커만 바뀌었는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add docs/adr/0017-order-status-action-matrix.md docs/adr/0010-library-grant-trigger-on-order-created.md
git commit -m "docs(adr): SO 상태 소유(0017)·confirm 의미(0010) 정정 (작업 15, D2·D3)

0017: processing/shipped/delivered producer 0, 표시는 FO 도출 SoT.
0010: confirm 은 FO 생성 트리거 아님(FO=OrderCreated backlog, W10).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BRB7ymjR9Mu47PU11FVKR"
```

---

### Task 4: 최종 검증 + 현황판 갱신

전 브랜치 검증 게이트 통과 확인 후 상황판에 작업 15 완료 반영.

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md` (§2 P1-7·§3 W10·§4 D2·D3 상태 + §5 WS-D 작업 15 블록)

- [ ] **Step 1: 전 브랜치 검증 게이트**

Run: `npx nest build core 2>&1 | tail -5`
Expected: exit 0.

Run: `npx jest apps/core/src/modules/sales-order 2>&1 | tail -12`
Expected: getStats 신규 + 기존 sales-order 스위트 PASS(신규 회귀 0 — 기존 pre-existing baseline 실패가 있으면 merge-base 대조로 회귀 아님 확인).

Run: `npx jest --testPathPattern="inventory-write-boundary.arch" 2>&1 | tail -6`
Expected: arch 경계 PASS.

Run: `git diff --name-only develop... | xargs npx eslint 2>&1 | tail -20`
Expected: 변경 파일 신규 error 0 (사전존재 debt 는 develop 대조로 제외).

- [ ] **Step 2: §2 P1-7 상태 갱신** — 행 상태 ⬜→🟩, 서술 끝에 완료 태그.

`docs/logistics-backend-hardening-2026-07.md` P1-7 행(현 55행)의 상태 컬럼 `⬜`→`🟩`, 서술 끝에 추가:
```markdown
 **✅ 완료(작업 15, 2026-07-13)**: B안 확정 — 저장 전이 미구현, `getStats().outboundComplete` 를 FO shipped-evidence 도출로 전환(중첩), dead 값 마커 선언, ADR-0017(D2) 정정.
```

- [ ] **Step 3: §3 W10 + §4 D2·D3 상태 갱신** — W10 행(현 109)·D2 행(119)·D3 행(120) 상태 ⬜→🟩, 각 서술 끝에 `**✅ 작업 15(2026-07-13)**` 태그.

- [ ] **Step 4: §5 WS-D 에 작업 15 완료 블록 추가** — 작업 14 블록(현 332행 끝) 뒤에 삽입. 실행 결과값(커밋 SHA)은 실제 커밋 후 채운다.

```markdown
> **✅ 작업 15 (SO 상태 결정, P1-7·W10 + D2·D3) 완료 — 2026-07-13:** SO 저장 상태를 최소 선언(`pending→confirmed→cancelled/timeout`)하고 출고완료 통계를 FO 기준으로 도출. **B안 확정**(사용자 결정) — 저장 전이 구현(A) 기각. 근거: 표시 레이어가 이미 100% FO 도출(SO.status 는 SoT 아님)·SO↔FO 0..1:0..1(디지털주문 FO 0개)·유일 실결함은 `getStats.outboundComplete=0` 하나. 스키마 무변경(작업 4~11 판례).
> - **P1-7**: `getStats().outboundComplete` = `byStatus(processing/shipped/delivered)`(항상 0) → confirmed SO 중 FO shipped-evidence(`status∈{shipped,completed} OR shippedAt≠null`, 표시 레이어와 동일 정의) 보유 건수. `outboundRequested`(=confirmed) 유지 → `완료 ⊆ 요청` 중첩(Choice 2). admin-web 반환 shape 불변 → FE 무변경.
> - **dead 선언**: `orderStatusEnum` 의 `processing/shipped/delivered` 마커 주석(재사용 잠금, 구 8b 판례) + `NON_CONFIRMABLE` 방어 주석 + `store-sales-orders.service.ts` 죽은 SO.status OR-폴백 2곳 제거(동작 무변경). pgEnum 값 물리 제거는 비목표.
> - **D2(ADR-0017)**: SO 상태 소유 표 정정 — 세 값 producer 0, 표시는 FO(`status`+`shippedAt`) 도출 SoT. SHIPPING/DELIVERED 조건을 FO 기준으로. **D3(ADR-0010)/W10**: `confirm()` 은 FO 생성 트리거 아님(FO=OrderCreated backlog) 명확화.
> - 설계 `docs/superpowers/specs/2026-07-13-sales-order-status-derivation-design.md` · 계획 `docs/superpowers/plans/2026-07-13-sales-order-status-derivation.md`.
> - 브랜치 `feat/sales-order-status-derivation` → **develop 스쿼시 머지 대기(사용자 수동 머지)**.
> - 검증: `nest build core` exit 0 · arch 경계 PASS · getStats 유닛 GREEN(dead status 합과 FO 도출 구분 회귀 가드) · 변경 파일 신규 eslint 0 · admin-web 무변경. 스키마 무변경이라 dev DB ⏸ 없음. 통합 spec 없음(신규 전부 유닛, 작업 11·13 판례).
> - **비고**: 작업 13·14 코드는 이미 develop 반영됨(스쿼시 `5669866a9`·`599d82523`) — 상황판 "머지 대기" 표기가 뒤처졌던 것으로, WS-D 잔여는 ② 보류(게이지 실측) + P2-12 취소경로 key + P1-11(별도 설계)뿐.
> - **WS-D 본류(작업 13~15) 완료** — 잔여: ② 보류 · P2-12 취소경로(명시적 후속) · P1-11(별도 설계 항목).
```

- [ ] **Step 5: 실행 결과값 채우기** — 위 블록의 `develop 스쿼시 머지 대기`는 사용자 수동 머지라 그대로 두고, 검증 실측치(유닛 개수 등)를 Step 1 결과로 정정.

- [ ] **Step 6: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "docs(core): 현황판 작업 15(SO 상태 결정) 완료 반영 (P1-7·W10·D2·D3)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BRB7ymjR9Mu47PU11FVKR"
```

---

## Self-Review

**Spec coverage:**
- 파트 1(getStats FO 도출) → Task 1. ✓
- 파트 2(enum 마커·가드 주석·OR-폴백 제거) → Task 2. ✓
- 파트 3(D2 ADR-0017·D3 ADR-0010) → Task 3. ✓
- 파트 4(테스트) → Task 1 Step 1(유닛 회귀 가드). ✓
- 비목표(A안·pgEnum 물리제거·다중FO·admin-web) → Global Constraints + 각 Task 주석에 반영. ✓
- 검증 체크리스트 → Task 4 Step 1. ✓

**Placeholder scan:** 코드 스텝은 전부 실제 코드. Task 4 상황판 블록의 검증 실측치만 실행 후 정정(상태-문서 특성상 정상). 코드 placeholder 없음. ✓

**Type consistency:** `getStats` 반환 필드명(outboundComplete/outboundRequested)·`wmsTables.*` 테이블 참조·drizzle 연산자(`isNotNull` 신규 import)·목의 판별 시그니처(from/join 테이블) 전부 일관. `outboundCompleteRows.length` 정수. ✓
