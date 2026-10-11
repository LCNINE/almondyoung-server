# PR 5 — core + admin-web: 채널 취소는 요청 순간 확정, 정산은 따로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널(Medusa) 주문 취소를 core 가 요청 트랜잭션 안에서 **물리적으로 확정**하고(요청 행 `settling`), 환불 정산은 사실·리컨실러(관찰)·운영자 조치
([다시 시도]·[계좌 송금으로 환불])로 끝까지 따라간다. 고객은 즉시 «취소 완료 · 환불 처리 중/지연/계좌 송금 예정/완료»를 본다 — **«새 흐름이 켜진다».**

**Architecture:** 요청 행의 상태에 `settling` 을 더하고(additive 마이그) 정산 상태는 `metadata.settlement = { state: in_progress|refused, mode, since, lastFailure? }` 에 둔다.
«환불 지연»은 저장하지 않고 **확정 시각(요청 행 `created_at`) + 30분**으로 판정 SQL·actions API·admin-web 이 같은 상수에서 각자 계산한다. 옛 `requested` 행은 옛 규칙
(보류·[다시 보내기]·[요청 접기]·옛 사실)으로 끝까지 돈다 — 두 종류는 **행 상태 하나로** 갈린다. 리컨실러 규칙은 기존 틀(백오프·포기·지문)을 그대로 쓰고 관찰 모드로 나간다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), zod, Kafka 아웃박스(`@app/events`), Jest(ts-jest), Next.js 15 admin-web(순수함수 스펙 + `tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` — **§5**(상태 모델·화면 표), **§7.3·§7.4**(이 PR 의 본문), **§8.1·§8.2**, §9.2·§9.3, §10 core·admin-web,
§12(ADR-0044). 지시문: `docs/superpowers/briefs/2026-10-12-channel-cancel-settlement-pr5-core-admin.md`. 기준 커밋 develop `be162acd4`(PR 0~4 머지·라이브, 2026-10-12).
앞 PR 이 넘긴 계약: PR 3 계획 «PR 5 에 넘길 것» 1~7 + #1050 D1~D6, PR 4 #1051 «PR 5 에 넘길 것» 1~6, PR 2 #1049 D8·알려진 한계, PR 1 계획 «admin-web 송금 대기 노출은 PR 5».

---

## 먼저 판정한 것 (지시문 «먼저 판정할 것» 1~7 + 계획 중 발견)

### 판정 1 — 한 PR (사용자 결정 2026-10-12)

**정한 것:** core·admin-web 을 한 PR 로 낸다(사용자 결정). 나누지 않으면 «5a 만 라이브인 동안 보드에 «환불 거절»이 뜨는데 출구 버튼이 없는» 창이 생기지 않는다.

**남는 창(같은 스택, 순서를 못 정한다 — 메모리 `sst-single-stack-no-deploy-order`):**
- **새 admin-web + 옛 core**(Lambda 가 먼저 바뀌는 흔한 경우): 옛 core 는 `settling` 행·`settle_*` 상태·`settlement` 칸을 내지 않는다 → 새 버튼은 **그리는 조건이 안 서서** 안 보인다.
  404 를 부를 일이 없다. admin-web 의 새 파서는 `settlement` 가 없는 응답을 `null` 로 읽는다(Task 8 테스트).
- **옛 admin-web + 새 core**(짧다): 옛 `toCancelRequestView` 는 `settling` 을 모르는 값이라 `null` → 주문 내역에서 부분취소 정산 중 주문에 «취소» 버튼이 다시 보이고(누르면 core 가
  나머지의 전체취소로 받는다 — 정상 경로), 보드는 `settle_refused` 같은 원문 상태명을 버튼 없이 보인다. 배포가 끝나면 사라진다.

### 판정 2 — 물리 적용은 요청 경로에서 `SalesOrdersService.cancel()` 을 «그대로» 부른다. savepoint 없이, 실패면 요청 전체가 롤백

**확인한 사실(develop `be162acd4`):**
- 지금 물리 적용은 두 곳이다: 부분은 settler `applyPhysical`(savepoint 안 `salesOrders.cancel(lines…)`, 거절이면 요청 `superseded(APPLY_REFUSED)`), 전체는
  `handleOrderCancelled` 의 `salesOrders.cancel()`(수집 때).
- `cancel()` 은 **이미 전체 취소된 주문이면 아무것도 하지 않고 돌아온다** — V1 경로는 `existingCancellation` 분기(`sales-orders.service.ts:521-532`, 상태 보정·백로그 닫기만),
  V2 경로는 `cancelV2Outstanding` 첫 줄(`:1801-1812`). `SalesOrderCancelled` 도 다시 내지 않는다. → 스펙 §7.3 «이미 취소된 판매주문이면 아무것도 하지 않아야 한다»는
  **지금 코드로 성립한다.** 고칠 것 없음, 통합 테스트로 못 박는다(Task 3).
- `SalesOrderCancelled` 의 소비자는 ugc-service 리뷰 보상 회수 하나다(`apps/ugc-service/src/reviews/rewards/order-cancellation.consumer.ts`) — 확정 순간에 나가도 된다.

**정한 것:** `ChannelCancelRequestManager.request()` 가 계획(`planCancellation`) 직후, **행을 쓰기 전에** `this.salesOrders.cancel(so.id, …, trx)` 를 부른다.
전체 범위면 줄 없이(전체 취소), 부분이면 `plan.lines`. 거절은 잡지 않는다 — 예외가 요청 트랜잭션을 통째로 되돌려 **행·명령·취소 기록 무엇도 남지 않는다**(§10 core 첫 줄).
멱등 키는 지금 settler 와 같은 `metadata.sourceEventId = cancel-request:<requestId>`.

**새 흐름에서 `APPLY_REFUSED`·`CHANNEL_CHANGE_MISMATCH` 는 생기지 않는다.** 둘 다 «수집 때 적용»의 산물이다 — 적용 거절은 이제 요청 거절(400/409)이고, 채널 변경과 요청 줄의
대조는 하지 않는다(이미 적용했다). 그 분기는 옛 `requested` 행용으로 그대로 남는다.

**대신 생기는 것 — Medusa 가 아직 안 줄였는데 다른 변경이 수집될 때(D10).** core 는 확정 때 줄였고 Medusa 는 정산이 끝나야 줄인다. 그 사이에 주소 변경 같은 `OrderModified` 가
오면 5번 diff 는 요청분을 **«늘어남»**(`quantity_correction`, corrected > before)으로 본다 → `OUT_OF_SCOPE` «반영 대기 변경» 오탐. settler 가 정산 중 부분 요청에 대해
**채널 진행 기록이 아직 없으면** 요청 줄과 정확히 같은 늘어남을 먹는다(`takeRequestedIncreases`). 진행 기록이 `edited`·`refunded` 면 Medusa 가 이미 줄였으니 diff 에 없다.

**비용:** 확정 트랜잭션이 길어진다(출고지시·예약 해제·상자 취소까지). 지금 수집 때 하던 일이 요청 HTTP 안으로 옮겨 온 것이라 총량은 같다.

### 판정 3 — 리컨실러 백오프·포기는 틀 그대로 쓴다 (D3)

**확인한 사실:** 틀이 이미 갖고 있다 — `order-reconcile.state.ts:5-10` `MAX_ATTEMPTS = 5`, `RETRY_DELAYS_MIN = [1, 4, 16, 64, 256]`, 포기 뒤 `GAVE_UP_RECHECK_MIN = 1024`,
지문이 바뀌면 리셋(`effectivePrior`). 포기 뒤에도 1024분마다 다시 `act` 한다(`chooseStep` — 포기한 행은 `give_up` 이 아니라 `act`). 포기는 보드에 «자동 멈춤 · #36» 배지로 뜬다.

**정한 것:** 틀을 바꾸지 않는다. 스펙 §7.3 의 «1분 → 5분 → 15분 → 이후 1시간, 포기 없음»과 다르다.

**근거:**
- 스펙 §7.3 자신이 «백오프·포기를 틀이 지원하는지 확인하고, **없으면** 틀에 더한다(규칙마다 따로 두지 않는다)»라고 적었다 — 있다.
- 틀을 규칙별 백오프로 바꾸면 라이브의 12번(실행)·25번(관찰)에 닿는다.
- 이 PR 은 **관찰 모드**라 백오프가 동작에 닿지 않는다(관찰은 `would_act` 후 10분 뒤 재확인만). 실행 전환은 PR 6 — 그때 실측으로 다시 본다.
- 스모크 S4(40분 장애 뒤 스스로 회복)는 1·4·16·64 → 85분 시점 시도에서 성립한다. 3영업일 기한 안에는 포기 뒤에도 1024분(≈17시간) 주기로 최소 3번 더 시도한다.
- «자동 멈춤» 배지는 오히려 운영자에게 «리컨실러가 5번 해 보고 손을 놓았다»를 알린다.

**비용:** 실행 전환 뒤 일시 장애가 6시간을 넘으면 재시도 간격이 17시간으로 벌어진다. 운영자 [다시 시도]가 출구다.

### 판정 4 — `delayed` 는 저장하지 않는다. 정본은 «확정 시각 + 30분» 상수 하나 (D1·D13)

**정한 것:**
- `metadata.settlement.state ∈ in_progress | refused` 만 저장한다. `delayed` 는 `state = in_progress` 이고 **확정 시각이 30분보다 오래됐을 때**다.
- 확정 시각 = **요청 행의 `created_at`.** 확정 트랜잭션이 `createdAt`·`occurredAt`·`metadata.request.appliedAt` 을 같은 `requestedAt` 값으로 쓴다.
- 상수 `SETTLE_DELAYED_AFTER_MS = 30분` 은 `order-progress.thresholds.ts` 한 곳(스펙 §7.4 «기준 상수는 thresholds.ts»). 판정 SQL(`a.created_at < now − 30분`), actions API·
  admin 뷰(`settlementPhase()`)가 같은 상수를 읽는다 → 스토어프론트 `delayed` 와 보드 `settle_delayed` 가 같은 순간에 바뀐다(보드는 투영 갱신 1분 해상도).

**근거:** 메타에 쓰려면 «30분이 지난 순간»에 누군가 행을 고쳐야 한다 — 크론 하나가 더 생기거나, 리컨실러(관찰 모드에선 아무것도 안 쓴다)에 기대야 한다. 계산이면 쓰는 주체가 필요 없다.
SQL 이 jsonb 문자열을 `timestamptz` 로 캐스트하지 않으므로 손상된 메타데이터 한 행이 투영 갱신 전체를 죽이지 않는다.

**리컨실러 지문은 저장된 값만 쓴다:** `요청 id · mode · since`(정산 중이고 거절 아닌 것). 30분 경계에서 지문이 바뀌어 횟수가 리셋되지 않는다. 운영자 [다시 시도]·[계좌 송금으로 환불]은 `since` 를 새로
찍으므로 지문이 바뀐다 = 리셋(D2).

### 판정 5 — actions API: 정산 중인 요청이 말하고, 끝난 수동 정산만 wallet 에 묻는다 (D9)

**정한 것(Medusa 주문만):** 요청 행들(`settling` 과, `settlement` 칸이 있는 `applied`)로 순수함수 `channelRefundStatus()` 가 값을 낸다.

| 요청 행 | `refundStatus`·`refundSummary.status` |
| --- | --- |
| 정산 중 하나라도 «지연»·«거절» | `delayed` |
| (아니면) 정산 중 하나라도 `mode = manual` | `transfer_pending` |
| (아니면) 정산 중 있음 | `pending` |
| 정산 중 없음 · 가장 최근 정산이 `manual` 로 끝남 · wallet 에 `MANUAL` + `PENDING` 행 있음 또는 wallet 응답 없음 | `transfer_pending` |
| 그 밖 | 지금 도출 그대로(수집된 환불 → `succeeded` 등) |

- 위 값이 나오면 `refundStatus` 와 `refundSummary.status` 에 **같은 값**을 싣는다(PR 4 넘길 것 3). 판매주문이 취소 안 된 부분취소 정산에도 싣는다.
- `delayed`·`transfer_pending` 의 `expectedProcessingMessage` 는 `null`(PR 4 넘길 것 4) — 문구 정본은 스토어프론트 i18n.
- **wallet 은 «가장 최근 정산이 수동으로 끝난» 주문에서만 부른다**(`GET /v1/payment-intents/:id/refunds`, PR 1). 이유: 수동 정산은 Medusa 에 Refund 행(PENDING 을 성공으로 받음)이
  생겨 수집된 환불이 `succeeded` 로 보이는데, 실제 송금은 운영자가 [완료 처리]를 눌러야 끝난다(스펙 §8.2 «수동은 wallet SUCCEEDED»).
- **wallet 호출 실패·시간 초과(2초) → `transfer_pending`.** 모르면 «아직 송금 전»이 안전하다 — «완료»라고 했다가 돈이 안 갔으면 거짓이다.
- **배치 엔드포인트**(`by-channel-order/actions/batch`)도 같은 `buildActionsView` 를 쓴다. 수동 정산은 운영자가 하나씩 고르는 드문 경로라 페이지당 호출 수가 작다 — 상한은 두지 않고
  호출마다 `AbortSignal.timeout(2000)` 을 건다. 목록이 wallet 장애로 2초 이상 막히지 않는다.

### 판정 6 — 스토어프론트가 Medusa 상태를 직접 읽는 곳: 모순 넷, 전부 PR 6 로 넘긴다 (멈추지 않는다)

확정(core `cancelled`)과 정산 완료(Medusa `canceled`) 사이에 core actions 데이터가 있으면 머리 상태·배지·취소 버튼·목록 상태 글자는 core `orderStatus` 가 이긴다
(`order-status-display.ts:32-44`, `order-status-badges.tsx:127-166`, `order-list.tsx:443-448`). Medusa 필드가 그대로 비치는 곳:

1. 상세 «결제 상태» 줄(`order-details-desktop.tsx:171-173`, `-mobile.tsx:178-180`) — Medusa `payment_status` 만 읽어 «결제 완료». 같은 화면의 환불 상자는 «환불 처리 중»이라 «결제는
   됐고 환불이 진행 중»으로 읽힌다 — 거짓은 아니다.
2. 목록 «구매확정» 버튼(`order-actions.tsx:114-117`) — Medusa `payment_status === 'authorized'` 일 때만. **사용자 확인(2026-10-12) — 중요하지 않다:** 구매확정은 «결제 확정 + 리뷰 자격»인데,
   결제 확정은 체크아웃에서 끝나고(주문→확정 중앙값 1.2초, 96% 10분 안, 90일 미확정 4건 — `apps/medusa/src/scripts/lib/auto-review-eligibility.ts` 주석의 라이브 실측) 리뷰 자격은 자동 잡이 만든다.
   버튼이 뜨는 주문 자체가 거의 없고, 눌러도 돈이 잘못 나가지 않는다.
3. 마이페이지 홈 «주문 내역» 카드(`shipping-status-wrapper.tsx:19-21`) — Medusa `status !== 'canceled'` 로 카드에 남는다(라벨은 core 가 «취소됨»으로 덮음). Medusa 취소 전까지 남았다 사라진다.
4. 상세 «배송 조회» 노출(`showTrack`)이 Medusa `fulfillment_status` 를 OR 로 본다 — core 취소 주문에 Medusa 이행이 있을 때만. 실질 0.

**정한 것:** 이 PR 은 스토어프론트를 바꾸지 않는다(지시문). 넷 다 «PR 6 에 넘길 것»에 적는다. 어느 것도 «취소 완료»를 뒤집거나 출고·돈에 닿지 않는다.

### 판정 7 — 옛 `requested` 행과의 공존: 옛 행은 옛 규칙만, 새 행은 새 규칙만

**정한 것:**
- **보류 관문**(`cancel-request-hold.ts`)은 `status = 'requested'` 만 본다 — 그대로. `settling` 은 보류가 아니다.
- **옛 사실**(`reject()`·`markStalled()`)은 이미 `status !== 'requested'` 면 버린다 → `settling` 행엔 닿지 않는다(PR 3 넘길 것 1 — 늦게 온 `Stalled` 가 `refused` 를 되돌리지 않는다).
  스펙 §7.3 «옛 사실을 `settling` 행에서 `retryable: true` 로 읽기»는 하지 않는다(D4): 그 문장은 «새 core + 옛 adapter» 대비였는데 PR 3 이 먼저 라이브라 그 조합이 없다.
- **`ChannelOrderSettlementFailed`** 는 `settling` 행만 읽는다. 옛 `requested` 행에 오면 로그만 남기고 버린다(D12) — 상태를 바꾸면 보류가 풀리고(PR 3 넘길 것 2), 옛 행에 새 칸을 섞으면
  보드·admin-web 이 두 모양을 다 읽어야 한다. 배포 전 옛 행 수를 센다(아래 «배포»).
- **settler**: 옛 `requested` 분기(`findOpen`)는 손대지 않고, `settling` 분기를 **그 뒤에** 더한다. `OrderCancelled` 수집은 둘 다 처리한다.
- **[다시 보내기]·[요청 접기]**(`resend`·`withdraw`)는 `findOpen`(= `requested`)만 본다 — 그대로. 새 행에는 [다시 시도]·[계좌 송금으로 환불]만 있다(스펙 §7.3).
- **보드:** 같은 단계(`cancel_request`)에 옛 상태(`cancel_requested`·`cancel_edited`)와 새 상태(`settle_*`)가 섞인다. 행마다 상태로 조치가 갈린다(옛 → 다시 보내기·접기, 새 → 다시 시도·계좌 송금).
- **판정 SQL 의 정렬:** 한 주문에 옛 행과 새 행이 같이 있으면 옛 행(보류 중)이 대표다.
- **요청 생성:** 옛 `requested` 행이 열려 있으면 새 요청은 지금처럼 그 행을 돌려받는다(`findOpen` 분기 그대로) — 옛 행이 끝나야 새 흐름이 시작된다.

### 계획 중 발견 — 반드시 고칠 것 둘

- **🔴 `GET /sales-orders/:id` 가 `settling` 행을 만나면 500.** core `toCancelRequestView` 는 모르는 상태에 던진다(`channel-cancel-request.types.ts:92-101`), `getOne` 이
  `latestFor` 결과를 그대로 넘긴다(`sales-orders.service.ts:757-775`). 고객 actions API 의 `latestFor` 도 같다. → Task 1 이 상태 목록에 `settling` 을 더한다.
- **wallet «송금 대기» 목록 화면은 없다.** [완료 처리]는 결제 상세(`/payments/[id]`, `payment-detail-main.tsx:318-394`)의 환불 표에만 있고 `manualConfirmable` 로 그린다(PR 1 이 `MANUAL`
  행을 확인 가능으로 넓혔다 — 상세 조회 기준). «환불 내역» 목록(`/payments/refunds`)엔 조치 칸이 없고, 관리자 목록 API 는 `manualConfirmable: false` 를 박아 둔다(조인 없음, PR 1 에서 그대로 둠).
  → 스펙 §8.1 «송금 대기 화면 필터를 넓힌다»는 **«환불 내역» 목록에 «계좌 송금» 표시 + 주문 행에서 결제 상세로 가는 링크**로 갈음한다(D7). wallet 은 바꾸지 않는다.

---

## 스펙과 다른 점 (PR 본문에 옮긴다)

| # | 자리 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| D1 | `settlement.state` | `in_progress`·`refused` 만 저장. `delayed` 는 확정 시각 + 30분으로 계산 | 판정 4 — 30분 순간에 쓸 주체가 없다 |
| D2 | `settlement.since` | 새 칸 — 정산을 (다시) 시작한 시각. 이보다 이른 `SettlementFailed` 는 버린다. 리컨실러 지문에 들어간다 | 운영자 [다시 시도] 뒤 늦게 온 지난 시도의 거절이 상태를 되돌리지 않게(PR 3 넘길 것 3) |
| D3 | 리컨실러 백오프 | 틀 그대로(1·4·16·64·256분, 5회 뒤 «자동 멈춤», 1024분 재확인) | 판정 3 |
| D4 | 옛 사실(`Stalled`·`Rejected`)이 `settling` 행에 오면 | 버린다(스펙: `retryable: true` 로 읽기) | 판정 7, PR 3 넘길 것 1 |
| D5 | 판정 SQL 의 규칙 이름 | `settling` 행은 `cancel_settle`(단계는 같은 `cancel_request`). 상자 규칙 제외(D16)에 넣지 않는다 | 정산 중엔 보류가 없다 — 부분취소의 남은 상자는 상자 규칙(25번 등)의 도움을 받아야 한다 |
| D6 | 보드 «갇힘» | 세부 상태가 단계 기준을 덮는다: `settle_in_progress` 는 갇히지 않음, `settle_delayed`·`settle_refused` 는 들어온 순간 갇힘 | 스펙 §8.1 «settle_in_progress 는 갇힘 기준 밖이라 숨는다». 단계 기준(5분)이면 정산 중 6분째에 빨갛게 뜬다 |
| D7 | «wallet 송금 대기 화면» | 그 화면이 없다 → «환불 내역» 목록에 «계좌 송금» 칸, 주문 행·보드에 결제 상세 링크. 확인 창 문구도 실제 화면 이름으로 | 계획 중 발견 |
| D8 | [다시 시도]·[계좌 송금으로 환불] | 정산 중 30분 안(`in_progress`)엔 409 | 막 보낸 명령과 겹쳐 같은 주문에 정산 두 개가 돈다. 스펙 §5.2 도 그 상태엔 «운영자 조치 없음» |
| D9 | 수동 정산 «완료» 판정 | 가장 최근 정산이 `manual` 로 끝난 주문만 wallet 목록 조회, 실패·2초 초과 = `transfer_pending` | 판정 5 |
| D10 | Medusa 미반영 부분취소의 «늘어남» | 정산 중 부분 요청이 진행 기록 없을 때 같은 크기의 늘어남을 먹는다 | 판정 2 — «반영 대기 변경» 오탐 |
| D11 | «주문 상세 취소 영역» | admin-web 에 주문 상세 화면이 없다 → 주문 내역 표의 취소 칸 + 정체 보드 행 | 계획 중 확인 |
| D12 | 옛 `requested` 행에 온 `SettlementFailed` | 로그만, 상태·메타 그대로 | 판정 7 |
| D13 | 확정 시각 | 요청 행 `created_at`(= `occurredAt` = `metadata.request.appliedAt`, 같은 값으로 쓴다) | 판정 4 — SQL 에서 jsonb 캐스트 없이 |

---

## PR 6 에 넘길 것

- **리컨실러 실행 모드 전환**과 channel-adapter 일시 실패 ack 전환(PR 3 넘길 것)을 **같은 배포**에. 그 전에 관찰 로그로 거짓 양성(정산이 끝났는데 `would_act`)을 본다.
  백오프(판정 3)는 그때 실측으로 다시 본다.
- 옛 `requested` 행이 0 이 된 뒤: `resend`·`withdraw`·보류 관문(`cancel-request-hold.ts`)·settler 옛 분기·`reject`·`markStalled`·보드의 옛 상태와 버튼, 계약의 옛 사실 정리.
- 스토어프론트 Medusa 직접 읽기 넷(판정 6): 상세 «결제 상태» 줄, «구매확정» 버튼 조건에 core `orderStatus`, 마이페이지 홈 카드 필터, `showTrack`. 다시 읽기(`waitForCancelOutcome`) 삭제와 같이.
- wallet 관리자 환불 «목록»의 `manualConfirmable` — `execution = MANUAL` 행은 조인 없이 판정된다(`manual-confirmable.ts`). 그러면 «환불 내역» 목록에 [완료 처리]를 바로 둘 수 있다(wallet 변경).
- admin-web 결제 상세 사이드바의 토스트 «환불 내역에서 완료 처리해 주세요»(`payment-detail-sidebar.tsx:159-160`)는 없는 버튼을 가리킨다 — 위와 같이 고친다.
- admin-web `RefundDto` 에 `failureCode`·`retryable`(wallet 이 이미 낸다) — 환불 내역에서 거절 사유를 보이려면.

---

## Global Constraints

- **Medusa·channel-adapter·wallet·스토어프론트·`packages/event-contracts` 는 바꾸지 않는다.** 바꿔야 한다는 결론이 나오면 멈추고 «PR 6 에 넘길 것» 또는 사용자 질문으로
- 스펙 결정 S1~S11 을 다시 묻지 않는다. 스펙과 코드가 어긋나면 스펙이 정본, 이 계획의 D 표에 적는다
- 마이그레이션은 additive 하나(`sales_order_amendments_status_check` 에 `settling`) — 배포는 **`migrate → deploy`**
- CLAUDE.md 트랜잭션 규칙: `this.db.run(fn, tx)` + 공개 메서드 `tx?: DbTx` 마지막 인자, private 은 `tx: DbTx` 필수, per-class `inTx` 금지. Inventory Query Rules: `db.query.*`·`with`·`as` 금지
  (예외: 원시 `execute` 결과 타이핑은 이웃 코드와 같은 «문서화된 캐스트»만)
- 서비스는 `@app/shared` 도메인 예외(`NotFoundError`·`ConflictError`·`BadRequestError`), 컨트롤러는 try/catch 없이 위임
- 상수 하나: `SETTLE_DELAYED_AFTER_MS = 30분`, `SETTLE_DEADLINE_BUSINESS_DAYS = 3`, `SETTLEMENT_REISSUE_GRACE_MS = 1분` — `order-progress.thresholds.ts`. 다른 곳에 30·3·1 을 다시 적지 않는다
- 영업일은 **한국 시간 요일**로 센다(주말만 뺀다, 공휴일 범위 밖 — 스펙 §13). 런타임 TZ 를 읽지 않는다(jest 는 UTC, CLAUDE.md «jest 는 UTC 로 뜬다»)
- 문구(스펙 그대로): 보드 `settle_delayed` «환불 지연», `settle_refused` «환불 거절». 수동 환불 확인 창은 D7 문구(Task 9)
- 고객 응답: 새 `cancelUnavailableReason` 값을 더하지 않는다(PR 4 넘길 것 6). `cancelRequestStatus` 에 `settling` 을 싣지 않는다(PR 4 넘길 것 2)
- admin-web: 판정은 `*.shape.ts` 순수함수 + `.spec.ts`(메모리 `admin-web-no-component-tests`). 브라우저 `confirm()` 금지(보드의 기존 주석). 수동 환불 확인은 shadcn `Dialog`
- 새 크론 없음. 리컨실러 규칙은 기존 `@CronOnce('order-reconcile')` 틀에 등록만
- 게이트 기준선(develop `be162acd4`, 2026-10-12 실측): `npm run audit:event-handlers` **핸들러 103개 · 발견 없음** → 이 PR 뒤 **104개 · 발견 없음**.
  `npm run audit:event-publishers` **주입 지점 45개 · 발견 없음** → 그대로. `npm run audit:consume-validation -- --gate` **위반 없음**. admin-web `npx tsc --noEmit` **0**.
  루트 `npm run type-check` 0 · `npx jest` 0(CLAUDE.md 기준선). jest OOM 이 나면 `--maxWorkers=2`(메모리 `picking-plan-layer-extraction`)
- 라우트를 더하면 `npx jest scripts/security` 를 돌린다 — IDOR 가드가 컨트롤러 줄 번호를 좌표로 쓴다(메모리 `idor-guard-line-coordinates`)

## Review Focus

- **한 주문에 정산 중 요청이 둘**(부분 A 가 거절된 채 고객이 나머지를 전체취소 B). 보드는 주문당 한 행이라 가장 나쁜 상태(`settle_refused`)와 그 요청의 조치가 떠야 하고, Medusa 전체취소가
  수집되면 B 는 `applied`, A 는 `superseded(CHANNEL_FULL_CANCEL)`. Task 3 «정산 중 요청 둘 + 전체취소 수집»·Task 5 «정산 중 요청 둘 → 가장 나쁜 상태» 테스트가 지킨다.
- **Medusa 가 아직 안 줄였는데 주소 변경이 수집된다.** «수량 늘어남»이 «반영 대기 변경»으로 떠 운영자를 헷갈리게 하면 안 된다. Task 3 «진행 기록 없는 부분 정산 + 주소 변경» 테스트가 지킨다.
- **지난 시도의 거절이 [다시 시도] 뒤에 늦게 도착한다**(Kafka 재시도·아웃박스 순서). `refused` 로 되돌리면 보드가 거짓말한다. Task 3 «since 보다 이른 사실은 버린다» 테스트가 지킨다.
- **고객이 취소 버튼을 누른 직후의 응답.** 요청 «전»에 읽은 판매주문으로 응답하면 «취소를 요청했어요» → 2초 뒤 «취소되었습니다»로 두 번 말한다(PR 4 넘길 것 1). Task 7 «응답은 확정 뒤 판매주문» 테스트가 지킨다.
- **wallet 이 느리거나 죽었다.** 수동 정산 주문이 한 페이지에 섞인 고객 주문 목록이 wallet 을 기다리며 멈추거나 «환불 완료»라고 거짓말하면 안 된다. Task 7 «wallet 실패·시간 초과 → transfer_pending» 테스트가 지킨다.

---

## 실행 준비 (실행 세션이 한다)

```bash
M=/home/pauseb/workspace/almondyoung-server
W=$M/.claude/worktrees/feat-1016-36-core-settlement
git -C $M fetch origin
git -C $M worktree add $W -b feat/1016-36-core-settlement origin/develop
for p in node_modules apps/admin-web/node_modules native/warehouse-app/node_modules web/almondyoung-storefront/node_modules; do ln -s $M/$p $W/$p; done
git -C $W rev-parse --show-toplevel && git -C $W branch --show-current   # $W · feat/1016-36-core-settlement
```

이후 **모든 명령은 `$W` 에서.** 서브에이전트 dispatch 첫 줄: `cd $W` → `git rev-parse --show-toplevel && git branch --show-current` → 기대값과 다르면 STOP(특히 `develop` 이면).
**커밋 전 두 명령 출력을 보고서에 넣는다.** 태스크마다 `git -C $M status --short` 와 `git -C $M rev-parse develop origin/develop` 로 메인 오염을 확인한다(메모리 `subagent-worktree-contamination` —
6회 재발, 복구용 git 명령은 권한 분류기에 막힌다). develop 을 어떤 이유로도 건드리지 않는다(reset·revert·cherry-pick 금지).

core 통합 스펙: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <패턴>`(워크트리에서 필수 — 메모리 `core-integration-tests-local`). 러너가 migrate 단계에서
조용히 멈추면 임시 DB 에 `drizzle-kit migrate` 후 `DATABASE_URL=… npx jest --runInBand --runTestsByPath <파일>`(메모리 `reconciler-row12-design` 🔑). 사전 RED 8 suite 는 새 실패가 아니다(같은 메모리).

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| Modify `apps/core/src/modules/inventory/schema/inventory.schema.ts:1508-1511` | 상태 check 에 `settling` |
| Create `apps/core/drizzle/<ts>_add-settling-cancel-request-status.sql` (+ `meta/`) | 생성된 마이그 |
| Modify `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts:21`, `dto/list-sales-order-amendments.dto.ts:6-8`, `dto/sales-order-amendment-response.dto.ts:44` | 상태 어휘에 `settling` |
| Modify `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` | 정산 상수·영업일 기한·세부 상태 어휘·상태별 갇힘 |
| Modify `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts` | `settling`, `settlement` 메타 모양, `settlementPhase`·`toSettlementView`, 뷰의 `settlement`·`refundMode` |
| Modify `…/channel-cancel-request/channel-cancel-request.reader.ts` | `findSettling`·`settlementRowsFor` |
| Modify `…/channel-cancel-request/channel-cancel-request.manager.ts` | 확정 트랜잭션, 정산 실패 기록, 다시 시도·계좌 송금, 리컨실러용 재발행 |
| Modify `…/channel-cancel-request/channel-cancel-settler.ts` | `settling` 행 종결·늘어남 흡수 |
| Modify `…/channel-cancel-request/channel-cancel-match.ts` | `takeRequestedIncreases` |
| Modify `…/channel-cancel-request/channel-cancel-request.service.ts` | 위 공개 메서드 위임 |
| Modify `…/channel-cancel-request/__support__/cancel-request.fixtures.ts` | `seedLegacyRequest`(옛 행) |
| Modify `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` | `ChannelOrderSettlementFailed` 핸들러 |
| Modify `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts` | `retry`·`manual-refund` 라우트 |
| Modify `apps/core/src/modules/sales-order/sales-order.module.ts` | `ChannelCancelRequestService` export |
| Modify `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts` | `creq` 새 상태·`cancel_settle` |
| Modify `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts`, `dto/order-progress-response.dto.ts` | 상태별 갇힘, 목록 행의 `settlement` |
| Create `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts` (+ `.spec.ts`) | 36번 규칙(관찰) |
| Modify `…/order-reconcile/order-reconcile.registry.ts`, `order-reconcile.module.ts`, `order-reconcile.subject.ts`(주석) | 등록·배선 |
| Create `apps/core/src/modules/sales-order/services/channel-refund-status.ts` (+ `.spec.ts`) | actions API 의 정산 → 환불 배지 순수함수 |
| Modify `apps/core/src/modules/sales-order/services/wallet-refund.client.ts` (+ spec) | `listRefundsByIntent` |
| Modify `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts`, `dto/store-order-actions.dto.ts` (+ spec) | 새 환불 값, 확정 뒤 응답 |
| Modify `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts` (+ spec) | `settling`·`settlement` 뷰·조치·문구·토스트 |
| Modify `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` (+ spec) | `settle_*` 라벨, 행의 `settlement` |
| Modify `apps/admin-web/src/lib/api/domains/wallet/refund-execution.ts`(Create) + `src/lib/types/dto/wallet.ts` | «계좌 송금» 표시 |
| Modify `apps/admin-web/src/lib/api/domains/orders/sales-orders.client.ts`, `src/lib/services/orders/mutations.ts` | 두 조치 호출 |
| Create `apps/admin-web/src/features/order/cancel-settlement/settlement-actions.tsx` | [다시 시도]·[계좌 송금으로 환불] + 확인 창 |
| Modify `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx`, `features/order/history/components/table/index.tsx`, `features/order/history/components/modals/cancel-order-modal.tsx`, `src/hooks/table/columns/use-refund-table-columns.tsx` | 화면 |
| Create `docs/adr/0044-channel-cancel-confirms-at-request-and-settles-money-separately.md` | ADR |
| Modify `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`(머리 한 줄), `docs/adr/0042-…md`(Status 한 줄) | 문서 |

---

### Task 1: 상태 `settling`·정산 메타데이터·기한 계산 (마이그 포함)

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1508-1511`
- Create: `apps/core/drizzle/<생성 시각>_add-settling-cancel-request-status.sql` + `apps/core/drizzle/meta/*`(생성기가 만든다)
- Modify: `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts:21`
- Modify: `apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts:6-8`, `dto/sales-order-amendment-response.dto.ts:44`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`, `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts`

**Interfaces:**
- Produces (thresholds): `SETTLE_DELAYED_AFTER_MS: number`(30분), `SETTLE_DEADLINE_BUSINESS_DAYS = 3`, `SETTLEMENT_REISSUE_GRACE_MS: number`(1분),
  `addBusinessDaysKst(from: Date, days: number): Date`, `settlementDeadline(confirmedAt: Date): Date`
- Produces (types):
  - `CancelRequestStatus = 'requested' | 'settling' | 'applied' | 'rejected' | 'superseded'`
  - `SettlementMode = 'auto' | 'manual'`, `SettlementPhase = 'in_progress' | 'delayed' | 'refused'`
  - `CancelRequestMetadata['settlement']?: { state: 'in_progress' | 'refused'; mode: SettlementMode; since: string; lastFailure?: SettlementFailure }`
  - `SettlementFailure = { code: string; message: string; retryable: boolean; at: string }`
  - `settlementPhase(settlement: { state: 'in_progress' | 'refused' }, confirmedAt: Date, now: Date): SettlementPhase`
  - `SettlementView = { requestId: string; phase: SettlementPhase; mode: SettlementMode; confirmedAt: string; deadlineAt: string; lastFailure: SettlementFailure | null }`
  - `toSettlementView(row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>, now: Date): SettlementView | null` — `settling` 이고 `settlement` 가 있을 때만
  - `PHASE_RANK: Record<SettlementPhase, number>`(refused 0 < delayed 1 < in_progress 2 — 작을수록 나쁘다)
  - `CancelRequestView` 에 `settlement: SettlementView | null`, `refundMode: SettlementMode | null`
  - `toCancelRequestView(row, now: Date = new Date())`

- [ ] **Step 1: 실패하는 테스트 — 기한·상수**

`order-progress.thresholds.spec.ts` 의 import 에 `SETTLE_DELAYED_AFTER_MS, addBusinessDaysKst, settlementDeadline` 을 더하고 파일 끝에:

```ts
describe('정산 기한(스펙 §7.4 — 3영업일, 주말만 뺀다)', () => {
  it('환불 지연 기준은 30분', () => {
    expect(SETTLE_DELAYED_AFTER_MS).toBe(30 * 60_000);
  });

  it('월요일 10:00 KST 확정 → 목요일 10:00 KST', () => {
    // 2026-10-12 는 월요일. 10:00 KST = 01:00Z
    expect(settlementDeadline(new Date('2026-10-12T01:00:00.000Z')).toISOString()).toBe('2026-10-15T01:00:00.000Z');
  });

  it('금요일 확정 → 다음 주 수요일(토·일은 세지 않는다)', () => {
    expect(settlementDeadline(new Date('2026-10-09T01:00:00.000Z')).toISOString()).toBe('2026-10-14T01:00:00.000Z');
  });

  it('토요일 확정 → 수요일(월·화·수)', () => {
    expect(settlementDeadline(new Date('2026-10-10T01:00:00.000Z')).toISOString()).toBe('2026-10-14T01:00:00.000Z');
  });

  it('요일은 한국 시간으로 센다 — 런타임 TZ·UTC 요일이 아니다', () => {
    // 2026-10-10T20:00Z = 일요일 05:00 KST. 하루 뒤 2026-10-11T20:00Z = 월요일 05:00 KST(영업일) → 1영업일 소진.
    // UTC 요일로 세면 2026-10-11T20:00Z 는 «일요일»이라 건너뛰고 2026-10-12T20:00Z 가 나온다.
    expect(addBusinessDaysKst(new Date('2026-10-10T20:00:00.000Z'), 1).toISOString()).toBe('2026-10-11T20:00:00.000Z');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
Expected: FAIL — `SETTLE_DELAYED_AFTER_MS` 등이 export 되지 않음(TS 에러 또는 undefined)

- [ ] **Step 3: 구현 — thresholds**

`order-progress.thresholds.ts` 의 `const DAY = 24 * HOUR;`(105~107줄) 바로 아래에:

```ts
/** 정산 중인 채널 취소 요청이 «환불 지연»이 되는 시간 — 확정 시각(요청 행 created_at)부터(#1016 36번 재설계 §5.1).
 *  판정 SQL·actions API·admin-web 뷰가 같은 값을 읽는다 — 스토어프론트 «지연»과 보드 «환불 지연»이 같은 순간에 바뀌게 */
export const SETTLE_DELAYED_AFTER_MS = 30 * MINUTE;
/** 전자상거래법 18조 2항 «3영업일 이내 환급». v1 은 주말만 뺀다(공휴일은 범위 밖, 스펙 §13) */
export const SETTLE_DEADLINE_BUSINESS_DAYS = 3;
/** 막 (다시) 시작한 정산은 이만큼 건드리지 않는다 — 채널이 아직 처리 중일 수 있다(리컨실러 36번) */
export const SETTLEMENT_REISSUE_GRACE_MS = MINUTE;

const KST_OFFSET_MS = 9 * HOUR; // 한국은 일광절약시간이 없다

/** from + n 영업일(같은 시각). 요일은 한국 시간으로 센다 — 런타임 TZ(jest·라이브는 UTC)를 읽지 않는다 */
export function addBusinessDaysKst(from: Date, days: number): Date {
  let at = from.getTime();
  let left = days;
  while (left > 0) {
    at += DAY;
    const weekday = new Date(at + KST_OFFSET_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return new Date(at);
}

export function settlementDeadline(confirmedAt: Date): Date {
  return addBusinessDaysKst(confirmedAt, SETTLE_DEADLINE_BUSINESS_DAYS);
}
```

`MINUTE` 상수가 이미 위(105줄)에 있는지 확인한다(`const MINUTE = 60_000;`). 있다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 테스트 — 요청 뷰**

`channel-cancel-request.types.spec.ts` 를 먼저 읽고(52줄) 파일 끝에 더한다. 행 픽스처는 파일 안의 기존 픽스처 모양을 따른다 — 없으면 아래 `row()` 를 쓴다:

```ts
import { PHASE_RANK, settlementPhase, toCancelRequestView, toSettlementView } from './channel-cancel-request.types';

const CONFIRMED = new Date('2026-10-12T01:00:00.000Z');
function row(over: { status?: string; settlement?: Record<string, unknown> | null } = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status: over.status ?? 'settling',
    createdAt: CONFIRMED,
    metadata: {
      salesChannel: 'medusa',
      externalOrderId: 'ext-1',
      request: {
        kind: 'cancel',
        scope: 'full',
        requestedBy: 'customer:c1',
        sourceKey: 'k1',
        appliedAt: CONFIRMED.toISOString(),
        command: { requestId: '11111111-1111-4111-8111-111111111111' },
      },
      ...(over.settlement === null
        ? {}
        : { settlement: over.settlement ?? { state: 'in_progress', mode: 'auto', since: CONFIRMED.toISOString() } }),
    },
  };
}
const minutes = (n: number) => new Date(CONFIRMED.getTime() + n * 60_000);

describe('정산 상태(#1016 36번 재설계 §5.1)', () => {
  it('확정 후 30분까지는 정산 중, 넘으면 지연 — 경계는 «넘어야»', () => {
    expect(settlementPhase({ state: 'in_progress' }, CONFIRMED, minutes(30))).toBe('in_progress');
    expect(settlementPhase({ state: 'in_progress' }, CONFIRMED, new Date(minutes(30).getTime() + 1))).toBe('delayed');
  });

  it('거절은 시간과 무관하게 거절', () => {
    expect(settlementPhase({ state: 'refused' }, CONFIRMED, minutes(1))).toBe('refused');
  });

  it('settling 행의 뷰 — 확정 시각은 행 created_at, 기한은 3영업일', () => {
    expect(toSettlementView(row(), minutes(5))).toEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      phase: 'in_progress',
      mode: 'auto',
      confirmedAt: '2026-10-12T01:00:00.000Z',
      deadlineAt: '2026-10-15T01:00:00.000Z',
      lastFailure: null,
    });
  });

  it('마지막 실패를 그대로 싣는다', () => {
    const lastFailure = { code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', message: '자동 환불 불가', retryable: false, at: minutes(1).toISOString() };
    const view = toSettlementView(row({ settlement: { state: 'refused', mode: 'auto', since: CONFIRMED.toISOString(), lastFailure } }), minutes(2));
    expect(view).toMatchObject({ phase: 'refused', lastFailure });
  });

  it('settling 이 아니면 정산 뷰가 없다', () => {
    expect(toSettlementView(row({ status: 'applied' }), minutes(5))).toBeNull();
  });

  it('요청 뷰 — settling 을 받는다(전에는 던졌다: GET /sales-orders/:id 가 500)', () => {
    const view = toCancelRequestView(row(), minutes(40));
    expect(view).toMatchObject({ status: 'settling', refundMode: 'auto', settlement: { phase: 'delayed' } });
  });

  it('옛 행(정산 칸 없음)은 settlement·refundMode 가 null', () => {
    expect(toCancelRequestView(row({ status: 'requested', settlement: null }))).toMatchObject({
      status: 'requested',
      settlement: null,
      refundMode: null,
    });
  });

  it('끝난 수동 정산도 refundMode 는 남는다 — admin-web 이 «계좌 송금» 링크를 그린다', () => {
    const view = toCancelRequestView(row({ status: 'applied', settlement: { state: 'in_progress', mode: 'manual', since: CONFIRMED.toISOString() } }));
    expect(view).toMatchObject({ status: 'applied', settlement: null, refundMode: 'manual' });
  });

  it('나쁜 순서: 거절 < 지연 < 정산 중', () => {
    expect(PHASE_RANK.refused).toBeLessThan(PHASE_RANK.delayed);
    expect(PHASE_RANK.delayed).toBeLessThan(PHASE_RANK.in_progress);
  });
});
```

기존 스펙에 «모르는 상태면 던진다» 테스트가 `'settling'` 을 모르는 값의 예로 쓰고 있으면 예를 `'pending'` 으로 바꾼다.

- [ ] **Step 6: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts`
Expected: FAIL — `settlementPhase` 등 export 없음

- [ ] **Step 7: 구현 — types**

`channel-cancel-request.types.ts`:

1. import 에 `import { SETTLE_DELAYED_AFTER_MS, settlementDeadline } from '../../fulfillment/order-progress/order-progress.thresholds';`
2. `CancelRequestStatus` 를 `'requested' | 'settling' | 'applied' | 'rejected' | 'superseded'` 로.
3. 메타 스키마에 정산 칸(`supersededReason` 아래):

```ts
const SettlementFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  at: z.string(),
});

const SettlementSchema = z.object({
  /** delayed 는 저장하지 않는다 — 확정 시각 + 30분으로 계산한다(settlementPhase) */
  state: z.enum(['in_progress', 'refused']),
  mode: z.enum(['auto', 'manual']),
  /** 이 방식으로 정산을 (다시) 시작한 시각. 이보다 이른 실패 사실은 지난 시도의 것이라 버린다 */
  since: z.string(),
  lastFailure: SettlementFailureSchema.optional(),
});
```

그리고 `CancelRequestMetadataSchema` 의 객체에 `settlement: SettlementSchema.optional(),` 를 더한다. 바로 아래에 타입:

```ts
export type SettlementMode = z.infer<typeof SettlementSchema>['mode'];
export type SettlementFailure = z.infer<typeof SettlementFailureSchema>;
export type Settlement = z.infer<typeof SettlementSchema>;
export type SettlementPhase = 'in_progress' | 'delayed' | 'refused';

/** 작을수록 나쁘다 — 한 주문의 정산 중 요청 여럿 중 대표를 고를 때(보드·actions API) */
export const PHASE_RANK: Record<SettlementPhase, number> = { refused: 0, delayed: 1, in_progress: 2 };

/** 확정 시각은 요청 행의 created_at — 판정 SQL 도 같은 칸을 본다(D13) */
export function settlementPhase(settlement: Pick<Settlement, 'state'>, confirmedAt: Date, now: Date): SettlementPhase {
  if (settlement.state === 'refused') return 'refused';
  return now.getTime() - confirmedAt.getTime() > SETTLE_DELAYED_AFTER_MS ? 'delayed' : 'in_progress';
}

export interface SettlementView {
  requestId: string;
  phase: SettlementPhase;
  mode: SettlementMode;
  confirmedAt: string;
  deadlineAt: string;
  lastFailure: SettlementFailure | null;
}
```

4. `CancelRequestView` 에 두 칸:

```ts
  /** 정산 중(settling)일 때만. 옛 requested 행·끝난 행은 null */
  settlement: SettlementView | null;
  /** 새 흐름(PR 5 뒤) 요청의 환불 방식. 옛 행은 null */
  refundMode: SettlementMode | null;
```

5. `VIEW_STATUSES` 에 `'settling'`. `toSettlementView` 와 `toCancelRequestView` 변경:

```ts
export function toSettlementView(
  row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>,
  now: Date,
): SettlementView | null {
  if (row.status !== 'settling') return null;
  const settlement = readCancelRequestMetadata(row.metadata).settlement;
  if (!settlement) throw new Error(`Settling request ${row.id} has no settlement`);
  return {
    requestId: row.id,
    phase: settlementPhase(settlement, row.createdAt, now),
    mode: settlement.mode,
    confirmedAt: row.createdAt.toISOString(),
    deadlineAt: settlementDeadline(row.createdAt).toISOString(),
    lastFailure: settlement.lastFailure ?? null,
  };
}

export function toCancelRequestView(
  row: Pick<AmendmentRow, 'id' | 'status' | 'createdAt' | 'metadata'>,
  now: Date = new Date(),
): CancelRequestView {
  if (!isViewStatus(row.status)) throw new Error(`Cancel request ${row.id} has status ${row.status}`);
  const meta = readCancelRequestMetadata(row.metadata);
  return {
    id: row.id,
    status: row.status,
    scope: meta.request.scope,
    stage: meta.request.stage ?? null,
    convertedFromFull: meta.request.convertedFromFull ?? false,
    requestedAt: row.createdAt.toISOString(),
    rejection: meta.rejection ?? null,
    outcome: meta.outcome ?? null,
    settlement: toSettlementView(row, now),
    refundMode: meta.settlement?.mode ?? null,
  };
}
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
Expected: PASS

- [ ] **Step 9: 상태 어휘·스키마·마이그**

`inventory.schema.ts:1508-1511`:

```ts
    statusCheck: check(
      'sales_order_amendments_status_check',
      sql`${t.status} IN ('applied', 'pending', 'superseded', 'dismissed', 'requested', 'settling', 'rejected')`,
    ),
```

그 아래 `uqOpenCancelRequest` 주석 끝에 한 줄: `// settling(#1016 36번 재설계)은 한 주문에 여럿일 수 있다 — 이 인덱스는 옛 requested 행용으로 남는다(스펙 §7.3).`

`sales-order-amendments.service.ts:21` 의 `AmendmentStatus` 와 두 DTO 의 enum 배열(`list-sales-order-amendments.dto.ts:6·8`, `sales-order-amendment-response.dto.ts:44`)에 `'settling'` 을
`'requested'` 다음에 더한다.

Run: `npm run db:generate:core -- --name add-settling-cancel-request-status`
Expected: `apps/core/drizzle/<ts>_add-settling-cancel-request-status.sql` 하나. 내용을 읽어 **정확히 두 문장**인지 본다:

```sql
ALTER TABLE "sales_order_amendments" DROP CONSTRAINT "sales_order_amendments_status_check";--> statement-breakpoint
ALTER TABLE "sales_order_amendments" ADD CONSTRAINT "sales_order_amendments_status_check" CHECK ("sales_order_amendments"."status" IN ('applied', 'pending', 'superseded', 'dismissed', 'requested', 'settling', 'rejected'));
```

다른 문장(다른 테이블 변경)이 섞여 나오면 develop 의 스냅샷이 schema 와 이미 어긋난 것이다 — 멈추고 보고한다(메모리 `wallet-drizzle-snapshot-chain-broken` 같은 류).

- [ ] **Step 10: 타입 검사**

Run: `npm run type-check`
Expected: 0 errors. 남는 에러는 `toCancelRequestView` 를 부르는 쪽이 아니라 `CancelRequestStatus` 를 망라하는 `switch`·`Record` 일 것이다 — 그 자리는 이 태스크에서 `settling` 갈래를 더해 컴파일만
통과시키고(값은 다음 태스크가 채운다) 보고서에 위치를 적는다.

- [ ] **Step 11: 커밋**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts \
  apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts apps/core/src/modules/sales-order/dto/sales-order-amendment-response.dto.ts \
  apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts \
  apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts
git commit -m "feat(core): 채널 취소 요청 settling 상태·정산 메타데이터·3영업일 기한 (#1016 36번 재설계 PR 5)"
```

---

### Task 2: 확정 트랜잭션 — 요청 순간 물리 취소 + `settling` + 명령

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts:43-163`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.reader.ts`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/__support__/cancel-request.fixtures.ts`
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.integration.spec.ts`(고침), `channel-cancel-request.facts.integration.spec.ts`·`channel-cancel-settle.integration.spec.ts`(옛 행 픽스처로 옮김), `request-vs-gate.integration.spec.ts`(그대로 통과 확인)

**Interfaces:**
- Consumes: Task 1 의 `Settlement`, `toCancelRequestView`
- Produces:
  - `ChannelCancelRequestReader.findSettling(salesOrderId: string, tx: DbTx, opts?: { lock?: boolean }): Promise<AmendmentRow[]>` — `created_at`, `id` 순
  - 확정된 요청 행: `status = 'settling'`, `createdAt = occurredAt = metadata.request.appliedAt = requestedAt`, `metadata.settlement = { state: 'in_progress', mode: 'auto', since: requestedAt }`
  - 명령 `CancelChannelOrder` 에 `refundMode: 'auto'`
  - 픽스처 `seedLegacyRequest(tx: DbTx, seed: SeededOrder, opts?: { lines?: Array<{ salesOrderLineId: string; quantity: number }>; stage?: 'edited'; appliedAt?: string }): Promise<string>` — 옛 `requested` 행 id

- [ ] **Step 1: 옛 행 픽스처**

`__support__/cancel-request.fixtures.ts` 에 import `CHANNEL_CANCEL_REQUEST_REASON` (`'../channel-cancel-request.types'`)를 더하고 `markLineShipped` 아래에:

```ts
/**
 * PR 5 전에 만들어진 «requested» 요청 행 — 라이브에 남은 옛 행의 모양(물리 미적용·출고 보류). manager.request 는 이제 이 행을 만들지 않는다.
 * 옛 규칙([다시 보내기]·[요청 접기]·옛 사실·수집 때 적용)이 끝까지 도는지 보는 스펙이 쓴다.
 */
export async function seedLegacyRequest(
  tx: DbTx,
  seed: SeededOrder,
  opts: { lines?: Array<{ salesOrderLineId: string; quantity: number }>; stage?: 'edited'; appliedAt?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const scope: 'full' | 'partial' = opts.lines ? 'partial' : 'full';
  const lines = opts.lines ?? seed.lineIds.map((salesOrderLineId, i) => ({ salesOrderLineId, quantity: seed.lines[i].qty }));
  const itemOf = (lineId: string) => seed.lines[seed.lineIds.indexOf(lineId)].item;
  const requestedAt = new Date().toISOString();
  await tx.insert(wmsTables.salesOrderAmendments).values({
    id,
    salesOrderId: seed.salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
    deltas: lines.map((l) => ({ type: 'cancel_line', salesOrderLineId: l.salesOrderLineId, channelOrderItemId: itemOf(l.salesOrderLineId), quantity: l.quantity })),
    metadata: {
      salesChannel: 'medusa',
      externalOrderId: seed.externalOrderId,
      request: {
        kind: 'cancel',
        scope,
        requestedBy: 'admin:7d0a3c6e-0000-4000-8000-000000000001',
        sourceKey: `legacy-${id}`,
        ...(opts.stage ? { stage: opts.stage } : {}),
        ...(opts.appliedAt ? { appliedAt: opts.appliedAt } : {}),
        command: {
          requestId: id,
          salesChannel: 'medusa',
          externalOrderId: seed.externalOrderId,
          scope,
          ...(scope === 'partial' ? { lines: lines.map((l) => ({ channelOrderItemId: itemOf(l.salesOrderLineId), quantity: l.quantity })) } : {}),
          requestedBy: 'operator',
          requestedAt,
        },
      },
    },
    origin: 'operator',
    status: 'requested',
    occurredAt: new Date(requestedAt),
  });
  return id;
}
```

- [ ] **Step 2: 옛 행을 쓰는 스펙을 픽스처로 옮긴다(동작 변화 없음)**

옛 규칙을 검증하는 스펙들이 지금은 `w.manager.request(...)` 로 `requested` 행을 만든다. 새 흐름에선 그 호출이 `settling` 을 만들므로, **옛 규칙을 보는 테스트만** 픽스처로 바꾼다:

- `channel-cancel-request.facts.integration.spec.ts` — `open()` 헬퍼 본문을:
  ```ts
  async function open(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const id = await seedLegacyRequest(tx, seed);
    return { w, seed, id };
  }
  ```
  `describe` 제목을 `'옛 requested 행 — 거절·정체 사실과 운영자 조치 (DB integration, rollback-only)'` 로. 파일 안에서 `w.manager.request` 를 직접 부르는 다른 테스트가 있으면(`withdraw` 의 «수정됨·미반영» 등)
  `seedLegacyRequest(tx, seed, { stage: 'edited' })` / `{ stage: 'edited', appliedAt: new Date().toISOString() }` 로 같은 상태를 만든다. `resend` 테스트의 «같은 본문의 명령» 단언은 픽스처의 `command` 와 비교한다.
- `channel-cancel-settle.integration.spec.ts` — `partialRequest()` 헬퍼가 `seedLegacyRequest(tx, seed, { lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }] })` 를 쓰게 하고 `requestId` 로 돌려준다.
  마지막 테스트(«전체 요청 + 수집된 전체취소»)의 `fullView = await w.manager.request(...)` 를 `const fullId = await seedLegacyRequest(tx, full)` 로. `describe` 제목에 `옛 requested 행 — ` 를 붙인다.
- `channel-cancel-request.integration.spec.ts` — `'DB 도 열린 요청을 하나만 받는다(코드 밖 경로의 방어선)'` 는 두 번째 `requested` insert 가 유니크 위반인지 보는 테스트다. 첫 행을 `seedLegacyRequest` 로 만들게 바꾼다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request`
Expected: 옮긴 테스트는 PASS(아직 manager 를 안 고쳤으니 나머지도 PASS). 이 단계는 «옮겨도 동작이 같다»의 증거다 — 커밋한다:

```bash
git add apps/core/src/modules/sales-order/channel-cancel-request
git commit -m "test(core): 옛 requested 취소 요청 행 픽스처 — 옛 규칙 스펙이 manager.request 에 기대지 않게 (#1016 36번 재설계 PR 5)"
```

- [ ] **Step 3: 실패하는 테스트 — 확정 트랜잭션**

`channel-cancel-request.integration.spec.ts` 의 첫 테스트(`'전체 — requested 행 하나, …'`)를 아래로 **바꾼다**:

```ts
  it('전체 — 확정: settling 행 · 판매주문 취소 · 취소 기록 하나 · 같은 트랜잭션의 명령 하나(refundMode auto)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      expect(view).toMatchObject({ status: 'settling', scope: 'full', refundMode: 'auto', settlement: { phase: 'in_progress', mode: 'auto', lastFailure: null } });

      const [row] = await requestsOf(tx, seed.salesOrderId);
      expect(row).toMatchObject({ id: view.id, status: 'settling', origin: 'operator' });
      expect(row.createdAt.toISOString()).toBe(row.occurredAt.toISOString());
      expect(row.metadata).toMatchObject({
        request: { appliedAt: row.createdAt.toISOString() },
        settlement: { state: 'in_progress', mode: 'auto', since: row.createdAt.toISOString() },
      });

      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(1);
      expect(commands[0].payload.payload).toMatchObject({ requestId: view.id, scope: 'full', refundMode: 'auto', requestedBy: 'operator' });

      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0]).toMatchObject({ cancellationScope: 'full', cancelledBy: 'admin' });
      expect(cancellations[0].metadata).toMatchObject({ sourceEventId: `cancel-request:${view.id}` });

      const so = await w.salesOrders.getOne(seed.salesOrderId, tx);
      expect(so?.status).toBe('cancelled');
      expect(so?.cancelRequest).toMatchObject({ id: view.id, status: 'settling' });
    });
  });

  it('부분 — 확정: 그 줄만 취소 기록, 판매주문은 살아 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      expect(view).toMatchObject({ status: 'settling', scope: 'partial' });
      const cancellations = await tx
        .select()
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(1);
      expect(cancellations[0].cancellationScope).not.toBe('full');
      expect((await w.salesOrders.getOne(seed.salesOrderId, tx))?.status).not.toBe('cancelled');
      expect((await w.salesOrders.getCancelledQuantityByLine(seed.salesOrderId, tx)).get(seed.lineIds[0])).toBe(1);
    });
  });

  it('물리 적용이 거절되면 아무것도 쓰지 않는다 — 행·명령·취소 기록 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      jest.spyOn(w.salesOrders, 'cancel').mockRejectedValueOnce(new BadRequestError('적용 거절'));
      await expect(
        tx.transaction((sp) => w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, sp as unknown as DbTx)),
      ).rejects.toThrow('적용 거절');
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(0);
    });
  });

  it('wallet 환불 승인 뒤 취소 — 같은 확정(이미 돌려준 돈은 Medusa 장부 맞추기가 넣는다, PR 2)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: { kind: 'wallet-refund-approval', intentId: 'int-1' }, sourceKey: 'wallet-refund-approval:int-1' },
        tx,
      );
      expect(view.status).toBe('settling');
      expect((await w.salesOrders.getOne(seed.salesOrderId, tx))?.status).toBe('cancelled');
      const [c] = await tx.select().from(wmsTables.salesOrderCancellations).where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(c.cancelledBy).toBe('wallet');
    });
  });
```

같은 파일에서 바뀌는 기존 테스트:
- `'같은 키 재요청은 같은 행 — 명령도 하나'` — 단언에 «취소 기록도 하나»를 더한다(`salesOrderCancellations` 길이 1).
- `'다른 키라도 열린 요청이 있으면 그것을 돌려받는다(고객·운영자 동시)'` — 옛 행 규칙이다. 첫 요청을 `const first = await seedLegacyRequest(tx, seed)` 로, `other.id` 를 `first` 와 비교. 제목 앞에 `옛 requested 행 — `.
- 새 테스트 하나를 그 아래에:
  ```ts
  it('확정된 전체취소 뒤 다른 키의 요청은 400 — 이미 취소된 주문', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: { kind: 'customer', customerId: randomUUID() }, sourceKey: 'k2' }, tx),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });
  ```
- `'운영자 부분취소가 열려 있으면 고객 전체취소는 409 — 요청은 늘지 않는다'` — 옛 행 규칙이다. 부분 요청을 `seedLegacyRequest(tx, seed, { lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }] })` 로. 제목 앞에 `옛 requested 행 — `.
  그리고 새 흐름 쌍둥이를 더한다:
  ```ts
  it('정산 중인 부분취소가 있어도 고객은 나머지를 전체취소한다 — 정산 중 요청 둘(스펙 §7.3)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const partial = await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      const full = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: { kind: 'customer', customerId: randomUUID() }, sourceKey: 'k2' },
        tx,
      );
      expect(full).toMatchObject({ status: 'settling', scope: 'full' });
      expect(full.id).not.toBe(partial.id);
      expect((await requestsOf(tx, seed.salesOrderId)).map((r) => r.status)).toEqual(['settling', 'settling']);
      expect((await w.salesOrders.getOne(seed.salesOrderId, tx))?.status).toBe('cancelled');
    });
  });
  ```
- 31번(`convertedFromFull`)·37번·«부분 요청이 남는 수량을 0 으로 만들면 전체로»·«채널 줄 번호 없음 400»·«취소된 주문 400»·«남은 몫 0 거절» — 단언의 `status: 'requested'` 를 `'settling'` 으로 바꾸고,
  행을 만드는 경우 취소 기록이 하나 생긴 것을 함께 본다. 거절 테스트(«행도 명령도 없다»)는 그대로 통과해야 한다.

- [ ] **Step 4: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-request.integration`
Expected: FAIL — `status: 'requested'` 를 받음, 취소 기록 0

- [ ] **Step 5: 구현 — reader**

`channel-cancel-request.reader.ts` 의 `findOpen` 아래에:

```ts
  /** 정산 중인 요청(새 흐름, #1016 36번 재설계). 한 주문에 여럿일 수 있다 — 오래된 순 */
  async findSettling(salesOrderId: string, tx: DbTx, opts: { lock?: boolean } = {}): Promise<AmendmentRow[]> {
    const base = tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, eq(t.status, 'settling')))
      .orderBy(asc(t.createdAt), asc(t.id));
    return opts.lock ? base.for('update') : base;
  }
