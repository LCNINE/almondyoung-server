# 새 세션 지시문 — 채널 취소 정산 재설계 PR 5 (core + admin-web) 계획·구현

## 너의 임무

승인된 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` 의 **PR 5(core + admin-web) — «새 흐름이 켜진다»** 구현 계획을 쓰고,
사용자가 실행 방식을 고르면 구현한다. `superpowers:writing-plans` 로 시작한다. 사용자는 한국어로 응답받기를 원한다.

**스펙의 결정(S1~S11)을 다시 묻지 마라** — 2026-10-11 사용자가 승인했다. 계획 중 스펙과 코드가 어긋나면 스펙을 정본으로 판정하고 기록한다.
단 아래 «먼저 판정할 것»은 스펙이 말하지 않았거나 코드가 스펙과 다른 자리다 — 계획 머리에서 판정하고 근거·비용을 적는다.

**이 문서들은 develop 에 없다.** 스펙·계획·지시문은 브랜치 `docs/1016-36-channel-cancel-settlement` 에 있다(워크트리
`.claude/worktrees/docs-1016-36-settlement`, origin 에 push 안 됨). 읽기는 그 워크트리에서, 이 PR 의 계획도 그 브랜치에 커밋한다.

**이 PR 은 재설계에서 가장 크다**(마이그레이션·확정 트랜잭션·사실 받기·리컨실러 규칙·조치 API·보드·actions API·admin-web 화면). 판정 1(나눌지)부터 한다.

## 먼저 읽을 것

1. `CLAUDE.md`(특히 Layer Architecture·Transaction Propagation·Inventory Query Rules·Destructive changes 의 expand 순서·크론), `apps/admin-web` 쪽 규칙
2. 스펙 **§5**(상태 모델·고객/운영자 화면 표), **§7.3·§7.4**(이 PR 의 본문), **§8.1**(admin-web), **§8.2**(actions API 가 낼 값), §9.2·§9.3, §10 core·admin-web 테스트, §12(ADR-0044)
3. **앞 PR 들이 넘긴 것 — 이 PR 의 계약이다:**
   - PR 3 계획 `docs/superpowers/plans/2026-10-12-channel-cancel-settlement-pr3-adapter.md` 의 «PR 5 에 넘길 것» 7개 + PR #1050 본문 D1~D6
     (요지: `settling` 행은 `SettlementFailed` 만 읽고 옛 사실은 무시 · 같은 `requestId` 의 사실이 여러 번·순서 없이 온다 → `at` 이 늦을 때만 덮어씀 · `refused` 판정은 `retryable`
     하나 · `failureCode` 는 열린 문자열, `wallet_refund_refused:` 접두사로 «환불 거절» vs «정산 실패·개발 확인» · 사실에 `salesOrderId` 없음 → `requestId` 로 찾음 ·
     전체취소 일시 실패 `message` 는 대개 «An unknown error occurred.»)
   - **PR 4 #1051 본문의 «PR 5 에 넘길 것» 6개** (요지: 🔴고객 취소 응답을 확정 «뒤» 판매주문으로 · `cancelRequestStatus` 새 값 불필요 · `refundStatus`·`refundSummary.status` 같은 값 ·
     새 값의 `expectedProcessingMessage` 는 `null` · core 의 `StoreRefundStatus`·`VALID_REFUND_STATUSES` 별도 복사본에 두 값 · 새 `cancelUnavailableReason` 금지)
   - PR 2 #1049 본문 D8·알려진 한계(장부에 없는 자동 PENDING 은 일시 실패로 돈다, 부분취소 `edited` 재시도는 37번 외부 환불 판정을 다시 안 돌림 → 출구는 수동)
   - PR 1 계획 «admin-web 송금 대기 노출은 PR 5»(:1530·:2155 — 관리자 환불 목록 `manualConfirmable` 은 아직 `false`)
4. 메모리 `channel-cancel-settlement-redesign.md`, `reconciler-row12-design.md`(🔴배포 전 EXPLAIN 5초 게이트, 관찰 모드 관례), `deploy-ships-other-merged-prs-migrations.md`,
   `sst-single-stack-no-deploy-order.md`(🟢`--target` 은 다른 Next 앱 프로덕션 빌드가 로컬에 있을 때만), `subagent-worktree-contamination.md`, `admin-web-no-component-tests.md`,
   `cron-once-per-period-claim-821.md`, `event-contract-runtime-validation.md`, `channel-order-cancel-35.md`, `refund-model-adr-0043-row37.md`
5. 전례: PR 3·PR 4 계획의 판정 절·Global Constraints·Review Focus·«혼자 나갔을 때» 관례

## 지금 상태 (2026-10-12)

- PR 0 #1047 · PR 1 #1048 · PR 2 #1049 · PR 3 #1050 **MERGED·라이브.** PR 4 #1051 **MERGED·라이브**(develop `be162acd4`, `--target Storefront` 단독 배포 — 스토어프론트가 `delayed`·
  `transfer_pending`·모르는 값을 이미 안다)
- 라이브 channel-adapter 는 새 것: 전체취소는 `channel-cancel`, 정산 실패는 `ChannelOrderSettlementFailed` + 옛 사실(`Rejected`·`Stalled`)을 같은 트랜잭션에 함께 내고,
  일시 실패는 사실을 낸 뒤 **던진다**(ack 는 PR 6). 라이브 core 는 옛 것이라 새 사실을 경고 후 버린다
- 🔴 **지금 라이브의 구멍(PR 5 가 닫는다):** 전체취소 wallet 영구 거절 → Medusa 미취소 + 요청 보류 + 사유 없는 정체. 그 상태에서 [요청 접기] = 고객이 취소한 물건 출고
- 사용자 결정: 기존 결제·환불 건은 이미 처리된 것으로 간주 — 소급 환급·대조를 제안하지 말 것
- 남은 PR: 6(정리 — 미들웨어, 리컨실러 실행 모드, adapter ack 전환, 스토어프론트 다시 읽기 삭제, 옛 사실·`REFUND_FAILED` 계약 정리) — 이 세션 범위 밖

## PR 5 범위 (스펙 §7.3·§7.4·§8.1·§8.2·§9.2 의 5)

| 변경 | 요지 |
| --- | --- |
| 마이그레이션 | `sales_order_amendments_status_check` 에 `settling` 추가(additive, **`migrate → deploy`**) |
| 확정 트랜잭션 | 요청 생성 경로에서 계획 → **물리 적용**(지금 settler 가 수집 때 하던 것) → 행 `settling` + `metadata.request.appliedAt` → 명령 outbox. 전체취소면 판매주문도 취소 |
| 사실 받기 | `OrderCancelled`(전체)·`OrderModified` `stage: refunded`(부분) → `applied` + `outcome`(물리 재적용 없음) · `SettlementFailed` → `metadata.settlement.lastFailure`, `retryable:false` 면 `refused` · `settling` 행은 옛 사실 무시 |
| 리컨실러 규칙 | «정산 재시도» — `settling`·`state ≠ refused` → 같은 `requestId`·`refundMode` 로 명령 재발행. **관찰 모드로 배포** |
| 조치 API | `POST …/cancel-request/:requestId/retry`, `…/manual-refund`. 새 흐름 요청엔 [요청 접기] 없음 |
| 정체 보드 | 판정 SQL `creq` 가 `settling` 행을 `settle_in_progress`/`settle_delayed`(확정 후 30분 초과)/`settle_refused` 로. 확정 시각 기준 체류·3영업일 기한(주말만 제외) |
| actions API | 스토어프론트 `refundStatus`: 정산 중 `pending` · 지연/거절 `delayed` · 수동 송금 대기 `transfer_pending` · 완료 `succeeded`. 수동 모드 주문만 wallet 목록 API 로 송금 여부 확인 |
| admin-web | 보드 `stateLabel`(`settle_delayed` «환불 지연», `settle_refused` «환불 거절»), 주문 상세 취소 영역(정산 상태·경과·기한·사유·[다시 시도]·[계좌 송금으로 환불] + 확인 창 문구 §8.1), wallet 송금 대기 화면에 수동 실행 행 |
| 문서 | ADR-0044(«물리 확정은 core 가 요청 순간에, 돈의 정산은 채널이» — ADR-0042 원칙 2 대체, §12). 35번 스펙 머리 한 줄(§12) |
| 범위 밖 | 리컨실러 실행 모드·adapter ack·미들웨어·옛 사실 정리(PR 6). Medusa·channel-adapter·wallet·스토어프론트는 바꾸지 않는다 |

### 코드 지도 (develop `be162acd4` 기준 — 계획에서 다시 확인할 것)

**core — 취소 요청** (`apps/core/src/modules/sales-order/channel-cancel-request/`)
- 상태 타입 `channel-cancel-request.types.ts:8` `CancelRequestStatus = 'requested'|'applied'|'rejected'|'superseded'`, 메타데이터 zod `CancelRequestMetadataSchema`(:30~ — `request.stage`·`appliedAt`·`command`, `rejection`, `outcome`, `supersededReason`. **`settlement` 칸 없음**)
- 생성 `channel-cancel-request.manager.ts:61` `request()` — 판매주문 잠금 → 재생(`findBySourceKey`) → 열린 요청(`findOpen` = `status='requested'`) → 박스 잠금 → `planCancellation` → 행 `requested` insert → `enqueue`(:248, 키 `cancel-request:${id}`). 지금은 **물리 적용을 안 한다**
- 옛 사실 `reject()`(:166)·`markStalled()`(:188)는 `status !== 'requested'` 면 무시 — `settling` 행에 옛 사실이 오면 이미 무시된다(확인할 것). `resend()`(:199)·`withdraw()`(:213)
- 물리 적용·종결 `channel-cancel-settler.ts` — `settleModified`(:34, 부분: `appliedAt` 없으면 `applyPhysical` 후 `refunded` 면 `applied`), `settleCancelled`(:94, 전체: 열린 전체 요청 `applied`, 부분 요청 `superseded`). **둘 다 `findOpen`(= `requested`) 만 본다** → `settling` 행을 못 찾는다
- 조회 `channel-cancel-request.reader.ts` — `findOpen`(:30)·`latestFor`(:50)
- 보류 관문 `apps/core/src/modules/fulfillment/hold/cancel-request-hold.ts`(스펙 §7.3 — `requested` 만 본다)
- 요청자 셋: `operator`·`customer`·**`wallet-refund-approval`**(무통장 환불 승인 뒤 `cancelByWalletIntentAfterRefund` — wallet 이 이미 돌려준 뒤 취소. PR 2 장부 맞추기가 그 환불을 넣어 남은 몫 0 이 되는지 시나리오로 확인)
- 유니크 인덱스 `uq_sales_order_amendments_open_cancel_request`(`WHERE status='requested'`) — 스펙: 옛 행용으로 남긴다. `settling` 은 한 주문에 여럿 가능(§7.3)
- 스키마 `apps/core/src/modules/inventory/schema/inventory.schema.ts:1508` `statusCheck`

**core — 사실 소비** `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`
- `handleOrderCancelled`(:207) — `salesOrdersService.cancel(...)` 후 `settleCancelled`. 🔴스펙 §7.3: **이미 취소된 판매주문이면 아무것도 하지 않아야 한다**(확정 트랜잭션이 먼저 취소했다). `sales-orders.service.ts:463` `cancel()` 의 이미 취소됨 동작을 확인하고 아니면 고친다
- `handleOrderModified`(:273), `handleChannelOrderCancelRejected`(:304), `…Stalled`(:316). **`ChannelOrderSettlementFailed` 핸들러 없음** — 새로 단다(`npm run audit:event-handlers`·`audit:consume-validation -- --gate`)

**core — 고객 actions API** `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts`
- 🔴 `processCancelRequest`(:749~) 끝줄 `return this.buildActionsView(so)` — `so` 는 **요청 전에** 읽은 행. 재생 경로도 같다(PR 4 넘길 것 1)
- `buildActionsView`(:545~) — `cancelRequestStatus` 는 `requested`·`rejected` 만, 환불 상태는 `cancellation_linked_wallet_refund`·`order_lifecycle_refund_collected` 링크로. `VALID_REFUND_STATUSES`(:73), `buildRefundSummary`(:1399, `messages: Record<StoreRefundStatus, …>`)
- DTO `dto/store-order-actions.dto.ts:13` `StoreRefundStatus`(스토어프론트와 별도 복사본)
- wallet 클라이언트 `services/wallet-refund.client.ts` — `refundByIntent`(:47)뿐. 목록 API(`GET /v1/payment-intents/:id/refunds`, PR 1)를 부를 메서드가 없다
- 🔴 actions **배치** 엔드포인트(`by-channel-order/actions/batch`)가 같은 `buildActionsView` 를 쓰면 수동 모드 주문마다 wallet 호출 — N+1·타임아웃이 목록 화면을 막지 않게 정한다

**core — 운영자 API** `controllers/sales-orders.controller.ts:100` `cancel-request/resend`, `:107` `cancel-request/withdraw` — 스펙의 새 경로는 `…/cancel-request/:requestId/retry`·`/manual-refund`

**core — 리컨실러 틀** `apps/core/src/modules/fulfillment/order-reconcile/`
- 규칙 인터페이스 `order-reconcile.rule.ts` — `name`·`row`·`mode`·`fingerprint`·`check`·`act`, `situation`(보드 단계·세부 상태). 크론 `order-reconcile.job.ts:17` `@CronOnce('* * * * *')`
- 🔴 **백오프·포기가 이미 있다** — `order-reconcile.state.ts:5-10` `MAX_ATTEMPTS = 5`, `RETRY_DELAYS_MIN = [1, 4, 16, 64, 256]`, 포기 뒤 `GAVE_UP_RECHECK_MIN = 1024`. 스펙 §7.3 은 «1분 → 5분 → 15분 → 이후 1시간», 포기 없이 계속(«환불 지연»은 리컨실러가 스스로 끝내는 것이 S4 스모크). 판정 3
- 지문이 바뀌면 횟수 리셋(`effectivePrior`). 기존 규칙 둘: `rules/resume-pending-consolidation.rule.ts`·`wake-awaiting-matching.rule.ts`(모양 전례)
- 상자 규칙은 채널 취소 요청이 있는 주문을 뺀다(D16) — `settling` 도 «채널 취소 요청»으로 세는지 확인

**core — 정체 보드** `apps/core/src/modules/fulfillment/order-progress/`
- 판정 SQL `order-progress.judge-sql.ts:159` `creq` — 지금 `cancel_requested`/`cancel_edited` 둘. 기준 `order-progress.thresholds.ts:54`(`cancel_request` 세부 상태)·`:120`(`cancel_request: 5 * MINUTE`)

**admin-web**
- 보드 라벨 `src/lib/api/domains/orders/order-progress.shape.ts:161`(`cancel_requested`·`cancel_edited`) + `.spec.ts`, 화면 `src/features/order/stall-board/components/stage-orders.tsx`
- 취소 요청 표시 `src/lib/api/domains/orders/cancel-request.shape.ts`(`toCancelRequestView`·`cancelActionOf`·`cancelRequestLine`·`unresolvedRefundToAsk` …) + `.spec.ts`, 클라이언트 `sales-orders.client.ts`
- 주문 화면 `src/features/order/history/components/{table/index.tsx, modals/cancel-order-modal.tsx}`, `hooks/use-order-rows.ts`
- wallet 환불 `src/lib/api/domains/wallet/index.ts:151`(confirm)·`:163`(`listRefunds` → `/v1/admin/refunds`), 화면 후보 `src/features/payments/components/bank-transfer-table/`·`src/app/(admin)/payments/[id]/payment-detail-main.tsx:342` — **«송금 대기» 목록이 정확히 어느 화면인지 찾아 확인할 것**
- 🔴 admin-web 은 컴포넌트 테스트 불가 — 판정은 순수함수(`*.shape.ts`) + 스펙(메모리 `admin-web-no-component-tests`). **CI 는 admin-web tsc 를 안 돈다** — 로컬 `cd apps/admin-web && npx tsc --noEmit`

## 먼저 판정할 것 (계획 머리에 판정·근거·비용을 적는다)

1. **한 PR 인가, 둘인가.** 범위 표가 넓다. 나눈다면 5a(core: 마이그·확정·사실·규칙 관찰·조치 API·보드 SQL·actions API) → 5b(admin-web)가 자연스럽다.
   - 같은 스택이다: admin-web(Lambda)은 즉시, core(ECS)는 마지막에 바뀐다(메모리 `sst-single-stack-no-deploy-order` «중간 상태의 위험은 프론트만 새 코드»). 한 PR 이면 그 창 동안 새 버튼이 404 —
     무해한지 따진다. 나누면 «5a 배포 완료 → 5b 머지»로 지켜진다
   - 🔴 **5a 만 라이브인 동안 운영자가 무엇을 보나** — `settling` 행이 보드에 «환불 거절»로 뜨는데 admin-web 에 [다시 시도]·[계좌 송금으로 환불]이 없으면 출구가 없다. 옛 [요청 접기]는
     `requested` 만 받으니 `settling` 엔 안 뜬다(확인). 이 공백이 하루면 괜찮은지, 아니면 같은 PR 이어야 하는지 정한다
2. **확정 트랜잭션에서 물리 적용을 어디서 부르나.** 지금 적용은 settler(`applyPhysical` — 부분취소, savepoint 안 `cancel` 계열)와 `handleOrderCancelled`(전체 — `salesOrdersService.cancel`)에 흩어져 있다.
   요청 생성 경로가 같은 함수를 부르게 옮길지, 새 함수로 묶을지. **판정 실패(출고 못 막음·적용 거절)면 아무것도 쓰지 않는다**(§10 core 첫 줄) — 지금 settler 의 `APPLY_REFUSED`·
   `CHANNEL_CHANGE_MISMATCH` → `superseded` 분기가 새 흐름에서 무엇이 되는지(요청 순간 적용이면 채널 변경 불일치는 생기지 않는가) 정한다
   - 전체취소의 판매주문 취소를 확정 트랜잭션에서 하면 `handleOrderCancelled` 의 `cancel()` 이 이미 취소된 주문을 만난다 — 스펙대로 no-op 인지 코드로 확인
   - 부분취소 수집(`OrderModified`)의 델타를 settler 가 «요청이 먹은 감소»로 빼고 나머지를 5번 규칙에 넘긴다 — `settling` 행(이미 적용됨)도 그 감소를 먹어야 이중 적용이 안 된다
3. **리컨실러 백오프·포기 — 틀 것을 쓰나, 스펙 것을 더하나.** 틀: 1·4·16·64·256분, 5회 뒤 포기(≈5.7시간), 포기 뒤 1024분마다 재확인. 스펙: 1·5·15분 → 이후 1시간, 포기 없음,
   3영업일 기한. 틀을 규칙별로 바꾸게 하면 다른 규칙(12번·25번 라이브, 관찰 모드)에 닿는다 — 스펙 §7.3 «규칙마다 따로 두지 않는다»와 함께 판정. 포기한 정산 요청을 운영자가 보드에서 보는지 확인
4. **`state` 와 30분 판정의 정본.** 스펙: `metadata.settlement.state ∈ in_progress|delayed|refused`, «30분 경과 판정은 보드·리컨실러가 한다». 그러면 `delayed` 를 메타에 쓰는 주체가 없다 —
   보드 SQL·actions API·리컨실러 지문(`state` 포함)이 같은 30분 규칙을 각자 계산하게 되는지, 메타에 쓰는지 정한다. 스토어프론트 `delayed` 와 보드 `settle_delayed` 가 같은 순간에 바뀌어야 한다
5. **actions API 의 환불 상태 도출.** 채널 주문의 지금 도출(링크 `order_lifecycle_refund_collected` → `succeeded`)과 `settling` 행의 `settlement` 을 어떻게 합치나. 수동 모드 «송금 대기 → 완료»는
   wallet 목록(MANUAL PENDING → SUCCEEDED)으로 본다(§8.2). wallet 호출 실패 시 무엇을 보이나(`transfer_pending` 유지가 안전). 배치 엔드포인트의 호출 수 상한
6. **고객 화면이 Medusa 상태를 직접 읽는 곳.** 확정(core `cancelled`)과 정산 완료(Medusa `canceled`) 사이에 스토어프론트가 Medusa 주문·결제 상태(`order.status`·`payment_status` →
   «결제 완료» 등)를 보이는 자리가 있는지 grep 한다(`web/almondyoung-storefront/src/domains/order`, 목록 `get-order-list-data.ts`). 있으면 «취소 완료»와 모순 — 스토어프론트는 이 PR 에서
   바꾸지 않으므로, 모순이 있으면 PR 6 으로 넘기거나 멈추고 사용자에게 묻는다
7. **옛 `requested` 행과의 공존.** 라이브의 열린 `requested` 행은 옛 규칙([다시 보내기]·[요청 접기]·보류)으로 끝까지 돈다. 새 코드가 그 행에 옛 사실을 계속 적용하는지, 보드·admin-web 이
   두 종류를 섞어 보이는지. 배포 전 그 행 수를 센다(아래 «배포»)

## 테스트·게이트

- 루트 `npm run type-check` 0 · `npx jest` 0 · `npm run audit:event-handlers` · `npm run audit:event-publishers` · `npm run audit:consume-validation -- --gate`(develop 기준선을 계획에 적는다)
- **admin-web `cd apps/admin-web && npx tsc --noEmit` 0** (CI 가 안 돈다) · admin-web 순수함수 스펙은 루트 jest 가 돈다
- core 통합(`describeIfDb`, `npm run test:core:integration:local`) — 확정 트랜잭션(물리 적용 + `settling` + 명령이 한 트랜잭션, 판정 실패면 아무것도 안 씀)·사실 받기(`applied`·`refused`·옛 사실 무시·
  `superseded`·정산 중 요청 여럿)·리컨실러(백오프·`refused` 미재시도·지문 리셋·관찰)·조치 API·옛 `requested` 공존·판정 SQL 세 상태. 워크트리에선 `COMPOSE_PROJECT_NAME` 필수(메모리 `core-integration-tests-local`)
- 🔴 **리컨실러 후보 SQL 은 배포 전 라이브 EXPLAIN 5초 게이트**(메모리 `reconciler-row12-design`) — 계획에 명령을 적는다
- 로컬 스모크 S1~S4(스펙 §10 표 — `bootstrap:e2e:local` → `start:all:local` → `preflight:e2e:local`, 브라우저 로그인은 사람). 스토어프론트 화면(«환불 처리 중»→«계좌 송금 예정»→«환불 완료»)이
  PR 4 의 화면 확인을 갈음한다 — 스토어프론트는 워크트리 심볼링크를 Turbopack 이 거부하니 메인 체크아웃에서 띄운다

## 배포

- **`migrate → deploy`**(expand — 새 상태값을 쓰는 코드가 제약보다 먼저 뜨면 insert 가 깨진다). core `db:migrate` 를 사람이 `sst deploy` 전에
- **배포 전(읽기 전용, 사용자 실행):** 라이브의 열린 `requested` 취소 요청 행 수(§9.2) · 리컨실러 후보 SQL EXPLAIN · develop 의 대기 마이그레이션 대조(남이 머지한 마이그도 함께 실린다 —
  10-10 사고, 메모리 `deploy-ships-other-merged-prs-migrations`)
- 배포 전 `npm ci` 세 트리(루트·admin-web·스토어프론트 — 🔴스토어프론트 `npm ci` 는 `yarn.lock` 을 다시 쓴다, 커밋하지 말고 되돌린다). 떠 있는 `next dev` 는 끈다
- 리컨실러 규칙은 **관찰 모드**로 나간다 — 실행 모드는 PR 6. 그동안 «환불 지연»은 운영자 [다시 시도]가 출구다(그리고 PR 6 전까지 adapter 의 일시 실패는 Kafka 3회 재시도 뒤 DLQ)
- 머지는 사용자가 `! gh pr merge <번호> --squash`. 배포는 사용자가 `! cd deployments/lcnine/services && npx sst deploy --stage live`

## 지켜야 할 제약

- 서브에이전트는 반드시 워크트리에서 — 메인 체크아웃 오염 6회 재발. 메인 `git status` 와 `git rev-parse develop origin/develop` 로 확인
- **워크트리 만든 직후 `node_modules` 심볼링크 넷**: 루트, `apps/admin-web`, `native/warehouse-app`, `web/almondyoung-storefront`
- Medusa·channel-adapter·wallet·스토어프론트는 바꾸지 않는다 — 바꿔야 한다는 결론이 나오면 멈추고 «PR 6 에 넘길 것» 또는 사용자 질문으로
- 계약(`packages/event-contracts`)을 바꿔야 하면 «더하기»만(optional 칸). enum 값 추가는 소비자 선배포(메모리 `event-contract-runtime-validation`)
- CLAUDE.md 의 트랜잭션 규칙(`dbService.run`, `tx?: DbTx` 전파, per-class `inTx` 금지)·Inventory Query Rules(`db.query.*`·`as` 금지)
- 새 크론이 필요하면 `@CronOnce` (리컨실러 틀은 이미 `@CronOnce`)
- `gh pr merge` 는 권한 분류기가 막는다 — 머지는 사용자. push·PR 생성은 된다
- #1016 본문·코멘트는 사용자 확인 없이 고치지 않는다
