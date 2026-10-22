# K6 PR 6 — contract: 취소 metadata 의 `cancelledLines` 를 끊고 옛 파서를 지운다 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매주문 취소가 `sales_order_cancellations.metadata.cancelledLines` 를 더는 쓰지도 읽지도 않게 해, 취소 수량의 기록이 취소 라인 행(`sales_order_cancellation_lines`) 하나뿐이 되게 한다(스펙 §6.2·§6.6·§9-6).

**Architecture:** 쓰기 문 `recordSalesOrderCancellation` 이 취소할 라인을 metadata 가 아니라 명시 인자로 받는다. 세 쓰기 지점(V1 전체·V1 부분·V2)이 그 인자로 넘기고 metadata 에서 `cancelledLines` 를 뺀다. 쓰기 문의 «백필 전 옛 partial» 대비(metadata 를 읽어 prior 에 더하던 갈래)와 그 파서 `sumCancelledByLine`, 이미 라이브에 적용된 일회성 백필 스크립트 둘을 지운다. 옛 이름이 되살아나거나 metadata 에 `cancelledLines` 가 다시 실리면 빨개진다.

**Tech Stack:** NestJS(core), Drizzle, Jest(unit + `REQUIRE_*_DB` 통합 — 스크래치 DB `k6_it`).

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§6.2, §6.6, §9-6, §11). ADR: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`.

## 선행 조건 (스펙 §9-6, 충족 확인 2026-10-22)

- PR 1 백필이 라이브에서 끝났다 — 10-20 Core td 258, 196주문 → 1,031행, 재조회 넣을 행 0, `--verify` 어긋남 0.
- 그 뒤 한 번 이상 배포됐다 — 태그 `deploy/live/20261021-1114`·`-1327`·`-1442`.
- PR 2a 이후 라이브의 모든 취소 수량 읽기는 라인 행만 본다. metadata 를 읽는 곳은 쓰기 문의 prior 대비와 백필 스크립트 둘뿐이다(`line-quantity-read.guard.spec.ts` 가 고정).

## 이름 붙은 결정 (⛔ 사용자 확인)

- **C1. 마이그레이션 없음.** 이미 쌓인 취소 행의 `metadata.cancelledLines` JSON 은 지우지 않는다 — 이력이고, 아무도 읽지 않게 되며, 지우는 UPDATE 는 되돌릴 수 없다. 스펙 §11 의 «contract 는 `deploy → migrate`» 는 지울 칼럼이 없어 해당 없음.
- **C2. 일회성 백필 스크립트 둘을 지운다.** `scripts/ops/k6-*`(K6 PR 1, 10-20 적용)와 `scripts/ops/1016-14-*`(#1063, 10-13 적용, «FO 있고 출처 NULL» 0 확인). 둘 다 `sumCancelledByLine`/`metadata.cancelledLines` 위에 서 있고, 이 PR 뒤 새 취소에는 metadata 가 없어 K6 `--verify` 는 새 partial 을 모두 «모호»로 보고한다 — 남겨 두면 틀린 도구가 된다. git 이력에 남는다.
- **C3. metadata 에 `cancelledLines` 가 실리면 쓰기 문이 던진다**(`CancellationLineDerivationError`, 호출자 트랜잭션 롤백). 조용히 떼어 내면 «어느 쪽이 기록인가»가 다시 두 벌이 된다. 지금 그런 호출자는 없다(Task 1 이 셋을 고친다).
- **C4. `fulfillment_orders.sales_order_id` NOT NULL(PR 4 의 contract)은 이 PR 밖이다.** PR 4 가 아직 미배포라 G4 실측이 없고, NOT NULL 은 미종결 FO 만이 아니라 **모든** 행이 대상이라 별도 실측이 필요하다. 별 PR.
- 이벤트 `SalesOrderCancelled.cancelledLines`, 채널 이벤트 `OrderCancelled.cancelledLines`, 감사 로그·지갑 환불 링크 metadata 의 `cancelledLines`, `calculatePartialCancellationRefund` 의 입력 `cancelledLines` 는 **다른 것**이라 그대로 둔다.

## Global Constraints

- 동작 변경 없음: 같은 취소 요청이 같은 라인 행(라인·수량·갈래)을 만든다. 바뀌는 건 취소 행의 `metadata` 에 `cancelledLines` 키가 없어지는 것뿐이다.
- V2 의 `metadata.fulfillmentCommandSourceKey`·`fulfillmentCommandRequestHash` 와 호출자가 넘긴 `options.metadata`(예: `sourceEventId`)는 그대로 실린다 — 멱등 키로 쓰인다.
- V2 전체취소는 지금처럼 요청 라인(`requestedSalesLines`)을 넘긴다(전체 갈래의 디지털 라인 보충 규칙이 그 위에 선다). V1 전체취소는 `null`.
- 롤백: 이 PR 의 Core 에서 PR 2a 이후 Core 로 되돌리는 것은 안전하다(새 취소는 라인 행이 있어 옛 쓰기 문의 metadata 대비를 타지 않는다). PR 2a 이전(태그 `deploy/live/20261021-1114` 이전)으로는 되돌리지 않는다 — 옛 읽기가 새 partial 을 취소 0 으로 본다.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`(아래 «통합(`k6_it`)»은 이 꼴). 컨테이너가 꺼져 있으면 `docker start almondyoung-server-postgres-1`. 마이그가 없어 스키마 적용은 필요 없다.
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/sales-order/**/*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. «기준선 외 0» 은 그 목록 대비. 🔴 `channel-cancel-request.integration.spec.ts` 단발 실패는 공유 DB 동시 실행 의심 — 재실행으로 판정.
- 검증 게이트: `npm run type-check` 에러 0(로컬 환경 에러 3 — web-push·tauri 미설치 — 은 기준선), `npx jest` 실패 0(로컬 node_modules 누락분은 기준선), 통합(`k6_it`) 기준선 2건 외 실패 0.