```

import 에 `asc` 를 더한다.

- [ ] **Step 6: 구현 — manager.request**

클래스 주석(43-47줄)을:

```ts
/**
 * 채널 주문 취소 요청 (#1016 35번, ADR-0044). core 는 요청 순간 «물리 취소»를 확정한다 — 출고를 막을 수 있으면 박스·출고지시·예약을 그 자리에서
 * 취소하고, 요청 행을 정산 중(settling)으로 남긴 뒤 `CancelChannelOrder` 를 낸다. 돈의 정산은 채널이 하고(사실·수집으로 돌아온다),
 * 막히면 리컨실러·운영자가 다시 부른다. 여기는 wallet 을 부르지 않는다.
 * 옛 requested 행(PR 5 전)은 옛 규칙(보류·다시 보내기·접기·수집 때 적용)으로 끝까지 돈다 — findOpen 이 그 행만 본다.
 */
```

`request()` 안, `channelLines` 검증 루프(108-117줄) 뒤와 `const id = randomUUID();` 사이의 순서를 이렇게 바꾼다(`id`·`requestedAt` 을 먼저 만들고, 적용 → 행 → 명령):

```ts
      const id = randomUUID();
      const requestedAt = new Date();
      const at = requestedAt.toISOString();

      // 확정(스펙 §7.3, ADR-0044) — 계획이 받은 범위를 지금 적용한다. 거절이면 던져 요청 전체가 롤백된다(행·명령 없음).
      // 같은 취소가 수집으로 다시 와도(`OrderCancelled`) cancel() 은 이미 전체 취소된 주문에 아무것도 하지 않는다.
      await this.salesOrders.cancel(
        so.id,
        {
          ...(scope === 'partial'
            ? { lines: plan.lines.map((line) => ({ salesOrderLineId: line.salesOrderLineId, quantity: line.quantity })) }
            : {}),
          cancelledBy: cancelledByOf(input.requester),
          reasonCode: input.reasonCode ?? CHANNEL_CANCEL_REQUEST_REASON,
          ...(input.reasonDetail ? { reasonDetail: input.reasonDetail } : {}),
          occurredAt: at,
          metadata: { sourceEventId: `cancel-request:${id}` },
        },
        trx,
      );

      const command: CancelChannelOrderPayload = {
        requestId: id,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        scope,
        ...(scope === 'partial' ? { lines: channelLines } : {}),
        ...(input.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: input.alreadyRefundedAmount } : {}),
        refundMode: 'auto',
        ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
        requestedBy: input.requester.kind,
        requestedAt: at,
      };
      const metadata: CancelRequestMetadata = {
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        request: {
          kind: 'cancel',
          scope,
          requestedBy: requesterLabel(input.requester),
          sourceKey: input.sourceKey,
          ...(convertedFromFull ? { convertedFromFull: true } : {}),
          appliedAt: at,
          command,
        },
        settlement: { state: 'in_progress', mode: 'auto', since: at },
      };
      const [row] = await trx
        .insert(wmsTables.salesOrderAmendments)
        .values({
          id,
          salesOrderId: so.id,
          amendmentKind: 'commercial',
          reasonCode: CHANNEL_CANCEL_REQUEST_REASON,
          note: input.reasonDetail ?? null,
          deltas: lines,
          metadata,
          origin: 'operator',
          status: 'settling',
          occurredAt: requestedAt,
          // 확정 시각의 정본(D13) — 판정 SQL·뷰가 이 칸으로 30분·3영업일을 잰다
          createdAt: requestedAt,
        })
        .returning();
      await this.enqueue(command, `cancel-request:${id}`, trx);
      this.logger.log(`[CancelRequest] ${id} ${scope} confirmed so=${so.id} by=${metadata.request.requestedBy}`);
      return toCancelRequestView(row, requestedAt);
