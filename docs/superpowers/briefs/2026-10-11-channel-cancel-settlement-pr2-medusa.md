# 새 세션 지시문 — 채널 취소 정산 재설계 PR 2 (Medusa) 계획·구현

## 너의 임무

승인된 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` 의 **PR 2(Medusa — 정산 라우트 둘)** 구현 계획을 쓰고,
사용자가 실행 방식을 고르면 구현한다. `superpowers:writing-plans` 로 시작한다. 사용자는 한국어로 응답받기를 원한다.

**스펙의 결정(S1~S11)을 다시 묻지 마라** — 2026-10-11 사용자가 승인했다. 계획 중 스펙과 코드가 어긋나면 스펙을 정본으로 판정하고 기록한다.

## 먼저 읽을 것

1. `CLAUDE.md` — 특히 **«Medusa (`apps/medusa`) — 확장은 소스가 아니라 문서에서 시작한다»**: 확장점 판단 전에 `https://docs.medusajs.com/llms.txt` 를
   먼저 읽는다. 라우트는 override 가 아니라 «복제», 워크플로 훅은 워크플로당 하나. `apps/medusa/CLAUDE.md` 는 없다
2. 스펙 §2.2(Medusa 2.13.4 사실 — 기본 취소의 환불 삼킴·유령 환불 거래, 취소된 주문엔 환불 불가), **§6.1~§6.4**(정산 라우트·장부 맞추기·자동/수동·
   almond-payment 오류 번역), §9.1 의 #1045 행(옮길 것/버릴 것), §9.2 의 2(«부르는 쪽 없음, 부분취소 응답 모양 유지»), §9.3, **§10 Medusa 통합**
3. 메모리 `channel-cancel-settlement-redesign.md`, `channel-cancel-refund-refusal-36.md`, `medusa-integration-tests-need-db-env.md`,
   `medusa-route-override-is-per-method.md`, `framework-extension-points-need-docs.md`, `medusa-module-service-defers-inserts.md`,
   `packages-alias-resolution-by-tree.md`, `medusa-storefront-gate-topology.md`
4. 전례 계획: `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr1-wallet.md`(같은 재설계의 관례 — Global Constraints·Review Focus·실행 준비 절)

## PR 2 범위 (스펙 §6.1~§6.4)

| 변경 | 요지 |
| --- | --- |
| 전체취소 정산 라우트 | `POST /admin/orders/:id/channel-cancel` — 주문 잠금 → 검증(`assertCancelable`) → ① 장부 맞추기 → ② 남은 몫 환불 → ③ 기본 `cancelOrderWorkflow`. **«환불 → 취소» 순서**(취소된 주문엔 환불 못 한다, §2.2) |
| 부분취소 정산 라우트 | 기존 `POST /admin/orders/:id/partial-cancel` 에 같은 ①② 를 넣는다. **«수정 확정 → 환불» 순서 유지**. 기존 400 `partial_cancel_rejected`·`external_refund_*` 와 **옛 channel-adapter 가 읽는 응답 모양은 그대로** |
| 본문 `refundMode` | `'auto' \| 'manual'`(없으면 `auto`) |
| 장부 맞추기(§6.2) | 결제마다 결제 잠금(`paymentRefundLockKey`) 안에서 wallet 목록 API → Medusa 장부에 없는 SUCCEEDED·PENDING 환불을 투영 경로로 넣음. **`reasonCode = MEDUSA_REFUND` 인데 `walletRefundIds` 에 없는 것(응답 유실)도 넣는다.** 투영 로직은 웹훅(`api/hooks/payment-events/route.ts` `handleRefundProjection`)과 이 단계가 함께 쓰도록 함수로 뽑는다 |
| 수동 환불(§6.3) | 결제 `data` 에 `manualRefund: { requestId, amount }` 표식 → `refundPaymentWorkflow` → almond-payment 가 금액이 같으면 wallet 에 `execution: 'MANUAL'` 로 요청하고 표식을 **`null`** 로 지움(JSON 병합 함정 — `withoutExternalRefund` 와 같은 패턴). 워크플로 실패 시 표식을 지우고 다시 던짐 |
| almond-payment 번역(§6.4) | `walletFetch` 가 `WalletHttpError { status, walletCode, walletMessage, retryable? }` — 속성을 `code` 로 두지 말 것(Medusa `formatException` 이 `err.code` 를 Postgres 코드로 읽는다). 4xx `retryable === false` 또는 200 의 FAILED 행 `retryable === false` → `MedusaError(NOT_ALLOWED, <wallet 메시지>, 'wallet_refund_refused:<code>')`. 그 밖은 일반 오류(일시) |
| 응답 | 200 정산 완료 `{ orderId, status, refund: { mode, amount } }` / 400 표지 `wallet_refund_refused:<failureCode>`(전체취소는 주문 미취소, 부분취소는 `stage: edited` 로 수정만 확정) / 500 일시(환불 뒤 단계 실패도 500 — 재시도 시 남은 몫만) |

