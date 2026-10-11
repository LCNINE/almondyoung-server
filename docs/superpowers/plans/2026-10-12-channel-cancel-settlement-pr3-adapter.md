# PR 3 — 계약 + channel-adapter: 정산 라우트 호출·`SettlementFailed` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** channel-adapter 가 전체취소를 기본 `/cancel`(환불 오류를 삼켜 유령 환불 거래를 남긴다) 대신 PR 2 의 `channel-cancel` 로 부르고, 두 정산 라우트에
`refundMode` 를 넘기며, 정산이 끝나지 못한 모든 결과를 새 사실 `ChannelOrderSettlementFailed` 로 낸다 — **옛 core 가 읽는 옛 사실은 오늘 내던
그대로 함께 낸다.**

**Architecture:** `MedusaClient` 가 두 정산 라우트의 응답을 «결과 종류»로 빠짐없이 번역한다(던지지 않는다 — 네트워크·5xx 도 `transient` 값). `ChannelOrderCancelManager`
는 결과 종류 → `{ retryable, failureCode, message, legacy? }` 를 `never` 검사로 고르고, 저장소가 새 사실과 옛 사실을 **한 트랜잭션**에 적재한다. 영구 실패는
사실을 낸 뒤 ack, 일시 실패는 사실을 낸 뒤 지금처럼 던진다(판정 2 — ack 전환은 PR 6).

**Tech Stack:** NestJS, `@app/events` 공용 아웃박스(`StreamPublisher.enqueue`), zod 계약(`packages/event-contracts`), Jest(ts-jest transpile-only).

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` — §5.1, **§7.1·§7.2**, §7.3 «사실 받기», §9.1 #1046 행, **§9.2·§9.3**, §10 channel-adapter.
PR 2 의 실제 응답은 PR #1049 본문(D1~D8)과 develop `apps/medusa/src/api/admin/orders/[id]/{channel-cancel,partial-cancel}/route.ts` 머리 주석이 정본이다.
전례 계획: `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr1-wallet.md`.

---

## 먼저 판정한 것 (지시문 «먼저 판정할 것» 1~5)

### 판정 5 — 옛 core 는 새 사실 타입을 경고 후 버린다 (확인됨, 판정 1·2 의 전제)

코드로 다시 확인했다(2026-10-12, develop `2452dd202`).

- 소비 검증 `SchemaValidationInterceptor`(`libs/events/src/interceptors/schema-validation.interceptor.ts:69-73`) — 스트림 설정에 없는 `messageType` 은
  `warn('Event type not found in stream config')` 후 `next.handle()`. 던지지 않는다.
- 라우팅 `EventTypeGuard`(`libs/events/src/guards/event-type.guard.ts:50-54`) — 핸들러의 `@On` 이벤트명과 다르면 `of(undefined)` 로 정상 완료. 옛 core 엔
  `ChannelOrderSettlementFailed` 핸들러가 없으므로 모든 핸들러가 건너뛴다 → 오프셋 커밋, DLQ 없음, 소비자 정지 없음.
- `orders.events.v1` 의 다른 소비자(notification `order-event.consumer.ts`, analytics `order-events.consumer.ts`)도 `@UseInterceptors(EventTypeGuard)` + `@On` 이라 같다.
- 35번 PR-B 계획의 실측(«미등록 이벤트는 경고 후 조용히 버려짐»)과 일치. **판정 1·2 는 이 전제 위에 선다.**

### 판정 1 — 기존 결과는 옛 사실을 «함께» 낸다 (스펙 표 전부 + 옛 사실 병행)

**정한 것:** 스펙 §7.2 표의 **모든 줄이 `SettlementFailed` 를 낸다**(스펙 그대로). 거기에 더해, **오늘의 channel-adapter 가 같은 응답에 내던 옛 사실
(`Rejected`·`Stalled`)을 같은 트랜잭션에서 그대로 함께 낸다.** 오늘 옛 사실이 없던 결과(새 결과·오늘 던지던 결과)엔 옛 사실을 만들어 내지 않는다.
단 하나의 예외 쪽 추가: 부분취소 영구 거절(`wallet_refund_refused` + `stage: edited`)엔 옛 `Stalled` 를 낸다 — PR 2 전까지 같은 상황이 502 + `Stalled` 였다.

| 결과 | `SettlementFailed` | 옛 사실(PR 6 까지) | 처리 |
| --- | --- | --- | --- |
| 사전검사: 자동 취소 불가 채널 | `false` · `channel_not_supported` | `Rejected NOT_SUPPORTED` | ack |
| 사전검사: 수집한 적 없는 주문 | `false` · `order_not_collected` | `Rejected ORDER_NOT_FOUND` | ack |
| 전체 200 · 400 «이미 취소됨» | — | — | 재수집 |
| 전체 400 `wallet_refund_refused:*` | `false` · 표지 그대로 | **없음**(아래 이유) | ack |
| 전체 400 그 밖 | `false` · `code ?? type ?? http_400` | `Rejected NOT_CANCELABLE` | ack |
| 전체 404 `type: not_found` | `false` · `not_found` | `Rejected ORDER_NOT_FOUND` | ack |
| 전체 5xx·본문 없는 404·그 밖 상태·네트워크 | `true` · `http_<status>` / `network` | 없음 | **던짐**(판정 2) |
| 부분 200 | — | — | 재수집 |
| 부분 400 `partial_cancel_rejected` | `false` · `partial_cancel_rejected` | `Rejected NOT_CANCELABLE` | ack |
| 부분 400 `partial_cancel_rejected` + `reason: external_refund_*` | `false` · `reason` 그대로 | `Rejected EXTERNAL_REFUND_UNRESOLVED` + 금액 | ack |
| 부분 400 `wallet_refund_refused:*` + `stage: edited` | `false` · 표지 그대로 | `Stalled(edited)` | ack |
| 부분 400 `wallet_refund_refused:*`, `stage` 없음 | `false` · 표지 그대로 | 없음 | ack |
| 부분 502 `refund_pending` | `true` · `refund_pending` | `Stalled(edited)` | **던짐** |
| 부분 400 그 밖(Medusa 자체 `not_allowed`·`invalid_data`)·404 `not_found` | `false` · `code ?? type` | 없음(오늘은 던졌다) | ack(판정 4) |
| 부분 5xx·본문 없는 404/502·그 밖 상태·네트워크 | `true` · `http_<status>` / `network` | 없음 | **던짐** |

**근거.**
- 스펙 목표 6(«어떤 조합도 지금보다 나빠지지 않는다»): 옛 core 는 `SettlementFailed` 를 버린다(판정 5). 옛 사실을 끊으면 라이브 37번 흐름
  (`EXTERNAL_REFUND_UNRESOLVED` + 금액 → 요청 닫음 → 운영자가 금액을 넣어 다시 요청)이 «사유 없는 정체»로 퇴행한다. 함께 내면 옛 core 의 동작은 바이트 단위로 오늘과 같다.
- 스펙 §9.2 의 6 이 이미 «옛 사실 생산 … 정리»를 PR 6 에 두었다 — 옛 사실은 PR 6 까지 «생산되는 것»이 스펙의 그림이다.
- 지시문의 후보(«기존 결과는 옛 사실만, 새 결과만 `SettlementFailed`»)보다 나은 점: PR 5 core 가 **요청 행 상태 하나로** 읽을 사실을 가를 수 있다 —
  `settling` 행은 `SettlementFailed` 만, 옛 `requested` 행은 옛 사실만. 후보안이면 PR 5 가 `Rejected` 의 `reasonCode` 를 `failureCode` 로 다시 번역해야 하고,
  PR 6 에서 adapter 를 한 번 더 고쳐야 스펙 표가 완성된다.
- **전체 영구 거절에 옛 `Rejected REFUND_FAILED` 를 내지 않는 이유:** 라이브 core 의 `reject()`(`channel-cancel-request.manager.ts:166-185`)는 reasonCode 와
  무관하게 요청을 `rejected` 로 닫고 보류를 푼다 → 고객이 취소한 물건이 출고된다. 오늘 옛 adapter 도 이 경우에 `Rejected` 를 내지 않았다(기본 `/cancel` 이 삼켜 성공).

**비용.**
- 실패마다 사실이 둘 나간다(같은 트랜잭션이라 «하나만 나감»은 없다). 옛 core 는 `SettlementFailed` 마다 `warn` 로그 한 줄을 남긴다.
- PR 5 가 «`settling` 행엔 옛 사실 무시»를 지켜야 한다 — 두 사실은 같은 파티션 키지만 아웃박스를 거치므로 도착 순서를 보장하지 않는다(아래 «PR 5 에 넘길 것» 1).
- **PR 3~5 사이 전체취소 영구 거절**(예: CMS 결제): Medusa 는 취소하지 않고, 옛 core 는 `SettlementFailed` 를 버려 요청이 보류된 채 5분 뒤 정체 보드에
  사유 없이 뜬다. 운영자의 [요청 접기]는 **출고로 이어진다.** 오늘은 같은 주문이 «환불 없이 취소»(유령 환불 거래)된다. 스펙 §9.2 의 3 이 받아들인
  교환이다 — PR 본문 «혼자 나갔을 때»와 배포 안내에 «접지 말 것»을 적는다. PR 5 를 오래 미루지 않는 것이 이 창을 줄이는 유일한 방법이다.

### 판정 2 — 일시 실패는 사실을 낸 뒤 «지금처럼 던진다». ack 전환은 PR 6 (리컨실러 실행 모드와 같이)

**정한 것:** `retryable: true` 결과는 `SettlementFailed` 를 적재한 뒤 던진다. `retryable: false` 는 적재 뒤 ack. 스펙 S7 의 «사실을 낸 뒤 명령을 ack»는
**PR 6 에서 리컨실러 실행 모드와 함께 켠다**(이 PR 의 `fail()` 끝 `throw` 한 줄을 지운다).

**근거.** 지금 Kafka 재시도는 `DEFAULT_RETRY_POLICY` = 3회 · 지수 1s/2s/4s(`libs/events/src/retry/retry-policy.types.ts:72-77`), 일반 `Error` 는 재시도 대상
(`retry.util.ts:29-51`) → 약 7초 안의 순단(ALB 502 한 번, Medusa 재기동 꼬리)을 스스로 넘긴다. PR 3 이 ack 하면 PR 3~5 동안은 옛 core 가 사실을 버리고
PR 5~6 동안은 리컨실러가 관찰 모드라, **그 7초짜리 자가 회복마저 없어진다.** 던져도 옛 core·새 core 어느 쪽 상태도 나빠지지 않는다(사실은 이미 적재됨).

**비용.**
- 긴 장애는 오늘처럼 DLQ 로 간다(창 7초). DLQ 뒤엔 PR 5 전엔 운영자 [다시 보내기], PR 5~6 엔 [다시 시도]뿐이다 — 오늘과 같다.
- **같은 전달 안에서 결과가 바뀔 수 있다**(1회차 500 → 2회차 영구 거절). 스펙의 멱등 키 `settlement-failed:${requestId}:${messageId}` 로는 두 번째 사실이
  먹힌다 → 키에 `failureCode` 를 더한다(D4). 같은 전달·같은 결과의 반복은 여전히 한 번으로 접힌다.
- 일시 실패 한 번이 자가 회복되면 core 에 `retryable: true` 사실이 하나 남고 곧 재수집 사실이 따라온다 — PR 5 는 정산 완료가 오면 `lastFailure` 를 지우면 된다.

### 판정 3 — 부분취소 502 `refund_pending` 은 `SettlementFailed{retryable:true}` + 옛 `Stalled` 둘 다

판정 1 의 규칙(오늘 내던 옛 사실은 함께) 그대로다. 오늘 이 응답에 `Stalled` + 던짐이었으므로 옛 core 의 동작이 같다. 스펙 §7.3 이 새 core 가 `settling` 행의 옛
`Stalled` 를 `retryable: true` 로 읽는다고 했으니 둘 다 받아도 새 core 의 결론은 같다(단 PR 5 는 판정 1 의 «`settling` 행엔 옛 사실 무시»를 택하길 권한다).

### 판정 4 — Medusa 자체 400(우리 code 없음)은 `retryable: false` (스펙 표 그대로)

**정한 것:** 전체·부분 모두 `retryable: false`, `failureCode = body.code ?? body.type ?? 'http_400'`, ack.

**근거.** 스펙 §7.2 표가 정본이다. 전체취소의 이 400(진행 중 주문 변경·안 취소된 출고·본문 오류)은 오늘도 `Rejected NOT_CANCELABLE`(종결)이다.
`true` 로 두면 «안 취소된 출고» 같은 영구 사전검사 실패가 리컨실러 백오프로 영원히 돌며 «환불 지연»으로 보인다 — 운영자가 원인(출고)을 못 본다.

**비용.**
- «다른 주문 수정이 열려 있음»처럼 금방 풀리는 상황도 «환불 거절»로 보여 운영자가 [다시 시도]를 눌러야 한다(사유 칸에 Medusa 문장이 그대로 실린다).
- 부분취소는 오늘 이 400 을 **던졌다**(Kafka 재시도 7초 → DLQ). 이제 ack 한다 → 옛 core 에선 둘 다 «보류된 채 사유 없는 정체»라 결과가 같고, 7초 자가 회복만 잃는다.
  라이브 부분취소 기록 0(스펙 §2.3).

### 판정 6 — `salesOrderId` 는 사실에 싣지 않는다 (지시문 «어디서 얻는지 확인할 것»)

**확인한 것:** channel-adapter 는 core 판매주문 id 를 모른다. 명령엔 그 칸이 없고, 수집 매핑 `wms_order_mappings.wms_order_id` 는 adapter 가 `OrderCreated` 때
`uuidv4()` 로 만든 값이며 core 는 판매주문을 만들 때 **자기 PK 를 새로 발급한다**(`orders.stream.ts` `OrderCancelledPayload.orderId` 주석, #656).

**정한 것:** `SettlementFailed` 는 형제 사실(`Rejected`·`Stalled`)과 같은 키 `{ requestId, salesChannel, externalOrderId }` 를 싣고 `salesOrderId` 는 뺀다(D1).
core 는 지금도 `requestId`(= `sales_order_amendments.id`)로 요청 행을 찾는다(`reject()` 의 `reader.findById`) — 판매주문 id 는 그 행에 있다.
**기각:** 명령에 optional `salesOrderId` 를 더해 메아리 — PR 5 전까지 늘 비어 있고, 같은 값을 두 군데서 들게 된다.

---

## 스펙과 다른 점 (PR 본문에 옮긴다)

| # | 자리 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| D1 | `SettlementFailed` 의 `salesOrderId` | 빼고 `salesChannel`·`externalOrderId` 를 싣는다 | 판정 6 |
| D2 | 기존 결과의 사실 | `SettlementFailed` + 오늘의 옛 사실을 한 트랜잭션에(PR 6 까지) | 판정 1 |
| D3 | 일시 실패의 ack | 사실을 낸 뒤 던진다(ack 는 PR 6) | 판정 2 |
| D4 | 멱등 키 | `settlement-failed:${requestId}:${messageId}:${failureCode}`(코드는 120자에서 자른다) | 판정 2 의 비용 — 같은 전달 안 결과 변화. 키 칸은 `varchar(255)` |
| D5 | `failureCode` 어휘 | 열린 문자열. Medusa `code ?? type`(표지 `wallet_refund_refused:<c>` 그대로) · `reason`(`external_refund_*`) · `http_<status>` · `network` · `refund_pending` · 사전검사 `channel_not_supported`/`order_not_collected` | 스펙은 «Medusa type/code»만 적었다. enum 으로 두면 값마다 소비자 선배포가 필요하다(메모리 `event-contract-runtime-validation`) |
| D6 | 부분취소 Medusa 자체 400 | `false` + ack, 옛 사실 없음 | 판정 4. 부분취소 라우트 주석의 «일시적»과 다르다 |

---

## PR 5 에 넘길 것 (core + admin-web 계획이 읽는다)

1. **`settling` 행은 `SettlementFailed` 만 읽고 `Rejected`·`Stalled` 는 무시한다.** PR 3 이 같은 결과에 둘을 반드시 같이 낸다(판정 1). 도착 순서는 보장되지 않는다 —
   스펙 §7.3 의 «옛 사실을 `settling` 행에서 `retryable: true` 로 읽기»를 구현하면 늦게 온 `Stalled` 가 `refused` 를 `in_progress` 로 되돌릴 수 있다. 그 문장은
   «새 core + 옛 adapter» 대비였는데 PR 3 이 PR 5 보다 먼저 라이브라 그 조합은 없다(§9.3 셋째 줄).
2. **옛 `requested` 행은 옛 사실만 읽는다**(옛 규칙 그대로). 단 옛 행에 전체취소 영구 거절이 나면 옛 사실이 없다(판정 1 표) — 사유를 보이고 싶으면 `SettlementFailed` 의
   `message` 를 옛 행의 표시용으로만 적는 것은 PR 5 가 정한다(상태 전이는 하지 말 것 — 보류가 풀린다).
3. **같은 `requestId` 의 `SettlementFailed` 가 여러 번, 순서 없이 온다** — 같은 전달의 재시도(결과가 바뀌면 코드별로 하나씩, D4)와 리컨실러 재발행. `lastFailure` 는 `at` 이
   더 늦을 때만 덮어쓴다. 정산 완료(`OrderCancelled`·`stage: refunded`)가 오면 그 뒤의 `SettlementFailed` 는 무시한다.
4. **`refused` 판정은 `retryable` 하나로.** «환불 거절»(wallet·PG)과 «정산 실패 · 개발 확인»(주문 없음 등)의 구분은 `failureCode.startsWith('wallet_refund_refused:')` 로 한다(D5).
5. **37번 외부 환불(`failureCode` 가 `external_refund_*`)** — `SettlementFailed` 엔 미해결 금액이 없다. `settling` 행에서 금액을 보여야 하면 `SettlementFailed` 에
   optional `unresolvedRefundAmount` 를 더한다(선택 칸 추가는 순서 제약이 없다). PR 3 은 YAGNI 로 두지 않았다.
6. 리컨실러·[다시 시도]·[계좌 송금으로 환불]은 같은 `requestId` 와 `refundMode` 로 `CancelChannelOrder` 를 다시 낸다 — 계약 칸 `refundMode` 가 이 PR 에 있다.
7. 판매주문 id 는 사실에 없다 — `requestId` 로 요청 행을 찾는다(D1).

## PR 6 에 넘길 것

- `ChannelOrderCancelManager.fail()` 의 `retryable` 던짐을 지운다(ack) — 리컨실러 실행 모드와 **같은 배포**에.
- 옛 사실 생산(`legacy`)과 `LegacyCancelFact`, 계약의 `REFUND_FAILED`·`ChannelOrderCancelRejected`·`ChannelOrderCancelStalled` 정리(스펙 §9.2 의 6). PR 5 가 옛 `requested` 행이
  0 이 된 것을 확인한 뒤.
- 대시보드 미들웨어(§6.6)는 **이 PR 이 라이브가 된 뒤** 건다.

## 범위 밖 · 알려진 한계 (PR 2 에서 넘어옴 — PR 본문에 옮긴다)

- **D8(PR 2):** 장부에 없는 자동 PENDING 은 «진행 중» → 500. 계좌 미등록 무통장 폴백 환불이 응답을 잃으면 운영자가 wallet 에서 확인할 때까지 그 주문 정산이 일시 실패로
  남는다. adapter 쪽에선 `retryable: true` 가 반복되고(PR 6 전엔 매 명령 전달마다 7초 재시도 뒤 DLQ).
- **T5-5(PR 2):** 부분취소가 영구 거절된 뒤 바깥에서 환불하고 재시도하면, 수정된 재시도가 37번 외부 환불 검사를 건너뛰어 같은 몫이 또 나갈 수 있다 — 출구는 `refundMode: 'manual'`.
- **PR 1:** 응답이 끊긴 PG 호출은 `PROVIDER_EXCEPTION`·`retryable: true` 라 재시도가 부분환불을 두 번 낼 수 있다.
- 기존 결제·환불 건 소급 대조·환급은 하지 않는다(사용자 결정 2026-10-11).
- 네이버·쿠팡 — 자동 취소 능력이 없어 사전검사에서 `channel_not_supported`(지금과 같다).

---

## Global Constraints

- **Medusa(`apps/medusa`)는 바꾸지 않는다.** 바꿔야 한다는 결론이 나오면 멈추고 기록한다
- **계약은 «더하기»만:** 명령에 optional `refundMode`, `orders.events.v1` 에 새 이벤트 타입 하나. 기존 이벤트·enum 값은 건드리지 않는다(지우기는 PR 6)
- **`REFUND_FAILED` 를 생산하지 않는다**(스펙 §7.1). `refund-failure.ts` 의 두 갈래 분류·`walletCode` 멱등 키(#1046)는 옮기지 않는다
- **환불 거절 문장은 Medusa 가 준 문장 그대로** `message` 에 싣는다(PR 2 D5 — wallet·토스 한국어 메시지). 다듬지 않는다
- **결과 종류 누락은 `never` 검사로 컴파일에서 막는다** — 전체·부분 각각
- 아웃박스 적재 실패는 던진다(재배달을 탄다). 재수집 실패도 지금처럼 던진다
- `refundMode` 가 명령에 없으면 **`'auto'` 를 명시해 보낸다**(Medusa 기본값도 auto 지만 본문으로 단언 가능하게)
- 서비스 코드에 `any`·`as` 를 새로 들이지 않는다. 스펙 파일의 목 캐스팅(`as never`)은 기존 관례대로 허용
- `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` 는 develop 부터 prettier 불통이다 — **파일 전체를 포맷하지 말고** 바꾼 줄만 주변 모양에 맞춘다
- 게이트: 루트 `npm run type-check` 0 · `npx jest` 0 · `npm run audit:event-handlers` · `npm run audit:event-publishers` · `npm run audit:consume-validation -- --gate`
  (develop 기준선: 셋 다 «발견 없음/위반 없음», 2026-10-12 실측)

## Review Focus

- **같은 전달 안에서 일시 → 영구로 결과가 바뀐다**(1회차 Medusa 500, Kafka 재시도의 2회차 400 표지). 영구 사실이 멱등 키에 먹히면 core 는 영원히 «정산 중»으로 본다.
  Task 2 «같은 전달이라도 failureCode 가 다르면 키가 다르다» 테스트가 지킨다.
- **전체취소 영구 거절에 옛 `Rejected` 를 내면 옛 core 가 보류를 풀어 고객이 취소한 물건을 출고한다.** Task 4 «전체 refund_refused 는 옛 사실 없이» 테스트가 `legacy` 가
  `undefined` 임을 단언한다.
- **부분취소 표지인데 `stage: edited` 가 없다**(Medusa 응답 모양이 바뀐 경우). 옛 `Stalled(edited)` 를 내면 옛 core 가 «채널 주문이 이미 줄었다»로 [요청 접기]를 막는다 —
  사실이 아닌데. Task 3 의 `edited: false` 테스트와 Task 4 의 «edited 가 아니면 옛 사실 없음» 테스트가 지킨다.
- **예상 밖 상태 코드(401·409·422)** — 키 오설정·잠금 충돌. 영구로 읽으면 «환불 거절»로 굳고, 던지지 않으면 재시도도 없다. 일시(`http_<status>`)로 읽는다. Task 3 테스트가 지킨다.
- **아주 긴 `failureCode`**(Medusa 가 긴 code 를 실어 보냄) — 멱등 키가 `varchar(255)` 를 넘으면 적재가 매번 실패해 명령이 DLQ 로 간다. Task 2 «긴 코드는 키에서 자른다» 테스트가 지킨다.

---

## 실행 준비 (태스크 전에 한 번)

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin
git worktree add .claude/worktrees/feat-1016-36-adapter-settlement -b feat/1016-36-adapter-settlement origin/develop
W=/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1016-36-adapter-settlement
M=/home/pauseb/workspace/almondyoung-server
ln -s $M/node_modules $W/node_modules
ln -s $M/apps/admin-web/node_modules $W/apps/admin-web/node_modules
ln -s $M/native/warehouse-app/node_modules $W/native/warehouse-app/node_modules
```

