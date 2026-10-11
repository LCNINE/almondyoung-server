# PR 4 — 스토어프론트: 환불 배지 새 값·모르는 값 대비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스토어프론트가 core 의 새 환불 값 `delayed`·`transfer_pending` 을 스펙 §8.2 문구로 보이고, **모르는 `refundStatus` 는 «환불 처리 중»(`pending`)으로 접는다** —
PR 5 의 core 가 값을 내기 전에 나가도 화면이 그대로인(휴면) PR.

**Architecture:** 판정은 순수 모듈 `src/lib/orders/refund-status.ts` 한 곳(`toRefundStatus`·`resolveRefundStatus`·`refundTone`). 응답 타입은 «core 가 실제로 보낼 수 있는 것»으로
연다(`StoreRefundStatus | (string & {})`) — 그러면 원본 값을 접지 않고 쓰는 자리가 **tsc 에러로 드러난다.** 화면 셋(상세 배지·상세 데스크톱·모바일의 «환불 상태»)은 접힌 값만 쓴다.
문구는 i18n(`mypage.order.refundInfo`) 세 언어.

**Tech Stack:** Next.js 15, next-intl 4, vitest 4(node 환경, `src/**/*.test.ts`), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` — **§8.2**(이 PR 의 본문), §5.2(고객에게 지연·거절을 구분하지 않는다), §9.2 의 4·§9.3 넷째 줄(왜 core 보다 먼저인가),
§7.3(PR 5 core 가 낼 것), §10 «스토어프론트 — 배지 순수함수». 지시문: `docs/superpowers/briefs/2026-10-12-channel-cancel-settlement-pr4-storefront.md`.
기준 커밋 develop `070c2a535`(PR 3 머지·라이브 배포 2026-10-12).

---

## 먼저 판정한 것 (지시문 «먼저 판정할 것» 1~4)

### 판정 1 — 표시 직전 순수함수에서 접는다. 응답 타입은 열고, 알려진 값의 `Record` 는 닫힌 채 둔다

**정한 것:**

- 응답 타입(`store-orders.ts`)의 `StoreOrderActionsResponse.refundStatus`·`RefundSummary.status` 를 `StoreRefundStatusWire = StoreRefundStatus | (string & {})` 로 연다.
  `StoreRefundStatus`(닫힌 유니온)에는 새 값 둘을 더한다.
- 접기는 `src/lib/orders/refund-status.ts` 의 `toRefundStatus(raw)` — **알려진 값이면 그대로, 모르는 문자열이면 `pending`, 값이 없으면(`null`·`undefined`) `none`.**
  상세의 «요약 상태가 우선» 선택(`refundSummary?.status ?? refundStatus`)은 `resolveRefundStatus(actions)` 로 같은 모듈에 옮긴다.
- 알려진 값의 정본은 `TONE: Record<StoreRefundStatus, RefundTone | null>` 하나다. 타입에 값을 더하면 여기서 컴파일 에러가 나고(«새 값 누락 = 컴파일 에러» 유지), 같은 객체가
  런타임 소속 판정(`hasOwnProperty`)도 맡는다.

**근거:**

- **API 경계에서 접기를 기각.** 응답이 들어오는 함수가 넷이다(`getOrderActionsByMedusaId`·`getOrderActionsBatchByMedusaId`·`cancelOrderByMedusaId`·`getOrderActions`) +
  중첩 `refundSummary.status`. 넷 다 고쳐야 하고, 다섯 번째 함수가 생기면 조용히 빠진다. 게다가 `store-orders.ts` 는 `"use server"` 파일이라 **async 함수 말고는 export 할 수
  없다**(정규화 상수·동기 함수를 거기 둘 수 없다).
- **타입을 여는 것이 경계 정규화의 장점을 대신한다.** 응답 타입이 `string` 을 허용하면 `REFUND_STATUS_MAP[actions.refundStatus]`(TS7053)와
  `const refundStatus: StoreRefundStatus = …refundStatus`(TS2322)가 **컴파일 에러**가 된다 — 접지 않고 쓰는 자리를 tsc 가 열거한다. 지금은 응답 타입이 닫혀 있어 런타임에
  모르는 값이 와도 타입은 «안전하다»고 거짓말한다.
- **값 없음 → `none` (지시문과 다름, 스펙과는 같음).** 지시문은 `undefined` 도 `pending` 쪽으로 적었다. 그러나 `undefined` 는 «새 값»이 아니라 «정보 없음»이다 — 그것까지 `pending`
  으로 접으면 core 응답이 없는 주문(`coreActions` 없음)에 «환불 처리 중»이 뜬다. 오늘 동작(`?? "none"` → 섹션 숨김)을 지킨다. 빈 문자열 `''` 은 «core 가 보낸 모르는 값»으로
  `pending` 이다. 스펙 §8.2 는 «모르는 값»만 말한다.
- **비용:** 화면 셋 각각이 함수를 한 번 부른다(호출 3줄). 경계 정규화보다 한 곳 많지만 tsc 가 빠진 곳을 잡는다.

### 판정 2 — 새 신호를 정하지 않는다. 고객 취소는 언제나 «전체»라 `orderStatus` 하나로 끝난다 (PR 5 에 계약 둘)

**확인한 사실(develop `070c2a535`):**

- 스토어프론트 취소 요청 본문 `StoreCancelOrderRequest` 엔 `reasonCode`·`reasonDetail` 만 있다 — **품목을 고르지 않는다.** 취소 대화상자도 사유만 받는다.
- core `processCancelRequest`(`store-sales-orders.service.ts:749~`)는 출고 증거가 있거나 피킹이 시작됐으면 **400 으로 거절**한다. 전체 → 부분 전환
  (`channel-cancel-request.manager.ts:85` `convertedFromFull`)은 `requester.kind === 'operator'` 일 때만이다.
- 그러므로 **고객이 만드는 취소는 언제나 전체취소**이고, PR 5 에선 그 자리에서 판매주문이 `cancelled` 가 된다(스펙 §7.3). 취소 직후 토스트(`cancelOutcomeOf`)는 고객 자신의
  취소에만 돈다 — 지시문이 걱정한 «부분취소를 처리 중이라 말한다»는 고객 화면에서 생기지 않는다. 운영자 부분취소의 정산 상태는 토스트가 아니라 **환불 배지**로 보인다(판정 1).

**🔴 그러나 PR 5 가 그대로 두면 깨지는 곳 하나:** `processCancelRequest` 는 **요청 «전»에 읽은 `so` 로** `buildActionsView(so)` 를 만든다(같은 함수 끝줄, 재생 경로
`findBySourceKey` 도 같다). PR 5 가 같은 트랜잭션에서 판매주문을 취소해도 응답의 `orderStatus` 는 옛 값 → 옛·새 스토어프론트 모두 «취소를 요청했어요» 토스트 → 2초 뒤 다시 읽어
«주문이 취소되었습니다». 깨지진 않지만 §8.2 «취소 응답이 곧 취소 완료»를 어긴다. → **PR 5 에 넘길 것 1.**

**정한 것:** `cancelRequestStatus` 에 새 값을 정하지 않는다. 응답 타입만 «모르는 값이 올 수 있음»으로 열고(`"requested" | "rejected" | (string & {})`), `cancelOutcomeOf` 가
모르는 값을 `pending` 으로, `orderStatus: "cancelled"` 를 그보다 먼저 읽는다는 것을 테스트로 못 박는다(코드는 이미 그렇다 — `=== "rejected"` 만 본다).

**비용:** 없음(코드 변경 0, 테스트 2줄). 다시 읽기 삭제는 PR 6.

### 판정 3 — `failed`·`manual_pending` 은 그대로 둔다 (기록만)

둘은 core 직접 주문의 환불 배지다(스펙 §2.4 `retry-refund`·`manual-refund-complete`). 지우지 않는다.

**기록:** core 직접 주문의 `failed` 는 «환불 확인 필요»(빨강) + «고객센터로 문의해 주세요»를 보인다 — 스펙 §5.2 «고객에게는 지연과 거절을 구분하지 않는다»와 어긋난다.
core 직접 주문의 환불 모델은 이 재설계 범위 밖(§2.4·§13)이라 고치지 않는다. 같은 원칙을 그쪽에 적용할지는 #1016 의 반품·금액 조정 행(34·38번)이 정산 모양을 옮겨 갈 때 판단한다.

### 판정 4 — 스펙 문구를 «·» 에서 갈라 라벨/안내로. 배지도 i18n 라벨을 쓴다. 새 값은 호박색

**정한 것:**

| 값 | `statusLabels` (배지·«환불 상태») | `guidance` (상세 아래 안내) | 색 |
| --- | --- | --- | --- |
| `delayed` | 환불이 늦어지고 있어요 | 영업일 3일 안에 처리해 드릴게요. | 호박(`progress`) |
| `transfer_pending` | 환불 진행 중 | 계좌로 송금해 드릴 예정이에요. | 호박(`progress`) |

- 스펙 §8.2 의 문구는 «라벨 · 안내» 두 마디다. 상세 화면은 이미 «환불 상태: 〈라벨〉» 줄과 그 아래 안내 문단으로 나뉘어 있으므로 그대로 얹는다. 안내 끝에는 이웃 안내들처럼
  마침표를 붙인다(낱말은 스펙 그대로).
- **배지(상세 머리의 알약)도 같은 `statusLabels` 를 i18n 으로 읽는다.** 지금 `order-status-badges.tsx` 의 환불 알약은 한국어 하드코딩이라 en·ja 화면에도 한국어가 뜬다 —
  스토어프론트 CLAUDE.md 규칙 7(한국어 하드코딩 금지)에 새 값 둘을 또 하드코딩하지 않는다. **눈에 보이는 변화 둘:** `manual_pending` 알약 «환불 수동 처리 대기» → «수동 처리 대기»,
  `failed` 알약 «환불 실패» → «환불 확인 필요»(상세 «환불 상태»와 같은 말이 된다). 나머지 셋은 같은 글자다.
- **`delayed` 는 빨강이 아니다** — 고객에게 «거절»로 읽힌다(§5.2·§8.2). DESIGN.md 원칙 4 «빨강·경고 아이콘은 실제 에러에만». 지금 상세의 색 삼항 사슬은 모르는 값을 **빨강**
  (`else` 가지)으로 칠한다 — `refundTone` 의 닫힌 `Record` 로 바꾼다.
- `ui-minimal-text`: 새 줄·캡션을 더하지 않는다. 기존 두 자리(라벨·안내)에 값만 더한다. 정상 상태(`none`)는 지금처럼 섹션째 숨긴다.

**배지 알약이 상세 «환불 상태» 줄과 같은 정보를 두 번 보이는 것**은 오늘도 그렇다 — 이 PR 에서 손대지 않는다(Also found 로 사용자에게만 알린다).

---

## 스펙과 다른 점 (PR 본문에 옮긴다)

| # | 자리 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| D1 | 값 없음(`null`·`undefined`) | `none`(섹션 숨김). 모르는 «문자열»만 `pending` | 판정 1 — 지시문은 `undefined` 도 `pending` 이라 적었다 |
| D2 | 환불 알약 문구 | i18n `statusLabels` 를 읽는다 → `manual_pending`·`failed` 알약 글자가 바뀐다, en·ja 번역됨 | 판정 4 |
| D3 | 스펙 문구 | «·» 에서 갈라 라벨/안내, 안내 끝 마침표 | 판정 4 |
| D4 | `cancelRequestStatus` 새 값 | 정하지 않는다 | 판정 2 — 고객 취소는 전체뿐 |

---

## PR 5 에 넘길 것 (core + admin-web 계획이 읽는다)

1. **🔴 고객 취소 응답은 확정 «뒤»의 판매주문으로 만든다.** `processCancelRequest` 가 지금은 요청 전에 읽은 `so` 로 `buildActionsView(so)` 를 부른다(재생 경로 포함). 확정 트랜잭션 뒤
   판매주문을 다시 읽어 `orderStatus: "cancelled"` 를 응답에 실을 것 — 안 그러면 스토어프론트가 «취소를 요청했어요» → 2초 뒤 «취소되었습니다»로 두 번 말한다(§8.2 위반, 판정 2).
2. **`cancelRequestStatus` 엔 새 값을 싣지 않아도 된다.** 스토어프론트는 그 칸을 취소 직후 토스트에만 쓰고 `orderStatus === "cancelled"` 를 먼저 본다. 실어도 깨지지 않는다
   (모르는 값 → `pending`, 테스트로 고정). 새 흐름에서 `rejected` 는 생기지 않는다(§5.1 «채널의 업무 거절은 없다»).
3. **`refundStatus` 와 `refundSummary.status` 에 같은 값을 싣는다.** 상세는 `refundSummary.status` 를 우선하고 배지는 `refundStatus` 만 본다. 운영자 부분취소의 정산(판매주문은
   취소 안 됨)도 둘 다 싣는다 — 지금 core 는 비취소 주문의 `refundStatus` 를 `none` 으로 둔다.
4. **`delayed`·`transfer_pending` 의 `expectedProcessingMessage` 는 `null`.** 상세는 `refundSummary.expectedProcessingMessage ?? <i18n 안내>` 다 — core 가 문장을 주면 세 언어
   안내를 한국어 한 문장이 덮는다. 문구 정본은 스토어프론트 i18n. core `buildRefundSummary` 의 `messages: Record<StoreRefundStatus, …>` 에 두 값을 `null` 로.
5. core 의 `StoreRefundStatus`(`dto/store-order-actions.dto.ts:13`)와 `VALID_REFUND_STATUSES`(`store-sales-orders.service.ts:73`)는 **스토어프론트와 별도 복사본**이다 — 두 값을
   거기 더한다. 값 이름은 이 PR 의 `delayed`·`transfer_pending` 그대로(스펙 §8.2).
6. **새 `cancelUnavailableReason` 값을 더하지 않는다** — 스토어프론트 `CANCEL_UNAVAILABLE_MESSAGES[reason]` 이 `undefined` 가 된다. 더해야 하면 스토어프론트를 먼저 낸다.

## PR 6 에 넘길 것

- 다시 읽기(`waitForCancelOutcome`) 삭제와 함께: `cancelOutcomeOf`·`CancelOutcome`·`cancelRequestStatus` 의 `rejected` 갈래, i18n `cancelRequested`·`cancelRejected`·
  `cancelStillProcessing`(세 언어), `order-actions.tsx` 의 하드코딩 토스트 문장을 정리한다. 옛 `requested` 행이 0 이 된 뒤.

---

## Global Constraints

- **core·admin-web·Medusa·channel-adapter 는 바꾸지 않는다.** 바꿔야 한다는 결론이 나오면 멈추고 «PR 5 에 넘길 것»에 적는다
- **ko 문구는 스펙 §8.2 낱말 그대로**(판정 4 표). en·ja 는 이 계획 Task 1 의 번역
- 사용자에게 보이는 새 문자열은 전부 i18n — `src/i18n/messages/{ko,en,ja}/mypage.json` 세 파일 같이(스토어프론트 CLAUDE.md 규칙 7)
- 알려진 값 목록은 `refund-status.ts` 의 `TONE` 하나 — 다른 곳에 값 목록을 다시 적지 않는다
- `delayed`·`transfer_pending` 은 빨강·경고 아이콘을 쓰지 않는다(DESIGN.md 원칙 4, §5.2)
- 2초×30초 다시 읽기(`cancel-outcome.ts`) 동작은 바꾸지 않는다(삭제는 PR 6)
- `"use server"` 파일(`store-orders.ts`)엔 타입만 더한다 — 상수·동기 함수 export 금지(Next 빌드 에러)
- `Object.hasOwn` 대신 `Object.prototype.hasOwnProperty.call` — 구형 iOS Safari(<15.4) 고객이 있다
- 서비스 코드에 `any`·`as` 를 새로 들이지 않는다(타입 술어로 좁힌다)
- 게이트(스토어프론트, `web/almondyoung-storefront` 에서): `npx vitest run` — **develop 기준선 72 files / 517 tests 중 2 실패**(`locale-parity.test.ts` 의 en·ja,
  원인 `logoContest.detail.description` 이 ko 에만 있음 — 이 PR 과 무관). 이 PR 뒤 **실패는 그 2건뿐**이어야 한다. `npx tsc --noEmit` — **기준선 46건**, 건드린 파일 에러 0
  (2026-10-12 실측, develop `070c2a535`)

## Review Focus

- **모르는 값이 `Object` 프로토타입 이름이다**(`toString`·`constructor`·`__proto__`). `in` 으로 판정하면 «알려진 값»으로 통과해 `statusLabels.toString` 같은 키가 화면에 찍힌다.
  Task 1 `toRefundStatus` 의 «프로토타입 이름도 모르는 값» 테스트가 지킨다.
- **값 없음까지 `pending` 으로 접는다.** 그러면 core 응답이 없는 모든 주문에 «환불 처리 중»이 뜬다. Task 1 «값 없음은 none» 테스트가 지킨다.
- **요약 상태와 주문 상태가 다르다**(`refundSummary.status` 는 새 값, `refundStatus` 는 `none` — 운영자 부분취소 정산). 상세가 요약을 우선하는 오늘 동작이 접기 뒤에도 남아야 한다.
  Task 1 `resolveRefundStatus` 테스트가 지킨다.
- **en·ja 키 누락.** `locale-parity.test.ts` 가 develop 에서 이미 빨개서 새 누락을 «원래 빨강»에 묻는다. Task 1 «세 언어 모두 라벨·안내» 테스트가 직접 본다.
- **`cancelRequestStatus` 에 PR 5 가 새 값(`settling` 등)을 싣는다.** 토스트가 «거절»로 읽거나 `orderStatus: "cancelled"` 보다 먼저 읽으면 취소된 주문에 «처리 중»이 뜬다.
  Task 1 `cancel-outcome.test.ts` 추가 두 줄이 지킨다.

---

## 실행 준비 (이미 됨 — 2026-10-12 계획 세션이 만들었다)

```bash
W=/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1016-36-storefront-refund-badges
M=/home/pauseb/workspace/almondyoung-server
git -C $W branch --show-current          # feat/1016-36-storefront-refund-badges (origin/develop 070c2a535 에서)
ls -l $W/node_modules $W/apps/admin-web/node_modules $W/native/warehouse-app/node_modules $W/web/almondyoung-storefront/node_modules   # 넷 다 메인으로의 심볼링크
```

없으면 다시 만든다: `git worktree add $W -b feat/1016-36-storefront-refund-badges origin/develop` 후 위 네 경로를 `ln -s $M/<경로> $W/<경로>`.
**스토어프론트 `node_modules` 링크가 없으면 vitest·tsc 를 못 돌린다 — 이 PR 의 유일한 방어선이 조용히 사라진다**(메모리 `medusa-storefront-gate-topology`).
이후 **모든 명령은 워크트리**에서 돈다. 스토어프론트 명령은 `$W/web/almondyoung-storefront` 에서.

서브에이전트로 실행하면 dispatch 첫 줄에: `cd $W` → `git rev-parse --show-toplevel && git branch --show-current` → 기대값과 다르면 STOP, 특히 `develop` 이면 멈춘다.
**커밋 전 두 명령의 출력을 보고서에 넣는다.** 태스크마다 `git -C $M status --short` 와 `git -C $M rev-parse develop origin/develop` 로 메인 오염을 확인한다(메모리 `subagent-worktree-contamination`).
develop 을 어떤 이유로도 건드리지 않는다(reset·revert·cherry-pick 금지).

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| Modify `src/lib/api/orders/store-orders.ts` | `StoreRefundStatus` 에 두 값, 응답 타입을 `StoreRefundStatusWire` 로 연다, `cancelRequestStatus` 를 연다 |
| Create `src/lib/orders/refund-status.ts` | 알려진 값 정본(`TONE`)·`toRefundStatus`·`resolveRefundStatus`·`refundTone`·`KNOWN_REFUND_STATUSES` |
| Create `src/lib/orders/refund-status.test.ts` | 접기·톤·세 언어 문구 |
| Modify `src/lib/orders/cancel-outcome.test.ts` | 모르는 `cancelRequestStatus` 두 줄 |
| Modify `src/i18n/messages/{ko,en,ja}/mypage.json` | `order.refundInfo.statusLabels`·`guidance` 에 두 값 |
| Create `src/components/orders/refund-status-style.ts` | 톤 → 알약·글자 색 클래스 |
| Modify `src/components/orders/order-status-badges.tsx` | 환불 알약을 접힌 값 + i18n 라벨로 |
| Modify `src/domains/order/details/components/order-details-{desktop,mobile}.tsx` | `resolveRefundStatus`·`refundTone` 으로 |

(경로는 전부 `web/almondyoung-storefront/` 아래)

---

### Task 1: 판정 모듈·타입·문구

**Files:**
- Modify: `web/almondyoung-storefront/src/lib/api/orders/store-orders.ts:51-56, 74-75, 88, 92-93`
- Create: `web/almondyoung-storefront/src/lib/orders/refund-status.ts`
- Create: `web/almondyoung-storefront/src/lib/orders/refund-status.test.ts`
- Modify: `web/almondyoung-storefront/src/lib/orders/cancel-outcome.test.ts`
- Modify: `web/almondyoung-storefront/src/i18n/messages/{ko,en,ja}/mypage.json` (`order.refundInfo`)

**Interfaces:**
- Produces:
  - `type StoreRefundStatus = "none" | "pending" | "manual_pending" | "succeeded" | "failed" | "delayed" | "transfer_pending"` (`store-orders.ts`)
  - `type StoreRefundStatusWire = StoreRefundStatus | (string & {})` (`store-orders.ts`)
  - `type RefundTone = "progress" | "done" | "problem"` (`refund-status.ts`)
  - `toRefundStatus(raw: string | null | undefined): StoreRefundStatus`
  - `resolveRefundStatus(actions: Pick<StoreOrderActionsResponse, "refundStatus" | "refundSummary"> | null | undefined): StoreRefundStatus`
  - `refundTone(status: StoreRefundStatus): RefundTone | null`
  - `KNOWN_REFUND_STATUSES: readonly StoreRefundStatus[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/orders/refund-status.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { RefundSummary } from "@/lib/api/orders/store-orders"
import en from "@/i18n/messages/en/mypage.json"
import ja from "@/i18n/messages/ja/mypage.json"
import ko from "@/i18n/messages/ko/mypage.json"
import { KNOWN_REFUND_STATUSES, refundTone, resolveRefundStatus, toRefundStatus } from "./refund-status"

const KNOWN = ["none", "pending", "manual_pending", "succeeded", "failed", "delayed", "transfer_pending"]

describe("toRefundStatus — core 가 먼저 값을 늘려도 배지가 사라지지 않는다(#1016 36번 PR 4)", () => {
  it("알려진 값은 일곱이다", () => {
    expect([...KNOWN_REFUND_STATUSES].sort()).toEqual([...KNOWN].sort())
  })

  it.each(KNOWN)("알려진 값 %s 는 그대로", (value) => {
    expect(toRefundStatus(value)).toBe(value)
  })

  it.each(["something_new", "", "PENDING", "settling"])("모르는 값 %j 는 환불 처리 중(pending)", (value) => {
    expect(toRefundStatus(value)).toBe("pending")
  })

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("프로토타입 이름 %j 도 모르는 값", (value) => {
    expect(toRefundStatus(value)).toBe("pending")
  })

  it.each([undefined, null])("값 없음(%s)은 none — 정보가 없는 주문에 «처리 중»을 띄우지 않는다", (value) => {
    expect(toRefundStatus(value)).toBe("none")
  })
})

describe("resolveRefundStatus — 상세는 환불 요약의 상태를 우선한다", () => {
  const summary = (status: string): RefundSummary => ({
    status,
    amount: null,
    currency: "KRW",
    paymentMethodLabel: null,
    manualRequired: false,
    expectedProcessingMessage: null,
    lastUpdatedAt: null,
  })

  it("core 응답이 없으면 none", () => {
    expect(resolveRefundStatus(undefined)).toBe("none")
    expect(resolveRefundStatus(null)).toBe("none")
  })

  it("요약이 없으면 주문의 환불 상태", () => {
    expect(resolveRefundStatus({ refundStatus: "succeeded" })).toBe("succeeded")
  })

  it("요약이 있으면 요약의 상태 — 주문은 none 이어도(운영자 부분취소 정산)", () => {
    expect(resolveRefundStatus({ refundStatus: "none", refundSummary: summary("delayed") })).toBe("delayed")
  })

  it("어느 쪽이든 모르는 값은 pending", () => {
    expect(resolveRefundStatus({ refundStatus: "settle_new" })).toBe("pending")
    expect(resolveRefundStatus({ refundStatus: "pending", refundSummary: summary("settle_new") })).toBe("pending")
  })
})

describe("refundTone — 고객에게는 지연과 거절을 구분하지 않는다(스펙 §5.2)", () => {
  it.each([
    ["none", null],
    ["pending", "progress"],
    ["manual_pending", "progress"],
    ["delayed", "progress"],
    ["transfer_pending", "progress"],
    ["succeeded", "done"],
    ["failed", "problem"],
  ] as const)("%s → %s", (status, tone) => {
    expect(refundTone(status)).toBe(tone)
  })
})

describe("문구 — 세 언어 모두 알려진 값마다 라벨과 안내가 있다", () => {
  // locale-parity.test.ts 가 develop 에서 이미 빨개(logoContest) 새 누락을 못 가린다 — 여기서 직접 본다
  it.each([
    ["ko", ko],
    ["en", en],
    ["ja", ja],
  ] as const)("%s", (_, messages) => {
    const labels: Record<string, string> = messages.order.refundInfo.statusLabels
    const guidance: Record<string, string> = messages.order.refundInfo.guidance
    for (const status of KNOWN_REFUND_STATUSES) {
      expect(labels, status).toHaveProperty(status)
      expect(guidance, status).toHaveProperty(status)
      if (status !== "none") expect(labels[status], status).not.toBe("")
    }
  })

  it("ko 는 스펙 §8.2 의 낱말 그대로", () => {
    const { statusLabels, guidance }: { statusLabels: Record<string, string>; guidance: Record<string, string> } =
      ko.order.refundInfo
    expect(statusLabels.delayed).toBe("환불이 늦어지고 있어요")
    expect(guidance.delayed).toBe("영업일 3일 안에 처리해 드릴게요.")
    expect(statusLabels.transfer_pending).toBe("환불 진행 중")
    expect(guidance.transfer_pending).toBe("계좌로 송금해 드릴 예정이에요.")
  })
})
```

`src/lib/orders/cancel-outcome.test.ts` 의 `describe("cancelOutcomeOf", …)` 표 끝(`[{ orderStatus: "confirmed" }, "pending"],` 다음)에 두 줄을 더한다:

```ts
    // PR 5 의 core 가 새 값을 실어도 거절로 읽지 않고, 취소된 주문은 취소로 읽는다(#1016 36번 PR 4 판정 2)
    [{ orderStatus: "confirmed", cancelRequestStatus: "settling" }, "pending"],
    [{ orderStatus: "cancelled", cancelRequestStatus: "settling" }, "cancelled"],
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd $W/web/almondyoung-storefront
npx vitest run src/lib/orders
```

기대: `refund-status.test.ts` 가 `Failed to resolve import "./refund-status"` 로 FAIL. `cancel-outcome.test.ts` 는 **PASS**(코드는 이미 `=== "rejected"` 만 본다 — 이 두 줄은
동작을 못 박는 것이지 바꾸는 것이 아니다).

- [ ] **Step 3: 타입을 고친다 (`store-orders.ts`)**

`StoreRefundStatus`(:51-56)를 아래로 바꾼다:

```ts
export type StoreRefundStatus =
  | "none"
  | "pending"
  | "manual_pending"
  | "succeeded"
  | "failed"
  // 채널 주문 정산(#1016 36번 재설계, 스펙 §8.2): 지연·거절 / 계좌 송금 대기
  | "delayed"
  | "transfer_pending"

/**
 * core 가 보내는 원본 값. core 는 스토어프론트보다 먼저 값을 늘린다(같은 SST 스택이라 배포 순서가 없다) —
 * 표시 전에 반드시 `toRefundStatus`/`resolveRefundStatus`(`@/lib/orders/refund-status`)로 접는다.
 */
export type StoreRefundStatusWire = StoreRefundStatus | (string & {})
```

`RefundSummary.status`(:75)를 `status: StoreRefundStatusWire`, `StoreOrderActionsResponse.refundStatus`(:88)를 `refundStatus: StoreRefundStatusWire` 로 바꾼다.
`cancelRequestStatus`(:92-93)를 아래로 바꾼다:

```ts
  /**
   * 채널 취소 요청 상태(#1016 35번). requested = 처리 중, rejected = 마지막 요청이 실패.
   * 그 밖의 값은 처리 중으로 읽는다(`cancelOutcomeOf`) — core 가 먼저 값을 늘릴 수 있다
   */
  cancelRequestStatus?: "requested" | "rejected" | (string & {})
```

- [ ] **Step 4: 판정 모듈을 쓴다**

`src/lib/orders/refund-status.ts`:

```ts
import type { StoreOrderActionsResponse, StoreRefundStatus } from "@/lib/api/orders/store-orders"

/**
 * 환불 배지의 판정(#1016 36번 재설계 PR 4, 스펙 §8.2).
 *
 * core 는 스토어프론트보다 먼저 `refundStatus` 값을 늘린다. 모르는 값을 그대로 쓰면 배지는 조용히 사라지고
 * 상세엔 i18n 키 문자열(`mypage.order.refundInfo.statusLabels.…`)이 찍힌다 — 그래서 «환불 처리 중»으로 접는다.
 */

export type RefundTone = "progress" | "done" | "problem"

// 알려진 값의 정본. 타입에 값을 더하면 여기서 컴파일 에러가 난다.
const TONE: Record<StoreRefundStatus, RefundTone | null> = {
  none: null,
  pending: "progress",
  manual_pending: "progress",
  // 고객에게는 지연과 거절을 구분하지 않는다(스펙 §5.2) — 빨강은 «환불을 안 해 준다»로 읽힌다
  delayed: "progress",
  transfer_pending: "progress",
  succeeded: "done",
  // core 직접 주문의 환불 실패(스펙 §2.4). 이 재설계 범위 밖이라 그대로 둔다
  failed: "problem",
}

// `in` 은 프로토타입 이름(toString 등)을 알려진 값으로 통과시킨다
function isKnownRefundStatus(value: string): value is StoreRefundStatus {
  return Object.prototype.hasOwnProperty.call(TONE, value)
}

export const KNOWN_REFUND_STATUSES: readonly StoreRefundStatus[] = Object.keys(TONE).filter(isKnownRefundStatus)

/** 값이 없으면 none(환불 정보 없음), 모르는 값이면 pending. */
export function toRefundStatus(raw: string | null | undefined): StoreRefundStatus {
  if (raw == null) return "none"
  return isKnownRefundStatus(raw) ? raw : "pending"
}

/** 주문 상세가 보는 값 — 환불 요약이 있으면 그 상태가 우선이다. */
export function resolveRefundStatus(
  actions: Pick<StoreOrderActionsResponse, "refundStatus" | "refundSummary"> | null | undefined
): StoreRefundStatus {
  return toRefundStatus(actions?.refundSummary?.status ?? actions?.refundStatus)
}

export function refundTone(status: StoreRefundStatus): RefundTone | null {
  return TONE[status]
}
```

- [ ] **Step 5: 문구 세 언어를 더한다**

세 파일 모두 `order.refundInfo.guidance` 와 `order.refundInfo.statusLabels` 객체의 **`failed` 줄 뒤**에 두 키를 더한다(앞 줄 끝에 쉼표).

`src/i18n/messages/ko/mypage.json`:

```jsonc
// guidance
      "delayed": "영업일 3일 안에 처리해 드릴게요.",
      "transfer_pending": "계좌로 송금해 드릴 예정이에요."
// statusLabels
      "delayed": "환불이 늦어지고 있어요",
      "transfer_pending": "환불 진행 중"
```

`src/i18n/messages/en/mypage.json`:

```jsonc
// guidance
      "delayed": "We'll process it within 3 business days.",
      "transfer_pending": "We'll send your refund to your bank account."
// statusLabels
      "delayed": "Refund delayed",
      "transfer_pending": "Refund in progress"
```

`src/i18n/messages/ja/mypage.json`:

```jsonc
// guidance
      "delayed": "3営業日以内に処理いたします。",
      "transfer_pending": "ご登録の口座へ送金する予定です。"
// statusLabels
      "delayed": "返金が遅れています",
      "transfer_pending": "返金手続き中"
```

(ICU 주의: 작은따옴표 `'` 는 placeholder 이스케이프 문자지만 placeholder 가 없는 문장의 `We'll` 은 그대로 출력된다 — en 의 기존 `Cancellation requested. We're processing it.` 과 같다.)

JSON 이 깨지지 않았는지 확인한다:

```bash
for l in ko en ja; do node -e "JSON.parse(require('fs').readFileSync('src/i18n/messages/$l/mypage.json','utf8'))" && echo "$l ok"; done
```

- [ ] **Step 6: 통과를 확인한다**

```bash
npx vitest run src/lib/orders
```

기대: `refund-status.test.ts`·`cancel-outcome.test.ts` 전부 PASS.

```bash
npx tsc --noEmit 2>&1 | grep 'error TS' | grep -E 'refund-status|store-orders|cancel-outcome|order-status-badges|order-details-(desktop|mobile)'
```

기대: **`order-status-badges.tsx` 와 `order-details-{desktop,mobile}.tsx` 에만** 에러가 난다 — 응답 타입을 연 결과 «접지 않고 쓰는 자리»가 드러난 것이다
(`REFUND_STATUS_MAP` 의 누락 키·문자열 색인, `const refundStatus: StoreRefundStatus = …` 대입). Task 2 가 닫는다. `refund-status.ts`·`.test.ts`·`store-orders.ts` 의 에러는 0.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/api/orders/store-orders.ts src/lib/orders/refund-status.ts src/lib/orders/refund-status.test.ts \
  src/lib/orders/cancel-outcome.test.ts src/i18n/messages/ko/mypage.json src/i18n/messages/en/mypage.json src/i18n/messages/ja/mypage.json
git commit -m "feat(storefront): 환불 상태 판정 모듈 — 새 값 둘·모르는 값은 처리 중으로 (#1016 36번 재설계 PR 4)"
```

---

### Task 2: 화면 셋을 접힌 값으로

**Files:**
- Create: `web/almondyoung-storefront/src/components/orders/refund-status-style.ts`
- Modify: `web/almondyoung-storefront/src/components/orders/order-status-badges.tsx:3-7, 60-71, 127-163`
- Modify: `web/almondyoung-storefront/src/domains/order/details/components/order-details-desktop.tsx:30, 175-179, 364-377`
- Modify: `web/almondyoung-storefront/src/domains/order/details/components/order-details-mobile.tsx:36, 182-186, 381-394`

**Interfaces:**
- Consumes: `toRefundStatus`·`resolveRefundStatus`·`refundTone`·`RefundTone` (Task 1, `@/lib/orders/refund-status`)
- Produces: `REFUND_TONE_BADGE_CLASS: Record<RefundTone, string>`, `REFUND_TONE_TEXT_CLASS: Record<RefundTone, string>` (`@/components/orders/refund-status-style`)

화면은 컴포넌트 테스트가 없다(스토어프론트 vitest 는 node 환경, `*.test.ts` 만). 판정은 Task 1 이 지키고, 이 태스크의 검사는 **tsc 가 Task 1 Step 6 의 에러를 전부 닫는 것**이다.

- [ ] **Step 1: 색 클래스 파일을 만든다**

`src/components/orders/refund-status-style.ts`:

```ts
import type { RefundTone } from "@/lib/orders/refund-status"

// 환불 알약(상세 머리)과 «환불 상태» 글자색. 빨강은 실제 오류에만(DESIGN.md 원칙 4).
export const REFUND_TONE_BADGE_CLASS: Record<RefundTone, string> = {
  progress: "bg-amber-100 text-amber-700",
  done: "bg-green-100 text-green-700",
  problem: "bg-red-100 text-red-600",
}

export const REFUND_TONE_TEXT_CLASS: Record<RefundTone, string> = {
  progress: "text-amber-600",
  done: "text-green-600",
  problem: "text-red-500",
}
```

(클래스 값은 지금 알약 맵·상세 삼항 사슬에 있던 것 그대로다.)

- [ ] **Step 2: 알약 (`order-status-badges.tsx`)**

import(:3-7)를 아래로 바꾼다 — `StoreRefundStatus` 는 더 쓰지 않는다:

```ts
import { useTranslations } from "next-intl"
import type {
  StoreFulfillmentStatus,
  StoreOrderActionsResponse,
} from "@/lib/api/orders/store-orders"
import { refundTone, toRefundStatus } from "@/lib/orders/refund-status"
import { cn } from "@/lib/utils"
import { REFUND_TONE_BADGE_CLASS } from "./refund-status-style"
```

`// ── 환불 상태 badge ──` 머리 주석과 `REFUND_STATUS_MAP`(:60-71)을 지운다.

`OrderStatusBadges` 함수 몸 **맨 앞**(`const refundRequestBadge` 보다 위 — 훅은 이른 반환보다 먼저 불러야 한다)에:

```ts
  const tRefundInfo = useTranslations("mypage.order.refundInfo")
```

`const refundBadge = REFUND_STATUS_MAP[actions.refundStatus]`(:157)를 아래로 바꾼다:

```ts
  // core 가 먼저 늘린 값은 «환불 처리 중»으로 접힌다(#1016 36번 PR 4)
  const refundStatus = toRefundStatus(actions.refundStatus)
  const tone = refundTone(refundStatus)
  const refundBadge: BadgeProps | null = tone
    ? { label: tRefundInfo(`statusLabels.${refundStatus}`), color: REFUND_TONE_BADGE_CLASS[tone] }
    : null
```

- [ ] **Step 3: 상세 데스크톱 (`order-details-desktop.tsx`)**

:30 의 import 에서 `StoreRefundStatus` 를 뺀다:

```ts
import type { StoreOrderActionsResponse, RefundSummary } from "@/lib/api/orders/store-orders"
```

`cancel-outcome` import(:37) 아래에 두 줄:

```ts
import { refundTone, resolveRefundStatus } from "@/lib/orders/refund-status"
import { REFUND_TONE_TEXT_CLASS } from "@/components/orders/refund-status-style"
```

:176 을 바꾸고 톤 한 줄을 더한다:

```ts
  const refundSummary: RefundSummary | undefined = coreActions?.refundSummary
  const refundStatus = resolveRefundStatus(coreActions)
  const refundStatusTone = refundTone(refundStatus)
```

(:177-179 의 `refundStatusBadgeLabel`·`refundGuidance`·`showRefundSection` 은 그대로 — 이제 `refundStatus` 가 접힌 값이라 키가 늘 있다.)

«환불 상태» `<span>` 의 삼항 사슬(:366-374)을 아래로 바꾼다:

```tsx
                    <span
                      className={`text-xs font-medium ${refundStatusTone ? REFUND_TONE_TEXT_CLASS[refundStatusTone] : ""}`}
                    >
```

- [ ] **Step 4: 상세 모바일 (`order-details-mobile.tsx`)**

Step 3 과 같은 네 군데를 고친다 — 줄만 다르다:

:36 의 import:

```ts
import type { StoreOrderActionsResponse, RefundSummary } from "@/lib/api/orders/store-orders"
```

`cancel-outcome` import(:41) 아래:

```ts
import { refundTone, resolveRefundStatus } from "@/lib/orders/refund-status"
import { REFUND_TONE_TEXT_CLASS } from "@/components/orders/refund-status-style"
```

:183:

```ts
  const refundSummary: RefundSummary | undefined = coreActions?.refundSummary
  const refundStatus = resolveRefundStatus(coreActions)
  const refundStatusTone = refundTone(refundStatus)
```

«환불 상태» `<span>` 삼항 사슬(:383-391):

```tsx
                  <span
                    className={`text-xs font-medium ${refundStatusTone ? REFUND_TONE_TEXT_CLASS[refundStatusTone] : ""}`}
                  >
```

- [ ] **Step 5: tsc 가 Task 1 의 에러를 전부 닫는지 본다**

```bash
cd $W/web/almondyoung-storefront
npx tsc --noEmit 2>&1 | grep -c 'error TS'          # 46 (기준선 그대로)
npx tsc --noEmit 2>&1 | grep 'error TS' | grep -E 'refund-status|store-orders|cancel-outcome|order-status-badges|order-details-(desktop|mobile)'   # 비어 있어야 한다
grep -rn 'REFUND_STATUS_MAP\|=== "manual_pending"' src/components/orders src/domains/order/details   # 비어 있어야 한다
```

개수가 46 이 아니면 **늘어난 에러가 어느 파일인지** 본다(같은 개수라도 다른 에러로 갈릴 수 있다 — 건드린 파일 grep 이 우선이다).

- [ ] **Step 6: 커밋**

```bash
git add src/components/orders/refund-status-style.ts src/components/orders/order-status-badges.tsx \
  src/domains/order/details/components/order-details-desktop.tsx src/domains/order/details/components/order-details-mobile.tsx
git commit -m "feat(storefront): 환불 알약·상세 환불 상태가 접힌 값과 i18n 라벨을 쓴다 (#1016 36번 재설계 PR 4)"
```

---

### Task 3: 게이트·PR

**Files:** 없음(검증·push·PR)

- [ ] **Step 1: 스토어프론트 게이트**

```bash
cd $W/web/almondyoung-storefront
npx vitest run 2>&1 | tail -5
```

기대: **73 files**(기준선 72 + `refund-status.test.ts`), 테스트는 517 보다 늘어난다 — 실패는 `locale-parity.test.ts` 의 en·ja 2건뿐(기준선). 실패 목록을 확인한다:

```bash
npx vitest run 2>&1 | grep -E '^ FAIL'     # locale-parity 두 줄만
npx tsc --noEmit 2>&1 | grep -c 'error TS'  # 46
```

- [ ] **Step 2: 루트 게이트 (스토어프론트만 바꿨으니 영향 없음을 확인하는 용도)**

```bash
cd $W
npm run type-check     # 에러 0
npx jest               # 실패 0 (OOM 이면 --maxWorkers=2)
git diff origin/develop --stat -- apps packages libs   # 비어 있어야 한다(core·admin-web·Medusa 불변)
git -C /home/pauseb/workspace/almondyoung-server status --short   # 메인 오염 없음
git -C /home/pauseb/workspace/almondyoung-server rev-parse develop origin/develop
```

- [ ] **Step 3: 화면 확인 — 하지 않는다(갈음)**

core 가 새 값을 아직 안 내므로 화면에서 새 값을 볼 길은 로컬 core 응답을 손으로 바꾸는 것뿐이고, 워크트리 스토어프론트는 Turbopack 이 `node_modules` 심볼링크를 거부해 메인 체크아웃에서
띄워야 한다(메모리 `channel-cancel-refund-refusal-36`). 비용 대비 얻는 것이 Task 1 테스트와 겹친다. **새 값의 실제 화면은 PR 5 의 로컬 스모크 S1·S2(스펙 §10 — 고객 화면 «환불 처리 중»
→ «계좌 송금 예정» → «환불 완료»)가 본다.** PR 본문에 그렇게 적는다.

- [ ] **Step 4: push·PR**

```bash
git push -u origin feat/1016-36-storefront-refund-badges
```

PR 제목 `feat(storefront): 환불 배지 새 값·모르는 값 대비 (#1016 36번 재설계 PR 4)`, base `develop`. 본문 절:
**무엇** · **판정**(이 계획 판정 1~4 의 «정한 것» 한 줄씩) · **스펙과 다른 점**(D1~D4 표) · **혼자 나갔을 때**(아래) · **PR 5·6 에 넘길 것**(이 계획의 두 목록) · **배포**(아래) ·
**검증**(Step 1·2 의 실측 숫자, Step 3 의 갈음) · **Also found**(아래). `#1016` 본문·코멘트는 사용자 확인 없이 고치지 않는다. 머지는 사용자가 `! gh pr merge <번호> --squash`.

---

## 혼자 나갔을 때 (옛 core, PR 5 전)

- 라이브 core 는 `delayed`·`transfer_pending` 을 내지 않는다 → 새 문구는 휴면.
- 알려진 다섯 값의 상세 «환불 상태» 줄·안내·색은 오늘과 같다.
- **바뀌어 보이는 것 둘(판정 4):** 상세 머리의 환불 알약이 i18n 라벨을 쓴다 — `manual_pending` «환불 수동 처리 대기» → «수동 처리 대기», `failed` «환불 실패» → «환불 확인 필요».
  en·ja 화면의 환불 알약이 한국어 → 번역문.
- 모르는 값 접기·`cancelRequestStatus` 열기는 옛 core 가 다섯 값만 내므로 효과 없음.

## 배포

- **순서가 이 PR 의 존재 이유다:** 스토어프론트(`sst.aws.Nextjs('Storefront')`)와 core 는 `lcnine-services` **같은 스택**이라 한 배포 안의 순서를 못 정한다(메모리
  `sst-single-stack-no-deploy-order`). **«PR 4 머지 → 배포 완료 → 그 뒤에 PR 5 머지»** 로만 지켜진다 — PR 본문 맨 위에 적는다.
- 배포 전 `npm ci` **세 트리**: `npm ci && npm ci --prefix apps/admin-web && npm ci --prefix web/almondyoung-storefront` — 배포 빌드가 로컬 `node_modules` 를 쓴다(메모리 `shop-listings-ugc-pr1`).
  떠 있는 `next dev` 는 끈다.
- 마이그레이션 없음. 배포 전 develop 의 대기 마이그레이션을 평소대로 대조한다 — 남이 머지한 마이그도 함께 실린다(메모리 `deploy-ships-other-merged-prs-migrations`).
- 배포는 사용자가 `! cd deployments/lcnine/services && npx sst deploy --stage live`(에이전트 실행은 분류기가 막는다).

## Also found (PR 본문에 옮긴다 — 고치지 않는다)

- **develop 의 `locale-parity.test.ts` 가 빨갛다**: `logoContest.detail.description` 이 ko 에만 있다(en·ja 없음). 스토어프론트는 CI 가 없어 아무도 못 봤다 — en·ja 사용자에겐 그 키 이름이 보인다.
- **출고 알약도 같은 병이다**: core 의 `StoreFulfillmentStatus` 는 `not_created|preparing|shipping|delivered|canceled`(`store-order-actions.dto.ts:6-11`)인데 스토어프론트 맵은
  `created|picking|packed|shipped…` 라 `preparing`·`shipping` 이면 출고 알약이 조용히 사라진다. 이 PR 의 `toRefundStatus` 와 같은 처방이 맞다.
- 상세 머리의 환불 알약과 결제 영역의 «환불 상태» 줄이 같은 정보를 두 번 보인다(`ui-minimal-text`).

---

## Self-Review

- **스펙 커버리지:** §8.2 표 넷째 열 — `pending`·`succeeded` 기존 유지(Task 1 테스트), `delayed`·`transfer_pending` 문구(Task 1 Step 5, ko 낱말 테스트) · §8.2 «옛 스토어프론트는 새 값을 모른다
  → 모르는 값을 처리 중으로»(Task 1 `toRefundStatus`, Task 2 화면 셋) · §5.2 «지연·거절 구분 안 함»(`delayed` 하나·호박색, `refundTone` 테스트) · §10 «스토어프론트 — 배지 순수함수»
  (Task 1) · §9.2 의 4 «core 가 새 값을 안 낸다 → 휴면»(«혼자 나갔을 때») · §8.2 «다시 읽기는 정리 PR 에서»(Global Constraints, PR 6 에 넘길 것) · §8.2 «수동 모드 송금 여부는 core 가
  wallet 목록으로»(PR 5 일 — 넘길 것 3·4 에 값 계약).
- **타입 일관성:** `StoreRefundStatusWire`(Task 1 Step 3) → `RefundSummary.status`·`refundStatus`. `toRefundStatus`·`resolveRefundStatus`·`refundTone`·`RefundTone`(Task 1 Step 4) →
  Task 2 Step 1~4. `REFUND_TONE_BADGE_CLASS`·`REFUND_TONE_TEXT_CLASS`(Task 2 Step 1) → Step 2~4. `refundStatusTone` 변수명은 데스크톱·모바일 같다.
- **Review Focus → 테스트:** 프로토타입 이름(Task 1 `toRefundStatus`) · 값 없음 none(Task 1) · 요약 우선(Task 1 `resolveRefundStatus`) · 세 언어 키(Task 1 «문구») ·
  `cancelRequestStatus` 새 값(Task 1 `cancel-outcome.test.ts`).