```

(기존의 `command`·`metadata`·`insert` 블록을 위로 대체한다.) `planCancellation` 의 `plan.lines` 원소가 `{ salesOrderLineId, quantity }` 모양인지 확인한다(`sales-orders.service.ts:2008-2125` — 그렇다).

파일 끝 `requesterLabel` 아래에:

```ts
/** 취소 기록의 cancelled_by — 누가 취소를 확정했나 */
function cancelledByOf(requester: CancelRequester): string {
  switch (requester.kind) {
    case 'operator':
      return 'admin';
    case 'customer':
      return 'customer';
    case 'wallet-refund-approval':
      return 'wallet';
  }
}
```

- [ ] **Step 7: 통과 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request`
Expected: PASS(이 폴더 전부). `request-vs-gate.integration.spec.ts` 도 그대로 통과해야 한다 — 확정이 상자를 갱신하므로 요청 트랜잭션이 상자 행 잠금을 끝까지 쥔다.
`channel-cancel-settle.integration.spec.ts` 의 옛 행 테스트도 PASS(옛 분기를 안 건드렸다).

- [ ] **Step 8: 고객 응답은 확정 뒤 판매주문으로 (PR 4 넘길 것 1)**

`store-sales-orders.service.spec.ts` 의 `makeContext`:
- 옵션에 `soAfterRequest?: ReturnType<typeof makeSo>` 를 더한다.
- `let currentSo = so;` 를 두고, `limit().then()` 이 `idx === 0 ? [so] : []` 대신 **`sales_orders` 테이블이면 `[currentSo]`** 를 돌려주게 바꾼다:
  ```ts
  const tableName = getTableName(table as Parameters<typeof getTableName>[0]);
  …
  fn(tableName === 'digital_asset_ownerships' ? (options.exercisedDigital ? [{ id: 'own-1' }] : []) : tableName === 'sales_orders' ? [currentSo] : [])
  ```
  (기존 `isOwnership` 은 `tableName` 비교로 바꾼다. 다른 테이블의 `limit()` 은 지금처럼 `[]`.)
- `cancelRequestsMock.request` 를 `jest.fn().mockImplementation(async () => { currentSo = options.soAfterRequest ?? currentSo; return { id: 'req-1', status: 'settling', … } })` 로.

테스트를 더한다(`'고객 취소는 요청을 기록하고 …'` 아래):

```ts
    it('응답은 확정 «뒤»의 판매주문으로 만든다 — 바로 «취소됨»(PR 4 넘길 것 1)', async () => {
      const { service } = makeContext({ soAfterRequest: makeSo({ status: 'cancelled' }) });
      const r = await service.cancelRequestByChannelOrder(
        CHANNEL_ORDER_ID,
        CUSTOMER_ID,
        {},
        { idempotencyKey: 'k-1', actorId: CUSTOMER_ID, actorRoles: ['customer'] },
      );
      expect(r.orderStatus).toBe('cancelled');
      expect(r.cancelRequestStatus).toBeUndefined();
    });
```

그리고 `'고객 취소는 요청을 기록하고 core 취소·Wallet 을 부르지 않는다'` 의 제목을 `'고객 취소는 요청 하나로 끝난다 — 이 서비스는 core 취소·Wallet 을 직접 부르지 않는다(확정은 요청 안에서)'` 로 바꾼다
(단언은 그대로 — `salesOrdersServiceMock.cancel` 은 이 서비스가 부르지 않는다).

Run: `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`
Expected: 새 테스트 FAIL(`orderStatus: 'confirmed'`)

`store-sales-orders.service.ts` 의 `processCancelRequest`(749줄~):

```ts
    if (fulfillmentCommandContext) {
      const replay = await this.cancelRequests.findBySourceKey(so.id, fulfillmentCommandContext.idempotencyKey);
      if (replay) return this.buildActionsView(await this.findSoOrThrow({ id: so.id }));
    }
```

끝줄:

```ts
    await this.cancelRequests.request({ … 그대로 … });
    // 확정 트랜잭션이 판매주문을 취소했다 — 요청 전에 읽은 so 로 만들면 «취소 요청됨»으로 한 번 더 말한다(PR 4 넘길 것 1)
    return this.buildActionsView(await this.findSoOrThrow({ id: so.id }));
```

Run: `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 채널 취소는 요청 순간 물리 확정 — settling 행·같은 트랜잭션의 명령, 고객 응답은 확정 뒤 판매주문 (#1016 36번 재설계 PR 5)"
```

---

### Task 3: 사실 받기 — 정산 완료·정산 실패·늘어남 흡수

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settler.ts`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-match.ts` (+ `channel-cancel-match.spec.ts`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts`, `channel-cancel-request.service.ts`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`
- Test: Create `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settling.integration.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `findSettling`, `settling` 행 모양
- Produces:
  - `takeRequestedIncreases(lines: CancelRequestLine[], deltas: ChannelDelta[]): { matched: true; rest: ChannelDelta[] } | { matched: false }`
  - `ChannelCancelRequestManager.recordSettlementFailure(fact: SettlementFailedFact, tx?: DbTx): Promise<void>`
  - `SettlementFailedFact = Pick<ChannelOrderSettlementFailedPayload, 'requestId' | 'retryable' | 'failureCode' | 'message' | 'at'>`
  - `ChannelCancelRequestService.recordSettlementFailure(fact: SettlementFailedFact): Promise<void>`
  - 정산 완료 시 `metadata.settlement.lastFailure` 를 지운다(PR 3 판정 2 의 비용)

- [ ] **Step 1: 실패하는 단위 테스트 — 늘어남 대조**

`channel-cancel-match.spec.ts` 끝에:

```ts
describe('takeRequestedIncreases — 채널이 아직 안 줄인 정산 중 부분취소(D10)', () => {
  const line = (salesOrderLineId: string, quantity: number) =>
    ({ type: 'cancel_line', salesOrderLineId, channelOrderItemId: `ci-${salesOrderLineId}`, quantity }) as const;
  const qc = (salesOrderLineId: string, quantityBefore: number, correctedQuantity: number) =>
    ({ type: 'quantity_correction', salesOrderLineId, channelOrderItemId: `ci-${salesOrderLineId}`, quantityBefore, correctedQuantity }) as const;

  it('요청 줄과 같은 크기의 늘어남을 먹고 나머지를 돌려준다', () => {
    const address = { type: 'shipping_address_change', before: {}, after: {} } as never;
    const r = takeRequestedIncreases([line('a', 1)], [qc('a', 1, 2), address]);
    expect(r).toEqual({ matched: true, rest: [address] });
  });

  it('크기가 다르면 아무것도 먹지 않는다', () => {
    expect(takeRequestedIncreases([line('a', 1)], [qc('a', 1, 3)])).toEqual({ matched: false });
  });

  it('줄어듦은 늘어남이 아니다', () => {
    expect(takeRequestedIncreases([line('a', 1)], [qc('a', 2, 1)])).toEqual({ matched: false });
  });
});
```

import 에 `takeRequestedIncreases` 를 더한다.

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-match.spec.ts` → FAIL

- [ ] **Step 2: 구현 — 대조**

`channel-cancel-match.ts` 를:

```ts
function takeRequested(
  lines: CancelRequestLine[],
  deltas: ChannelDelta[],
  sizeOf: (delta: QuantityCorrectionDelta) => number,
): { matched: true; rest: ChannelDelta[] } | { matched: false } {
  const taken = new Set<ChannelDelta>();
  for (const line of lines) {
    const hit = deltas.find(
      (delta) =>
        !taken.has(delta) &&
        isQuantityCorrection(delta) &&
        delta.salesOrderLineId === line.salesOrderLineId &&
        sizeOf(delta) === line.quantity,
    );
    if (!hit) return { matched: false };
    taken.add(hit);
  }
  return { matched: true, rest: deltas.filter((delta) => !taken.has(delta)) };
}

/** (기존 주석 그대로) */
export function takeRequestedDecreases(lines: CancelRequestLine[], deltas: ChannelDelta[]) {
  return takeRequested(lines, deltas, (d) => d.quantityBefore - d.correctedQuantity);
}

/**
 * 정산 중인 부분취소(core 는 확정 때 이미 줄였다) ↔ 아직 안 줄인 채널 스냅샷. 다른 변경(주소 등)이 수집되면 diff 가 요청분을
 * «늘어남»으로 본다 — 우리가 낸 감소의 거울이라 5번 규칙에 넘기지 않는다(#1016 36번 재설계 D10). 요청 줄 전부가 정확히 맞을 때만 먹는다.
 */
export function takeRequestedIncreases(lines: CancelRequestLine[], deltas: ChannelDelta[]) {
  return takeRequested(lines, deltas, (d) => d.correctedQuantity - d.quantityBefore);
}
```

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-match.spec.ts` → PASS

- [ ] **Step 3: 실패하는 통합 테스트**

`channel-cancel-settling.integration.spec.ts` 를 만든다:

```ts
import { randomUUID } from 'crypto';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ADDRESS, modifiedPayload, seedChannelOrder, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };
const NEXT_ADDRESS = { ...ADDRESS, roadAddress: '부산' };