루트 `type-check`·`npx jest` 는 admin-web·warehouse-app 도 본다 — 셋 다 심볼링크하지 않으면 PR 1·2 처럼 «Cannot find module» 로 빨갛다.
이후 **모든 명령은 워크트리**에서 돈다.

서브에이전트로 실행하면 dispatch 첫 줄에: `cd <워크트리>` → `git rev-parse --show-toplevel && git branch --show-current` → 기대값
(`…/feat-1016-36-adapter-settlement`, `feat/1016-36-adapter-settlement`)과 다르면 STOP, 특히 `develop` 이면 멈춘다. **커밋 전 두 명령의 출력을 보고서에 넣는다.**
«npm·jest·tsc 는 이 워크트리에서 돈다(node_modules 심볼링크됨)»를 명시한다. 태스크마다 `git -C $M status --short` 와 `git -C $M rev-parse develop origin/develop` 로
메인 오염을 확인한다(메모리 `subagent-worktree-contamination`).

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| Modify `packages/event-contracts/streams/channel-orders-command.stream.ts` | `CHANNEL_CANCEL_REFUND_MODES`·`ChannelCancelRefundMode`, 명령의 optional `refundMode` |
| Modify `packages/event-contracts/streams/orders.stream.ts` | `ChannelOrderSettlementFailedPayload`·스키마·`ORDER_STREAM` 등록, 옛 사실 주석 |
| Modify `packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts` | `refundMode` 계약 |
| Modify `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts` | 새 사실 계약 |
| Modify `libs/shared/src/streams/README.md` | 이벤트 표에 한 줄 |
| Modify `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts` (+ `.spec.ts`) | `recordSettlementFailure`(새 사실 + 옛 사실, 한 트랜잭션), `LegacyCancelFact`, 멱등 키. `recordRejected`·`recordStalled` 삭제 |
| Modify `apps/channel-adapter/src/adapters/medusa/medusa.client.ts` (+ `.spec.ts`) | `channel-cancel` 경로, `refundMode` 본문, 응답 → 결과 종류(던지지 않음), `MedusaHttpError` 삭제 |
| Modify `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts` (+ `.spec.ts`) | 결과 종류 → 정산 실패(+옛 사실), ack/던짐, `refundMode` 전달 |
| Modify `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts`, `apps/channel-adapter/CLAUDE.md` | 주석·문서 |

