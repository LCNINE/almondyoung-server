# 새 세션 지시문 — 채널 취소 정산 재설계 PR 3 (계약 + channel-adapter) 계획·구현

## 너의 임무

승인된 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` 의 **PR 3(계약 + channel-adapter)** 구현 계획을 쓰고,
사용자가 실행 방식을 고르면 구현한다. `superpowers:writing-plans` 로 시작한다. 사용자는 한국어로 응답받기를 원한다.

**스펙의 결정(S1~S11)을 다시 묻지 마라** — 2026-10-11 사용자가 승인했다. 계획 중 스펙과 코드가 어긋나면 스펙을 정본으로 판정하고 기록한다.
단 아래 «먼저 판정할 것»은 스펙이 말하지 않거나 스펙끼리 어긋나는 **이행 기간의 문제**다 — 계획에서 판정하고 근거·비용을 적는다.

**이 문서들은 develop 에 없다.** 스펙·계획·지시문은 브랜치 `docs/1016-36-channel-cancel-settlement` 에 있다(워크트리
`.claude/worktrees/docs-1016-36-settlement`). 읽기는 `git show docs/1016-36-channel-cancel-settlement:<경로>` 로, 이 PR 의 계획도 그 브랜치에 커밋한다.

## 먼저 읽을 것

1. `CLAUDE.md`, `apps/channel-adapter/CLAUDE.md`(§3-5 의 명령·사실 흐름)
2. 스펙 **§5.1**(상태 흐름), **§7.1·§7.2**(계약·channel-adapter — 이 PR 의 본문), §7.3 의 «사실 받기»(PR 5 core 가 무엇을 기대하는지),
   §9.1 의 #1046 행, **§9.2·§9.3**(이 PR 이 혼자 나갔을 때·롤링 조합), §10 channel-adapter
3. **PR #1049 본문**(`gh pr view 1049`) — PR 2 가 스펙과 다르게 간 D1~D8 이 여기 있다. 계획 문서
   `plans/2026-10-11-channel-cancel-settlement-pr2-medusa.md` 에는 **D8 이 없다** — 어긋나면 PR 본문이 정본
4. 메모리 `channel-cancel-settlement-redesign.md`, `channel-order-cancel-35.md`, `channel-cancel-refund-refusal-36.md`,
   `event-contract-runtime-validation.md`, `events-module-redesign.md`, `subagent-worktree-contamination.md`
5. 전례: `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr1-wallet.md`(Global Constraints·Review Focus·실행 준비 절의 관례)

## 지금 상태 (2026-10-12)

- PR 0 #1047 · PR 1 #1048 · PR 2 #1049 **모두 MERGED·라이브 배포됨**(develop `2452dd202`). 스펙 §9.2 의 «2 와 3 사이 배포 한 번»은 끝났다
- 따라서 `POST /admin/orders/:id/channel-cancel` 이 라이브에 있다 — §9.3 첫 줄(«새 adapter + 옛 Medusa → 본문 없는 404»)은 이제 생기지 않는다
- **라이브 channel-adapter 는 아직 옛 것이다:** 전체취소는 기본 `/cancel`(환불 오류를 삼키고 유령 환불 거래를 남긴다 — 스펙 §2.2),
  부분취소는 `refundMode` 를 안 보낸다. 그리고 PR 2 가 새로 낸 부분취소 400 `wallet_refund_refused:*` 를 모르는 400 으로 보고 던진다
  (`medusa.client.ts` `partialCancelOrder` 끝 → Kafka 재시도 → DLQ). 라이브 부분취소 기록은 0 이라 실제 피해는 아직 없다
- **라이브 core 도 옛 것이다(PR 5 전까지).** `ChannelOrderCancelRejected` 를 받아 요청을 닫고 보류를 풀며(`order-events.consumer.ts:303`),
  `ChannelOrderCancelStalled` 로 «수정됨·환불 미완» 단계를 적는다. 새 사실 `ChannelOrderSettlementFailed` 는 모른다
- 사용자 결정: 기존 결제·환불 건은 이미 처리된 것으로 간주 — 소급 환급·대조를 제안하지 말 것
- 남은 PR: 4(스토어프론트) · 5(core+admin-web) · 6(정리) — 이 세션 범위 밖

## PR 3 범위 (스펙 §7.1·§7.2)

| 변경 | 요지 |
| --- | --- |
| 계약 `CancelChannelOrder` | optional `refundMode: 'auto' \| 'manual'` (`packages/event-contracts/streams/channel-orders-command.stream.ts`). 생산자는 core(PR 5), 소비자는 이 PR — 소비자 선배포 순서가 맞다 |
| 계약 새 사실 | `ChannelOrderSettlementFailed { requestId, salesOrderId, scope, retryable, failureCode, message, at }`(`orders.stream.ts`, `orders.events.v1`). `REFUND_FAILED` 를 고쳐 쓰지 않는다. **`salesOrderId` 를 adapter 가 어디서 얻는지 확인할 것** — 지금 명령엔 그 칸이 없다 |
| 전체취소 경로 | `medusaClient.cancelOrder` → `POST /admin/orders/:id/channel-cancel` + 본문 `{ refundMode }`. 결과 종류 `never` 검사 |
| 부분취소 | 본문에 `refundMode` 전달(Medusa `parseInput` 이 이미 받는다). 400 `wallet_refund_refused:*` + `stage: 'edited'` 를 새 결과 종류로 |
| 응답 → 사실 | 스펙 §7.2 표. 사실을 낸 뒤 명령을 ack, 멱등 키 `settlement-failed:${requestId}:${envelope.messageId}`. 아웃박스 쓰기 실패만 던진다 |

### PR 2 가 실제로 내는 응답 (develop 코드 기준 — 스펙보다 이것이 정확하다)

- **전체** `channel-cancel/route.ts` 머리 주석이 계약이다: 200 `{ orderId, status: 'canceled', refund: { mode, amount } }` · 404 `type: not_found` ·
  400 `invalid_data` «Order with id … has been canceled.»(이미 취소됨 = 성공, 기존 `ALREADY_CANCELLED_MESSAGE` 와 같은 문장) ·
  400 `not_allowed` + `code: wallet_refund_refused:<code>`(영구, 주문 미취소) · 그 밖 400 = 환불 전 사전검사(진행 중 주문 변경·안 취소된 출고)와 본문 오류 ·
  500 = 일시(환불 뒤 단계 실패, **D8 의 «진행 중» 자동 PENDING**, 응답 유실 뒤 사전검사 거절 포함)
- **부분** `partial-cancel/route.ts`: 200(기존 모양 + D7) · 400 `partial_cancel_rejected`(+`reason: external_refund_*`·`unresolvedAmount`) ·
  400 `wallet_refund_refused:<code>` + `stage: 'edited'` + `requestId`(D2) · **502 `refund_pending` 유지**(D1 — 옛 adapter 호환) · 그 밖 500.
  라우트 주석: «Medusa 자신의 NOT_ALLOWED(예: 다른 주문 수정이 열려 있음 — **일시적**)도 400 `not_allowed` 로 나간다 — 최종 거절은 code 로 가린다»
- 메시지는 wallet 이 준 문장 그대로다(D5) — 운영자에게 보일 사유로 그대로 싣는다

## 먼저 판정할 것 (계획 머리에 판정·근거·비용을 적는다)

1. **🔴 옛 core 와의 공존 — 기존 사실을 바꾸면 라이브 37번 흐름이 퇴행한다.** 스펙 §7.2 표를 그대로 따르면 `partial_cancel_rejected`·
   `external_refund_*`·`not_found` 까지 `SettlementFailed` 가 되는데, 옛 core 는 그 사실을 버린다. 지금 라이브는 `EXTERNAL_REFUND_UNRESOLVED`
   (금액 포함)로 요청을 닫고 운영자가 금액을 넣어 다시 요청한다. 스펙 목표 6(«어떤 조합도 지금보다 나빠지지 않는다»)과 부딪힌다.
   후보: 기존 결과는 기존 사실(`Rejected`·`Stalled`) 그대로 + 새 결과(`wallet_refund_refused`·일시)만 `SettlementFailed`. 이 경우 PR 5 core 가
   `settling` 행에 오는 `Rejected` 를 어떻게 읽을지 계획의 «PR 5 에 넘길 것»에 적는다. adapter 사전검사(`NOT_SUPPORTED`·`ORDER_NOT_FOUND`)도 같은 질문이다
2. **🔴 일시 실패를 ack 하면 이행 기간에 아무도 다시 부르지 않는다.** 스펙 S7 은 «리컨실러 한 곳»인데 그 규칙은 PR 5 에서 **관찰 모드**,
   PR 6 에서야 실행 모드다(§9.2). PR 3 이 일시 실패를 ack 하면 PR 3~5 동안은 옛 core 가 사실을 버리고, PR 5~6 동안은 운영자 [다시 시도]뿐이다 —
   오늘은 Kafka 재시도가 짧은 장애를 스스로 넘긴다. 후보: 사실을 낸 뒤 지금처럼 던지고(같은 전달의 재배달은 멱등 키가 한 번으로 접는다),
   ack 전환은 리컨실러 실행 모드와 함께 PR 6 으로. S7 을 다시 묻는 게 아니라 «언제 켜나»의 판정이다
3. **부분취소 502 `refund_pending`** — `SettlementFailed{retryable:true}` 와 함께 옛 `Stalled` 도 낼지. 스펙 §7.3 은 새 core 가 `settling` 행의
   옛 `Stalled` 를 `retryable: true` 로 읽는다고 했으니 둘 다 내도 새 core 와 맞는다
4. **Medusa 자체 400 `not_allowed`(우리 code 없음)** — 스펙 표는 `retryable: false`, 부분취소 라우트 주석은 «일시적». 전체취소의 «진행 중 주문 변경»
   사전검사도 같은 모양이다. 어느 쪽이든 비용을 적는다(false: 일시 상황이 «환불 거절»로 보여 운영자가 눌러야 함 / true: 영구 사전검사 실패가
   백오프로 계속 재시도되다 «환불 지연»으로 보임)
5. **새 사실 타입을 옛 core 가 정말 «경고 후 버리는지»** — 스펙은 35번 PR-B 실측이라 적었다. `@app/events` 소비자 코드로 다시 확인하고,
   DLQ 로 가거나 소비자가 멈추면 판정 1·2 가 바뀐다(메모리 `event-contract-runtime-validation.md`: 소비자는 계약 위반에 throw)

## #1046(닫힘)에서 옮길 것 — 브랜치 `feat/1016-36-refund-refusal-adapter`

#1044 위에 쌓인 브랜치다. adapter 커밋만 본다: `0ee504560`·`1732978a5`·`959eaf0e2`·`b66cf1a17`·`a2abef518`
(워크트리 `.claude/worktrees/feat-1016-36-refund-refusal`).

- **옮김**: `channel-cancel` 경로 전환(`b66cf1a17`), 결과 종류 `never` 검사
- **버림**: `REFUND_FAILED` 생산, `refund-failure.ts` 의 두 갈래 분류(분류 정본은 이제 wallet — 표지 문자열만 읽는다), 정체 사실 멱등 키의 `walletCode`

## 테스트 (스펙 §10 channel-adapter)

- 응답 → 사실 표 **전수**(전체·부분 각각, 위 «PR 2 가 실제로 내는 응답»의 모든 줄 + 본문 없는 404 + 네트워크 오류), ack/던짐, 멱등 키, `refundMode` 전달(전체·부분, 없을 때 `auto`)
- 계약: `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts` 틀 — 새 사실 스키마, `refundMode` 없는 옛 명령이 통과
- 같은 명령 두 번(같은 `requestId`) → Medusa 가 환불 한 번(PR 2 통합 테스트가 이미 보장 — adapter 는 같은 `requestId`·`refundMode` 를 보내는지만 단언)
- 게이트: 루트 `npm run type-check` 0 · `npx jest` 0(channel-adapter·계약은 루트 게이트 안이다). Medusa 는 안 바꾼다 — 바꿔야 한다는 결론이 나오면 멈추고 기록

## 배포

- 마이그레이션 없음(사실은 공용 아웃박스). 판정 1·2 에 따라 «혼자 나갔을 때»를 PR 본문에 적는다
- PR 3 이 라이브가 되면 PR 6 의 대시보드 미들웨어(§6.6)를 걸 수 있다 — 그 전엔 걸지 말 것(라이브 adapter 가 기본 `/cancel` 을 HTTP 로 부른다)
- 배포 전 `deploy-ships-other-merged-prs-migrations` 메모리대로 develop 의 대기 마이그레이션을 대조한다

## 알려진 한계 (PR 2 에서 넘어옴 — 계획의 «범위 밖»에 옮겨 적을 것)

- D8: 자동 PENDING 이 Medusa 장부에 없으면 «진행 중»으로 보고 500 — 계좌 미등록 무통장 폴백 환불이 응답을 잃으면 운영자가 wallet 에서 확인할 때까지
  그 주문 정산이 일시 실패로 남는다. adapter 쪽에선 `retryable: true` 가 반복된다
- T5-5: 부분취소가 영구 거절된 뒤 바깥에서 환불하고 재시도하면, 수정된 재시도가 37번 외부 환불 검사를 건너뛰어 같은 몫이 또 나갈 수 있다 — 출구는 `refundMode: 'manual'`
- PR 1: 응답이 끊긴 PG 호출은 `PROVIDER_EXCEPTION`·`retryable: true` 라 재시도가 부분환불을 두 번 낼 수 있다

## 지켜야 할 제약

- 서브에이전트는 반드시 워크트리에서 — 메인 체크아웃 오염 5회+ 재발. 메인 `git status` 로 확인
- **워크트리 만든 직후 `node_modules` 심볼링크**: 루트, `apps/admin-web`, `native/warehouse-app`(루트 `type-check`·`npx jest` 가 이 둘을 본다 — PR 1·2 에서
  빠져 게이트가 환경 탓으로 빨갰다)
- **`gh pr merge` 는 권한 분류기가 막는다** — 머지는 사용자가 `! gh pr merge <번호> --squash` 로 한다. push·PR 생성은 된다
- 라이브 DB 조회는 사용자에게 `! …sst shell --stage live -- node -e "$(cat <절대경로>)"` 로 부탁
- #1016 본문·코멘트는 사용자 확인 없이 고치지 않는다