async function rowOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}
async function cancellationsOf(tx: DbTx, salesOrderId: string) {
  return tx.select().from(wmsTables.salesOrderCancellations).where(eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId));
}
async function soCancelledEvents(tx: DbTx, salesOrderId: string) {
  return tx.execute<{ id: string }>(
    drizzleSql`SELECT id FROM event.outbox_events WHERE event_type = 'SalesOrderCancelled' AND aggregate_id = ${salesOrderId}`,
  );
}
const failure = (requestId: string, over: Partial<{ retryable: boolean; failureCode: string; message: string; at: string }> = {}) => ({
  requestId,
  retryable: false,
  failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
  message: '자동 환불할 수 없는 결제수단입니다',
  at: new Date(Date.now() + 1000).toISOString(),
  ...over,
});

describeIfDb('정산 중 요청의 사실 받기 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function confirmFull(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
    return { w, seed, id: view.id };
  }
  async function confirmPartial(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request(
      { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
      tx,
    );
    return { w, seed, id: view.id };
  }

  it('전체 — 수집된 OrderCancelled: 판매주문 취소는 아무것도 안 하고(이미 취소) 요청은 applied, 실패 기록은 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_500' }), tx);
      // handleOrderCancelled 가 하는 일 그대로: cancel() → settleCancelled()
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
      expect(await soCancelledEvents(tx, seed.salesOrderId)).toHaveLength(1);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({ settlement: { mode: 'auto' } });
      expect((row.metadata as { settlement: Record<string, unknown> }).settlement.lastFailure).toBeUndefined();
    });
  });

  it('정산 중 요청 둘 + 전체취소 수집 — 전체는 applied, 부분은 superseded(CHANNEL_FULL_CANCEL)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id: partialId } = await confirmPartial(tx);
      await w.manager.recordSettlementFailure(failure(partialId), tx);
      const full = await w.manager.request(
        { salesOrderId: seed.salesOrderId, requester: { kind: 'customer', customerId: randomUUID() }, sourceKey: 'k2' },
        tx,
      );
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      expect((await rowOf(tx, full.id)).status).toBe('applied');
      const partial = await rowOf(tx, partialId);
      expect(partial.status).toBe('superseded');
      expect(partial.metadata).toMatchObject({ supersededReason: 'CHANNEL_FULL_CANCEL' });
    });
  });

  it('부분 — refunded 기록: applied + 결과, 물리 적용은 다시 하지 않는다(취소 기록 그대로 하나)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, {
          quantities: [1, 1],
          cancelRequests: [{ requestId: id, stage: 'refunded', refundAmount: 1000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false }],
        }),
        'm-1',
        tx,
      );
      const row = await rowOf(tx, id);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({ outcome: { refundAmount: 1000 } });
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows.flatMap((a) => a.deltas as unknown[])).toEqual([]);
    });
  });

  it('부분 — edited 기록: 정산 중 그대로(환불이 남았다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, {
          quantities: [1, 1],
          cancelRequests: [{ requestId: id, stage: 'edited', refundAmount: 1000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false }],
        }),
        'm-1',
        tx,
      );
      expect((await rowOf(tx, id)).status).toBe('settling');
    });
  });

  it('진행 기록 없는 부분 정산 + 주소 변경 — 요청분의 «늘어남»은 먹고 주소만 반영(반영 대기 변경 없음, D10)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      // Medusa 는 아직 안 줄였다 — 스냅샷 수량은 원래대로(2,1), core 유효 수량은 (1,1)
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { address: NEXT_ADDRESS }), 'm-1', tx);
      expect((await rowOf(tx, id)).status).toBe('settling');
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('applied');
      expect((channelRows[0].deltas as Array<{ type: string }>).map((d) => d.type)).toEqual(['shipping_address_change']);
    });
  });

  it('정산 실패 — 영구면 refused, 일시면 in_progress, 둘 다 마지막 실패를 적는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({
        settlement: { state: 'refused', lastFailure: { code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', retryable: false } },
      });
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_502', at: new Date(Date.now() + 2000).toISOString() }), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ settlement: { state: 'in_progress', lastFailure: { code: 'http_502' } } });
    });
  });

  it('같은 요청의 사실이 순서 없이 온다 — 더 이른 at 은 버린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      const later = new Date(Date.now() + 5000).toISOString();
      const earlier = new Date(Date.now() + 1000).toISOString();
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_500', at: later }), tx);
      await w.manager.recordSettlementFailure(failure(id, { at: earlier }), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ settlement: { state: 'in_progress', lastFailure: { code: 'http_500' } } });
    });
  });

  it('since 보다 이른 사실은 지난 시도의 것 — 버린다(운영자 다시 시도 뒤 늦게 온 거절)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      const before = new Date(Date.now() - 60_000).toISOString();
      await w.manager.recordSettlementFailure(failure(id, { at: before }), tx);
      expect((await rowOf(tx, id)).metadata).toMatchObject({ settlement: { state: 'in_progress' } });
      expect((await rowOf(tx, id)).metadata).not.toHaveProperty('settlement.lastFailure');
    });
  });

  it('옛 사실(Rejected·Stalled)은 settling 행에 닿지 않는다(PR 3 넘길 것 1)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id), tx);
      await w.manager.reject({ requestId: id, reasonCode: 'NOT_CANCELABLE', message: 'x' }, tx);
      await w.manager.markStalled({ requestId: id }, tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('settling');
      expect(row.metadata).toMatchObject({ settlement: { state: 'refused' } });
      expect(row.metadata).not.toHaveProperty('rejection');
    });
  });

  it('정산이 끝난 요청·옛 requested 행·없는 id 에 온 정산 실패는 버린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.salesOrders.cancel(seed.salesOrderId, { cancelledBy: 'medusa', metadata: { sourceEventId: 'oc-1' } }, tx);
      await w.settler.settleCancelled(seed.salesOrderId, tx);
      await w.manager.recordSettlementFailure(failure(id), tx);
      expect((await rowOf(tx, id)).status).toBe('applied');
      await expect(w.manager.recordSettlementFailure(failure('not-a-uuid'), tx)).resolves.toBeUndefined();
    });
  });
});
```

옛 `requested` 행에 온 정산 실패(D12)는 facts 스펙(옛 행 파일)에 한 줄 더한다:

```ts
  it('정산 실패 사실은 옛 requested 행을 바꾸지 않는다(D12 — 보류가 풀리면 안 된다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.recordSettlementFailure(
        { requestId: id, retryable: false, failureCode: 'wallet_refund_refused:X', message: 'x', at: new Date().toISOString() },
        tx,
      );
      const row = await rowOf(tx, id);
      expect(row.status).toBe('requested');
      expect(row.metadata).not.toHaveProperty('settlement');
    });
  });
```

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-settling`
Expected: FAIL — `recordSettlementFailure` 없음, settling 행이 settleCancelled 에서 그대로

- [ ] **Step 4: 구현 — manager.recordSettlementFailure**

`channel-cancel-request.manager.ts` 의 import 에 `ChannelOrderSettlementFailedPayload`(`@packages/event-contracts/streams`)를 더하고, `export interface CancelRequestInput` 아래에:

```ts
export type SettlementFailedFact = Pick<ChannelOrderSettlementFailedPayload, 'requestId' | 'retryable' | 'failureCode' | 'message' | 'at'>;
```

`markStalled` 아래에:

```ts
  /**
   * 정산 실패 사실(#1016 36번 재설계 §7.3). 정산 중(settling) 행만 읽는다 — 옛 requested 행은 옛 사실만(보류가 풀리면 안 된다, D12).
   * 같은 requestId 의 사실은 순서 없이 여러 번 온다(Kafka 재시도·리컨실러 재발행): 지난 시도(since 이전)·더 이른 사실은 버린다(D2).
   */
  async recordSettlementFailure(fact: SettlementFailedFact, tx?: DbTx): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'settling') {
        this.logger.log(`[CancelRequest] settlement failure ignored: ${fact.requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      const settlement = meta.settlement;
      if (!settlement) throw new Error(`Settling request ${row.id} has no settlement`);
      const at = Date.parse(fact.at);
      if (at < Date.parse(settlement.since)) return;
      if (settlement.lastFailure && at <= Date.parse(settlement.lastFailure.at)) return;
      const next: CancelRequestMetadata = {
        ...meta,
        settlement: {
          ...settlement,
          state: fact.retryable ? 'in_progress' : 'refused',
          lastFailure: { code: fact.failureCode, message: fact.message, retryable: fact.retryable, at: fact.at },
        },
      };
      await this.write(row.id, 'settling', next, trx);
      this.logger.warn(`[CancelRequest] ${row.id} settlement failed ${fact.failureCode} retryable=${fact.retryable}`);
    }, tx);
  }
```

`private async write(…, status: 'requested' | 'rejected', …)` 의 상태 유니온에 `'settling'` 을 더한다.

`channel-cancel-request.service.ts` 에 위임:

```ts
  recordSettlementFailure(fact: SettlementFailedFact): Promise<void> {
    return this.manager.recordSettlementFailure(fact);
  }
