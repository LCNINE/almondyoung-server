# 채널 취소 정산 재설계 PR 6 «정리» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리컨실러 «정산 재시도»를 실행 모드로 켜고(일시 실패 ack 와 같은 배포), 대시보드 기본 취소·환불을 미들웨어로 막고, 옛 `requested` 흐름·옛 사실·스토어프론트 다시 읽기를 걷고, wallet 송금 대기의 [완료 처리]를 «환불 내역»에 둔다 — 한 PR.

**Architecture:** 스펙 §9.2 의 6 이 못 박은 넷(미들웨어·실행 모드·다시 읽기 삭제·옛 사실/`REFUND_FAILED` 정리)과 PR 3~5 가 넘긴 것(Medusa 직접 읽기 넷·송금 대기·`RefundDto`). 실행 전환의 선행조건인 «Medusa 가 이미 정산한 전체취소 행의 탈출구»(판정 3)를 먼저 만든다 — 재수집 스냅샷에 `orderCancelled` 를 싣고 core 가 그걸로 정산 중 행을 닫는다. 마이그레이션 없음. `requested` 상태값·유니크 인덱스·check 제약은 남긴다(축소는 contract phase).

**Tech Stack:** NestJS · Drizzle(core·wallet·channel-adapter) · Kafka 계약(`packages/event-contracts`) · Medusa 2.13.4 미들웨어 · Next.js admin-web · Next.js 스토어프론트(vitest·next-intl)

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` (§6.6·§7.1~§7.3·§8.1·§8.2·§9.2·§9.3·§10). 지시문 `docs/superpowers/briefs/2026-10-12-channel-cancel-settlement-pr6-cleanup.md`. 앞 PR 계획 `…-pr2-medusa.md`·`…-pr3-adapter.md`·`…-pr4-storefront.md`·`…-pr5-core-admin.md` 의 «PR 6 에 넘길 것», PR #1052 본문.

기준 커밋 develop `a92310a24`(PR 5 #1052 머지·라이브, 2026-10-12). 아래 줄 번호는 그 커밋 기준이다 — 앞 태스크가 같은 파일을 고쳤으면 줄이 밀린다. 앵커(인용된 코드)로 찾는다.

---

## 먼저 판정한 것 (지시문 «먼저 판정할 것» 1~7)

### 라이브 실측 (2026-10-12, 사용자 터널 + `sst shell`, 읽기 전용 — 판정 1·2·3 의 입력)

| 항목 | 값 |
| --- | --- |
| 옛 `requested` 채널 취소 요청 행 (PR #1052 «배포» 1단계 쿼리) | **0** |
| 마감 사실 뒤에도 `settling` 인 행 (같은 본문 6단계 쿼리) | **0** |
| 채널 취소 요청 상태별 | `applied` 4건뿐 (첫 2026-10-07 23:25Z, 마지막 2026-10-11 07:06Z — 전부 PR 5 배포 전) |
| 지금 `settling` 행 | **0** |
| `order_reconcile_state` 중 `rule = 'retry-channel-settlement'` | **0** |
| Core 로그 48시간 `retry-channel-settlement` (CloudWatch Insights) | **0줄** |

PR 5 의 로컬 스모크 S1~S4 는 미실행 그대로다(이번 PR 의 스모크에서 함께 돈다 — Task 11).

### 판정 1 — 옛 흐름은 이 PR 에서 «전부» 걷는다 (옛 `requested` 행 0)

**정한 것:** 범위 표의 «옛 흐름 걷기»를 빼지 않는다. adapter 옛 사실 생산·core 옛 처리기·보류 관문·`resend`/`withdraw`·settler 옛 분기·보드 옛 상태와 버튼·계약의 `ChannelOrderCancelRejected`/`ChannelOrderCancelStalled`/`REFUND_FAILED` 를 한 PR·한 배포에서 지운다.

**경계(남기는 것):**
- `sales_order_amendments.status` 의 `'requested'`·`'rejected'` 값, `sales_order_amendments_status_check`, `uq_sales_order_amendments_open_cancel_request`(`WHERE status = 'requested'`) — **남긴다.** 값을 지우는 check 축소는 destructive(contract phase, `deploy → migrate`)라 이 PR 밖이다. 스키마 주석만 «역사 값»으로 고친다.
- core `CancelRequestStatus`·`VIEW_STATUSES` 의 `'requested'`·`'rejected'`, 메타데이터 스키마의 `request.stage`·`rejection` — **남긴다.** check 가 허용하는 값을 읽다 던지면 `GET /sales-orders/:id` 가 500 이 된다(PR 5 «계획 중 발견» 과 같은 병). 쓰는 코드는 없다.
- admin-web 의 `rejected` 표시(«취소 실패 · …», [다시 요청])와 `unresolvedRefundToAsk` — **남긴다.** 지난 기록을 읽는 것이고 «다시 요청»은 새 흐름으로 간다. 지우는 것은 `requested` 상태·«수정됨» 단계·[다시 보내기]·[요청 접기]·처리 중 폴링뿐이다.
- `native/warehouse-app` 의 `CANCEL_REQUESTED` 차단 사유 — **손대지 않는다.** core 가 더는 내지 않을 뿐이고, 설치된 옛 앱이 남아 있다(별도 배포). 지우는 건 나중 일.
- 스토어프론트 `StoreCancelUnavailableReason` 의 `"cancel_requested"`·i18n `cancelUnavailable.cancel_requested` — **남긴다.** core 가 안 낼 뿐 해가 없다.

**롤링 중 무해함(코드로 확인):**
- **옛 adapter(PR 3) + 새 core:** 옛 adapter 는 `Rejected`·`Stalled` 를 낸다 → 새 core 의 스트림 설정에 그 타입이 없다 → `SchemaValidationInterceptor` 는 `warn` 후 통과(`libs/events/src/interceptors/schema-validation.interceptor.ts:69-73`), `EventTypeGuard` 는 `@On` 이 없으면 `of(undefined)` 로 정상 완료(`libs/events/src/guards/event-type.guard.ts:50-54`) → 오프셋 커밋, DLQ 없음(PR 3 판정 5 의 실측과 같은 경로). 그 사실을 받을 `requested` 행은 0 이다.
- **새 adapter + 옛 core(PR 5):** 새 adapter 는 옛 사실을 안 낸다. 옛 core 의 `reject`·`markStalled` 는 `requested` 행만 읽었으므로 받을 일이 없었다. 변화 없음.
- 계약 제거의 세 단계(생산자 중단 → 소비자 제거 → 계약 제거)를 한 배포에 묶는 것은 지시문 제약과 어긋나 보이지만, 그 제약의 목적(«모르는 메시지에 소비자가 던져 DLQ·정지»)은 위 두 줄로 성립하지 않는다 — 모르는 타입은 경고 후 버려진다. **비용:** 롤링 몇 분 동안 core 로그에 `Event type not found in stream config` 경고가 옛 adapter 의 정산 실패 수만큼(라이브 0건/일) 찍힐 수 있다.

### 판정 2 — 실행 모드로 바꾼다. 관찰 근거는 0 이고, 거짓 양성은 «무해한 재발행»이라 그 근거를 기다리지 않는다

**확인한 사실:** PR 5 배포 뒤 `settling` 행이 한 번도 생기지 않았다(위 표) — 관찰 로그로 판단할 표본이 없다. 12번 관례(«거짓 양성이 없음을 보고 전환»)를 그대로 따르면 첫 채널 취소가 일어날 때까지 무기한 기다리게 된다.

**정한 것:** 실행으로 전환한다. 갈음하는 근거:
1. **실행의 «잘못된 실행»이 하는 일은 같은 `requestId`·`refundMode` 의 명령 재발행 하나다.** Medusa 정산 라우트는 같은 요청 두 번에 환불 한 번이다(PR 2 통합 테스트 «멱등 — 리컨실러 재발행의 전제», `channel-cancel-settlement.spec.ts` · `partial-cancel-settlement.spec.ts`). 12번처럼 재고·출고를 움직이는 규칙과 위험의 종류가 다르다.
2. 관찰 모드가 잡으려던 거짓 양성의 유일한 실재 후보 — «Medusa 는 정산을 끝냈는데 core 가 모름» — 는 판정 3 에서 코드로 확인했고 이 PR 이 닫는다(Task 1·2). 닫은 뒤의 재발행은 «이미 취소됨 → 성공 → 재수집 → 스냅샷이 행을 닫음»으로 스스로 끝난다.
3. 로컬 S4(실행 모드 — wallet 을 내린 채 취소 → 40분 뒤 올림 → 리컨실러가 스스로 정산 완료)를 PR 본문의 머지 전 확인으로 둔다(Task 11, 사용자와 함께).

**비용:** 라이브 첫 `acted` 를 사전에 못 봤다. 배포 뒤 관찰(«배포» 7단계)로 첫 실행을 본다.

### 판정 3 — 🔴 «Medusa 가 이미 정산한 전체취소 `settling` 행»은 지금 탈출구가 없다 — 재수집 스냅샷에 `orderCancelled` 를 싣고 core 가 그걸로 닫는다

**확인한 사실(develop `a92310a24`):**
- adapter 성공 경로는 `syncOrder(salesChannel, externalOrderId, { force: true })`(`channel-order-cancel.manager.ts:51`) → `processSyncFetch` → (a) 주문 항목: `processOrderItem` 이 `force` 면 해시가 같아도 `OrderModified` 를 낸다(`order-poller.orchestrator.ts:741-765`), (b) lifecycle: `processLifecycleItem` 은 `claimFirstSeen`(`:821-830`) — **처음 본 관측만** 낸다. `OrderCancelled` 의 키는 `cancelled` 하나라(`medusa-order.source.ts:255-260`) 주문당 평생 한 번이다.
- 따라서 **core 가 그 한 번의 `OrderCancelled` 를 놓친 전체취소 정산 행**(처리기 실패 → DLQ, PR 5 롤링 중 옛 태스크 소비 같은 경위)은, 재발행 → Medusa «이미 취소됨» = 성공 → 사실 없음 → 재수집은 `OrderModified` 만 → **`OrderModified.snapshot` 에 «주문 취소됨» 정보가 없다**(`orders.stream.ts:140-151` — `lines`·`shippingAddress`·`cancelRequests` 뿐) → settler `settleModified` 는 부분 범위만 닫는다(`channel-cancel-settler.ts:49-59`) → 행은 `settling` 그대로.
- 실행 모드에서 그 행은 1·4·16·64·256분 재발행 → «자동 멈춤 · #36» → 1024분마다 영원히 재발행. 운영자의 [다시 시도]도 같은 재발행이라 닫을 버튼이 없다.
- **부분취소는 탈출구가 있다:** 같은 재수집의 `OrderModified.snapshot.cancelRequests` 에 `stage: refunded` 가 실려 settler 가 `applied` 로 닫는다(`channel-cancel-settler.ts:53-55`, 통합 테스트 «부분 — refunded 기록»).
- 라이브 해당 행은 지금 0(위 표 «마감 사실 뒤에도 settling»).

**정한 것:** `OrderModified.snapshot` 에 선택 칸 **`orderCancelled?: true`** 를 더한다(Medusa 주문 `status === 'canceled'` 일 때만, 아니면 키 없음). core `settleModified` 는 이 칸이 있으면 `settleCancelled` 의 정산 중 갈래(전체 → `applied`, 부분 → `superseded(CHANNEL_FULL_CANCEL)`)를 같은 함수로 탄다.
- 칸은 **`modification` 에만** 싣고 해시 입력(`changes`)에 넣지 않는다(`channel-order.translator.ts:111-135` 의 두 객체가 따로다). 그래서 배포 직후 모든 Medusa 주문이 `OrderModified` 를 다시 내는 일(`channel-order-source.interface.ts:117-120` 주석의 함정)이 없다.
- core 의 diff 는 취소된 판매주문을 비교하지 않는다(`channel-order-diff.ts:12,44` `NOT_DIFFED_STATUSES`) — 이 스냅샷이 «반영 대기 변경»을 만들지 않는다.

**기각한 안:**
- **adapter 가 성공 시 `OrderCancelled` 를 다시 낸다:** analytics 가 `OrderCancelled` 를 사실 테이블에 적고 통계가 센다(`apps/analytics/src/datasets/orders/ingest/order-events.consumer.ts:70`, `features/statistics/read-model/statistics.query.ts:723`) — 취소가 두 번 세진다.
- **adapter 성공 사실(새 이벤트 타입):** 스펙 §7.2 «성공은 사실로 내지 않는다 — 재수집이 곧 사실»(PR 3 D11)과 반대이고, 부분취소는 이미 재수집으로 닫힌다 — 전체만을 위한 두 번째 길이 생긴다.
- **리컨실러 검사가 Medusa 상태를 본다:** core 는 Medusa 를 부르지 않는다(채널 일은 명령으로만, `apps/channel-adapter/CLAUDE.md` §3-5).

**롤링:** 새 adapter + 옛 core — 옛 core 의 zod(`OrderModifiedSchema`, `.strict()` 아님)는 모르는 키를 버린다 → 오늘과 같다. 옛 adapter + 새 core — 칸이 없다 → 오늘과 같다.

**비용:** 계약 칸 하나(선택, 순서 제약 없음). OrderModified 소비자는 core 하나다(`grep "@On(ORDER_STREAM, 'OrderModified')"`).

### 판정 4 — 백오프는 틀 그대로 둔다 (1·4·16·64·256분, 5회 뒤 «자동 멈춤», 1024분 재확인)

**확인한 사실:** 실측할 행이 0 이다(판정 2). 틀은 규칙 공통이고(`order-reconcile.state.ts:5-10`), 바꾸면 라이브 12번(실행)·25번(관찰)에 닿는다. 스펙 §7.3 «1·5·15분 → 이후 1시간, 포기 없음»은 «틀이 지원하지 않으면 틀에 더한다»는 조건부였고 틀이 이미 지원한다(PR 5 판정 3).

**정한 것:** 바꾸지 않는다(PR 5 D3 그대로). «자동 멈춤 · #36» 배지는 보드에 뜨고 운영자 [다시 시도]가 `since` 를 바꿔 지문을 리셋한다(재시작이 곧 새 5회).

**비용:** 일시 장애가 약 6시간(1+4+16+64+256분)을 넘기면 자동 재시도 간격이 17시간으로 벌어진다 — 3영업일 기한 안에 자동으로 3번 이상은 더 시도하고, 그 전에 보드가 «환불 지연»을 보인다. PR 2 D8(장부 없는 자동 PENDING → 매번 500)은 이 틀에서 5회 뒤 멈춘다 — 무한 고속 반복이 아니다.

### 판정 5 — 미들웨어: 결제 모듈로 «캡처 − 환불»을 읽고, 두 기본 라우트만 정확히 맞춘다

**확인한 사실:**
- 정산 라우트(`channel-cancel`·`partial-cancel`)는 워크플로를 프로세스 안에서 부른다(`channel-cancel-order.ts:60-63`, `issue-payment-refund.ts:37-39`) — HTTP 미들웨어를 지나지 않는다.
- Medusa 미들웨어에 `method` 를 주면 Express `app.post(matcher)` 로 **정확 일치**(`end: true`) 등록된다(`@medusajs/framework/dist/http/router.js:175-224`) — `'/admin/orders/:id/cancel'` 은 `/channel-cancel`·`/partial-cancel`·`/fulfillments/:fid/cancel` 과 맞지 않는다. 같은 경로의 미들웨어는 라우트 핸들러보다 먼저 돈다(`router.js:107-116` RoutesSorter).
- 기본 `/cancel`·`/payments/:id/refund` 를 HTTP 로 부르는 운영 코드는 0 이다(channel-adapter 는 PR 3 에서 `channel-cancel` 로 옮김 — `medusa.client.ts:1965`). 호출자는 Medusa 대시보드뿐이다. **Medusa 통합 스펙 둘이 기본 `/cancel` 을 HTTP 로 부른다** — `channel-cancel-settlement.spec.ts:358`(특성 테스트), `wallet-refund-projection.spec.ts:58`. 둘은 같은 워크플로를 직접 부르게 고친다(무엇을 지키는지는 같다).
- `POST /admin/payments/:id/refund` 는 **이미 이 저장소가 라우트를 override 한 경로**다(`apps/medusa/src/api/admin/payments/[id]/refund/route.ts`, 미들웨어 `api/admin/payments/middlewares.ts:6-21`). 스펙 §6.6 «라우트 override 아님»은 `/cancel` 에만 맞다 — 미들웨어를 기존 목록에 덧붙인다(override 를 새로 만들지 않는다).
- 「캡처 − 환불」을 읽는 공용 함수는 없다 — `refundRemaining`(`channel-cancel-order.ts:130-155`)과 부분취소가 같은 모양을 인라인으로 쓴다(`orderPaymentIds` + `retrievePayment(..., { relations: ['captures','refunds'] })` + `toNumber`).
- 결제 → 주문: core-flows 의 `refundPaymentWorkflow` 가 `order_payment_collection` 링크로 찾는다(`@medusajs/core-flows/dist/payment/workflows/refund-payment.js:67-73`).

**정한 것:**
- `POST /admin/orders/:id/cancel` — 주문의 결제 중 `canceled_at` 이 없고 «캡처 − 환불»이 0 보다 크거나 **읽을 수 없는(NaN)** 것이 하나라도 있으면 400 `{ type: 'not_allowed', code: 'default_cancel_blocked' }`. 결제 없음·전부 환불됨은 통과(기본 취소가 할 환불이 없다).
- `POST /admin/payments/:id/refund` — 결제의 주문이 `canceled` 면 400 `{ type: 'not_allowed', code: 'refund_on_canceled_order' }`. 결제가 없으면 통과(라우트가 404).
- 응답 모양은 `{ type, code, message }` — Medusa 기본 오류 처리기의 모양(`error-handler.js:52-54`), 기존 미들웨어의 `res.status(...).json(...)` 관례(`reject-awaiting-deposit-complete.ts:85-90`).

### 판정 6 — 스토어프론트: core 가 «취소됨»이라고 말할 때만 core 를 따른다. core 데이터가 없으면 지금 동작

**정한 것(순수함수 한 모듈 `src/lib/orders/core-order-view.ts`):**
1. «결제 상태» 줄 — core `orderStatus === 'cancelled'` 면 환불 완료(`succeeded`)는 `refunded`, 그 밖은 `canceled` 키로 보인다(i18n `mypage.order.paymentStatus.refunded`·`.canceled` 기존 키). 아니면 Medusa `payment_status`.
2. «구매확정» — 기존 조건 + core 취소면 숨김(사용자 확인 2026-10-12: 중요하지 않다, 최소 변경).
3. 마이페이지 홈 카드 — core 가 이미 조회하는 `actions` 로 core 취소 주문을 뺀다. `shipping-status-wrapper.tsx` 와 **같은 함수를 쓰는 `shipping-items-wrapper.tsx` 도** 같이 바뀐다(함수 하나라 갈라 두면 둘이 다르게 말한다).
4. `showTrack` — `canTrack`(core) 이거나, core 취소가 아니고 Medusa 이행이 `shipped`·`fulfilled`·`partially_fulfilled`.

**기각:** core `fulfillmentStatus` 로 배송 조회를 완전히 대체 — core 의 `track` 판정이 Medusa 이행과 다를 수 있는 넓은 주문에 닿는다(취소와 무관한 변경). 지시문 «최소 변경».

**다시 읽기 삭제:** 취소 응답이 성공이면 곧 «취소 완료»(스펙 §8.2, PR 5 넘길 것 1 — core 가 확정 뒤 판매주문으로 응답을 만든다). `cancel-outcome.ts`·테스트, i18n `cancelRequested`·`cancelRejected`·`cancelStillProcessing`(세 언어), 응답 타입의 `cancelRequestStatus` 칸을 지운다. `cancelCompleted`·`cancelError` 는 남긴다. `order-actions.tsx` 의 취소 토스트 두 문장은 i18n 키로 바꾼다(같은 파일의 다른 하드코딩 문장은 범위 밖 — «Also found»).

### 판정 7 — core 쪽 제거 경계

- `ChannelOrderSettlementFailed` 의 «옛 `requested` 행이면 로그만»(PR 5 D12)은 별도 분기가 아니라 `recordSettlementFailure` 의 `row.status !== 'settling'` 가드다 — 가드는 `applied`·`superseded` 행에도 필요하므로 남기고 주석만 고친다.
- `findOpen` — 지운다. `request()` 의 «열린 요청을 돌려받음» 분기도 지운다: 다른 키의 동시 요청은 판매주문 `FOR UPDATE` 로 줄을 서고, 뒤 요청은 앞이 확정한 뒤의 주문으로 판정된다(전체 뒤면 «이미 취소된 주문» 400, 부분 뒤면 남은 몫).
- `lockFulfillmentOrderItems`·`lockOpenShipments`(요청 트랜잭션의 FOI → 박스 잠금) — **남긴다.** 보류 관문이 사라져도 확정(물리 취소)은 박스를 취소하므로 송장 발급(같은 박스 행 `FOR UPDATE`)·배치 시작과 직렬화돼야 한다. `request-vs-gate.integration.spec.ts` 도 남긴다(잠금 순서·직렬화를 지킨다).
- 송장 발급의 박스 행 `FOR UPDATE`(`waybill.manager.ts:58-64`) — **남긴다**(같은 이유). `assertShipmentNotHeld` 호출 세 곳만 지운다.
- 보드: 판정 SQL 의 옛 상태(`cancel_requested`·`cancel_edited`)·규칙 `cancel_request` 를 지운다 → **판정 SQL 이 바뀐다 → 배포 전 라이브 EXPLAIN 5초 게이트**(«배포» 2단계). 단계 `cancel_request` 와 기준 시간 키는 남는다(정산 중이 같은 단계).
- 고객 actions API: `cancelRequestStatus` 칸과 `cancel_requested` 사유를 지운다(쓰는 행이 없다). 옛 스토어프론트는 `orderStatus === 'cancelled'` 를 먼저 보므로 칸이 없어도 «취소 완료»다(`cancel-outcome.ts:9`).

---

## 스펙과 다른 점 (PR 본문에 옮긴다)

| # | 자리 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| E1 | 성공의 사실 | 성공은 여전히 사실이 아니다. 대신 재수집 `OrderModified.snapshot.orderCancelled` 로 core 가 전체 정산 중 행을 닫는다 | 판정 3 — 스펙에 없던 탈출구 |
| E2 | 실행 전환의 근거 | 관찰 표본 0 — 재발행의 멱등과 판정 3 수정으로 갈음, 로컬 S4 | 판정 2 |
| E3 | 백오프 | 틀 그대로(PR 5 D3 유지) | 판정 4 |
| E4 | 계약 제거 순서 | 생산 중단·소비자 제거·계약 제거를 한 배포에 | 판정 1 — 모르는 타입은 경고 후 버려진다 |
| E5 | `/admin/payments/:id/refund` | 이미 있는 override 라우트에 미들웨어를 덧붙인다 | 판정 5 — 스펙의 «override 아님»은 `/cancel` 만 |
| E6 | 미들웨어의 «캡처 − 환불» 모름(NaN) | 막는다 | 기본 취소가 장부를 거짓으로 만드는 쪽이 더 비싸다 |
| E7 | «wallet 송금 대기 화면» | «환불 내역» 목록에 [완료 처리] 칸(`manualConfirmable` 을 목록에서도 계산) | 스펙 §8.1 의 화면이 없다(PR 5 D7) |
| E8 | 마이페이지 홈 | `shipping-items-wrapper` 도 같이 | 판정 6 — 같은 함수 |

## 범위 밖 · 알려진 한계 (PR 본문에 옮긴다)

- PR 2 D8(장부 없는 자동 PENDING → 일시 실패 반복) — 실행 모드에서 5회 뒤 «자동 멈춤»으로 멈춘다(판정 4). 원인 수정은 이 PR 밖
- PR 2 T5-5(부분취소 `edited` 재시도의 외부 환불 재검사 없음), PR 1 `PROVIDER_EXCEPTION` 이중 송금, 공휴일 영업일, `SettlementFailed` 금액 칸, admin-web 주문 내역이 «최근» 요청을 보이는 것 — 그대로
- `requested` 상태값·유니크 인덱스·check 제약 축소 — contract phase(`deploy → migrate`), 별도 PR
- `native/warehouse-app` 의 `CANCEL_REQUESTED` 사유 — 옛 앱 설치분이 남아 있어 그대로
- 기존 결제·환불 건 소급 대조·환급 — 하지 않는다(사용자 결정 2026-10-11)

---

## Global Constraints

- 루트 `npm run type-check` 에러 0, `npx jest` 실패 0. `npm run audit:event-handlers`·`npm run audit:event-publishers` 발견 0, `npm run audit:consume-validation -- --gate` 위반 0. 기준선(PR 5): 처리기 104개·발행자 45개 — 이 PR 뒤 처리기는 `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 둘이 빠져 **102** 가 기대값이다. 실측값을 PR 본문에 적는다.
- admin-web 이 바뀌면 `cd apps/admin-web && npx tsc --noEmit` 0 (CI 가 돌리지 않는다). admin-web 판정은 `*.ts` 순수함수 + `*.spec.ts`(루트 `npm run test:admin-web`) — `.tsx` 는 테스트하지 않는다.
- Medusa 가 바뀌면 `cd apps/medusa && npm run test:unit` + `scripts/local/run-medusa-integration.sh`(postgres·redis 둘 다 떠 있어야 한다). `npm run test:integration:*` 를 직접 부르지 않는다.
- 스토어프론트가 바뀌면 `cd web/almondyoung-storefront && npx vitest run` · `npx tsc --noEmit` — **기준선이 0 이 아니다**(PR 4 실측: vitest 2 실패 `locale-parity`, tsc 46). 시작 전에 다시 재고 «늘지 않음»을 본다. vitest 는 `src/**/*.test.ts` 만 돈다.
- 스토어프론트: 사용자에게 보이는 문자열은 `next-intl` `t()` + `src/i18n/messages/{ko,en,ja}/<namespace>.json` 세 파일 동시. `"use server"` 파일(`src/lib/api/orders/store-orders.ts`)엔 순수 함수를 두지 않는다. `Object.hasOwn` 대신 `Object.prototype.hasOwnProperty.call`.
- core: `dbService.run` 단일 러너, 공개 메서드 마지막 인자 `tx?: DbTx`, 사적 헬퍼는 `tx: DbTx` 필수. Inventory Query Rules(`db.query.*`·`with`·`any`/`as` 금지). 크론은 `@CronOnce`.
- 통합 스펙은 `describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지. core 통합은 **임시 DB**로 `--runInBand`(공식 러너가 공유 postgres 컨테이너를 재생성한 적이 있다), 워크트리에선 `COMPOSE_PROJECT_NAME` 필수(메모리 `core-integration-tests-local`).
- 마이그레이션 없음. `drizzle/` 아래 파일이 생기면 잘못된 것이다.
- 서브에이전트는 이 PR 의 워크트리에서만 일한다. 매 태스크 뒤 메인 체크아웃 `git -C /home/pauseb/workspace/almondyoung-server status --short` 가 비어 있고 `git rev-parse develop origin/develop` 가 그대로인지 본다(메모리 `subagent-worktree-contamination`).
- #1016 본문·코멘트는 사용자 확인 없이 고치지 않는다. 머지는 사용자가 `! gh pr merge <번호> --squash`.

## Review Focus

1. **core 가 `OrderCancelled` 를 놓친 전체취소 정산 행** — 재발행 → 성공 → 재수집 스냅샷만 온다. 기대: 행이 `applied` 로 닫히고 재발행이 멈춘다. → Task 2 통합 테스트 «OrderCancelled 를 놓쳐도 재수집 스냅샷으로 applied»
2. **롤링 중 옛 adapter(던짐 → Kafka 재시도)와 새 리컨실러 재발행이 같은 요청에 겹침** — 기대: Medusa 환불 한 번. → 기존 Medusa 통합 «같은 요청 두 번 → 환불 한 번»을 Task 8 에서 다시 돌려 초록을 확인한다(코드 변경 없음)
3. **결제가 없거나 전부 환불된 주문의 대시보드 기본 취소** — 기대: 미들웨어가 막지 않는다(기본 취소가 할 환불이 없다). → Task 8 단위 테스트 «결제 없음·전부 환불·취소된 결제는 통과»
4. **core actions 조회가 실패한 주문(`coreActions` 없음)의 스토어프론트 상세·목록** — 기대: 결제 상태 줄·구매확정·배송 조회가 지금과 같다. → Task 9 테스트 «actions 가 없으면 Medusa 값 그대로»
5. **카드 AUTO PENDING(PG 처리 중) 환불 행이 «환불 내역» 목록에 섞임** — 기대: [완료 처리]가 안 보인다(사람이 닫으면 PG 결과와 갈린다). → Task 10 통합 테스트 «AUTO PENDING 카드는 false»

---

## 실행 준비 (실행 세션이 한 번)

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin
git worktree add .claude/worktrees/feat-1016-36-pr6-cleanup -b feat/1016-36-settlement-pr6-cleanup origin/develop
cd .claude/worktrees/feat-1016-36-pr6-cleanup
# node_modules 심볼링크 넷 (메모리 subagent-worktree-contamination · packages-alias-resolution-by-tree)
ln -s /home/pauseb/workspace/almondyoung-server/node_modules node_modules
ln -s /home/pauseb/workspace/almondyoung-server/apps/admin-web/node_modules apps/admin-web/node_modules
ln -s /home/pauseb/workspace/almondyoung-server/native/warehouse-app/node_modules native/warehouse-app/node_modules
ln -s /home/pauseb/workspace/almondyoung-server/web/almondyoung-storefront/node_modules web/almondyoung-storefront/node_modules
git log --oneline -1   # a92310a24 이상
```

