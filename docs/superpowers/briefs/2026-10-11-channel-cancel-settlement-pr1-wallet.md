# 새 세션 지시문 — 채널 취소 정산 재설계 PR 1 (wallet) 계획·구현

## 너의 임무

승인된 스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` 의 **PR 1(wallet)** 구현 계획을 쓰고, 사용자가
실행 방식을 고르면 구현한다. `superpowers:writing-plans` 로 시작한다. 사용자는 한국어로 응답받기를 원한다.

**스펙의 결정(S1~S11)을 다시 묻지 마라** — 2026-10-11 사용자가 승인했다. 계획 중 스펙과 코드가 어긋나면 스펙을 정본으로 판정하고 기록한다.

## 먼저 읽을 것

1. `CLAUDE.md`, `apps/wallet/CLAUDE.md`
2. 스펙 전체, 특히 §2.3(wallet 사실), §6.2(장부 맞추기가 쓸 목록 API), §6.3(수동 실행), §6.4(almond-payment 가 읽을 오류 모양), **§6.5(PR 1 범위 표)**, §9.2(배포 순서 — PR 1 은 «혼자 나가도 휴면»), §10 wallet 테스트
3. 메모리 `channel-cancel-settlement-redesign.md`
4. 전례 계획: `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr0-point-refund-leg.md`(같은 저장소 관례·통합 스펙 실행법)

## PR 1 범위 (스펙 §6.5)

| 변경 | 요지 |
| --- | --- |
| 환불 목록 API | `GET /v1/payment-intents/:id/refunds` (API 키) — `{ id, chargeId, status, amount, reasonCode, execution, createdAt }[]` |
| 실패 분류 | 거절 본문 `{ error, message, retryable }`, FAILED 환불 행에 `failure_code`·`failure_retryable`. 토스 코드표는 토스 provider 옆. 모르는 코드 = `retryable: true` |
| 수동 실행 | `RefundByIntentDto.execution?: 'AUTO' \| 'MANUAL'`, 환불 행 `execution` 칸(기본 `AUTO`). 외부 결제 몫은 PG 없이 PENDING, 포인트 몫은 자동 |
| 송금 완료 일반화 | `confirmManual` 이 `execution = MANUAL` 행이면 결제수단과 무관하게 허용 |

마이그레이션: `refunds` 에 `execution`·`failure_code`·`failure_retryable` — additive, `migrate → deploy`. 생성은
`npm run db:generate:wallet -- --name <kebab>`(CLAUDE.md «Database»). wallet 스냅샷 체인 함정은 메모리 `wallet-drizzle-snapshot-chain-broken.md` 참고.

**혼자 나가도 휴면이어야 한다** — 아무도 `execution: MANUAL` 을 안 보내고, 새 응답 칸은 옛 호출자(almond-payment·core `WalletRefundClient`)가
무시해도 동작이 안 바뀌어야 한다. 특히 core 클라이언트의 400 분기(`REFUND_AMOUNT_EXCEEDS_*` → `already_refunded`)를 깨지 말 것.

## 분류표의 라이브 근거 (2026-10-11 실측, 읽기 전용)

FAILED 환불 사유: 무통장 «환불 계좌번호와 예금주명이 일치하지 않습니다» 19 · 포인트 `NO_CAPTURED_REDEEM` 8(PR 0 #1047 이 고침) ·
토스 «이미 취소된 결제 입니다» 2 · CMS «does not support refunds» 1. 토스 코드 목록은 스펙 §2.1. wallet 은 지금 토스 코드를 환불 행이 아니라
`payment_state_transitions.reasonCode` 에만 남긴다(`refunds.service.ts` provider FAILED 분기).

## 지금 상태

- PR 0 **#1047** OPEN(wallet 포인트 원장 키) — PR 1 과 같은 파일(`refunds.service.ts`·`payment-provider.interface.ts`)을 건드린다. PR 1 브랜치는
  #1047 머지 뒤 develop 에서 파거나, 아직이면 #1047 브랜치 위에 쌓고 PR base 를 그 브랜치로 둔다(squash 머지 뒤 `git rebase --onto`)
- 스펙·계획 문서는 브랜치 `docs/1016-36-channel-cancel-settlement`(push 됨, PR 미생성)
- 사용자 결정: 기존 결제·환불 건은 이미 처리된 것으로 간주 — 소급 환급·대조를 제안하지 말 것
- 남은 일(이 세션 범위 밖): PR 2~6 계획, #1016 반영(확인 뒤 본문 수정), PR #1044·#1045·#1046 닫기(사용자 지시 뒤)

## 지켜야 할 제약

- 서브에이전트는 반드시 워크트리에서 — 메인 체크아웃 develop 오염이 5회 재발했다(메모리 `subagent-worktree-contamination.md`). 메인 `git status` 로 확인
- 메인 체크아웃의 `web/almondyoung-storefront/yarn.lock` 변경은 남의 것 — 건드리지 말 것
- 라이브 DB 조회는 사용자에게 `! …sst shell --stage live -- node -e "$(cat <절대경로>)"` 로 부탁(절대 경로 — 상대 경로는 세션 위치에 따라 어긋났다)
- 게이트: `npm run type-check` 0 · `npx jest` 0. DB 통합 스펙은 `describeIfDb` + `REQUIRE_WALLET_DB=1`