---

### Task 1: 계약 — 명령 `refundMode`, 새 사실 `ChannelOrderSettlementFailed`

**Files:**
- Modify: `packages/event-contracts/streams/channel-orders-command.stream.ts`
- Modify: `packages/event-contracts/streams/orders.stream.ts:594-683`
- Test: `packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts`, `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`
- Modify: `libs/shared/src/streams/README.md:201`

**Interfaces:**
- Produces: `CHANNEL_CANCEL_REFUND_MODES`, `type ChannelCancelRefundMode = 'auto' | 'manual'`, `CancelChannelOrderPayload.refundMode?: ChannelCancelRefundMode`
  (`@packages/event-contracts/streams` 에서 보인다 — `streams/index.ts` 가 `export *`)
- Produces: `interface ChannelOrderSettlementFailedPayload { requestId: string; salesChannel: string; externalOrderId: string; scope: 'full' | 'partial'; retryable: boolean; failureCode: string; message: string; at: string }`,
  `ORDER_STREAM.events.ChannelOrderSettlementFailed`

- [ ] **Step 1: 실패하는 계약 테스트를 쓴다**

`channel-orders-command-stream.spec.ts` 의 `describe('CancelChannelOrder (#1016 35번 행)'` 블록 안 끝에 더한다(`full`·`partial`·`schema` 는 그 블록의 것):

```ts
    describe('refundMode (#1016 36번 재설계 §7.1)', () => {
      it('없어도 통과한다 — 옛 core 가 낸 명령이다(받는 쪽이 auto 로 읽는다)', () => {
        expect(schema.parse(full)).not.toHaveProperty('refundMode');
        expect(schema.parse(partial)).not.toHaveProperty('refundMode');
      });

      it.each(['auto', 'manual'])('%s 를 전체·부분 모두 받는다', (refundMode) => {
        expect(schema.parse({ ...full, refundMode })).toMatchObject({ refundMode });
        expect(schema.parse({ ...partial, refundMode })).toMatchObject({ refundMode });
      });

      it('그 밖의 값은 거절한다', () => {
        expect(() => schema.parse({ ...full, refundMode: 'MANUAL' })).toThrow();
        expect(() => schema.parse({ ...full, refundMode: '' })).toThrow();
      });
    });
```

`channel-order-cancel-facts.spec.ts` 의 최상위 `describe` 안, `describe('OrderModified cancelRequests …` 앞에 더한다(`key` 는 파일 맨 위의 것):

```ts
  describe('ChannelOrderSettlementFailed (#1016 36번 재설계 §7.1)', () => {
    const schema = ORDER_STREAM.events.ChannelOrderSettlementFailed.schema!;
    const fact = {
      ...key,
      scope: 'full',
      retryable: false,
      failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
      message: '자동 환불할 수 없는 결제수단입니다',
      at: '2026-10-12T00:00:00.000Z',
    };

    it('영구·일시, 전체·부분을 받는다', () => {
      expect(schema.parse(fact)).toEqual(fact);
      const transient = { ...fact, scope: 'partial', retryable: true, failureCode: 'http_500', message: '' };
      expect(schema.parse(transient)).toEqual(transient);
    });

    it('failureCode 는 열린 문자열이다 — 새 값이 소비자 선배포를 요구하지 않는다', () => {
      expect(schema.parse({ ...fact, failureCode: 'something_new' })).toMatchObject({ failureCode: 'something_new' });
      expect(() => schema.parse({ ...fact, failureCode: '' })).toThrow();
    });

    it('판매주문 id 는 싣지 않는다 — channel-adapter 는 core 판매주문 id 를 모른다(#656). 요청 행은 requestId 로 찾는다', () => {
      expect(schema.parse({ ...fact, salesOrderId: 'so-1' })).not.toHaveProperty('salesOrderId');
      expect(() => schema.parse({ ...fact, requestId: '' })).toThrow();
    });

    it('retryable 은 boolean, at 은 ISO 시각이어야 한다', () => {
      expect(() => schema.parse({ ...fact, retryable: 'false' })).toThrow();
      expect(() => schema.parse({ ...fact, at: 'now' })).toThrow();
      expect(() => schema.parse({ ...fact, scope: 'some' })).toThrow();
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`
Expected: FAIL — `refundMode` 이 strip 돼 `toMatchObject` 실패, `ChannelOrderSettlementFailed` 가 없어 `Cannot read properties of undefined (reading 'schema')`.

- [ ] **Step 3: 명령 계약에 `refundMode` 를 더한다**

`channel-orders-command.stream.ts` — `// ===== Command Payloads =====` 바로 아래에:

```ts
/**
 * 채널 정산의 환불 방식(#1016 36번 재설계 스펙 §6.1·§6.3). `manual` 은 외부 결제 몫을 PG 대신 wallet «송금 대기»로 남긴다
 * (운영자가 고객 계좌로 보내고 [송금 완료]). 포인트 몫은 둘 다 자동으로 되돌린다.
 */
export const CHANNEL_CANCEL_REFUND_MODES = ['auto', 'manual'] as const;
export type ChannelCancelRefundMode = (typeof CHANNEL_CANCEL_REFUND_MODES)[number];
```

`CancelChannelOrderPayload` 의 `alreadyRefundedAmount` 아래에:

```ts
  /** 없으면 `auto` — 옛 core(PR 5 전)는 이 칸을 모른다. 같은 requestId 의 재발행은 같은 값을 싣는다 */
  refundMode?: ChannelCancelRefundMode;
```

`CancelChannelOrderSchema` 의 `alreadyRefundedAmount` 줄 아래에:

```ts
    refundMode: z.enum(CHANNEL_CANCEL_REFUND_MODES).optional(),
```

인터페이스 머리 주석의 «core 는 요청을 기록·보류한 뒤 이 명령을 내고, 확정은 …, 거절은 `ChannelOrderCancelRejected` 로 돌려받는다» 문장 끝에 덧붙인다:
`정산이 끝나지 못하면 `ChannelOrderSettlementFailed`(#1016 36번 재설계)도 함께 온다.`

`packages/event-contracts/streams/index.ts` 가 두 파일을 이미 `export *` 한다(`:14`·`:49`) — 새 이름은 따로 export 하지 않아도 `@packages/event-contracts/streams` 에서 보인다.

- [ ] **Step 4: 새 사실을 더한다**

`orders.stream.ts` — `ChannelOrderCancelStalledSchema` 정의 바로 아래(`// ===== Stream Config` 위)에:

```ts
/**
 * 정산 실패 사실 (#1016 36번 재설계 스펙 §7.1·§7.2). 채널이 취소 명령의 «돈 정리»를 끝내지 못했다. 종결 사실이 아니다 —
 * 성공은 사실로 내지 않는다(재수집된 `OrderCancelled`/`OrderModified` 가 곧 사실).
 * - `retryable: false`: 같은 명령을 다시 보내도 같다(wallet·PG 영구 거절, 주문 없음 같은 이상). 운영자가 [다시 시도]·[계좌 송금으로 환불]을 고른다
 * - `retryable: true`: 일시(Medusa 5xx·네트워크·라우트 없음). core 가 같은 requestId·refundMode 로 다시 낸다
 * 판매주문 id 는 싣지 않는다 — channel-adapter 는 core 판매주문 id 를 모른다(#656). core 는 requestId 로 요청 행을 찾는다.
 * PR 6 전까지 channel-adapter 는 같은 결과에 옛 사실(`ChannelOrderCancelRejected`·`Stalled`)을 함께 낸다 — 옛 core 가 이 타입을 버리기 때문이다.
 */
export interface ChannelOrderSettlementFailedPayload {
  /** `CancelChannelOrderPayload.requestId` 그대로 */
  requestId: string;
  salesChannel: string;
  externalOrderId: string;
  scope: 'full' | 'partial';
  retryable: boolean;
  /**
   * 열린 문자열 — 값을 더할 때 소비자 선배포가 필요 없게. Medusa 응답의 code/type(wallet 영구 거절은 `wallet_refund_refused:<wallet 코드>`),
   * 37번 사유 `external_refund_*`, `http_<status>`, `network`, `refund_pending`, adapter 사전검사 `channel_not_supported`·`order_not_collected`
   */
  failureCode: string;
  /** 운영자에게 보일 사유. 채널이 준 문장 그대로(wallet 거절은 토스 한국어 메시지) */
  message: string;
  /** ISO 8601 — channel-adapter 가 결과를 받은 시각. 같은 요청의 사실이 순서 없이 와도 core 가 최신을 고르게 */
  at: string;
}

const ChannelOrderSettlementFailedSchema = z.object({
  requestId: z.string().min(1),
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  scope: z.enum(['full', 'partial']),
  retryable: z.boolean(),
  failureCode: z.string().min(1),
  message: z.string(),
  at: z.string().datetime(),
});
```

`ORDER_STREAM.events` 의 `ChannelOrderCancelStalled` 등록 아래에:

```ts
    ChannelOrderSettlementFailed: event<'ChannelOrderSettlementFailed', ChannelOrderSettlementFailedPayload>(
      'ChannelOrderSettlementFailed',
      ChannelOrderSettlementFailedSchema,
    ),
```

`CHANNEL_ORDER_CANCEL_REJECTION_CODES` 위 주석의 `REFUND_FAILED` 항목을 고친다:

```ts
 * - `REFUND_FAILED`: 생산하지 않는다 — 정산 실패는 `ChannelOrderSettlementFailed` 가 맡는다(#1016 36번 재설계 §7.1). 옛 core 는 이 값을 받으면
 *   요청을 닫고 보류를 푼다. 계약에서 지우는 것은 정리 PR(§9.2 의 6)
```