기준선(시작 전 한 번, 숫자를 적어 둔다):

```bash
npm run type-check 2>&1 | tail -3
npm run audit:event-handlers 2>&1 | tail -5
npm run audit:event-publishers 2>&1 | tail -5
(cd web/almondyoung-storefront && npx vitest run 2>&1 | tail -6; npx tsc --noEmit 2>&1 | grep -c "error TS")
```

core 통합용 임시 DB(메모리 `core-integration-tests-local` 의 절차 — 공유 컨테이너를 재생성하는 공식 러너 대신):

```bash
export COMPOSE_PROJECT_NAME=almondyoung-server
psql "postgresql://postgres:postgres@localhost:5432/postgres" -c "CREATE DATABASE core_pr6_1016"
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_pr6_1016 npx drizzle-kit migrate --config apps/core/drizzle.config.ts
```

(접속 정보가 다르면 `apps/core/.env` 의 `DATABASE_URL` 호스트·자격증명을 쓰고 DB 이름만 바꾼다. 아래 `CORE_IT` 는 이 URL 이다.)

---

## File Structure

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `packages/event-contracts/streams/orders.stream.ts` | `OrderModified.snapshot.orderCancelled` 추가 · 옛 사실 둘·거절 코드 제거 | 1, 5 |
| `apps/channel-adapter/src/services/order-collection/{channel-order-source.interface,medusa-order.source,channel-order.translator}.ts` | 취소된 주문의 `orderCancelled` 를 `modification` 에만 | 1 |
| `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settler.ts` | 스냅샷으로 정산 중 행 닫기 · 옛 분기 제거 | 2, 4 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts` | `orderCancelled` 전달 | 2 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts` | `act` | 3 |
| `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.{manager,repository}.ts` | 일시 실패 ack · 옛 사실 제거 | 3, 5 |
| `apps/core/src/modules/sales-order/channel-cancel-request/*` · `fulfillment/hold/*` · `fulfillment/waybill/waybill.manager.ts` · `fulfillment/picking/allocation/*` · `sales-order/controllers/sales-orders.controller.ts` · `sales-order/consumers/order-events.consumer.ts` | 옛 요청 흐름 제거 | 4 |
| `apps/core/src/modules/fulfillment/order-progress/{order-progress.judge-sql,order-progress.thresholds}.ts` · `fulfillment/order-reconcile/order-reconcile.subject.ts` · `sales-order/services/store-sales-orders.service.ts` · `sales-order/dto/store-order-actions.dto.ts` | 보드 옛 상태·고객 API 옛 칸 제거 | 6 |
| `apps/admin-web/src/lib/api/domains/orders/{cancel-request,order-progress}.shape.ts` 외 | 옛 버튼·폴링 제거 | 7 |
| `apps/medusa/src/api/admin/orders/middlewares/*` · `api/admin/orders/middlewares.ts`(새) · `api/admin/payments/middlewares/*` · `api/admin/payments/middlewares.ts` · `api/admin/middlewares.ts` | 대시보드 함정 막기 | 8 |
| `web/almondyoung-storefront/src/lib/orders/core-order-view.ts`(새) 외 | 다시 읽기 삭제 · Medusa 직접 읽기 넷 | 9 |
| `apps/wallet/src/admin/payment-intent-admin.service.ts` · `apps/admin-web/src/...refund...` | 목록 `manualConfirmable` · [완료 처리] · 토스트 · `RefundDto` | 10 |

---

### Task 1: 재수집 스냅샷에 «주문 취소됨» — 계약 + channel-adapter (판정 3 생산 쪽)

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts:140-151`(`OrderModifiedPayload`), `:334-345`(`OrderModifiedSchema`)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts:116-121`
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts:49-87`(`buildSnapshot`)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts:124-134`(`modification`)
- Test: `apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts`, `channel-order.translator.spec.ts`

**Interfaces:**
- Produces: `OrderModifiedPayload['snapshot']['orderCancelled']?: true` — Task 2 가 읽는다. `ChannelOrderSnapshot.orderCancelled?: true`.

- [ ] **Step 1: 실패하는 테스트 — Medusa 수집**

`medusa-order-collection.spec.ts` 의 최상위 `describe('Medusa order collection (source + translator)'` 안, `describe('부분취소 진행 기록 (#1016 35번 PR-C)'` 바로 앞에 넣는다. 파일 상단 import 에 `ORDER_STREAM` 이 이미 있다(782행에서 쓴다).

```ts
  it('취소된 주문은 modification 에만 orderCancelled 를 싣는다 — 해시 입력(changes)은 그대로 (#1016 36번 PR 6 판정 3)', async () => {
    const base = {
      currency_code: 'KRW',
      total: 12000,
      created_at: '2026-05-26T01:00:00.000Z',
      updated_at: '2026-05-26T01:20:00.000Z',
      items: [],
    };
    const provider = makeProvider({
      listOrders: jest.fn().mockResolvedValue([
        { ...base, id: 'order_c', status: 'canceled', payment_status: 'refunded', canceled_at: '2026-05-26T01:15:00.000Z' },
        { ...base, id: 'order_l', status: 'pending', payment_status: 'captured' },
      ]),
    } as any);

    const { orders } = await provider.fetchOrders(null);
    const byId = new Map(orders.map((o) => [o.externalOrderId, o]));
    const cancelled = byId.get('order_c');
    const live = byId.get('order_l');
    if (!cancelled || !live) throw new Error('unreachable');

    expect(cancelled.modification.orderCancelled).toBe(true);
    expect('orderCancelled' in cancelled.changes).toBe(false);
    expect('orderCancelled' in live.modification).toBe(false);
    // 계약 스키마가 칸을 안다 — 모르면 zod 가 조용히 지운다
    const parsed = ORDER_STREAM.events.OrderModified.schema!.parse({
      orderId: 'wms-1',
      salesChannel: 'medusa',
      externalOrderId: 'order_c',
      modifiedAt: cancelled.modifiedAt,
      snapshot: cancelled.modification,
    });
    expect(parsed.snapshot.orderCancelled).toBe(true);
  });
```

- [ ] **Step 2: 실패하는 테스트 — 번역기**

`channel-order.translator.spec.ts` 의 `it('cancelRequests 는 있을 때만 changes·modification 에 실린다 (#1016 35번 PR-C)'` 바로 뒤에:

```ts
  it('orderCancelled 는 modification 에만 실린다 — changes 는 해시 입력이라 넣지 않는다 (#1016 36번 PR 6)', async () => {
    const { translator } = makeTranslator(LISTING);
    const without = await translator.translate('naver', makeSnapshot());
    const cancelled = await translator.translate('naver', makeSnapshot({ orderCancelled: true }));
    if (without.outcome.kind !== 'order' || cancelled.outcome.kind !== 'order') throw new Error('unreachable');

    expect('orderCancelled' in without.outcome.order.modification).toBe(false);
    expect(cancelled.outcome.order.modification.orderCancelled).toBe(true);
    expect('orderCancelled' in cancelled.outcome.order.changes).toBe(false);
  });
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts -t "orderCancelled"`
Expected: FAIL (`orderCancelled` 가 `undefined`, 번역기 테스트는 `makeSnapshot({ orderCancelled })` 타입 오류가 ts-jest transpile-only 라 런타임 FAIL 로 보인다)

- [ ] **Step 4: 계약**

`orders.stream.ts` 의 `OrderModifiedPayload.snapshot` 안, `cancelRequests?` 아래에:

```ts
    /**
     * 채널이 주문을 취소했다(Medusa `status = canceled`). 아니면 키를 두지 않는다.
     * 취소 «사실»은 lifecycle `OrderCancelled` 가 주문당 한 번 낸다 — 이 칸은 core 가 그 한 번을 놓친 정산 중 요청을
     * 재수집 스냅샷으로 닫는 근거다(#1016 36번 재설계 PR 6 판정 3).
     */
    orderCancelled?: true;
```

`OrderModifiedSchema` 의 `snapshot: z.object({ ... })` 안, `cancelRequests:` 아래에:

```ts
    orderCancelled: z.literal(true).optional(),
```

- [ ] **Step 5: source 인터페이스·Medusa source·번역기**

`channel-order-source.interface.ts` 의 `cancelRequests?: OrderModifiedCancelRequest[];` 아래에:

```ts
  /**
   * 채널이 주문을 취소했다 — 재수집 스냅샷이 core 의 정산 중 요청을 닫는 근거(#1016 36번 PR 6). 아니면 키를 두지 않는다.
   * **`changes`(해시 입력)에는 넣지 않는다** — 넣으면 배포 직후 취소된 Medusa 주문이 전부 `OrderModified` 를 다시 낸다.
   */
  orderCancelled?: true;
```

`medusa-order.source.ts` `buildSnapshot` 의 반환 객체에서 `...(cancelRequests.length > 0 ? { cancelRequests } : {}),` 바로 아래에:

```ts
      ...(order.status === 'canceled' ? { orderCancelled: true as const } : {}),
```

`channel-order.translator.ts` 의 `modification: { ... }` 안, `...(snapshot.cancelRequests?.length ? { cancelRequests: snapshot.cancelRequests } : {}),` 아래에(`changes` 에는 넣지 않는다):

```ts
        // 해시 입력(changes)엔 없다 — 취소는 lifecycle 이 알리고, 이 칸은 core 의 정산 중 요청을 닫는 근거일 뿐이다(PR 6 판정 3)
        ...(snapshot.orderCancelled ? { orderCancelled: true as const } : {}),
```

- [ ] **Step 6: 통과 확인 + 회귀**

Run: `npx jest apps/channel-adapter/src/services/order-collection packages/event-contracts`
Expected: PASS. 특히 `기록이 없으면 changes 에 키 자체가 없다 — 모든 Medusa 주문의 해시가 바이트 단위로 그대로다` 가 초록.