## Review Focus

- **`options.metadata` 를 퍼뜨리는 V1 부분·V2 에서 호출자가 넘긴 키가 사라지지 않는다** — `sourceEventId` 가 남아야 채널 재수신 멱등이 산다. Task 1 의 recorder 통합 spec 에 «호출자 metadata 키 보존» 단언을 둔다.
- **V2 전체취소의 디지털 라인 보충** — 요청 라인을 metadata 가 아니라 인자로 받아도 `scope='full'` + 요청 라인 + 디지털 라인 보충이 그대로여야 한다. 기존 `cancellation-lines.spec.ts` 의 full 케이스를 필드 이름만 바꿔 통과시킨다(Task 1).
- **라인 행 없는 옛 partial 이 라이브에 남아 있으면 이 PR 뒤 그 수량이 prior 에서 빠진다** — 그 라인의 다음 전체취소가 더 많이 적는다. 배포 전 G1 이 0 이어야 한다. Task 2 의 recorder spec 이 «metadata 만 있는 행은 보이지 않는다»를 고정해 이 위험이 문서와 테스트에 같이 남는다.
- **가드가 `scripts/` 를 안 본다** — 지금 두 가드는 `apps/core/src` 만 훑는다. 지운 파서 이름이 스크립트에서 되살아나도 잡히게 Task 2 에서 범위를 넓힌다.
- **unit spec 의 가짜 DB 가 라인 행을 받는다** — `sales-orders.service.spec.ts` 의 `state.salesOrderCancellationLines` 로 단언을 옮긴다(Task 1). metadata 단언만 지우면 라인 행이 안 생겨도 초록이다.

---

## 배포