```

(import `SettlementFailedFact` from manager.)

- [ ] **Step 5: 구현 — settler**

`channel-cancel-settler.ts`:

1. import 에 `takeRequestedIncreases` 와 `Settlement` 타입.
2. 클래스 주석 끝에 한 줄: `정산 중(settling) 행은 물리 적용이 끝난 요청이다 — 종결만 하고 다시 적용하지 않는다(#1016 36번 재설계 §7.3). 옛 requested 행 분기가 먼저 돈다.`
3. 지금의 `settleModified` 본문을 `private async settleLegacyModified(…)` 로 이름만 바꿔 옮기고, 공개 메서드를:

```ts
  async settleModified(
    salesOrderId: string,
    deltas: ChannelDelta[],
    progress: OrderModifiedCancelRequest[],
    occurredAt: string,
    tx: DbTx,
  ): Promise<ChannelDelta[]> {
    let rest = await this.settleLegacyModified(salesOrderId, deltas, progress, occurredAt, tx);
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope !== 'partial') continue;
      const record = progress.find((p) => p.requestId === row.id);
      if (record?.stage === 'refunded') {
        await this.write(row.id, 'applied', { ...settled(meta), outcome: outcomeOf(record) }, tx);
        continue;
      }
      if (!record) {
        const taken = takeRequestedIncreases(readCancelRequestLines(row.deltas), rest);
        if (taken.matched) rest = taken.rest;
      }
      // edited — 채널은 줄였고 환불이 남았다. 정산 중 그대로(실패 사실이 사유를 싣는다)
    }
    return rest;
  }
```

4. 옛 분기 안의 `outcome: { refundAmount: record.refundAmount, … }` 객체 생성을 파일 하단 함수로 뽑아 두 곳이 같이 쓴다:

```ts
function outcomeOf(record: OrderModifiedCancelRequest): NonNullable<CancelRequestMetadata['outcome']> {
  return {
    refundAmount: record.refundAmount,
    shippingCharge: record.shippingCharge,
    shippingRefund: record.shippingRefund,
    shippingNotAdjusted: record.shippingNotAdjusted,
    ...(record.externalRefundApplied ? { externalRefundApplied: record.externalRefundApplied } : {}),
  };
}

/** 정산이 끝났다 — 마지막 실패는 더 이상 사실이 아니다(PR 3 판정 2). 방식(mode)은 남긴다: actions API 가 수동 송금 여부를 묻는다 */
function settled(meta: CancelRequestMetadata): CancelRequestMetadata {
  if (!meta.settlement) return meta;
  const { lastFailure: _dropped, ...settlement } = meta.settlement;
  return { ...meta, settlement };
}
```

`_dropped` 가 lint 의 unused 규칙에 걸리면 `const settlement: Settlement = { state: meta.settlement.state, mode: meta.settlement.mode, since: meta.settlement.since };` 로 쓴다.

5. `settleCancelled` 를:

```ts
  async settleCancelled(salesOrderId: string, tx: DbTx): Promise<void> {
    const open = await this.reader.findOpen(salesOrderId, tx, { lock: true });
    if (open) {
      const meta = readCancelRequestMetadata(open.metadata);
      if (meta.request.scope === 'full') await this.write(open.id, 'applied', meta, tx);
      else await this.supersede(open, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
    // 정산 중 — 전체는 끝났고, 부분은 전체취소가 «캡처 − 환불»을 다 돌려줘 덮였다(스펙 §7.3)
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope === 'full') await this.write(row.id, 'applied', settled(meta), tx);
      else await this.supersede(row, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
  }
```

- [ ] **Step 6: 구현 — 소비자**

`order-events.consumer.ts` 의 `handleChannelOrderCancelStalled` 아래에:

```ts
  /**
   * 정산 실패(#1016 36번 재설계 §7.3). 정산 중 요청만 읽고(옛 requested 행은 옛 사실만), 순서 없이 여러 번 와도 늦은 것만 적는다.
   * order_events 에 기록하지 않는다(판매주문 생애가 아니다 — 위 두 사실과 같은 이유).
   */
  @On(ORDER_STREAM, 'ChannelOrderSettlementFailed')
  async handleChannelOrderSettlementFailed(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'ChannelOrderSettlementFailed'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'ChannelOrderSettlementFailed'>,
  ) {
    this.logger.log(
      `[ChannelOrderSettlementFailed] ${payload.requestId} ${payload.failureCode} retryable=${payload.retryable}`,
      { correlationId: envelope.correlationId },
    );
    await this.cancelRequests.recordSettlementFailure(payload);
  }
```

`handleOrderCancelled` 의 `if (!lines) await this.cancelSettler.settleCancelled(salesOrderId, tx);` 위 주석을 고친다:
`// 우리가 낸 취소 요청을 닫는다 — 옛 requested 행(수집 때 적용)과 정산 중 행(확정 때 적용, 위 cancel() 은 이미 취소된 주문이라 아무것도 안 했다). 줄 단위 취소(마켓)는 요청과 무관하다.`

- [ ] **Step 7: 통과 확인**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order
npx jest apps/core/src/modules/sales-order
npm run audit:event-handlers
npm run audit:consume-validation -- --gate
```

Expected: 통합·단위 PASS. 감사: **핸들러 104개 · 발견 없음**, 게이트 **위반 없음**.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 정산 중 요청의 사실 받기 — 완료·정산 실패·늦은 사실 버림·미반영 부분취소의 늘어남 흡수 (#1016 36번 재설계 PR 5)"
```

---

### Task 4: 운영자 조치 API — [다시 시도]·[계좌 송금으로 환불]

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts`, `channel-cancel-request.service.ts`
- Modify: `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts:100-115`
- Test: Create `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settlement-actions.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `settlementPhase`, `SETTLE_DELAYED_AFTER_MS`; Task 3 `write(…, 'settling', …)`
- Produces:
  - `ChannelCancelRequestService.retrySettlement(salesOrderId: string, requestId: string): Promise<CancelRequestView>`
  - `ChannelCancelRequestService.switchToManualRefund(salesOrderId: string, requestId: string): Promise<CancelRequestView>`
  - `POST /sales-orders/:id/cancel-request/:requestId/retry`, `POST /sales-orders/:id/cancel-request/:requestId/manual-refund` → `CancelRequestView`
  - 명령 멱등 키: `cancel-request:<id>:retry:<ms>`, `cancel-request:<id>:manual:<ms>`

- [ ] **Step 1: 실패하는 통합 테스트**

`channel-cancel-settlement-actions.integration.spec.ts`:

```ts
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedChannelOrder, seedLegacyRequest, wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const OPERATOR = { kind: 'operator' as const, actorId: '7d0a3c6e-0000-4000-8000-000000000001' };

async function rowOf(tx: DbTx, id: string) {
  const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
  return row;
}
async function commandsOf(tx: DbTx, externalOrderId: string) {
  return tx.execute<{ payload: { payload: Record<string, unknown> } }>(
    drizzleSql`SELECT payload FROM event.outbox_events WHERE event_type = 'CancelChannelOrder' AND aggregate_id = ${`medusa:${externalOrderId}`} ORDER BY created_at`,
  );
}
/** 확정 시각을 과거로 민다 — «환불 지연»(30분 초과)을 만든다 */
async function ageRequest(tx: DbTx, id: string, minutes: number) {
  await tx
    .update(wmsTables.salesOrderAmendments)
    .set({ createdAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(wmsTables.salesOrderAmendments.id, id));
}

describeIfDb('정산 조치 — 다시 시도·계좌 송금 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function refused(tx: DbTx) {
    const w = wireCancelRequest(tx);
    const seed = await seedChannelOrder(tx, w, { withFo: true });
    const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
    await w.manager.recordSettlementFailure(
      { requestId: view.id, retryable: false, failureCode: 'wallet_refund_refused:X', message: '거절', at: new Date(Date.now() + 1000).toISOString() },
      tx,
    );
    return { w, seed, id: view.id };
  }

  it('거절 → 다시 시도: 정산 중으로, since 를 새로 찍고, 같은 requestId·같은 방식(auto)의 명령을 하나 더 낸다. 마지막 실패는 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const before = (await rowOf(tx, id)).metadata as { settlement: { since: string } };
      const view = await w.manager.retrySettlement(seed.salesOrderId, id, tx);
      expect(view.settlement).toMatchObject({ phase: 'in_progress', mode: 'auto', lastFailure: { code: 'wallet_refund_refused:X' } });
      const after = (await rowOf(tx, id)).metadata as { settlement: { since: string } };
      expect(Date.parse(after.settlement.since)).toBeGreaterThan(Date.parse(before.settlement.since));
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(2);
      expect(commands[1].payload.payload).toMatchObject({ requestId: id, refundMode: 'auto' });
    });
  });

  it('거절 → 계좌 송금으로 환불: mode manual, 명령의 refundMode manual', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const view = await w.manager.switchToManualRefund(seed.salesOrderId, id, tx);
      expect(view).toMatchObject({ refundMode: 'manual', settlement: { phase: 'in_progress', mode: 'manual' } });
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands[commands.length - 1].payload.payload).toMatchObject({ requestId: id, refundMode: 'manual' });
    });
  });

  it('지연(30분 초과·일시 실패만) → 다시 시도할 수 있다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await ageRequest(tx, view.id, 31);
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, tx)).resolves.toMatchObject({ status: 'settling' });
    });
  });

  it('정산 중(30분 안)엔 409 — 막 보낸 명령과 겹치지 않게(D8)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      await expect(w.manager.retrySettlement(seed.salesOrderId, view.id, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, view.id, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('이미 계좌 송금이면 계좌 송금은 409, 다시 시도는 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      await w.manager.switchToManualRefund(seed.salesOrderId, id, tx);
      await w.manager.recordSettlementFailure(
        { requestId: id, retryable: false, failureCode: 'not_found', message: '주문 없음', at: new Date(Date.now() + 5000).toISOString() },
        tx,
      );
      await expect(w.manager.switchToManualRefund(seed.salesOrderId, id, tx)).rejects.toBeInstanceOf(ConflictError);
      await expect(w.manager.retrySettlement(seed.salesOrderId, id, tx)).resolves.toMatchObject({ refundMode: 'manual' });
    });
  });

  it('다른 주문의 요청 id·없는 id 는 404, 옛 requested 행은 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const other = await seedChannelOrder(tx, w, { withFo: true });
      await expect(w.manager.retrySettlement(other.salesOrderId, id, tx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(w.manager.retrySettlement(seed.salesOrderId, 'nope', tx)).rejects.toBeInstanceOf(NotFoundError);
      const legacy = await seedLegacyRequest(tx, other);
      await expect(w.manager.retrySettlement(other.salesOrderId, legacy, tx)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it('판매주문 상세의 취소 요청 뷰에 정산이 실린다 — admin-web 이 사유·조치를 그린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await refused(tx);
      const so = await w.salesOrders.getOne(seed.salesOrderId, tx);
      expect(so?.cancelRequest).toMatchObject({ id, status: 'settling', settlement: { phase: 'refused', lastFailure: { message: '거절' } } });
    });
  });
});
```

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-settlement-actions`
Expected: FAIL — `retrySettlement` 없음

- [ ] **Step 2: 구현 — manager**

import 에 `settlementPhase`(types), `SETTLE_DELAYED_AFTER_MS`(`'../../fulfillment/order-progress/order-progress.thresholds'`). `recordSettlementFailure` 아래에:

```ts
  /** [다시 시도] — 환불 지연·거절인 정산을 같은 requestId·같은 방식으로 다시 낸다(스펙 §7.3) */
  async retrySettlement(salesOrderId: string, requestId: string, tx?: DbTx): Promise<CancelRequestView> {
    return this.restartSettlement(salesOrderId, requestId, 'retry', tx);
  }

  /** [계좌 송금으로 환불] — 같은 requestId 를 refundMode manual 로 다시 낸다. wallet 이 PG 없이 송금 대기 행을 만든다(스펙 §6.3) */
  async switchToManualRefund(salesOrderId: string, requestId: string, tx?: DbTx): Promise<CancelRequestView> {
    return this.restartSettlement(salesOrderId, requestId, 'manual', tx);
  }

  private async restartSettlement(
    salesOrderId: string,
    requestId: string,
    kind: 'retry' | 'manual',
    tx?: DbTx,
  ): Promise<CancelRequestView> {
    return this.db.run(async (trx) => {
      await this.lockSalesOrder(salesOrderId, trx);
      const row = await this.reader.findById(requestId, trx, { lock: true });
      if (!row || row.salesOrderId !== salesOrderId) throw new NotFoundError(`취소 요청을 찾을 수 없습니다: ${requestId}`);
      if (row.status !== 'settling') throw new ConflictError('정산 중인 취소 요청이 아닙니다.');
      const meta = readCancelRequestMetadata(row.metadata);
      const settlement = meta.settlement;
      if (!settlement) throw new Error(`Settling request ${row.id} has no settlement`);
      const now = new Date();
      // 막 보낸 명령이 아직 돌고 있다 — 겹치면 같은 주문에 정산이 둘 돈다(D8)
      if (settlementPhase(settlement, row.createdAt, now) === 'in_progress') {
        throw new ConflictError(
          `정산이 진행 중입니다. 확정 뒤 ${SETTLE_DELAYED_AFTER_MS / 60_000}분이 지나도 끝나지 않으면 다시 시도할 수 있습니다.`,
        );
      }
      if (kind === 'manual' && settlement.mode === 'manual') throw new ConflictError('이미 계좌 송금으로 환불하고 있습니다.');
      const mode = kind === 'manual' ? 'manual' : settlement.mode;
      const next: CancelRequestMetadata = {
        ...meta,
        settlement: { ...settlement, state: 'in_progress', mode, since: now.toISOString() },
      };
      await this.enqueue({ ...meta.request.command, refundMode: mode }, `cancel-request:${row.id}:${kind}:${now.getTime()}`, trx);
      await this.write(row.id, 'settling', next, trx);
      this.logger.log(`[CancelRequest] ${row.id} settlement restarted (${kind}, ${mode})`);
      return toCancelRequestView({ ...row, metadata: next }, now);
    }, tx);
  }
```

`channel-cancel-request.service.ts`:

```ts
  retrySettlement(salesOrderId: string, requestId: string): Promise<CancelRequestView> {
    return this.manager.retrySettlement(salesOrderId, requestId);
  }

  switchToManualRefund(salesOrderId: string, requestId: string): Promise<CancelRequestView> {
    return this.manager.switchToManualRefund(salesOrderId, requestId);
  }
```

- [ ] **Step 3: 구현 — 컨트롤러**

`sales-orders.controller.ts` 의 `withdrawCancelRequest` 아래에:

```ts
  @Post(':id/cancel-request/:requestId/retry')
  @ApiOperation({ summary: '채널 취소 정산 다시 시도 — 환불 지연·거절인 요청에 같은 requestId 로 명령을 다시 낸다(#1016 36번 재설계)' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiParam({ name: 'requestId', description: '취소 요청 ID' })
  retryCancelSettlement(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.cancelRequests.retrySettlement(id, requestId);
  }

  @Post(':id/cancel-request/:requestId/manual-refund')
  @ApiOperation({ summary: '채널 취소를 계좌 송금으로 환불 — wallet 에 송금 대기 행을 만든다. 송금 뒤 결제 상세에서 완료 처리' })
  @ApiParam({ name: 'id', description: '판매 주문 ID' })
  @ApiParam({ name: 'requestId', description: '취소 요청 ID' })
  manualRefundCancelSettlement(@Param('id') id: string, @Param('requestId') requestId: string) {
    return this.cancelRequests.switchToManualRefund(id, requestId);
  }
```

`resend`·`withdraw` 의 `@ApiOperation` summary 끝에 `(옛 requested 행만)` 을 붙인다.

- [ ] **Step 4: 통과 확인 + 보안 가드**

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-settlement-actions
npx jest scripts/security
```

Expected: 통합 PASS. `scripts/security` 가 빨갛게 되면 라우트 줄 번호 좌표가 밀린 것이다 — 스펙이 안내하는 대로 좌표 표를 갱신한다(새 라우트 둘은 같은 컨트롤러의 `resend`·`withdraw` 와 같은 인가 등급).

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order scripts/security
git commit -m "feat(core): 정산 조치 API — 다시 시도·계좌 송금으로 환불 (#1016 36번 재설계 PR 5)"
```

---

### Task 5: 판정 SQL·정체 보드 — `settle_*` 세 상태, 상태별 갇힘, 행의 정산 정보

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` (+ spec)
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts`, `dto/order-progress-response.dto.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.ts`(주석) + `order-reconcile.subject.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts`
- Test: `order-progress.judge.integration.spec.ts`, `order-progress.board.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `SETTLE_DELAYED_AFTER_MS`, `toSettlementView`, `PHASE_RANK`, `SettlementView`, `CHANNEL_CANCEL_REQUEST_REASON`
- Produces:
  - 판정 세부 상태 `settle_in_progress`·`settle_delayed`·`settle_refused`(단계 `cancel_request`), 판정 규칙 이름 `cancel_settle`
  - `ORDER_PROGRESS_STATES.cancel_request = ['cancel_requested', 'cancel_edited', 'settle_in_progress', 'settle_delayed', 'settle_refused']`
  - `STUCK_AFTER_MS_BY_STATE`, `stuckAfterMs(stage, state): number | null`, `isStuck(stage, enteredAt, now, state?: string | null)`
  - `OrderProgressItem` 에 `settlement: SettlementView | null`, `walletIntentId: string | null`
  - 픽스처 `seedSettling(tx: DbTx, salesOrderId: string, args: { createdAt: Date; state?: 'in_progress' | 'refused'; mode?: 'auto' | 'manual' }): Promise<string>`

- [ ] **Step 1: 실패하는 단위 테스트 — 어휘·갇힘**

`order-progress.thresholds.spec.ts`:
- import 에 `stuckAfterMs` 를 더한다.
- `'스펙 §6 표의 기준을 그대로 갖는다'` 는 그대로.
- 새 describe:

```ts
describe('세부 상태별 갇힘(#1016 36번 재설계 D6)', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('정산 중은 며칠이 지나도 갇히지 않는다 — 30분 넘으면 판정이 settle_delayed 로 바꾼다', () => {
    expect(stuckAfterMs('cancel_request', 'settle_in_progress')).toBeNull();
    expect(isStuck('cancel_request', ago(3 * DAY), now, 'settle_in_progress')).toBe(false);
  });

  it('환불 지연·거절은 들어온 순간 갇힘', () => {
    expect(isStuck('cancel_request', ago(1), now, 'settle_delayed')).toBe(true);
    expect(isStuck('cancel_request', ago(1), now, 'settle_refused')).toBe(true);
  });

  it('옛 요청 상태는 단계 기준(5분) 그대로', () => {
    expect(isStuck('cancel_request', ago(5 * 60_000 - 1), now, 'cancel_requested')).toBe(false);
    expect(isStuck('cancel_request', ago(5 * 60_000 + 1), now, 'cancel_requested')).toBe(true);
  });

  it('세부 상태가 없거나 덮어쓰기가 없으면 단계 기준', () => {
    expect(stuckAfterMs('fo', null)).toBe(DAY);
    expect(stuckAfterMs('fo', 'awaiting_matching')).toBe(DAY);
  });

  it('36번 규칙의 칸이 어휘에 있다', () => {
    expect(ORDER_PROGRESS_STATES.cancel_request).toEqual(
      expect.arrayContaining(['settle_in_progress', 'settle_delayed', 'settle_refused']),
    );
  });
});
```

`'%s 의 세부 상태는 판정 SQL 이 실제로 낼 수 있는 값이다'` 는 그대로 둔다 — Step 3 뒤 판정 SQL 본문에 세 상태가 리터럴로 들어가 통과해야 한다.

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts` → FAIL

- [ ] **Step 2: 구현 — thresholds**

```ts
  cancel_request: ['cancel_requested', 'cancel_edited', 'settle_in_progress', 'settle_delayed', 'settle_refused'],
```

`STUCK_AFTER_MS` 아래에:

```ts
/**
 * 세부 상태가 단계 기준을 덮는 칸. null = 갇힘으로 보지 않는다.
 * 정산 중은 «환불 지연»(확정 + SETTLE_DELAYED_AFTER_MS)이 될 때까지 운영자 일이 아니고, 지연·거절은 그 자체가 «기준을 넘었다»는 뜻이다(스펙 §5.2·§8.1).
 */
export const STUCK_AFTER_MS_BY_STATE: Partial<Record<OrderProgressState, number | null>> = {
  settle_in_progress: null,
  settle_delayed: 0,
  settle_refused: 0,
};

function hasStateOverride(state: string): state is keyof typeof STUCK_AFTER_MS_BY_STATE {
  return Object.prototype.hasOwnProperty.call(STUCK_AFTER_MS_BY_STATE, state);
}

export function stuckAfterMs(stage: OrderProgressStage, state: string | null): number | null {
  if (state !== null && hasStateOverride(state)) return STUCK_AFTER_MS_BY_STATE[state] ?? null;
  return STUCK_AFTER_MS[stage];
}
```

`isStuck` 를:

```ts
export function isStuck(stage: OrderProgressStage, enteredAt: Date, now: Date, state: string | null = null): boolean {
  const ms = stuckAfterMs(stage, state);
  if (ms === null) return false;
  return enteredAt.getTime() < now.getTime() - ms;
}
```

`stuckCutoff` 는 그대로(단계 기준 — 요약·목록 SQL 은 Step 6 의 행별 식을 쓴다).

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts` → 새 describe PASS, «판정 SQL 이 낼 수 있는 값»의 `cancel_request` 칸은 FAIL(다음 단계)

- [ ] **Step 3: 구현 — 판정 SQL**

`order-progress.judge-sql.ts`:

1. import: `import { SETTLE_DELAYED_AFTER_MS } from './order-progress.thresholds';`, `import { CHANNEL_CANCEL_REQUEST_REASON } from '../../sales-order/channel-cancel-request/channel-cancel-request.types';`
2. `function judgeCtes(scope: SQL): SQL` → `function judgeCtes(scope: SQL, now: SQL): SQL`.
3. `creq` CTE(158-165줄)를:

```sql
    -- 채널 취소 요청(#1016 35번·36번 재설계). requested = 옛 행(출고 보류 중), settling = 확정됨·정산 중.
    -- 한 주문에 여럿일 수 있다(정산 중 요청 둘) — 보류 중인 옛 행이 먼저, 그다음 나쁜 순(거절 > 지연 > 정산 중), 같으면 오래된 것.
    -- «지연»은 저장하지 않는다 — 확정 시각(created_at) + SETTLE_DELAYED_AFTER_MS 로 여기서 정한다(D1).
    creq AS (
      SELECT DISTINCT ON (a.sales_order_id) a.sales_order_id, a.created_at, x.state
        FROM sales_order_amendments a
        JOIN so ON so.id = a.sales_order_id
        CROSS JOIN LATERAL (
          SELECT CASE
                   WHEN a.status = 'requested' AND a.metadata->'request'->>'stage' = 'edited' THEN 'cancel_edited'
                   WHEN a.status = 'requested' THEN 'cancel_requested'
                   WHEN a.metadata->'settlement'->>'state' = 'refused' THEN 'settle_refused'
                   WHEN a.created_at < ${now} - make_interval(mins => ${SETTLE_DELAYED_AFTER_MS / 60_000}) THEN 'settle_delayed'
                   ELSE 'settle_in_progress'
                 END AS state
        ) x
       WHERE a.reason_code = ${CHANNEL_CANCEL_REQUEST_REASON} AND a.status IN ('requested', 'settling')
       ORDER BY a.sales_order_id,
                CASE x.state WHEN 'cancel_requested' THEN 0 WHEN 'cancel_edited' THEN 0
                             WHEN 'settle_refused' THEN 1 WHEN 'settle_delayed' THEN 2 ELSE 3 END,
                a.created_at
    ),
```

4. `decided` 의 규칙 CASE 첫 줄을 둘로:

```sql
               WHEN cr.state IN ('cancel_requested', 'cancel_edited') THEN 'cancel_request'
               -- 확정된 취소의 정산 — 보류가 아니다. 상자 규칙 제외(D16)에 넣지 않는다(order-reconcile.subject.ts, D5)
               WHEN cr.sales_order_id IS NOT NULL THEN 'cancel_settle'
```

5. `judgedRowsSql` 의 세 CASE 에서 `WHEN 'cancel_request' THEN …` 마다 `cancel_settle` 도 같은 값:
   - stage: `WHEN 'cancel_request' THEN 'cancel_request' WHEN 'cancel_settle' THEN 'cancel_request'`
   - state: `WHEN 'cancel_request' THEN d.creq_state WHEN 'cancel_settle' THEN d.creq_state`
   - estimated: `WHEN 'cancel_request' THEN d.creq_at WHEN 'cancel_settle' THEN d.creq_at`
   그리고 `${judgeCtes(scope)}` → `${judgeCtes(scope, now)}`.
6. `judgedShipmentsSql` 의 `${judgeCtes(scope)}` → `${judgeCtes(scope, sql`now()`)}` — 상자 판정은 주문 규칙 이름만 읽어 «지연» 경계가 결과에 닿지 않는다.
7. 파일 머리 주석의 «열린 채널 취소 요청(#1016 35번) — 출고 보류 중이라 다른 단계는 멈춰 있다. 한 주문에 하나(부분 유니크).» 줄은 위 3 의 주석으로 대체된다.

`order-reconcile.subject.ts` 의 `SHIPMENT_EXCLUDED_ORDER_RULES` 주석에 한 줄: `채널 취소의 정산(cancel_settle)은 넣지 않는다 — 확정됐고 보류가 없다. 부분취소의 남은 상자는 상자 규칙의 도움을 받는다(#1016 36번 재설계 D5).`
`order-reconcile.subject.spec.ts` 에:

```ts
  it('정산 중인 채널 취소(cancel_settle)는 상자 규칙을 막지 않는다 — 보류가 아니다', () => {
    const row = { stage: 'pick', state: 'CONSOLIDATION_PENDING', orderRules: ['cancel_settle'] };
    expect(shipmentInSituation({ stage: 'pick', states: ['CONSOLIDATION_PENDING'] }, row)).toBe(true);
  });
```

Run: `npx jest apps/core/src/modules/fulfillment/order-progress apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.spec.ts` → PASS

- [ ] **Step 4: 실패하는 통합 테스트 — 판정**

`__support__/order-progress.fixtures.ts` 에:

```ts
/** 확정된 채널 취소 요청(정산 중) — #1016 36번 재설계. createdAt 이 확정 시각이다 */
export async function seedSettling(
  tx: DbTx,
  salesOrderId: string,
  args: { createdAt: Date; state?: 'in_progress' | 'refused'; mode?: 'auto' | 'manual' },
): Promise<string> {
  const id = randomUUID();
  const at = args.createdAt.toISOString();
  await tx.insert(wmsTables.salesOrderAmendments).values({
    id,
    salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: 'CHANNEL_CANCEL_REQUEST',
    deltas: [],
    metadata: {
      salesChannel: 'medusa',
      externalOrderId: `ext-${id.slice(0, 8)}`,
      request: { kind: 'cancel', scope: 'full', requestedBy: 'customer:c', sourceKey: id, appliedAt: at, command: { requestId: id } },
      settlement: {
        state: args.state ?? 'in_progress',
        mode: args.mode ?? 'auto',
        since: at,
        ...(args.state === 'refused'
          ? { lastFailure: { code: 'wallet_refund_refused:X', message: '거절', retryable: false, at } }
          : {}),
      },
    },
    origin: 'operator',
    status: 'settling',
    occurredAt: args.createdAt,
    createdAt: args.createdAt,
  });
  return id;
}
```

`order-progress.judge.integration.spec.ts` 의 `'수정됨 · 환불 미완 …'` 테스트 아래에(`now = 2026-10-06T03:00:00Z`):

```ts
  it('정산 중 — 취소된 판매주문이어도 종료가 아니라 cancel_request/settle_in_progress, 진입 = 확정 시각', async () => {
    const at = new Date('2026-10-06T02:50:00.000Z');
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, o.salesOrderId, { createdAt: at });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel_request', state: 'settle_in_progress', outcome: null, estimatedEnteredAt: at.toISOString() });
  });

  it('확정 후 30분 초과 → settle_delayed · 거절 → settle_refused', async () => {
    const [delayed, refused] = await judgeIn(async (tx) => {
      const a = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, a.salesOrderId, { createdAt: new Date('2026-10-06T02:29:00.000Z') });
      const b = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, b.salesOrderId, { createdAt: new Date('2026-10-06T02:55:00.000Z'), state: 'refused' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect([delayed, refused].map((r) => r.state).sort()).toEqual(['settle_delayed', 'settle_refused']);
  });

  it('정확히 30분은 아직 정산 중 — «넘어야» 지연', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:30:00.000Z') });
      return o.salesOrderId;
    });
    expect(r.state).toBe('settle_in_progress');
  });

  it('정산 중 요청 둘 → 가장 나쁜 상태가 대표(거절 > 지연 > 정산 중)', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:58:00.000Z') });
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:59:00.000Z'), state: 'refused' });
      return o.salesOrderId;
    });
    expect(r.state).toBe('settle_refused');
  });

  it('옛 requested 행과 정산 중 행이 같이 있으면 옛 행(보류 중)이 대표', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:55:00.000Z'), state: 'refused' });
      await tx.insert(wmsTables.salesOrderAmendments).values({
        salesOrderId: o.salesOrderId,
        amendmentKind: 'commercial',
        reasonCode: 'CHANNEL_CANCEL_REQUEST',
        deltas: [],
        metadata: { request: { kind: 'cancel' } },
        origin: 'operator',
        status: 'requested',
        createdAt: new Date('2026-10-06T02:56:00.000Z'),
      });
      return o.salesOrderId;
    });
    expect(r.state).toBe('cancel_requested');
  });

  it('정산 중 부분취소의 남은 상자 — 상자 판정의 주문 규칙은 cancel_settle(상자 규칙 제외 아님)', async () => {
    let judged: Awaited<ReturnType<OrderProgressReader['judgeShipment']>>;
    await expect(
      db.transaction(async (raw) => {
        const tx = raw as unknown as DbTx;
        const w = await f.seedWorld(tx);
        const o = await f.seedOrder(tx);
        const fo = await f.seedFo(tx, w, o, { status: 'ready' });
        const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', plannedAt: new Date('2026-10-06T01:00:00.000Z') });
        await f.seedSettling(tx, o.salesOrderId, { createdAt: new Date('2026-10-06T02:58:00.000Z') });
        judged = await reader.judgeShipment(box.shipmentId, tx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(judged!.orderRules).toEqual(['cancel_settle']);
  });
```

`judge()` 는 행 순서를 보장하지 않아 두 번째 테스트는 «두 상태가 모두 나온다»만 본다. `seedFo`·`seedBox` 의 반환 칸 이름(`foItemId`·`shipmentId`)은 기존 테스트(«열린 취소 요청 …»)와 같다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-progress.judge.integration`
Expected: 새 테스트 PASS(Step 3 에서 SQL 을 이미 고쳤다). 이 순서가 TDD 가 아닌 이유: 판정 SQL 의 단위 «실패»는 Step 2 의 어휘 스펙이 먼저 잡았다. 통합이 처음부터 초록이면
**Step 3 의 `creq` 를 잠깐 되돌려 새 테스트가 빨개지는지 한 번 본다**(변이 확인) — 되돌린 것은 커밋하지 않는다.

- [ ] **Step 5: 실패하는 통합 테스트 — 보드 목록·요약**

`order-progress.board.integration.spec.ts` 끝(마지막 `it` 뒤)에:

```ts
  it('취소 요청 단계 — 정산 중은 갇히지 않고 거절은 바로 갇힘, 행에 정산 정보(가장 나쁜 요청)가 실린다', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        const now = new Date('2099-01-01T00:00:00.000Z');
        const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);
        const inProgress = await f.seedOrder(tx, { status: 'cancelled' });
        await f.seedSettling(tx, inProgress.salesOrderId, { createdAt: minutesAgo(10) });
        const refused = await f.seedOrder(tx);
        await f.seedSettling(tx, refused.salesOrderId, { createdAt: minutesAgo(9) });
        const refusedId = await f.seedSettling(tx, refused.salesOrderId, { createdAt: minutesAgo(8), state: 'refused' });
        const ids = [inProgress.salesOrderId, refused.salesOrderId];
        await manager.refreshScope(sql`SELECT unnest(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`, now, tx);

        const page = await reader.listOrders({ stage: 'cancel_request', sort: 'dwell', limit: 200 }, now, tx);
        const ours = page.items.filter((i) => ids.includes(i.salesOrderId));
        const byId = new Map(ours.map((i) => [i.salesOrderId, i]));
        expect(byId.get(inProgress.salesOrderId)).toMatchObject({ state: 'settle_in_progress', stuck: false, settlement: { phase: 'in_progress' } });
        expect(byId.get(refused.salesOrderId)).toMatchObject({
          state: 'settle_refused',
          stuck: true,
          settlement: { requestId: refusedId, phase: 'refused', lastFailure: { message: '거절' } },
        });

        const stuckOnly = await reader.listOrders({ stage: 'cancel_request', stuck: true, sort: 'dwell', limit: 200 }, now, tx);
        expect(stuckOnly.items.map((i) => i.salesOrderId).filter((id) => ids.includes(id))).toEqual([refused.salesOrderId]);
        const notStuck = await reader.listOrders({ stage: 'cancel_request', stuck: false, sort: 'dwell', limit: 200 }, now, tx);
        expect(notStuck.items.map((i) => i.salesOrderId).filter((id) => ids.includes(id))).toEqual([inProgress.salesOrderId]);

        const summary = await reader.summary(now, tx);
        const states = summary.stages.find((s) => s.stage === 'cancel_request')!.states;
        expect(states.find((s) => s.state === 'settle_in_progress')?.stuck ?? 0).toBe(0);
        expect(states.find((s) => s.state === 'settle_refused')?.stuck).toBeGreaterThanOrEqual(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
```

`settle_in_progress` 의 «갇힘 0»은 같은 DB 의 다른 행에도 성립해야 하는 사실이다(그 상태는 언제나 갇히지 않는다) — 그래서 `toBe(0)` 로 단언해도 공유 DB 에서 안전하다.

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-progress.board.integration`
Expected: FAIL — `settlement` 없음, `stuck` 이 단계 기준

- [ ] **Step 6: 구현 — reader·DTO**

`order-progress.reader.ts`:

1. import: `stuckAfterMs` 대신 행별 SQL 식을 쓰므로 `STUCK_AFTER_MS_BY_STATE` 와 `isStuck`; `PHASE_RANK, SettlementView, toSettlementView, CHANNEL_CANCEL_REQUEST_REASON` (`'../../sales-order/channel-cancel-request/channel-cancel-request.types'`).
2. `OrderProgressItem` 에 `settlement: SettlementView | null;` 와 `walletIntentId: string | null;`.
3. 파일 하단(`toShipmentRows` 위)에:

```ts
/**
 * 행마다의 갇힘 기준선 — 세부 상태 덮어쓰기가 단계 기준보다 앞선다(D6). NULL = 갇히지 않음.
 * 요약과 목록이 같은 식을 쓴다(기준은 thresholds 한 곳에서만 온다).
 */
function stuckCutoffSql(now: Date): SQL {
  const t = wmsTables.orderProgress;
  const byState = Object.entries(STUCK_AFTER_MS_BY_STATE).map(([state, ms]) =>
    ms === null || ms === undefined
      ? sql`WHEN ${t.state} = ${state} THEN NULL::timestamptz`
      : sql`WHEN ${t.state} = ${state} THEN ${new Date(now.getTime() - ms).toISOString()}::timestamptz`,
  );
  const byStage = ORDER_PROGRESS_STAGES.map(
    (s) => sql`WHEN ${t.stage} = ${s} THEN ${stuckCutoff(s, now).toISOString()}::timestamptz`,
  );
  return sql`(CASE ${sql.join([...byState, ...byStage], sql` `)} ELSE ${now.toISOString()}::timestamptz END)`;
}

/** 취소 요청 단계 목록의 행마다 정산 정보 — 한 주문에 여럿이면 가장 나쁜 것, 같으면 먼저 확정된 것 */
async function settlementsOf(trx: DbTx, salesOrderIds: string[], now: Date): Promise<Map<string, SettlementView>> {
  const a = wmsTables.salesOrderAmendments;
  const rows = await trx
    .select({ id: a.id, salesOrderId: a.salesOrderId, status: a.status, createdAt: a.createdAt, metadata: a.metadata })
    .from(a)
    .where(and(inArray(a.salesOrderId, salesOrderIds), eq(a.reasonCode, CHANNEL_CANCEL_REQUEST_REASON), eq(a.status, 'settling')));
  const out = new Map<string, SettlementView>();
  for (const row of rows) {
    const view = toSettlementView(row, now);
    if (!view) continue;
    const prev = out.get(row.salesOrderId);
    const worse =
      !prev ||
      PHASE_RANK[view.phase] < PHASE_RANK[prev.phase] ||
      (PHASE_RANK[view.phase] === PHASE_RANK[prev.phase] && view.confirmedAt < prev.confirmedAt);
    if (worse) out.set(row.salesOrderId, view);
  }
  return out;
}
```

4. `summary()` 의 `const cutoff = sql\`CASE ${t.stage} …\`` 를 `const cutoff = stuckCutoffSql(now);` 로.
5. `listOrders()`:
   - `if (query.stuck === true) conds.push(lt(…stuckCutoff(query.stage, now)))` 두 줄을:
     ```ts
     const cutoff = stuckCutoffSql(now);
     if (query.stuck === true) conds.push(sql`${t.stageEnteredAt} < ${cutoff}`);
     if (query.stuck === false) conds.push(sql`coalesce(${t.stageEnteredAt} < ${cutoff}, false) = false`);
     ```
   - select 에 `walletIntentId: so.walletIntentId,`
   - `const gaveUpBy = …` 아래에 `const settlements = query.stage === 'cancel_request' && ids.length > 0 ? await settlementsOf(trx, ids, now) : new Map<string, SettlementView>();`
   - 행 매핑: `stuck: isStuck(query.stage, row.stageEnteredAt, now, row.state ?? null),`, `settlement: settlements.get(row.salesOrderId) ?? null,`, `walletIntentId: row.walletIntentId ?? null,`
   - `lt` import 가 안 쓰이면 지운다.

`dto/order-progress-response.dto.ts` 에(중첩 DTO 는 클래스로 — CLAUDE.md):

```ts
export class OrderProgressSettlementFailureDto {
  @ApiProperty() code!: string;
  @ApiProperty({ description: '채널이 준 문장 그대로(wallet 거절은 토스 한국어 메시지)' }) message!: string;
  @ApiProperty() retryable!: boolean;
  @ApiProperty() at!: string;
}

export class OrderProgressSettlementDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({ enum: ['in_progress', 'delayed', 'refused'] }) phase!: string;
  @ApiProperty({ enum: ['auto', 'manual'] }) mode!: string;
  @ApiProperty({ description: '확정 시각' }) confirmedAt!: string;
  @ApiProperty({ description: '3영업일 기한(주말 제외)' }) deadlineAt!: string;
  @ApiProperty({ nullable: true, type: OrderProgressSettlementFailureDto }) lastFailure!: OrderProgressSettlementFailureDto | null;
}
```

`OrderProgressItemDto` 에:

```ts
  @ApiProperty({ nullable: true, type: OrderProgressSettlementDto, description: '취소 요청 단계의 정산 중 요청(가장 나쁜 것). 그 밖은 null' })
  settlement!: OrderProgressSettlementDto | null;
  @ApiProperty({ nullable: true, type: String }) walletIntentId!: string | null;
```

(`OrderProgressSettlementDto` 를 `OrderProgressItemDto` 보다 위에 둔다.)

- [ ] **Step 7: 통과 확인**

```bash
npx jest apps/core/src/modules/fulfillment
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-progress
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/fulfillment/order-reconcile
```

Expected: PASS. 리컨실러 통합(12번·25번)이 그대로 초록인지가 «판정 규칙 이름을 갈랐어도 기존 규칙이 안 흔들린다»의 증거다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "feat(core): 정체 보드 — 정산 중·환불 지연·환불 거절, 상태별 갇힘, 행의 정산 정보 (#1016 36번 재설계 PR 5)"
```

---

### Task 6: 리컨실러 규칙 «정산 재시도» (36번, 관찰 모드)

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts`(순수 판정 하나), `channel-cancel-request.manager.ts`, `channel-cancel-request.service.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts`(export)
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts`, `retry-channel-settlement.rule.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts`, `order-reconcile.module.ts`
- Test: `channel-cancel-settlement-actions.integration.spec.ts`(재발행 몇 줄 추가)

**Interfaces:**
- Consumes: Task 1 `SETTLEMENT_REISSUE_GRACE_MS`, Task 2 `findSettling`
- Produces:
  - `isReissuable(settlement: Settlement, now: Date): boolean` (types)
  - `ChannelCancelRequestService.settlementFingerprint(salesOrderId: string, tx: DbTx): Promise<string>`
  - `ChannelCancelRequestService.hasSettlementToReissue(salesOrderId: string, now: Date, tx: DbTx): Promise<boolean>`
  - `ChannelCancelRequestService.reissueSettlements(salesOrderId: string, now: Date, tx: DbTx): Promise<number>`
  - 규칙 `RetryChannelSettlementRule` — `name = 'retry-channel-settlement'`, `row = 36`, `mode = 'observe'`, `situation = { stage: 'cancel_request', states: ['settle_in_progress', 'settle_delayed'] }`
  - 명령 멱등 키: `cancel-request:<id>:reconcile:<ms>`

- [ ] **Step 1: 실패하는 단위 테스트 — 순수 판정·규칙 모양**

`channel-cancel-request.types.spec.ts` 끝에:

```ts
describe('isReissuable — 리컨실러가 다시 낼 정산', () => {
  const since = '2026-10-12T01:00:00.000Z';
  it('정산 중이고 시작한 지 1분이 지났으면 다시 낸다', () => {
    expect(isReissuable({ state: 'in_progress', mode: 'auto', since }, new Date('2026-10-12T01:01:00.000Z'))).toBe(true);
    expect(isReissuable({ state: 'in_progress', mode: 'auto', since }, new Date('2026-10-12T01:00:59.999Z'))).toBe(false);
  });
  it('거절은 다시 내지 않는다 — 운영자가 고른다', () => {
    expect(isReissuable({ state: 'refused', mode: 'auto', since }, new Date('2026-10-13T00:00:00.000Z'))).toBe(false);
  });
});
```

`retry-channel-settlement.rule.spec.ts`:

```ts
import { RetryChannelSettlementRule } from './retry-channel-settlement.rule';
import type { DbTx } from '../../../inventory/schema/inventory.schema';

describe('RetryChannelSettlementRule (#1016 36번)', () => {
  const tx = {} as DbTx;
  const service = {
    settlementFingerprint: jest.fn().mockResolvedValue('r1:auto:2026-10-12T01:00:00.000Z'),
    hasSettlementToReissue: jest.fn().mockResolvedValue(true),
    reissueSettlements: jest.fn().mockResolvedValue(0),
  };
  const rule = new RetryChannelSettlementRule(service as never);

  it('관찰 모드로 나간다 — 실행 전환은 channel-adapter ack 전환과 같은 배포(PR 6)', () => {
    expect(rule.mode).toBe('observe');
    expect(rule.row).toBe(36);
    expect(rule.situation).toEqual({ stage: 'cancel_request', states: ['settle_in_progress', 'settle_delayed'] });
  });

  it('거절(settle_refused)은 칸에 없다 — 리컨실러는 영구 거절을 다시 부르지 않는다', () => {
    expect(rule.situation.states).not.toContain('settle_refused');
  });

  it('다시 낸 것이 없으면 noop — 시도로 세지 않는다(D13 of 12번 스펙)', async () => {
    expect(await rule.act('so-1', tx)).toBe('noop');
    service.reissueSettlements.mockResolvedValueOnce(1);
    expect(await rule.act('so-1', tx)).toBe('acted');
  });

  it('지문·검사는 서비스에 위임한다', async () => {
    expect(await rule.fingerprint('so-1', tx)).toBe('r1:auto:2026-10-12T01:00:00.000Z');
    expect(await rule.check('so-1', tx)).toBe(true);
    expect(service.hasSettlementToReissue).toHaveBeenCalledWith('so-1', expect.any(Date), tx);
  });
});
```

Run: `npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.spec.ts apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.spec.ts` → FAIL

- [ ] **Step 2: 구현 — 판정·서비스**

types.ts(`settlementPhase` 아래, import 에 `SETTLEMENT_REISSUE_GRACE_MS`):

```ts
/** 리컨실러 36번이 다시 낼 정산 — 정산 중이고, 막 (다시) 시작한 지 SETTLEMENT_REISSUE_GRACE_MS 가 지났다. 거절은 운영자가 고른다 */
export function isReissuable(settlement: Settlement, now: Date): boolean {
  return settlement.state === 'in_progress' && now.getTime() - Date.parse(settlement.since) >= SETTLEMENT_REISSUE_GRACE_MS;
}
```

manager(`restartSettlement` 아래):

```ts
  /** 리컨실러 36번의 지문 — 다시 낼 수 있는 정산(거절 아님)의 id·방식·시작 시각. 운영자 조치가 since 를 바꾸면 리셋된다(판정 4) */
  async settlementFingerprint(salesOrderId: string, tx?: DbTx): Promise<string> {
    return this.db.run(async (trx) => {
      const rows = await this.reader.findSettling(salesOrderId, trx);
      return rows
        .flatMap((row) => {
          const s = readCancelRequestMetadata(row.metadata).settlement;
          return s && s.state === 'in_progress' ? [`${row.id}:${s.mode}:${s.since}`] : [];
        })
        .join(',');
    }, tx);
  }

  async hasSettlementToReissue(salesOrderId: string, now: Date, tx?: DbTx): Promise<boolean> {
    return this.db.run(async (trx) => {
      const rows = await this.reader.findSettling(salesOrderId, trx);
      return rows.some((row) => {
        const s = readCancelRequestMetadata(row.metadata).settlement;
        return s !== undefined && isReissuable(s, now);
      });
    }, tx);
  }

  /** 같은 requestId·같은 방식으로 명령을 다시 낸다(멱등 — 스펙 §6.1·§10). since 는 그대로 — 시도 횟수는 리컨실러 상태가 센다(스펙 §7.3) */
  async reissueSettlements(salesOrderId: string, now: Date, tx?: DbTx): Promise<number> {
    return this.db.run(async (trx) => {
      let count = 0;
      for (const row of await this.reader.findSettling(salesOrderId, trx, { lock: true })) {
        const meta = readCancelRequestMetadata(row.metadata);
        const settlement = meta.settlement;
        if (!settlement || !isReissuable(settlement, now)) continue;
        await this.enqueue(
          { ...meta.request.command, refundMode: settlement.mode },
          `cancel-request:${row.id}:reconcile:${now.getTime()}`,
          trx,
        );
        // updated_at 을 밀어 투영이 다시 판정하게 한다
        await this.write(row.id, 'settling', meta, trx);
        count++;
      }
      return count;
    }, tx);
  }
```

service:

```ts
  settlementFingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    return this.manager.settlementFingerprint(salesOrderId, tx);
  }

  hasSettlementToReissue(salesOrderId: string, now: Date, tx: DbTx): Promise<boolean> {
    return this.manager.hasSettlementToReissue(salesOrderId, now, tx);
  }

  reissueSettlements(salesOrderId: string, now: Date, tx: DbTx): Promise<number> {
    return this.manager.reissueSettlements(salesOrderId, now, tx);
  }
```

(service 에 `DbTx` import.)

- [ ] **Step 3: 구현 — 규칙·배선**

`rules/retry-channel-settlement.rule.ts`:

```ts
// apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { ChannelCancelRequestService } from '../../../sales-order/channel-cancel-request/channel-cancel-request.service';
import { OrderReconcileRule, OrderReconcileSituation, ReconcileActResult } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';

/**
 * #1016 36번 행(재설계 §7.3): 확정된 채널 취소의 정산이 끝나지 않았다 — 같은 requestId·refundMode 로 명령을 다시 낸다.
 * 일시 실패·명령/사실 유실·channel-adapter 결함을 한 곳에서 잡는다. 영구 거절(settle_refused)은 칸에 없다 — 운영자가 고른다.
 */
@Injectable()
export class RetryChannelSettlementRule implements OrderReconcileRule {
  readonly name = 'retry-channel-settlement';
  readonly row = 36;
  readonly subject = 'order' as const;
  // 관찰로 배포한다. 실행 전환은 channel-adapter 의 일시 실패 ack 전환과 같은 배포(PR 6) — 그 전까지 일시 실패는 Kafka 재시도·DLQ 를 탄다
  readonly mode: ReconcileMode = 'observe';
  readonly situation: OrderReconcileSituation = {
    stage: 'cancel_request',
    states: ['settle_in_progress', 'settle_delayed'],
  };

  constructor(private readonly cancelRequests: ChannelCancelRequestService) {}

  fingerprint(salesOrderId: string, tx: DbTx): Promise<string> {
    return this.cancelRequests.settlementFingerprint(salesOrderId, tx);
  }

  check(salesOrderId: string, tx: DbTx): Promise<boolean> {
    return this.cancelRequests.hasSettlementToReissue(salesOrderId, new Date(), tx);
  }

  async act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult> {
    return (await this.cancelRequests.reissueSettlements(salesOrderId, new Date(), tx)) > 0 ? 'acted' : 'noop';
  }
}
```

`order-reconcile.registry.ts` 에 `RetryChannelSettlementRule, // #1016 36번` 한 줄과 import.
`sales-order.module.ts` 의 `exports` 에 `ChannelCancelRequestService, // Fulfillment BC (리컨실러 36번 — 정산 재발행)`.
`order-reconcile.module.ts` 의 `imports` 에 `SalesOrderModule`(`'../../sales-order/sales-order.module'`) — `FulfillmentModule` 이 이미 `SalesOrderModule` 을 import 하므로 순환이 아니다.

- [ ] **Step 4: 통합 — 재발행**

`channel-cancel-settlement-actions.integration.spec.ts` 끝에:

```ts
  it('리컨실러 재발행 — 1분 안엔 안 내고, 지나면 같은 requestId·방식으로 하나 더. 거절은 안 낸다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const view = await w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1' }, tx);
      const confirmedAt = Date.parse(view.requestedAt);
      expect(await w.manager.hasSettlementToReissue(seed.salesOrderId, new Date(confirmedAt + 30_000), tx)).toBe(false);
      const later = new Date(confirmedAt + 61_000);
      expect(await w.manager.hasSettlementToReissue(seed.salesOrderId, later, tx)).toBe(true);
      expect(await w.manager.reissueSettlements(seed.salesOrderId, later, tx)).toBe(1);
      const commands = await commandsOf(tx, seed.externalOrderId);
      expect(commands).toHaveLength(2);
      expect(commands[1].payload.payload).toMatchObject({ requestId: view.id, refundMode: 'auto' });

      const fp = await w.manager.settlementFingerprint(seed.salesOrderId, tx);
      await w.manager.recordSettlementFailure(
        { requestId: view.id, retryable: false, failureCode: 'wallet_refund_refused:X', message: '거절', at: new Date(confirmedAt + 62_000).toISOString() },
        tx,
      );
      expect(await w.manager.hasSettlementToReissue(seed.salesOrderId, new Date(confirmedAt + 3_600_000), tx)).toBe(false);
      expect(await w.manager.settlementFingerprint(seed.salesOrderId, tx)).not.toBe(fp);
    });
  });
```

- [ ] **Step 5: 통과 확인**

```bash
npx jest apps/core/src/modules/sales-order/channel-cancel-request apps/core/src/modules/fulfillment/order-reconcile
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- channel-cancel-settlement-actions
npm run type-check
```

Expected: PASS · 0. Nest DI 는 Task 10 의 로컬 기동에서 직접 본다(`order-reconcile retry-channel-settlement(#36, observe)` 로그가 정산 중 주문이 있을 때 찍힌다).

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/sales-order apps/core/src/modules/fulfillment/order-reconcile
git commit -m "feat(core): 리컨실러 #1016 36번 — 정산 재시도(관찰 모드) (#1016 36번 재설계 PR 5)"
```

---

### Task 7: 고객 actions API — 정산 상태를 환불 배지로

**Files:**
- Create: `apps/core/src/modules/sales-order/services/channel-refund-status.ts`, `channel-refund-status.spec.ts`
- Modify: `apps/core/src/modules/sales-order/services/wallet-refund.client.ts` (+ `wallet-refund.client.spec.ts`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.reader.ts`, `channel-cancel-request.service.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:73, 545-745, 1399-1420`
- Modify: `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts:13, 46`
- Test: `store-sales-orders.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `toSettlementView`, `SettlementMode`, `SettlementPhase`
- Produces:
  - `StoreRefundStatus = 'none' | 'pending' | 'manual_pending' | 'succeeded' | 'failed' | 'delayed' | 'transfer_pending'`
  - `ChannelSettlementFact = { status: 'settling'; mode: SettlementMode; phase: SettlementPhase } | { status: 'applied'; mode: SettlementMode }`
  - `ManualTransfer = 'pending' | 'done' | 'unknown'`
  - `needsManualTransferCheck(facts: ChannelSettlementFact[]): boolean`
  - `manualTransferOf(refunds: WalletRefundListItem[] | null): ManualTransfer`
  - `channelRefundStatus(facts: ChannelSettlementFact[], manualTransfer: ManualTransfer | null): StoreRefundStatus | null`
  - `WalletRefundClient.listRefundsByIntent(intentId: string): Promise<WalletRefundListItem[] | null>`
  - `WalletRefundListItem = { id: string; status: WalletRefundStatus; execution: 'AUTO' | 'MANUAL'; amount: number }`
  - `ChannelCancelRequestService.settlementFactsFor(salesOrderId: string, now?: Date): Promise<ChannelSettlementFact[]>`(최근 순)

- [ ] **Step 1: 실패하는 단위 테스트 — 순수함수**

`channel-refund-status.spec.ts`:

```ts
import { channelRefundStatus, manualTransferOf, needsManualTransferCheck } from './channel-refund-status';

const settling = (phase: 'in_progress' | 'delayed' | 'refused', mode: 'auto' | 'manual' = 'auto') =>
  ({ status: 'settling', mode, phase }) as const;
const applied = (mode: 'auto' | 'manual' = 'auto') => ({ status: 'applied', mode }) as const;

describe('channelRefundStatus — 정산 → 고객 환불 배지(스펙 §8.2)', () => {
  it('정산 중 → pending', () => {
    expect(channelRefundStatus([settling('in_progress')], null)).toBe('pending');
  });
  it('지연·거절 → delayed — 고객에겐 둘을 구분하지 않는다(§5.2)', () => {
    expect(channelRefundStatus([settling('delayed')], null)).toBe('delayed');
    expect(channelRefundStatus([settling('refused')], null)).toBe('delayed');
  });
  it('정산 중 하나라도 지연·거절이면 delayed(수동이 섞여도)', () => {
    expect(channelRefundStatus([settling('in_progress', 'manual'), settling('refused')], null)).toBe('delayed');
  });
  it('수동으로 정산 중 → transfer_pending', () => {
    expect(channelRefundStatus([settling('in_progress', 'manual')], null)).toBe('transfer_pending');
  });
  it('수동으로 끝남 · wallet 송금 대기 → transfer_pending / 송금 끝 → 기존 도출 / 모름 → transfer_pending', () => {
    expect(channelRefundStatus([applied('manual')], 'pending')).toBe('transfer_pending');
    expect(channelRefundStatus([applied('manual')], 'done')).toBeNull();
    expect(channelRefundStatus([applied('manual')], 'unknown')).toBe('transfer_pending');
  });
  it('자동으로 끝남 → 기존 도출(수집된 환불)', () => {
    expect(channelRefundStatus([applied('auto')], null)).toBeNull();
  });
  it('요청 없음 → 기존 도출', () => {
    expect(channelRefundStatus([], null)).toBeNull();
  });
});

describe('needsManualTransferCheck — wallet 은 «가장 최근 정산이 수동으로 끝난» 주문만 부른다', () => {
  it('최근 정산이 수동으로 끝났고 정산 중인 것이 없을 때만', () => {
    expect(needsManualTransferCheck([applied('manual'), applied('auto')])).toBe(true);
    expect(needsManualTransferCheck([applied('auto'), applied('manual')])).toBe(false);
    expect(needsManualTransferCheck([settling('in_progress'), applied('manual')])).toBe(false);
    expect(needsManualTransferCheck([])).toBe(false);
  });
});

describe('manualTransferOf', () => {
  it('MANUAL + PENDING 이 있으면 pending, 없으면 done, 응답 없음은 unknown', () => {
    expect(manualTransferOf([{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 1000 }])).toBe('pending');
    expect(manualTransferOf([{ id: 'r1', status: 'SUCCEEDED', execution: 'MANUAL', amount: 1000 }])).toBe('done');
    expect(manualTransferOf([{ id: 'r1', status: 'PENDING', execution: 'AUTO', amount: 1000 }])).toBe('done');
    expect(manualTransferOf(null)).toBe('unknown');
  });
});
```

Run: `npx jest apps/core/src/modules/sales-order/services/channel-refund-status.spec.ts` → FAIL(파일 없음)

- [ ] **Step 2: 구현 — 순수함수**

`channel-refund-status.ts`:

```ts
import type { StoreRefundStatus } from '../dto/store-order-actions.dto';
import type { SettlementMode, SettlementPhase } from '../channel-cancel-request/channel-cancel-request.types';
import type { WalletRefundListItem } from './wallet-refund.client';

/** 채널 주문 취소 요청 하나의 정산 — 최근 순으로 넘긴다 */
export type ChannelSettlementFact =
  | { status: 'settling'; mode: SettlementMode; phase: SettlementPhase }
  | { status: 'applied'; mode: SettlementMode };

/** 수동 정산이 끝난 뒤 wallet 의 송금 대기 행. unknown = wallet 이 답하지 않았다 */
export type ManualTransfer = 'pending' | 'done' | 'unknown';

/** 수동 정산은 Medusa 에 Refund 행이 생겨 «수집된 환불»로 보이지만, 실제 송금은 운영자가 [완료 처리]를 눌러야 끝난다(스펙 §8.2) */
export function needsManualTransferCheck(facts: ChannelSettlementFact[]): boolean {
  if (facts.some((f) => f.status === 'settling')) return false;
  const latest = facts[0];
  return latest !== undefined && latest.status === 'applied' && latest.mode === 'manual';
}

export function manualTransferOf(refunds: WalletRefundListItem[] | null): ManualTransfer {
  if (refunds === null) return 'unknown';
  return refunds.some((r) => r.execution === 'MANUAL' && r.status === 'PENDING') ? 'pending' : 'done';
}

/**
 * 채널 주문의 정산 → 고객 환불 배지(스펙 §8.2, #1016 36번 재설계 판정 5). null = 정산이 할 말이 없다 — 부르는 쪽이 지금 도출(수집된 환불 등)을 쓴다.
 * 고객에게는 지연과 거절을 구분하지 않는다(§5.2). wallet 을 모르면 «아직 송금 전»이 안전하다 — «완료»라고 했다가 돈이 안 갔으면 거짓이다.
 */
export function channelRefundStatus(
  facts: ChannelSettlementFact[],
  manualTransfer: ManualTransfer | null,
): StoreRefundStatus | null {
  const open = facts.filter((f): f is Extract<ChannelSettlementFact, { status: 'settling' }> => f.status === 'settling');
  if (open.some((f) => f.phase !== 'in_progress')) return 'delayed';
  if (open.some((f) => f.mode === 'manual')) return 'transfer_pending';
  if (open.length > 0) return 'pending';
  if (needsManualTransferCheck(facts) && manualTransfer !== 'done') return 'transfer_pending';
  return null;
}
```

Run → PASS

- [ ] **Step 3: 실패하는 테스트 — wallet 목록 클라이언트**

`wallet-refund.client.spec.ts` 끝에:

```ts
describe('WalletRefundClient.listRefundsByIntent — 수동 송금 여부(#1016 36번 재설계 §8.2)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, WALLET_BASE_URL: 'http://wallet', WALLET_API_KEY: 'test-key' };
  });
  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('목록을 읽는다 — API 키, 시간 제한 신호를 건다', async () => {
    global.fetch = mockFetch(200, [
      { id: 'r1', chargeId: 'c1', status: 'PENDING', amount: 1000, reasonCode: null, execution: 'MANUAL', createdAt: '2026-10-12T00:00:00.000Z' },
    ]);
    const list = await new WalletRefundClient().listRefundsByIntent('intent-1');
    expect(list).toEqual([{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 1000 }]);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://wallet/v1/payment-intents/intent-1/refunds');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(init.signal).toBeDefined();
  });

  it('실패 응답·네트워크 오류·설정 없음 → null(부르는 쪽이 «모름»으로 읽는다)', async () => {
    global.fetch = mockFetch(500, { error: 'X' });
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
    process.env = { ...OLD_ENV, WALLET_BASE_URL: '', WALLET_API_KEY: '' };
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toBeNull();
  });

  it('모양이 다른 원소는 건너뛴다', async () => {
    global.fetch = mockFetch(200, [{ id: 'r1', status: 'PENDING' }, { id: 'r2', status: 'SUCCEEDED', execution: 'AUTO', amount: 10 }]);
    expect(await new WalletRefundClient().listRefundsByIntent('intent-1')).toEqual([
      { id: 'r2', status: 'SUCCEEDED', execution: 'AUTO', amount: 10 },
    ]);
  });
});
```

Run: `npx jest apps/core/src/modules/sales-order/services/wallet-refund.client.spec.ts` → FAIL

- [ ] **Step 4: 구현 — 클라이언트**

`wallet-refund.client.ts` 의 타입들 아래에:

```ts
/** `GET /v1/payment-intents/:id/refunds`(PR 1) 의 원소 중 core 가 읽는 칸 */
export interface WalletRefundListItem {
  id: string;
  status: WalletRefundStatus;
  execution: 'AUTO' | 'MANUAL';
  amount: number;
}

/** 고객 주문 목록이 wallet 을 기다리며 멈추지 않게 — 넘으면 «모름»(수동 송금은 «아직»으로 보인다) */
const LIST_TIMEOUT_MS = 2_000;
const REFUND_STATUSES: ReadonlySet<string> = new Set(['SUCCEEDED', 'PENDING', 'FAILED']);

function toListItem(value: unknown): WalletRefundListItem[] {
  if (typeof value !== 'object' || value === null) return [];
  const r = value as Record<string, unknown>;
  if (
    typeof r.id !== 'string' ||
    typeof r.status !== 'string' ||
    !REFUND_STATUSES.has(r.status) ||
    (r.execution !== 'AUTO' && r.execution !== 'MANUAL') ||
    typeof r.amount !== 'number'
  ) {
    return [];
  }
  return [{ id: r.id, status: r.status as WalletRefundStatus, execution: r.execution, amount: r.amount }];
}
```

`as WalletRefundStatus` 는 바로 위 `REFUND_STATUSES.has` 로 확인한 문자열의 좁히기다 — 타입 술어로 쓰려면 `function isRefundStatus(v: string): v is WalletRefundStatus { return REFUND_STATUSES.has(v); }` 를
두고 조건에 넣는다(CLAUDE.md `as` 금지 — **술어 쪽으로 쓴다**). 클래스에:

```ts
  /** 결제의 환불 목록. 실패·시간 초과·설정 없음은 null — 부르는 쪽이 «모름»으로 읽는다 */
  async listRefundsByIntent(intentId: string): Promise<WalletRefundListItem[] | null> {
    if (!this.baseUrl || !this.apiKey) return null;
    try {
      const response = await fetch(`${this.baseUrl}/v1/payment-intents/${encodeURIComponent(intentId)}/refunds`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`[WalletRefundClient] list refunds ${intentId} → ${response.status}`);
        return null;
      }
      const body: unknown = await response.json();
      return Array.isArray(body) ? body.flatMap(toListItem) : null;
    } catch (err) {
      this.logger.warn(`[WalletRefundClient] list refunds ${intentId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
```

`constructor` 가 env 를 읽는 시점이 생성 때다 — 테스트의 «설정 없음»은 env 를 바꾼 뒤 `new` 하므로 맞다.

Run: `npx jest apps/core/src/modules/sales-order/services/wallet-refund.client.spec.ts` → PASS

- [ ] **Step 5: 구현 — 요청 행 → 정산 사실**

reader 에:

```ts
  /** 새 흐름 요청 행(정산 중·끝남) — 최근 순. 정산 칸이 없는 옛 행은 부르는 쪽이 거른다 */
  async settlementRowsFor(salesOrderId: string, tx: DbTx | DbService<typeof wmsSchema>['db']): Promise<AmendmentRow[]> {
    return tx
      .select()
      .from(t)
      .where(and(eq(t.salesOrderId, salesOrderId), isCancelRequest, inArray(t.status, ['settling', 'applied'])))
      .orderBy(desc(t.createdAt), desc(t.id));
  }
```

(import `inArray`.) service 에:

```ts
  settlementFactsFor(salesOrderId: string, now: Date = new Date()): Promise<ChannelSettlementFact[]> {
    return this.db.run(async (tx) => {
      const rows = await this.reader.settlementRowsFor(salesOrderId, tx);
      return rows.flatMap((row): ChannelSettlementFact[] => {
        const settlement = readCancelRequestMetadata(row.metadata).settlement;
        if (!settlement) return [];
        if (row.status === 'settling') {
          const view = toSettlementView(row, now);
          return view ? [{ status: 'settling', mode: view.mode, phase: view.phase }] : [];
        }
        return [{ status: 'applied', mode: settlement.mode }];
      });
    });
  }
```

(import `ChannelSettlementFact` from `'../services/channel-refund-status'`, `readCancelRequestMetadata`·`toSettlementView` from types.)

- [ ] **Step 6: 실패하는 테스트 — actions API**

`store-sales-orders.service.spec.ts`:
- `makeContext` 옵션에 `settlementFacts?: Array<Record<string, unknown>>`, `walletRefunds?: Array<Record<string, unknown>> | null`.
- `cancelRequestsMock` 에 `settlementFactsFor: jest.fn().mockResolvedValue(options.settlementFacts ?? [])`.
- `walletClientMock` 에 `listRefundsByIntent: jest.fn().mockResolvedValue(options.walletRefunds === undefined ? [] : options.walletRefunds)`.

`describe('getActionsByChannelOrder')` 안에:

```ts
    describe('채널 취소 정산(#1016 36번 재설계 §8.2)', () => {
      const cancelled = () => makeSo({ status: 'cancelled' });

      it('정산 중 → refundStatus·refundSummary.status 모두 pending', async () => {
        const { service } = makeContext({ so: cancelled(), settlementFacts: [{ status: 'settling', mode: 'auto', phase: 'in_progress' }] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.refundStatus).toBe('pending');
        expect(r.refundSummary?.status).toBe('pending');
      });

      it('지연 → delayed, 안내 문장은 null(스토어프론트 i18n 이 정본 — PR 4 넘길 것 4)', async () => {
        const { service } = makeContext({ so: cancelled(), settlementFacts: [{ status: 'settling', mode: 'auto', phase: 'refused' }] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.refundStatus).toBe('delayed');
        expect(r.refundSummary).toMatchObject({ status: 'delayed', expectedProcessingMessage: null });
      });

      it('수동으로 끝남 + wallet 송금 대기 → transfer_pending', async () => {
        const { service, walletClientMock } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'applied', mode: 'manual' }],
          walletRefunds: [{ id: 'r1', status: 'PENDING', execution: 'MANUAL', amount: 50000 }],
        });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.refundStatus).toBe('transfer_pending');
        expect(r.refundSummary).toMatchObject({ status: 'transfer_pending', expectedProcessingMessage: null });
        expect(walletClientMock.listRefundsByIntent).toHaveBeenCalledWith(WALLET_INTENT_ID);
      });

      it('wallet 실패·시간 초과 → transfer_pending(«완료»라고 하지 않는다)', async () => {
        const { service } = makeContext({ so: cancelled(), settlementFacts: [{ status: 'applied', mode: 'manual' }], walletRefunds: null });
        expect((await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID)).refundStatus).toBe('transfer_pending');
      });

      it('수동 송금 끝 → 기존 도출(수집된 환불이면 succeeded)', async () => {
        const { service } = makeContext({
          so: cancelled(),
          settlementFacts: [{ status: 'applied', mode: 'manual' }],
          walletRefunds: [{ id: 'r1', status: 'SUCCEEDED', execution: 'MANUAL', amount: 50000 }],
          refundLinks: [{ relationName: 'order_lifecycle_refund_collected', metadata: { amount: 50000 }, createdAt: new Date() }],
        });
        expect((await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID)).refundStatus).toBe('succeeded');
      });

      it('자동 정산 주문은 wallet 을 부르지 않는다 — 목록 배치가 wallet 에 기대지 않게', async () => {
        const { service, walletClientMock } = makeContext({ so: cancelled(), settlementFacts: [{ status: 'applied', mode: 'auto' }] });
        await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(walletClientMock.listRefundsByIntent).not.toHaveBeenCalled();
      });

      it('운영자 부분취소 정산(판매주문은 살아 있음)에도 같은 값을 둘 다 싣는다(PR 4 넘길 것 3)', async () => {
        const { service } = makeContext({ settlementFacts: [{ status: 'settling', mode: 'auto', phase: 'in_progress' }] });
        const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
        expect(r.orderStatus).toBe('confirmed');
        expect(r.refundStatus).toBe('pending');
        expect(r.refundSummary?.status).toBe('pending');
      });
    });
```

Run: `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts` → FAIL

- [ ] **Step 7: 구현 — actions API·DTO**

`dto/store-order-actions.dto.ts`:

```ts
export type StoreRefundStatus =
  | 'none'
  | 'pending'
  | 'manual_pending'
  | 'succeeded'
  | 'failed'
  // 채널 주문 정산(#1016 36번 재설계 §8.2) — 스토어프론트 PR 4 가 먼저 안다
  | 'delayed'
  | 'transfer_pending';
```

`RefundSummaryDto.status` 의 `@ApiProperty({ enum: [...] })` 배열에 두 값.

`store-sales-orders.service.ts`:
- 73줄 `VALID_REFUND_STATUSES` 에 `'delayed', 'transfer_pending'`.
- import: `channelRefundStatus, manualTransferOf, needsManualTransferCheck` from `'./channel-refund-status'`.
- `buildActionsView` 의 첫 줄들(`const foRows = …` 다음)에:
  ```ts
    // 채널 주문의 정산 상태가 환불 배지를 정한다(#1016 36번 재설계 판정 5) — 정산이 할 말이 없으면 null 이고 아래 도출을 쓴다
    const settlementRefund = so.salesChannel === 'medusa' ? await this.channelSettlementRefundStatus(so) : null;
  ```
- 환불 블록(`if (needsRefundLookup) { … }`) 바로 뒤에:
  ```ts
    if (settlementRefund) {
      refundStatus = settlementRefund;
      refundSummary = buildRefundSummary({ status: settlementRefund, amount: null, manualRequired: false, lastUpdatedAt: null });
    }
  ```
- private 메서드(`processCancelRequest` 위):
  ```ts
  private async channelSettlementRefundStatus(so: SalesOrderRow): Promise<StoreRefundStatus | null> {
    const facts = await this.cancelRequests.settlementFactsFor(so.id);
    if (facts.length === 0) return null;
    const transfer = needsManualTransferCheck(facts)
      ? manualTransferOf(so.walletIntentId ? await this.walletRefundClient.listRefundsByIntent(so.walletIntentId) : null)
      : null;
    return channelRefundStatus(facts, transfer);
  }
  ```
- `buildRefundSummary` 의 `messages` 에 `delayed: null,` `transfer_pending: null,` (주석: `// 문구 정본은 스토어프론트 i18n — 한국어 한 문장이 세 언어 안내를 덮지 않게(PR 4 넘길 것 4)`).

Run: `npx jest apps/core/src/modules/sales-order/services` → PASS

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 고객 환불 배지에 채널 정산 — 지연·계좌 송금 예정, 수동 정산만 wallet 확인(2초) (#1016 36번 재설계 PR 5)"
```

---

### Task 8: admin-web 판정 순수함수 — 취소 요청·보드·환불 내역

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts` (+ `.spec.ts`)
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/lib/api/domains/wallet/refund-execution.ts` (+ `.spec.ts`)
- Modify: `apps/admin-web/src/lib/types/dto/wallet.ts:89-100`

**Interfaces:**
- Consumes: core 응답 — `cancelRequest.{status: 'settling', settlement, refundMode}`(Task 1·4), 보드 행 `settlement`·`walletIntentId`(Task 5), `AdminCancelResult.status = 'settling'`(Task 2)
- Produces:
  - `SettlementPhase`, `SettlementView`(core 와 같은 모양), `toSettlementView(value: unknown): SettlementView | null`
  - `CancelRequestView` 에 `status: … | 'settling'`, `settlement: SettlementView | null`, `refundMode: 'auto' | 'manual' | null`
  - `CancelAction` 에 `{ kind: 'settling'; label: string; alert: boolean }`
  - `SETTLEMENT_LABELS: Record<SettlementPhase, string>` — `in_progress` «환불 처리 중», `delayed` «환불 지연», `refused` «환불 거절»
  - `settlementReason(s: SettlementView): string | null`
  - `settlementActionsOf(s: SettlementView | null): { retry: boolean; manualRefund: boolean }`
  - `settlementTiming(s: SettlementView, now: number): string` — `확정 후 〈경과〉 · 기한 M/D(요일)`
  - `cancelRequestToast(r: Extract<AdminCancelResponse, { requestId: string }>): string`
  - `MANUAL_REFUND_CONFIRM_TEXT: string`
  - `ProgressItem` 에 `settlement: SettlementView | null`, `walletIntentId: string | null`
  - `refundExecutionLabel(execution: unknown): string`

- [ ] **Step 1: 실패하는 스펙 — 취소 요청**

`cancel-request.shape.spec.ts` 의 기존 `view()` 픽스처(14줄 근처)에 `settlement: null, refundMode: null` 을 더한다(타입이 요구한다). 파일 끝에:

```ts
describe('정산(#1016 36번 재설계)', () => {
  const settlement = (over: Partial<SettlementView> = {}): SettlementView => ({
    requestId: 'r1',
    phase: 'refused',
    mode: 'auto',
    confirmedAt: '2026-10-12T01:00:00.000Z',
    deadlineAt: '2026-10-15T01:00:00.000Z',
    lastFailure: { code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', message: '자동 환불할 수 없는 결제수단입니다', retryable: false, at: '2026-10-12T01:00:05.000Z' },
    ...over,
  });

  it('응답의 settling·정산 칸을 읽는다 — 옛 core 응답(칸 없음)은 null', () => {
    const v = toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full', requestedAt: 'x', settlement: settlement(), refundMode: 'auto' });
    expect(v).toMatchObject({ status: 'settling', refundMode: 'auto', settlement: { phase: 'refused' } });
    expect(toCancelRequestView({ id: 'r1', status: 'requested', scope: 'full' })).toMatchObject({ settlement: null, refundMode: null });
  });

  it('모양이 틀린 정산 칸은 null', () => {
    expect(toSettlementView({ requestId: 'r1', phase: 'weird' })).toBeNull();
    expect(toSettlementView(null)).toBeNull();
  });

  it.each([
    ['in_progress', '환불 처리 중', false],
    ['delayed', '환불 지연', true],
    ['refused', '환불 거절', true],
  ] as const)('취소 칸 — %s → %s', (phase, label, alert) => {
    const request = toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full', settlement: settlement({ phase }) });
    expect(cancelActionOf({ channel: 'medusa', orderStatus: 'cancelled', cancelRequest: request })).toEqual({ kind: 'settling', label, alert });
  });

  it('사유 — wallet·PG 거절은 «환불 거절», 그 밖은 «정산 실패 · 개발 확인»(PR 3 넘길 것 4)', () => {
    expect(settlementReason(settlement())).toBe('환불 거절 · 자동 환불할 수 없는 결제수단입니다');
    expect(settlementReason(settlement({ lastFailure: { code: 'not_found', message: 'Order not found', retryable: false, at: 'x' } }))).toBe(
      '정산 실패 · 개발 확인 · Order not found',
    );
    expect(settlementReason(settlement({ lastFailure: { code: 'http_502', message: '', retryable: true, at: 'x' } }))).toBe('정산 실패 · 개발 확인 · http_502');
    expect(settlementReason(settlement({ lastFailure: null }))).toBeNull();
  });

  it('조치 — 정산 중엔 없음, 지연·거절엔 둘, 이미 계좌 송금이면 다시 시도만', () => {
    expect(settlementActionsOf(settlement({ phase: 'in_progress' }))).toEqual({ retry: false, manualRefund: false });
    expect(settlementActionsOf(settlement({ phase: 'delayed' }))).toEqual({ retry: true, manualRefund: true });
    expect(settlementActionsOf(settlement({ mode: 'manual' }))).toEqual({ retry: true, manualRefund: false });
    expect(settlementActionsOf(null)).toEqual({ retry: false, manualRefund: false });
  });

  it('경과·기한 — 기한은 한국 날짜', () => {
    // 확정 01:00Z, 지금 02:30Z → 1시간 30분. 기한 2026-10-15T01:00Z = 10/15(목) KST
    expect(settlementTiming(settlement(), Date.parse('2026-10-12T02:30:00.000Z'))).toBe('확정 후 1시간 30분 · 기한 10/15(목)');
  });

  it('줄 문구 — 확정 + 정산 상태', () => {
    const v = toCancelRequestView({ id: 'r1', status: 'settling', scope: 'full', settlement: settlement({ phase: 'delayed' }) })!;
    expect(cancelRequestLine(v)).toBe('전체취소 확정 · 환불 지연');
  });

  it('취소 응답 토스트 — 확정이면 «취소했습니다», 옛 응답(requested)은 그대로', () => {
    expect(cancelRequestToast({ requestId: 'r1', status: 'settling', scope: 'full', convertedFromFull: false })).toBe('취소했습니다. 환불은 채널이 처리합니다.');
    expect(cancelRequestToast({ requestId: 'r1', status: 'settling', scope: 'partial', convertedFromFull: true })).toBe(
      '출고된 상품을 뺀 나머지를 취소했습니다. 환불은 채널이 처리합니다.',
    );
    expect(cancelRequestToast({ requestId: 'r1', status: 'requested', scope: 'full', convertedFromFull: false })).toBe('취소를 요청했습니다.');
  });

  it('계좌 송금 확인 문구는 실제 화면 이름을 쓴다(D7)', () => {
    expect(MANUAL_REFUND_CONFIRM_TEXT).toBe('고객에게 계좌를 받아 직접 송금한 뒤, 결제 상세의 환불 내역에서 [완료 처리]를 눌러 주세요.');
  });
});
```

import 에 새 이름들을 더한다. `formatDwell`(order-progress.shape)의 실제 출력 형식이 «1시간 30분»인지 먼저 확인한다(`order-progress.shape.ts:107`). 다르면 그 형식으로 기대값을 맞춘다.

Run: `npx jest apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts` → FAIL

- [ ] **Step 2: 구현 — 취소 요청 shape**

`cancel-request.shape.ts`:

```ts
import { formatDwell } from './order-progress.shape';

export type SettlementPhase = 'in_progress' | 'delayed' | 'refused';
export interface SettlementView {
  requestId: string;
  phase: SettlementPhase;
  mode: 'auto' | 'manual';
  confirmedAt: string;
  deadlineAt: string;
  lastFailure: { code: string; message: string; retryable: boolean; at: string } | null;
}
```

`CancelRequestView` 의 `status` 에 `'settling'`, 칸 둘(`settlement: SettlementView | null; refundMode: 'auto' | 'manual' | null;`). `CancelAction` 에 `| { kind: 'settling'; label: string; alert: boolean }`.
`isStatus` 에 `'settling'`. 함수들:

```ts
export const SETTLEMENT_LABELS: Record<SettlementPhase, string> = {
  in_progress: '환불 처리 중',
  delayed: '환불 지연',
  refused: '환불 거절',
};
export const MANUAL_REFUND_CONFIRM_TEXT =
  '고객에게 계좌를 받아 직접 송금한 뒤, 결제 상세의 환불 내역에서 [완료 처리]를 눌러 주세요.';
const WALLET_REFUSED_PREFIX = 'wallet_refund_refused:';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET_MS = 9 * 3_600_000;

function isPhase(value: unknown): value is SettlementPhase {
  return value === 'in_progress' || value === 'delayed' || value === 'refused';
}

function failureOf(value: unknown): SettlementView['lastFailure'] {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') return null;
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable === true,
    at: typeof value.at === 'string' ? value.at : '',
  };
}

export function toSettlementView(value: unknown): SettlementView | null {
  if (!isRecord(value) || typeof value.requestId !== 'string' || !isPhase(value.phase)) return null;
  if (value.mode !== 'auto' && value.mode !== 'manual') return null;
  if (typeof value.confirmedAt !== 'string' || typeof value.deadlineAt !== 'string') return null;
  return {
    requestId: value.requestId,
    phase: value.phase,
    mode: value.mode,
    confirmedAt: value.confirmedAt,
    deadlineAt: value.deadlineAt,
    lastFailure: failureOf(value.lastFailure),
  };
}

/** 운영자가 읽는 사유. wallet·PG 영구 거절과 그 밖(주문 없음 등 «개발 확인»)을 failureCode 접두사로 가른다(PR 3 넘길 것 4) */
export function settlementReason(s: SettlementView): string | null {
  const f = s.lastFailure;
  if (!f) return null;
  if (f.code.startsWith(WALLET_REFUSED_PREFIX)) return `환불 거절 · ${f.message || f.code}`;
  return `정산 실패 · 개발 확인 · ${f.message || f.code}`;
}

/** 서버(core restartSettlement)와 같은 규칙 — 정산 중(30분 안)엔 조치 없음(D8), 이미 계좌 송금이면 다시 시도만 */
export function settlementActionsOf(s: SettlementView | null): { retry: boolean; manualRefund: boolean } {
  if (!s || s.phase === 'in_progress') return { retry: false, manualRefund: false };
  return { retry: true, manualRefund: s.mode !== 'manual' };
}

export function settlementTiming(s: SettlementView, now: number): string {
  const deadline = new Date(Date.parse(s.deadlineAt) + KST_OFFSET_MS);
  const day = `${deadline.getUTCMonth() + 1}/${deadline.getUTCDate()}(${WEEKDAYS[deadline.getUTCDay()]})`;
  return `확정 후 ${formatDwell(now - Date.parse(s.confirmedAt))} · 기한 ${day}`;
}

export function cancelRequestToast(r: Extract<AdminCancelResponse, { requestId: string }>): string {
  if (r.status === 'settling') {
    return r.convertedFromFull
      ? '출고된 상품을 뺀 나머지를 취소했습니다. 환불은 채널이 처리합니다.'
      : '취소했습니다. 환불은 채널이 처리합니다.';
  }
  return r.convertedFromFull ? '출고된 상품을 뺀 나머지의 취소를 요청했습니다.' : '취소를 요청했습니다.';
}
```

`toCancelRequestView` 의 반환에 `settlement: toSettlementView(value.settlement), refundMode: value.refundMode === 'auto' || value.refundMode === 'manual' ? value.refundMode : null,`.
`cancelRequestFromAmendment` 는 변경 기록 행엔 정산 뷰가 없으므로 그대로 둔다(타임라인 모달은 `cancelRequestLine` 만 쓴다 — `settlement: null` 이면 줄이 «확정»까지만 말한다).
`cancelActionOf` 의 `requested` 분기 아래에:

```ts
  if (request?.status === 'settling') {
    const phase = request.settlement?.phase ?? 'in_progress';
    return { kind: 'settling', label: SETTLEMENT_LABELS[phase], alert: phase !== 'in_progress' };
  }
```

`cancelRequestLine` 의 `switch` 에:

```ts
    case 'settling':
      return view.settlement ? `${name} 확정 · ${SETTLEMENT_LABELS[view.settlement.phase]}` : `${name} 확정 · 정산 중`;
```

`formatDwell` 을 shape 끼리 가져다 쓰면 순환이 생기는지 본다(`order-progress.shape.ts` 가 `cancel-request.shape.ts` 를 import 하게 되는 Step 4 와 맞물린다). 생기면 `formatDwell` 을
`src/lib/utils/format-dwell.ts`(Create)로 옮기고 두 shape 가 거기서 가져온다 — 기존 호출부(`stage-orders.tsx`)는 order-progress.shape 의 re-export 로 그대로 둔다.

Run: `npx jest apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts` → PASS

- [ ] **Step 3: 실패하는 스펙 — 보드**

`order-progress.shape.spec.ts` 의 `it('취소 요청 단계의 세부 상태 이름')`(44-46줄)에:

```ts
    expect(stateLabel('settle_in_progress')).toBe('환불 처리 중');
    expect(stateLabel('settle_delayed')).toBe('환불 지연');
    expect(stateLabel('settle_refused')).toBe('환불 거절');
```

그리고:

```ts
  it('목록 행의 정산 정보 — 있으면 읽고, 옛 core(칸 없음)는 null', () => {
    const page = toProgressPage({
      items: [
        {
          salesOrderId: 'so1', orderNo: 'A', channelOrderId: 'c1', salesChannel: 'medusa', customerName: null, orderedAt: 'x',
          state: 'settle_refused', stageEnteredAt: 'x', stuck: true, walletIntentId: 'int-1',
          settlement: { requestId: 'r1', phase: 'refused', mode: 'auto', confirmedAt: 'a', deadlineAt: 'b', lastFailure: null },
        },
        { salesOrderId: 'so2', orderNo: 'B', channelOrderId: 'c2', salesChannel: 'medusa', customerName: null, orderedAt: 'x', state: 'cancel_requested', stageEnteredAt: 'x', stuck: false },
      ],
      nextCursor: null,
    });
    expect(page.items[0]).toMatchObject({ walletIntentId: 'int-1', settlement: { requestId: 'r1', phase: 'refused' } });
    expect(page.items[1]).toMatchObject({ walletIntentId: null, settlement: null });
  });
```

Run → FAIL

- [ ] **Step 4: 구현 — 보드 shape**

`order-progress.shape.ts`:
- `STATE_LABELS` 첫 두 줄 아래에 `settle_in_progress: '환불 처리 중', settle_delayed: '환불 지연', settle_refused: '환불 거절',`(값은 `cancel-request.shape.ts` 의 `SETTLEMENT_LABELS` 와 같은 낱말 — 한 곳에서 가져오려면 `SETTLEMENT_LABELS.in_progress` 등을 쓴다. 순환이 생기면 낱말을 그대로 적고 두 스펙이 같은 기대값으로 지킨다).
- `ProgressItem` 에 `settlement: SettlementView | null; walletIntentId: string | null;`(`import type { SettlementView } from './cancel-request.shape'` — 타입 import 는 순환이어도 런타임 순환이 아니다).
- `toProgressPage`:
  ```ts
    items: v.items.map((item) => {
      const row = item as ProgressItem & { settlement?: unknown; walletIntentId?: unknown };
      return {
        ...row,
        settlement: toSettlementView(row.settlement),
        walletIntentId: typeof row.walletIntentId === 'string' ? row.walletIntentId : null,
      };
    }),
  ```
  (`toSettlementView` 는 런타임 import — 순환이면 Step 2 의 판단대로 `format-dwell.ts` 분리로 끊는다.)

Run: `npx jest apps/admin-web/src/lib/api/domains/orders` → PASS

- [ ] **Step 5: 환불 내역의 «계좌 송금»**

`refund-execution.spec.ts`:

```ts
import { refundExecutionLabel } from './refund-execution';

describe('refundExecutionLabel', () => {
  it('수동 실행은 «계좌 송금», 자동·모름은 빈 칸(정상 상태는 숨긴다)', () => {
    expect(refundExecutionLabel('MANUAL')).toBe('계좌 송금');
    expect(refundExecutionLabel('AUTO')).toBe('');
    expect(refundExecutionLabel(undefined)).toBe('');
  });
});
```

`refund-execution.ts`:

```ts
// wallet 환불 행의 실행 방식(#1016 36번 재설계 §6.3). «계좌 송금»은 운영자가 송금 뒤 결제 상세에서 [완료 처리]를 눌러야 끝난다.
export function refundExecutionLabel(execution: unknown): string {
  return execution === 'MANUAL' ? '계좌 송금' : '';
}
```

`src/lib/types/dto/wallet.ts` 의 `RefundDto` 에 `/** wallet PR 1 — 'MANUAL' 은 PG 없이 송금 대기 */ execution?: 'AUTO' | 'MANUAL';`

Run: `npx jest apps/admin-web/src/lib/api/domains/wallet/refund-execution.spec.ts` → PASS

- [ ] **Step 6: 타입 검사·커밋**

```bash
(cd apps/admin-web && npx tsc --noEmit)   # 기준선 0 — 화면 파일이 새 CancelAction 갈래를 안 다뤄 에러가 나면 Task 9 에서 고친다. 여기선 shape 파일만 0 이면 된다
git add apps/admin-web/src/lib
git commit -m "feat(admin-web): 채널 취소 정산 판정 — 환불 처리 중·지연·거절, 사유·조치·기한, 계좌 송금 표시 (#1016 36번 재설계 PR 5)"
```

---

### Task 9: admin-web 화면 — 정체 보드·주문 내역·취소 모달·환불 내역

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-orders.client.ts:132-145`
- Modify: `apps/admin-web/src/lib/services/orders/mutations.ts:1104-1127`
- Create: `apps/admin-web/src/features/order/cancel-settlement/settlement-actions.tsx`
- Modify: `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx:131-236`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx:826-897`
- Modify: `apps/admin-web/src/features/order/history/components/modals/cancel-order-modal.tsx:188-195`
- Modify: `apps/admin-web/src/hooks/table/columns/use-refund-table-columns.tsx`

**Interfaces:**
- Consumes: Task 8 의 shape 함수들, Task 4 의 라우트
- Produces: `retryCancelSettlement(id: string, requestId: string)`, `manualRefundCancelSettlement(id: string, requestId: string)`(client),
  `useRetryCancelSettlement()`, `useManualRefundCancelSettlement()`(mutationFn 인자 `{ salesOrderId: string; requestId: string }`), `<SettlementActions salesOrderId settlement />`

admin-web 은 컴포넌트 테스트가 없다 — 이 태스크의 방어선은 `tsc --noEmit` 0 과 Task 8 의 순수함수 스펙, 그리고 Task 10 의 로컬 스모크다.

- [ ] **Step 1: 클라이언트·뮤테이션**

`sales-orders.client.ts` 의 `withdrawCancelRequest` 아래:

```ts
  // 채널 취소 정산 조치(#1016 36번 재설계) — 정산 중 요청(settling)만
  retryCancelSettlement: async (id: string, requestId: string): Promise<CancelRequestView> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/cancel-request/${encodeURIComponent(requestId)}/retry`,
      {}
    );
    return response.data;
  },
  manualRefundCancelSettlement: async (id: string, requestId: string): Promise<CancelRequestView> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(id)}/cancel-request/${encodeURIComponent(requestId)}/manual-refund`,
      {}
    );
    return response.data;
  },
```

`mutations.ts` 의 `useWithdrawCancelRequest` 아래:

```ts
/** 채널 취소 정산 [다시 시도] (#1016 36번 재설계) */
export const useRetryCancelSettlement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { salesOrderId: string; requestId: string }) =>
      orders.salesOrders.retryCancelSettlement(v.salesOrderId, v.requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-progress'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
};

/** 채널 취소 정산 [계좌 송금으로 환불] */
export const useManualRefundCancelSettlement = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { salesOrderId: string; requestId: string }) =>
      orders.salesOrders.manualRefundCancelSettlement(v.salesOrderId, v.requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-progress'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
};
```

- [ ] **Step 2: 조치 컴포넌트**

`features/order/cancel-settlement/settlement-actions.tsx`:

```tsx
'use client';