- [ ] **Step 7: Commit**

```bash
git add packages/event-contracts/streams/orders.stream.ts apps/channel-adapter/src/services/order-collection
git commit -m "feat(channel-adapter): 재수집 스냅샷에 주문 취소됨 — 해시 밖 (#1016 36번 PR 6 판정 3)"
```

---

### Task 2: core — 스냅샷의 «주문 취소됨»으로 정산 중 행을 닫는다 (판정 3 소비 쪽)

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settler.ts:40-65,121-135`
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts:60-66`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/__support__/cancel-request.fixtures.ts:87-112`(`modifiedPayload`)
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settling.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `OrderModifiedPayload['snapshot']['orderCancelled']`.
- Produces: `ChannelCancelSettler.settleModified(salesOrderId: string, deltas: ChannelDelta[], channel: { cancelRequests: OrderModifiedCancelRequest[]; orderCancelled: boolean }, occurredAt: string, tx: DbTx): Promise<ChannelDelta[]>` — 세 번째 인자가 배열에서 객체로 바뀐다(호출자는 `ChannelOrderChangeManager.handle` 하나). Task 4 가 이 함수의 옛 분기를 지운다.

- [ ] **Step 1: 픽스처에 칸 추가**

`cancel-request.fixtures.ts` 의 `modifiedPayload` `over` 타입에 `orderCancelled?: boolean;` 을 더하고, 반환 `snapshot` 의 `...(over.cancelRequests ? { cancelRequests: over.cancelRequests } : {}),` 아래에:

```ts
      ...(over.orderCancelled ? { orderCancelled: true as const } : {}),