- 배포 단위: **Core 만.** 마이그레이션 없음. 2b·3a·3b·4(#1116·#1118·#1119·#1120)와 같은 배포면 그 절차 먼저.
- `npm run deploy:preflight -- --stage live`.
- **배포 전 게이트(터널은 사용자), PR 본문에는 SQL 을 싣지 말고 이 절을 가리킨다:**
  - **G1 라인 행 없는 partial** — 기대 0. 0 이 아니면 그 취소는 이 배포 뒤 수량에서 사라지므로 배포하지 않고 사람이 본다.
    ```sql
    SELECT count(*) FROM sales_order_cancellations c
    WHERE c.cancellation_scope = 'partial'
      AND NOT EXISTS (SELECT 1 FROM sales_order_cancellation_lines l WHERE l.cancellation_id = c.id);
    ```
  - **G2 metadata ↔ 라인 행 합 일치** — 기대 0(백필 `--verify` 의 SQL 판; 스크립트는 이 PR 이 지운다).
    ```sql
    WITH meta AS (
      SELECT c.id, sum((e->>'quantity')::int) AS q
      FROM sales_order_cancellations c, jsonb_array_elements(c.metadata->'cancelledLines') e
      GROUP BY c.id
    ), lines AS (
      SELECT cancellation_id AS id, sum(quantity) AS q FROM sales_order_cancellation_lines GROUP BY 1
    )
    SELECT count(*) FROM meta LEFT JOIN lines USING (id) WHERE lines.q IS DISTINCT FROM meta.q;
    ```
    V1·V2 전체취소 중 metadata 에 `cancelledLines` 를 실은 V2 full 은 디지털 보충분만큼 라인 합이 클 수 있다 — 0 이 아니면 그 행이 V2 full + 디지털 라인인지 먼저 본다.
- 배포 뒤: 새 취소 한 건이 생기면 그 행의 `metadata ? 'cancelledLines'` 가 false 이고 라인 행이 있는지 본다(관찰, 게이트 아님).

---

### Task 1: 쓰기 문이 취소 라인을 인자로 받는다 — metadata 에 `cancelledLines` 를 싣지 않는다

**Files:**
- Modify: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts` (시그니처, `readCancelledLines` 삭제, metadata 검사 추가)
- Modify: `apps/core/src/modules/sales-order/cancellation-record/cancellation-lines.ts:29-39,53-55` (`DeriveInput.cancelledLines` → `requestedLines`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts:662-674`(V1 전체), `:1536-1555`(V1 부분), `:1898-1916`(V2)
- Test: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts`, `cancellation-lines.spec.ts`, `apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts`
- Modify(호출 모양만): 쓰기 문을 직접 부르는 통합 spec 들 — `demand-series.writer.integration.spec.ts`, `line-composition.integration.spec.ts`, `wake-awaiting-matching.rule.integration.spec.ts`, `print-order.reader.integration.spec.ts`, `store-return-exchange.attempt.integration.spec.ts`, `store-return-exchange.claims.integration.spec.ts`, `claim-facts.integration.spec.ts`, `cancellation-record/__support__/cancellation-scenarios.ts`(있으면). `grep -rln "recordSalesOrderCancellation" apps/core/src` 가 정본 목록이다.

**Interfaces:**
- Consumes: 없음
- Produces:
  ```ts
  export type RequestedCancellationLine = { salesOrderLineId: string; quantity: number };
  export async function recordSalesOrderCancellation(
    trx: DbTx,
    values: SalesOrderCancellationInsert,
    requestedLines: readonly RequestedCancellationLine[] | null,
  ): Promise<SalesOrderCancellation>;
  // cancellation-lines.ts
  type DeriveInput = { scope; requestedLines: RequestedCancellationLine[] | null; effects; lines; priorCancelledByLine };
  ```
  `RequestedCancellationLine` 은 `cancellation-lines.ts` 에 두고 recorder 가 재수출한다.

- [ ] **Step 1: 실패하는 테스트**

`record-cancellation.integration.spec.ts` 에 셋(기존 `seedCancellableOrder`·`linesOf`·`cancellationsOf` 헬퍼 사용):

```ts
it('takes cancelled lines from the argument and keeps them out of metadata', async () => {
  // partial 1개를 쓰기 문에 직접 넘긴다 — metadata 는 호출자 키만
  const c = await recordSalesOrderCancellation(tx, { salesOrderId, cancellationScope: 'partial', effects: [], metadata: { sourceEventId: 'e-1' } },
    [{ salesOrderLineId: o.lineId, quantity: 1 }]);
  expect(c.metadata).toEqual({ sourceEventId: 'e-1' });
  expect(await linesOf(tx, c.id)).toEqual([{ salesOrderLineId: o.lineId, quantity: 1, shipmentPhase: 'before_shipment' }]);
});

it('rejects metadata that carries cancelledLines', async () => {
  await expect(recordSalesOrderCancellation(tx, { salesOrderId, cancellationScope: 'partial', effects: [],
    metadata: { cancelledLines: [{ salesOrderLineId: o.lineId, quantity: 1 }] } }, [{ salesOrderLineId: o.lineId, quantity: 1 }]))
    .rejects.toBeInstanceOf(CancellationLineDerivationError);
});
```

그리고 엔진 경로(`w.salesOrders.cancel` / 부분취소 / V2)를 거치는 기존 케이스의 `expect(cancellation.metadata).toMatchObject({ cancelledLines: … })`(현재 `:55`, `:116`)를 `expect(cancellation.metadata).not.toHaveProperty('cancelledLines')` 로 바꾼다 — 라인 행 단언은 이미 옆에 있다.

`sales-orders.service.spec.ts` 의 `metadata: expect.objectContaining({ cancelledLines: [...] })` 단언(현재 `:1014`, `:1044`, `:1203`, `:1246`, `:1334`, `:1359` 부근 — `grep -n "cancelledLines" ` 로 전부)을 각각
`expect(state.salesOrderCancellations[0].metadata).not.toHaveProperty('cancelledLines')` + `expect(state.salesOrderCancellationLines).toEqual([expect.objectContaining({ salesOrderLineId, quantity: 1 })])` 로 바꾼다. 이벤트 payload 의 `cancelledLines` 단언은 그대로 둔다.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/sales-orders.service.spec.ts`
Expected: FAIL — metadata 에 `cancelledLines` 가 아직 있다.
Run: 통합(`k6_it`) `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts`
Expected: FAIL — 3번째 인자가 없어 컴파일/실행 실패, 또는 metadata 단언 실패.

- [ ] **Step 3: 구현**

- `recordSalesOrderCancellation(trx, values, requestedLines)`: metadata 가 객체이고 `'cancelledLines' in metadata` 면 `CancellationLineDerivationError('취소 라인은 metadata 가 아니라 인자로 넘긴다')`. `deriveCancellationLines` 에 `requestedLines` 를 그대로 넘긴다. `readCancelledLines` 는 지운다(형식 검사는 인자가 타입을 가지므로 필요 없다).
- `cancellation-lines.ts`: 필드 이름만 `requestedLines` 로, 주석은 «쓰는 쪽이 넘긴 요청 라인. V1 전체취소는 null». 로직 불변.
- V1 전체(`:671`): `metadata: options.metadata ?? {}` 유지, 3번째 인자 `null`.
- V1 부분(`:1537-1555`): metadata 는 `options.metadata ?? {}` 만. 3번째 인자 `cancelledLines`(지금 지역 변수 그대로). 감사 로그의 `cancelledLines` 는 그대로.
- V2(`:1907-1916`): metadata 에서 `cancelledLines` 줄만 뺀다. 3번째 인자 `requestedSalesLines`.
- 통합 spec 들의 쓰기 문 직접 호출: `metadata: { cancelledLines: X }` → metadata 에서 빼고 3번째 인자 `X`. 다른 metadata 키가 없으면 `metadata` 줄을 지운다. V1 전체 모양을 흉내 낸 호출은 `null`.
- `cancellation-lines.spec.ts`: `cancelledLines:` → `requestedLines:` 이름만.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order apps/core/src/modules/product-matching` → 실패 0
Run: 통합(`k6_it`, `--runInBand`) — 위 Files 의 통합 spec 전부 + `apps/core/src/modules/sales-order` 전체 → 기준선 2건 외 실패 0
Run: `npm run type-check` → 기준선 3 외 0

- [ ] **Step 5: 커밋**

```bash
git add -A apps/core/src
git commit -m "refactor(core): 취소 라인을 쓰기 문 인자로 받고 metadata 에 싣지 않는다 (K6 PR6)"
```

---

### Task 2: 옛 대비·파서·일회성 백필을 지우고 가드를 넓힌다

**Files:**
- Modify: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts` (`loadPriorCancelledByLine` 은 라인 행 합만; `sumCancelledByLine` import·partial 조회 삭제; JSDoc 갱신)
- Delete: `apps/core/src/modules/product-matching/line-composition/partial-cancellation.ts`, `partial-cancellation.spec.ts`
- Delete: `scripts/ops/k6-backfill-cancellation-lines.ts`, `scripts/ops/k6-cancellation-lines-backfill.ts`, `scripts/ops/k6-cancellation-lines-backfill.spec.ts`
- Delete: `scripts/ops/1016-14-backfill-line-compositions.ts`, `scripts/ops/1016-14-line-composition-backfill.ts`, `scripts/ops/1016-14-line-composition-backfill.spec.ts`
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts` (`legacyCancelledByLine`·`expectLegacyAgrees` 와 그 호출 9곳 삭제, E1 케이스는 `canceled === 3` 단언만 남김)
- Modify: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts:119-140` (옛 partial 케이스 뒤집기)
- Modify: `apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts`
- Modify: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md` (:39-41, :157-158, Consequences 의 백필 공존 문단)

**Interfaces:**
- Consumes: Task 1 의 `recordSalesOrderCancellation(trx, values, requestedLines)`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트**

`record-cancellation.integration.spec.ts` 의 `'v1 full after a legacy partial … counts the legacy partial as prior'` 를 다음으로 바꾼다(픽스처는 그대로 — 쓰기 문을 우회해 metadata 만 있는 partial 을 넣는다):

```ts
it('a partial with metadata only (no line rows) is invisible to the recorder', async () => {
  // contract 뒤 취소 수량의 기록은 라인 행뿐이다. 이런 행이 라이브에 없다는 것은 배포 전 G1 이 확인한다.
  ...
  expect(await linesOf(tx, full!.id)).toEqual([{ salesOrderLineId: o.lineId, quantity: 2, shipmentPhase: 'before_shipment' }]);
});
```

`line-quantity-read.guard.spec.ts`:
- `walk` 대상을 `apps/core/src` 와 `scripts`(비-spec `.ts`/`.js`) 둘로 넓히는 `filesMatchingIn(roots, predicate)` 를 두고, 아래 두 케이스만 그걸 쓴다(나머지 케이스는 `apps/core/src` 그대로).
- `'retired cancelled-quantity parsers stay gone'` 의 정규식에 `\bsumCancelledByLine\b|\breadCancelledLines\b|\blegacyCancelledByLine\b` 를 더한다 → `toEqual([])`.
- `'sumCancelledByLine stays with the recorder'` 케이스와 `PARTIAL_PARSER` 상수를 지운다.
- 새 케이스 `'nothing reads cancelledLines out of cancellation metadata'` — `/metadata\??\.cancelledLines|metadata\??\.\['cancelledLines'\]|Reflect\.get\([^)]*'cancelledLines'\)|->\s*'cancelledLines'/` → `toEqual([])`. (쓰기 쪽 재발은 Task 1 의 런타임 검사가 잡는다 — 객체 리터럴 `cancelledLines:` 는 이벤트 payload 와 구별할 수 없어 정규식으로 막지 않는다.)
- 파일 머리 주석을 «PR 6 이 metadata 파서를 모두 지웠다»로 갱신.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts`
Expected: FAIL — `partial-cancellation.ts`·`record-cancellation.ts`·두 백필 스크립트에서 `sumCancelledByLine`/`metadata.cancelledLines` 가 걸린다.
Run: recorder 통합 spec(`k6_it`) → FAIL — 라인 행이 `quantity: 1`(옛 대비가 metadata 를 prior 로 셈).