맞춘 뒤에도 wallet 이 금액 초과(`REFUND_AMOUNT_EXCEEDS_*`)로 거절하면 경합이다 — **500(일시)** 로 낸다(wallet 이 `retryable: true` 를 싣는다).

## PR 1(wallet, #1048 MERGED)이 준 계약 — 그대로 소비한다

- **목록** `GET /v1/payment-intents/:id/refunds`(API 키) → 맨 배열 `[{ id, chargeId, status, amount, reasonCode, execution, createdAt }]`, 상태 무관·만든 순서.
  거르는 건 호출자 몫(장부 맞추기는 SUCCEEDED·PENDING). 없는 intent 는 404 `INTENT_NOT_FOUND`
- **4xx 거절 본문** `{ error, message, retryable }` — `error`·`message` 는 옛 값 그대로. 표: `apps/wallet/src/refunds/refund-refusal.ts`
  (금액 초과류 = `true`, `REFUND_NOT_AUTOMATABLE`·`MEMBERSHIP_REFUND_NOT_ALLOWED`·`CHARGE_*`·`*_NOT_FOUND` = `false`). ValidationPipe 400·409 `IDEMPOTENCY_KEY_IN_FLIGHT` 엔 `retryable` 이 없다 → 일시로 읽는다
- **200 응답의 환불 행**(`RefundResponseDto`)에 `execution`, `failureCode: string | null`, `retryable: boolean | null` 이 더해졌다. FAILED 행만 채워지고,
  분류 전 옛 FAILED 행은 둘 다 `null`(= 일시)
- **수동 실행** `POST /v1/payment-intents/:id/refund` 본문 `execution: 'MANUAL'` → 외부 결제 몫은 `PENDING`·`MANUAL` 행(PG 안 부름), 포인트 몫은
  자동(SUCCEEDED). 효성 CMS 도 받는다(AUTO 면 400 `REFUND_NOT_AUTOMATABLE`, `retryable: false`). 같은 MANUAL 이 다시 오면 남은 금액 0 이라 400
  `REFUND_AMOUNT_EXCEEDS_TOTAL`(`retryable: true`) — **장부 맞추기가 PENDING 을 먼저 장부에 넣어야** 재발행이 «또 환불»이 아니라 «이미 됨»이 된다
- almond-payment 는 PENDING 을 성공으로 센다(`judgeWalletRefund`) — 수동 몫도 Medusa Refund 행이 생기고 취소·수정이 이어진다
- **알려진 한계(PR 1 본문):** wallet 은 응답이 끊긴 PG 호출을 `PROVIDER_EXCEPTION`·`retryable: true` 로 둔다. 토스가 실제로 처리했는데 응답만 잃었다면 재시도가
  부분환불을 두 번 낼 수 있다. 장부 맞추기는 FAILED 행을 넣지 않으므로 이 구멍을 못 닫는다 — 계획의 «범위 밖·알려진 한계»에 그대로 옮겨 적을 것

## #1045(닫힘)에서 옮길 것 — 브랜치 `feat/1016-36-refund-refusal-medusa`

워크트리가 남아 있다(`.claude/worktrees/feat-1016-36-refund-refusal-medusa`). 파일(develop 대비):
`api/admin/orders/[id]/channel-cancel/route.ts`, `workflows/orders/channel-cancel/channel-cancel-order.ts`(`assertCancelable` 포함),
`modules/almond-payment/wallet-refund-refusal.ts`(+ unit spec), `modules/almond-payment/service.ts`(`WalletHttpError`),
`integration-tests/http/cancel-refund-refusal.spec.ts`(FakeWallet 통합 테스트 틀 + 기본 취소 특성 테스트), `partial-cancel` 라우트·워크플로 diff.