import type { MouseEvent } from 'react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  MANUAL_REFUND_CONFIRM_TEXT,
  SettlementView,
  settlementActionsOf,
} from '@/lib/api/domains/orders/cancel-request.shape';
import { useManualRefundCancelSettlement, useRetryCancelSettlement } from '@/lib/services/orders/mutations';

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** 정산 중 채널 취소의 운영자 조치 — 정체 보드 행과 주문 내역 취소 칸이 같이 쓴다(#1016 36번 재설계 §8.1) */
export function SettlementActions(props: { salesOrderId: string; settlement: SettlementView }) {
  const actions = settlementActionsOf(props.settlement);
  const retry = useRetryCancelSettlement();
  const manual = useManualRefundCancelSettlement();
  const [confirming, setConfirming] = useState(false);
  const target = { salesOrderId: props.salesOrderId, requestId: props.settlement.requestId };
  const stop = (e: MouseEvent) => e.stopPropagation();

  if (!actions.retry && !actions.manualRefund) return null;
  return (
    <span className="inline-flex gap-1.5" onClick={stop}>
      {actions.retry && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={retry.isPending}
          onClick={() =>
            retry.mutate(target, {
              onSuccess: () => toast.success('정산을 다시 시도합니다.'),
              onError: (e) => toast.error(errorText(e, '다시 시도하지 못했습니다.')),
            })
          }
        >
          다시 시도
        </Button>
      )}
      {actions.manualRefund && (
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirming(true)}>
          계좌 송금으로 환불
        </Button>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent onClick={stop}>
          <DialogHeader>
            <DialogTitle>계좌 송금으로 환불</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{MANUAL_REFUND_CONFIRM_TEXT}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              닫기
            </Button>
            <Button
              disabled={manual.isPending}
              onClick={() =>
                manual.mutate(target, {
                  onSuccess: () => {
                    toast.success('계좌 송금으로 바꿨습니다. 송금 뒤 결제 상세에서 완료 처리해 주세요.');
                    setConfirming(false);
                  },
                  onError: (e) => toast.error(errorText(e, '바꾸지 못했습니다.')),
                })
              }
            >
              계좌 송금으로 환불
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
```

`@/components/ui/dialog` 가 `DialogContent` 에 `onClick` 을 넘기는지(포털이라 표 행의 클릭으로 버블되지 않을 수 있다) 확인하고, 필요 없으면 `onClick={stop}` 을 지운다.

- [ ] **Step 3: 정체 보드**

`stage-orders.tsx`:
- import: `SettlementActions`, `settlementReason, settlementTiming` (cancel-request.shape).
- «세부 상태» 칸(`stateLabel(r.state)` 칩 아래, 배지 뒤)에:
  ```tsx
                    {r.settlement && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {settlementTiming(r.settlement, props.now.getTime())}
                        {settlementReason(r.settlement) && (
                          <span className="ml-1.5 text-red-600">{settlementReason(r.settlement)}</span>
                        )}
                      </div>
                    )}
  ```
  `settle_in_progress` 행은 사유가 없고 경과·기한만 보인다(ui-minimal-text — 정상 상태는 조용히).
- «조치» 칸을 상태로 가른다:
  ```tsx
                  {isCancelRequest && (
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {r.settlement ? (
                        <SettlementActions salesOrderId={r.salesOrderId} settlement={r.settlement} />
                      ) : (
                        <>
                          {/* 옛 requested 행(PR 5 전) — 다시 보내기·접기. 기존 두 버튼 블록을 그대로 여기로 옮긴다 */}
                        </>
                      )}
                    </td>
                  )}
  ```
  기존 «다시 보내기»·«요청 접기» JSX 를 위 `<>…</>` 안으로 옮긴다(내용 그대로). 주석 `{/* … */}` 는 옮긴 뒤 지운다.

- [ ] **Step 4: 주문 내역 취소 칸**

`table/index.tsx`:
- import: `SettlementActions`, `settlementReason, settlementTiming`.
- 컴포넌트 안 위쪽에 정산 블록 하나(같은 파일, 함수 컴포넌트):
  ```tsx
  function SettlementCell({ r }: { r: OrderLineRow }) {
    const s = r.cancelRequest?.settlement;
    if (!s) return null;
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-gray-500 whitespace-normal leading-tight">{settlementTiming(s, Date.now())}</span>
        {settlementReason(s) && <span className="text-[11px] text-red-600 whitespace-normal leading-tight">{settlementReason(s)}</span>}
        <SettlementActions salesOrderId={r.salesOrderId} settlement={s} />
      </div>
    );
  }
  ```
  `OrderLineRow` 의 판매주문 id 칸 이름을 `use-order-rows.ts` 에서 확인해 쓴다(`salesOrderId` 또는 `orderId`).
- 취소된 주문 갈래(`r.orderStatus === 'cancelled'`, 826줄~)의 «취소됨» 배지 바로 아래에:
  ```tsx
                {r.isFirstOfOrder && r.cancelRequest?.status === 'settling' && <SettlementCell r={r} />}
                {r.isFirstOfOrder && r.cancelRequest?.refundMode === 'manual' && (
                  <ViewPaymentButton walletIntentId={r.walletIntentId} />
                )}
  ```
  (수동 정산 주문은 송금 뒤 [완료 처리]가 결제 상세에 있다 — D7.) 이미 `refundStatus === 'pending'`·`succeeded` 로 `ViewPaymentButton` 이 뜨는 행과 겹치면 하나만 보이게 조건을 `||` 로 합친다.
- 취소 안 된 주문 갈래의 `cancelActionOf(r)` 분기에 `settling` 을 `requested` 다음에:
  ```tsx
                  if (action.kind === 'settling') {
                    return (
                      <>
                        <span
                          className={cn(
                            'inline-flex items-center h-7 px-2 rounded border text-xs whitespace-nowrap',
                            action.alert ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'
                          )}
                        >
                          {action.label}
                        </span>
                        <SettlementCell r={r} />
                      </>
                    );
                  }
  ```
  (`cn` 이 이 파일에 import 돼 있지 않으면 `@/lib/utils/ui` 에서 가져온다.) 부분취소 정산 중에도 남은 품목의 «취소» 버튼은 보이지 않는다 — 운영자는 정산을 먼저 끝낸다. 나머지를 취소해야 하면 정산이
  끝난 뒤 한다(옛 흐름의 «처리 중» 배지와 같은 자리, 같은 규칙).

- [ ] **Step 5: 취소 모달 토스트·환불 내역 칸**

`cancel-order-modal.tsx` 의 `isCancelRequested(result)` 블록:

```tsx
      if (isCancelRequested(result)) {
        // 채널 주문 — core 가 그 자리에서 취소를 확정했고 환불은 채널이 정산한다(#1016 36번 재설계). 정산 상태는 주문 행이 보여 준다.
        toast.success(cancelRequestToast(result));
        onOpenChange(false);
        return;
      }
```

(import `cancelRequestToast`.)

`use-refund-table-columns.tsx` 의 `status` 칸 뒤에:

```tsx
      columnHelper.accessor('execution', {
        header: '방식',
        cell: ({ getValue }) => <span className="text-sm">{refundExecutionLabel(getValue())}</span>,
      }),
```

(import `refundExecutionLabel` from `'@/lib/api/domains/wallet/refund-execution'`.) «대기» 필터와 함께 쓰면 «송금할 것» 목록이 된다 — 행의 결제 ID 가 [완료 처리]가 있는 결제 상세로 간다.

- [ ] **Step 6: 게이트·커밋**

```bash
(cd apps/admin-web && npx tsc --noEmit)      # 0
npx jest apps/admin-web                       # 순수함수 스펙
npm run lint -- apps/admin-web/src/features/order apps/admin-web/src/lib/api/domains/orders   # 경고만 남으면 OK — 메모리 lint-scope-caveat
git add apps/admin-web
git commit -m "feat(admin-web): 정산 중 채널 취소 — 보드·주문 내역의 사유·기한·다시 시도·계좌 송금, 환불 내역 «계좌 송금» (#1016 36번 재설계 PR 5)"
```

---

### Task 10: 문서(ADR-0044)·전체 게이트·로컬 스모크·PR

**Files:**
- Create: `docs/adr/0044-channel-cancel-confirms-at-request-and-settles-money-separately.md`
- Modify: `docs/adr/0042-channel-order-cancel-is-initiated-by-the-channel.md`(Status 한 줄)
- Modify: `docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md`(머리 한 줄)

- [ ] **Step 1: ADR-0044**

```md
# 채널 주문 취소의 물리 확정은 core 가 요청 순간에, 돈의 정산은 채널이 따로

## Status
Accepted (2026-10-11 사용자 결정, 2026-10-12 PR 5 로 적용). **대체:** ADR-0042 원칙 2(«core 는 문지기 — 요청을 기록하고 출고를 보류한 뒤 명령, 확정은 수집»).
**유지:** ADR-0042 원칙 1·3·4, ADR-0043. 트래킹 #1016 36번 행. 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md`.

## Context
ADR-0042 는 «취소가 성립했는가»를 «환불이 끝났는가»에 묶었다 — core 는 출고를 보류하고 채널이 환불하고 취소해야 확정했다. 환불이 영구히 막히면
(wallet·PG 거절) 끝이 없었다: 운영자에게 남는 출구는 «영원히 보류» 또는 [요청 접기] = 취소한 고객에게 출고였다. 업계(Shopify·Magento·Saleor)와
전자상거래법 18조 2항은 취소와 환급을 별개 수명주기로 둔다 — 환급은 취소와 동시에 성립하는 기한 있는 채무다.
Medusa 2.13.4 에서 취소된 주문에 나중에 환불하면 돈이 나간 «뒤» 실패한다(크레딧 라인 단계의 `throwIfOrderIsCancelled`, 환불 단계엔 보상이 없다).
그래서 Medusa 의 `canceled` 는 돈이 정리된 뒤에만 와야 한다 — core 의 확정과 Medusa 의 취소는 순서가 다르다.

## Decision
1. **물리 취소는 core 가 요청 트랜잭션에서 확정한다.** 출고를 막을 수 있으면 박스·출고지시·예약을 그 자리에서 취소하고, 요청 행을 «정산 중»으로 남긴 뒤
   `CancelChannelOrder` 를 같은 트랜잭션의 아웃박스에 낸다. 고객·운영자에게는 그 순간 «취소 완료»다. 보류와 [요청 접기]는 새 요청에 없다.
2. **돈의 정산은 채널(Medusa)이 한다.** 환불 의무의 정본은 돈이 있는 곳 — 자동 몫은 Medusa 장부(«캡처 − 환불», 부분취소는 음수 차액), 수동 몫은 wallet
   송금 대기 행. core 는 정산 «상태»와 «사유»만 든다.
3. **막히면 다시 부르는 곳은 core 리컨실러 하나다.** 영구 거절(wallet 이 `retryable: false` 로 분류)은 다시 부르지 않고 운영자가 [다시 시도] 또는
   [계좌 송금으로 환불]을 고른다. 출구는 «돈을 어떻게 돌려줄까»뿐이고 «출고할까»는 없다.

## Why
- 고객 의사가 운영자·PG 판단에 묶이지 않는다. 취소한 물건은 나가지 않는다.
- 부분취소 정산이 며칠 막혀도 남은 품목은 계속 출고된다(보류가 없다).
- 장부가 셋(core·Medusa·wallet)이 되지 않는다 — core 범용 환불 의무 엔티티를 두지 않았다(그 모양은 반품·금액 조정 경로가 생길 때).

## Consequences
- core 의 판매주문 `cancelled` 와 Medusa 주문 `canceled` 사이에 창이 생긴다(보통 몇 초, 막히면 운영자가 끝낼 때까지). 고객 화면은 core 상태를 먼저 읽는다.
- 옛 «requested» 요청 행은 옛 규칙으로 끝까지 돈다 — 0 이 되면 보류 관문·[다시 보내기]·[요청 접기]·옛 사실을 지운다.
- 리컨실러 «정산 재시도»(#1016 36번)는 관찰로 배포하고, channel-adapter 가 일시 실패를 ack 하는 배포와 함께 실행으로 바꾼다.
```

- [ ] **Step 2: 두 문서의 머리 한 줄**

`docs/adr/0042-…md` 의 `## Status` 단락 끝에: `**원칙 2 는 ADR-0044 가 대체한다**(2026-10-12) — 물리 취소는 core 가 요청 순간에 확정하고, 돈의 정산은 채널이 따로 한다.`

`docs/superpowers/specs/2026-10-07-channel-order-cancel-design.md` 의 머리(제목 아래 첫 단락 앞)에:
`> **§5.3·§5.4·§5.5·§6.3·§7.2·§7.5 는 `2026-10-11-channel-cancel-settlement-design.md` 가 고친다**(#1016 36번 재설계, ADR-0044). §1·§7.2 의 «Medusa 취소가 환불 단계에서 롤백»은 틀렸다 — Medusa 기본 취소는 환불 오류를 삼키고 유령 환불 거래를 남긴다(그 스펙 §2.2).`

- [ ] **Step 3: 전체 게이트**

```bash
npm run type-check                                   # 0
npx jest                                              # 0 실패 (OOM 이면 --maxWorkers=2)
npm run audit:event-handlers                          # 104개 · 발견 없음
npm run audit:event-publishers                        # 45개 · 발견 없음
npm run audit:consume-validation -- --gate            # 위반 없음
(cd apps/admin-web && npx tsc --noEmit)               # 0
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- \
  '(apps/core/src/modules/sales-order|apps/core/src/modules/fulfillment/order-progress|apps/core/src/modules/fulfillment/order-reconcile)/.*integration'
npx jest scripts/security
```

통합의 사전 RED(메모리 `core-integration-tests-local` 8 suite)가 아니고 이 PR 의 파일이 빨가면 고친다. 숫자를 PR 본문 «검증»에 그대로 옮긴다.

- [ ] **Step 4: 로컬 스모크 S1~S4 (스펙 §10)**

```bash
npm run bootstrap:e2e:local
npm run start:all:local      # core 는 워크트리 코드여야 한다 — start-all 이 띄우는 core 의 경로를 확인하고, 메인 체크아웃이면 core 만 워크트리에서 다시 띄운다
npm run preflight:e2e:local
```

core 마이그레이션(Task 1)을 로컬 core DB 에 먼저 적용한다: `npm run db:migrate -- --stage dev --deployment lcnine-services --yes` 가 로컬을 가리키는지 확인하고, 아니면
`dotenv -e apps/core/.env -- npx drizzle-kit migrate --config apps/core/drizzle.config.ts`. **브라우저 로그인은 사람이 한다**(메모리 `local-e2e-environment`).
스토어프론트는 워크트리 심볼링크를 Turbopack 이 거부하니 **메인 체크아웃에서** 띄운다(스토어프론트 코드는 이 PR 이 바꾸지 않는다).

| # | 준비 | 동작 | 기대(이 PR — 리컨실러는 관찰) |
| --- | --- | --- | --- |
| S1 영구 거절 | 테스트 주문의 결제수단을 wallet DB 에서 `CMS_BATCH` 로(`charges` → `payment_methods.type` — 칸 이름은 `\d` 로 먼저 본다) | 고객 취소 | 즉시 «취소 완료 · 환불 처리 중» → 보드 «환불 거절»(갇힘, 사유 «환불 거절 · …»), 출고 대상 아님, Medusa 미취소 |
| S2 수동 환불 | S1 상태 | 보드 [계좌 송금으로 환불] → 확인 창 → 결제 상세 [완료 처리] | Medusa 취소, 고객 «환불 진행 중 · 계좌 송금 예정» → «환불 완료», 환불 내역 «방식: 계좌 송금» |
| S3 장부 맞추기 | wallet `refunds` 에 그 결제의 SUCCEEDED 행 주입 | 운영자 전체취소 | 남은 몫만 환불, 보드에 아무것도 안 뜸 |
| S4 일시 장애 | wallet 을 내림 | 취소 → 40분 기다림 → wallet 올림 → 보드 [다시 시도] | «환불 지연»(30분 넘어 갇힘) → [다시 시도] 뒤 정산 완료. 리컨실러 로그엔 `retry-channel-settlement(#36, observe)` 의 `would_act` |

S4 는 스펙의 «리컨실러가 스스로 정산 완료»가 아니다 — 관찰 모드라 운영자 [다시 시도]가 출구다(그 사이 channel-adapter 는 Kafka 3회 재시도 뒤 DLQ, PR 3 판정 2). 실행 모드의 S4 는 PR 6.
각 줄의 결과(스크린샷 또는 API 응답)를 PR 본문 «검증»에 적는다. 스모크를 못 돌렸으면 **못 돌렸다고** 적는다.

- [ ] **Step 5: 커밋·push·PR**

```bash
git add docs
git commit -m "docs: ADR-0044 — 채널 취소 물리 확정은 요청 순간, 돈의 정산은 따로 (#1016 36번 재설계 PR 5)"
git push -u origin feat/1016-36-core-settlement
gh pr create --base develop --title "feat(core,admin-web): 채널 취소는 요청 순간 확정·환불은 정산으로 (#1016 36번 재설계 PR 5)" --body-file <본문>
```

PR 본문: **무엇** · **판정**(이 계획의 판정 1~7 요지) · **스펙과 다른 점**(D1~D13 표) · **혼자 나갔을 때**(아래) · **PR 6 에 넘길 것** · **배포**(아래) · **검증**(Step 3·4 숫자) ·
**범위 밖·알려진 한계**(PR 2 D8·T5-5, PR 1 `PROVIDER_EXCEPTION`). 끝에 세션 링크. `#1016` 본문·코멘트는 사용자 확인 없이 고치지 않는다.

«혼자 나갔을 때» 초안:

```md
## 혼자 나갔을 때 (PR 0~4 라이브 위에)
- 채널 주문 취소는 요청 순간 확정된다 — 판매주문·출고지시·박스·예약이 그 자리에서 취소되고 고객 응답이 곧 «취소 완료»다.
- **지금 라이브의 구멍이 닫힌다:** 전체취소 wallet 영구 거절이 «사유 없는 정체 + [요청 접기] = 출고»가 아니라 «환불 거절 + [다시 시도]·[계좌 송금으로 환불]»이 된다.
- 옛 «requested» 요청 행은 옛 규칙(보류·[다시 보내기]·[요청 접기])으로 끝까지 돈다 — 배포 전 수를 셌다(«배포»).
- 리컨실러 «정산 재시도»는 관찰 모드 — 일시 장애가 길면 «환불 지연»으로 보이고 운영자 [다시 시도]가 출구다(PR 6 에서 실행).
- 스토어프론트(PR 4)가 이미 `delayed`·`transfer_pending` 을 안다. 상세 «결제 상태» 줄 등 Medusa 를 직접 읽는 넷은 PR 6(판정 6).
```

---

## 배포 (PR 머지 뒤, 사람이 한다)

1. **배포 전 읽기 전용 실측**(사용자 실행):
   ```sql
   -- 옛 requested 취소 요청 — 옛 규칙으로 끝까지 돈다. 0 이 아니면 각 행의 주문·나이를 보고 사용자와 처리를 정한다
   SELECT id, sales_order_id, created_at, metadata->'request'->>'scope' AS scope, metadata->'request'->>'stage' AS stage
     FROM sales_order_amendments WHERE reason_code = 'CHANNEL_CANCEL_REQUEST' AND status = 'requested' ORDER BY created_at;
   ```
   그중 «전체취소 wallet 영구 거절»(PR 3~5 창)로 멈춘 행은 사유가 없다 — **[요청 접기]를 누르면 출고된다.** 수와 주문을 사용자에게 보고하고 접지 말라고 다시 안내한다.
2. **판정 SQL 시간 게이트(5초)** — 투영 갱신이 1분마다 도는 판정 SQL 에 `creq` 의 `DISTINCT ON`·`CROSS JOIN LATERAL` 이 더해졌다. 스크래치패드에서
   `new PgDialect().sqlToQuery(judgedRowsSql(candidateIdsSql(<최근 evaluated_at ISO>), new Date().toISOString()))` 로 SQL 을 뽑아 라이브에서
   `BEGIN READ ONLY; EXPLAIN ANALYZE <sql>; ROLLBACK;`. 상자 판정(`judgedShipmentsSql(openShipmentScopeSql())`)도 같이 잰다. **5초를 넘으면 배포를 멈춘다**(메모리 `reconciler-row12-design`).
3. **대기 마이그레이션 대조** — develop 에 머지됐지만 라이브에 안 간 다른 PR 의 마이그도 이번에 실린다(10-10 사고, 메모리 `deploy-ships-other-merged-prs-migrations`).
   `__drizzle_migrations` 의 마지막 행과 `apps/core/drizzle` 목록을 대조하고, 실릴 것 전부의 «migrate → deploy / deploy → migrate» 방향을 확인한다.
4. **`npm ci` 세 트리**(루트·admin-web·스토어프론트 — 🔴 스토어프론트 `npm ci` 는 `yarn.lock` 을 다시 쓴다, 커밋하지 말고 되돌린다). 떠 있는 `next dev` 는 끈다.
5. **`migrate → deploy`** — `npm run db:migrate -- --stage live --deployment lcnine-services --yes` → `__drizzle_migrations` 가 한 행 늘었고
   `sales_order_amendments_status_check` 에 `settling` 이 있는지 직접 본다 → `! cd deployments/lcnine/services && npx sst deploy --stage live` → Core 태스크 정의 번호가 올랐는지 ECS 에서 본다.
   **순서를 뒤집으면** 새 core 가 `settling` 을 insert 하다 check 위반으로 모든 채널 취소가 500 이다.
6. **관찰** — Core 로그 `retry-channel-settlement(#36, observe)` 줄의 `would_act`·`gated`, 보드 «취소 요청» 단계의 `settle_*` 칩. 첫 실제 고객 취소의 흐름(행 `settling` → 몇 초 뒤 `applied`)을
   `sales_order_amendments` 로 한 번 본다.
7. 머지는 사용자가 `! gh pr merge <번호> --squash`.

---

## Self-Review

- **스펙 커버리지:**
  §7.3 요청 행 `settling`·마이그(Task 1) · 확정 트랜잭션(Task 2) · `settling` 은 보류 아님(판정 7, 관문 코드 그대로) · `metadata.settlement`(Task 1, D1·D2) · 정산 중 요청 여럿(Task 2·3·5) ·
  사실 받기 `applied`·`refused`·옛 사실(Task 3, D4) · 리컨실러 규칙(Task 6, D3) · 조치 API(Task 4) · [요청 접기] 없음(Task 9 보드 갈래) ·
  §7.4 판정 SQL 세 상태·확정 시각 기준·3영업일 기한(Task 1·5) · §8.1 보드 라벨·상세 영역·확인 창·송금 대기 화면(Task 8·9, D7·D11) · §8.2 actions API(Task 7) ·
  §9.2 의 5 배포·옛 행 수(«배포») · §9.3 롤링 조합(판정 1) · §10 core·admin-web 테스트(Task 1~9)·스모크(Task 10) · §12 ADR-0044·35번 스펙 머리(Task 10).
  §12 의 36번 스펙·계획 «대체됨»·#1016 본문·메모리 정정은 PR 0~4 가 이미 했거나 사용자 확인 사항이라 이 PR 범위 밖.
- **PR 3 넘길 것 1~7:** 1(Task 3 옛 사실 테스트) · 2(D12) · 3(Task 3 순서 없는 사실·since) · 4(Task 8 `settlementReason`) · 5(37번 금액 — `SettlementFailed` 에 칸이 없어 사유 문장만 보인다. 금액이 필요해지면 계약에 optional 칸, 이 PR 은 계약을 바꾸지 않는다) · 6(Task 4·6 명령에 `refundMode`) · 7(Task 3 `findById`).
- **PR 4 넘길 것 1~6:** 1(Task 2 Step 8) · 2(Task 2 테스트 `cancelRequestStatus` undefined) · 3(Task 7 두 칸 같은 값) · 4(Task 7 `null`) · 5(Task 7 DTO·`VALID_REFUND_STATUSES`) · 6(새 사유 없음 — Global Constraints).
- **타입 일관성:** `SettlementView`(core types ↔ admin-web shape 같은 칸) · `toSettlementView(row, now)`(core) / `toSettlementView(value)`(admin-web — 다른 파일, 같은 이름의 파서) · `PHASE_RANK` · `isReissuable` ·
  `recordSettlementFailure(fact, tx?)` · `retrySettlement`/`switchToManualRefund(salesOrderId, requestId, tx?)` · `settlementFactsFor(salesOrderId, now?)` · `listRefundsByIntent(intentId)` ·
  `findSettling(salesOrderId, tx, opts?)` · `settlementRowsFor(salesOrderId, db)` — 정의한 태스크와 쓰는 태스크의 이름·인자가 같다.
- **Review Focus → 테스트:** 정산 중 요청 둘(Task 3·5) · 미반영 부분취소 + 주소 변경(Task 3) · since 이전 사실(Task 3) · 확정 뒤 응답(Task 2 Step 8) · wallet 실패·시간 초과(Task 7).