- [ ] **Step 3: 구현**

- `loadPriorCancelledByLine(trx, salesOrderId)`: `sales_order_cancellation_lines` 를 라인별로 더한 Map 만 돌려준다. JSDoc: «이 주문의 라인별 이미 취소된 수량(갈래 무관) — 라인 행이 유일한 기록이다(K6 PR6).»
- 위 Delete 목록을 `git rm`. `grep -rn "partial-cancellation'\|1016-14-\|k6-.*backfill" apps scripts libs package.json` 가 문서 외 0 이어야 한다(`docs/` 의 옛 계획·스펙 언급은 이력이라 둔다).
- `line-quantities.integration.spec.ts`: 옛 정의 헬퍼 둘과 호출 삭제, `sumCancelledByLine` import 삭제.
- ADR-0047: :39-41 의 «남은 `sumCancelledByLine` 은 … PR 6 에서 지운다» → «PR 6 이 지웠다»; :157 PR 6 줄을 진행 기록 꼴(무엇을 지웠나, C1 마이그 없음, C2 스크립트 삭제, C3 런타임 검사, G1·G2)로; Consequences 의 «옛 `cancelledLines` 와 새 라인 행이 공존하는 동안 …» 문단 끝에 «PR 6 부터 공존하지 않는다 — 옛 행의 JSON 은 이력으로만 남는다» 한 문장.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order apps/core/src/modules/product-matching scripts` → 실패 0
Run: 통합(`k6_it`, `--runInBand`) `apps/core/src/modules/sales-order` + Task 1 Files 의 통합 spec → 기준선 2건 외 0
Run: `npm run type-check` → 기준선 3 외 0
Run: `npx jest --maxWorkers=2` 전체 → 로컬 환경 기준선 외 0

- [ ] **Step 5: 커밋**

```bash
git add -A apps/core/src scripts docs/adr/0047-line-quantity-facts-one-record-one-reader.md
git commit -m "refactor(core): 취소 metadata 파서와 일회성 백필을 지운다 — 취소 수량의 기록은 라인 행뿐 (K6 PR6)"
```