`ChannelOrderCancelRejectedPayload` 위 주석(«종결 사실 — …»)과 `ChannelOrderCancelStalledPayload` 위 주석 끝에 각각 한 줄:
`PR 6 전까지 옛 core 를 위해 `ChannelOrderSettlementFailed` 와 함께 나간다 — 새 core 는 `settling` 행에선 이것을 읽지 않는다.`

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest packages/event-contracts`
Expected: PASS (기존 스펙 포함 전부)

- [ ] **Step 6: 문서 표에 한 줄**

`libs/shared/src/streams/README.md` 의 `ChannelOrderCancelStalled` 줄 아래에:

```md
| `ChannelOrderSettlementFailed` | 채널이 취소 명령의 정산(환불·취소)을 끝내지 못함 (#1016 36번 재설계) | `requestId`, `scope`, `retryable`, `failureCode`, `message` |
```

- [ ] **Step 7: 타입 검사 후 커밋**

Run: `npm run type-check`
Expected: 에러 0

```bash
git add packages/event-contracts/streams libs/shared/src/streams/README.md
git commit -m "feat(event-contracts): #1016 36번 재설계 PR 3 — 취소 명령 refundMode, 정산 실패 사실"
```

---

### Task 2: 저장소 — 새 사실과 옛 사실을 한 트랜잭션에

**Files:**
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts`
- Test: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `ChannelOrderSettlementFailedPayload`, 기존 `ChannelOrderCancelRejectedPayload`·`ChannelOrderCancelStalledPayload`
- Produces:
  ```ts
  export type LegacyCancelFact =
    | { eventType: 'ChannelOrderCancelRejected'; payload: ChannelOrderCancelRejectedPayload }
    | { eventType: 'ChannelOrderCancelStalled'; payload: ChannelOrderCancelStalledPayload };
  recordSettlementFailure(fact: ChannelOrderSettlementFailedPayload, deliveryId: string, legacy?: LegacyCancelFact): Promise<void>
  ```
  `recordRejected`·`recordStalled` 는 **지운다**(Task 4 의 매니저가 더 이상 부르지 않는다. Task 2 와 Task 4 사이엔 매니저가 컴파일되지 않으니 Task 2·3 커밋 전
  `type-check` 는 매니저 파일 에러만 남는 것이 정상이다 — Task 4 가 닫는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`channel-order-cancel.repository.spec.ts` 에서 `'거절 사실은 같은 전달에서 한 번만…'`·`'정체 사실도 같은 전달에서…'`·`'같은 requestId 도 전달(messageId)이 다르면…'` 세 `it` 을 지우고
아래로 바꾼다(`makeRepository`·`key`·`collectColumnNames`·매핑 테스트 둘은 그대로):

```ts
  const fact = {
    ...key,
    scope: 'full' as const,
    retryable: false,
    failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
    message: '자동 환불할 수 없는 결제수단입니다',
    at: '2026-10-12T00:00:00.000Z',
  };

  it('정산 실패 사실을 채널 단위 파티션으로, 전달·코드 단위 멱등 키로 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    await repository.recordSettlementFailure(fact, 'd1');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      {
        eventType: 'ChannelOrderSettlementFailed',
        aggregateId: 'medusa:order_1',
        partitionKey: 'medusa',
        metadata: { partitionKey: 'medusa' },
        idempotencyKey: 'settlement-failed:req-1:d1:wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        payload: fact,
      },
      'tx',
    );
  });

  it('옛 사실이 있으면 «같은 트랜잭션»에 옛 키로 함께 적재한다 — 옛 core(PR 5 전)가 읽는다', async () => {
    const { repository, enqueue, transaction } = makeRepository();
    const rejected = { ...key, reasonCode: 'NOT_CANCELABLE' as const, message: '출고됨' };
    await repository.recordSettlementFailure(fact, 'd1', { eventType: 'ChannelOrderCancelRejected', payload: rejected });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls.map(([event, tx]) => [event.eventType, event.idempotencyKey, tx])).toEqual([
      ['ChannelOrderSettlementFailed', 'settlement-failed:req-1:d1:wallet_refund_refused:REFUND_NOT_AUTOMATABLE', 'tx'],
      ['ChannelOrderCancelRejected', 'cancel-rejected:req-1:d1', 'tx'],
    ]);
    expect(enqueue.mock.calls[1][0]).toMatchObject({ aggregateId: 'medusa:order_1', partitionKey: 'medusa', payload: rejected });
  });

  it('옛 정체 사실은 옛 키로 적재한다', async () => {
    const { repository, enqueue } = makeRepository();
    const stalled = { ...key, stage: 'edited' as const, message: '환불 미완' };
    await repository.recordSettlementFailure({ ...fact, scope: 'partial', retryable: true, failureCode: 'refund_pending' }, 'd1', {
      eventType: 'ChannelOrderCancelStalled',
      payload: stalled,
    });
    expect(enqueue.mock.calls[1][0]).toMatchObject({
      eventType: 'ChannelOrderCancelStalled',
      idempotencyKey: 'cancel-stalled:req-1:d1',
      payload: stalled,
    });
  });

  it('같은 전달이라도 failureCode 가 다르면 키가 다르다 — 재시도 중 일시 → 영구로 바뀐 결과를 먹지 않는다', async () => {
    const { repository, enqueue } = makeRepository();
    await repository.recordSettlementFailure({ ...fact, retryable: true, failureCode: 'http_500' }, 'd1');
    await repository.recordSettlementFailure(fact, 'd1');
    await repository.recordSettlementFailure(fact, 'd2');
    expect(enqueue.mock.calls.map(([event]) => event.idempotencyKey)).toEqual([
      'settlement-failed:req-1:d1:http_500',
      'settlement-failed:req-1:d1:wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
      'settlement-failed:req-1:d2:wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
    ]);
  });

  it('긴 failureCode 는 키에서 120자로 자른다 — 키 칸은 varchar(255)라 넘치면 적재가 매번 실패한다. 사실의 코드는 그대로다', async () => {
    const { repository, enqueue } = makeRepository();
    const longCode = `wallet_refund_refused:${'X'.repeat(400)}`;
    const requestId = '0192f0aa-0000-7000-8000-000000000001';
    const deliveryId = '0192f0aa-0000-7000-8000-000000000002';
    await repository.recordSettlementFailure({ ...fact, requestId, failureCode: longCode }, deliveryId);
    const [event] = enqueue.mock.calls[0];
    expect(event.idempotencyKey.length).toBeLessThanOrEqual(255);
    expect(event.idempotencyKey).toBe(`settlement-failed:${requestId}:${deliveryId}:${longCode.slice(0, 120)}`);
    expect(event.payload.failureCode).toBe(longCode);
  });

  it('적재가 실패하면 던진다 — 명령을 ack 하지 않고 재배달을 탄다', async () => {
    const { repository, enqueue } = makeRepository();
    enqueue.mockRejectedValueOnce(new Error('outbox down'));
    await expect(repository.recordSettlementFailure(fact, 'd1')).rejects.toThrow('outbox down');
  });
```

`makeRepository` 가 `transaction` 도 돌려주게 마지막 줄을 `return { repository, enqueue, where, transaction };` 로 바꾼다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts`
Expected: FAIL — `repository.recordSettlementFailure is not a function`

- [ ] **Step 3: 구현한다**

`channel-order-cancel.repository.ts` 전체를 아래로 바꾼다:

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  ORDER_STREAM,
  channelOrderPartitionKey,
  type ChannelOrderCancelRejectedPayload,
  type ChannelOrderCancelStalledPayload,
  type ChannelOrderSettlementFailedPayload,
} from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

/**
 * 같은 결과를 옛 core(PR 5 전)가 읽는 말로 한 번 더 — 옛 core 는 `ChannelOrderSettlementFailed` 를 버린다(#1016 36번 재설계 PR 3 판정 1).
 * 오늘의 channel-adapter 가 그 응답에 내던 사실만 싣는다. 정리 PR(§9.2 의 6)에서 지운다.
 */
export type LegacyCancelFact =
  | { eventType: 'ChannelOrderCancelRejected'; payload: ChannelOrderCancelRejectedPayload }
  | { eventType: 'ChannelOrderCancelStalled'; payload: ChannelOrderCancelStalledPayload };

type CancelFactEventType = 'ChannelOrderSettlementFailed' | LegacyCancelFact['eventType'];
type CancelFactPayload = ChannelOrderSettlementFailedPayload | ChannelOrderCancelRejectedPayload | ChannelOrderCancelStalledPayload;

/** 멱등 키에 싣는 실패 코드의 상한 — 키 칸이 varchar(255)다. 넘치면 적재가 매번 실패해 명령이 DLQ 로 간다 */
const KEY_FAILURE_CODE_MAX = 120;

/** 채널 주문 취소 명령의 DB 쪽 — 수집 매핑 확인과 결과 사실의 아웃박스 적재 (#1016 35번 행 · 36번 재설계). */
@Injectable()
export class ChannelOrderCancelRepository {
  constructor(
    private readonly db: DbService<typeof channelAdapterSchema>,
    @InjectPublisher(ORDER_STREAM)
    private readonly orders: PublisherFor<typeof ORDER_STREAM>,
  ) {}

  /** 우리가 수집한 주문인가. 수집하지 않은 주문 id 로 채널을 건드리지 않는다. */
  async hasCollectedOrder(salesChannel: string, externalOrderId: string): Promise<boolean> {
    const [row] = await this.db.db
      .select({ id: wmsOrderMappings.id })
      .from(wmsOrderMappings)
      .where(and(eq(wmsOrderMappings.salesChannel, salesChannel), eq(wmsOrderMappings.channelOrderId, externalOrderId)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * 정산 실패 사실과 (있으면) 옛 사실을 한 트랜잭션에 적재한다 — 하나만 나가는 일이 없다.
   *
   * 멱등 키에 deliveryId(명령 봉투 messageId)를 넣는다 — Kafka 가 같은 메시지를 다시 주면 한 번만 적재되고, core 의 재발행은 새 messageId 라
   * 사실을 다시 낸다(첫 사실이 유실됐어도 두 번째 시도가 빈손이 되지 않는다). 정산 실패 키엔 failureCode 도 넣는다 — 일시 실패는 던져
   * 같은 전달이 재시도되므로(판정 2) 그 사이 결과가 영구 거절로 바뀌면 다른 사실이어야 한다. 따라서 core 는 같은 requestId 의 반복된 사실을 받아야 한다.
   */
  async recordSettlementFailure(
    fact: ChannelOrderSettlementFailedPayload,
    deliveryId: string,
    legacy?: LegacyCancelFact,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // tx 타입은 추론에 맡긴다 — 아웃박스의 DbTx 는 `@app/events` 밖으로 export 되지 않는다(옛 코드도 같은 모양이었다)
      const put = (eventType: CancelFactEventType, idempotencyKey: string, payload: CancelFactPayload) =>
        this.orders.enqueue(
          {
            eventType,
            aggregateId: channelOrderPartitionKey(payload.salesChannel, payload.externalOrderId),
            // 수집 사실(OrderCreated·OrderModified·OrderCancelled)과 같은 파티션 키 — 같은 파티션에 실린다(아웃박스를 거치므로 엄밀한 순서를 주장하진 않는다)
            partitionKey: payload.salesChannel,
            metadata: { partitionKey: payload.salesChannel },
            idempotencyKey,
            payload,
          },
          tx,
        );
      const code = fact.failureCode.slice(0, KEY_FAILURE_CODE_MAX);
      await put('ChannelOrderSettlementFailed', `settlement-failed:${fact.requestId}:${deliveryId}:${code}`, fact);
      if (legacy?.eventType === 'ChannelOrderCancelRejected') {
        await put(legacy.eventType, `cancel-rejected:${legacy.payload.requestId}:${deliveryId}`, legacy.payload);
      } else if (legacy?.eventType === 'ChannelOrderCancelStalled') {
        await put(legacy.eventType, `cancel-stalled:${legacy.payload.requestId}:${deliveryId}`, legacy.payload);
      }
    });
  }
}
```

`eventType`·`payload` 를 따로 받는 모양은 옛 `enqueueFact` 와 같다 — `enqueue<K>` 가 합집합 K 로 추론되는 것은 옛 코드가 이미 컴파일로 보였다.
`type-check` 가 합집합 payload 를 거부하면 `as` 로 맞추지 말고 `put` 을 이벤트 타입마다 한 번씩 직접 `this.orders.enqueue({ eventType: '…', … }, tx)` 로 펼친다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

`type-check` 는 매니저(`recordRejected`·`recordStalled` 호출)에서만 빨간 것이 정상이다 — 그 밖의 에러가 없는지 본다:
Run: `npm run type-check 2>&1 | grep "error TS" | grep -v "channel-order-cancel.manager"`
Expected: 출력 없음

```bash
git add apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.ts apps/channel-adapter/src/services/order-cancel/channel-order-cancel.repository.spec.ts
git commit -m "feat(channel-adapter): #1016 36번 재설계 PR 3 — 정산 실패 사실과 옛 사실을 한 트랜잭션에 적재"
```

---

### Task 3: MedusaClient — 정산 라우트 호출과 응답 → 결과 종류

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:241-271`(타입·`MedusaHttpError`·정규식), `:1934-1955`(`cancelOrder`), `:2584-2627`(`partialCancelOrder`)
- Test: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts:1464-`(`describe('MedusaClient 취소 (#1016 35번 PR-B)'`)

**Interfaces:**
- Consumes: Task 1 의 `ChannelCancelRefundMode`
- Produces:
  ```ts
  type MedusaSettlementTransient = { kind: 'transient'; failureCode: string; message: string };
  type MedusaRefundRefused = { kind: 'refund_refused'; failureCode: string; message: string };
  export type MedusaCancelOutcome =
    | { kind: 'cancelled' } | { kind: 'already_cancelled' } | MedusaRefundRefused
    | { kind: 'not_found'; message: string }
    | { kind: 'not_cancelable'; failureCode: string; message: string }
    | MedusaSettlementTransient;
  export type MedusaPartialCancelOutcome =
    | { kind: 'cancelled'; refundAmount: number | null; shippingDelta: number | null; shippingNotAdjusted: boolean }
    | { kind: 'rejected'; message: string }
    | { kind: 'external_refund'; reason: string; message: string; unresolvedAmount: number }
    | (MedusaRefundRefused & { edited: boolean })
    | { kind: 'refund_pending'; message: string }
    | { kind: 'not_cancelable'; failureCode: string; message: string }
    | MedusaSettlementTransient;
  cancelOrder(orderId: string, input: { refundMode: ChannelCancelRefundMode }): Promise<MedusaCancelOutcome>
  partialCancelOrder(orderId: string, input: { requestId: string; items: Array<{ itemId: string; quantity: number }>; alreadyRefunded?: number; refundMode: ChannelCancelRefundMode }): Promise<MedusaPartialCancelOutcome>
  ```
  두 메서드는 **던지지 않는다**(연결 실패도 `transient`·`network`). `MedusaHttpError` 는 지운다(호출자 0 — `grep -rn MedusaHttpError apps/channel-adapter/src` 가 이 파일과 스펙뿐).
  `refundMode` 가 필수 인자라 매니저 호출부 두 곳이 컴파일되지 않는다 — **이 태스크에서 매니저 호출 두 줄만** `{ refundMode: command.refundMode ?? 'auto' }` 를 넘기게 고친다
  (매핑 본체는 Task 4).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`medusa.client.spec.ts` 의 `describe('MedusaClient 취소 (#1016 35번 PR-B)'` 이름을 `'MedusaClient 취소 (#1016 35번 PR-B · 36번 재설계 PR 3)'` 로 바꾸고,
안의 `describe('cancelOrder'` 와 `describe('partialCancelOrder'` 두 블록 **전체**를 아래로 바꾼다(`makeClient`·`respond`·`afterEach` 는 그대로).
`MedusaHttpError`·`isTransientMedusaError` import 가 이 블록에서만 쓰였으면 import 줄에서 지운다(`grep -n "MedusaHttpError\|isTransientMedusaError" medusa.client.spec.ts` 로 확인).

```ts
  const lastBody = () => JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

  describe('cancelOrder — 채널 취소 라우트(#1016 36번 재설계 §6.1)', () => {
    const auto = { refundMode: 'auto' as const };

    it('채널 취소 라우트에 Basic 인증과 refundMode 를 POST 한다 — 기본 /cancel 은 환불 오류를 삼켜 환불 없이 취소한다', async () => {
      global.fetch = respond(200, { orderId: 'order_1', status: 'canceled', refund: { mode: 'auto', amount: 30000 } });
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({ kind: 'cancelled' });
      expect(global.fetch).toHaveBeenCalledWith(
        'http://medusa.local/admin/orders/order_1/channel-cancel',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('sk_test:').toString('base64')}` }),
        }),
      );
      expect(lastBody()).toEqual({ refundMode: 'auto' });
    });

    it('manual 도 그대로 싣는다', async () => {
      global.fetch = respond(200, { orderId: 'order_1', status: 'canceled', refund: { mode: 'manual', amount: 30000 } });
      await makeClient().cancelOrder('order_1', { refundMode: 'manual' });
      expect(lastBody()).toEqual({ refundMode: 'manual' });
    });

    it('«이미 취소됨» 400 은 성공 쪽이다', async () => {
      global.fetch = respond(400, { type: 'invalid_data', message: 'Order with id order_1 has been canceled.' });
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({ kind: 'already_cancelled' });
    });

    it('400 표지 wallet_refund_refused:* 는 환불 거절 — 코드는 표지 그대로, 문장은 wallet 이 준 그대로', async () => {
      global.fetch = respond(400, {
        type: 'not_allowed',
        code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불할 수 없는 결제수단입니다',
      });
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({
        kind: 'refund_refused',
        failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불할 수 없는 결제수단입니다',
      });
    });

    it.each([
      [{ type: 'not_allowed', message: 'Order order_1 already has an existing active order change' }, 'not_allowed'],
      [{ type: 'not_allowed', message: 'All fulfillments must be canceled before canceling an order' }, 'not_allowed'],
      [{ type: 'invalid_data', message: "refundMode 는 'auto' 또는 'manual' 이어야 합니다" }, 'invalid_data'],
      [{ type: 'not_allowed', code: 'something_else', message: 'x' }, 'something_else'],
      [{ type: 'invalid_data', message: 'Return with id ret_1 has been canceled.' }, 'invalid_data'],
    ])('그 밖의 400(%o)은 취소 불가 — failureCode 는 code ?? type', async (body, failureCode) => {
      global.fetch = respond(400, body);
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({
        kind: 'not_cancelable',
        failureCode,
        message: body.message,
      });
    });

    it('본문 없는 400 은 취소 불가 http_400', async () => {
      global.fetch = respond(400, undefined);
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({
        kind: 'not_cancelable',
        failureCode: 'http_400',
        message: 'status 400',
      });
    });

    it('404 type=not_found 는 주문 없음', async () => {
      global.fetch = respond(404, { type: 'not_found', message: 'Order id not found: order_1' });
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({
        kind: 'not_found',
        message: 'Order id not found: order_1',
      });
    });

    it.each([
      [404, undefined, 'http_404'],
      [500, { type: 'unknown_error', message: 'An unknown error occurred.' }, 'http_500'],
      [502, undefined, 'http_502'],
      [401, { message: 'Unauthorized' }, 'http_401'],
      [409, { type: 'conflict', message: 'locked' }, 'http_409'],
      [422, { type: 'duplicate_error', message: 'dup' }, 'http_422'],
    ])('%i(본문 %o)은 일시 실패 %s — 본문 없는 404 는 라우트 없는 옛 Medusa 다', async (status, body, failureCode) => {
      global.fetch = respond(status, body);
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({
        kind: 'transient',
        failureCode,
        message: (body as { message?: string } | undefined)?.message ?? `status ${status}`,
      });
    });

    it('연결 실패는 던지지 않고 일시 실패 network 다', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })) as any;
      await expect(makeClient().cancelOrder('order_1', auto)).resolves.toEqual({
        kind: 'transient',
        failureCode: 'network',
        message: expect.stringContaining('fetch failed'),
      });
    });
  });

  describe('partialCancelOrder', () => {
    const input = { requestId: 'req-1', items: [{ itemId: 'ordli_1', quantity: 2 }], refundMode: 'auto' as const };

    it('부분취소 라우트에 item_id·취소할 수량·refundMode 를 보낸다', async () => {
      global.fetch = respond(200, {
        requestId: 'req-1', refundAmount: 27500, shippingDelta: -3000, shippingNotAdjusted: false, stage: 'refunded', refund: { mode: 'auto', amount: 27500 },
      });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'cancelled',
        refundAmount: 27500,
        shippingDelta: -3000,
        shippingNotAdjusted: false,
      });
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://medusa.local/admin/orders/order_1/partial-cancel');
      expect(lastBody()).toEqual({ requestId: 'req-1', items: [{ item_id: 'ordli_1', quantity: 2 }], refundMode: 'auto' });
    });

    it('이미 환불한 금액은 already_refunded 로 싣고, manual 도 그대로 싣는다', async () => {
      global.fetch = respond(200, { requestId: 'req-1', refundAmount: 20000, shippingDelta: 0, shippingNotAdjusted: false, stage: 'refunded' });
      await makeClient().partialCancelOrder('order_1', { ...input, alreadyRefunded: 10000, refundMode: 'manual' });
      expect(lastBody()).toEqual({
        requestId: 'req-1',
        items: [{ item_id: 'ordli_1', quantity: 2 }],
        already_refunded: 10000,
        refundMode: 'manual',
      });
    });

    it('external_refund_* 사유의 거절은 사유·금액과 함께 따로 돌려준다', async () => {
      global.fetch = respond(400, {
        type: 'not_allowed', code: 'partial_cancel_rejected', reason: 'external_refund_unresolved', unresolvedAmount: 10000, message: '외부 환불 10,000원',
      });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'external_refund', reason: 'external_refund_unresolved', message: '외부 환불 10,000원', unresolvedAmount: 10000,
      });
    });

    it('미해결 금액이 소수로 오면 원 단위로 반올림한다 — 계약은 0 이상 정수다', async () => {
      global.fetch = respond(400, {
        type: 'not_allowed', code: 'partial_cancel_rejected', reason: 'external_refund_unresolved', unresolvedAmount: 9999.6, message: '외부 환불',
      });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toMatchObject({ kind: 'external_refund', unresolvedAmount: 10000 });
    });

    it('code=partial_cancel_rejected 는 정해진 거절이다', async () => {
      global.fetch = respond(400, { type: 'not_allowed', code: 'partial_cancel_rejected', message: '수량이 남은 수량보다 많습니다' });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({ kind: 'rejected', message: '수량이 남은 수량보다 많습니다' });
    });

    it('400 표지 + stage edited 는 «수정은 확정됐고 환불만 거절»', async () => {
      global.fetch = respond(400, {
        type: 'not_allowed', code: 'wallet_refund_refused:ALREADY_CANCELED_PAYMENT', stage: 'edited', requestId: 'req-1', message: '이미 취소된 결제입니다',
      });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'refund_refused',
        failureCode: 'wallet_refund_refused:ALREADY_CANCELED_PAYMENT',
        message: '이미 취소된 결제입니다',
        edited: true,
      });
    });

    it('표지는 있는데 stage 가 없으면 edited 가 아니다 — 수정됐다고 지어내지 않는다', async () => {
      global.fetch = respond(400, { type: 'not_allowed', code: 'wallet_refund_refused:X', message: '거절' });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'refund_refused', failureCode: 'wallet_refund_refused:X', message: '거절', edited: false,
      });
    });

    it('502 refund_pending 은 환불 미완 결과다', async () => {
      global.fetch = respond(502, { type: 'refund_pending', stage: 'edited', requestId: 'req-1', message: '환불이 끝나지 않았습니다' });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({ kind: 'refund_pending', message: '환불이 끝나지 않았습니다' });
    });

    it.each([
      [{ type: 'not_allowed', message: 'Order order_1 already has an existing active order change' }, 400, 'not_allowed'],
      [{ type: 'invalid_data', message: 'items 가 비어 있습니다' }, 400, 'invalid_data'],
      [{ type: 'not_found', message: 'Order id not found: order_1' }, 404, 'not_found'],
    ])('Medusa 자신의 거절(%o)은 취소 불가 — failureCode 는 code ?? type', async (body, status, failureCode) => {
      global.fetch = respond(status, body);
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({ kind: 'not_cancelable', failureCode, message: body.message });
    });

    it.each([
      [404, undefined, 'http_404'],
      [502, undefined, 'http_502'],
      [500, { type: 'unknown_error', message: 'An unknown error occurred.' }, 'http_500'],
      [401, { message: 'Unauthorized' }, 'http_401'],
    ])('%i(본문 %o)은 일시 실패 %s — 본문 없는 502 는 ALB, 404 는 라우트 없는 옛 Medusa', async (status, body, failureCode) => {
      global.fetch = respond(status, body);
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'transient',
        failureCode,
        message: (body as { message?: string } | undefined)?.message ?? `status ${status}`,
      });
    });

    it('연결 실패는 일시 실패 network 다', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed')) as any;
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toMatchObject({ kind: 'transient', failureCode: 'network' });
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts -t "취소"`
Expected: FAIL — 경로가 `/cancel`, 본문에 `refundMode` 없음, 5xx 가 reject 됨 등.

- [ ] **Step 3: 타입과 상수를 바꾼다**

`medusa.client.ts` 맨 위 import 묶음에 더한다(이미 `@packages/event-contracts/streams` import 가 있으면 거기에 이름만 더한다):

```ts
import type { ChannelCancelRefundMode } from '@packages/event-contracts/streams';
```

`:241-271`(`MedusaCancelOutcome` 부터 `ALREADY_CANCELLED_MESSAGE` 까지)을 아래로 바꾼다:

```ts
/**
 * 정해진 결과로 읽지 못한 응답 — 일시 실패(#1016 36번 재설계 §7.2). 5xx·본문 없는 404(라우트 없는 옛 Medusa)·본문 없는 502(ALB)·
 * 예상 밖 상태(401·409·422…)·연결 실패. `failureCode` 는 `http_<status>` 또는 `network`.
 */
type MedusaSettlementTransient = { kind: 'transient'; failureCode: string; message: string };

/** wallet·PG 의 영구 환불 거절 — `failureCode` 는 Medusa 표지 그대로(`wallet_refund_refused:<wallet 코드>`), 문장은 wallet 이 준 그대로(PR 2 D5) */
type MedusaRefundRefused = { kind: 'refund_refused'; failureCode: string; message: string };

/** Medusa 전체취소(`channel-cancel`) 결과. 던지지 않는다 — 모든 응답이 값이다. */
export type MedusaCancelOutcome =
  | { kind: 'cancelled' }
  | { kind: 'already_cancelled' }
  | MedusaRefundRefused
  | { kind: 'not_found'; message: string }
  /** 환불 전 사전검사(진행 중인 주문 변경·안 취소된 출고)와 본문 오류. `failureCode` 는 Medusa code ?? type */
  | { kind: 'not_cancelable'; failureCode: string; message: string }
  | MedusaSettlementTransient;

/** Medusa 부분취소 결과. 던지지 않는다. `refund_pending` = 주문 수정은 확정됐고 환불이 남았다 — 같은 requestId 로 다시 부르면 이어 간다. */
export type MedusaPartialCancelOutcome =
  | { kind: 'cancelled'; refundAmount: number | null; shippingDelta: number | null; shippingNotAdjusted: boolean }
  | { kind: 'rejected'; message: string }
  /** 품목에 연결 안 된 외부 환불이 있어 «이미 환불한 금액»이 필요하다(#1016 37번). `reason` 은 Medusa 의 `external_refund_*` 그대로 */
  | { kind: 'external_refund'; reason: string; message: string; unresolvedAmount: number }
  /** `edited` = 응답이 `stage: 'edited'` 를 실었다(수정은 확정됐고 환불만 거절). 없으면 수정됐다고 지어내지 않는다 */
  | (MedusaRefundRefused & { edited: boolean })
  | { kind: 'refund_pending'; message: string }
  /** Medusa 자신의 400(다른 주문 수정이 열려 있음·본문 오류)·404 not_found. `failureCode` 는 code ?? type */
  | { kind: 'not_cancelable'; failureCode: string; message: string }
  | MedusaSettlementTransient;

/**
 * 코어 `throwIfOrderIsCancelled` 의 문구(`Order with id … has been canceled.`, `@medusajs/core-flows` 2.13.4). 채널 취소 라우트도 같은 문장을 낸다.
 * Medusa 를 올릴 때 확인할 것 — 바뀌면 재전달된 전체취소 명령이 취소 불가로 닫힌다.
 */
const ALREADY_CANCELLED_MESSAGE = /^Order with id .+ has been canceled\.$/;

/**
 * wallet 영구 거절의 표지 — Medusa `src/modules/almond-payment/wallet-refund-refusal.ts` 의 `WALLET_REFUND_REFUSED_PREFIX`.
 * 앱 경계라 import 하지 않고 같은 문자열을 둔다. 영구·일시 분류의 정본은 wallet 이고 여기선 표지만 읽는다(스펙 S6).
 */
const WALLET_REFUND_REFUSED_PREFIX = 'wallet_refund_refused:';

/** 응답 본문의 Medusa 오류 식별자 — 우리 code 가 있으면 그것, 없으면 Medusa type, 그것도 없으면 상태 */
function medusaErrorCode(status: number, body: Record<string, unknown>): string {
  if (typeof body.code === 'string' && body.code.length > 0) return body.code;
  if (typeof body.type === 'string' && body.type.length > 0) return body.type;
  return `http_${status}`;
}

function isWalletRefundRefusal(body: Record<string, unknown>): body is Record<string, unknown> & { code: string } {
  return typeof body.code === 'string' && body.code.startsWith(WALLET_REFUND_REFUSED_PREFIX);
}
```

(`isJsonObject` 함수는 그대로 둔다. `MedusaHttpError` 클래스는 지운다.)

- [ ] **Step 4: `cancelOrder` 를 바꾼다**

`:1934-1955` 의 주석과 메서드를 아래로 바꾼다:

```ts
  /**
   * 전체취소 — 우리 채널 취소 라우트(#1016 36번 재설계 §6.1, Medusa PR 2). 기본 /cancel 은 환불 오류를 삼켜 환불 없이 주문을 취소하므로
   * 쓰지 않는다(스펙 §2.2). 라우트는 «환불 → 취소» 순서라 영구 거절이면 주문은 취소되지 않는다.
   * 멱등은 «이미 취소됨»과 «남은 몫만 환불»(장부 맞추기)로 선다 — 같은 명령을 다시 불러도 환불은 한 번이다.
   * 던지지 않는다: 모든 응답·연결 실패가 결과 종류다. 분류는 라우트 머리 주석의 응답 계약을 따른다.
   */
  async cancelOrder(orderId: string, input: { refundMode: ChannelCancelRefundMode }): Promise<MedusaCancelOutcome> {
    const path = `/admin/orders/${encodeURIComponent(orderId)}/channel-cancel`;
    let response: { status: number; body: Record<string, unknown> };
    try {
      response = await this.postAdmin(path, { refundMode: input.refundMode });
    } catch (error) {
      return { kind: 'transient', failureCode: 'network', message: error instanceof Error ? error.message : String(error) };
    }
    const { status, body } = response;
    const message = typeof body.message === 'string' ? body.message : `status ${status}`;
    if (status >= 200 && status < 300) {
      this.logger.log(`Cancelled Medusa order: ${orderId} (refundMode=${input.refundMode})`);
      return { kind: 'cancelled' };
    }
    if (status === 400) {
      if (isWalletRefundRefusal(body)) return { kind: 'refund_refused', failureCode: body.code, message };
      if (ALREADY_CANCELLED_MESSAGE.test(message)) return { kind: 'already_cancelled' };
      return { kind: 'not_cancelable', failureCode: medusaErrorCode(status, body), message };
    }
    // 본문 없는 404 는 게이트웨이·오라우팅·라우트 없는 옛 Medusa 다 — 주문 없음으로 읽지 않는다
    if (status === 404 && body.type === 'not_found') return { kind: 'not_found', message };
    this.logger.error(`Failed to cancel Medusa order: ${orderId} (status=${status})`, message);
    return { kind: 'transient', failureCode: `http_${status}`, message };
  }
```

- [ ] **Step 5: `partialCancelOrder` 를 바꾼다**

`:2584-2627` 의 주석과 메서드를 아래로 바꾼다:

```ts
  /**
   * 부분취소(PR-A 라우트 + 36번 재설계 PR 2). 정해진 거절은 `code === 'partial_cancel_rejected'`, 영구 환불 거절은 표지 `wallet_refund_refused:*` 다 —
   * Medusa 자신의 not_allowed(다른 주문 수정이 열려 있음 등)도 같은 400 type 이라 type 이 아니라 code 로 가른다.
   * 그 거절의 `reason` 이 `external_refund_*` 면 «이미 환불한 금액»을 묻는 거절이다(#1016 37번).
   * 던지지 않는다: 본문 없는 404·502, 5xx, 예상 밖 상태, 연결 실패는 일시 실패 값이다.
   */
  async partialCancelOrder(
    orderId: string,
    input: {
      requestId: string;
      items: Array<{ itemId: string; quantity: number }>;
      alreadyRefunded?: number;
      refundMode: ChannelCancelRefundMode;
    },
  ): Promise<MedusaPartialCancelOutcome> {
    const path = `/admin/orders/${encodeURIComponent(orderId)}/partial-cancel`;
    let response: { status: number; body: Record<string, unknown> };
    try {
      response = await this.postAdmin(path, {
        requestId: input.requestId,
        items: input.items.map((item) => ({ item_id: item.itemId, quantity: item.quantity })),
        ...(input.alreadyRefunded !== undefined ? { already_refunded: input.alreadyRefunded } : {}),
        refundMode: input.refundMode,
      });
    } catch (error) {
      return { kind: 'transient', failureCode: 'network', message: error instanceof Error ? error.message : String(error) };
    }
    const { status, body } = response;
    const message = typeof body.message === 'string' ? body.message : `status ${status}`;
    if (status >= 200 && status < 300) {
      return {
        kind: 'cancelled',
        refundAmount: typeof body.refundAmount === 'number' ? body.refundAmount : null,
        shippingDelta: typeof body.shippingDelta === 'number' ? body.shippingDelta : null,
        shippingNotAdjusted: body.shippingNotAdjusted === true,
      };
    }
    if (status === 400 && body.code === 'partial_cancel_rejected') {
      if (typeof body.reason === 'string' && body.reason.startsWith('external_refund_')) {
        return {
          kind: 'external_refund',
          reason: body.reason,
          message,
          // Medusa 의 미해결 금액은 BigNumber 합이라 소수가 섞일 수 있다 — 계약(.int().nonnegative())에 맞춰 원 단위로 편다
          unresolvedAmount:
            typeof body.unresolvedAmount === 'number' && Number.isFinite(body.unresolvedAmount)
              ? Math.max(0, Math.round(body.unresolvedAmount))
              : 0,
        };
      }
      return { kind: 'rejected', message };
    }
    if (status === 400 && isWalletRefundRefusal(body)) {
      return { kind: 'refund_refused', failureCode: body.code, message, edited: body.stage === 'edited' };
    }
    // 본문으로 가린다 — ALB 가 Medusa 다운 때 내는 502 에는 이 본문이 없다
    if (status === 502 && body.type === 'refund_pending') return { kind: 'refund_pending', message };
    if (status === 400 || (status === 404 && body.type === 'not_found')) {
      return { kind: 'not_cancelable', failureCode: medusaErrorCode(status, body), message };
    }
    this.logger.error(`Failed to partial-cancel Medusa order: ${orderId} (status=${status}, type=${String(body.type)})`, message);
    return { kind: 'transient', failureCode: `http_${status}`, message };
  }
```

- [ ] **Step 6: 매니저 호출부 두 줄만 맞춘다**

`channel-order-cancel.manager.ts` 에서:

```ts
    const outcome = await this.medusaClient.cancelOrder(command.externalOrderId, { refundMode: command.refundMode ?? 'auto' });
```

와 `partialCancelOrder` 호출 객체의 `...(command.alreadyRefundedAmount …)` 줄 아래에 `refundMode: command.refundMode ?? 'auto',` 를 더한다. 매핑(switch)은 Task 4 가 다시 쓴다.

- [ ] **Step 7: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`
Expected: PASS (파일 전체 — 취소 밖 테스트도 깨지지 않았는지)

Run: `npm run type-check 2>&1 | grep "error TS" | grep -v "channel-order-cancel.manager"`
Expected: 출력 없음(매니저는 Task 2 의 `recordRejected` 삭제와 새 결과 종류로 빨간 것이 정상)

- [ ] **Step 8: 커밋**

```bash
git add apps/channel-adapter/src/adapters/medusa/medusa.client.ts apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts
git commit -m "feat(channel-adapter): #1016 36번 재설계 PR 3 — 전체취소는 채널 취소 라우트로, 정산 응답을 결과 종류로"
```

---

### Task 4: 매니저 — 결과 종류 → 정산 실패 사실(+옛 사실), ack/던짐

**Files:**
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts`
- Test: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`

**Interfaces:**
- Consumes: Task 2 `recordSettlementFailure(fact, deliveryId, legacy?)`·`LegacyCancelFact`, Task 3 `MedusaCancelOutcome`·`MedusaPartialCancelOutcome`·두 메서드의 `refundMode` 인자
- Produces: `execute(command, deliveryId): Promise<void>` — 시그니처 그대로(소비자 `channel-orders-command.consumer.ts` 는 안 바뀐다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`channel-order-cancel.manager.spec.ts` 를 아래로 통째로 바꾼다. 판정 1 표의 모든 줄 + `refundMode` 전달 + 적재 실패 + `at`:

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts
import type { CancelChannelOrderPayload } from '@packages/event-contracts/streams';
import { Logger } from '@nestjs/common';
import { ChannelOrderCancelManager } from './channel-order-cancel.manager';

const full: CancelChannelOrderPayload = {
  requestId: 'req-1',
  salesChannel: 'medusa',
  externalOrderId: 'order_1',
  scope: 'full',
  requestedBy: 'operator',
  requestedAt: '2026-10-07T00:00:00.000Z',
};
const partial: CancelChannelOrderPayload = {
  ...full,
  scope: 'partial',
  lines: [{ channelOrderItemId: 'ordli_1', quantity: 2 }],
};
const key = { requestId: 'req-1', salesChannel: 'medusa', externalOrderId: 'order_1' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function setup(opts: { mapped?: boolean } = {}) {
  const repository = {
    hasCollectedOrder: jest.fn().mockResolvedValue(opts.mapped ?? true),
    recordSettlementFailure: jest.fn().mockResolvedValue(undefined),
  };
  const medusa = { cancelOrder: jest.fn(), partialCancelOrder: jest.fn() };
  const poller = { syncOrder: jest.fn().mockResolvedValue({ outcome: 'emitted' }) };
  const manager = new ChannelOrderCancelManager(repository as never, medusa as never, poller as never);
  return { manager, repository, medusa, poller };
}

/** recordSettlementFailure 의 [사실, 전달 id, 옛 사실] */
function recorded(repository: ReturnType<typeof setup>['repository']) {
  expect(repository.recordSettlementFailure).toHaveBeenCalledTimes(1);
  const [fact, deliveryId, legacy] = repository.recordSettlementFailure.mock.calls[0];
  return { fact, deliveryId, legacy };
}

const cancelledPartial = { kind: 'cancelled', refundAmount: 0, shippingDelta: 0, shippingNotAdjusted: false };

describe('ChannelOrderCancelManager (#1016 35번 PR-B · 36번 재설계 PR 3)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  describe('사전검사', () => {
    it.each(['naver', 'coupang', '3pl', 'cafe24'])(
      '자동 취소 불가 채널(%s)은 영구 정산 실패 + 옛 NOT_SUPPORTED — 채널을 부르지 않는다',
      async (salesChannel) => {
        const { manager, repository, medusa, poller } = setup();
        await manager.execute({ ...full, salesChannel }, 'd1');
        const { fact, legacy } = recorded(repository);
        expect(fact).toMatchObject({ salesChannel, retryable: false, failureCode: 'channel_not_supported', scope: 'full' });
        expect(legacy).toEqual({
          eventType: 'ChannelOrderCancelRejected',
          payload: expect.objectContaining({ salesChannel, reasonCode: 'NOT_SUPPORTED' }),
        });
        expect(repository.hasCollectedOrder).not.toHaveBeenCalled();
        expect(medusa.cancelOrder).not.toHaveBeenCalled();
        expect(poller.syncOrder).not.toHaveBeenCalled();
      },
    );

    it('수집한 적 없는 주문은 영구 정산 실패 order_not_collected + 옛 ORDER_NOT_FOUND', async () => {
      const { manager, repository, medusa } = setup({ mapped: false });
      await manager.execute(full, 'd1');
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ ...key, retryable: false, failureCode: 'order_not_collected' });
      expect(legacy).toMatchObject({ eventType: 'ChannelOrderCancelRejected', payload: { ...key, reasonCode: 'ORDER_NOT_FOUND' } });
      expect(medusa.cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe('refundMode 전달', () => {
    it('명령에 없으면 auto 로 보낸다 — 옛 core 의 명령이다', async () => {
      const { manager, medusa } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      medusa.partialCancelOrder.mockResolvedValue(cancelledPartial);
      await manager.execute(full, 'd1');
      await manager.execute(partial, 'd2');
      expect(medusa.cancelOrder).toHaveBeenCalledWith('order_1', { refundMode: 'auto' });
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', {
        requestId: 'req-1',
        items: [{ itemId: 'ordli_1', quantity: 2 }],
        refundMode: 'auto',
      });
    });

    it('manual 은 그대로, 같은 requestId 로 보낸다 — Medusa 가 같은 요청의 환불을 한 번으로 접는다', async () => {
      const { manager, medusa } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      medusa.partialCancelOrder.mockResolvedValue(cancelledPartial);
      await manager.execute({ ...full, refundMode: 'manual' }, 'd1');
      await manager.execute({ ...partial, refundMode: 'manual', alreadyRefundedAmount: 10000 }, 'd2');
      expect(medusa.cancelOrder).toHaveBeenCalledWith('order_1', { refundMode: 'manual' });
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', {
        requestId: 'req-1',
        items: [{ itemId: 'ordli_1', quantity: 2 }],
        alreadyRefunded: 10000,
        refundMode: 'manual',
      });
    });
  });

  describe('전체취소', () => {
    it.each([{ kind: 'cancelled' }, { kind: 'already_cancelled' }])('$kind 면 사실 없이 즉시 재수집한다', async (outcome) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full, 'd1');
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
      expect(repository.recordSettlementFailure).not.toHaveBeenCalled();
    });

    it('wallet 영구 거절은 영구 정산 실패 — 옛 사실은 내지 않는다(옛 core 의 Rejected 는 보류를 풀어 출고한다)', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({
        kind: 'refund_refused',
        failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불할 수 없는 결제수단입니다',
      });
      await manager.execute(full, 'd1');
      const { fact, deliveryId, legacy } = recorded(repository);
      expect(fact).toEqual({
        ...key,
        scope: 'full',
        retryable: false,
        failureCode: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불할 수 없는 결제수단입니다',
        at: expect.stringMatching(ISO),
      });
      expect(deliveryId).toBe('d1');
      expect(legacy).toBeUndefined();
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it.each([
      [{ kind: 'not_found', message: 'gone' }, 'not_found', 'ORDER_NOT_FOUND'],
      [{ kind: 'not_cancelable', failureCode: 'not_allowed', message: 'fulfilled' }, 'not_allowed', 'NOT_CANCELABLE'],
    ])('%o 는 영구 정산 실패 %s + 옛 %s, 재수집하지 않는다', async (outcome, failureCode, reasonCode) => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue(outcome);
      await manager.execute(full, 'd1');
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ retryable: false, failureCode, message: outcome.message });
      expect(legacy).toEqual({ eventType: 'ChannelOrderCancelRejected', payload: { ...key, reasonCode, message: outcome.message } });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it.each(['http_500', 'http_404', 'network'])(
      '일시 실패 %s 는 사실을 «먼저» 내고 던진다 — Kafka 재시도를 탄다(PR 6 까지). 옛 사실은 없다',
      async (failureCode) => {
        const { manager, repository, medusa, poller } = setup();
        medusa.cancelOrder.mockResolvedValue({ kind: 'transient', failureCode, message: 'down' });
        await expect(manager.execute(full, 'd1')).rejects.toThrow(/req-1/);
        const { fact, legacy } = recorded(repository);
        expect(fact).toMatchObject({ retryable: true, failureCode, message: 'down', scope: 'full' });
        expect(legacy).toBeUndefined();
        expect(poller.syncOrder).not.toHaveBeenCalled();
      },
    );

    it('취소는 됐는데 재수집이 실패하면 던진다 — 재시도의 취소는 «이미 취소됨»이라 멱등이다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      poller.syncOrder.mockRejectedValue(new Error('Medusa retrieveOrder failed'));
      await expect(manager.execute(full, 'd1')).rejects.toThrow('retrieveOrder');
      expect(repository.recordSettlementFailure).not.toHaveBeenCalled();
    });

    it.each(['channel_inactive', 'not_found'])('취소 뒤 재수집이 %s 면 warn 으로 남긴다 — 돌아가는 사실이 없다', async (outcome) => {
      const { manager, medusa, poller } = setup();
      medusa.cancelOrder.mockResolvedValue({ kind: 'cancelled' });
      poller.syncOrder.mockResolvedValue({ outcome });
      await manager.execute(full, 'd1');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`재수집 ${outcome}`));
    });
  });

  describe('부분취소', () => {
    it('성공이면 사실 없이 재수집한다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ ...cancelledPartial, refundAmount: 1000 });
      await manager.execute(partial, 'd1');
      expect(medusa.cancelOrder).not.toHaveBeenCalled();
      expect(poller.syncOrder).toHaveBeenCalledWith('medusa', 'order_1', { force: true });
      expect(repository.recordSettlementFailure).not.toHaveBeenCalled();
    });

    it('정해진 거절은 영구 정산 실패 partial_cancel_rejected + 옛 NOT_CANCELABLE', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'rejected', message: '수량 초과' });
      await manager.execute(partial, 'd1');
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ scope: 'partial', retryable: false, failureCode: 'partial_cancel_rejected', message: '수량 초과' });
      expect(legacy).toEqual({ eventType: 'ChannelOrderCancelRejected', payload: { ...key, reasonCode: 'NOT_CANCELABLE', message: '수량 초과' } });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('외부 환불 거절은 영구 정산 실패(사유 그대로) + 옛 EXTERNAL_REFUND_UNRESOLVED·금액 — 라이브 37번 흐름이 그대로 산다', async () => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({
        kind: 'external_refund',
        reason: 'external_refund_unresolved',
        message: '외부 환불 10,000원',
        unresolvedAmount: 10000,
      });
      await manager.execute(partial, 'd1');
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ retryable: false, failureCode: 'external_refund_unresolved', message: '외부 환불 10,000원' });
      expect(legacy).toEqual({
        eventType: 'ChannelOrderCancelRejected',
        payload: { ...key, reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', unresolvedRefundAmount: 10000 },
      });
    });

    it('수정 뒤 wallet 영구 거절은 영구 정산 실패 + 옛 Stalled(edited) — 던지지 않는다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({
        kind: 'refund_refused',
        failureCode: 'wallet_refund_refused:ALREADY_CANCELED_PAYMENT',
        message: '이미 취소된 결제입니다',
        edited: true,
      });
      await manager.execute(partial, 'd1');
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ scope: 'partial', retryable: false, failureCode: 'wallet_refund_refused:ALREADY_CANCELED_PAYMENT' });
      expect(legacy).toEqual({ eventType: 'ChannelOrderCancelStalled', payload: { ...key, stage: 'edited', message: '이미 취소된 결제입니다' } });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('영구 거절인데 edited 가 아니면 옛 사실을 내지 않는다 — 옛 core 가 «이미 줄었다»로 접기를 막게 하지 않는다', async () => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'refund_refused', failureCode: 'wallet_refund_refused:X', message: '거절', edited: false });
      await manager.execute(partial, 'd1');
      expect(recorded(repository).legacy).toBeUndefined();
    });

    it('환불 미완(502)은 일시 정산 실패 refund_pending + 옛 Stalled 를 «먼저» 내고 던진다', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'refund_pending', message: 'PG down' });
      await expect(manager.execute(partial, 'd1')).rejects.toThrow(/req-1/);
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ retryable: true, failureCode: 'refund_pending', message: 'PG down' });
      expect(legacy).toEqual({ eventType: 'ChannelOrderCancelStalled', payload: { ...key, stage: 'edited', message: 'PG down' } });
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });

    it('Medusa 자신의 거절은 영구 정산 실패 + ack, 옛 사실 없음(옛 adapter 는 던졌다 — 옛 Rejected 는 보류를 푼다)', async () => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({
        kind: 'not_cancelable',
        failureCode: 'not_allowed',
        message: 'Order order_1 already has an existing active order change',
      });
      await manager.execute(partial, 'd1');
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ retryable: false, failureCode: 'not_allowed' });
      expect(legacy).toBeUndefined();
    });

    it.each(['http_502', 'http_404', 'network'])('일시 실패 %s 는 사실을 낸 뒤 던진다, 옛 사실 없음', async (failureCode) => {
      const { manager, repository, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'transient', failureCode, message: 'down' });
      await expect(manager.execute(partial, 'd1')).rejects.toThrow(/req-1/);
      const { fact, legacy } = recorded(repository);
      expect(fact).toMatchObject({ scope: 'partial', retryable: true, failureCode });
      expect(legacy).toBeUndefined();
    });

    it('줄 없는 부분취소가 스키마를 뚫고 오면 던진다 — 빈 요청을 Medusa 에 보내지 않는다', async () => {
      const { manager, medusa } = setup();
      await expect(manager.execute({ ...partial, lines: undefined }, 'd1')).rejects.toThrow();
      expect(medusa.partialCancelOrder).not.toHaveBeenCalled();
    });
  });

  it('사실 적재가 실패하면 영구 실패라도 던진다 — ack 하지 않고 재배달을 탄다', async () => {
    const { manager, repository, medusa } = setup();
    medusa.cancelOrder.mockResolvedValue({ kind: 'not_found', message: 'gone' });
    repository.recordSettlementFailure.mockRejectedValue(new Error('outbox down'));
    await expect(manager.execute(full, 'd1')).rejects.toThrow('outbox down');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`
Expected: FAIL — `recordSettlementFailure` 가 불리지 않음(매니저가 아직 `recordRejected` 를 부른다).

- [ ] **Step 3: 구현한다**

`channel-order-cancel.manager.ts` 전체를 아래로 바꾼다:

```ts
// apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts
import { Injectable, Logger } from '@nestjs/common';
import type { CancelChannelOrderPayload, ChannelOrderCancelRejectionCode } from '@packages/event-contracts/streams';
import { MedusaClient } from '../../adapters/medusa/medusa.client';
import { getChannelFulfillmentCapabilities } from '../channel-capabilities';
import { OrderPollerOrchestrator } from '../order-collection/order-poller.orchestrator';
import { ChannelOrderCancelRepository, type LegacyCancelFact } from './channel-order-cancel.repository';

/** 정산이 끝나지 못한 결과. `legacy` 는 오늘의 channel-adapter 가 같은 응답에 내던 옛 사실 — 옛 core(PR 5 전)가 읽는다 */
type SettlementFailure = { retryable: boolean; failureCode: string; message: string; legacy?: LegacyCancelFact };

/**
 * core 의 `CancelChannelOrder` 를 채널에 실행한다 (#1016 35번 행, ADR-0042 · 36번 재설계 스펙 §7.2).
 *
 * 정산이 끝나지 못한 모든 결과는 `ChannelOrderSettlementFailed` 로 낸다 — 영구(`retryable: false`)는 낸 뒤 정상 종료(ack),
 * 일시(`retryable: true`)는 낸 뒤 던져 Kafka 재시도(3회·1/2/4초)·DLQ 를 탄다. 일시 실패의 ack 는 core 리컨실러가 실행 모드가 되는
 * 정리 PR 에서 켠다(PR 3 판정 2) — 그 전에 ack 하면 짧은 순단마저 아무도 다시 부르지 않는다.
 * 옛 core 는 새 사실을 버리므로 오늘 내던 옛 사실(`Rejected`·`Stalled`)을 같은 트랜잭션에 함께 낸다(판정 1). 정리 PR 에서 지운다.
 * 채널 호출이 멱등이라 다시 해도 안전하다: 전체는 «이미 취소됨»과 장부 맞추기, 부분은 Medusa 가 같은 requestId 의 진행 단계부터 이어 간다.
 * 성공은 사실로 내지 않는다(D11) — 즉시 재수집한 `OrderCancelled`/`OrderModified` 가 곧 사실이다.
 */
@Injectable()
export class ChannelOrderCancelManager {
  private readonly logger = new Logger(ChannelOrderCancelManager.name);

  constructor(
    private readonly repository: ChannelOrderCancelRepository,
    private readonly medusaClient: MedusaClient,
    private readonly orderPoller: OrderPollerOrchestrator,
  ) {}

  /** `deliveryId` 는 명령 봉투의 messageId — 사실의 멱등 키에 쓴다(같은 전달의 재전달은 한 번, 재발행은 새로). */
  async execute(command: CancelChannelOrderPayload, deliveryId: string): Promise<void> {
    const { requestId, salesChannel, externalOrderId } = command;
    const failure =
      (await this.precheck(command)) ?? (command.scope === 'full' ? await this.settleFull(command) : await this.settlePartial(command));
    if (failure) return this.fail(command, deliveryId, failure);

    const { outcome } = await this.orderPoller.syncOrder(salesChannel, externalOrderId, { force: true });
    const done = `[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} ${command.scope} 완료 → 재수집 ${outcome}`;
    if (outcome === 'channel_inactive' || outcome === 'not_found') {
      // Medusa 는 취소됐는데 core 로 돌아가는 사실이 없다 — 정체 보드가 잡을 때까지 보이지 않는다
      this.logger.warn(done);
    } else {
      this.logger.log(done);
    }
  }

  private async precheck(command: CancelChannelOrderPayload): Promise<SettlementFailure | undefined> {
    const { salesChannel, externalOrderId } = command;
    // 실행기가 Medusa 하나뿐이라 채널 이름을 함께 본다 — 다른 채널이 능력을 켜면 여기에 실행기를 더해야 하고, 그 전엔 거절한다
    if (salesChannel !== 'medusa' || !getChannelFulfillmentCapabilities(salesChannel)?.automatedCancellation) {
      const message = `${salesChannel} 주문은 자동 취소를 지원하지 않습니다`;
      return { retryable: false, failureCode: 'channel_not_supported', message, legacy: rejected(command, 'NOT_SUPPORTED', message) };
    }
    if (!(await this.repository.hasCollectedOrder(salesChannel, externalOrderId))) {
      const message = `수집된 적 없는 주문입니다: ${salesChannel}:${externalOrderId}`;
      return { retryable: false, failureCode: 'order_not_collected', message, legacy: rejected(command, 'ORDER_NOT_FOUND', message) };
    }
    return undefined;
  }

  private async settleFull(command: CancelChannelOrderPayload): Promise<SettlementFailure | undefined> {
    const outcome = await this.medusaClient.cancelOrder(command.externalOrderId, { refundMode: command.refundMode ?? 'auto' });
    switch (outcome.kind) {
      case 'cancelled':
      case 'already_cancelled':
        return undefined;
      case 'refund_refused':
        // 옛 사실을 내지 않는다 — 옛 core 는 Rejected 를 받으면 요청을 닫고 보류를 풀어 고객이 취소한 물건을 내보낸다
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'not_found':
        return { retryable: false, failureCode: 'not_found', message: outcome.message, legacy: rejected(command, 'ORDER_NOT_FOUND', outcome.message) };
      case 'not_cancelable':
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message, legacy: rejected(command, 'NOT_CANCELABLE', outcome.message) };
      case 'transient':
        return { retryable: true, failureCode: outcome.failureCode, message: outcome.message };
      default: {
        // 새 결과 종류를 빠뜨리면 성공(undefined)으로 읽혀 사실도 재시도도 없이 넘어간다 — 컴파일에서 막는다
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 전체취소 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async settlePartial(command: CancelChannelOrderPayload): Promise<SettlementFailure | undefined> {
    const { requestId, externalOrderId } = command;
    if (!command.lines || command.lines.length === 0) {
      throw new Error(`부분취소 명령에 줄이 없습니다: ${requestId}`);
    }
    const outcome = await this.medusaClient.partialCancelOrder(externalOrderId, {
      requestId,
      items: command.lines.map((line) => ({ itemId: line.channelOrderItemId, quantity: line.quantity })),
      ...(command.alreadyRefundedAmount !== undefined ? { alreadyRefunded: command.alreadyRefundedAmount } : {}),
      refundMode: command.refundMode ?? 'auto',
    });
    switch (outcome.kind) {
      case 'cancelled':
        return undefined;
      case 'rejected':
        return {
          retryable: false,
          failureCode: 'partial_cancel_rejected',
          message: outcome.message,
          legacy: rejected(command, 'NOT_CANCELABLE', outcome.message),
        };
      case 'external_refund':
        return {
          retryable: false,
          failureCode: outcome.reason,
          message: outcome.message,
          legacy: rejected(command, 'EXTERNAL_REFUND_UNRESOLVED', outcome.message, outcome.unresolvedAmount),
        };
      case 'refund_refused':
        // 수정이 확정된 뒤의 거절이면 옛 core 에 «수정됨 · 환불 미완»을 알린다(PR 2 전엔 같은 상황이 502 + Stalled 였다)
        return {
          retryable: false,
          failureCode: outcome.failureCode,
          message: outcome.message,
          ...(outcome.edited ? { legacy: stalled(command, outcome.message) } : {}),
        };
      case 'refund_pending':
        return { retryable: true, failureCode: 'refund_pending', message: outcome.message, legacy: stalled(command, outcome.message) };
      case 'not_cancelable':
        // 옛 adapter 는 이 400 을 던졌다(옛 사실 없음). 옛 Rejected 를 새로 내면 수정 전 주문의 보류가 풀린다
        return { retryable: false, failureCode: outcome.failureCode, message: outcome.message };
      case 'transient':
        return { retryable: true, failureCode: outcome.failureCode, message: outcome.message };
      default: {
        const unhandled: never = outcome;
        throw new Error(`처리하지 않은 Medusa 부분취소 결과: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private async fail(command: CancelChannelOrderPayload, deliveryId: string, failure: SettlementFailure): Promise<void> {
    const { requestId, salesChannel, externalOrderId, scope } = command;
    this.logger.warn(
      `[CANCEL] ${requestId} ${salesChannel}:${externalOrderId} ${scope} 정산 실패 ${failure.failureCode}` +
        ` (retryable=${failure.retryable}): ${failure.message}`,
    );
    await this.repository.recordSettlementFailure(
      {
        requestId,
        salesChannel,
        externalOrderId,
        scope,
        retryable: failure.retryable,
        failureCode: failure.failureCode,
        message: failure.message,
        at: new Date().toISOString(),
      },
      deliveryId,
      failure.legacy,
    );
    if (failure.retryable) {
      // 정리 PR(리컨실러 실행 모드)까지 던져 Kafka 재시도를 탄다 — 사실은 이미 적재됐다(판정 2)
      throw new Error(`채널 정산 일시 실패(${requestId}) ${failure.failureCode}: ${failure.message}`);
    }
  }
}

function rejected(
  command: CancelChannelOrderPayload,
  reasonCode: ChannelOrderCancelRejectionCode,
  message: string,
  unresolvedRefundAmount?: number,
): LegacyCancelFact {
  const { requestId, salesChannel, externalOrderId } = command;
  return {
    eventType: 'ChannelOrderCancelRejected',
    payload: {
      requestId,
      salesChannel,
      externalOrderId,
      reasonCode,
      message,
      ...(unresolvedRefundAmount !== undefined ? { unresolvedRefundAmount } : {}),
    },
  };
}

function stalled(command: CancelChannelOrderPayload, message: string): LegacyCancelFact {
  const { requestId, salesChannel, externalOrderId } = command;
  return { eventType: 'ChannelOrderCancelStalled', payload: { requestId, salesChannel, externalOrderId, stage: 'edited', message } };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-cancel apps/channel-adapter/src/consumers/channel-orders-command.consumer.spec.ts`
Expected: PASS

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 5: `never` 검사가 살아 있는지 변이로 확인한다**

`medusa.client.ts` 의 `MedusaCancelOutcome` 에 `| { kind: 'probe' }` 를 잠깐 더하고 `npm run type-check 2>&1 | grep "channel-order-cancel.manager"` 가
`Type '{ kind: "probe"; }' is not assignable to type 'never'` 를 내는지 본다. **`git checkout --` 로 되돌리지 말고** 그 한 줄을 손으로 지운 뒤
`git diff --stat apps/channel-adapter/src/adapters/medusa/medusa.client.ts` 가 비었는지 확인한다(미커밋 작업을 날리지 않게 — 메모리 `events-module-redesign`).

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts
git commit -m "feat(channel-adapter): #1016 36번 재설계 PR 3 — 정산 실패를 사실로, 옛 core 용 옛 사실을 함께"
```

---

### Task 5: 문서·게이트·PR

**Files:**
- Modify: `apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts:10-19`(머리 주석)
- Modify: `apps/channel-adapter/CLAUDE.md` §3-5 마지막 줄, §4 «발행하는 Kafka 스트림» 표

- [ ] **Step 1: 소비자 머리 주석을 고친다**

`channel-orders-command.consumer.ts` 의 클래스 주석 중 «취소» 문장과 마지막 두 문장을 아래로 바꾼다:

```ts
 * «취소»(35번 행)는 `ChannelOrderCancelManager` 가 채널 정산 라우트에 실행하고, 결과는 재수집 또는 `ChannelOrderSettlementFailed`
 * (+ 정리 PR 전까지 옛 `ChannelOrderCancelRejected`/`Stalled`)로 돌아간다(#1016 36번 재설계).
 *
 * 다시 확인의 정해진 실패(미지원 채널 등)는 로그만 남기고 정상 종료한다. 취소의 영구 실패는 사실을 낸 뒤 정상 종료하고,
 * 일시 실패·예상 밖 예외는 던져서 재시도·DLQ 를 탄다.
```

- [ ] **Step 2: `apps/channel-adapter/CLAUDE.md` 를 고친다**

§3-5 마지막 줄의 괄호 안 «35번 행: 채널에 취소·부분취소를 요청하고 결과는 재수집 또는 `ChannelOrderCancelRejected`/`Stalled` 로 돌려준다» 를 아래로 바꾼다:

```md
35번 행·36번 재설계: 전체취소는 Medusa `channel-cancel`(기본 `/cancel` 은 환불 오류를 삼킨다), 부분취소는 `partial-cancel` 을 `refundMode` 와 함께 부르고, 정산이 끝나지 못하면 `ChannelOrderSettlementFailed`(`retryable`) 를 낸다 — 정리 PR 전까지 옛 `Rejected`/`Stalled` 를 함께 내고 일시 실패는 던진다
```

§4 «발행하는 Kafka 스트림» 표의 `orders.events.v1` 줄 이벤트 칸을 `OrderCreated`, `OrderModified`, `OrderCancelled`, `ChannelOrderSettlementFailed`(+옛 `ChannelOrderCancelRejected`·`Stalled`) 로,
소비자 칸을 `WMS(core)` 로 둔다.

- [ ] **Step 3: 전체 게이트**

```bash
npm run type-check                                   # 에러 0
npx jest                                             # 실패 0
npm run audit:event-handlers                         # 발견 없음
npm run audit:event-publishers                       # 발견 없음
npm run audit:consume-validation -- --gate           # 위반 없음
git -C /home/pauseb/workspace/almondyoung-server status --short   # 메인 오염 없음
git diff origin/develop --stat -- apps/medusa        # 비어 있어야 한다(Medusa 불변)
```

`npx jest` 가 OOM 이면 `--maxWorkers=2`(메모리 `picking-plan-layer-extraction`). 빨간 것이 admin-web·warehouse-app 의 «Cannot find module» 이면 실행 준비의 심볼링크를 확인한다.

- [ ] **Step 4: 커밋·push·PR**

```bash
git add apps/channel-adapter/src/consumers/channel-orders-command.consumer.ts apps/channel-adapter/CLAUDE.md
git commit -m "docs(channel-adapter): #1016 36번 재설계 PR 3 — 취소 명령의 결과 사실"
git push -u origin feat/1016-36-adapter-settlement
```

PR 본문(제목 `feat(channel-adapter): 채널 취소 정산 호출·정산 실패 사실 (#1016 36번 재설계 PR 3)`, base `develop`)에 넣을 절:
**무엇** · **스펙과 다른 점**(이 계획의 D1~D6 표) · **혼자 나갔을 때**(아래) · **PR 5·6 에 넘길 것**(이 계획의 두 목록) · **배포** · **검증**(Step 3 의 실측 숫자) ·
**범위 밖 · 알려진 한계**(이 계획의 절). `#1016` 본문·코멘트는 사용자 확인 없이 고치지 않는다.

«혼자 나갔을 때» 초안:

```md
## 혼자 나갔을 때 (옛 core, PR 5 전)
- 전체취소가 기본 `/cancel` 대신 `channel-cancel` 로 간다 — **환불 없는 취소(유령 환불 거래)가 사라진다.**
- 옛 core 는 `ChannelOrderSettlementFailed` 를 경고 후 버린다(오프셋 커밋, DLQ 없음 — `SchemaValidationInterceptor`·`EventTypeGuard` 확인).
  기존 결과의 옛 사실(`Rejected`·`Stalled`)은 오늘과 같은 응답에 같은 내용으로 나가므로 **옛 core 동작은 오늘과 같다** — 37번 «이미 환불한 금액» 흐름 포함.
- **다른 점 하나: 전체취소 wallet 영구 거절**(CMS 결제 등). 오늘은 «환불 없이 취소», 이제는 Medusa 미취소 + 요청 보류 + 5분 뒤 정체 보드(사유 없음).
  🔴 **이 상태에서 [요청 접기]를 누르면 고객이 취소한 물건이 출고된다** — PR 5 전까지 운영자에게 접지 말고 개발에 알리라고 안내한다.
- 부분취소의 Medusa 자체 400(다른 주문 수정이 열려 있음)은 오늘은 7초 재시도 뒤 DLQ, 이제는 즉시 ack — 옛 core 에선 둘 다 «보류된 채 정체». 라이브 부분취소 기록 0.
- 일시 실패는 오늘처럼 던져 Kafka 재시도(3회·1/2/4초) → DLQ.
```

«배포» 초안:

```md
## 배포
- 마이그레이션 없음(사실은 공용 아웃박스). 전제: PR 2 #1049 라이브(이미 됨 — `channel-cancel` 이 없으면 전체취소가 전부 `http_404` 일시 실패).
- channel-adapter 는 ServicesBundleA(analytics·channel-adapter·membership). 배포 전 develop 의 대기 마이그레이션을 대조한다 — 남이 머지한 마이그도 함께 실린다.
- 이 PR 이 라이브가 된 뒤에만 정리 PR 의 대시보드 미들웨어(§6.6)를 건다.
- 머지는 사용자가 `! gh pr merge <번호> --squash`.
```

---

## Self-Review

- **스펙 커버리지:** §7.1 명령 `refundMode`(Task 1) · 새 사실(Task 1) · `REFUND_FAILED` 생산 중지(Task 4 — 매니저가 더 이상 그 코드를 쓰지 않는다, Task 1 주석) ·
  §7.2 표 전 줄(Task 3 분류 + Task 4 매핑, 판정 1 표) · ack(판정 2 로 PR 6 이월, D3) · 멱등 키(Task 2, D4) · `never`(Task 4 Step 5 변이) · `channel-cancel` 경로(Task 3) ·
  §9.1 #1046 옮김/버림(Task 3·4, Global Constraints) · §10 channel-adapter 테스트(Task 2~4) · 계약 테스트(Task 1).
- **같은 명령 두 번 → 환불 한 번:** PR 2 통합 테스트가 보장. adapter 는 같은 `requestId`·`refundMode` 를 보내는지만 Task 4 «manual 은 그대로, 같은 requestId 로» 가 단언한다.
- **타입 일관성:** `recordSettlementFailure(fact, deliveryId, legacy?)`·`LegacyCancelFact` — Task 2 정의, Task 4 사용. `cancelOrder(orderId, { refundMode })`·
  `partialCancelOrder(orderId, { …, refundMode })` — Task 3 정의, Task 3 Step 6·Task 4 사용. `external_refund.reason` — Task 3 정의, Task 4 사용.
- **Review Focus → 테스트:** 같은 전달 결과 변화(Task 2) · 전체 영구 거절 옛 사실 없음(Task 4) · `edited` 없음(Task 3·4) · 예상 밖 상태(Task 3) · 긴 코드(Task 2).