- **옮김**: 라우트 뼈대(잠금·`assertCancelable`·환불 뒤 오류 500), `WalletHttpError`, FakeWallet 틀, 기본 `/cancel` 특성 테스트 — **유령 환불 거래 단언을 추가**
  (wallet 거절에도 200 + `canceled` + Refund 0 + 환불 거래 −X — 업그레이드 경보)
- **버림**: `classifyWalletRefundRefusal` 두 갈래(분류 정본은 이제 wallet), 부분취소 502 `refundFailure` 본문

## 테스트 (스펙 §10 Medusa)

`scripts/local/run-medusa-integration.sh`(직접 `npm run test:integration:*` 금지 — `DB_*` 파생). **postgres 와 redis 둘 다** 떠 있어야 한다.
재부팅 뒤엔 컨테이너가 꺼져 있을 수 있다 — `npm run bootstrap:e2e:local` 이 띄운다.

- `channel-cancel`: 정상(취소·환불 1건·`pending_difference` 0) / 영구 거절(400 표지, 주문 미취소, Refund 행 없음) / 일시(500, 미취소) / 수동(wallet PENDING, 주문 취소, 차액 0)
- 장부 맞추기: 투영 안 된 SUCCEEDED 환불 → 장부에 들어가고 남은 몫만 환불 / `MEDUSA_REFUND` 응답 유실 재현 → 다시 나가지 않음
- **같은 요청 두 번 → 환불 한 번**(전체·부분·수동 각각 — PR 5 리컨실러 재발행의 전제)
- 부분취소: 수정 뒤 영구 거절 → 400 표지 + 장부 음수 차액 유지 → 원인 해소 뒤 재호출로 `refunded`
- 특성: 기본 `/cancel` 이 wallet 거절에도 200 + `canceled` + Refund 0 + 환불 거래 −X

## 지금 상태

- PR 0 #1047·PR 1 #1048 MERGED(develop `f76e80522`). **#1048 은 미배포** — wallet `db:migrate` → `sst deploy`. PR 2 는 부르는 쪽이 PR 3 이라 혼자 나가도 휴면이지만,
  **PR 2 를 배포할 때는 #1048 이 이미 라이브여야 한다**(목록 API 가 없으면 장부 맞추기가 404 로 실패한다). PR 2 와 3 사이에 배포 한 번
- 스펙·계획·지시문은 브랜치 `docs/1016-36-channel-cancel-settlement`(push 됨, PR 미생성)
- 사용자 결정: 기존 결제·환불 건은 이미 처리된 것으로 간주 — 소급 환급·대조를 제안하지 말 것
- 남은 PR: 3(계약+channel-adapter) · 4(스토어프론트) · 5(core+admin-web) · 6(정리) — 이 세션 범위 밖

## 지켜야 할 제약

- 서브에이전트는 반드시 워크트리에서 — 메인 체크아웃 오염 5회+ 재발(메모리 `subagent-worktree-contamination.md`). 메인 `git status` 로 확인
- **워크트리 만든 직후 `node_modules` 심볼링크를 셋 다**: 루트, `apps/medusa/node_modules`, 필요하면 `apps/admin-web`·`native/warehouse-app` 것까지(PR 1 에서 둘이 빠져 게이트가
  환경 탓으로 빨갰다). 루트 `type-check`·`npx jest` 는 `apps/medusa` 를 제외한다 — Medusa 게이트는 `medusa-unit-tests.yml`(unit + integration) 이다(메모리 `medusa-storefront-gate-topology`)
- 메인 체크아웃의 `web/almondyoung-storefront/yarn.lock` 변경은 남의 것 — 건드리지 말 것
- **`gh pr merge` 는 권한 분류기가 막는다** — 머지는 사용자가 `! gh pr merge <번호> --squash` 로 한다. push·PR 생성은 된다
- 워크플로 훅 중복 등록 금지(`no-duplicate-validate-hooks.unit.spec.ts`), 코어 라우트 override 금지(복제만), 모듈 서비스 교체 결론은 오답 신호
- 라이브 DB 조회는 사용자에게 `! …sst shell --stage live -- node -e "$(cat <절대경로>)"` 로 부탁