```

- [ ] **Step 2: 실패하는 통합 테스트**

`channel-cancel-settling.integration.spec.ts` 의 `it('부분 — refunded 기록: applied + 결과, ...` 바로 앞에:

```ts
  it('전체 — OrderCancelled 를 놓쳐도 재수집 스냅샷의 orderCancelled 로 applied(PR 6 판정 3)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.manager.recordSettlementFailure(failure(id, { retryable: true, failureCode: 'http_500' }), tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { orderCancelled: true }), 'm-1', tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('applied');
      expect(row.metadata).toMatchObject({ settlement: { mode: 'auto' } });
      expect((row.metadata as { settlement: Record<string, unknown> }).settlement.lastFailure).toBeUndefined();
      // 판매주문은 확정 때 이미 취소됐다 — 취소 기록이 늘지 않는다
      expect(await cancellationsOf(tx, seed.salesOrderId)).toHaveLength(1);
    });
  });

  it('부분 정산 중 + 채널 주문 취소 스냅샷 — superseded(CHANNEL_FULL_CANCEL), settleCancelled 와 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmPartial(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed, { quantities: [1, 1], orderCancelled: true }), 'm-1', tx);
      const row = await rowOf(tx, id);
      expect(row.status).toBe('superseded');
      expect(row.metadata).toMatchObject({ supersededReason: 'CHANNEL_FULL_CANCEL' });
    });
  });

  it('orderCancelled 가 없는 재수집은 전체 정산 중 행을 닫지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, id } = await confirmFull(tx);
      await w.changes.handle(seed.salesOrderId, modifiedPayload(seed), 'm-1', tx);
      expect((await rowOf(tx, id)).status).toBe('settling');
    });
  });
```

- [ ] **Step 3: 실패 확인**

Run: `DATABASE_URL=$CORE_IT npx jest apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settling.integration.spec.ts --runInBand -t "orderCancelled|채널 주문 취소 스냅샷|OrderCancelled 를 놓쳐도"`
Expected: 첫 두 개 FAIL(`settling` 그대로), 세 번째 PASS.

- [ ] **Step 4: settler — 정산 중 갈래를 함수로 뽑고 스냅샷이 부른다**

`channel-cancel-settler.ts`:

`import type { OrderModifiedCancelRequest } ...` 는 그대로. `settleModified` 를 다음으로 바꾼다(옛 분기 `settleLegacyModified` 호출은 Task 4 가 지운다 — 지금은 그대로 둔다):

```ts
  /**
   * 열린 부분취소 요청이 먹은 감소를 반영하고, 먹지 않은 델타를 돌려준다 — 그것만 5번 규칙을 탄다.
   * 정산 중 부분취소는 채널 진행 기록이 «환불 끝»이면 닫고, 기록이 없으면(채널이 아직 안 줄였다) 요청분의 «늘어남»을 먹는다(D10).
   * 채널이 주문을 취소했으면(`orderCancelled`) 정산 중 요청을 `OrderCancelled` 와 똑같이 닫는다 — 그 사실은 주문당 한 번만 오므로
   * 놓친 행에겐 재수집 스냅샷이 유일한 탈출구다(PR 6 판정 3).
   */
  async settleModified(
    salesOrderId: string,
    deltas: ChannelDelta[],
    channel: { cancelRequests: OrderModifiedCancelRequest[]; orderCancelled: boolean },
    occurredAt: string,
    tx: DbTx,
  ): Promise<ChannelDelta[]> {
    const progress = channel.cancelRequests;
    const rest = await this.settleLegacyModified(salesOrderId, deltas, progress, occurredAt, tx);
    if (channel.orderCancelled) await this.closeSettlingByFullCancel(salesOrderId, tx);
    const unreflected: CancelRequestLine[] = [];
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
```

(그 아래 루프·반환은 그대로.)

`settleCancelled` 의 정산 중 루프를 함수로 뽑는다:

```ts
  /** 수집된 전체취소(`OrderCancelled`) — 열린 전체 요청은 applied, 부분 요청은 덮였다(스펙 §9-7·§9-12). */
  async settleCancelled(salesOrderId: string, tx: DbTx): Promise<void> {
    const open = await this.reader.findOpen(salesOrderId, tx, { lock: true });
    if (open) {
      const meta = readCancelRequestMetadata(open.metadata);
      if (meta.request.scope === 'full') await this.write(open.id, 'applied', meta, tx);
      else await this.supersede(open, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
    await this.closeSettlingByFullCancel(salesOrderId, tx);
  }

  /** 정산 중 — 전체는 끝났고, 부분은 전체취소가 «캡처 − 환불»을 다 돌려줘 덮였다(스펙 §7.3) */
  private async closeSettlingByFullCancel(salesOrderId: string, tx: DbTx): Promise<void> {
    for (const row of await this.reader.findSettling(salesOrderId, tx, { lock: true })) {
      const meta = readCancelRequestMetadata(row.metadata);
      if (meta.request.scope === 'full') await this.write(row.id, 'applied', settled(meta), tx);
      else await this.supersede(row, meta, 'CHANNEL_FULL_CANCEL', tx);
    }
  }
```

- [ ] **Step 5: 호출자**

`channel-order-change.manager.ts` 의 `settleModified` 호출을:

```ts
    const deltas = await this.cancelSettler.settleModified(
      salesOrderId,
      fullDiff,
      { cancelRequests: payload.snapshot.cancelRequests ?? [], orderCancelled: payload.snapshot.orderCancelled === true },
      payload.modifiedAt,
      tx,
    );
```

- [ ] **Step 6: 통과 확인 + 회귀**

Run: `DATABASE_URL=$CORE_IT npx jest apps/core/src/modules/sales-order/channel-cancel-request apps/core/src/modules/sales-order/channel-order-change --runInBand`
Expected: PASS (새 셋 포함). 그리고 `npm run type-check` 0.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 재수집 스냅샷의 주문 취소됨으로 정산 중 요청을 닫는다 (#1016 36번 PR 6 판정 3)"
```

---

### Task 3: 실행 전환 — 리컨실러 `act` + adapter 일시 실패 ack (같은 배포)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts:8-18`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.spec.ts:13-17`
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts:12-21,144-168`
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`(일시 실패 단언 세 곳 — 158·245·268행 근처 `rejects.toThrow(/req-1/)`)

**Interfaces:**
- Consumes: Task 2(실행 모드의 재발행이 스스로 끝나는 전제).
- Produces: 없음(동작 변경).

- [ ] **Step 1: 테스트를 먼저 바꾼다 — 규칙**

`retry-channel-settlement.rule.spec.ts` 첫 `it` 을:

```ts
  it('실행 모드 — channel-adapter 가 일시 실패를 ack 하므로 다시 부르는 곳은 여기 하나다(PR 6)', () => {
    expect(rule.mode).toBe('act');
    expect(rule.row).toBe(36);
    expect(rule.situation).toEqual({ stage: 'cancel_request', states: ['settle_in_progress', 'settle_delayed'] });
  });
```

- [ ] **Step 2: 테스트를 먼저 바꾼다 — adapter**

`channel-order-cancel.manager.spec.ts` 에서 `retryable: true` 결과로 `await expect(manager.execute(…)).rejects.toThrow(/req-1/)` 를 단언하는 세 곳(전체 일시·부분 `refund_pending`·부분 일시)을 각각 다음 꼴로 바꾸고, 테스트 이름의 «던진다»를 «ack 한다»로 바꾼다:

```ts
        await expect(manager.execute(full, 'd1')).resolves.toBeUndefined();
```

(부분은 `partial`.) 사실 단언(`recorded(repository)`)은 그대로 둔다. `it('사실 적재가 실패하면 영구 실패라도 던진다 — ack 하지 않고 재배달을 탄다'` 와 `it('취소는 됐는데 재수집이 실패하면 던진다 …'` 는 손대지 않는다(둘 다 계속 던져야 한다). 그리고 새 테스트 하나:

```ts
  it('일시 실패는 사실을 낸 뒤 ack 한다 — 다시 부르는 건 core 리컨실러 하나(스펙 S7, PR 6)', async () => {
    medusa.cancelOrder.mockResolvedValue({ kind: 'transient', failureCode: 'http_502', message: 'bad gateway' });
    await expect(manager.execute(full, 'd1')).resolves.toBeUndefined();
    expect(recorded(repository).fact).toMatchObject({ retryable: true, failureCode: 'http_502' });
    expect(poller.syncOrder).not.toHaveBeenCalled();
  });
```

(`medusa`·`poller`·`full` 은 이 spec 의 기존 이름을 쓴다 — 파일 상단 `describe` 의 준비부를 확인해 같은 변수명으로 맞춘다.)

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.spec.ts apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`
Expected: FAIL (`observe` ≠ `act`, `resolves` 인데 던짐)

- [ ] **Step 4: 구현 — 규칙**

`retry-channel-settlement.rule.ts`:

```ts
/**
 * #1016 36번 행(재설계 §7.3): 확정된 채널 취소의 정산이 끝나지 않았다 — 같은 requestId·refundMode 로 명령을 다시 낸다.
 * 일시 실패·명령/사실 유실·channel-adapter 결함을 한 곳에서 잡는다. 영구 거절(settle_refused)은 칸에 없다 — 운영자가 고른다.
 * 실행 모드(PR 6): channel-adapter 는 일시 실패를 사실로 낸 뒤 ack 한다 — 다시 부르는 곳은 여기 하나다. 재발행은 Medusa 에서 멱등이고,
 * Medusa 가 이미 정산한 행은 재수집 스냅샷(orderCancelled·cancelRequests)이 닫는다(PR 6 판정 2·3). 백오프·포기는 틀 그대로(판정 4).
 */
@Injectable()
export class RetryChannelSettlementRule implements OrderReconcileRule {
  readonly name = 'retry-channel-settlement';
  readonly row = 36;
  readonly subject = 'order' as const;
  readonly mode: ReconcileMode = 'act';
```

- [ ] **Step 5: 구현 — adapter**

`channel-order-cancel.manager.ts` 클래스 docblock(12~21행)을:

```ts
/**
 * core 의 `CancelChannelOrder` 를 채널에 실행한다 (#1016 35번 행, ADR-0042 · 36번 재설계 스펙 §7.2).
 *
 * 정산이 끝나지 못한 모든 결과는 `ChannelOrderSettlementFailed` 로 낸 뒤 명령을 ack 한다 — Kafka 재시도·DLQ 에 기대지 않는다(스펙 S7).
 * 다시 부르는 곳은 core 리컨실러 «정산 재시도»(#36) 하나다. 사실을 못 낸 경우(아웃박스 쓰기 실패)만 던져 재배달을 탄다.
 * 채널 호출이 멱등이라 다시 해도 안전하다: 전체는 «이미 취소됨»과 장부 맞추기, 부분은 Medusa 가 같은 requestId 의 진행 단계부터 이어 간다.
 * 성공은 사실로 내지 않는다(D11) — 즉시 재수집한 `OrderCancelled`/`OrderModified` 가 곧 사실이다.
 */
```

`fail()` 끝의 블록을 지운다:

```ts
    if (failure.retryable) {
      // 정리 PR(리컨실러 실행 모드)까지 던져 Kafka 재시도를 탄다 — 사실은 이미 적재됐다(판정 2)
      throw new Error(`채널 정산 일시 실패(${requestId}) ${failure.failureCode}: ${failure.message}`);
    }
```

(옛 사실 `legacy` 는 Task 5 가 지운다 — 여기선 건드리지 않는다.)

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile apps/channel-adapter/src/services/order-cancel apps/channel-adapter/src/consumers`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/rules apps/channel-adapter/src/services/order-cancel
git commit -m "feat(core,channel-adapter): 정산 재시도 실행 모드 + 일시 실패 ack — 같은 배포 (#1016 36번 PR 6)"
```

---

### Task 4: core — 옛 요청 흐름 걷기 (보류 관문·다시 보내기·접기·옛 사실 처리기·settler 옛 분기)

**Files:**
- Delete: `apps/core/src/modules/fulfillment/hold/cancel-request-hold.ts`, `cancel-request-hold.spec.ts`, `cancel-request-hold.integration.spec.ts`
- Delete: `apps/core/src/modules/fulfillment/waybill/waybill.manager.hold.spec.ts`
- Delete: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.facts.integration.spec.ts`, `channel-cancel-settle.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/waybill/waybill.manager.ts:7,58-65,380-381,412-413`
- Modify: `apps/core/src/modules/fulfillment/picking/allocation/allocation.locks.ts:10,367-372,387-400`, `allocation.types.ts:128,138`, `dispatch-blocker.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/services/shipment-short-pick.service.ts:475-477`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/{channel-cancel-request.manager,channel-cancel-request.reader,channel-cancel-request.service,channel-cancel-settler,channel-cancel-match,channel-cancel-request.types}.ts`
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/__support__/cancel-request.fixtures.ts:170-223`(`seedLegacyRequest`)
- Modify: `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts:100-115`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts:256,299-326`, `order-events.consumer.spec.ts:45,101,153-156`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts:47`(주석)
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:1469-1470,1512-1517`(주석만)
- Modify tests: `channel-cancel-match.spec.ts:23-43`, `channel-cancel-request.types.spec.ts:39-60,126-132`, `channel-cancel-request.integration.spec.ts:188-200,264-281,500-518`, `channel-cancel-settlement-actions.integration.spec.ts:138-147`, `channel-cancel-settling.integration.spec.ts:202-225`

**Interfaces:**
- Consumes: Task 2 의 `closeSettlingByFullCancel`.
- Produces: `ChannelCancelRequestService` 에서 `reject`·`markStalled`·`resend`·`withdraw` 가 사라진다. `ChannelCancelRequestReader.findOpen` 이 사라진다. `StartBlockReason` 에서 `'CANCEL_REQUESTED'` 가 사라진다. Task 5 는 core 가 `ChannelOrderCancelRejected`/`Stalled` 타입을 더는 import 하지 않는다는 데 기댄다.

- [ ] **Step 1: 보류 관문 — 파일 삭제와 호출 세 곳**

```bash
git rm apps/core/src/modules/fulfillment/hold/cancel-request-hold.ts \
       apps/core/src/modules/fulfillment/hold/cancel-request-hold.spec.ts \
       apps/core/src/modules/fulfillment/hold/cancel-request-hold.integration.spec.ts \
       apps/core/src/modules/fulfillment/waybill/waybill.manager.hold.spec.ts
ls apps/core/src/modules/fulfillment/hold/   # 비었으면 디렉터리도 사라진다
```

`waybill.manager.ts`:
- 7행의 `cancel-request-hold` import 를 지운다.
- `issueForShipment` 의 커맨드 본문 첫머리를 다음으로(박스 행 잠금은 **남긴다** — 판정 7):

```ts
        async (trx) => {
          // 채널 취소 확정(요청 트랜잭션)과 직렬화한다(#1016 36번 재설계) — 확정이 같은 박스 행을 잠그고 박스를 취소한다.
          // 잠근 뒤 읽으므로 방금 취소된 박스엔 아래 status 검사가 409 를 낸다.
          await trx
            .select({ id: inventoryTables.shipments.id })
            .from(inventoryTables.shipments)
            .where(eq(inventoryTables.shipments.id, shipmentId))
            .for('update');
          const ctx = await this.reader.loadIssueContext(trx, shipmentId);
```

- `reissue` 의 두 줄을 지운다:

```ts
    // 보류는 발급(issueForShipment)도 거절한다 — void 가 먼저 나가면 보류된 박스가 송장 없이 남는다.
    await this.dbService.run((trx) => assertShipmentNotHeld(trx, shipmentId));
```

- `assertDispatchable` 의 두 줄을 지운다:

```ts
      // 출고 보류(#1016 35번 §5.3). 발송·배치 시작·합류·시작 전 추가·라벨 렌더가 모두 여기를 지난다 — 보류는 출고 전체를 멈춘다.
      await assertShipmentNotHeld(trx, shipmentId);
```

- [ ] **Step 2: 배치 시작 차단 사유 `CANCEL_REQUESTED`**

`allocation.types.ts:128`:

```ts
export type StartBlockReason = StartShortReason | 'WAYBILL_NOT_READY';
```

(138행 주석에서 취소 보류 언급을 지운다.)

`allocation.locks.ts`: 10행 `isCancelRequestedError` import 를 지우고, 정렬표에서 `CANCEL_REQUESTED: 3,` 줄을 지우고, `dispatchBlocker` 를:

```ts
/** `assertDispatchable` 의 거절을 박스 사유로 바꾼다 — 송장이 준비되지 않았다. */
export function dispatchBlocker(shipmentId: string, error: ConflictError): StartBlocker {
  return {
    shipmentId,
    reason: 'WAYBILL_NOT_READY',
    shipmentLineId: null,
    skuId: null,
    requiredQty: null,
    shortQty: null,
    detail: error.message,
  };
}
```

`shipment-short-pick.service.ts:475-477`:

```ts
  if (view.reason === 'WAYBILL_NOT_READY') {
    throw new Error('A refill shortage cannot be a waybill blocker');
  }
```

`dispatch-blocker.spec.ts` 의 `it` 을:

```ts
  it('송장 거절은 WAYBILL_NOT_READY — 사유 문장은 detail 로 그대로', () => {
    expect(dispatchBlocker('s1', new ConflictError('WAYBILL_STALE: x'))).toMatchObject({
      reason: 'WAYBILL_NOT_READY',
      detail: 'WAYBILL_STALE: x',
    });
  });
```

- [ ] **Step 3: 요청 매니저·리더·서비스**

`channel-cancel-request.manager.ts`:
- 클래스 docblock 에서 `옛 requested 행(PR 5 전)은 옛 규칙(보류·다시 보내기·접기·수집 때 적용)으로 끝까지 돈다 — findOpen 이 그 행만 본다.` 줄을 지운다.
- `OPEN_SHIPMENT_STATUSES` 위 주석을 `/** 확정이 취소할 수 있는 박스 — 아직 떠나지 않은 상자(취소 코드가 빼는 대상과 같다) */` 로.
- `request()` 첫머리를:

```ts
      const so = await this.lockSalesOrder(input.salesOrderId, trx);
      // 같은 키는 닫힌 요청이어도 그 행이다(재전송). 다른 키의 동시 요청은 판매주문 잠금으로 줄을 서고,
      // 뒤의 것은 앞이 확정한 뒤의 주문으로 판정한다(전체 뒤면 «이미 취소된 주문», 부분 뒤면 남은 몫).
      const replay = await this.reader.findBySourceKey(so.id, input.sourceKey, trx);
      if (replay) return toCancelRequestView(replay);

      const route = channelCancelRoute(so.salesChannel);
```

  (`const open = await this.reader.findOpen(...)` 부터 그 `if (open) { … }` 블록 끝까지 지운다.)
- 잠금 주석(«관문(송장 발급·배치 시작·발송)도 같은 박스 행을 잠근 뒤 보류를 묻는다 …»)을:

```ts
      // 확정은 박스·출고지시를 취소한다 — 송장 발급(같은 박스 행 FOR UPDATE)·배치 시작과 직렬화한다.
      // 확정(cancel)이 출고 불변식의 FOI → 박스 순서로 잠그므로 FOI 를 박스보다 먼저 잡는다 — 배치 시작(FOI → 박스)과 순서가 뒤집히면 교착(40P01).
```

- `reject`·`markStalled`·`resend`·`withdraw` 메서드 넷을 통째로 지운다.
- `recordSettlementFailure` docblock 을:

```ts
  /**
   * 정산 실패 사실(#1016 36번 재설계 §7.3). 정산 중(settling) 행만 읽는다 — 끝난 요청에 늦게 온 사실은 버린다.
   * 같은 requestId 의 사실은 순서 없이 여러 번 온다(리컨실러 재발행): 지난 시도(since 이전)·더 이른 사실은 버린다(D2).
   */
```

- 사적 `write` 의 `status` 타입을 `'settling'` 하나로 좁힌다(남은 호출자는 전부 `'settling'`).
- 쓰지 않게 된 import(`ConflictError` 는 `restartSettlement` 가 계속 쓴다)를 `npm run type-check` 로 정리한다.

`channel-cancel-request.reader.ts`: `findOpen` 메서드를 지운다.

`channel-cancel-request.service.ts`: `reject`·`markStalled`·`resend`·`withdraw` 위임 넷을 지운다.

- [ ] **Step 4: settler 옛 분기**

`channel-cancel-settler.ts`:
- 클래스 docblock 끝의 `옛 requested 행 분기가 먼저 돈다.` 를 지운다.
- `settleModified` 첫 두 줄을:

```ts
    const progress = channel.cancelRequests;
    if (channel.orderCancelled) await this.closeSettlingByFullCancel(salesOrderId, tx);
    const rest = deltas;
```

  (`settleLegacyModified` 호출을 지운다. `occurredAt` 인자는 이제 쓰이지 않는다 — 시그니처는 Task 2 그대로 두고 매개변수 이름을 `_occurredAt` 로 바꾸지 말고 **인자째 지운다**: `settleModified(salesOrderId, deltas, channel, tx)` 로 바꾸고 호출자 `channel-order-change.manager.ts` 에서 `payload.modifiedAt,` 줄을 지운다.)
- `settleLegacyModified`·`applyPhysical` 를 통째로 지운다.
- `settleCancelled` 를:

```ts
  /** 수집된 전체취소(`OrderCancelled`) — 정산 중 전체 요청은 끝났고, 부분 요청은 덮였다(스펙 §7.3) */
  async settleCancelled(salesOrderId: string, tx: DbTx): Promise<void> {
    await this.closeSettlingByFullCancel(salesOrderId, tx);
  }
```

- `supersede` 의 `reason` 타입을 `'CHANNEL_FULL_CANCEL'` 하나로, `write` 의 `status` 타입을 `'applied' | 'superseded'` 로 좁힌다.
- 쓰지 않게 된 import(`takeRequestedDecreases`, `errorDetail`, `isDomainRefusal`, `CHANNEL_CANCEL_REQUEST_REASON`, `SalesOrdersService` 생성자 주입이 남는지)를 type-check 로 정리한다. `SalesOrdersService` 가 더는 안 쓰이면 생성자에서 빼고 이 클래스를 만드는 곳(모듈 DI 는 자동, 테스트 픽스처 `wireCancelRequest`)을 맞춘다.

`channel-cancel-match.ts`: `takeRequestedDecreases` 를 지운다. `channel-cancel-match.spec.ts:23-43` 의 그 테스트를 지운다.

`order-events.consumer.ts`:
- 256행 주석을 `// 우리가 낸 취소 요청을 닫는다 — 정산 중 행(확정 때 적용, 위 cancel() 은 이미 취소된 주문이라 아무것도 안 했다). 줄 단위 취소(마켓)는 요청과 무관하다.` 로.
- `handleChannelOrderCancelRejected`·`handleChannelOrderCancelStalled` 두 처리기를 통째로 지운다.
- `handleChannelOrderSettlementFailed` docblock 을 `정산 실패(#1016 36번 재설계 §7.3). 정산 중 요청만 읽고, 순서 없이 여러 번 와도 늦은 것만 적는다. order_events 에 기록하지 않는다(판매주문 생애가 아니다).` 로.

`order-events.consumer.spec.ts`: 45행 타입의 `reject`·`markStalled`, 101행 목, 153~156행 두 처리기 테스트를 지운다.

`sales-order.module.ts:47` 주석의 이벤트 수를 실제(처리기 목록을 세어) 값으로 고치고 `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 언급을 지운다.

`sales-orders.controller.ts:100-115` 의 `resendCancelRequest`·`withdrawCancelRequest` 두 라우트를 지운다(`@User` import 는 `cancel` 이 계속 쓴다).

`channel-cancel-request.types.ts`: 상태 유니온·`VIEW_STATUSES`·`stage`·`rejection` 은 **남긴다**(판정 1·7). 주석만 — 9행 위에 `/** 'requested'·'rejected' 는 역사 값이다(#1016 36번 PR 6) — 쓰는 코드는 없고, check 가 허용하는 동안 읽다 던지지 않게 남긴다 */`, 57행 `stage` 주석을 `옛 흐름(PR 6 전)의 «수정됨 · 환불 미완» 표지 — 역사 값`, 61행 `command` 주석을 `처음 낸 명령 그대로. 리컨실러·[다시 시도]가 같은 값을 다시 낸다`, 133·135행의 «옛 requested 행» 언급을 «정산 전 흐름(PR 5 전) 행»으로.

`inventory.schema.ts` 주석(코드·제약은 그대로):
- 1469~1470행을 `// requested·rejected: 채널 주문 취소 요청의 옛 흐름(#1016 35번) 역사 값 — PR 6 이 쓰는 코드를 걷었다. 값·check·유니크 인덱스 제거는 contract phase(deploy → migrate).`
- 1512~1513·1517행의 유니크 인덱스 주석을 `// 옛 흐름의 «한 주문에 열린 취소 요청 하나»(역사). 쓰는 코드 없음 — contract phase 에서 지운다.`

- [ ] **Step 5: 픽스처·통합 스펙**

```bash
git rm apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.facts.integration.spec.ts \
       apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settle.integration.spec.ts
```

- `cancel-request.fixtures.ts:170-223` 의 `seedLegacyRequest` 를 지운다(그 import 가 남은 spec 이 있으면 아래에서 함께 지운다).
- `channel-cancel-request.integration.spec.ts`: 188~200행(«옛 requested 행 — 다른 키라도 열린 요청…»), 264~281행(«옛 requested 행 — 운영자 부분취소…409»), 500~518행(«DB 도 열린 요청을 하나만 받는다» — 인덱스는 남지만 쓰는 코드가 없다) 케이스를 지운다.
- `channel-cancel-settlement-actions.integration.spec.ts:138-147`(옛 행 [다시 시도] 409) 케이스를 지운다.
- `channel-cancel-settling.integration.spec.ts`: 202~213행 «옛 사실(Rejected·Stalled)은 settling 행에 닿지 않는다» 를 지우고, 215행 케이스 이름에서 «옛 requested 행·» 을 지운다.
- `channel-cancel-request.types.spec.ts`: 39~60행(옛 `stage: 'edited'`·`rejection` 뷰)은 «역사 값을 읽어도 던지지 않는다» 한 케이스로 남기고 이름만 바꾼다. 126~132행 «옛 행(정산 칸 없음)» 도 같은 취지로 이름만 바꾼다(코드가 남으므로 테스트도 남는다).
- 지운 settle spec 의 «ALL_LINES_REMOVED» 시나리오를 정산 중 흐름으로 옮긴다 — `channel-cancel-settling.integration.spec.ts` 에:

```ts
  it('정산 중 부분취소(refunded) + 채널이 남은 줄도 지움 — 요청은 applied, 남은 감소는 ALL_LINES_REMOVED 로 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      // 줄 0(수량 2) 전부 — 줄 1 이 남아 부분이다. core 유효 수량은 (0,1)
      const view = await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 2 }], requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, {
          quantities: [0, 0],
          cancelRequests: [{ requestId: view.id, stage: 'refunded', refundAmount: 2000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false }],
        }),
        'm-1',
        tx,
      );
      expect((await rowOf(tx, view.id)).status).toBe('applied');
      const channelRows = (await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, seed.salesOrderId))).filter(
        (a) => a.origin === 'channel',
      );
      expect(channelRows).toHaveLength(1);
      expect(channelRows[0].status).toBe('pending');
      expect(JSON.stringify(channelRows[0].deltas)).toContain('ALL_LINES_REMOVED');
    });
  });
```

  (시드 줄 수량이 (2,1) 이 아니면 — `seedChannelOrder` 를 열어 확인 — 줄 0 수량에 맞춘다.)

- [ ] **Step 6: 남은 참조가 없는지**

```bash
grep -rn "findOpen\|assertShipmentNotHeld\|heldShipmentIds\|isCancelRequestedError\|cancel-request-hold\|seedLegacyRequest\|settleLegacyModified\|takeRequestedDecreases\|resendCancelRequest\|withdrawCancelRequest\|markStalled\|CANCEL_REQUESTED" apps/core/src --include=*.ts
```

Expected: 0 줄.

- [ ] **Step 7: 게이트**

Run:
```bash
npm run type-check
npx jest apps/core/src/modules/fulfillment apps/core/src/modules/sales-order
DATABASE_URL=$CORE_IT npx jest --runInBand apps/core/src/modules/sales-order/channel-cancel-request apps/core/src/modules/sales-order/channel-order-change apps/core/src/modules/fulfillment/waybill apps/core/src/modules/fulfillment/picking
```
Expected: type-check 0, 유닛 PASS, 통합 PASS(`request-vs-gate.integration.spec.ts` 포함 — 남긴다).

- [ ] **Step 8: Commit**

```bash
git add -A apps/core/src
git commit -m "refactor(core): 채널 취소 옛 흐름 걷기 — 보류 관문·다시 보내기·접기·옛 사실 처리기·수집 때 적용 (#1016 36번 PR 6)"
```

---

### Task 5: 옛 사실 생산·계약 제거 — channel-adapter + `packages/event-contracts`

**Files:**
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts`(3·7·9~10행 타입, `legacy:` 전부, `rejected()`·`stalled()`)
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts:9-10,15-24,48-83`
- Modify: `apps/channel-adapter/src/services/order-cancel/{channel-order-cancel.manager.spec,channel-order-cancel.repository.spec}.ts`
- Modify: `packages/event-contracts/streams/orders.stream.ts:594-653,655-690(주석),714-721`
- Modify: `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts:1,6-37`
- Modify(문서·주석): `packages/event-contracts/streams/channel-orders-command.stream.ts:35-37`, `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts:15-16`, `libs/shared/src/streams/README.md:200-201`, `apps/channel-adapter/CLAUDE.md`(§3-5 마지막 줄, §4 발행 표)

**Interfaces:**
- Consumes: Task 4(core 가 두 타입을 import 하지 않는다), Task 3(`fail()` 이 던지지 않는다).
- Produces: `ChannelOrderCancelRepository.recordSettlementFailure(fact: ChannelOrderSettlementFailedPayload, deliveryId: string): Promise<void>` — 세 번째 인자가 사라진다. 계약에서 `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled`·`CHANNEL_ORDER_CANCEL_REJECTION_CODES`·`ChannelOrderCancelRejectionCode` 가 사라진다.

- [ ] **Step 1: 테스트를 먼저 — 저장소**

`channel-order-cancel.repository.spec.ts` 의 67~88행(옛 사실 동시 적재) 케이스를 지우고, 다음을 둔다(같은 파일의 기존 목·준비부 이름을 쓴다):

```ts
  it('정산 실패 사실 하나만 적재한다 — 옛 사실(Rejected·Stalled)은 더 내지 않는다(PR 6)', async () => {
    await repository.recordSettlementFailure(fact, 'd1');
    expect(orders.enqueue).toHaveBeenCalledTimes(1);
    expect(orders.enqueue.mock.calls[0][0]).toMatchObject({ eventType: 'ChannelOrderSettlementFailed' });
  });
```

`channel-order-cancel.manager.spec.ts`: 33~36행 `recorded()` 헬퍼에서 `legacy` 를 빼(`const [fact, deliveryId] = …; return { fact, deliveryId };`), `legacy` 를 단언하는 줄(59·73·136·149·161·199·215·231·239·248·262·271행 근처)을 전부 지운다. 테스트 이름의 «+ 옛 …» 꼬리를 지운다.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/services/order-cancel`
Expected: FAIL (저장소가 두 번 enqueue)

- [ ] **Step 3: 구현 — 저장소**

`channel-order-cancel.repository.ts`:
- import 에서 `ChannelOrderCancelRejectedPayload`·`ChannelOrderCancelStalledPayload` 를 지운다.
- `LegacyCancelFact`·`CancelFactEventType`·`CancelFactPayload` 타입(15~24행)을 지운다.
- `recordSettlementFailure` 를:

```ts
  /**
   * 정산 실패 사실을 적재한다.
   * 멱등 키에 deliveryId(명령 봉투 messageId)를 넣는다 — Kafka 가 같은 메시지를 다시 주면 한 번만 적재되고, core 의 재발행은 새 messageId 라
   * 사실을 다시 낸다(첫 사실이 유실됐어도 두 번째 시도가 빈손이 되지 않는다). failureCode 도 넣는다 — 같은 전달의 재배달 사이에 결과가 바뀌면 다른 사실이다.
   */
  async recordSettlementFailure(fact: ChannelOrderSettlementFailedPayload, deliveryId: string): Promise<void> {
    const code = fact.failureCode.slice(0, KEY_FAILURE_CODE_MAX);
    await this.orders.enqueue({
      eventType: 'ChannelOrderSettlementFailed',
      aggregateId: channelOrderPartitionKey(fact.salesChannel, fact.externalOrderId),
      // 수집 사실(OrderCreated·OrderModified·OrderCancelled)과 같은 파티션 키 — 같은 파티션에 실린다(아웃박스를 거치므로 엄밀한 순서를 주장하진 않는다)
      partitionKey: fact.salesChannel,
      metadata: { partitionKey: fact.salesChannel },
      idempotencyKey: `settlement-failed:${fact.requestId}:${deliveryId}:${code}`,
      payload: fact,
    });
  }
```

  (`this.db.db.transaction` 이 더는 필요 없다 — 사실 하나라 트랜잭션 없이 enqueue 한다. `PublisherFor.enqueue` 가 `tx` 없이 부를 수 있는지 `libs/events` 의 시그니처를 확인한다 — 필수면 `this.db.db.transaction(async (tx) => this.orders.enqueue({...}, tx))` 로 둔다.)

- [ ] **Step 4: 구현 — 매니저**

`channel-order-cancel.manager.ts`:
- 3행 import 를 `import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';` 로, 7행을 `import { ChannelOrderCancelRepository } from './channel-order-cancel.repository';` 로.
- 9~10행:

```ts
/** 정산이 끝나지 못한 결과 */
type SettlementFailure = { retryable: boolean; failureCode: string; message: string };
```

- `legacy: …` 속성을 모든 반환 객체에서 지운다(43·66·81·83·113·120·128·131행). `refund_refused` 의 `...(outcome.edited ? { legacy: stalled(...) } : {})` 줄과 그 위 주석도 지운다. 전체 `refund_refused` 의 «옛 사실을 내지 않는다 …» 주석, 부분 `not_cancelable` 의 «옛 adapter 는 이 400 을 던졌다 …» 주석을 지운다.
- `fail()` 의 `recordSettlementFailure(…, deliveryId, failure.legacy)` 에서 세 번째 인자를 지운다.
- 파일 끝의 `rejected()`·`stalled()` 함수를 지운다.

- [ ] **Step 5: 계약**

`orders.stream.ts`:
- 594~606행(거절 코드 문서 주석, `CHANNEL_ORDER_CANCEL_REJECTION_CODES`, `ChannelOrderCancelRejectionCode`), 608~633행(`ChannelOrderCancelRejectedPayload`·Schema), 635~653행(`ChannelOrderCancelStalledPayload`·Schema)을 지운다.
- `ORDER_STREAM.events` 의 `ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 등록(714~721행)을 지운다.
- `ChannelOrderSettlementFailedPayload` docblock(660행 근처)의 «PR 6 전까지 … 옛 사실을 함께 낸다» 문장을 지운다.

`channel-order-cancel-facts.spec.ts`: 1행 import 에서 `CHANNEL_ORDER_CANCEL_REJECTION_CODES` 를 지우고 Rejected(6~27행)·Stalled(29~37행) describe 를 지운다. 그리고 등록이 사라졌음을 못 박는다:

```ts
  it('옛 사실 둘은 스트림에서 사라졌다 — 들어오면 소비자가 경고 후 버린다(PR 6 판정 1)', () => {
    expect(Object.keys(ORDER_STREAM.events)).not.toContain('ChannelOrderCancelRejected');
    expect(Object.keys(ORDER_STREAM.events)).not.toContain('ChannelOrderCancelStalled');
  });
```

(`ORDER_STREAM` import 를 파일 상단에 더한다 — `from '../orders.stream'`.)

- [ ] **Step 6: 문서·주석**

- `channel-orders-command.stream.ts:35-37`: «core 는 요청을 기록·보류한 뒤 … 거절은 `ChannelOrderCancelRejected` 로 돌려받는다» → «core 는 요청 순간 취소를 확정하고 명령을 낸다. 정산이 끝나지 못하면 `ChannelOrderSettlementFailed` 로 돌려받는다(#1016 36번 재설계).»
- `channel-orders-command.consumer.ts:15-16`: 옛 사실 언급을 지운다.
- `libs/shared/src/streams/README.md:200-201`: 두 이벤트 줄을 지운다.
- `apps/channel-adapter/CLAUDE.md` §3-5 마지막 항목의 `— 정리 PR 전까지 옛 Rejected/Stalled 를 함께 내고 일시 실패는 던진다` 를 `— 사실을 낸 뒤 명령을 ack 하고, 다시 부르는 건 core 리컨실러(#36)다` 로. §4 발행 표의 `(+옛 ChannelOrderCancelRejected·Stalled)` 를 지운다.

- [ ] **Step 7: 남은 참조**

```bash
grep -rn "ChannelOrderCancelRejected\|ChannelOrderCancelStalled\|CHANNEL_ORDER_CANCEL_REJECTION_CODES\|ChannelOrderCancelRejectionCode\|LegacyCancelFact" apps packages libs --include=*.ts --include=*.md | grep -v node_modules
```

Expected: 0 줄(옛 계획·스펙 문서 `docs/` 는 역사라 그대로).

- [ ] **Step 8: 게이트**

Run:
```bash
npm run type-check
npx jest apps/channel-adapter packages/event-contracts
npm run audit:event-handlers 2>&1 | tail -5
npm run audit:event-publishers 2>&1 | tail -5
npm run audit:consume-validation -- --gate 2>&1 | tail -5
```
Expected: type-check 0, PASS, 처리기 102·발견 0, 발행자 발견 0, 위반 0. 숫자를 적어 둔다(PR 본문).

- [ ] **Step 9: Commit**

```bash
git add -A apps/channel-adapter packages/event-contracts libs/shared/src/streams/README.md
git commit -m "refactor(channel-adapter,contracts): 옛 취소 사실 생산·계약 제거 — Rejected·Stalled·REFUND_FAILED (#1016 36번 PR 6)"
```

---

### Task 6: 보드 옛 상태·고객 API 옛 칸 — 판정 SQL·기준·리컨실러 제외·actions API

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts:160-221,241,246,262`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts:54,145-146`, `order-progress.thresholds.spec.ts:41,84-87,95`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.ts:5-12`, `order-reconcile.subject.spec.ts`, `order-reconcile.gate.spec.ts:38`, `order-reconcile.runner.integration.spec.ts:704`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts:248-300,350-367`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:559-563,726-729,761`, `store-sales-orders.service.spec.ts:489-510`
- Modify: `apps/core/src/modules/sales-order/dto/store-order-actions.dto.ts:29-31,118,123-127`

**Interfaces:**
- Consumes: Task 4(옛 행을 만드는 코드가 없다).
- Produces: 판정 SQL 의 `rule` 에서 `'cancel_request'` 가 사라진다(정산 중은 `'cancel_settle'`, 단계는 여전히 `'cancel_request'`). `ORDER_PROGRESS_STATES.cancel_request = ['settle_in_progress', 'settle_delayed', 'settle_refused']`. `SHIPMENT_EXCLUDED_ORDER_RULES = ['external_shipped', 'return_exchange']`. `StoreOrderActionsResponseDto` 에서 `cancelRequestStatus` 와 사유 `'cancel_requested'` 가 사라진다.

- [ ] **Step 1: 테스트를 먼저**

`order-progress.thresholds.spec.ts`:
- 84~87행(옛 상태 `cancel_requested` 5분 갇힘) 케이스를 지운다.
- 95행 근처 `expect(ORDER_PROGRESS_STATES.cancel_request).toEqual(…)` 를 `['settle_in_progress', 'settle_delayed', 'settle_refused']` 로.
- 41행 `cancel_request: 5 * 60_000` 는 그대로(키는 남는다).

`order-reconcile.gate.spec.ts:38` 의 `state: 'cancel_requested'` 를 `state: 'settle_refused'` 로.

`order-reconcile.runner.integration.spec.ts:704` 의 `orderRules: ['cancel_request']` 를 `orderRules: ['external_shipped']` 로.

`store-sales-orders.service.spec.ts`: 489~495행(«열린 취소 요청 — cancel_requested»)·497~502행(«거절된 최근 요청 — cancelRequestStatus=rejected»)·504~510행(«취소된 주문은 요청 상태를 싣지 않는다») 케이스를 지우고 하나를 둔다:

```ts
    it('취소 요청 상태 칸은 더 싣지 않는다 — 요청은 확정이라 «처리 중» 요청이 없다(PR 6)', async () => {
      const { service } = makeContext({ openRequestView: { id: 'req-1', status: 'settling' } });
      const r = await service.getActionsByChannelOrder(CHANNEL_ORDER_ID, CUSTOMER_ID);
      expect(r).not.toHaveProperty('cancelRequestStatus');
      expect(r.cancelUnavailableReason).not.toBe('cancel_requested');
    });
```

(`makeContext` 의 `openRequestView` 옵션이 `latestFor` 목을 채운다 — 아래 Step 4 에서 `latestFor` 호출을 지우면 이 옵션이 쓰이지 않게 된다. 그러면 옵션과 목도 지우고 이 테스트는 `makeContext({})` 로 둔다.)

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts apps/core/src/modules/fulfillment/order-reconcile apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts`
Expected: FAIL (상태 목록, `cancelRequestStatus` 존재)

- [ ] **Step 3: 판정 SQL·기준·제외 목록**

`order-progress.judge-sql.ts` 의 `creq` CTE 와 그 위 주석을:

```ts
    -- 채널 취소 요청 — 확정됨·정산 중(#1016 36번 재설계). 한 주문에 여럿일 수 있다(정산 중 요청 둘) — 나쁜 순(거절 > 지연 > 정산 중), 같으면 오래된 것.
    -- «지연»은 저장하지 않는다 — 확정 시각(created_at) + SETTLE_DELAYED_AFTER_MS 로 여기서 정한다(D1).
    -- 정산 중은 주문 접기(보드)에서만 앞선다 — 상자 판정은 판매주문의 종료 사실(셀메이트 출고·취소·반품)을 그대로 지킨다(decided.base_rule).
    creq AS (
      SELECT DISTINCT ON (a.sales_order_id) a.sales_order_id, a.created_at, x.state
        FROM sales_order_amendments a
        JOIN so ON so.id = a.sales_order_id
        CROSS JOIN LATERAL (
          SELECT CASE
                   WHEN a.metadata->'settlement'->>'state' = 'refused' THEN 'settle_refused'
                   WHEN a.created_at < ${now} - make_interval(secs => ${SETTLE_DELAYED_AFTER_MS / 1000}) THEN 'settle_delayed'
                   ELSE 'settle_in_progress'
                 END AS state
        ) x
       WHERE a.reason_code = ${CHANNEL_CANCEL_REQUEST_REASON} AND a.status = 'settling'
       ORDER BY a.sales_order_id,
                CASE x.state WHEN 'settle_refused' THEN 1 WHEN 'settle_delayed' THEN 2 ELSE 3 END,
                a.created_at
    ),
    -- base_rule: 정산 중을 모르는 판정.
```

`decided_base` 의 `CASE` 첫 줄 `WHEN cr.state IN ('cancel_requested', 'cancel_edited') THEN 'cancel_request'` 를 지운다.

`decided` 를:

```ts
    -- rule: 주문 접기의 판정. 확정된 취소의 정산(cancel_settle)이 판매주문의 종료·진행보다 앞선다 — 정산이 끝나야 운영자 일이 끝난다.
    -- cancel_settle 은 보류가 아니다 — 상자 규칙 제외(D16)에 넣지 않는다(order-reconcile.subject.ts, D5)
    decided AS (
      SELECT b.*,
             CASE WHEN b.creq_state IS NOT NULL THEN 'cancel_settle' ELSE b.base_rule END AS rule
        FROM decided_base b
    )
```

`judgedRowsSql` 의 세 `CASE d.rule` 에서 `WHEN 'cancel_request' THEN …` 갈래를 지운다(각각 `'cancel_request'`, `d.creq_state`, `d.creq_at` — `cancel_settle` 갈래는 남긴다).

`order-progress.thresholds.ts`:
- 54행: `cancel_request: ['settle_in_progress', 'settle_delayed', 'settle_refused'],`
- 145~146행 주석을 `// 단계 기본값 — 정산 중 상태는 전부 STUCK_AFTER_MS_BY_STATE 가 덮는다(키는 Record 라 남는다)` 로. 값 `5 * MINUTE` 는 그대로.

`order-reconcile.subject.ts`:

```ts
/**
 * 상자 판정에서 빼는 주문 규칙(D16) — 셀메이트로 나간 주문(external_shipped)·반품/교환 중인 주문은 상자 규칙이 손대지 않는다.
 * 정산 중(cancel_settle)은 보류가 아니라 넣지 않는다(D5).
 */
export const SHIPMENT_EXCLUDED_ORDER_RULES = ['external_shipped', 'return_exchange'] as const;
```

(원래 docblock 의 나머지 문장은 유지하고 «채널 취소 요청 중(출고 보류)» 만 지운다.)

`order-progress.judge.integration.spec.ts`:
- 248~272행 «열린 취소 요청 → cancel_request/cancel_requested» 를 지운다.
- 274행 케이스는 «닫힌 요청은 단계에 영향 없음» 만 남긴다: 이름을 `'끝난(applied) 취소 요청은 단계에 영향 없음'` 으로 바꾸고 `requested`/`edited` 시드와 그 단언을 지운 뒤 `applied` 행 시드와 «단계가 요청 이전과 같다» 단언만 남긴다.
- 350~367행 «옛 requested 행과 정산 중 행이 같이 있으면 옛 행이 대표» 를 지운다.

- [ ] **Step 4: 고객 actions API**

`store-sales-orders.service.ts` `buildActionsView`:
- 559~563행:

```ts
    const foRows = await this.loadFoRows(so.id);
```

  (`cancelRequest`·`cancelRequestStatus` 두 상수를 지운다. `this.cancelRequests` 가 다른 곳(`channelSettlementRefundStatus` 등)에서 계속 쓰이는지 확인한다.)
- 726~729행 `} else if (cancelRequestStatus === 'requested') { … }` 갈래를 지운다.
- 반환 객체의 `cancelRequestStatus,` 를 지운다.

`store-order-actions.dto.ts`: `StoreCancelUnavailableReason` 의 `// 채널 취소 요청이 처리 중(#1016 35번)` 과 `| 'cancel_requested'` 를 지우고(앞 줄 끝에 `;`), swagger `enum` 에서 `'cancel_requested'` 를 지우고, `cancelRequestStatus` 속성(123~127행)을 지운다.

- [ ] **Step 5: 통과 + 통합**

Run:
```bash
npm run type-check
npx jest apps/core/src/modules/fulfillment apps/core/src/modules/sales-order
DATABASE_URL=$CORE_IT npx jest --runInBand apps/core/src/modules/fulfillment/order-progress apps/core/src/modules/fulfillment/order-reconcile
```
Expected: 0 · PASS · PASS. `order-progress.thresholds.spec.ts` 의 «목록의 모든 상태가 판정 SQL 에 글자로 있다»와 `order-reconcile.subject.spec.ts` 의 «제외 규칙은 judgedShipmentsSql 에 THEN 으로 있다»가 초록이어야 한다.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment apps/core/src/modules/sales-order
git commit -m "refactor(core): 보드 옛 취소 요청 상태·고객 API 옛 칸 제거 — 판정 SQL 변경, 배포 전 EXPLAIN (#1016 36번 PR 6)"
```

---

### Task 7: admin-web — 옛 버튼·«처리 중» 폴링 걷기

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts:19-48,66-68,134-141,166-182,184-199,201-216,218-245,251-275`
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts:166-167`, `order-progress.shape.spec.ts:45-46,186`
- Modify: `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx:7-10,34-37,191-253`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx:643,920-926`
- Modify: `apps/admin-web/src/features/order/history/hooks/use-order-rows.ts:10,124-128,141-150`
- Modify: `apps/admin-web/src/lib/api/domains/orders/sales-orders.client.ts:131-146`, `apps/admin-web/src/lib/services/orders/mutations.ts:1103-1127`

**Interfaces:**
- Consumes: Task 4(라우트 `cancel-request/resend`·`withdraw` 가 core 에서 사라짐), Task 6(상태 `cancel_requested`·`cancel_edited` 가 사라짐).
- Produces: `CancelRequestView.status: 'settling' | 'applied' | 'rejected' | 'superseded'`, `CancelAction` 에서 `{ kind: 'requested' }` 제거, `hasFreshOpenCancelRequest`·`settledCancelRequestIds` 제거.

- [ ] **Step 1: 테스트를 먼저 — shape**

`cancel-request.shape.spec.ts`:
- 21행 기본 `view()` 의 `status: 'requested'` 를 `status: 'settling'` 으로, 기본 `stage` 줄이 있으면 지운다(뷰 타입에서 `stage` 가 사라진다).
- 84~111행 `it.each` 에서 `requested`·`edited` 행을 지운다(`rejected`·`OPERATOR_WITHDRAWN` 행은 «역사 표시»로 남는다).
- 113~135행(처리 중 폴링·끝난 요청 id) 케이스를 지운다.
- 151·195~201행의 옛 응답(`status: 'requested'`) 토스트 단언을 지우고 하나를 둔다:

```ts
  it('운영자 취소 응답은 늘 확정 — 상태와 무관하게 «취소했습니다»(PR 6)', () => {
    expect(cancelRequestToast({ requestId: 'r', status: 'settling', scope: 'full', convertedFromFull: false })).toBe('취소했습니다. 환불은 채널이 처리합니다.');
    expect(cancelRequestToast({ requestId: 'r', status: 'applied', scope: 'partial', convertedFromFull: true })).toBe(
      '출고된 상품을 뺀 나머지를 취소했습니다. 환불은 채널이 처리합니다.',
    );
  });

  it('옛 requested 응답은 뷰가 되지 않는다 — 버튼 없이 «취소»로 다시 요청할 수 있다', () => {
    expect(toCancelRequestView({ id: 'r', status: 'requested', scope: 'full' })).toBeNull();
    expect(cancelActionOf({ channel: 'medusa', orderStatus: 'confirmed', cancelRequest: null })).toEqual({ kind: 'cancel', label: '취소' });
  });
```

`order-progress.shape.spec.ts`: 45~46행의 `cancel_requested`·`cancel_edited` 라벨 단언과 186행의 옛 상태 사용을 지운다(186행이 다른 단언의 예시로 쓰였으면 `settle_delayed` 로 바꾼다).

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- apps/admin-web/src/lib/api/domains/orders`
Expected: FAIL (`requested` 가 아직 뷰가 된다)

- [ ] **Step 3: 구현 — shape**

`cancel-request.shape.ts`:
- `CancelRequestView.status` 를 `'settling' | 'applied' | 'rejected' | 'superseded'`, `stage` 속성을 지운다.
- `CancelAction` 에서 `| { kind: 'requested'; label: string }` 를 지운다.
- `isStatus`:

```ts
function isStatus(value: unknown): value is CancelRequestView['status'] {
  // 'requested' 는 옛 흐름의 역사 값 — 뷰로 만들지 않는다(그 주문은 «취소» 버튼으로 새 흐름을 탄다, PR 6)
  return value === 'settling' || value === 'applied' || value === 'rejected' || value === 'superseded';
}
```

- `cancelRequestToast`:

```ts
/** 운영자 취소는 요청 순간 확정된다(#1016 36번 재설계) — 응답이 곧 «취소했다»다 */
export function cancelRequestToast(r: Extract<AdminCancelResponse, { requestId: string }>): string {
  return r.convertedFromFull
    ? '출고된 상품을 뺀 나머지를 취소했습니다. 환불은 채널이 처리합니다.'
    : '취소했습니다. 환불은 채널이 처리합니다.';
}
```

- `toCancelRequestView` 반환에서 `stage: …` 줄을, `cancelRequestFromAmendment` 에서 `stage: request.stage,` 줄을 지운다.
- `cancelActionOf` 의 `if (request?.status === 'requested') { … }` 블록을 지운다.
- `cancelRequestLine` 의 `case 'requested': …` 두 줄을 지운다.
- `openRequestsOf`·`hasFreshOpenCancelRequest`·`settledCancelRequestIds` 를 지운다.
- 3행 머리 주석 `(#1016 35번)` 뒤에 `· 36번 재설계: 요청은 확정이다` 를 덧붙인다.

`order-progress.shape.ts:166-167` 의 `cancel_requested`·`cancel_edited` 두 라벨을 지운다.

- [ ] **Step 4: 구현 — 화면·클라이언트**

`stage-orders.tsx`:
- 7~10행 `useResendCancelRequest`·`useWithdrawCancelRequest` import 와 `toast`·`cn` import 중 쓰지 않게 되는 것을 지운다.
- 34~37행 `resend`·`withdraw`·`confirmWithdraw` 를 지운다.
- 191~253행의 셀을:

```tsx
                  {isCancelRequest && (
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {r.settlement ? (
                        <SettlementActions salesOrderId={r.salesOrderId} settlement={r.settlement} />
                      ) : null}
                    </td>
                  )}
```

`history/components/table/index.tsx`:
- 643행 `className={view.status === 'requested' ? 'mb-1 text-sm text-amber-700' : 'mb-1 text-sm text-muted-foreground'}` → `className="mb-1 text-sm text-muted-foreground"`.
- 920~926행 `if (action.kind === 'requested') { … }` 블록을 지운다.

`use-order-rows.ts`:
- 10행 import 를 `import { toCancelRequestView } from '@/lib/api/domains/orders/cancel-request.shape';` 로(`toCancelRequestView` 를 계속 쓰는지 확인 — 안 쓰면 줄째 지운다).
- 124~126행 주석과 `refetchInterval: …` 줄을 지운다.
- 141~150행(요청이 끝나면 목록 다시 읽기 `useEffect`·`prevDetails`·`useQueryClient`)을 지운다. `useEffect`·`useRef`·`useQueryClient` import 가 다른 곳에서 안 쓰이면 지운다.

`sales-orders.client.ts:131-146` 의 `resendCancelRequest`·`withdrawCancelRequest` 를, `mutations.ts:1103-1127` 의 `useResendCancelRequest`·`useWithdrawCancelRequest` 를 지운다.

- [ ] **Step 5: 남은 참조 + 게이트**

```bash
grep -rn "resendCancelRequest\|withdrawCancelRequest\|useResendCancelRequest\|useWithdrawCancelRequest\|hasFreshOpenCancelRequest\|settledCancelRequestIds\|cancel_requested\|cancel_edited\|kind === 'requested'" apps/admin-web/src
npm run test:admin-web
(cd apps/admin-web && npx tsc --noEmit)
```

Expected: grep 0 줄, PASS, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add -A apps/admin-web/src
git commit -m "refactor(admin-web): 채널 취소 옛 버튼·처리 중 폴링 제거 — 다시 보내기·요청 접기 (#1016 36번 PR 6)"
```

---

### Task 8: Medusa — 대시보드 기본 취소·환불 미들웨어 (스펙 §6.6)

**Files:**
- Create: `apps/medusa/src/api/admin/orders/middlewares/reject-default-cancel-with-refundable.ts`
- Create: `apps/medusa/src/api/admin/orders/middlewares/__tests__/reject-default-cancel-with-refundable.unit.spec.ts`
- Create: `apps/medusa/src/api/admin/orders/middlewares.ts`
- Create: `apps/medusa/src/api/admin/payments/middlewares/reject-refund-on-canceled-order.ts`
- Create: `apps/medusa/src/api/admin/payments/middlewares/__tests__/reject-refund-on-canceled-order.unit.spec.ts`
- Modify: `apps/medusa/src/api/admin/payments/middlewares.ts:6-21`
- Modify: `apps/medusa/src/api/admin/middlewares.ts:1-24`
- Modify: `apps/medusa/integration-tests/http/channel-cancel-settlement.spec.ts:353-370`
- Modify: `apps/medusa/integration-tests/http/wallet-refund-projection.spec.ts:54-62`

**Interfaces:**
- Consumes: `orderPaymentIds(container, orderId)`(`workflows/orders/settlement/order-payments.ts`), `toNumber`(`workflows/orders/partial-cancel/amount.ts`).
- Produces: `rejectDefaultCancelWithRefundable`, `DEFAULT_CANCEL_BLOCKED_CODE = 'default_cancel_blocked'`, `rejectRefundOnCanceledOrder`, `REFUND_ON_CANCELED_ORDER_CODE = 'refund_on_canceled_order'`, `adminOrderRoutesMiddlewares: MiddlewareRoute[]`.

시작 전: `https://docs.medusajs.com/llms.txt` 에서 «Middlewares» 페이지를 열어 `defineMiddlewares` 의 `matcher`·`method`·`middlewares` 와 `req.scope` 사용을 확인한다(CLAUDE.md — 확장은 문서에서). 미들웨어는 문서 확장 순서 3번째이고 라우트 override 가 아니다.

- [ ] **Step 1: 실패하는 단위 테스트 — 기본 취소**

`reject-default-cancel-with-refundable.unit.spec.ts`:

```ts
import { rejectDefaultCancelWithRefundable, DEFAULT_CANCEL_BLOCKED_CODE } from '../reject-default-cancel-with-refundable';

jest.mock('../../../../../workflows/orders/settlement/order-payments', () => ({
  orderPaymentIds: jest.fn(),
}));
import { orderPaymentIds } from '../../../../../workflows/orders/settlement/order-payments';

type Payment = { canceled_at?: string | null; captures?: Array<{ amount: unknown }>; refunds?: Array<{ amount: unknown }> };

function makeReq(payments: Record<string, Payment>) {
  (orderPaymentIds as jest.Mock).mockResolvedValue(Object.keys(payments));
  const paymentModule = { retrievePayment: jest.fn(async (id: string) => ({ id, ...payments[id] })) };
  return {
    params: { id: 'order_1' },
    scope: { resolve: jest.fn(() => paymentModule) },
  } as any;
}
function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe('rejectDefaultCancelWithRefundable — 대시보드 기본 취소 막기(#1016 36번 §6.6)', () => {
  it('돌려줄 돈이 남은 결제가 있으면 400 — admin-web 에서 취소', async () => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq({ p1: { captures: [{ amount: 13000 }], refunds: [{ amount: 3000 }] } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'not_allowed', code: DEFAULT_CANCEL_BLOCKED_CODE }));
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['결제 없음', {}],
    ['전부 환불됨', { p1: { captures: [{ amount: 13000 }], refunds: [{ amount: 13000 }] } }],
    ['캡처 없음(미결제)', { p1: { captures: [], refunds: [] } }],
    ['취소된 결제', { p1: { canceled_at: '2026-10-12T00:00:00Z', captures: [{ amount: 13000 }] } }],
  ])('%s 이면 통과 — 기본 취소가 할 환불이 없다', async (_label, payments) => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq(payments as Record<string, Payment>), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('금액을 읽을 수 없으면 막는다 — 장부를 거짓으로 만드는 쪽이 더 비싸다(E6)', async () => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq({ p1: { captures: [{ amount: { weird: 1 } }], refunds: [] } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('BigNumber 모양 금액도 읽는다', async () => {
    const res = makeRes();
    const next = jest.fn();
    await rejectDefaultCancelWithRefundable(makeReq({ p1: { captures: [{ amount: { numeric_: 5000 } }], refunds: [{ amount: '5000' }] } }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패하는 단위 테스트 — 취소된 주문의 환불**

`reject-refund-on-canceled-order.unit.spec.ts`:

```ts
import { rejectRefundOnCanceledOrder, REFUND_ON_CANCELED_ORDER_CODE } from '../reject-refund-on-canceled-order';

function makeReq(opts: { payment?: { id: string; payment_collection_id: string } | null; orderStatus?: string | null }) {
  const paymentModule = { listPayments: jest.fn(async () => (opts.payment ? [opts.payment] : [])) };
  const query = {
    graph: jest.fn(async () => ({ data: opts.orderStatus === undefined ? [] : [{ order: opts.orderStatus === null ? null : { id: 'order_1', status: opts.orderStatus } }] })),
  };
  return {
    params: { id: 'pay_1' },
    scope: { resolve: jest.fn((key: string) => (key === 'query' ? query : paymentModule)) },
    _query: query,
  } as any;
}
function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const PAYMENT = { id: 'pay_1', payment_collection_id: 'paycol_1' };

describe('rejectRefundOnCanceledOrder — 취소된 주문의 기본 환불 막기(#1016 36번 §6.6)', () => {
  it('주문이 취소됐으면 400 — 돈이 나간 뒤 크레딧 라인 단계에서 실패한다(스펙 §2.2)', async () => {
    const res = makeRes();
    const next = jest.fn();
    const req = makeReq({ payment: PAYMENT, orderStatus: 'canceled' });
    await rejectRefundOnCanceledOrder(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'not_allowed', code: REFUND_ON_CANCELED_ORDER_CODE }));
    expect(req._query.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'order_payment_collection', filters: { payment_collection_id: 'paycol_1' } }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['살아 있는 주문', { payment: PAYMENT, orderStatus: 'pending' }],
    ['주문 링크 없음', { payment: PAYMENT }],
    ['결제 없음 — 라우트가 404', { payment: null }],
  ])('%s 이면 통과', async (_label, opts) => {
    const res = makeRes();
    const next = jest.fn();
    await rejectRefundOnCanceledOrder(makeReq(opts as never), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest src/api/admin/orders/middlewares src/api/admin/payments/middlewares`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

`apps/medusa/src/api/admin/orders/middlewares/reject-default-cancel-with-refundable.ts`:

```ts
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { orderPaymentIds } from '../../../../workflows/orders/settlement/order-payments';
import { toNumber } from '../../../../workflows/orders/partial-cancel/amount';

export const DEFAULT_CANCEL_BLOCKED_CODE = 'default_cancel_blocked';

/**
 * 대시보드 기본 취소를 막는다(#1016 36번 재설계 §6.6). 2.13.4 의 cancelOrderWorkflow 는 환불 실패를 삼키고 환불 거래를 입력 전체로 적어
 * 장부를 거짓으로 만든다(스펙 §2.2) — 돌려줄 돈이 남은 주문은 admin-web(정산 라우트 channel-cancel)으로만 취소한다.
 * 정산 라우트는 워크플로를 직접 부르므로 이 미들웨어를 지나지 않는다. 금액을 읽을 수 없으면 막는다(E6).
 */
export async function rejectDefaultCancelWithRefundable(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const payments = req.scope.resolve(Modules.PAYMENT);
  for (const paymentId of await orderPaymentIds(req.scope, req.params.id)) {
    const p = await payments.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
    if (p.canceled_at) continue;
    const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
    const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
    if (!(captured - refunded <= 0)) {
      return res.status(400).json({
        type: 'not_allowed',
        code: DEFAULT_CANCEL_BLOCKED_CODE,
        message: '환불할 금액이 남은 주문은 여기서 취소할 수 없습니다. admin-web 에서 취소하세요.',
      });
    }
  }
  return next();
}
```

`apps/medusa/src/api/admin/orders/middlewares.ts`:

```ts
import { MiddlewareRoute } from '@medusajs/framework/http';
import { rejectDefaultCancelWithRefundable } from './middlewares/reject-default-cancel-with-refundable';

export const adminOrderRoutesMiddlewares: MiddlewareRoute[] = [
  {
    // method 를 주면 정확 일치로 등록된다 — /channel-cancel·/partial-cancel·/fulfillments/:fid/cancel 과 맞지 않는다(PR 6 판정 5)
    method: ['POST'],
    matcher: '/admin/orders/:id/cancel',
    middlewares: [rejectDefaultCancelWithRefundable],
  },
];
```

`apps/medusa/src/api/admin/payments/middlewares/reject-refund-on-canceled-order.ts`:

```ts
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

export const REFUND_ON_CANCELED_ORDER_CODE = 'refund_on_canceled_order';

/**
 * 취소된 주문의 기본 환불을 막는다(#1016 36번 재설계 §6.6). 취소된 주문에 환불하면 돈이 «나간 뒤» 크레딧 라인 단계가
 * throwIfOrderIsCancelled 로 던지고 환불 단계엔 보상이 없다(스펙 §2.2). 결제 → 주문은 core-flows 의 refundPaymentWorkflow 와 같은
 * order_payment_collection 링크로 찾는다. 결제가 없으면 통과 — 라우트가 404 를 낸다.
 */
export async function rejectRefundOnCanceledOrder(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const [payment] = await req.scope
    .resolve(Modules.PAYMENT)
    .listPayments({ id: req.params.id }, { select: ['id', 'payment_collection_id'] });
  if (!payment) return next();
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order_payment_collection',
    fields: ['order.id', 'order.status'],
    filters: { payment_collection_id: payment.payment_collection_id },
  });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 상태 하나로만 좁힌다
  const status = (data[0] as { order?: { status?: string } | null } | undefined)?.order?.status;
  if (status === 'canceled') {
    return res.status(400).json({
      type: 'not_allowed',
      code: REFUND_ON_CANCELED_ORDER_CODE,
      message: '취소된 주문의 결제는 여기서 환불할 수 없습니다. admin-web 에서 처리하세요.',
    });
  }
  return next();
}
```

`apps/medusa/src/api/admin/payments/middlewares.ts` 의 `middlewares: [ … ]` 배열 끝(두 검증기 **뒤**)에 `rejectRefundOnCanceledOrder,` 를 더하고 import 한다(본문 검증이 먼저 400 을 내야 잘못된 본문이 DB 조회를 하지 않는다).

`apps/medusa/src/api/admin/middlewares.ts`: `import { adminOrderRoutesMiddlewares } from './orders/middlewares';` 를 더하고 배열의 `...adminPaymentRoutesMiddlewares,` 앞에 `...adminOrderRoutesMiddlewares,` 를 둔다(인증 미들웨어 뒤 — `req.auth_context` 가 채워진 뒤 돈다).

- [ ] **Step 5: 단위 통과**

Run: `cd apps/medusa && npm run test:unit`
Expected: PASS

- [ ] **Step 6: 통합 — 깨지는 두 스펙 고치기 + 미들웨어 통합 케이스**

`channel-cancel-settlement.spec.ts` 353~370행 describe 를 다음으로 바꾼다(특성은 같은 워크플로를 직접 불러 지킨다 — 라우트는 이제 미들웨어가 막는다). 파일 상단 import 에 `cancelOrderWorkflow` 를 더한다(`refundPaymentWorkflow` 와 같은 `@medusajs/medusa/core-flows`).

```ts
    describe('특성: 기본 취소 워크플로 (Medusa 2.13.4 — 업그레이드로 바뀌면 스펙 §6.1 순서·§6.6 미들웨어를 재검토)', () => {
      it('wallet 영구 거절에도 canceled + Refund 0 + 환불 거래 −X(유령) — 장부 차액은 +X 로 뒤집힌다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
        await cancelOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect((await ledger(orderId)).refunds).toEqual([]);
        expect(wallet.refunds).toHaveLength(0);
        expect(wallet.refundCalls()).toHaveLength(1);
        const txs = await getContainer().resolve(Modules.ORDER).listOrderTransactions({ order_id: orderId });
        const refundTx = txs.filter((t: any) => t.reference === 'refund').reduce((s: number, t: any) => s + num(t.amount), 0);
        expect(refundTx).toBe(-captured);
        expect(num(o.summary.pending_difference)).toBe(captured);
      });
    });

    describe('미들웨어 §6.6 — 대시보드 함정', () => {
      it('결제가 있는 주문의 기본 /cancel 은 400 — 주문·wallet 그대로', async () => {
        const { orderId } = await place();
        const res = await api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('default_cancel_blocked');
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refundCalls()).toHaveLength(0);
      });

      it('정산 라우트(channel-cancel)는 지나간다', async () => {
        const { orderId } = await place();
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect((await order(orderId)).status).toBe('canceled');
      });

      it('취소된 주문의 기본 환불은 400 — wallet 을 부르지 않는다', async () => {
        const { orderId } = await place();
        await channelCancel(orderId);
        const { paymentId } = await ledger(orderId);
        const before = wallet.refundCalls().length;
        const res = await api.post(`/admin/payments/${paymentId}/refund`, { amount: 1000 }, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(400);
        expect(res.data.code).toBe('refund_on_canceled_order');
        expect(wallet.refundCalls()).toHaveLength(before);
      });

      it('살아 있는 주문의 기본 환불은 그대로 된다', async () => {
        const { orderId } = await place();
        const { paymentId } = await ledger(orderId);
        const res = await api.post(`/admin/payments/${paymentId}/refund`, { amount: 1000 }, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(200);
      });
    });
```

(`wallet.refundCalls()` 가 `/refund` 호출을 세는 FakeWallet 메서드다 — `fixtures/partial-cancel-fixture.ts` 에서 이름을 확인한다.)

`wallet-refund-projection.spec.ts` 54~62행의 `await api.post(\`/admin/orders/${orderId}/cancel\`, {}, c.adminHeaders);` 를 `await cancelOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });` 로 바꾸고 `import { cancelOrderWorkflow } from '@medusajs/medusa/core-flows';` 를 더한다. 테스트 이름은 «코어 취소 워크플로는 …» 로.

- [ ] **Step 7: 통합 실행 (postgres·redis 둘 다)**

Run: `scripts/local/run-medusa-integration.sh`
Expected: 전부 PASS. 특히 «멱등 — 리컨실러 재발행의 전제»(Review Focus 2)와 `partial-cancel-settlement.spec.ts` 가 초록.

- [ ] **Step 8: Commit**

```bash
git add apps/medusa/src/api/admin apps/medusa/integration-tests/http
git commit -m "feat(medusa): 대시보드 기본 취소·취소된 주문 환불을 미들웨어로 막는다 (#1016 36번 PR 6, 스펙 §6.6)"
```

---

### Task 9: 스토어프론트 — 다시 읽기 삭제 + Medusa 직접 읽기 넷

**Files:**
- Delete: `web/almondyoung-storefront/src/lib/orders/cancel-outcome.ts`, `cancel-outcome.test.ts`
- Create: `web/almondyoung-storefront/src/lib/orders/core-order-view.ts`, `core-order-view.test.ts`
- Modify: `src/components/orders/order-card/order-actions.tsx:26,31,114-117,155-187`
- Modify: `src/domains/order/details/components/order-details-desktop.tsx:33-37,119-125,173-175,184-216`
- Modify: `src/domains/order/details/components/order-details-mobile.tsx:37-41,146-152,180-182,191-223`
- Modify: `src/domains/mypage/template/main/wrappers/{mypage-order-status.ts,shipping-status-wrapper.tsx,shipping-items-wrapper.tsx}`
- Modify: `src/lib/api/orders/store-orders.ts:101-105`
- Modify: `src/i18n/messages/{ko,en,ja}/mypage.json:587,589,590`

(경로는 `web/almondyoung-storefront/` 기준.)

**Interfaces:**
- Produces: `isCancelledByCore(actions)`, `paymentStatusForDisplay(medusaPaymentStatus, actions)`, `canConfirmPurchase(input)`, `showTrackLink(input)`, `resolveMypageCoreView(order, fallbackLabel): Promise<{ statusLabel: string; cancelledByCore: boolean }>`.

- [ ] **Step 1: 기준선**

Run: `cd web/almondyoung-storefront && npx vitest run 2>&1 | tail -6; npx tsc --noEmit 2>&1 | grep -c "error TS"`
적어 둔다(PR 4: vitest 2 실패 `locale-parity`, tsc 46).

- [ ] **Step 2: 실패하는 테스트**

`src/lib/orders/core-order-view.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import { canConfirmPurchase, isCancelledByCore, paymentStatusForDisplay, showTrackLink } from "./core-order-view"

function actions(over: Partial<StoreOrderActionsResponse> = {}): StoreOrderActionsResponse {
  return {
    orderId: "so-1",
    channelOrderId: "order_1",
    orderStatus: "confirmed",
    fulfillmentStatus: "created",
    refundStatus: "none",
    claimStatus: "none",
    availableActions: [],
    ...over,
  }
}

describe("isCancelledByCore — core 는 요청 순간 취소를 확정한다(#1016 36번 재설계)", () => {
  it("cancelled 만 참, actions 가 없으면 거짓", () => {
    expect(isCancelledByCore(actions({ orderStatus: "cancelled" }))).toBe(true)
    expect(isCancelledByCore(actions())).toBe(false)
    expect(isCancelledByCore(null)).toBe(false)
    expect(isCancelledByCore(undefined)).toBe(false)
  })
})

describe("paymentStatusForDisplay — «결제 상태» 줄", () => {
  it("actions 가 없으면 Medusa 값 그대로", () => {
    expect(paymentStatusForDisplay("captured", undefined)).toBe("captured")
  })
  it("core 가 취소 안 했으면 Medusa 값 그대로", () => {
    expect(paymentStatusForDisplay("captured", actions())).toBe("captured")
  })
  it("core 취소 + 환불 완료 → refunded", () => {
    expect(paymentStatusForDisplay("captured", actions({ orderStatus: "cancelled", refundStatus: "succeeded" }))).toBe("refunded")
  })
  it.each(["pending", "delayed", "transfer_pending", "none"])("core 취소 + 환불 %s → canceled", (refundStatus) => {
    expect(paymentStatusForDisplay("captured", actions({ orderStatus: "cancelled", refundStatus }))).toBe("canceled")
  })
  it("refundSummary.status 가 refundStatus 보다 앞선다(상세와 같은 규칙)", () => {
    expect(
      paymentStatusForDisplay(
        "captured",
        actions({
          orderStatus: "cancelled",
          refundStatus: "pending",
          refundSummary: { status: "succeeded", amount: 1000, currency: "KRW", paymentMethodLabel: null, manualRequired: false, expectedProcessingMessage: null, lastUpdatedAt: null },
        })
      )
    ).toBe("refunded")
  })
})

describe("canConfirmPurchase — «구매확정» 버튼", () => {
  const base = { paymentStatus: "authorized", isConfirmed: false, awaitingDeposit: false }
  it("지금 조건 그대로 + actions 없음", () => {
    expect(canConfirmPurchase({ ...base, actions: undefined })).toBe(true)
    expect(canConfirmPurchase({ ...base, paymentStatus: "captured", actions: undefined })).toBe(false)
    expect(canConfirmPurchase({ ...base, isConfirmed: true, actions: undefined })).toBe(false)
    expect(canConfirmPurchase({ ...base, awaitingDeposit: true, actions: undefined })).toBe(false)
  })
  it("core 취소면 숨긴다", () => {
    expect(canConfirmPurchase({ ...base, actions: actions({ orderStatus: "cancelled" }) })).toBe(false)
  })
})

describe("showTrackLink — «배송 조회»", () => {
  it("배송이 필요 없으면 숨김", () => {
    expect(showTrackLink({ requiresShipping: false, canTrack: true, medusaFulfillmentStatus: "shipped", actions: undefined })).toBe(false)
  })
  it("core 가 track 을 주면 보인다", () => {
    expect(showTrackLink({ requiresShipping: true, canTrack: true, medusaFulfillmentStatus: "not_fulfilled", actions: actions() })).toBe(true)
  })
  it.each(["shipped", "fulfilled", "partially_fulfilled"])("actions 가 없으면 Medusa %s 로 보인다(지금과 같다)", (s) => {
    expect(showTrackLink({ requiresShipping: true, canTrack: false, medusaFulfillmentStatus: s, actions: undefined })).toBe(true)
  })
  it("core 취소면 Medusa 이행만으로는 보이지 않는다", () => {
    expect(
      showTrackLink({ requiresShipping: true, canTrack: false, medusaFulfillmentStatus: "shipped", actions: actions({ orderStatus: "cancelled" }) })
    ).toBe(false)
  })
})
```

(`StoreRefundStatusWire` 가 열린 문자열이라 `refundStatus` 에 임의 값이 들어간다. `RefundSummary` 의 필수 칸은 `store-orders.ts:82-90` 과 맞춘다.)

- [ ] **Step 3: 실패 확인**

Run: `cd web/almondyoung-storefront && npx vitest run src/lib/orders/core-order-view.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현 — 순수 모듈**

`src/lib/orders/core-order-view.ts`:

```ts
import type { StoreOrderActionsResponse } from "@/lib/api/orders/store-orders"
import { resolveRefundStatus } from "./refund-status"

type CoreActions = StoreOrderActionsResponse | null | undefined

/**
 * core 가 취소를 확정했다(#1016 36번 재설계 — 요청 순간 확정). Medusa 는 환불 정산이 끝나야 canceled 가 되므로
 * 그 사이 Medusa 필드를 그대로 비추면 «취소 완료»와 어긋난다. core 데이터가 없으면 거짓 — 지금 동작을 지킨다.
 */
export function isCancelledByCore(actions: Pick<StoreOrderActionsResponse, "orderStatus"> | null | undefined): boolean {
  return actions?.orderStatus === "cancelled"
}

/** «결제 상태» 줄에 넣을 결제 상태 값(`getPaymentStatusI18nKey` 의 입력). core 취소면 환불 완료는 refunded, 아니면 canceled */
export function paymentStatusForDisplay(medusaPaymentStatus: string, actions: CoreActions): string {
  if (!isCancelledByCore(actions)) return medusaPaymentStatus
  return resolveRefundStatus(actions ?? undefined) === "succeeded" ? "refunded" : "canceled"
}

/** «구매확정» — 결제 승인 상태의 무통장 입금 완료 주문만. core 취소 주문은 숨긴다(사용자 확인 2026-10-12: 중요하지 않다, 최소 변경) */
export function canConfirmPurchase(input: {
  paymentStatus: string
  isConfirmed: boolean
  awaitingDeposit: boolean
  actions: CoreActions
}): boolean {
  return input.paymentStatus === "authorized" && !input.isConfirmed && !input.awaitingDeposit && !isCancelledByCore(input.actions)
}

const MEDUSA_SHIPPED = new Set(["shipped", "fulfilled", "partially_fulfilled"])

/** «배송 조회» — core 가 track 을 주거나, core 취소가 아니고 Medusa 이행이 나간 상태 */
export function showTrackLink(input: {
  requiresShipping: boolean
  canTrack: boolean
  medusaFulfillmentStatus: string | null | undefined
  actions: CoreActions
}): boolean {
  if (!input.requiresShipping) return false
  if (input.canTrack) return true
  return !isCancelledByCore(input.actions) && MEDUSA_SHIPPED.has(input.medusaFulfillmentStatus ?? "")
}
```

(`resolveRefundStatus` 의 매개변수 타입을 `refund-status.ts:39-43` 에서 확인하고 `actions ?? undefined` 를 그 타입에 맞춘다.)

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/orders/core-order-view.test.ts`
Expected: PASS

- [ ] **Step 6: 다시 읽기 삭제 + 화면 연결**

```bash
git rm src/lib/orders/cancel-outcome.ts src/lib/orders/cancel-outcome.test.ts
```

`order-details-desktop.tsx`:
- 37행 `cancel-outcome` import 를 지우고, 33~36행 import 에서 `getOrderActionsByMedusaId` 를 지운다(204행에서만 쓰였다). `import { paymentStatusForDisplay, showTrackLink } from "@/lib/orders/core-order-view"` 를 더한다.
- 120~125행 `showTrack` 을:

```tsx
  // 배송조회는 배송이 필요한 주문에서만(디지털 단독 주문은 숨김). core 가 취소를 확정한 주문은 Medusa 이행만으로 띄우지 않는다
  const showTrack = showTrackLink({
    requiresShipping,
    canTrack,
    medusaFulfillmentStatus: order.fulfillment_status,
    actions: coreActions,
  })
```

- 173~175행:

```tsx
  const paymentStatusLabel = tPaymentStatus(
    getPaymentStatusI18nKey(paymentStatusForDisplay(order.payment_status ?? "", coreActions))
  )
```

- 198~209행(`setShowCancelDialog(false)` 다음부터 `router.refresh()` 까지)을:

```tsx
        setShowCancelDialog(false)
        // 취소는 요청 순간 확정된다(#1016 36번 재설계 §8.2) — 응답이 곧 «취소 완료»다. 환불은 환불 배지가 말한다
        toast.success(tActions("cancelCompleted"))
        router.refresh()
```

`order-details-mobile.tsx`: 같은 네 가지(41행·37~40행 import, 146~152행 `showTrack`, 180~182행, 205~216행)를 같은 코드로.

`order-actions.tsx`:
- 31행 `cancel-outcome` import 와 26행 `getOrderActionsByMedusaId` import 를 지운다. `import { useTranslations } from "next-intl"` 과 `import { canConfirmPurchase } from "@/lib/orders/core-order-view"` 를 더한다.
- 컴포넌트 본문 첫머리에 `const tActions = useTranslations("mypage.order.actions")` 를 둔다.
- 114~117행:

```tsx
  const canConfirm = canConfirmPurchase({
    paymentStatus,
    isConfirmed,
    awaitingDeposit: isBankTransferAwaitingDeposit,
    actions: coreActions,
  })
```

  그리고 이 파일에서 `canConfirmPurchase` 라는 지역 상수를 쓰던 곳(191·262행)을 `canConfirm` 으로 바꾼다.
- 169~180행을:

```tsx
        setShowCancelDialog(false)
        // 취소는 요청 순간 확정된다(#1016 36번 재설계 §8.2) — 응답이 곧 «취소 완료»다
        toast.success(tActions("cancelCompleted"))
        router.refresh()
```

  184행 `toast.error("취소 처리 중 오류가 발생했습니다.")` → `toast.error(tActions("cancelError"))`.

`store-orders.ts` 101~105행의 `cancelRequestStatus` 속성과 그 주석을 지운다.

`mypage-order-status.ts` 의 `resolveMypageDisplayLabel` 을:

```ts
/**
 * 마이페이지 홈에서 표시할 주문의 실제 상태 라벨과 core 취소 여부를 계산한다.
 * 주문내역(order-list)과 동일하게 Core(WMS) projection 기반 getCoreDisplayStatus 를 우선 사용하고,
 * Core 조회 실패/타임아웃 시 Medusa 기반 fallback 라벨을 사용한다.
 * core 가 취소를 확정한 주문은 Medusa 가 아직 canceled 가 아니어도 홈 카드에서 뺀다(#1016 36번 PR 6).
 */
export async function resolveMypageCoreView(
  order: HttpTypes.StoreOrder,
  fallbackLabel: string
): Promise<{ statusLabel: string; cancelledByCore: boolean }> {
  const actions = await withMypageTimeout<StoreOrderActionsResponse | null>(
    getOrderActionsByMedusaId(order.id),
    null,
    3000
  )
  return actions
    ? { statusLabel: getCoreDisplayStatus(actions), cancelledByCore: isCancelledByCore(actions) }
    : { statusLabel: fallbackLabel, cancelledByCore: false }
}
```

(`import { isCancelledByCore } from "@/lib/orders/core-order-view"` 를 더한다.)

`shipping-status-wrapper.tsx`: import 를 `resolveMypageCoreView` 로 바꾸고, `Promise.all` 의 콜백을:

```tsx
    candidates.map(async ({ order, shippingStatus }: any) => {
      const { statusLabel, cancelledByCore } = await resolveMypageCoreView(order, shippingStatus.statusLabel)
      if (cancelledByCore) return null
```

  로 시작하게 하고(나머지 반환은 그대로), 결과를:

```tsx
  const orderList: OrderItem[] = (await Promise.all(/* 위 */)).filter((o): o is OrderItem => o !== null)
```

`shipping-items-wrapper.tsx`: 같은 방식(`ShippingOrder` 로).

i18n: `src/i18n/messages/{ko,en,ja}/mypage.json` 세 파일에서 `"cancelRequested"`·`"cancelRejected"`·`"cancelStillProcessing"` 세 줄을 지운다(587·589·590행 — 앞뒤 쉼표가 맞는지 본다). `cancelCompleted`·`cancelError` 는 남긴다.

- [ ] **Step 7: 남은 참조 + 게이트**

```bash
cd web/almondyoung-storefront
grep -rn "waitForCancelOutcome\|cancelOutcomeOf\|cancel-outcome\|cancelRequested\|cancelRejected\|cancelStillProcessing\|cancelRequestStatus\|resolveMypageDisplayLabel" src
npx vitest run 2>&1 | tail -6
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

Expected: grep 0 줄. vitest 실패 수가 기준선을 넘지 않는다(`locale-parity` 가 새로 빨개지면 세 언어 키가 어긋난 것). tsc 수가 기준선을 넘지 않는다.

- [ ] **Step 8: Commit**

```bash
git add -A web/almondyoung-storefront/src
git checkout -- web/almondyoung-storefront/yarn.lock 2>/dev/null || true
git commit -m "feat(storefront): 취소 다시 읽기 삭제·core 취소 주문의 Medusa 직접 읽기 넷 (#1016 36번 PR 6)"
```

---

### Task 10: wallet 송금 대기 — 목록 `manualConfirmable` · «환불 내역» [완료 처리] · 토스트 · `RefundDto`

**Files:**
- Modify: `apps/wallet/src/admin/payment-intent-admin.service.ts:207-248,352-392`
- Create: `apps/wallet/src/admin/payment-intent-admin.list-refunds.integration.spec.ts`
- Modify: `apps/wallet/src/refunds/dto/index.ts:136-139`, `apps/wallet/src/refunds/refund-response.ts:4`(주석)
- Modify: `apps/admin-web/src/lib/types/dto/wallet.ts:89-102`
- Modify: `apps/admin-web/src/lib/api/domains/wallet/refund-execution.ts`, `refund-execution.spec.ts`
- Modify: `apps/admin-web/src/lib/services/wallet/mutations.ts`(새 `useConfirmRefund`)
- Create: `apps/admin-web/src/features/payments/components/refund-table/confirm-cell.tsx`
- Modify: `apps/admin-web/src/hooks/table/columns/use-refund-table-columns.tsx`
- Modify: `apps/admin-web/src/app/(admin)/payments/[id]/payment-detail-main.tsx:318-345`, `payment-detail-sidebar.tsx:159-162`
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts:79-80`, `cancel-request.shape.spec.ts:203-205`, `apps/admin-web/src/features/order/cancel-settlement/settlement-actions.tsx:66`, `apps/admin-web/src/features/order/history/components/table/index.tsx:870`(주석)

**Interfaces:**
- Produces(wallet): 관리자 환불 목록 응답의 `manualConfirmable` 이 상세와 같은 `isManuallyConfirmable` 로 계산된다.
- Produces(admin-web): `RefundDto.failureCode?: string | null`, `RefundDto.retryable?: boolean | null`, `pendingRefundToast(isBankTransfer: boolean): string`, `refundFailureLabel(r: Pick<RefundDto, 'status' | 'failureCode' | 'retryable'>): string`, `useConfirmRefund()`, `RefundConfirmCell`, `MANUAL_REFUND_CONFIRM_TEXT` 새 문구.

- [ ] **Step 1: 실패하는 통합 테스트 — wallet 목록**

`apps/wallet/src/admin/payment-intent-admin.list-refunds.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { charges, paymentIntents, paymentMethods, refunds, walletSchema, WalletSchema } from '../schema';
import { PaymentIntentAdminService } from './payment-intent-admin.service';

/**
 * 관리자 환불 «목록»의 manualConfirmable 이 상세와 같은 규칙(isManuallyConfirmable)인가 — 목록에 [완료 처리]를 두는 근거(#1016 36번 PR 6).
 * 실행: DATABASE_URL=<wallet 마이그 적용된 스크래치 DB> REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/admin/payment-intent-admin.list-refunds.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('PaymentIntentAdminService.listRefunds — manualConfirmable (실 Postgres)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<WalletSchema>>;
  let service: PaymentIntentAdminService;

  const methodTossId = randomUUID();
  const methodBankId = randomUUID();
  const intentId = randomUUID();
  const chargeTossId = randomUUID();
  const chargeBankId = randomUUID();
  const refundIds = { manualToss: randomUUID(), autoToss: randomUUID(), autoBank: randomUUID(), doneManual: randomUUID() };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: walletSchema });
    service = new PaymentIntentAdminService({ db } as unknown as DbService<WalletSchema>, {} as never);
    await db.insert(paymentMethods).values([
      { id: methodTossId, userId: 'itest-user', type: 'TOSS' },
      { id: methodBankId, userId: 'itest-user', type: 'BANK_TRANSFER' },
    ]);
    await db.insert(paymentIntents).values({
      id: intentId,
      payableAmount: 30_000,
      currency: 'KRW',
      status: 'SUCCEEDED' as const,
      clientSecret: `itest-${intentId.slice(0, 20)}`,
      expiresAt: new Date('2031-04-01T00:00:00+09:00'),
    });
    await db.insert(charges).values([
      { id: chargeTossId, intentId, paymentMethodId: methodTossId, amount: 20_000, currency: 'KRW', operation: 'CAPTURE', status: 'SUCCEEDED', providerIdempotencyKey: `itest-${chargeTossId}` },
      { id: chargeBankId, intentId, paymentMethodId: methodBankId, amount: 10_000, currency: 'KRW', operation: 'CAPTURE', status: 'SUCCEEDED', providerIdempotencyKey: `itest-${chargeBankId}` },
    ]);
    await db.insert(refunds).values([
      { id: refundIds.manualToss, chargeId: chargeTossId, intentId, amount: 5_000, currency: 'KRW', status: 'PENDING', execution: 'MANUAL' },
      { id: refundIds.autoToss, chargeId: chargeTossId, intentId, amount: 5_000, currency: 'KRW', status: 'PENDING', execution: 'AUTO' },
      { id: refundIds.autoBank, chargeId: chargeBankId, intentId, amount: 5_000, currency: 'KRW', status: 'PENDING', execution: 'AUTO' },
      { id: refundIds.doneManual, chargeId: chargeTossId, intentId, amount: 5_000, currency: 'KRW', status: 'SUCCEEDED', execution: 'MANUAL' },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(refunds).where(inArray(refunds.id, Object.values(refundIds)));
      await db.delete(charges).where(inArray(charges.id, [chargeTossId, chargeBankId]));
      await db.delete(paymentIntents).where(inArray(paymentIntents.id, [intentId]));
      await db.delete(paymentMethods).where(inArray(paymentMethods.id, [methodTossId, methodBankId]));
    }
    await sql?.end();
  });

  it('목록과 상세가 같은 규칙 — MANUAL PENDING·무통장 PENDING 만 true, 카드 AUTO PENDING·끝난 행은 false', async () => {
    const list = await service.listRefunds({ intentId, page: 1, limit: 20 } as never);
    const byId = new Map(list.data.map((r) => [r.id, r.manualConfirmable]));
    expect(byId.get(refundIds.manualToss)).toBe(true);
    expect(byId.get(refundIds.autoBank)).toBe(true);
    expect(byId.get(refundIds.autoToss)).toBe(false);
    expect(byId.get(refundIds.doneManual)).toBe(false);
    expect(list.total).toBe(4);
  });
});
```

(`paymentIntents`·`charges`·`refunds` 의 필수 칸은 `statistics-admin.integration.spec.ts` 의 시드와 같다 — 스키마가 더 요구하면 그 파일을 따라 채운다. `listRefunds` 의 쿼리 DTO 가 클래스라 `as never` 로 넘긴다 — 테스트 경계에서만.)

- [ ] **Step 2: 실패 확인**

Run: `DATABASE_URL=<wallet 스크래치 DB> REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/admin/payment-intent-admin.list-refunds.integration.spec.ts`
Expected: FAIL (`manualToss`·`autoBank` 가 `false`)

- [ ] **Step 3: 구현 — wallet**

`payment-intent-admin.service.ts`: 상세(207~248행)의 select·매핑을 두 곳이 같이 쓰게 뽑는다. 클래스 안 사적 메서드 둘:

```ts
  /** 관리자 환불 조회(목록·결제 상세)의 열 — charge → payment_method 조인으로 결제수단을 알아 manualConfirmable 을 정한다 */
  private refundRowsQuery(db: DbService<WalletSchema>['db']) {
    return db
      .select({
        id: refunds.id,
        chargeId: refunds.chargeId,
        intentId: refunds.intentId,
        status: refunds.status,
        amount: refunds.amount,
        currency: refunds.currency,
        reasonCode: refunds.reasonCode,
        reasonMessage: refunds.reasonMessage,
        createdAt: refunds.createdAt,
        execution: refunds.execution,
        failureCode: refunds.failureCode,
        failureRetryable: refunds.failureRetryable,
        paymentMethodType: paymentMethods.type,
      })
      .from(refunds)
      .leftJoin(charges, eq(refunds.chargeId, charges.id))
      .leftJoin(paymentMethods, eq(charges.paymentMethodId, paymentMethods.id))
      .$dynamic();
  }

  private toAdminRefund(r: Awaited<ReturnType<ReturnType<PaymentIntentAdminService['refundRowsQuery']>['execute']>>[number]): RefundResponseDto {
    return {
      id: r.id,
      chargeId: r.chargeId,
      intentId: r.intentId,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
      reasonCode: r.reasonCode ?? null,
      reasonMessage: r.reasonMessage ?? null,
      createdAt: r.createdAt,
      manualConfirmable: isManuallyConfirmable({ status: r.status, execution: r.execution, methodType: r.paymentMethodType ?? null }),
      execution: r.execution,
      failureCode: r.failureCode ?? null,
      retryable: r.failureRetryable ?? null,
    };
  }
```

  (`toAdminRefund` 의 매개변수 타입이 길면 select 객체를 모듈 상수 `ADMIN_REFUND_COLUMNS` 로 빼고 `type AdminRefundRow = { [K in keyof typeof ADMIN_REFUND_COLUMNS]: (typeof ADMIN_REFUND_COLUMNS)[K]['_']['data'] }` 대신 **drizzle 추론에 맡기는 쪽**으로 — 어느 쪽이든 `as`·`any` 없이. 가장 단순한 방법은 상세의 `refundRows.map(...)` 콜백을 그대로 함수로 옮기고 매개변수 타입을 `(typeof refundRows)[number]` 꼴로 상세에서 한 번 이름 붙이는 것이다 — 구현자가 type-check 로 고른다.)

  상세(207~248행)는 `const refundRows = await this.refundRowsQuery(db).where(eq(refunds.intentId, id)).orderBy(asc(refunds.createdAt));` 와 `refundRows.map((r) => this.toAdminRefund(r))` 로. 목록(367~389행)은:

```ts
    const rows = await this.refundRowsQuery(db)
      .where(and(...conditions))
      .orderBy(desc(refunds.createdAt))
      .limit(limit)
      .offset(offset);

    const data: RefundResponseDto[] = rows.map((r) => this.toAdminRefund(r));
```

  (count 쿼리는 조인 없이 그대로 — 조인은 행 수를 바꾸지 않는다: 환불 → charge 는 다대일, charge → payment_method 도 다대일.)

`refunds/dto/index.ts:136-139` 설명을 `'수동 완료 처리 가능 여부 (무통장 PENDING 또는 수동 실행(MANUAL) PENDING 행 — 관리자 목록·상세가 isManuallyConfirmable 로 계산)'` 로. `refund-response.ts:4` 주석을 `manualConfirmable 은 결제수단을 아는 호출자(관리자 목록·상세)만 정한다` 로.

- [ ] **Step 4: 통과 + wallet 게이트**

Run:
```bash
DATABASE_URL=<wallet 스크래치 DB> REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/admin
npx jest apps/wallet
npm run type-check
```
Expected: PASS · PASS · 0

- [ ] **Step 5: 실패하는 테스트 — admin-web 순수함수**

`refund-execution.spec.ts` 에 더한다:

```ts
import { pendingRefundToast, refundExecutionLabel, refundFailureLabel } from './refund-execution';

describe('pendingRefundToast — 결제 상세 사이드바의 PENDING 환불 안내', () => {
  it('무통장은 송금 뒤 «환불 내역»에서 [완료 처리] — 그 버튼이 이제 있다(PR 6)', () => {
    expect(pendingRefundToast(true)).toBe('환불 대기 중: 무통장 입금 환불은 수동 송금이 필요합니다. 송금 뒤 환불 내역에서 [완료 처리]를 눌러 주세요.');
  });
  it('카드 등은 PG 처리 중 — 사람이 닫을 행이 아니다', () => {
    expect(pendingRefundToast(false)).toBe('환불 접수됨: PG 처리 결과를 기다리고 있습니다.');
  });
});

describe('refundFailureLabel — «환불 내역» 실패 사유', () => {
  it('FAILED 만 보인다 — 정상 상태는 숨긴다', () => {
    expect(refundFailureLabel({ status: 'SUCCEEDED', failureCode: null, retryable: null })).toBe('');
    expect(refundFailureLabel({ status: 'PENDING', failureCode: 'X', retryable: false })).toBe('');
  });
  it('영구 거절은 «다시 시도 불가», 일시·분류 전은 코드만', () => {
    expect(refundFailureLabel({ status: 'FAILED', failureCode: 'REFUND_REJECTED', retryable: false })).toBe('REFUND_REJECTED · 다시 시도 불가');
    expect(refundFailureLabel({ status: 'FAILED', failureCode: 'PROVIDER_ERROR', retryable: true })).toBe('PROVIDER_ERROR');
    expect(refundFailureLabel({ status: 'FAILED', failureCode: null, retryable: null })).toBe('');
  });
});
```

(기존 `import { refundExecutionLabel } from './refund-execution';` 줄을 위 import 로 바꾼다.)

`cancel-request.shape.spec.ts:203-205`:

```ts
  it('계좌 송금 확인 문구는 실제 화면 이름을 쓴다(D7, PR 6 — 환불 내역에 [완료 처리]가 생겼다)', () => {
    expect(MANUAL_REFUND_CONFIRM_TEXT).toBe('고객에게 계좌를 받아 직접 송금한 뒤, 결제 관리 › 환불 내역에서 [완료 처리]를 눌러 주세요.');
  });
```

- [ ] **Step 6: 실패 확인**

Run: `npm run test:admin-web -- apps/admin-web/src/lib/api/domains/wallet apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts`
Expected: FAIL

- [ ] **Step 7: 구현 — admin-web**

`refund-execution.ts`:

```ts
// wallet 환불 행의 실행 방식(#1016 36번 재설계 §6.3). «계좌 송금»은 운영자가 송금 뒤 «환불 내역»의 [완료 처리]를 눌러야 끝난다.
export function refundExecutionLabel(execution: unknown): string {
  return execution === 'MANUAL' ? '계좌 송금' : '';
}

/** 결제 상세 사이드바에서 환불 결과가 PENDING 일 때. 무통장만 사람이 닫는다 — 카드 AUTO PENDING 은 PG 결과를 기다린다 */
export function pendingRefundToast(isBankTransfer: boolean): string {
  return isBankTransfer
    ? '환불 대기 중: 무통장 입금 환불은 수동 송금이 필요합니다. 송금 뒤 환불 내역에서 [완료 처리]를 눌러 주세요.'
    : '환불 접수됨: PG 처리 결과를 기다리고 있습니다.';
}

/** «환불 내역»의 실패 사유 칸. FAILED 가 아니면 빈 칸(정상 상태는 숨긴다) */
export function refundFailureLabel(r: { status: string; failureCode?: string | null; retryable?: boolean | null }): string {
  if (r.status !== 'FAILED' || !r.failureCode) return '';
  return r.retryable === false ? `${r.failureCode} · 다시 시도 불가` : r.failureCode;
}
```

`types/dto/wallet.ts` `RefundDto` 의 `execution?` 아래에:

```ts
  /** FAILED 일 때 실패 코드(토스 오류 코드 등). 그 밖엔 null */
  failureCode?: string | null;
  /** FAILED 일 때만: 같은 환불을 다시 시도하면 될 수 있는가. null 은 분류 전 옛 행 */
  retryable?: boolean | null;
```

`lib/services/wallet/mutations.ts` 에 (상세의 인라인 mutation 을 옮긴다):

```ts
/** 수동 환불 [완료 처리] — 무통장·수동 실행(MANUAL) 송금 대기 PENDING → SUCCEEDED */
export const useConfirmRefund = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ refundId }: { refundId: string; intentId: string }) => walletApi.confirmRefund(refundId),
    onSuccess: (_data, { intentId }) => {
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.intentDetail(intentId) });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.stateTransitions(intentId) });
      queryClient.invalidateQueries({ queryKey: walletQueryKeys.refunds() });
    },
  });
};
```

(`walletApi`·`walletQueryKeys` import 는 이 파일의 다른 훅과 같다. `lib/services/wallet/index.ts` 가 재수출 목록을 들고 있으면 거기에도 더한다.)

`payment-detail-main.tsx` `RefundConfirmButton`(318~345행)의 `useQueryClient`·인라인 `useMutation` 을:

```tsx
  const confirm = useConfirmRefund();
  const mutation = {
    isPending: confirm.isPending,
    mutate: () =>
      confirm.mutate(
        { refundId, intentId },
        {
          onSuccess: () => {
            toast.success('환불 완료 처리되었습니다.');
            setOpen(false);
          },
          onError: (e) => toast.error(e instanceof Error ? e.message : '완료 처리 중 오류가 발생했습니다.'),
        },
      ),
  };
```

로 바꾼다(아래 JSX 의 `mutation.isPending`·`mutation.mutate()` 는 그대로 동작한다). 쓰지 않게 된 import(`useMutation`·`useQueryClient`·`walletQueryKeys`·`walletApi`)를 tsc 로 정리한다.

`features/payments/components/refund-table/confirm-cell.tsx`(새, `bank-transfer-table/confirm-cell.tsx` 의 모양):

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useConfirmRefund } from '@/lib/services/wallet/mutations';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { RefundDto } from '@/lib/types/dto/wallet';

/**
 * «환불 내역»의 [완료 처리] — 계좌 송금 대기(무통장·수동 실행) 행만(서버가 manualConfirmable 로 정한다, #1016 36번 PR 6).
 * 행마다 독립된 mutation. 되돌릴 수 없으므로 확인을 한 번 거친다.
 */
export function RefundConfirmCell({ refund }: { refund: RefundDto }) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirmRefund();
  const amount = `${refund.amount.toLocaleString('ko-KR')} ${refund.currency}`;

  const handleConfirm = () =>
    confirm.mutate(
      { refundId: refund.id, intentId: refund.intentId },
      {
        onSuccess: () => {
          toast.success('환불 완료 처리되었습니다.');
          setOpen(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : '완료 처리 중 오류가 발생했습니다.'),
      },
    );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={confirm.isPending} onClick={(e) => e.stopPropagation()}>
          완료 처리
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>수동 환불 완료 처리</AlertDialogTitle>
          <AlertDialogDescription>
            환불 금액 <span className="font-semibold text-foreground">{amount}</span> 을 실제로 고객 계좌에 송금했습니까? 실제 송금이 끝난
            경우에만 처리하세요. 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirm.isPending}>취소</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirm.isPending}
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
          >
            {confirm.isPending ? '처리 중...' : '송금 완료 확인'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`use-refund-table-columns.tsx`: import 에 `refundFailureLabel` 과 `RefundConfirmCell` 을 더하고, `reasonCode` 열 뒤에 둘을 더한다:

```tsx
      columnHelper.display({
        id: 'failure',
        header: '실패 사유',
        cell: ({ row }) => <span className="text-sm">{refundFailureLabel(row.original)}</span>,
      }),
```

  그리고 `createdAt` 열 뒤에:

```tsx
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (row.original.manualConfirmable ? <RefundConfirmCell refund={row.original} /> : null),
      }),
```

`payment-detail-sidebar.tsx:159-162`:

```tsx
      if (result.status === 'PENDING') {
        toast.info(pendingRefundToast(isBankTransfer));
        resetRefundForm();
        return;
      }
```

(`import { pendingRefundToast } from '@/lib/api/domains/wallet/refund-execution';`)

`cancel-request.shape.ts:79-80`:

```ts
export const MANUAL_REFUND_CONFIRM_TEXT =
  '고객에게 계좌를 받아 직접 송금한 뒤, 결제 관리 › 환불 내역에서 [완료 처리]를 눌러 주세요.';
```

`settlement-actions.tsx:66` 토스트를 `'계좌 송금으로 바꿨습니다. 송금 뒤 환불 내역에서 완료 처리해 주세요.'` 로. `history/components/table/index.tsx:870` 주석의 «결제 상세에 있다(D7)» 를 «환불 내역·결제 상세에 있다(D7, PR 6)» 로.

- [ ] **Step 8: 게이트**

Run:
```bash
npm run test:admin-web
(cd apps/admin-web && npx tsc --noEmit)
```
Expected: PASS · 0

- [ ] **Step 9: Commit**

```bash
git add apps/wallet/src apps/admin-web/src
git commit -m "feat(wallet,admin-web): 환불 내역에 송금 대기 [완료 처리]·실패 사유, 사이드바 안내 정정 (#1016 36번 PR 6)"
```

---

### Task 11: 문서·전체 게이트·로컬 스모크·PR

**Files:**
- Modify: `docs/adr/0044-*.md`(있으면 «결과» 절에 PR 6 한 줄 — 실행 모드·미들웨어·옛 흐름 제거) — 파일명은 `ls docs/adr | grep 0044` 로
- Modify: `apps/core/CLAUDE.md` 또는 해당 모듈 README 에 옛 흐름 언급이 있으면(`grep -rn "요청 접기\|다시 보내기\|cancel-request-hold" apps/*/CLAUDE.md docs/*.md`) 고친다

- [ ] **Step 1: 전체 게이트**

```bash
npm run type-check
npx jest
npm run audit:event-handlers 2>&1 | tail -5
npm run audit:event-publishers 2>&1 | tail -5
npm run audit:consume-validation -- --gate 2>&1 | tail -5
npx jest scripts/security
(cd apps/admin-web && npx tsc --noEmit)
npm run test:admin-web
(cd apps/medusa && npm run test:unit)
scripts/local/run-medusa-integration.sh
(cd web/almondyoung-storefront && npx vitest run 2>&1 | tail -6; npx tsc --noEmit 2>&1 | grep -c "error TS")
DATABASE_URL=$CORE_IT npx jest --runInBand apps/core/src/modules/sales-order apps/core/src/modules/fulfillment/order-progress apps/core/src/modules/fulfillment/order-reconcile apps/core/src/modules/fulfillment/waybill
```

Expected: 0 · 실패 0 · 처리기 102·발견 0 · 발견 0 · 위반 0 · PASS · 0 · PASS · PASS · PASS · 기준선 이하 · PASS. 숫자를 PR 본문 «검증»에 적는다. 메인 체크아웃 `git status --short` 가 비어 있는지 본다.

- [ ] **Step 2: Nest DI 부팅 확인(Kafka 없이)**

core·channel-adapter 를 각각 `.env` 로 잠깐 띄워 «can't resolve» 0건과 Kafka `ECONNREFUSED`(예상)만 나오는지 본다 — PR 5 와 같은 확인. 지운 서비스 메서드·생성자 인자가 DI 를 깨지 않았는지가 목적이다.

- [ ] **Step 3: 로컬 스모크 (사용자와 함께 — 브라우저 로그인은 사람)**

`npm run bootstrap:e2e:local` → `npm run start:all:local` → `npm run preflight:e2e:local`. 스토어프론트는 **메인 체크아웃**에서 띄운다(지시문).

| # | 준비 | 동작 | 기대 |
| --- | --- | --- | --- |
| S1 영구 거절 | 결제수단 `type = CMS_BATCH` | 고객 취소 | 즉시 «취소 완료 · 환불 처리 중»(다시 읽기 없이) → 보드 «환불 거절», 출고 대상 아님, Medusa 미취소 |
| S2 수동 환불 | S1 상태 | [계좌 송금으로 환불] → **«환불 내역»의 [완료 처리]** | Medusa 취소, 고객 «계좌 송금 예정» → «환불 완료» |
| S3 장부 맞추기 | wallet `refunds` 에 SUCCEEDED 행 주입 | 운영자 전체취소 | 남은 몫만 환불, 보드에 아무것도 안 뜸 |
| S4 일시 장애(실행 모드) | wallet 을 내림 | 취소 → 40분 뒤 wallet 올림 | «환불 지연» → 리컨실러(#36, act)가 스스로 정산 완료 → `applied`. channel-adapter DLQ 에 아무것도 없음 |
| S5 대시보드 | Medusa 관리자 대시보드 | 결제된 주문 [Cancel], 취소된 주문 [Refund] | 둘 다 400(`default_cancel_blocked`·`refund_on_canceled_order`) |

S4 의 40분은 재시도 시각(1·4·16·64분)에 맞춘다 — 64분 시도 전이면 85분까지 기다린다. 결과를 PR 본문 «로컬 스모크»에 적는다. 사용자가 못 돌리면 «미실행»으로 적고 넘어간다(머지 판단은 사용자).

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/1016-36-settlement-pr6-cleanup
gh pr create --base develop --title "chore: 채널 취소 정산 재설계 PR 6 — 실행 모드·미들웨어·옛 흐름 걷기·송금 대기 (#1016 36번)" --body-file <(cat <<'EOF'
<아래 «PR 본문» 절을 채워 붙인다>
EOF
)
```

PR 본문 절(순서대로): 무엇 / 먼저 판정한 것(판정 1~7 한 줄씩 + 라이브 실측 표) / 스펙과 다른 점(E1~E8) / 혼자 나갔을 때 / 배포(아래 절 그대로) / 검증(Step 1 의 숫자) / 로컬 스모크 / 범위 밖·알려진 한계 / Also found. 끝 줄에 세션 링크.

- [ ] **Step 5: 계획 문서 브랜치에 결과 한 줄**

이 계획 파일(`docs/1016-36-channel-cancel-settlement` 브랜치)의 «Status» 를 «PR #<번호> OPEN» 으로 고쳐 커밋한다(push 는 사용자 판단).

---

## 혼자 나갔을 때 (PR 0~5 라이브 위에)

- 일시 실패는 채널 쪽 Kafka 재시도·DLQ 대신 core 리컨실러 하나가 다시 부른다(1·4·16·64·256분, 5회 뒤 «자동 멈춤 · #36», 1024분 재확인).
- Medusa 가 이미 정산했는데 core 가 몰랐던 전체취소 행이 재수집 스냅샷으로 스스로 닫힌다.
- Medusa 대시보드의 기본 [Cancel]은 돌려줄 돈이 남은 주문에서, [Refund]는 취소된 주문에서 400 이다.
- 옛 `requested` 흐름(보류·다시 보내기·요청 접기)과 옛 사실이 사라진다 — 라이브 옛 행 0.
- 고객 화면은 취소 직후 «취소 완료»를 바로 말하고, core 가 취소한 주문에 Medusa 의 «결제 완료»·구매확정·배송 조회·홈 카드가 비치지 않는다.
- «환불 내역»에서 계좌 송금 대기 행을 바로 [완료 처리]한다.

## 배포 (PR 머지 뒤, 사람이 한다 — 마이그레이션 없음)

1. **읽기 전용 재실측:** 옛 `requested` 행 0, 마감 사실 뒤 `settling` 0(이 계획 머리의 쿼리 — 스크래치패드 `pr6-inputs.sh` 와 같은 쿼리). 0 이 아니면 배포하지 않고 보고한다.
2. **판정 SQL 5초 게이트:** `new PgDialect().sqlToQuery(judgedRowsSql(candidateIdsSql(<최근 evaluated_at ISO>), new Date().toISOString()))` 로 SQL 을 뽑아 라이브에서 `BEGIN READ ONLY; EXPLAIN ANALYZE <sql>; ROLLBACK;`. 상자 판정(`judgedShipmentsSql(openShipmentScopeSql())`)도. 5초 넘으면 배포 중단(메모리 `reconciler-row12-design`).
3. **대기 마이그레이션 대조:** 각 서비스 `__drizzle_migrations` 마지막 행 vs `apps/*/drizzle` — 이 PR 은 0 이어야 하고, 다른 머지 PR 의 마이그가 함께 실리면 그 방향(`migrate → deploy` / `deploy → migrate`)을 먼저 지킨다(메모리 `deploy-ships-other-merged-prs-migrations`).
4. **`npm ci` 세 트리**(루트·admin-web·스토어프론트; 스토어프론트는 `yarn.lock` 되돌리기). 떠 있는 `next dev` 끄기.
5. `! cd deployments/lcnine/services && npx sst deploy --stage live` → Core·ServicesBundleA(channel-adapter)·Medusa 태스크 정의 번호 상승 확인. 한 스택이라 롤링 순서는 없다 — 겹치는 조합은 «먼저 판정한 것» 1·3 에서 무해함을 확인했다.
6. **배포 뒤 관찰:**
   - Core 로그 `order-reconcile retry-channel-settlement(#36, act)` — 첫 `acted` 와 그 행이 `applied` 로 닫히는지(CloudWatch Insights `@timestamp` 는 UTC).
   - channel-adapter 일시 실패가 DLQ 로 가지 않는지(`[CANCEL] … 정산 실패 … retryable=true` 뒤 재배달 없음).
   - Core 로그 `Event type not found in stream config`(`ChannelOrderCancelRejected`·`Stalled`) — 롤링 몇 분 뒤 0.
   - 정체 보드 «취소 요청» 단계에 옛 상태 칩이 없고 `settle_*` 만.
7. 머지는 사용자가 `! gh pr merge <번호> --squash`.

## Also found (PR 본문에 옮긴다 — 고치지 않는다)

- `order-actions.tsx` 는 취소 토스트 외에도 한국어 문자열을 하드코딩한다(구매확정 성공·실패, 배송 조회 안내, 버튼 라벨·대화상자 — 142·146·153·194~257행). 스토어프론트 CLAUDE.md 규칙 7 위반, 이 PR 은 취소 토스트 둘만 옮겼다.
- 결제 상세 [완료 처리]의 오류 토스트가 서버 문장(`REFUND_NOT_MANUALLY_CONFIRMABLE`)을 버리던 것을 Task 10 이 고쳤다(공용 훅으로 옮기며).
- `native/warehouse-app` 의 `CANCEL_REQUESTED` 배치 시작·합류 사유는 core 가 더 내지 않는다 — 다음 앱 배포 때 지울 수 있다.

## Self-Review

1. **스펙·지시문 범위:** ① 미들웨어 → Task 8. ② 실행 모드 → Task 3(+ 선행 Task 1·2). ③ 다시 읽기 삭제 → Task 9. ④ 옛 사실·`REFUND_FAILED` → Task 4·5·6·7. 백오프 → 판정 4(변경 없음). Medusa 직접 읽기 넷 → Task 9. 송금 대기·사이드바·`RefundDto`·D7 문구 → Task 10. 판정 1~7 → 머리. 스펙 §10 미들웨어 테스트 셋 → Task 8 Step 6. 로컬 스모크 S1~S4(+S5) → Task 11.
2. **자리표시 검사:** «적절히»·«TBD» 없음. 지우는 단계는 줄 번호와 인용 앵커를 함께 둔다. 타입 추론이 갈리는 곳(Task 10 `toAdminRefund` 매개변수 타입)은 `as`·`any` 금지 조건과 두 방법을 적었다.
3. **이름 일관성:** `closeSettlingByFullCancel`(Task 2 정의·Task 4 사용), `settleModified(…, channel: { cancelRequests, orderCancelled }, …)`(Task 2) → Task 4 에서 `occurredAt` 제거(호출자 함께), `orderCancelled`(계약·source·번역기·픽스처), `DEFAULT_CANCEL_BLOCKED_CODE`·`REFUND_ON_CANCELED_ORDER_CODE`(단위·통합 같은 문자열), `useConfirmRefund({ refundId, intentId })`(상세·셀 같은 인자), `resolveMypageCoreView`(두 wrapper).
4. **Review Focus:** 다섯 줄 모두 소유 태스크에 테스트가 있다 — 1 → Task 2 Step 2, 2 → Task 8 Step 7(기존 스펙 재실행), 3 → Task 8 Step 1 `it.each`, 4 → Task 9 Step 2 «actions 가 없으면», 5 → Task 10 Step 1.

## Status

계획 — 리뷰 대기·미실행 (2026-10-12).
