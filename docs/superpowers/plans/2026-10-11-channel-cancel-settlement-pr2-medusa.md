# PR 2 — Medusa: 채널 취소 정산 라우트 둘 (장부 맞추기·수동 환불·거절 번역) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널 주문의 전체취소(`POST /admin/orders/:id/channel-cancel`, 새 라우트)와 부분취소(`POST /admin/orders/:id/partial-cancel`, 기존)가
«주문 잠금 → 검증 → ① 장부 맞추기 → ② 남은 몫 환불(자동/수동) → ③ 취소·수정» 순서로 정산하고, wallet 의 영구 거절은 400 표지
`wallet_refund_refused:<code>` 로, 그 밖은 일시(500·502)로 돌려준다. 부르는 쪽(channel-adapter)은 PR 3 이라 혼자 나가면 휴면이다.

**Architecture:** almond-payment 가 wallet 오류를 `WalletHttpError` 로 받아 `retryable === false`(4xx 본문 또는 200 의 FAILED 행)만
`MedusaError(NOT_ALLOWED, <wallet 문장>, 'wallet_refund_refused:<code>')` 로 바꾼다. 정산 공용 부품은 `src/workflows/orders/settlement/` 에
모은다 — 장부 맞추기(wallet 환불 목록 → 장부에 없는 SUCCEEDED·PENDING 을 기존 투영 경로로 넣음), 결제 하나에 환불 한 번(시도 표식·수동 표식),
주문 잠금 키·결제 목록. 환불 투영 함수는 웹훅(`api/hooks/payment-events`)에서 뽑아 맞추기와 함께 쓴다. 전체취소는 «환불 → 취소»,
부분취소는 «수정 확정 → 환불» 순서를 지킨다(스펙 §2.2·§6.1).

**Tech Stack:** Medusa 2.13.4(`@medusajs/framework`·`@medusajs/medusa/core-flows`), Jest + `@swc/jest`(유닛 `TEST_TYPE=unit`),
`medusaIntegrationTestRunner` 실 Postgres + Redis HTTP 통합 스펙, 가짜 wallet HTTP 서버(`integration-tests/http/fixtures/partial-cancel-fixture.ts`).

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` — §2.2, **§6.1~§6.4**, §9.1 의 #1045 행, §9.2 의 2, §9.3, **§10 Medusa 통합**.
지시문: `docs/superpowers/briefs/2026-10-11-channel-cancel-settlement-pr2-medusa.md`. 전례 계획: `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr1-wallet.md`.
옮겨 올 코드: 닫힌 #1045 의 워크트리 `.claude/worktrees/feat-1016-36-refund-refusal-medusa`(브랜치 `feat/1016-36-refund-refusal-medusa`).

## Global Constraints

- **혼자 나가도 휴면**(스펙 §9.2 의 2): 새 라우트는 아무도 안 부른다. 부분취소의 기존 응답 — 200 `PartialCancelResult` 칸,
  400 `code: 'partial_cancel_rejected'`(+ `reason: external_refund_*`), 502 `type: 'refund_pending'` — 은 **모양 그대로**다. 더하는 것만 한다
- **배포 전제: wallet #1048 이 라이브여야 한다.** 장부 맞추기가 `GET /v1/payment-intents/:id/refunds` 를 부르고, 없으면 404 로 정산이 전부 500 이 된다
- 영구/일시 분류의 정본은 wallet 이다(스펙 S6). almond-payment 는 `retryable === false` 만 영구로 번역한다 — `retryable` 이 `true`·`null`·없음이면 일시
- `WalletHttpError` 의 속성을 `code` 로 두지 않는다 — Medusa `formatException` 이 `err.code` 를 Postgres 코드로 읽는다(스펙 §6.4)
- 결제 `data` 표식(`externalRefund`·`manualRefund`·`refundAttempt`)을 지울 때는 키를 빼지 말고 **`null` 로 쓴다** — Medusa 는 JSON 칸을 병합 갱신한다
- 결제 환불·표식 쓰기는 **부르는 쪽이 `paymentRefundLockKey(paymentId)` 잠금 안에서** 한다(almond-payment README «결제 잠금»). 주문 잠금 → 결제 잠금 순서만 쓴다
- 코어 라우트 override 금지(새 경로로 «복제»만), 워크플로 훅 새로 등록하지 않음, 모듈 서비스 교체 없음(CLAUDE.md «Medusa»)
- `apps/medusa` 에서 `@packages/*` 를 값으로 import 하지 않는다(런타임 MODULE_NOT_FOUND — 메모리 `packages-alias-resolution-by-tree`). 새 bare import 를 넣으면
  `apps/medusa/package.json` 에 선언됐는지 본다
- 통합 스펙은 `scripts/local/run-medusa-integration.sh` 로만 돈다(`npm run test:integration:*` 직접 호출 금지 — `DB_*` 파생). postgres·redis 둘 다 떠 있어야 한다
- 통합 스펙에서 워크플로 오류에 `.rejects.toThrow()` 를 쓰지 않는다 — 평범한 객체로 와서 엉뚱하게 실패한다(메모리 `medusa-route-override-is-per-method`)
- 새 코드에 `any`·`as` 를 들이지 않는다(CLAUDE.md «Type Safety»). 스펙 파일의 목·응답 단언은 기존 관례대로 허용
- 기존 결제·환불 건은 이미 처리된 것으로 간주한다 — 소급 대조·환급 없음(사용자 결정 2026-10-11)
- 게이트: `npm run test:medusa` 실패 0 · `apps/medusa` tsc 에러 수 **기준선과 같음**(선재 에러가 있다 — 실행 준비에서 센다) · HTTP·모듈 통합 전부 초록

## Review Focus

- **자동 거절 뒤 같은 요청을 «수동»으로 다시 보낸다** — core 의 [계좌 송금으로 환불](PR 5)은 같은 `requestId` 에 `refundMode: 'manual'` 만 바꿔 재발행한다.
  부분취소의 요청 해시(`hashRequest`)에 `refundMode` 가 섞이면 «같은 requestId 로 다른 요청» 400 으로 막힌다. Task 5 의 «자동 거절 뒤 수동» 통합 테스트가 지킨다.
- **수동 표식이 실패 뒤 남으면 다음 «자동» 시도가 MANUAL 로 샌다** — 표식 금액이 같으면 almond-payment 가 표식만 보고 MANUAL 을 보낸다. 워크플로가 실패하면
  수동 표식을 `null` 로 지워야 한다. Task 4 의 «수동 시도가 일시 실패하면 수동 표식을 지운다» 테스트가 지킨다.
- **부분취소의 응답 유실분이 다시 나간다** — 스펙 §6.2 그대로 맞추기가 응답 잃은 MEDUSA_REFUND 를 `wallet:<id>` 메모로 넣으면, 부분취소는 «이 요청 메모의 환불»로
  안 세어 같은 몫을 또 환불한다(전체취소는 «캡처 − 환불» 이라 괜찮다). 시도 표식(`refundAttempt`)으로 그 메모에 귀속시킨다. Task 3 유닛·Task 5 통합 테스트가 지킨다.
- **같은 주문에 정산 호출이 동시에 두 번** — PR 5 리컨실러 재발행과 Kafka 재배달이 겹칠 수 있다. 주문 잠금이 직렬화해 환불은 한 번이어야 한다.
  Task 4 의 «동시 두 번 → 환불 한 번» 테스트가 지킨다.
- **투영 안 된 외부 환불이 있는 주문의 새 부분취소** — 37번 판정(`assertExternalRefundsResolved`)은 장부만 읽는다. 맞추기를 환불 직전에만 하면 판정이 그 환불을 못 보고
  수정·환불이 나가, 운영자가 토스에서 이미 돌려준 품목 값을 또 돌려준다. 새 요청은 수정 «전»에 맞춘다. Task 5 의 «외부 환불이 있으면 수정 전에 묻는다» 테스트가 지킨다.

---

## 스펙과 다른 점 · 스펙이 비워 둔 곳 (계획이 정함)

스펙이 정본이다(지시문). 아래는 스펙끼리 맞물리지 않거나 스펙이 말하지 않은 자리에서 고른 것이다 — PR 본문에도 옮긴다.

| # | 자리 | 정한 것 | 이유 |
| --- | --- | --- | --- |
| D1 | 부분취소 일시 실패 응답 | §6.1 의 «500» 이 아니라 **기존 502 `refund_pending`** 을 유지 | §9.2 의 2 «부분취소 응답 모양은 옛 channel-adapter 가 읽던 그대로». 새 adapter(PR 3)도 §7.2 표에서 502 를 `retryable: true` 로 읽는다 |
| D2 | 부분취소 영구 거절 응답 | §6.1 대로 **400** `{ type: 'not_allowed', code: 'wallet_refund_refused:<c>', stage: 'edited', requestId, message }` | 지시문 «응답» 행. 옛 adapter 는 이 400 을 `MedusaHttpError` 로 던져 재시도한다 — 오늘(502 + 정체 사실)보다 정체 사실 하나가 빠진다. 라이브 부분취소 기록 0(스펙 §2.3)이라 롤링 창의 실제 영향은 없다 |
| D3 | 응답 유실분의 귀속 | 결제 `data.refundAttempt = { note, amount }` 시도 표식. 정산이 환불 직전에 쓰고 성공하면 지운다. 맞추기는 표식이 남아 있으면 장부에 없는 MEDUSA_REFUND 를 **그 메모로**(표식 금액까지) 넣고 표식을 지운다 | §10 «응답 유실 → 다시 나가지 않음», «같은 요청 두 번 → 환불 한 번(부분)». §6.2 문면대로면 부분취소가 이중 환불한다(Review Focus 3) |
| D4 | 부분취소 맞추기 시점 | 새 요청은 **수정 전**에 맞추고 주문을 다시 읽는다. 이미 수정된(`edited`) 재시도는 환불 직전에 맞춘다 | 37번 판정이 빠진 외부 환불을 봐야 한다(Review Focus 5). 맞추기가 넣은 환불이 수정 전후 차액(`owed`)에 섞이면 안 된다 |
| D5 | 영구 거절 문장 | wallet 문장 **그대로**(4xx 의 `message`, FAILED 행의 `reasonMessage` — 토스 한국어 메시지) | §6.4 `<wallet 메시지>`, §8.1 «사유 그대로». #1045 의 안내 문장(`SENTENCE`)은 버린다 |
| D6 | 수동 표식의 `requestId` | 그 환불의 메모(`channel-cancel:<orderId>` / `partial-cancel:<requestId>`) | 전체취소 본문엔 requestId 가 없다. 표식은 «누가 붙였나» 추적용이다 |
| D7 | 부분취소 200 | 기존 칸에 **`refund: { mode, amount }` 를 더한다**(기록에 `refundMode` 저장, 옛 기록은 `auto`) | 전체취소 200 과 같은 칸. 더하기만이라 옛 adapter 무해 |

---

## 실행 준비 (태스크 전에 한 번)

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin
git worktree add .claude/worktrees/feat-1016-36-medusa-settlement -b feat/1016-36-medusa-settlement origin/develop
W=/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1016-36-medusa-settlement
M=/home/pauseb/workspace/almondyoung-server
# 셋 다 — 하나라도 빠지면 게이트가 «환경 탓»으로 빨갛고, 에이전트가 메인 체크아웃으로 옮겨 간다
ln -s $M/node_modules $W/node_modules
ln -s $M/apps/medusa/node_modules $W/apps/medusa/node_modules
ln -s $M/apps/medusa/.env $W/apps/medusa/.env
```

인프라(통합 스펙은 postgres **와** redis 를 쓴다):

```bash
docker ps --format '{{.Names}}' | grep -Ei 'postgres|redis'
# 둘 중 하나라도 없으면 메인 체크아웃에서: npm run bootstrap:e2e:local
```

기준선(숫자를 적어 둔다 — 마지막 게이트가 이것과 비교한다):

```bash
cd $W
npm run test:medusa 2>&1 | tail -6                                   # suites/tests 수
(cd apps/medusa && npx tsc --noEmit 2>&1 | grep -c 'error TS')       # 선재 에러 수(2026-08-30 기준 3)
scripts/local/run-medusa-integration.sh --testPathPattern 'partial-cancel|wallet-refund-projection|order-edit-characterization'
```

이후 **모든 명령은 워크트리 `$W`** 에서 돈다. 메인 체크아웃의 `web/almondyoung-storefront/yarn.lock` 변경은 남의 것이다 — 건드리지 않는다.
`npm ci` 를 워크트리에서 돌리지 않는다(메인 오염).

서브에이전트로 실행하면 dispatch 첫 줄에: `cd $W` → `git rev-parse --show-toplevel && git branch --show-current` → 기대값
(`…/feat-1016-36-medusa-settlement`, `feat/1016-36-medusa-settlement`)과 다르면 STOP, 특히 `develop`·`docs/1016-36-channel-cancel-settlement` 면 멈춘다.
«npm·jest·tsc·통합 스크립트는 이 워크트리에서 돈다»를 명시하고, 커밋 전 두 명령의 출력을 보고서에 넣게 한다.
태스크마다 `git -C $M status --short` 와 `git -C $M rev-parse develop origin/develop` 로 메인 오염을 확인한다(메모리 `subagent-worktree-contamination`).

#1045 원본을 볼 때는 `git -C $M show feat/1016-36-refund-refusal-medusa:<경로>` 를 쓴다(그 워크트리에서 작업하지 않는다).

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| Create `apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts` (+ `__tests__/…unit.spec.ts`) | `WalletHttpError`, 표지 접두사, 4xx → 표지 번역, 직렬화된 오류에서 표지 읽기 |
| Modify `apps/medusa/src/modules/almond-payment/refund-data.ts` (+ 기존 unit spec) | `WalletRefundRow` 의 `failureCode`·`retryable`, 판정의 `refusal`, 수동 표식·시도 표식 |
| Modify `apps/medusa/src/modules/almond-payment/service.ts` (+ 기존 unit spec) | `walletFetch` 가 `WalletHttpError`, `refundPayment` 의 번역·MANUAL |
| Create `apps/medusa/src/modules/almond-payment/wallet-refund-list.ts` (+ unit spec) | wallet 환불 목록 HTTP 읽기 |
| Create `apps/medusa/src/workflows/orders/settlement/order-payments.ts` | 주문 잠금 키, 주문 → 결제 id(부분취소에서 옮김) |
| Create `apps/medusa/src/workflows/orders/settlement/refund-mode.ts` (+ unit spec) | `RefundMode`, 본문 파싱 |
| Create `apps/medusa/src/workflows/orders/settlement/plan-wallet-refund-bookings.ts` (+ unit spec) | 장부 맞추기 판정(순수) |
| Create `apps/medusa/src/workflows/orders/settlement/wallet-refund-ledger.ts` | 투영 한 건(웹훅과 공용), 결제·주문 단위 장부 맞추기 |
| Create `apps/medusa/src/workflows/orders/settlement/issue-payment-refund.ts` | 결제 하나에 환불 한 번(시도·수동 표식) |
| Modify `apps/medusa/src/api/hooks/payment-events/route.ts` | Step 1.5 를 `projectWalletRefund` 로 |
| Create `apps/medusa/src/workflows/orders/channel-cancel/channel-cancel-order.ts` | 전체취소 정산(#1045 에서 옮겨 고침) |
| Create `apps/medusa/src/api/admin/orders/[id]/channel-cancel/route.ts` | 전체취소 라우트 |
| Modify `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` | 맞추기·환불 부품 사용, 영구 거절 분리, `refundMode` |
| Modify `apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts`, `parse-input.ts` (+ unit spec) | `refundMode`, 400 표지 |
| Modify `apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts` | FakeWallet: 목록·분류·MANUAL·응답 유실·외부 환불 |
| Create `apps/medusa/integration-tests/http/channel-cancel-settlement.spec.ts` | 전체취소 통합 + 기본 `/cancel` 특성 |
| Create `apps/medusa/integration-tests/http/partial-cancel-settlement.spec.ts` | 부분취소 정산 통합 |
| Modify `apps/medusa/src/modules/almond-payment/README.md` | 규약 갱신 |

---

### Task 1: almond-payment — wallet 오류를 영구/일시로 번역한다

**Files:**
- Create: `apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts`
- Test: `apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts`
- Modify: `apps/medusa/src/modules/almond-payment/refund-data.ts` (`WalletRefundRow`, `WalletRefundVerdict`, `judgeWalletRefund`)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts` (끝에 describe 추가)
- Modify: `apps/medusa/src/modules/almond-payment/service.ts` (`walletFetch`, `refundPayment`)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts` (끝에 추가)

**Interfaces:**
- Produces: `export const WALLET_REFUND_REFUSED_PREFIX = 'wallet_refund_refused:'`
- Produces: `export class WalletHttpError extends Error { readonly status: number; readonly walletCode: string | undefined; readonly walletMessage: string; readonly retryable?: boolean }`
- Produces: `export function walletRefundRefusedError(code: string, message: string): MedusaError`
- Produces: `export function refusalFromWalletHttpError(error: unknown): MedusaError | null`
- Produces: `export function readWalletRefundRefusal(error: unknown): { code: string; message: string } | null`
- Produces: `WalletRefundVerdict` 의 실패 갈래에 `refusal?: { code: string; message: string }`

- [ ] **Step 1: 실패하는 번역 유닛 테스트**

```ts
// apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts
import { MedusaError } from '@medusajs/framework/utils';
import {
  WalletHttpError,
  readWalletRefundRefusal,
  refusalFromWalletHttpError,
  walletRefundRefusedError,
} from '../wallet-refund-refusal';

describe('wallet 환불 오류 번역 (#1016 36번 재설계 §6.4)', () => {
  it('WalletHttpError 의 message 는 «코드: 문장» — 기존 includes 분기(INTENT_NOT_CANCELABLE 등)가 그대로 돈다', () => {
    expect(new WalletHttpError(400, 'INTENT_NOT_CANCELABLE', 'cannot be canceled').message).toBe('INTENT_NOT_CANCELABLE: cannot be canceled');
    expect(new WalletHttpError(500, undefined, 'Wallet API error 500: /x').message).toBe('Wallet API error 500: /x');
  });

  it('속성 이름이 code 가 아니다 — formatException 이 err.code 를 Postgres 코드로 읽는다', () => {
    expect('code' in new WalletHttpError(400, 'X', 'm', false)).toBe(false);
  });

  it('4xx + retryable false → NOT_ALLOWED, 표지 code, 문장은 wallet 원문', () => {
    const err = refusalFromWalletHttpError(new WalletHttpError(400, 'REFUND_NOT_AUTOMATABLE', '자동 환불할 수 없는 결제수단입니다', false));
    expect(err).toBeInstanceOf(MedusaError);
    expect(err?.type).toBe(MedusaError.Types.NOT_ALLOWED);
    expect(err?.code).toBe('wallet_refund_refused:REFUND_NOT_AUTOMATABLE');
    expect(err?.message).toBe('자동 환불할 수 없는 결제수단입니다');
  });

  it('404 도 본문이 영구라고 하면 영구 — REFUNDABLE_CHARGE_NOT_FOUND', () => {
    expect(refusalFromWalletHttpError(new WalletHttpError(404, 'REFUNDABLE_CHARGE_NOT_FOUND', 'm', false))?.code).toBe(
      'wallet_refund_refused:REFUNDABLE_CHARGE_NOT_FOUND',
    );
  });

  it.each<[string, unknown]>([
    ['retryable true(금액 초과류)', new WalletHttpError(400, 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'm', true)],
    ['retryable 없음(ValidationPipe 400)', new WalletHttpError(400, 'Bad Request', 'm')],
    ['409 IDEMPOTENCY_KEY_IN_FLIGHT(retryable 없음)', new WalletHttpError(409, 'IDEMPOTENCY_KEY_IN_FLIGHT', 'm')],
    ['5xx 는 retryable false 가 실려도 일시', new WalletHttpError(502, 'X', 'm', false)],
    ['코드 없는 4xx', new WalletHttpError(400, undefined, 'm', false)],
    ['네트워크 오류', new TypeError('fetch failed')],
  ])('%s → null(그대로 던져 일시로 둔다)', (_, error) => {
    expect(refusalFromWalletHttpError(error)).toBeNull();
  });

  it('표지를 다시 읽는다 — 워크플로를 지나 평범한 객체가 된 오류에서도', () => {
    expect(readWalletRefundRefusal(walletRefundRefusedError('NOT_CANCELABLE_AMOUNT', '취소 할 수 없는 금액 입니다.'))).toEqual({
      code: 'NOT_CANCELABLE_AMOUNT',
      message: '취소 할 수 없는 금액 입니다.',
    });
    expect(readWalletRefundRefusal({ type: 'not_allowed', code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', message: 'm' })).toEqual({
      code: 'REFUND_NOT_AUTOMATABLE',
      message: 'm',
    });
  });

  it.each([undefined, null, 'x', new Error('PG down'), { code: 'partial_cancel_rejected' }, { code: 'wallet_refund_refused:' }, { code: 42 }])(
    '표지가 아니면 null(%p)',
    (error) => {
      expect(readWalletRefundRefusal(error)).toBeNull();
    },
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts)`
Expected: FAIL — `Cannot find module '../wallet-refund-refusal'`

- [ ] **Step 3: 번역 모듈 구현**

```ts
// apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts
import { MedusaError } from '@medusajs/framework/utils';

import { describeError } from '../../utils/describe-error';

/**
 * wallet 환불 오류 번역(#1016 36번 재설계 스펙 §6.4). 영구/일시 분류의 정본은 wallet 이다 — 여기는 `retryable === false` 만
 * 표지 오류로 바꾸고 나머지는 그대로 둔다(일시). 표지 `wallet_refund_refused:<코드>` 는 channel-adapter 가 읽는다.
 */
export const WALLET_REFUND_REFUSED_PREFIX = 'wallet_refund_refused:';

/** wallet 이 2xx 가 아닌 응답을 줬다. 속성 이름을 code 로 두지 않는다 — Medusa formatException 이 err.code 를 Postgres 코드로 읽는다 */
export class WalletHttpError extends Error {
  constructor(
    readonly status: number,
    readonly walletCode: string | undefined,
    readonly walletMessage: string,
    /** wallet 거절 본문의 retryable. 없으면 undefined — 일시로 읽는다 */
    readonly retryable?: boolean,
  ) {
    // «코드: 문장» — 호출부의 includes 분기(NO_STAGED_APPROVAL·INTENT_NOT_CANCELABLE)가 그대로 돈다
    super(walletCode ? `${walletCode}: ${walletMessage}` : walletMessage);
    this.name = 'WalletHttpError';
  }
}

/** Medusa 에러 핸들러는 NOT_ALLOWED 를 400 으로, code 를 그대로 응답 본문에 싣는다 */
export function walletRefundRefusedError(code: string, message: string): MedusaError {
  return new MedusaError(MedusaError.Types.NOT_ALLOWED, message, `${WALLET_REFUND_REFUSED_PREFIX}${code}`);
}

/** wallet 4xx 거절이 `retryable: false` 면 표지 오류, 아니면 null — null 이면 원래 오류를 그대로 던진다(일시) */
export function refusalFromWalletHttpError(error: unknown): MedusaError | null {
  if (!(error instanceof WalletHttpError)) return null;
  if (error.status < 400 || error.status >= 500 || error.retryable !== false || !error.walletCode) return null;
  return walletRefundRefusedError(error.walletCode, error.walletMessage);
}

/** 워크플로를 지나 평범한 객체가 된 오류에서도 표지를 읽는다 — 정산 라우트가 «영구 거절»과 «그 밖»을 가를 때 쓴다 */
export function readWalletRefundRefusal(error: unknown): { code: string; message: string } | null {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return null;
  if (!error.code.startsWith(WALLET_REFUND_REFUSED_PREFIX)) return null;
  const code = error.code.slice(WALLET_REFUND_REFUSED_PREFIX.length);
  return code ? { code, message: describeError(error) } : null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts)`
Expected: PASS

- [ ] **Step 5: 판정에 영구 거절을 싣는 실패 테스트**

`apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts` 끝에 더한다(파일 머리의 import 에 `judgeWalletRefund` 가 없으면 더한다):

```ts
describe('judgeWalletRefund — FAILED 행의 분류 (#1016 36번 재설계 §6.4)', () => {
  const failed = (retryable: boolean | null, extra: Record<string, unknown> = {}) => ({
    id: 'wr1',
    amount: 3000,
    status: 'FAILED',
    reasonCode: 'MEDUSA_REFUND',
    reasonMessage: '취소 할 수 없는 금액 입니다.',
    failureCode: 'NOT_CANCELABLE_AMOUNT',
    retryable,
    ...extra,
  });

  it('retryable false 인 FAILED 행이 있으면 그 코드·문장을 refusal 로 싣는다', () => {
    const v = judgeWalletRefund([failed(false)], 3000);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.refusal).toEqual({ code: 'NOT_CANCELABLE_AMOUNT', message: '취소 할 수 없는 금액 입니다.' });
  });

  it.each([null, true, undefined])('retryable 이 %p 면 refusal 이 없다(일시)', (retryable) => {
    const v = judgeWalletRefund([failed(retryable as boolean | null)], 3000);
    expect(v.ok === false && v.refusal).toBeUndefined();
  });

  it('여러 결제분 중 앞은 나가고 뒤가 영구 거절이면 refusal 과 moved 를 둘 다 싣는다', () => {
    const v = judgeWalletRefund([{ id: 'wr0', amount: 1000, status: 'SUCCEEDED' }, failed(false, { id: 'wr1', amount: 2000 })], 3000);
    expect(v.ok === false && v.moved).toEqual([{ id: 'wr0', amount: 1000, status: 'SUCCEEDED' }]);
    expect(v.ok === false && v.refusal?.code).toBe('NOT_CANCELABLE_AMOUNT');
  });

  it('failureCode·reasonMessage 가 비면 대체 문구로 채운다', () => {
    const v = judgeWalletRefund([failed(false, { failureCode: null, reasonMessage: null })], 3000);
    expect(v.ok === false && v.refusal).toEqual({ code: 'REFUND_FAILED', message: 'wallet 이 환불을 거절했습니다' });
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/refund-data.unit.spec.ts)`
Expected: FAIL — `refusal` 이 `undefined`(첫 테스트)

- [ ] **Step 7: `refund-data.ts` 의 행·판정 고침**

`WalletRefundRow` 와 `WalletRefundVerdict` 를 바꾸고 `judgeWalletRefund` 의 FAILED 갈래를 고친다:

```ts
/** wallet `POST /v1/payment-intents/:id/refund` 응답의 환불 행(RefundResponseDto)에서 판정에 쓰는 필드. */
export type WalletRefundRow = {
  id?: string;
  status?: string;
  amount?: number;
  reasonCode?: string | null;
  reasonMessage?: string | null;
  /** FAILED 행의 분류(#1048). 분류 전 옛 행은 null — 일시로 읽는다 */
  failureCode?: string | null;
  retryable?: boolean | null;
};
export type WalletRefundVerdict =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      reason: string;
      /** 실패 판정이어도 wallet 에서 실제로 나간(또는 나가는 중인) 환불 — 다음 정산의 장부 맞추기가 장부에 넣는다. */
      moved: Array<{ id: string; amount: number; status: string }>;
      /** FAILED 행 중 wallet 이 영구(retryable: false)라고 한 것 — 있으면 표지 붙은 거절로 던진다 */
      refusal?: { code: string; message: string };
    };
```

`judgeWalletRefund` 의 `if (failed) { … }` 블록을 이것으로 바꾼다:

```ts
  const failed = rows.find((r) => r.status === 'FAILED');
  if (failed) {
    const permanent = rows.find((r) => r.status === 'FAILED' && r.retryable === false);
    return {
      ok: false,
      reason: `wallet 환불 ${failed.id ?? '?'} 가 FAILED 입니다(reasonCode=${failed.reasonCode ?? '-'}, reasonMessage=${failed.reasonMessage ?? '-'})`,
      moved,
      ...(permanent
        ? { refusal: { code: permanent.failureCode ?? 'REFUND_FAILED', message: permanent.reasonMessage ?? 'wallet 이 환불을 거절했습니다' } }
        : {}),
    };
  }
```

- [ ] **Step 8: 통과 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/refund-data.unit.spec.ts)`
Expected: PASS (기존 테스트 포함)

- [ ] **Step 9: provider 번역의 실패 테스트**

`apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts` 머리에 import 를 더한다:

```ts
import { MedusaError } from '@medusajs/framework/utils';
import { WalletHttpError } from '../wallet-refund-refusal';
```

마지막 `});`(최상위 describe 닫기) **안쪽** 끝에 더한다:

```ts
  describe('wallet 오류 번역 (#1016 36번 재설계 §6.4)', () => {
    const refund = (svc: AlmondPaymentProviderService) =>
      svc.refundPayment({ data: { intentId: 'i1' }, amount: 3000, context: { idempotency_key: 'ref_r1' } } as any);

    it('4xx retryable:false 는 NOT_ALLOWED + 표지, 문장은 wallet 원문', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockRejectedValue(new WalletHttpError(400, 'REFUND_NOT_AUTOMATABLE', '자동 환불 불가', false));
      await expect(refund(svc)).rejects.toMatchObject({
        type: 'not_allowed',
        code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        message: '자동 환불 불가',
      });
    });

    it('retryable 이 true·없음이거나 네트워크 오류면 원래 오류를 그대로 던진다(일시)', async () => {
      const svc = makeService();
      const exceeds = new WalletHttpError(400, 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'm', true);
      const bare = new WalletHttpError(400, 'Bad Request', 'm');
      const net = new TypeError('fetch failed');
      jest.spyOn(svc as any, 'walletFetch').mockRejectedValueOnce(exceeds).mockRejectedValueOnce(bare).mockRejectedValueOnce(net);
      await expect(refund(svc)).rejects.toBe(exceeds);
      await expect(refund(svc)).rejects.toBe(bare);
      await expect(refund(svc)).rejects.toBe(net);
    });

    it('200 의 FAILED 행이 retryable:false 면 그 failureCode·토스 문장으로 표지', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({
        refunds: [
          {
            id: 'wr1',
            amount: 3000,
            status: 'FAILED',
            reasonCode: 'MEDUSA_REFUND',
            reasonMessage: '취소 할 수 없는 금액 입니다.',
            failureCode: 'NOT_CANCELABLE_AMOUNT',
            retryable: false,
          },
        ],
      });
      await expect(refund(svc)).rejects.toMatchObject({
        type: 'not_allowed',
        code: 'wallet_refund_refused:NOT_CANCELABLE_AMOUNT',
        message: '취소 할 수 없는 금액 입니다.',
      });
    });

    it('200 의 FAILED 행이 분류 전(retryable null)이면 일반 오류 — 일시', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({
        refunds: [{ id: 'wr1', amount: 3000, status: 'FAILED', reasonCode: 'MEDUSA_REFUND', reasonMessage: 'x', failureCode: null, retryable: null }],
      });
      const err = await refund(svc).catch((e: unknown) => e);
      expect(MedusaError.isMedusaError(err)).toBe(false);
      expect((err as Error).message).toMatch(/FAILED/);
    });
  });

  it('walletFetch 는 wallet 오류 본문을 WalletHttpError 로 던진다 — retryable 포함', async () => {
    const svc = makeService();
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'REFUND_NOT_AUTOMATABLE', message: 'manual', retryable: false }),
    }) as any;
    try {
      await expect((svc as any).walletFetch('/v1/payment-intents/i1/refund', { method: 'POST' })).rejects.toMatchObject({
        name: 'WalletHttpError',
        status: 400,
        walletCode: 'REFUND_NOT_AUTOMATABLE',
        walletMessage: 'manual',
        retryable: false,
        message: 'REFUND_NOT_AUTOMATABLE: manual',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
```

- [ ] **Step 10: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts)`
Expected: FAIL — 표지 테스트는 `code` 가 없음, `walletFetch` 테스트는 `name` 이 `Error`

- [ ] **Step 11: `service.ts` 구현**

import 에 더한다:

```ts
import { WalletHttpError, refusalFromWalletHttpError, walletRefundRefusedError } from './wallet-refund-refusal';
```

`walletFetch` 의 `if (!res.ok) { … }` 블록을 바꾼다:

```ts
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown; message?: unknown; retryable?: unknown } | null;
      const walletCode = typeof body?.error === 'string' ? body.error : undefined;
      const message = typeof body?.message === 'string' ? body.message : `Wallet API error ${res.status}: ${path}`;
      const retryable = typeof body?.retryable === 'boolean' ? body.retryable : undefined;
      // WalletHttpError.message 는 «코드: 문장» — 호출부가 코드로 분기한다(NO_STAGED_APPROVAL, INTENT_NOT_CANCELABLE).
      // 코드 없이 문구에만 기대면 wallet 쪽 문구가 바뀔 때 조용히 분기가 죽는다.
      throw new WalletHttpError(res.status, walletCode, message, retryable);
    }
```

`refundPayment` 의 wallet 호출부터 끝까지를 바꾼다(위의 금액·`externalRefund` 처리는 그대로):

```ts
    // Medusa 결제 모듈이 refund 행 id 를 idempotency_key 로 준다 — 같은 환불의 재시도가 wallet 에서 한 번으로 접힌다.
    const idempotencyKey = (input as { context?: { idempotency_key?: string } }).context?.idempotency_key;
    let res: { refunds?: WalletRefundRow[] };
    try {
      res = await this.walletFetch<{ refunds?: WalletRefundRow[] }>(`/v1/payment-intents/${intentId}/refund`, {
        method: 'POST',
        ...(idempotencyKey ? { headers: { 'Idempotency-Key': `medusa-refund:${idempotencyKey}` } } : {}),
        body: JSON.stringify({ amount: refundAmount, reasonCode: 'MEDUSA_REFUND' }),
      });
    } catch (error) {
      // 영구 거절(retryable: false)만 표지 붙은 NOT_ALLOWED 로 바꾼다 — 그 밖을 바꾸면 다시 불러야 할 실패가 «거절»로 닫힌다
      throw refusalFromWalletHttpError(error) ?? error;
    }
    // wallet 은 PG 가 거절한 환불도 200 + FAILED 행으로 준다. 여기서 던져야 Medusa 가 환불 행을 지우고 장부에 안 남긴다.
    const verdict = judgeWalletRefund(res?.refunds ?? [], refundAmount);
    if (!verdict.ok) {
      if (verdict.moved.length > 0) {
        // 결제분(charge)이 여럿이면 앞의 것은 나가고 뒤의 것이 실패할 수 있다. 나간 환불은 Medusa 장부에 안 남는다 —
        // 다음 정산의 장부 맞추기(wallet 환불 목록)가 넣는다. 그 전까지는 이 로그가 흔적이다.
        this.logger_.error(
          `[almond-payment] refundPayment 실패했지만 wallet 에서 이미 나간 환불이 있습니다 — 다음 정산의 장부 맞추기가 장부에 넣습니다. ` +
            `intentId=${intentId} requested=${refundAmount} moved=${verdict.moved.map((r) => `${r.id}:${r.amount}:${r.status}`).join(',')}`,
        );
      }
      if (verdict.refusal) throw walletRefundRefusedError(verdict.refusal.code, verdict.refusal.message);
      throw new Error(`wallet 환불 실패(intentId=${intentId}, 요청 ${refundAmount}): ${verdict.reason}`);
    }
    return { data: withWalletRefundIds(data, verdict.ids) };
```

- [ ] **Step 12: 통과 확인 — almond-payment 유닛 전부**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment)`
Expected: PASS (기존 `refund-payment`·`refund-data`·`refund-payment-amount` 포함). 기존 `cancelPayment`·`finalizeDeferredApproval` 의 `msg.includes(...)` 분기는
`WalletHttpError.message` 가 «코드: 문장»이라 그대로 돈다.

- [ ] **Step 13: 커밋**

```bash
git add apps/medusa/src/modules/almond-payment/wallet-refund-refusal.ts \
  apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts \
  apps/medusa/src/modules/almond-payment/refund-data.ts \
  apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts \
  apps/medusa/src/modules/almond-payment/service.ts \
  apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts
git commit -m "feat(medusa): wallet 영구 환불 거절을 표지 붙은 NOT_ALLOWED 로 번역 (#1016 36번 재설계 PR 2)"
```

---

### Task 2: almond-payment — 수동 환불 표식이면 `execution: 'MANUAL'`

**Files:**
- Modify: `apps/medusa/src/modules/almond-payment/refund-data.ts` (수동 표식)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts`
- Modify: `apps/medusa/src/modules/almond-payment/service.ts` (`refundPayment`)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `refundPayment` 구조
- Produces: `export type ManualRefundMarker = { requestId: string; amount: number }`
- Produces: `readManualRefund(data: Record<string, unknown> | null | undefined): ManualRefundMarker | null`,
  `withManualRefund(data: Record<string, unknown>, marker: ManualRefundMarker): Record<string, unknown>`,
  `withoutManualRefund(data: Record<string, unknown>): Record<string, unknown>` (`manualRefund: null`)

- [ ] **Step 1: 실패하는 표식 테스트**

`refund-data.unit.spec.ts` 의 import 에 `readManualRefund, withManualRefund, withoutManualRefund` 를 더하고 끝에:

```ts
describe('수동 환불 표식 (#1016 36번 재설계 §6.3)', () => {
  it('쓰고 읽고, 지울 땐 키를 빼지 않고 null 로 쓴다 — Medusa 는 JSON 칸을 병합 갱신한다', () => {
    const data = withManualRefund({ intentId: 'i1' }, { requestId: 'channel-cancel:o1', amount: 5000 });
    expect(readManualRefund(data)).toEqual({ requestId: 'channel-cancel:o1', amount: 5000 });
    expect(withoutManualRefund(data)).toEqual({ intentId: 'i1', manualRefund: null });
    expect(readManualRefund(withoutManualRefund(data))).toBeNull();
  });

  it.each([undefined, null, 'x', {}, { requestId: 'r' }, { amount: 1 }, { requestId: 1, amount: 1 }])('모양이 다르면 없는 것으로 본다(%p)', (v) => {
    expect(readManualRefund({ manualRefund: v })).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/refund-data.unit.spec.ts)`
Expected: FAIL — `readManualRefund is not a function`

- [ ] **Step 3: 표식 구현**

`refund-data.ts` 의 `withoutExternalRefund` 아래에 더한다:

```ts
/**
 * 수동 환불 표식(#1016 36번 재설계 §6.3). 정산 라우트가 결제 잠금 안에서 붙이고 refundPaymentWorkflow 를 돌린다 — 금액이 같으면
 * refundPayment 가 wallet 에 `execution: 'MANUAL'` 로 요청하고(외부 결제 몫은 PG 없이 송금 대기) 표식을 null 로 지운다.
 * requestId 는 그 환불의 메모(`channel-cancel:<orderId>` / `partial-cancel:<requestId>`) — 누가 붙였는지 추적용이다.
 */
export type ManualRefundMarker = { requestId: string; amount: number };

export function readManualRefund(data: Record<string, unknown> | null | undefined): ManualRefundMarker | null {
  const v = data?.manualRefund as Partial<ManualRefundMarker> | null | undefined;
  if (!v || typeof v !== 'object' || typeof v.requestId !== 'string' || typeof v.amount !== 'number') return null;
  return { requestId: v.requestId, amount: v.amount };
}

export function withManualRefund(data: Record<string, unknown>, marker: ManualRefundMarker): Record<string, unknown> {
  return { ...data, manualRefund: marker };
}

export function withoutManualRefund(data: Record<string, unknown>): Record<string, unknown> {
  // externalRefund 와 같은 이유로 null — 병합 갱신이라 키를 빼면 남는다
  return { ...data, manualRefund: null };
}
```

- [ ] **Step 4: 통과 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/refund-data.unit.spec.ts)`
Expected: PASS

- [ ] **Step 5: provider 의 MANUAL 실패 테스트**

`refund-payment.unit.spec.ts` 최상위 describe 안쪽 끝에 더한다:

```ts
  describe('수동 환불 표식 (#1016 36번 재설계 §6.3)', () => {
    it('금액이 같으면 execution MANUAL 로 요청하고 표식을 null 로 지운다', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [ok('wr1', 3000, 'PENDING')] });
      const out = await svc.refundPayment({
        data: { intentId: 'i1', manualRefund: { requestId: 'channel-cancel:o1', amount: 3000 } },
        amount: 3000,
        context: { idempotency_key: 'ref_m9' },
      } as any);
      expect(spy).toHaveBeenCalledWith(
        '/v1/payment-intents/i1/refund',
        expect.objectContaining({ body: JSON.stringify({ amount: 3000, reasonCode: 'MEDUSA_REFUND', execution: 'MANUAL' }) }),
      );
      expect(out.data).toEqual({ intentId: 'i1', manualRefund: null, walletRefundIds: ['wr1'] });
    });

    it('금액이 다르면 표식을 무시하고 자동으로 요청한다 — 다른 환불이 끼어든 것, 표식은 붙인 쪽이 지운다', async () => {
      const svc = makeService();
      const marker = { requestId: 'channel-cancel:o1', amount: 5000 };
      const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [ok('wr2', 1000)] });
      const out = await svc.refundPayment({ data: { intentId: 'i1', manualRefund: marker }, amount: 1000 } as any);
      expect(spy).toHaveBeenCalledWith(
        '/v1/payment-intents/i1/refund',
        expect.objectContaining({ body: JSON.stringify({ amount: 1000, reasonCode: 'MEDUSA_REFUND' }) }),
      );
      expect(out.data).toEqual({ intentId: 'i1', manualRefund: marker, walletRefundIds: ['wr2'] });
    });

    it('외부 환불 표식이 먼저다 — 둘 다 있으면 wallet 을 부르지 않는다(투영 중)', async () => {
      const svc = makeService();
      const spy = jest.spyOn(svc as any, 'walletFetch');
      await svc.refundPayment({
        data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 3000 }, manualRefund: { requestId: 'x', amount: 3000 } },
        amount: 3000,
      } as any);
      expect(spy).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 6: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts)`
Expected: FAIL — 첫 테스트의 body 에 `execution` 이 없다

- [ ] **Step 7: provider 구현**

`service.ts` 의 `./refund-data` import 에 `readManualRefund, withoutManualRefund` 를 더한다. `refundPayment` 에서 `externalRefund` 처리 바로 아래에:

```ts
    // 정산 라우트의 수동 환불(§6.3) — 금액이 같을 때만. 다르면 다른 환불이 끼어든 것이라 자동으로 가고 표식은 붙인 쪽이 지운다
    const manual = readManualRefund(data);
    const isManual = manual !== null && manual.amount === refundAmount;
```

wallet 호출 본문을 바꾼다:

```ts
        body: JSON.stringify({ amount: refundAmount, reasonCode: 'MEDUSA_REFUND', ...(isManual ? { execution: 'MANUAL' } : {}) }),
```

마지막 return 을 바꾼다:

```ts
    return { data: withWalletRefundIds(isManual ? withoutManualRefund(data) : data, verdict.ids) };
```

- [ ] **Step 8: 통과 확인**

Run: `(cd apps/medusa && npm run test:unit -- src/modules/almond-payment)`
Expected: PASS — 기존 «결정적 Idempotency-Key» 테스트의 body(`{ amount, reasonCode }`)도 그대로 통과한다(표식 없으면 키가 안 붙는다)

- [ ] **Step 9: 커밋**

```bash
git add apps/medusa/src/modules/almond-payment/refund-data.ts \
  apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts \
  apps/medusa/src/modules/almond-payment/service.ts \
  apps/medusa/src/modules/almond-payment/__tests__/refund-payment.unit.spec.ts
git commit -m "feat(medusa): 수동 환불 표식이면 wallet 에 execution MANUAL 로 요청 (#1016 36번 재설계 PR 2)"
```

---

### Task 3: 정산 공용 부품 — 환불 방식, 장부 맞추기 판정, 투영 함수 추출

**Files:**
- Create: `apps/medusa/src/workflows/orders/settlement/refund-mode.ts`
- Test: `apps/medusa/src/workflows/orders/settlement/__tests__/refund-mode.unit.spec.ts`
- Modify: `apps/medusa/src/modules/almond-payment/refund-data.ts` (시도 표식)
- Test: `apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts`
- Create: `apps/medusa/src/modules/almond-payment/wallet-refund-list.ts`
- Test: `apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-list.unit.spec.ts`
- Create: `apps/medusa/src/workflows/orders/settlement/plan-wallet-refund-bookings.ts`
- Test: `apps/medusa/src/workflows/orders/settlement/__tests__/plan-wallet-refund-bookings.unit.spec.ts`
- Create: `apps/medusa/src/workflows/orders/settlement/order-payments.ts`
- Create: `apps/medusa/src/workflows/orders/settlement/wallet-refund-ledger.ts` (이 태스크에선 `projectWalletRefund` 만)
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts` (`orderPaymentIds` 를 옮긴 곳에서 import, 잠금 키)
- Modify: `apps/medusa/src/api/hooks/payment-events/route.ts` (Step 1.5)

**Interfaces:**
- Produces: `export type RefundMode = 'auto' | 'manual'`, `export function parseRefundMode(value: unknown): RefundMode`
- Produces: `export type RefundAttempt = { note: string; amount: number }`, `readRefundAttempt(data): RefundAttempt | null`,
  `withRefundAttempt(data, attempt): Record<string, unknown>` (`refund-data.ts`)
- Produces: `export type WalletRefundListItem = { id: string; status: string; amount: number; reasonCode: string | null; createdAt: string }`,
  `export async function fetchWalletRefunds(intentId: string): Promise<WalletRefundListItem[]>`
- Produces: `export type WalletRefundBooking = { walletRefundId: string; amount: number; note: string }`,
  `export function planWalletRefundBookings(input: { walletRefunds: WalletRefundListItem[]; bookedWalletRefundIds: string[]; attempt: RefundAttempt | null }): WalletRefundBooking[]`
- Produces: `export const orderCancelLockKey = (orderId: string) => string`, `export async function orderPaymentIds(container: MedusaContainer, orderId: string): Promise<string[]>`
- Produces: `export async function projectWalletRefund(container: MedusaContainer, paymentId: string, booking: WalletRefundBooking): Promise<void>` — 결제 잠금 안에서 부른다

- [ ] **Step 1: 실패하는 유닛 테스트 넷**

```ts
// apps/medusa/src/workflows/orders/settlement/__tests__/refund-mode.unit.spec.ts
import { MedusaError } from '@medusajs/framework/utils';
import { parseRefundMode } from '../refund-mode';

describe('parseRefundMode (#1016 36번 재설계 §6.1)', () => {
  it.each([[undefined, 'auto'], [null, 'auto'], ['auto', 'auto'], ['manual', 'manual']])('%p → %s', (input, expected) => {
    expect(parseRefundMode(input)).toBe(expected);
  });

  it.each(['MANUAL', 'refund', 1, {}])('그 밖(%p)은 INVALID_DATA', (input) => {
    try {
      parseRefundMode(input);
      throw new Error('던지지 않았다');
    } catch (e) {
      expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
    }
  });
});
```

`refund-data.unit.spec.ts` 의 import 에 `readRefundAttempt, withRefundAttempt` 를 더하고 끝에:

```ts
describe('환불 시도 표식 (#1016 36번 재설계 §6.2 보강)', () => {
  it('쓰고 읽는다', () => {
    const data = withRefundAttempt({ intentId: 'i1' }, { note: 'partial-cancel:r1', amount: 30000 });
    expect(readRefundAttempt(data)).toEqual({ note: 'partial-cancel:r1', amount: 30000 });
  });

  it.each([undefined, null, {}, { note: 'x' }, { amount: 1 }, { note: 1, amount: 1 }])('모양이 다르면 없는 것으로(%p) — 지운 표식은 null 로 남는다', (v) => {
    expect(readRefundAttempt({ refundAttempt: v })).toBeNull();
  });
});
```

```ts
// apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-list.unit.spec.ts
import { fetchWalletRefunds } from '../wallet-refund-list';

describe('fetchWalletRefunds (#1048 목록 API)', () => {
  const originalFetch = global.fetch;
  const env = { base: process.env.WALLET_BASE_URL, key: process.env.WALLET_API_KEY };
  beforeEach(() => {
    process.env.WALLET_BASE_URL = 'http://wallet.test';
    process.env.WALLET_API_KEY = 'k';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.WALLET_BASE_URL = env.base;
    process.env.WALLET_API_KEY = env.key;
  });
  const respond = (status: number, body: unknown) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }) as any;
    return global.fetch as jest.Mock;
  };

  it('API 키로 GET 하고 판정에 쓰는 칸만 읽는다', async () => {
    const f = respond(200, [
      { id: 'wr1', chargeId: 'ch1', status: 'SUCCEEDED', amount: 3000, reasonCode: 'MEDUSA_REFUND', execution: 'AUTO', createdAt: '2026-10-11T00:00:00.000Z' },
      { id: 'wr2', chargeId: 'ch1', status: 'PENDING', amount: 1000, reasonCode: null, execution: 'MANUAL', createdAt: '2026-10-11T00:00:01.000Z' },
    ]);
    await expect(fetchWalletRefunds('int 1')).resolves.toEqual([
      { id: 'wr1', status: 'SUCCEEDED', amount: 3000, reasonCode: 'MEDUSA_REFUND', createdAt: '2026-10-11T00:00:00.000Z' },
      { id: 'wr2', status: 'PENDING', amount: 1000, reasonCode: null, createdAt: '2026-10-11T00:00:01.000Z' },
    ]);
    expect(f).toHaveBeenCalledWith('http://wallet.test/v1/payment-intents/int%201/refunds', {
      method: 'GET',
      headers: { Authorization: 'Bearer k' },
    });
  });

  it('2xx 가 아니면 던진다 — 장부를 못 맞췄으면 환불하지 않는다', async () => {
    respond(404, { error: 'INTENT_NOT_FOUND' });
    await expect(fetchWalletRefunds('i1')).rejects.toThrow(/HTTP 404/);
  });

  it.each([[{ rows: [] }], [[{ id: 'wr1', status: 'SUCCEEDED' }]]])('모양이 다르면 던진다(%p)', async (body) => {
    respond(200, body);
    await expect(fetchWalletRefunds('i1')).rejects.toThrow(/wallet 환불 목록/);
  });
});
```

```ts
// apps/medusa/src/workflows/orders/settlement/__tests__/plan-wallet-refund-bookings.unit.spec.ts
import type { WalletRefundListItem } from '../../../../modules/almond-payment/wallet-refund-list';
import { planWalletRefundBookings } from '../plan-wallet-refund-bookings';

const row = (id: string, amount: number, extra: Partial<WalletRefundListItem> = {}): WalletRefundListItem => ({
  id,
  amount,
  status: 'SUCCEEDED',
  reasonCode: 'MEDUSA_REFUND',
  createdAt: `2026-10-11T00:00:0${id.slice(-1)}.000Z`,
  ...extra,
});

describe('planWalletRefundBookings — 장부 맞추기 판정 (#1016 36번 재설계 §6.2)', () => {
  it('장부에 없는 SUCCEEDED·PENDING 만 넣는다 — FAILED 는 돈이 안 움직였고, 장부에 있는 것은 두 번 넣지 않는다', () => {
    const plan = planWalletRefundBookings({
      walletRefunds: [
        row('w1', 1000, { reasonCode: 'ADMIN_REFUND' }),
        row('w2', 2000, { reasonCode: 'ADMIN_REFUND', status: 'PENDING' }),
        row('w3', 3000, { reasonCode: 'ADMIN_REFUND', status: 'FAILED' }),
        row('w4', 4000, { reasonCode: 'ADMIN_REFUND' }),
      ],
      bookedWalletRefundIds: ['w4'],
      attempt: null,
    });
    expect(plan).toEqual([
      { walletRefundId: 'w1', amount: 1000, note: 'wallet:w1' },
      { walletRefundId: 'w2', amount: 2000, note: 'wallet:w2' },
    ]);
  });

  it('시도 표식이 없으면 장부에 없는 MEDUSA_REFUND(응답 유실)도 wallet: 메모로 넣는다 — 지금 투영은 건너뛰던 것', () => {
    expect(planWalletRefundBookings({ walletRefunds: [row('w1', 5000)], bookedWalletRefundIds: [], attempt: null })).toEqual([
      { walletRefundId: 'w1', amount: 5000, note: 'wallet:w1' },
    ]);
  });

  it('시도 표식이 남아 있으면 장부에 없는 MEDUSA_REFUND 를 그 메모로 — 부분취소가 «이 요청의 환불»로 세어 다시 내지 않는다', () => {
    expect(
      planWalletRefundBookings({
        walletRefunds: [row('w1', 20000), row('w2', 10000)],
        bookedWalletRefundIds: [],
        attempt: { note: 'partial-cancel:r1', amount: 30000 },
      }),
    ).toEqual([
      { walletRefundId: 'w1', amount: 20000, note: 'partial-cancel:r1' },
      { walletRefundId: 'w2', amount: 10000, note: 'partial-cancel:r1' },
    ]);
  });

  it('표식 금액까지만 귀속시키고 넘는 것은 wallet: — 다른 경로의 유실분을 이 요청 몫으로 부풀리지 않는다', () => {
    expect(
      planWalletRefundBookings({
        walletRefunds: [row('w1', 20000), row('w2', 20000)],
        bookedWalletRefundIds: [],
        attempt: { note: 'partial-cancel:r1', amount: 30000 },
      }),
    ).toEqual([
      { walletRefundId: 'w1', amount: 20000, note: 'partial-cancel:r1' },
      { walletRefundId: 'w2', amount: 20000, note: 'wallet:w2' },
    ]);
  });

  it('외부 환불(MEDUSA_REFUND 아님)은 표식이 있어도 wallet: — 37번 판정이 «외부 환불»로 읽는다', () => {
    expect(
      planWalletRefundBookings({
        walletRefunds: [row('w1', 5000, { reasonCode: 'ADMIN_REFUND' })],
        bookedWalletRefundIds: [],
        attempt: { note: 'channel-cancel:o1', amount: 33000 },
      }),
    ).toEqual([{ walletRefundId: 'w1', amount: 5000, note: 'wallet:w1' }]);
  });

  it('만든 순서대로 — 목록 순서와 무관하게', () => {
    const plan = planWalletRefundBookings({
      walletRefunds: [row('w2', 2000, { reasonCode: null }), row('w1', 1000, { reasonCode: null })],
      bookedWalletRefundIds: [],
      attempt: null,
    });
    expect(plan.map((b) => b.walletRefundId)).toEqual(['w1', 'w2']);
  });

  it('금액이 양의 정수가 아니면 건너뛴다', () => {
    expect(
      planWalletRefundBookings({ walletRefunds: [row('w1', 0), row('w2', 1.5)], bookedWalletRefundIds: [], attempt: null }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- settlement wallet-refund-list refund-data)`
Expected: FAIL — 모듈 없음 / `readRefundAttempt is not a function`

- [ ] **Step 3: `refund-mode.ts`**

```ts
// apps/medusa/src/workflows/orders/settlement/refund-mode.ts
import { MedusaError } from '@medusajs/framework/utils';

/** 정산 라우트의 환불 방식(#1016 36번 재설계 §6.1·§6.3). 없으면 auto — 옛 호출자(channel-adapter)는 이 칸을 모른다 */
export type RefundMode = 'auto' | 'manual';

export function parseRefundMode(value: unknown): RefundMode {
  if (value === undefined || value === null) return 'auto';
  if (value === 'auto' || value === 'manual') return value;
  throw new MedusaError(MedusaError.Types.INVALID_DATA, `refundMode 는 'auto' 또는 'manual' 이어야 합니다: ${JSON.stringify(value)}`);
}
```

- [ ] **Step 4: 시도 표식 — `refund-data.ts` 의 `withoutManualRefund` 아래**

```ts
/**
 * 환불 시도 표식(#1016 36번 재설계 §6.2 보강). 정산이 refundPaymentWorkflow 직전에 쓰고, 성공하면 지운다(null).
 * 실패로 남았다면 그 시도가 wallet 에서 돈을 움직였는지 Medusa 는 모른다(응답 유실 — Medusa 는 자기 환불 행을 지운다).
 * 다음 장부 맞추기가 장부에 없는 MEDUSA_REFUND 를 이 메모로 넣어, 부분취소가 «같은 요청의 환불»로 세게 한다 —
 * `wallet:` 메모로 들어가면 부분취소는 같은 몫을 또 환불한다. 맞추기가 표식을 소비한다(null).
 */
export type RefundAttempt = { note: string; amount: number };

export function readRefundAttempt(data: Record<string, unknown> | null | undefined): RefundAttempt | null {
  const v = data?.refundAttempt as Partial<RefundAttempt> | null | undefined;
  if (!v || typeof v !== 'object' || typeof v.note !== 'string' || typeof v.amount !== 'number') return null;
  return { note: v.note, amount: v.amount };
}

export function withRefundAttempt(data: Record<string, unknown>, attempt: RefundAttempt): Record<string, unknown> {
  return { ...data, refundAttempt: attempt };
}
```

- [ ] **Step 5: `wallet-refund-list.ts`**

```ts
// apps/medusa/src/modules/almond-payment/wallet-refund-list.ts
/**
 * wallet 환불 목록 `GET /v1/payment-intents/:id/refunds`(#1048 — 상태 무관, 만든 순서, 맨 배열). 정산 직전 장부 맞추기(§6.2)가 읽는다.
 * provider 밖에서 부르므로 provider 옵션과 같은 출처(env, medusa-config.js 의 기본값)를 쓴다.
 * 실패는 던진다 — 장부를 못 맞췄으면 환불하지 않는다(이중 환불보다 지연이 낫다, 정산은 500 으로 다시 불린다).
 */
export type WalletRefundListItem = {
  id: string;
  status: string;
  amount: number;
  reasonCode: string | null;
  createdAt: string;
};

export async function fetchWalletRefunds(intentId: string): Promise<WalletRefundListItem[]> {
  const base = process.env.WALLET_BASE_URL || 'http://localhost:3100';
  const key = process.env.WALLET_API_KEY || 'dev-secret';
  const res = await fetch(`${base}/v1/payment-intents/${encodeURIComponent(intentId)}/refunds`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`wallet 환불 목록을 읽지 못했습니다 — 장부를 맞추지 못해 환불하지 않습니다(intentId=${intentId}, HTTP ${res.status})`);
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error(`wallet 환불 목록 응답이 배열이 아닙니다(intentId=${intentId})`);
  return body.map((row, index) => parseRow(row, intentId, index));
}

function parseRow(row: unknown, intentId: string, index: number): WalletRefundListItem {
  const r = (row ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.status !== 'string' || typeof r.amount !== 'number' || typeof r.createdAt !== 'string') {
    throw new Error(`wallet 환불 목록 ${index}번 행의 모양이 다릅니다(intentId=${intentId}): ${JSON.stringify(row)}`);
  }
  return {
    id: r.id,
    status: r.status,
    amount: r.amount,
    reasonCode: typeof r.reasonCode === 'string' ? r.reasonCode : null,
    createdAt: r.createdAt,
  };
}
```

- [ ] **Step 6: `plan-wallet-refund-bookings.ts`**

```ts
// apps/medusa/src/workflows/orders/settlement/plan-wallet-refund-bookings.ts
import type { RefundAttempt } from '../../../modules/almond-payment/refund-data';
import type { WalletRefundListItem } from '../../../modules/almond-payment/wallet-refund-list';
import { EXTERNAL_REFUND_NOTE_PREFIX } from '../partial-cancel/external-refund';

export type WalletRefundBooking = { walletRefundId: string; amount: number; note: string };

const MOVED = new Set(['SUCCEEDED', 'PENDING']);

/**
 * 장부 맞추기(#1016 36번 재설계 §6.2): wallet 환불 중 Medusa 장부에 없는 것을 어떤 메모로 넣을지 정한다.
 * - SUCCEEDED·PENDING 만 — PENDING(송금 대기)은 wallet 남은 금액에서 이미 빠졌다. FAILED 는 돈이 안 움직였다
 * - 장부에 있는 것은 넣지 않는다: 결제 data.walletRefundIds(provider·투영이 쌓는다) 또는 `wallet:<id>` 메모
 * - 시도 표식이 남아 있으면 장부에 없는 MEDUSA_REFUND 를 그 메모로(그 시도의 응답 유실) — 표식 금액까지만, 만든 순서대로
 * - 나머지는 `wallet:<id>` — Medusa 밖 환불(37번 판정이 «외부 환불»로 읽는다), 표식 없는 유실분도 여기로
 */
export function planWalletRefundBookings(input: {
  walletRefunds: WalletRefundListItem[];
  bookedWalletRefundIds: string[];
  attempt: RefundAttempt | null;
}): WalletRefundBooking[] {
  const booked = new Set(input.bookedWalletRefundIds);
  let attributable = input.attempt?.amount ?? 0;
  return input.walletRefunds
    .filter((r) => MOVED.has(r.status) && !booked.has(r.id) && Number.isInteger(r.amount) && r.amount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((r) => {
      if (input.attempt && r.reasonCode === 'MEDUSA_REFUND' && r.amount <= attributable) {
        attributable -= r.amount;
        return { walletRefundId: r.id, amount: r.amount, note: input.attempt.note };
      }
      return { walletRefundId: r.id, amount: r.amount, note: `${EXTERNAL_REFUND_NOTE_PREFIX}${r.id}` };
    });
}
```

- [ ] **Step 7: 유닛 통과 확인**

Run: `(cd apps/medusa && npm run test:unit -- settlement wallet-refund-list refund-data)`
Expected: PASS

- [ ] **Step 8: `order-payments.ts` — 부분취소에서 옮긴다**

```ts
// apps/medusa/src/workflows/orders/settlement/order-payments.ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';

/**
 * 부분취소와 채널 전체취소가 같이 쓰는 주문 잠금 — 한 주문의 정산은 한 번에 하나다(재발행·재배달이 겹쳐도 환불은 한 번).
 * 값은 진행 중인 부분취소 잠금과 맞물리도록 옛 값 그대로 둔다. 안에서 결제 잠금(paymentRefundLockKey)을 잡는다 — 순서는 늘 주문 → 결제.
 */
export const orderCancelLockKey = (orderId: string) => `partial-cancel:${orderId}`;

/** 주문 ↔ 결제 컬렉션은 링크다(주문 버전과 무관). 결제 자체는 payment 모듈에서 읽는다. */
export async function orderPaymentIds(container: MedusaContainer, orderId: string): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({ entity: 'order', fields: ['id', 'payment_collections.id'], filters: { id: orderId } });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 id 배열로만 좁힌다.
  const collectionIds = ((data[0] as { payment_collections?: Array<{ id: string } | null> } | undefined)?.payment_collections ?? [])
    .flatMap((pc) => (pc?.id ? [pc.id] : []));
  if (collectionIds.length === 0) return [];
  const collections = await container.resolve(Modules.PAYMENT).listPaymentCollections(
    { id: collectionIds },
    { select: ['id'], relations: ['payments'] },
  );
  return collections
    .flatMap((pc) => pc.payments ?? [])
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime() || a.id.localeCompare(b.id))
    .map((p) => p.id);
}
```

`partial-cancel-order.ts` 에서:
- 파일 끝 쪽의 `async function orderPaymentIds(...) { … }` 와 그 위 주석 한 줄을 **지운다**
- import 에 `import { orderCancelLockKey, orderPaymentIds } from '../settlement/order-payments';` 를 더한다
- `partialCancelOrder` 의 `locking.execute(\`partial-cancel:${input.orderId}\`, …` 를 `locking.execute(orderCancelLockKey(input.orderId), …` 로 바꾼다
- 쓰이지 않게 된 `ContainerRegistrationKeys` import 가 있으면 남겨 둔다(다른 곳에서 쓴다 — `grep -n ContainerRegistrationKeys` 로 확인하고, 0 이면 지운다)

- [ ] **Step 9: `wallet-refund-ledger.ts` — 투영 한 건을 웹훅에서 뽑는다**

```ts
// apps/medusa/src/workflows/orders/settlement/wallet-refund-ledger.ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import { withExternalRefund } from '../../../modules/almond-payment/refund-data';
import type { WalletRefundBooking } from './plan-wallet-refund-bookings';

/**
 * Medusa 밖에서 끝난(또는 응답을 잃은) wallet 환불 하나를 장부에 넣는다 — wallet 을 다시 부르지 않는다(ADR-0042 원칙 3).
 * `externalRefund` 표식을 쓰고 refundPaymentWorkflow 를 돌리면 almond-payment 가 표식을 보고 wallet 호출을 건너뛴다.
 * 결제 잠금(paymentRefundLockKey) 안에서 부른다. 웹훅 투영(api/hooks/payment-events)과 장부 맞추기가 함께 쓴다.
 */
export async function projectWalletRefund(container: MedusaContainer, paymentId: string, booking: WalletRefundBooking): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const fresh = await paymentModule.retrievePayment(paymentId, { select: ['id', 'data'] });
  await paymentModule.updatePayment({
    id: paymentId,
    data: withExternalRefund(fresh.data ?? {}, { walletRefundId: booking.walletRefundId, amount: booking.amount }),
  });
  try {
    await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount: booking.amount, note: booking.note } });
  } catch (err) {
    // 영구 실패(캡처 없음·캡처 초과 등)면 표식이 남아 같은 금액의 다음 Medusa 환불이 wallet 을 건너뛴다.
    // Medusa 는 JSON 칸을 병합 갱신하므로 null 로 지운다. 재배달·다음 맞추기가 표식을 다시 쓴다.
    await paymentModule.updatePayment({ id: paymentId, data: { externalRefund: null } });
    throw err;
  }
}
```

- [ ] **Step 10: 웹훅이 뽑은 함수를 쓴다**

`apps/medusa/src/api/hooks/payment-events/route.ts` 의 `handleRefundProjection` Step 1.5 잠금 안, `if (decision !== 'record_external' || !walletRefundId) return;` **다음**의
`await paymentModule.updatePayment({ … withExternalRefund … });` 부터 `logger.info(\`… recorded external refund …\`);` **직전**까지(try/catch 포함)를 이것으로 바꾼다:

```ts
      await projectWalletRefund(scope, payment.id, { walletRefundId, amount: refundAmount, note: `wallet:${walletRefundId}` });
```

import 를 고친다:
- `import { capturePaymentWorkflow, refundPaymentWorkflow } from '@medusajs/core-flows';` → `import { capturePaymentWorkflow } from '@medusajs/core-flows';`
  (먼저 `grep -n refundPaymentWorkflow apps/medusa/src/api/hooks/payment-events/route.ts` 가 바꾼 자리 밖에 0 인지 본다)
- `refund-data` import 에서 `withExternalRefund` 를 뺀다(같은 방법으로 확인)
- 더한다: `import { projectWalletRefund } from '../../../workflows/orders/settlement/wallet-refund-ledger';`

응답 유실 로그(`isUnbookedMedusaRefund`)는 **그대로** 둔다 — 웹훅은 provider 가 `walletRefundIds` 를 쓰기 전에 올 수 있어(정상인 경합) 여기서 장부에 넣으면
이중 기록이 된다. 그 환불은 정산 직전 장부 맞추기가 결제 잠금 안에서 넣는다.

- [ ] **Step 11: 리팩터 안전 확인 — 유닛 전부 + 영향받는 통합**

Run:
```bash
npm run test:medusa
scripts/local/run-medusa-integration.sh --testPathPattern 'wallet-refund-projection|partial-cancel'
```
Expected: 유닛 실패 0(기준선 + 이 태스크까지 더한 수). 통합 둘 다 PASS — 웹훅 투영(«워크플로가 영구 실패하면 던지고 표식을 남기지 않는다» 포함)과 부분취소가 리팩터 전과 같다.

- [ ] **Step 12: 커밋**

```bash
git add apps/medusa/src/workflows/orders/settlement apps/medusa/src/modules/almond-payment/refund-data.ts \
  apps/medusa/src/modules/almond-payment/__tests__/refund-data.unit.spec.ts \
  apps/medusa/src/modules/almond-payment/wallet-refund-list.ts \
  apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-list.unit.spec.ts \
  apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts \
  apps/medusa/src/api/hooks/payment-events/route.ts
git commit -m "refactor(medusa): 정산 공용 부품 — 환불 방식·장부 맞추기 판정·투영 함수 추출 (#1016 36번 재설계 PR 2)"
```

---

### Task 4: 전체취소 정산 라우트 — `POST /admin/orders/:id/channel-cancel`

**Files:**
- Modify: `apps/medusa/src/workflows/orders/settlement/wallet-refund-ledger.ts` (맞추기 둘 추가)
- Create: `apps/medusa/src/workflows/orders/settlement/issue-payment-refund.ts`
- Create: `apps/medusa/src/workflows/orders/channel-cancel/channel-cancel-order.ts`
- Create: `apps/medusa/src/api/admin/orders/[id]/channel-cancel/route.ts`
- Modify: `apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts` (`FakeWallet`)
- Test: `apps/medusa/integration-tests/http/channel-cancel-settlement.spec.ts`

**Interfaces:**
- Consumes: Task 1 `readWalletRefundRefusal`; Task 2 `withManualRefund`; Task 3 `RefundMode`·`parseRefundMode`·`withRefundAttempt`·`readRefundAttempt`·`fetchWalletRefunds`·
  `planWalletRefundBookings`·`projectWalletRefund`·`orderCancelLockKey`·`orderPaymentIds`
- Produces: `export async function reconcileWalletRefunds(container: MedusaContainer, paymentId: string): Promise<void>` — 결제 잠금 안에서
- Produces: `export async function reconcileOrderWalletRefunds(container: MedusaContainer, orderId: string): Promise<void>` — 결제마다 잠금을 잡는다
- Produces: `export async function issuePaymentRefund(container: MedusaContainer, input: { paymentId: string; amount: number; note: string; mode: RefundMode; actorId?: string }): Promise<void>` — 결제 잠금 안에서
- Produces: `export type ChannelCancelInput = { orderId: string; refundMode: RefundMode; actorId?: string }`,
  `export type ChannelCancelResult = { orderId: string; status: 'canceled'; refund: { mode: RefundMode; amount: number } }`,
  `export async function channelCancelOrder(container: MedusaContainer, input: ChannelCancelInput): Promise<ChannelCancelResult>`
- Produces(FakeWallet): `refunds: FakeRefund[]`(`status`·`execution`·`createdAt` 추가), `calls[].body`, `rejectNextRefundWith.{message?, retryable?}`,
  `failNextRefundAs200Failed: boolean | { failureCode: string | null; retryable: boolean | null; message: string }`, `loseNextRefundResponse`,
  `addExternalRefund(intentId: string, amount: number, reasonCode?: string): FakeRefund`, `refundCalls()`, `GET …/refunds`

- [ ] **Step 1: FakeWallet 확장**

`partial-cancel-fixture.ts` 의 `type Intent = …` 줄부터 `FakeWallet` 클래스 끝(`}` — `export type Ctx` 바로 위)까지를 이것으로 바꾼다.
기존 테스트가 쓰는 이름(`refunds`·`calls`·`failNextRefund`·`failNextRefundAs200Failed = true`·`callsTo`·`simulateCheckout`·`reset`)은 그대로 산다.

```ts
type Intent = { id: string; amount: number; status: string; captured: number; refunded: number };
/** 돈이 움직인(또는 송금 대기인) 환불. FAILED 는 남기지 않는다 — 실제 wallet 에서도 남은 금액을 안 줄인다 */
export type FakeRefund = {
  id: string;
  intentId: string;
  amount: number;
  status: 'SUCCEEDED' | 'PENDING';
  execution: 'AUTO' | 'MANUAL';
  reasonCode?: string;
  idempotencyKey?: string;
  createdAt: string;
};
type Failed200 = { failureCode: string | null; retryable: boolean | null; message: string };

/** 실제 wallet 의 환불 규칙(환불가능액 초과 거절, Idempotency-Key 재생, #1048 의 목록·분류·수동 실행)을 흉내내는 최소 스텁. */
export class FakeWallet {
  server?: Server;
  intents = new Map<string, Intent>();
  refunds: FakeRefund[] = [];
  calls: Array<{ path: string; method: string; body?: any }> = [];
  failNextRefund = false;
  /** 실제 wallet 처럼 PG 거절을 200 + FAILED 환불 행으로 돌려준다(RefundsService.create 가 예외를 삼킨다). 객체면 그 분류(#1048)를 싣는다 */
  failNextRefundAs200Failed: boolean | Failed200 = false;
  /** wallet 의 4xx 거절 — 본문 `{ error, message, retryable }`(#1048). retryable 을 안 주면 칸이 없다(ValidationPipe 처럼) */
  rejectNextRefundWith: { status: number; error: string; message?: string; retryable?: boolean } | null = null;
  /** 환불은 해 놓고 응답을 잃는다(504, 본문 없음) — Medusa 는 실패로 보고 자기 환불 행을 지운다 */
  loseNextRefundResponse = false;
  private seq = 0;

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : {};
        const key = (req.headers['idempotency-key'] as string | undefined) ?? undefined;
        const { status, payload } = this.route(req.method ?? 'GET', new URL(req.url ?? '/', WALLET_BASE_URL).pathname, parsed, key);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(payload === null ? undefined : JSON.stringify(payload));
      });
    });
    await new Promise<void>((r) => this.server!.listen(WALLET_PORT, '127.0.0.1', r));
  }
  async stop() {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
  }
  reset() {
    this.intents.clear();
    this.refunds = [];
    this.calls = [];
    this.failNextRefund = false;
    this.failNextRefundAs200Failed = false;
    this.rejectNextRefundWith = null;
    this.loseNextRefundResponse = false;
  }
  /** 결제창 완료 = 즉시 승인 + 캡처(지연 승인 표식이 없을 때의 wallet 동작). */
  simulateCheckout(intentId: string) {
    const i = this.intents.get(intentId)!;
    i.status = 'CAPTURED';
    i.captured = i.amount;
  }
  /** Medusa 를 거치지 않은 wallet 환불(관리자 환불 등) — 웹훅이 빠져 장부에 없는 상황을 흉내낸다 */
  addExternalRefund(intentId: string, amount: number, reasonCode = 'ADMIN_REFUND'): FakeRefund {
    this.intents.get(intentId)!.refunded += amount;
    return this.pushRefund({ intentId, amount, status: 'SUCCEEDED', execution: 'AUTO', reasonCode });
  }
  callsTo(suffix: string) {
    return this.calls.filter((c) => c.path.endsWith(suffix)).length;
  }
  /** 환불 요청(POST …/refund)만 — 목록 조회(GET …/refunds)는 세지 않는다 */
  refundCalls() {
    return this.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/refund'));
  }
  private pushRefund(r: Omit<FakeRefund, 'id' | 'createdAt'>): FakeRefund {
    const seq = ++this.seq;
    const refund: FakeRefund = { ...r, id: `ref_${seq}`, createdAt: new Date(Date.UTC(2026, 9, 11) + seq * 1000).toISOString() };
    this.refunds.push(refund);
    return refund;
  }
  private route(method: string, path: string, body: any, key?: string): { status: number; payload: any } {
    this.calls.push({ path, method, body });
    if (method === 'POST' && path === '/v1/payment-intents') {
      const id = `int_${++this.seq}`;
      this.intents.set(id, { id, amount: body.amount ?? 0, status: 'CREATED', captured: 0, refunded: 0 });
      return { status: 201, payload: { id } };
    }
    const m = /^\/v1\/payment-intents\/([^/]+)(\/.*)?$/.exec(path);
    const intent = m && this.intents.get(m[1]);
    if (!m || !intent) return { status: 404, payload: { error: 'INTENT_NOT_FOUND', message: path } };
    const action = m[2] ?? '';
    if (method === 'GET' && !action) {
      return { status: 200, payload: { id: intent.id, status: intent.status, payableAmount: intent.amount, currency: 'KRW' } };
    }
    if (method === 'GET' && action === '/refunds') {
      return {
        status: 200,
        payload: this.refunds
          .filter((r) => r.intentId === intent.id)
          .map((r) => ({
            id: r.id,
            chargeId: `ch_${intent.id}`,
            status: r.status,
            amount: r.amount,
            reasonCode: r.reasonCode ?? null,
            execution: r.execution,
            createdAt: r.createdAt,
          })),
      };
    }
    if (action === '/finalize-approval') {
      intent.status = 'CAPTURED';
      intent.captured = intent.amount;
      return { status: 200, payload: { status: intent.status } };
    }
    if (action === '/capture') return { status: 200, payload: { status: intent.status } };
    if (action === '/cancel') return { status: 200, payload: { status: 'CANCELED' } };
    if (action === '/refund') {
      const replay = key ? this.refunds.find((r) => r.idempotencyKey === key) : undefined;
      if (replay) return { status: 200, payload: { intentId: intent.id, refunds: [{ id: replay.id, amount: replay.amount, status: replay.status }] } };
      if (this.rejectNextRefundWith) {
        const { status, error, message, retryable } = this.rejectNextRefundWith;
        this.rejectNextRefundWith = null;
        return { status, payload: { error, message: message ?? 'injected', ...(retryable !== undefined ? { retryable } : {}) } };
      }
      if (this.failNextRefund) {
        this.failNextRefund = false;
        return { status: 502, payload: { error: 'PG_UNAVAILABLE', message: 'injected' } };
      }
      // 실제 wallet 의 DTO 검증(@IsInt @Min(1))처럼 거절한다 — amount:null 같은 결함이 0 원 환불로 조용히 통과하지 않게.
      const amount = body.amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        return { status: 400, payload: { error: 'VALIDATION_ERROR', message: `amount must be a positive integer: ${JSON.stringify(amount)}` } };
      }
      if (this.failNextRefundAs200Failed) {
        const f: Failed200 =
          this.failNextRefundAs200Failed === true
            ? { failureCode: null, retryable: null, message: 'injected PG decline' }
            : this.failNextRefundAs200Failed;
        this.failNextRefundAs200Failed = false;
        return {
          status: 200,
          payload: {
            intentId: intent.id,
            refunds: [
              {
                id: `ref_${++this.seq}`,
                amount,
                status: 'FAILED',
                reasonCode: body.reasonCode ?? null,
                reasonMessage: f.message,
                failureCode: f.failureCode,
                retryable: f.retryable,
              },
            ],
          },
        };
      }
      if (amount > intent.captured - intent.refunded) {
        return { status: 400, payload: { error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE', message: `${amount}`, retryable: true } };
      }
      intent.refunded += amount;
      // 실제 wallet 의 수동 실행은 외부 결제 몫을 PG 없이 송금 대기로 남긴다(포인트 몫 분할은 흉내내지 않는다)
      const manual = body.execution === 'MANUAL';
      const refund = this.pushRefund({
        intentId: intent.id,
        amount,
        status: manual ? 'PENDING' : 'SUCCEEDED',
        execution: manual ? 'MANUAL' : 'AUTO',
        reasonCode: body.reasonCode,
        idempotencyKey: key,
      });
      if (this.loseNextRefundResponse) {
        this.loseNextRefundResponse = false;
        return { status: 504, payload: null };
      }
      return { status: 200, payload: { intentId: intent.id, refunds: [{ id: refund.id, amount, status: refund.status }] } };
    }
    return { status: 404, payload: { error: 'NOT_FOUND', message: path } };
  }
}
```

- [ ] **Step 2: 실패하는 통합 테스트**

```ts
// apps/medusa/integration-tests/http/channel-cancel-settlement.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { beginOrderEditOrderWorkflow, refundPaymentWorkflow } from '@medusajs/medusa/core-flows';
import { readManualRefund, readRefundAttempt } from '../../src/modules/almond-payment/refund-data';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * 채널 전체취소 정산(#1016 36번 재설계 스펙 §6.1~§6.4, §10 Medusa). 주문은 A 1개(30,000) + 조건부 배송비 3,000 — 캡처액은 ledger() 로 읽는다.
 * 순서는 «주문 잠금 → 검증 → ① 장부 맞추기 → ② 남은 몫 환불 → ③ 기본 취소». 기본 /cancel 은 특성 테스트로 고정한다(업그레이드 경보).
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const place = () => placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 1 }] });
    const order = (orderId: string) => loadOrder(getContainer(), orderId);
    const channelCancel = (orderId: string, body: Record<string, unknown> = {}) =>
      api.post(`/admin/orders/${orderId}/channel-cancel`, body, c.adminHeaders).catch((e: any) => e.response);
    /** 결제의 장부(메모 포함) — loadOrder 의 graph 는 note 를 읽지 않는다 */
    const ledger = async (orderId: string) => {
      const paymentId = (await order(orderId)).payment_collections[0].payments[0].id as string;
      const p = await getContainer().resolve(Modules.PAYMENT).retrievePayment(paymentId, { select: ['id', 'data'], relations: ['captures', 'refunds'] });
      return {
        paymentId,
        data: p.data as Record<string, unknown>,
        captured: (p.captures ?? []).reduce((s: number, x: any) => s + num(x.amount), 0),
        refunds: (p.refunds ?? []).map((r: any) => ({ amount: num(r.amount), note: r.note })),
      };
    };

    describe('결과', () => {
      it('정상: 환불 한 번 뒤 취소하고 장부 차액은 0 — 크레딧 라인이 두 번 붙지 않는다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data).toEqual({ orderId, status: 'canceled', refund: { mode: 'auto', amount: captured } });
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect(wallet.refunds.map((r) => r.amount)).toEqual([captured]);
        expect(num(o.summary.pending_difference)).toBe(0);
        expect(o.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(captured);
        const after = await ledger(orderId);
        expect(after.refunds).toEqual([{ amount: captured, note: `channel-cancel:${orderId}` }]);
        expect(readRefundAttempt(after.data)).toBeNull();
      });

      it.each([
        [400, 'REFUND_NOT_AUTOMATABLE'],
        [400, 'MEMBERSHIP_REFUND_NOT_ALLOWED'],
        [404, 'REFUNDABLE_CHARGE_NOT_FOUND'],
      ])('영구 거절: wallet %s %s(retryable false) → 400 표지, 주문은 취소되지 않고 장부에 환불이 없다', async (status, error) => {
        const { orderId } = await place();
        wallet.rejectNextRefundWith = { status, error, message: 'wallet 원문', retryable: false };
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data).toEqual(expect.objectContaining({ type: 'not_allowed', code: `wallet_refund_refused:${error}`, message: 'wallet 원문' }));
        expect((await order(orderId)).status).not.toBe('canceled');
        expect((await ledger(orderId)).refunds).toEqual([]);
        expect(wallet.refunds).toHaveLength(0);
      });

      it('영구 거절: 200 의 FAILED 행(retryable false)은 그 failureCode 와 토스 문장으로', async () => {
        const { orderId } = await place();
        wallet.failNextRefundAs200Failed = { failureCode: 'NOT_CANCELABLE_AMOUNT', retryable: false, message: '취소 할 수 없는 금액 입니다.' };
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data).toEqual(
          expect.objectContaining({ type: 'not_allowed', code: 'wallet_refund_refused:NOT_CANCELABLE_AMOUNT', message: '취소 할 수 없는 금액 입니다.' }),
        );
        expect((await order(orderId)).status).not.toBe('canceled');
      });

      it.each<[string, () => void]>([
        ['wallet 502', () => { wallet.failNextRefund = true; }],
        ['맞춘 뒤의 금액 초과(retryable true) — 경합', () => { wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', retryable: true }; }],
        ['retryable 없는 400(ValidationPipe)', () => { wallet.rejectNextRefundWith = { status: 400, error: 'Bad Request' }; }],
        ['분류 전 FAILED 행(retryable null)', () => { wallet.failNextRefundAs200Failed = true; }],
      ])('일시: %s → 500, 주문은 취소되지 않고, 다시 부르면 끝낸다', async (_, inject) => {
        const { orderId } = await place();
        inject();
        expect((await channelCancel(orderId)).status).toBe(500);
        expect((await order(orderId)).status).not.toBe('canceled');
        expect((await ledger(orderId)).refunds).toEqual([]);
        expect((await channelCancel(orderId)).status).toBe(200);
        expect((await order(orderId)).status).toBe('canceled');
        expect(wallet.refunds).toHaveLength(1);
      });

      it('이미 취소된 주문은 코어와 같은 문장의 400 — channel-adapter 가 «이미 취소됨 = 성공»으로 읽는다, 다시 환불하지 않는다', async () => {
        const { orderId } = await place();
        expect((await channelCancel(orderId)).status).toBe(200);
        const again = await channelCancel(orderId);
        expect(again.status).toBe(400);
        expect(again.data.message).toBe(`Order with id ${orderId} has been canceled.`);
        expect(wallet.refunds).toHaveLength(1);
      });

      it('진행 중인 주문 변경이 있으면 환불 전에 400 — 환불의 크레딧 라인 단계가 돈이 나간 뒤 실패하지 않게', async () => {
        const { orderId } = await place();
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data.type).toBe('not_allowed');
        expect(wallet.refundCalls()).toHaveLength(0);
        expect((await order(orderId)).status).not.toBe('canceled');
      });

      it('이 경로로 돈이 이미 나간 뒤의 재시도는 사전검사 거절도 500 — 요청이 «취소 불가»로 닫히지 않게', async () => {
        const { orderId } = await place();
        const { paymentId, captured } = await ledger(orderId);
        // 첫 시도가 환불까지 하고 취소 전에 끊긴 상태 — 그 사이 주문 변경이 열렸다
        await refundPaymentWorkflow(getContainer()).run({ input: { payment_id: paymentId, amount: captured, note: `channel-cancel:${orderId}` } });
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } });
        const res = await channelCancel(orderId);
        expect(res.status).toBe(500);
        expect((await order(orderId)).status).not.toBe('canceled');
        expect(wallet.refunds).toHaveLength(1);
      });

      it('취소 안 된 출고가 있으면 환불 전에 400', async () => {
        const { orderId } = await place();
        const item = (await order(orderId)).items[0];
        await api.post(`/admin/orders/${orderId}/fulfillments`, { items: [{ id: item.id, quantity: 1 }] }, c.adminHeaders);
        const res = await channelCancel(orderId);
        expect(res.status).toBe(400);
        expect(res.data.type).toBe('not_allowed');
        expect(wallet.refundCalls()).toHaveLength(0);
      });

      it('없는 주문은 404 not_found, 잘못된 refundMode 는 400 invalid_data', async () => {
        const missing = await channelCancel('order_missing_1016_36');
        expect(missing.status).toBe(404);
        expect(missing.data.type).toBe('not_found');
        const { orderId } = await place();
        const bad = await channelCancel(orderId, { refundMode: 'MANUAL' });
        expect(bad.status).toBe(400);
        expect(bad.data.type).toBe('invalid_data');
        expect(wallet.refundCalls()).toHaveLength(0);
      });
    });

    describe('장부 맞추기 (§6.2)', () => {
      it('투영 안 된 외부 환불은 장부에 넣고 남은 몫만 환불한다', async () => {
        const { orderId, intentId } = await place();
        const { captured } = await ledger(orderId);
        const ext = wallet.addExternalRefund(intentId, 10000);
        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data.refund).toEqual({ mode: 'auto', amount: captured - 10000 });
        expect(wallet.refundCalls().map((x) => x.body.amount)).toEqual([captured - 10000]);
        const after = await ledger(orderId);
        expect(after.refunds).toHaveLength(2);
        expect(after.refunds).toEqual(
          expect.arrayContaining([
            { amount: 10000, note: `wallet:${ext.id}` },
            { amount: captured - 10000, note: `channel-cancel:${orderId}` },
          ]),
        );
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect(num(o.summary.pending_difference)).toBe(0);
      });

      it('응답을 잃은 MEDUSA_REFUND 는 다시 나가지 않는다 — 시도 표식의 메모로 장부에 들어간다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        wallet.loseNextRefundResponse = true;
        expect((await channelCancel(orderId)).status).toBe(500);
        expect(wallet.refunds).toHaveLength(1); // 돈은 나갔다
        const mid = await ledger(orderId);
        expect(mid.refunds).toEqual([]); // Medusa 는 실패로 보고 자기 환불 행을 지웠다
        expect(readRefundAttempt(mid.data)).toEqual({ note: `channel-cancel:${orderId}`, amount: captured });
        expect((await order(orderId)).status).not.toBe('canceled');

        const res = await channelCancel(orderId);
        expect(res.status).toBe(200);
        expect(res.data.refund).toEqual({ mode: 'auto', amount: captured });
        expect(wallet.refundCalls()).toHaveLength(1); // 재시도는 wallet 에 환불을 다시 요청하지 않았다
        const after = await ledger(orderId);
        expect(after.refunds).toEqual([{ amount: captured, note: `channel-cancel:${orderId}` }]);
        expect(readRefundAttempt(after.data)).toBeNull();
        expect((await order(orderId)).status).toBe('canceled');
      });
    });

    describe('수동 환불 (§6.3)', () => {
      it('refundMode manual → wallet 송금 대기(PENDING·MANUAL), 주문 취소, 차액 0, 수동 표식은 null', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        const res = await channelCancel(orderId, { refundMode: 'manual' });
        expect(res.status).toBe(200);
        expect(res.data).toEqual({ orderId, status: 'canceled', refund: { mode: 'manual', amount: captured } });
        expect(wallet.refundCalls().map((x) => x.body.execution)).toEqual(['MANUAL']);
        expect(wallet.refunds).toEqual([expect.objectContaining({ amount: captured, status: 'PENDING', execution: 'MANUAL' })]);
        const o = await order(orderId);
        expect(o.status).toBe('canceled');
        expect(num(o.summary.pending_difference)).toBe(0);
        expect(readManualRefund((await ledger(orderId)).data)).toBeNull();
      });

      it('자동이 영구 거절된 주문을 수동으로 다시 부르면 끝난다(스모크 S1 → S2)', async () => {
        const { orderId } = await place();
        wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
        expect((await channelCancel(orderId)).status).toBe(400);
        const res = await channelCancel(orderId, { refundMode: 'manual' });
        expect(res.status).toBe(200);
        expect((await order(orderId)).status).toBe('canceled');
        expect(wallet.refunds).toEqual([expect.objectContaining({ status: 'PENDING', execution: 'MANUAL' })]);
      });

      it('수동 시도가 일시 실패하면 수동 표식을 지운다 — 다음 자동 시도가 MANUAL 로 새지 않는다', async () => {
        const { orderId } = await place();
        wallet.failNextRefund = true;
        expect((await channelCancel(orderId, { refundMode: 'manual' })).status).toBe(500);
        expect(readManualRefund((await ledger(orderId)).data)).toBeNull();
        expect((await channelCancel(orderId)).status).toBe(200);
        expect(wallet.refundCalls().map((x) => x.body.execution)).toEqual(['MANUAL', undefined]);
        expect(wallet.refunds).toEqual([expect.objectContaining({ status: 'SUCCEEDED', execution: 'AUTO' })]);
      });

      it('수동 응답을 잃어도 재시도에 송금 대기가 두 줄 생기지 않는다', async () => {
        const { orderId } = await place();
        wallet.loseNextRefundResponse = true;
        expect((await channelCancel(orderId, { refundMode: 'manual' })).status).toBe(500);
        expect((await channelCancel(orderId, { refundMode: 'manual' })).status).toBe(200);
        expect(wallet.refundCalls()).toHaveLength(1);
        expect(wallet.refunds).toEqual([expect.objectContaining({ status: 'PENDING', execution: 'MANUAL' })]);
        expect((await order(orderId)).status).toBe('canceled');
      });
    });

    describe('멱등 — 리컨실러 재발행의 전제', () => {
      it('같은 주문에 동시에 두 번 → 환불 한 번(하나는 200, 하나는 «이미 취소됨» 400)', async () => {
        const { orderId } = await place();
        const [a, b] = await Promise.all([channelCancel(orderId), channelCancel(orderId)]);
        expect([a.status, b.status].sort()).toEqual([200, 400]);
        expect(wallet.refunds).toHaveLength(1);
      });
    });

    describe('특성: 기본 /cancel (Medusa 2.13.4 — 업그레이드로 바뀌면 스펙 §6.1 순서·§6.6 미들웨어를 재검토)', () => {
      it('wallet 영구 거절에도 200 + canceled + Refund 0 + 환불 거래 −X(유령) — 장부 차액은 +X 로 뒤집힌다', async () => {
        const { orderId } = await place();
        const { captured } = await ledger(orderId);
        wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
        const res = await api.post(`/admin/orders/${orderId}/cancel`, {}, c.adminHeaders).catch((e: any) => e.response);
        expect(res.status).toBe(200);
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
  },
});
```

- [ ] **Step 3: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'channel-cancel-settlement'`
Expected: 특성 테스트만 PASS, 나머지 FAIL — 라우트가 없어 `/channel-cancel` 이 404(본문 없음).
특성 테스트가 FAIL 이면 멈추고 보고한다 — 스펙 §2.2 의 전제(유령 환불 거래·`pending_difference` +X)가 이 환경에서 다르다는 뜻이다.

- [ ] **Step 4: 장부 맞추기 — `wallet-refund-ledger.ts` 에 더한다**

import 를 이렇게 넓힌다:

```ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import { paymentRefundLockKey, readRefundAttempt, readWalletRefundIds, withExternalRefund } from '../../../modules/almond-payment/refund-data';
import { fetchWalletRefunds } from '../../../modules/almond-payment/wallet-refund-list';
import { EXTERNAL_REFUND_NOTE_PREFIX } from '../partial-cancel/external-refund';
import { orderPaymentIds } from './order-payments';
import { planWalletRefundBookings, type WalletRefundBooking } from './plan-wallet-refund-bookings';

/** 환불 투영(payment-events)·부분취소와 같은 값. 맞추기는 보통 0~1건이라 그 안에 든다 */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;
```

파일 끝에 더한다:

```ts
/**
 * 결제 하나의 장부 맞추기(#1016 36번 재설계 §6.2). 결제 잠금 안에서 부른다.
 * wallet 환불 목록에서 장부에 없는 SUCCEEDED·PENDING 을 투영으로 넣는다 — 그래야 뒤의 «캡처 − 환불»이 이미 나간 돈을 또 내지 않는다.
 * 남은 시도 표식은 여기서 소비한다: 그 시도가 움직인 돈은 방금 그 메모로 들어갔거나, 없었다.
 */
export async function reconcileWalletRefunds(container: MedusaContainer, paymentId: string): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const payment = await paymentModule.retrievePayment(paymentId, { select: ['id', 'data', 'canceled_at'], relations: ['refunds'] });
  const data = payment.data ?? {};
  const intentId = typeof data.intentId === 'string' ? data.intentId : null;
  // wallet 결제가 아니거나 캡처 전에 취소된 결제 — 맞출 환불이 없다
  if (!intentId || payment.canceled_at) return;
  const attempt = readRefundAttempt(data);
  const bookings = planWalletRefundBookings({
    walletRefunds: await fetchWalletRefunds(intentId),
    bookedWalletRefundIds: [
      ...readWalletRefundIds(data),
      ...(payment.refunds ?? []).flatMap((r) =>
        r.note?.startsWith(EXTERNAL_REFUND_NOTE_PREFIX) ? [r.note.slice(EXTERNAL_REFUND_NOTE_PREFIX.length)] : [],
      ),
    ],
    attempt,
  });
  for (const booking of bookings) await projectWalletRefund(container, paymentId, booking);
  if (attempt) await paymentModule.updatePayment({ id: paymentId, data: { refundAttempt: null } });
}

/** 주문의 결제마다 결제 잠금을 잡고 맞춘다. 부르는 쪽은 주문 잠금(orderCancelLockKey)을 쥐고 있다 */
export async function reconcileOrderWalletRefunds(container: MedusaContainer, orderId: string): Promise<void> {
  const locking = container.resolve(Modules.LOCKING);
  for (const paymentId of await orderPaymentIds(container, orderId)) {
    await locking.execute(paymentRefundLockKey(paymentId), () => reconcileWalletRefunds(container, paymentId), {
      timeout: PAYMENT_LOCK_TIMEOUT_SECONDS,
    });
  }
}
```

- [ ] **Step 5: 결제 하나에 환불 한 번 — `issue-payment-refund.ts`**

```ts
// apps/medusa/src/workflows/orders/settlement/issue-payment-refund.ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { Modules } from '@medusajs/framework/utils';
import { refundPaymentWorkflow } from '@medusajs/medusa/core-flows';

import { withManualRefund, withRefundAttempt } from '../../../modules/almond-payment/refund-data';
import type { RefundMode } from './refund-mode';

/**
 * 결제 하나에 환불 한 번(#1016 36번 재설계 §6.2·§6.3). 결제 잠금(paymentRefundLockKey) 안에서 부른다.
 * 시도 표식을 먼저 쓴다 — 응답을 잃어 실패로 끝나도 다음 장부 맞추기가 그 돈을 이 메모로 장부에 넣는다.
 * 수동이면 수동 표식도 함께 쓰고, 실패하면 수동 표식만 지운다 — 남으면 다음 «자동» 시도가 금액이 같아 MANUAL 로 샌다.
 * 오류는 그대로 던진다. 표지 붙은 NOT_ALLOWED(영구 거절)와 그 밖(일시)을 가르는 것은 부르는 쪽이다.
 */
export async function issuePaymentRefund(
  container: MedusaContainer,
  input: { paymentId: string; amount: number; note: string; mode: RefundMode; actorId?: string },
): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const fresh = await paymentModule.retrievePayment(input.paymentId, { select: ['id', 'data'] });
  const marked = withRefundAttempt(fresh.data ?? {}, { note: input.note, amount: input.amount });
  await paymentModule.updatePayment({
    id: input.paymentId,
    data: input.mode === 'manual' ? withManualRefund(marked, { requestId: input.note, amount: input.amount }) : marked,
  });
  try {
    await refundPaymentWorkflow(container).run({
      input: { payment_id: input.paymentId, amount: input.amount, created_by: input.actorId, note: input.note },
    });
  } catch (error) {
    if (input.mode === 'manual') await paymentModule.updatePayment({ id: input.paymentId, data: { manualRefund: null } });
    throw error;
  }
  await paymentModule.updatePayment({ id: input.paymentId, data: { refundAttempt: null } });
}
```

- [ ] **Step 6: 전체취소 정산 — `channel-cancel-order.ts`(#1045 에서 옮겨 고침)**

```ts
// apps/medusa/src/workflows/orders/channel-cancel/channel-cancel-order.ts
import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, MedusaError, Modules, OrderChangeStatus, OrderStatus } from '@medusajs/framework/utils';
import { cancelOrderWorkflow } from '@medusajs/medusa/core-flows';

import { paymentRefundLockKey } from '../../../modules/almond-payment/refund-data';
import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { describeError } from '../../../utils/describe-error';
import { toNumber } from '../partial-cancel/amount';
import { issuePaymentRefund } from '../settlement/issue-payment-refund';
import { orderCancelLockKey, orderPaymentIds } from '../settlement/order-payments';
import type { RefundMode } from '../settlement/refund-mode';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';

/** 맞추기 + 환불 + 취소가 넉넉히 들어가게 잡는다 — 레디스 잠금은 timeout 이 곧 만료다 */
const ORDER_LOCK_TIMEOUT_SECONDS = 120;
/** 부분취소·환불 투영과 같은 값. 이 잠금 안에서는 refundPaymentWorkflow 한 번만 돈다 */
const PAYMENT_LOCK_TIMEOUT_SECONDS = 30;

export type ChannelCancelInput = { orderId: string; refundMode: RefundMode; actorId?: string };
export type ChannelCancelResult = { orderId: string; status: 'canceled'; refund: { mode: RefundMode; amount: number } };

const refundNote = (orderId: string) => `channel-cancel:${orderId}`;

/**
 * 채널 주문 전체취소 정산(#1016 36번 재설계 스펙 §6.1). 기본 /admin/orders/:id/cancel 은 환불 오류를 삼켜(core-flows refundPaymentsStep 의
 * .catch) 환불 없이 취소하고 유령 환불 거래를 남긴다 — 여기선 «장부 맞추기 → 남은 몫 환불 → 기본 취소» 순서로 한다.
 * 취소된 주문엔 환불할 수 없으므로(크레딧 라인 단계가 돈이 나간 «뒤» 던진다, §2.2) 환불이 먼저다.
 * 다시 부르면 남은 몫만 환불하고 취소를 이어 간다.
 */
export async function channelCancelOrder(container: MedusaContainer, input: ChannelCancelInput): Promise<ChannelCancelResult> {
  const locking = container.resolve(Modules.LOCKING);
  return locking.execute(orderCancelLockKey(input.orderId), () => run(container, input), {
    timeout: ORDER_LOCK_TIMEOUT_SECONDS,
  });
}

async function run(container: MedusaContainer, input: ChannelCancelInput): Promise<ChannelCancelResult> {
  try {
    await assertCancelable(container, input.orderId);
  } catch (error) {
    // 재시도라면 사전검사가 돈이 나간 «뒤»에 도는 셈이다 — 앞 시도가 환불하고 끊긴 사이 주문 변경·출고가 생기면 여기서 400 이 나고,
    // channel-adapter 는 그것을 «취소 불가»로 읽는다(환불만 되고 출고). 이 경로로 돈이 나갔으면 500 으로 바꿔 재시도시킨다.
    // 이미 취소됨(INVALID_DATA)은 예외 — 수렴한 끝이라 channel-adapter 가 그 문장을 성공으로 읽는다
    const notAllowed = MedusaError.isMedusaError(error) && error.type === MedusaError.Types.NOT_ALLOWED;
    if (notAllowed && (await refundedHere(container, input.orderId)) > 0) {
      throw new Error(`채널 취소가 중단됐습니다 — 환불은 이미 나갔습니다, 다시 시도합니다(${input.orderId}): ${describeError(error)}`);
    }
    throw error;
  }
  try {
    // ① 빠진 wallet 환불(외부·응답 유실)을 먼저 장부에 — 그래야 ② 의 «캡처 − 환불»이 이미 나간 돈을 또 내지 않는다
    await reconcileOrderWalletRefunds(container, input.orderId);
    await refundRemaining(container, input);
    // ③ 환불할 몫이 0 이라 그 안의 환불 단계는 아무것도 하지 않는다. 크레딧 라인은 위 환불이 이미 붙였다(빈 필터 → 0, 2026-10-11 실측)
    await cancelOrderWorkflow(container).run({ input: { order_id: input.orderId, canceled_by: input.actorId } });
  } catch (error) {
    // 영구 거절 표지만 그대로 올린다(400 — 그 결제의 돈은 안 나갔다). 그 밖은 500 으로 바꿔 재시도시킨다 — 표지 없는 400 은
    // channel-adapter 가 «취소 불가»로 닫는다. 재시도는 맞추기 뒤 남은 몫만 환불한다
    if (readWalletRefundRefusal(error)) throw error;
    throw new Error(`채널 취소가 중단됐습니다 — 다시 시도합니다(${input.orderId}): ${describeError(error)}`);
  }
  return { orderId: input.orderId, status: 'canceled', refund: { mode: input.refundMode, amount: await refundedHere(container, input.orderId) } };
}

async function assertCancelable(container: MedusaContainer, orderId: string): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'status', 'fulfillments.canceled_at'],
    filters: { id: orderId },
  });
  // query.graph 의 링크 필드는 타입이 넓다 — 경계에서 필요한 칸으로만 좁힌다.
  const order = data[0] as { status?: string; fulfillments?: Array<{ canceled_at?: unknown } | null> } | undefined;
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order id not found: ${orderId}`);
  // 문장은 코어 throwIfOrderIsCancelled·cancelValidateOrder 와 같게 둔다 — channel-adapter 가 «이미 취소됨»을 이 문장으로 판정한다
  if (order.status === OrderStatus.CANCELED) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, `Order with id ${orderId} has been canceled.`);
  }
  // 환불 워크플로의 크레딧 라인 단계가 주문 변경을 만든다 — 진행 중인 변경이 있으면 거기서 실패하는데, 그때는 돈이 이미 나갔다
  const activeChanges = await container.resolve(Modules.ORDER).listOrderChanges(
    { order_id: orderId, status: [OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED] },
    { select: ['id'] },
  );
  if (activeChanges.length > 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Order with id ${orderId} has an active order change — 진행 중인 주문 변경(수정·반품·교환)을 먼저 정리해야 합니다`,
    );
  }
  if ((order.fulfillments ?? []).some((f) => f !== null && !f.canceled_at)) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'All fulfillments must be canceled before canceling an order');
  }
}

/** 이 경로(채널 취소)가 장부에 남긴 환불 합 — 메모로 가린다. 응답 유실분도 장부 맞추기가 같은 메모로 넣는다 */
async function refundedHere(container: MedusaContainer, orderId: string): Promise<number> {
  const paymentIds = await orderPaymentIds(container, orderId);
  if (paymentIds.length === 0) return 0;
  const payments = await container.resolve(Modules.PAYMENT).listPayments({ id: paymentIds }, { relations: ['refunds'] });
  return payments
    .flatMap((p) => p.refunds ?? [])
    .filter((r) => r.note === refundNote(orderId))
    .reduce((s, r) => s + toNumber(r.amount), 0);
}

/** 결제마다 «캡처 − 환불»을 돌려준다. 오류는 잡지 않는다 — run() 이 표지(400)와 그 밖(500)을 가른다 */
async function refundRemaining(container: MedusaContainer, input: ChannelCancelInput): Promise<void> {
  const paymentModule = container.resolve(Modules.PAYMENT);
  const locking = container.resolve(Modules.LOCKING);
  for (const paymentId of await orderPaymentIds(container, input.orderId)) {
    await locking.execute(
      paymentRefundLockKey(paymentId),
      async () => {
        const p = await paymentModule.retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
        if (p.canceled_at) return;
        const captured = (p.captures ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const refunded = (p.refunds ?? []).reduce((s, x) => s + toNumber(x.amount), 0);
        const amount = captured - refunded;
        if (!(amount > 0)) return;
        await issuePaymentRefund(container, {
          paymentId,
          amount,
          note: refundNote(input.orderId),
          mode: input.refundMode,
          actorId: input.actorId,
        });
      },
      { timeout: PAYMENT_LOCK_TIMEOUT_SECONDS },
    );
  }
}
```

- [ ] **Step 7: 라우트**

```ts
// apps/medusa/src/api/admin/orders/[id]/channel-cancel/route.ts
import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { channelCancelOrder } from '../../../../../workflows/orders/channel-cancel/channel-cancel-order';
import { parseRefundMode } from '../../../../../workflows/orders/settlement/refund-mode';

/**
 * 채널 주문 전체취소 정산 (#1016 36번 재설계 스펙 §6.1). channel-adapter 가 core 의 CancelChannelOrder 명령을 받아 부른다(PR 3).
 * 기본 POST /admin/orders/:id/cancel 의 «복제» — 기본 라우트는 환불 오류를 삼켜 환불 없이 취소하므로 쓰지 않는다(그건 그대로 둔다).
 * 본문 `{ refundMode?: 'auto' | 'manual' }`(없으면 auto).
 * 응답: 200 `{ orderId, status: 'canceled', refund: { mode, amount } }` · 404 not_found ·
 * 400 «Order with id … has been canceled.»(이미 취소됨 — 성공으로 읽는다) ·
 * 400 not_allowed + code `wallet_refund_refused:<code>`(영구 거절, 주문은 안 취소됨) ·
 * 그 밖 400 은 환불 전 사전 검사(진행 중인 주문 변경·안 취소된 출고)와 본문 오류(invalid_data) ·
 * 500 일시 실패 — 환불 뒤 단계의 실패도 여기로, 다시 부르면 남은 몫만 환불한다.
 * 오류는 잡지 않는다 — Medusa 에러 핸들러가 MedusaError 의 type 으로 상태를, code 를 그대로 본문에 싣는다.
 */
export const POST = async (req: AuthenticatedMedusaRequest<{ refundMode?: unknown }>, res: MedusaResponse) => {
  const refundMode = parseRefundMode(req.body?.refundMode);
  const result = await channelCancelOrder(req.scope, { orderId: req.params.id, refundMode, actorId: req.auth_context?.actor_id });
  res.status(200).json(result);
};
```

- [ ] **Step 8: 통과 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'channel-cancel-settlement'`
Expected: 전부 PASS. «동시 두 번»이 200·200 이면 주문 잠금 키를 확인한다(`orderCancelLockKey`). 맞추기 테스트가 실패하면 FakeWallet 의 `GET …/refunds` 가
불리는지 `wallet.calls` 를 찍어 본다.

- [ ] **Step 9: 회귀 — 픽스처를 쓰는 기존 통합**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'partial-cancel|wallet-refund-projection|order-edit-characterization'`
Expected: PASS (FakeWallet 확장이 기존 테스트를 바꾸지 않았다)

- [ ] **Step 10: 커밋**

```bash
git add apps/medusa/src/workflows/orders/settlement apps/medusa/src/workflows/orders/channel-cancel \
  'apps/medusa/src/api/admin/orders/[id]/channel-cancel' \
  apps/medusa/integration-tests/http/fixtures/partial-cancel-fixture.ts \
  apps/medusa/integration-tests/http/channel-cancel-settlement.spec.ts
git commit -m "feat(medusa): 채널 전체취소 정산 라우트 — 장부 맞추기 → 환불(자동/수동) → 취소 (#1016 36번 재설계 PR 2)"
```

---

### Task 5: 부분취소에 장부 맞추기·수동 환불·영구 거절 표지

**Files:**
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts`
- Modify: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/parse-input.ts`
- Test: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/__tests__/parse-input.unit.spec.ts`
- Modify: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts`
- Test: `apps/medusa/integration-tests/http/partial-cancel-settlement.spec.ts`

**Interfaces:**
- Consumes: Task 1 `readWalletRefundRefusal`·`WALLET_REFUND_REFUSED_PREFIX`; Task 3 `RefundMode`·`parseRefundMode`·`orderCancelLockKey`·`orderPaymentIds`;
  Task 4 `reconcileOrderWalletRefunds`·`issuePaymentRefund`
- Produces: `PartialCancelInput.refundMode?: RefundMode`, `PartialCancelRecord.refundMode?: RefundMode`,
  `PartialCancelResult.refund: { mode: RefundMode; amount: number }`
- Produces: `export class PartialCancelRefundRefused extends Error { readonly requestId: string; readonly refusalCode: string }`
- Produces: `PartialCancelBody.refundMode?: RefundMode` (`parse-input.ts`)

- [ ] **Step 1: 실패하는 본문 파싱 테스트**

`parse-input.unit.spec.ts` 끝(최상위 describe 안)에 더한다(`MedusaError` import 가 없으면 `@medusajs/framework/utils` 에서 더한다):

```ts
  describe('refundMode (#1016 36번 재설계 §6.1)', () => {
    const base = { requestId: 'r1', items: [{ item_id: 'i1', quantity: 1 }] };

    it('없으면 칸이 없다 — 오케스트레이터가 auto 로 읽는다', () => {
      expect(parseInput(base)).not.toHaveProperty('refundMode');
    });

    it.each(['auto', 'manual'])('%s 는 그대로', (mode) => {
      expect(parseInput({ ...base, refundMode: mode }).refundMode).toBe(mode);
    });

    it('그 밖은 INVALID_DATA', () => {
      try {
        parseInput({ ...base, refundMode: 'MANUAL' });
        throw new Error('던지지 않았다');
      } catch (e) {
        expect(MedusaError.isMedusaError(e) && e.type === MedusaError.Types.INVALID_DATA).toBe(true);
      }
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `(cd apps/medusa && npm run test:unit -- 'partial-cancel/__tests__/parse-input')`
Expected: FAIL — `refundMode` 가 `undefined`

- [ ] **Step 3: `parse-input.ts`**

```ts
import { MedusaError } from '@medusajs/framework/utils';
import { parseRefundMode, type RefundMode } from '../../../../../workflows/orders/settlement/refund-mode';

export type PartialCancelBody = {
  requestId: string;
  items: Array<{ itemId: string; quantity: number }>;
  alreadyRefunded?: number;
  /** #1016 36번 재설계 — 없으면 오케스트레이터가 auto 로 읽는다 */
  refundMode?: RefundMode;
};
```

`parseInput` 안에서 `b` 의 단언 모양에 `refundMode?: unknown` 을 더하고, return 을 바꾼다:

```ts
  return {
    requestId: b.requestId.trim(),
    items,
    ...(a !== undefined ? { alreadyRefunded: a } : {}),
    ...(b.refundMode !== undefined ? { refundMode: parseRefundMode(b.refundMode) } : {}),
  };
```

- [ ] **Step 4: 통과 확인**

Run: `(cd apps/medusa && npm run test:unit -- 'partial-cancel/__tests__/parse-input')`
Expected: PASS

- [ ] **Step 5: 실패하는 통합 테스트**

```ts
// apps/medusa/integration-tests/http/partial-cancel-settlement.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules } from '@medusajs/framework/utils';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, loadOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();
const num = (v: any) => Number(v?.numeric_ ?? v?.value ?? v);

/**
 * 부분취소 정산(#1016 36번 재설계 스펙 §6.1~§6.3, §10). 주문은 A 3개 = 90,000(조건부 무료), 1개 취소 = 30,000 환불.
 * 순서는 «수정 확정 → 환불» 그대로 — 수정 뒤 «돌려줄 돈»은 음수 차액으로 장부에 남아 의무가 사라지지 않는다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const place = () => placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
    const order = (orderId: string) => loadOrder(getContainer(), orderId);
    const balance = (o: any) => num(o.summary.pending_difference);
    const cancelOne = async (orderId: string, requestId: string, extra: Record<string, unknown> = {}) => {
      const item = (await order(orderId)).items[0].id;
      return api
        .post(`/admin/orders/${orderId}/partial-cancel`, { requestId, items: [{ item_id: item, quantity: 1 }], ...extra }, c.adminHeaders)
        .catch((e: any) => e.response);
    };
    const ledger = async (orderId: string) => {
      const paymentId = (await order(orderId)).payment_collections[0].payments[0].id as string;
      const p = await getContainer().resolve(Modules.PAYMENT).retrievePayment(paymentId, { relations: ['captures', 'refunds'] });
      return {
        captured: (p.captures ?? []).reduce((s: number, x: any) => s + num(x.amount), 0),
        refunds: (p.refunds ?? []).map((r: any) => ({ amount: num(r.amount), note: r.note })),
      };
    };

    it('영구 거절: 수정은 확정된 채 400 표지(stage edited) — 음수 차액이 의무를 들고 있고, 원인이 풀리면 같은 호출이 끝낸다', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', message: 'wallet 원문', retryable: false };
      const refused = await cancelOne(orderId, 'ps-1');
      expect(refused.status).toBe(400);
      expect(refused.data).toEqual({
        type: 'not_allowed',
        code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE',
        stage: 'edited',
        requestId: 'ps-1',
        message: 'wallet 원문',
      });
      const mid = await order(orderId);
      expect(mid.metadata.partialCancels['ps-1'].stage).toBe('edited');
      expect(balance(mid)).toBe(-30000);
      expect((await ledger(orderId)).refunds).toEqual([]);

      const done = await cancelOne(orderId, 'ps-1');
      expect(done.status).toBe(200);
      expect(done.data).toEqual(
        expect.objectContaining({ requestId: 'ps-1', stage: 'refunded', refundAmount: 30000, refund: { mode: 'auto', amount: 30000 } }),
      );
      const after = await order(orderId);
      expect(after.version).toBe(mid.version);
      expect(balance(after)).toBe(0);
      expect(wallet.refunds.map((r) => r.amount)).toEqual([30000]);
    });

    it('영구 거절: 200 의 FAILED 행(retryable false)은 토스 문장을 그대로', async () => {
      const { orderId } = await place();
      wallet.failNextRefundAs200Failed = { failureCode: 'NOT_CANCELABLE_AMOUNT', retryable: false, message: '취소 할 수 없는 금액 입니다.' };
      const res = await cancelOne(orderId, 'ps-2');
      expect(res.status).toBe(400);
      expect(res.data).toEqual(
        expect.objectContaining({ code: 'wallet_refund_refused:NOT_CANCELABLE_AMOUNT', stage: 'edited', message: '취소 할 수 없는 금액 입니다.' }),
      );
    });

    it('일시 실패는 옛 모양 그대로 502 refund_pending — 옛 channel-adapter 가 읽는다', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', retryable: true };
      const res = await cancelOne(orderId, 'ps-3');
      expect(res.status).toBe(502);
      expect(res.data).toEqual(expect.objectContaining({ type: 'refund_pending', stage: 'edited', requestId: 'ps-3' }));
    });

    it('응답을 잃은 환불은 다시 나가지 않는다 — 장부 맞추기가 이 요청의 메모로 넣는다', async () => {
      const { orderId } = await place();
      wallet.loseNextRefundResponse = true;
      expect((await cancelOne(orderId, 'ps-4')).status).toBe(502);
      expect(wallet.refunds).toHaveLength(1);
      expect((await ledger(orderId)).refunds).toEqual([]);

      const res = await cancelOne(orderId, 'ps-4');
      expect(res.status).toBe(200);
      expect(res.data.refund).toEqual({ mode: 'auto', amount: 30000 });
      expect(wallet.refundCalls()).toHaveLength(1);
      expect((await ledger(orderId)).refunds).toEqual([{ amount: 30000, note: 'partial-cancel:ps-4' }]);
      expect(balance(await order(orderId))).toBe(0);
    });

    it('자동 거절 뒤 같은 requestId 를 수동으로 → 다른 요청으로 막지 않고 송금 대기로 끝낸다, 다시 불러도 한 줄', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
      expect((await cancelOne(orderId, 'ps-5')).status).toBe(400);

      const res = await cancelOne(orderId, 'ps-5', { refundMode: 'manual' });
      expect(res.status).toBe(200);
      expect(res.data.refund).toEqual({ mode: 'manual', amount: 30000 });
      expect(wallet.refunds).toEqual([expect.objectContaining({ amount: 30000, status: 'PENDING', execution: 'MANUAL' })]);
      expect(balance(await order(orderId))).toBe(0);

      const again = await cancelOne(orderId, 'ps-5', { refundMode: 'manual' });
      expect(again.status).toBe(200);
      expect(again.data).toEqual(res.data);
      expect(wallet.refunds).toHaveLength(1);
    });

    it('투영 안 된 외부 환불이 있으면 새 부분취소는 수정 «전»에 «이미 환불한 금액»을 묻는다(37번) — 장부엔 그 환불이 들어간다', async () => {
      const { orderId, intentId } = await place();
      const ext = wallet.addExternalRefund(intentId, 10000);
      const res = await cancelOne(orderId, 'ps-6');
      expect(res.status).toBe(400);
      expect(res.data.code).toBe('partial_cancel_rejected');
      expect(res.data.reason).toMatch(/^external_refund_/);
      const o = await order(orderId);
      expect(o.metadata?.partialCancels?.['ps-6']).toBeUndefined();
      expect(num(o.items[0].quantity)).toBe(3);
      expect((await ledger(orderId)).refunds).toEqual([{ amount: 10000, note: `wallet:${ext.id}` }]);
      expect(wallet.refundCalls()).toHaveLength(0);
    });

    it('부분취소가 막힌 채 전체취소가 오면 남은 몫을 전부 돌려주고 취소한다(스펙 §7.3 superseded 의 Medusa 쪽)', async () => {
      const { orderId } = await place();
      wallet.rejectNextRefundWith = { status: 400, error: 'REFUND_NOT_AUTOMATABLE', retryable: false };
      expect((await cancelOne(orderId, 'ps-7')).status).toBe(400);
      const { captured } = await ledger(orderId);
      const full = await api.post(`/admin/orders/${orderId}/channel-cancel`, {}, c.adminHeaders).catch((e: any) => e.response);
      expect(full.status).toBe(200);
      expect(full.data.refund).toEqual({ mode: 'auto', amount: captured });
      expect(wallet.refunds.map((r) => r.amount)).toEqual([captured]);
      const o = await order(orderId);
      expect(o.status).toBe('canceled');
      // 0 이 아니면 멈추고 보고한다 — 스펙 §3-2(돌려줄 돈은 장부에서 사라지지 않는다)의 반례일 수 있다
      expect(balance(o)).toBe(0);
    });
  },
});
```

- [ ] **Step 6: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'partial-cancel-settlement'`
Expected: FAIL — 영구 거절이 502 `refund_pending`, `refund` 칸 없음, 응답 유실 재시도가 wallet 을 두 번 부름, 외부 환불 테스트가 200

- [ ] **Step 7: 오케스트레이터 고침**

`partial-cancel-order.ts`:

1. import 를 고친다 — `@medusajs/medusa/core-flows` import 목록에서 `refundPaymentWorkflow` 를 뺀다(이 파일의 쓰임은 `refund()` 하나다 — `grep -n refundPaymentWorkflow` 로 확인). 더한다:

```ts
import { readWalletRefundRefusal } from '../../../modules/almond-payment/wallet-refund-refusal';
import { issuePaymentRefund } from '../settlement/issue-payment-refund';
import type { RefundMode } from '../settlement/refund-mode';
import { reconcileOrderWalletRefunds } from '../settlement/wallet-refund-ledger';
```

2. 타입:

```ts
export type PartialCancelInput = {
  orderId: string;
  requestId: string;
  items: CancelRequestItem[];
  /** 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 품목에 연결 안 된 외부 환불이 있을 때 필요하다(#1016 37번) */
  alreadyRefunded?: number;
  /** 없으면 auto(#1016 36번 재설계). 요청 해시에 넣지 않는다 — 자동 거절 뒤 같은 요청을 수동으로 다시 보낸다 */
  refundMode?: RefundMode;
  actorId?: string;
};
```

`PartialCancelRecord` 의 `refundedAt?: string;` 아래에:

```ts
  /** 환불을 끝낸 방식 — refunded 때 쓴다. 옛 기록엔 없다(auto) */
  refundMode?: RefundMode;
```

`PartialCancelResult` 의 `stage: 'refunded';` 위에:

```ts
  /** 채널 전체취소 200 과 같은 칸(#1016 36번 재설계) */
  refund: { mode: RefundMode; amount: number };
```

3. `PartialCancelRefundPending` 클래스 아래에:

```ts
/**
 * 주문 수정은 확정됐는데 wallet 이 환불을 영구 거절했다(retryable: false, #1016 36번 재설계 §6.1). 의무는 장부의 음수 차액에 남는다.
 * 원인이 풀리거나 수동(refundMode manual)으로 같은 requestId 를 다시 부르면 환불부터 이어 간다.
 * PartialCancelRejected 를 상속하지 않는다 — 그건 «정해진 거절»(partial_cancel_rejected)이고 이건 수정이 끝난 뒤의 돈 문제다.
 */
export class PartialCancelRefundRefused extends Error {
  constructor(
    readonly requestId: string,
    readonly refusalCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PartialCancelRefundRefused';
  }
}
```

4. `run()` 을 이것으로 바꾼다:

```ts
async function run(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const requestHash = hashRequest(input.items, input.alreadyRefunded);
  let order = await loadOrder(container, input.orderId);
  const existing = readRecords(order.metadata)[input.requestId];
  if (existing && existing.requestHash !== requestHash) {
    throw new PartialCancelRejected(`같은 requestId 로 다른 요청이 왔습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded') return toResult(input.requestId, existing);
  const mode = input.refundMode ?? 'auto';

  if (!existing) {
    // ① 새 요청은 수정 «전»에 장부를 맞춘다 — 37번 판정(assertExternalRefundsResolved)이 투영 안 된 외부 환불까지 보게.
    // 맞추기가 넣은 환불은 차액을 움직이므로, 수정 전후 차액(owed)에 섞이지 않게 주문을 다시 읽는다. 실패하면 아무것도 안 바꾼 채 500
    await reconcileOrderWalletRefunds(container, input.orderId);
    order = await loadOrder(container, input.orderId);
  }
  const record = existing ?? (await edit(container, input, order, requestHash));

  try {
    // 수정은 확정됐다 — 여기부터의 실패는 refund_pending(재시도) 또는 영구 거절 표지(400, stage edited)다
    if (existing) await reconcileOrderWalletRefunds(container, input.orderId);
    // 상계 라인을 환불보다 «먼저» 넣는다 — 그래야 환불 뒤 차액이 0 이고, refundPaymentWorkflow 가 배송비 몫만 양수 라인으로 붙인다
    await offsetExternalRefund(container, input.orderId, input.requestId, record.externalRefundApplied ?? 0);
    await refund(container, input.orderId, input.requestId, record.refundAmount, mode, input.actorId);
  } catch (error) {
    const refusal = readWalletRefundRefusal(error);
    if (refusal) throw new PartialCancelRefundRefused(input.requestId, refusal.code, refusal.message);
    throw new PartialCancelRefundPending(input.requestId, `부분취소 환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`);
  }
  const done: PartialCancelRecord = { ...record, stage: 'refunded', refundedAt: new Date().toISOString(), refundMode: mode };
  await writeRecord(container, input.orderId, input.requestId, done);
  return toResult(input.requestId, done);
}
```

5. `refund()` 의 시그니처와 안쪽 호출을 바꾼다(주석의 첫 줄 아래에 «시도·수동 표식은 issuePaymentRefund 가 쓴다» 한 줄을 더한다):

```ts
async function refund(
  container: MedusaContainer,
  orderId: string,
  requestId: string,
  amount: number,
  mode: RefundMode,
  actorId?: string,
) {
```

잠금 안의 `await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount: take, created_by: actorId, note } });` 를:

```ts
        await issuePaymentRefund(container, { paymentId, amount: take, note, mode, actorId });
```

6. `toResult` 를 바꾼다:

```ts
const toResult = (requestId: string, r: PartialCancelRecord): PartialCancelResult => ({
  requestId,
  refundAmount: r.refundAmount,
  shippingDelta: r.shippingCharge - r.shippingRefund,
  shippingNotAdjusted: r.shippingNotAdjusted,
  externalRefundApplied: r.externalRefundApplied ?? 0,
  refund: { mode: r.refundMode ?? 'auto', amount: r.refundAmount },
  stage: 'refunded',
});
```

- [ ] **Step 8: 라우트 고침**

`route.ts`:

```ts
import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { WALLET_REFUND_REFUSED_PREFIX } from '../../../../../modules/almond-payment/wallet-refund-refusal';
import {
  partialCancelOrder,
  PartialCancelRefundPending,
  PartialCancelRefundRefused,
} from '../../../../../workflows/orders/partial-cancel/partial-cancel-order';
```

doc 주석의 응답 계약 문단에 한 줄 더한다:
`* 400 code=wallet_refund_refused:<code> + stage edited = 수정은 확정됐고 wallet 이 환불을 영구 거절(#1016 36번 재설계). 같은 requestId 로 다시(또는 refundMode manual) 부르면 환불부터 이어 간다.`

`parseInput` 결과 분해와 호출을 바꾼다:

```ts
  const { requestId, items, alreadyRefunded, refundMode } = parseInput(req.body);
  try {
    const result = await partialCancelOrder(req.scope, {
      orderId: req.params.id,
      requestId,
      items,
      ...(alreadyRefunded !== undefined ? { alreadyRefunded } : {}),
      ...(refundMode !== undefined ? { refundMode } : {}),
      actorId: req.auth_context?.actor_id,
    });
```

`if (error instanceof PartialCancelRefundPending) { … }` **위**에:

```ts
    if (error instanceof PartialCancelRefundRefused) {
      // 표지는 전체취소(channel-cancel)와 같다. 수정은 확정된 채라 의무는 장부의 음수 차액에 남는다
      res.status(400).json({
        type: 'not_allowed',
        code: `${WALLET_REFUND_REFUSED_PREFIX}${error.refusalCode}`,
        stage: 'edited',
        requestId: error.requestId,
        message: error.message,
      });
      return;
    }
```

- [ ] **Step 9: 통과 확인 — 새 스펙과 기존 부분취소 스펙**

Run:
```bash
scripts/local/run-medusa-integration.sh --testPathPattern 'partial-cancel-settlement'
scripts/local/run-medusa-integration.sh --testPathPattern 'partial-cancel.spec|channel-cancel-settlement'
```
Expected: 전부 PASS. 기존 `partial-cancel.spec.ts` 의 «같은 requestId 로 다시 부르면 같은 결과»(`toEqual(first)`)·«라우트: … 502 refund_pending»·
«환불은 냈는데 기록 전에 끊겼다면»이 그대로 통과해야 한다. «전체취소» 테스트의 차액이 0 이 아니면 멈추고 관측값과 함께 보고한다.

- [ ] **Step 10: 커밋**

```bash
git add apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts \
  'apps/medusa/src/api/admin/orders/[id]/partial-cancel' \
  apps/medusa/integration-tests/http/partial-cancel-settlement.spec.ts
git commit -m "feat(medusa): 부분취소 정산 — 장부 맞추기·수동 환불·영구 거절 400 표지 (#1016 36번 재설계 PR 2)"
```

---

### Task 6: 문서·게이트·PR

**Files:**
- Modify: `apps/medusa/src/modules/almond-payment/README.md` («refundPayment 규약 (ADR-0042)» 절)

**Interfaces:**
- Consumes: Task 1~5

- [ ] **Step 1: README 규약 갱신**

«refundPayment 규약 (ADR-0042)» 절의 **Idempotency-Key** 줄을 바꾸고, 절 끝에 세 줄을 더한다:

```markdown
- **Idempotency-Key**: `medusa-refund:<context.idempotency_key>`(= Medusa refund 행 id). 한계 — provider 호출이 실패하면 Medusa 가 refund 행을 지우므로, wallet 은 환불했는데 응답만 유실된 경우 재시도는 새 키로 나간다. 정산 라우트는 그 전에 **장부 맞추기**(아래)로 유실분을 장부에 넣어 막는다. 그 밖의 경로(대시보드 환불)의 방어선은 여전히 wallet 환불가능액 검사다.
- **wallet 오류 번역(#1016 36번 재설계 §6.4)**: `walletFetch` 는 `WalletHttpError { status, walletCode, walletMessage, retryable? }` 를 던진다(속성을 `code` 로 두지 않는다 — `formatException` 이 Postgres 코드로 읽는다). 4xx 본문이나 200 의 FAILED 행이 `retryable: false` 면 `MedusaError(NOT_ALLOWED, <wallet 문장>, 'wallet_refund_refused:<code>')`, 그 밖은 일시(그대로 던짐). 분류의 정본은 wallet 이다(`apps/wallet/src/refunds/refund-refusal.ts`).
- **`manualRefund` 표식**: `{ requestId, amount }` 가 있고 금액이 같으면 wallet 에 `execution: 'MANUAL'`(외부 결제 몫은 송금 대기 PENDING)로 요청하고 표식을 `null` 로 지운다. 붙이고·실패 때 지우는 것은 정산(`workflows/orders/settlement/issue-payment-refund.ts`)이다.
- **`refundAttempt` 표식과 장부 맞추기**: 정산은 환불 직전 `{ note, amount }` 시도 표식을 쓰고 성공하면 지운다. 정산 직전 장부 맞추기(`workflows/orders/settlement/wallet-refund-ledger.ts`)가 wallet 환불 목록(`GET /v1/payment-intents/:id/refunds`)에서 장부에 없는 SUCCEEDED·PENDING 을 `externalRefund` 투영으로 넣는다 — 장부에 없는 MEDUSA_REFUND(응답 유실)는 시도 표식이 남아 있으면 그 메모로, 아니면 `wallet:<id>` 로. 웹훅 투영은 MEDUSA_REFUND 를 여전히 넣지 않는다(provider 가 id 를 쓰기 전에 사실이 오는 정상 경합 때문).
```

«결제 잠금» 줄의 «wallet 환불 투영(`api/hooks/payment-events`)과 부분취소 오케스트레이터가 같은 키를 쓴다» 를
«wallet 환불 투영(`api/hooks/payment-events`)·장부 맞추기·정산 라우트(부분취소·채널 전체취소)가 같은 키를 쓴다. 주문 잠금(`orderCancelLockKey`) 안에서 결제 잠금을 잡는다 — 순서는 늘 주문 → 결제» 로 바꾼다.

- [ ] **Step 2: Medusa 게이트**

Run:
```bash
npm run test:medusa 2>&1 | tail -6
(cd apps/medusa && npx tsc --noEmit 2>&1 | grep 'error TS')
scripts/local/run-medusa-integration.sh
scripts/local/run-medusa-integration.sh --modules
```
Expected: 유닛 실패 0. tsc 에러 수가 **실행 준비의 기준선과 같고**, 목록에 이 PR 이 건드린 파일(`almond-payment/`·`settlement/`·`channel-cancel/`·`partial-cancel/`·`payment-events/`)이 없다.
HTTP 통합 전부 PASS(새 스펙 둘 포함), 모듈 통합 전부 PASS. 숫자(suites/tests)를 PR 본문에 적는다.

- [ ] **Step 3: 루트 게이트(CI 가 PR 마다 돈다)**

Run:
```bash
npm run type-check
npx jest --maxWorkers=2
```
Expected: 둘 다 0. 이 PR 은 `apps/medusa` 만 바꾸고 루트 게이트는 `apps/medusa` 를 제외하므로 바뀌지 않아야 한다 — 빨가면 환경(심볼링크)부터 의심한다.

- [ ] **Step 4: 메인 오염 확인**

Run:
```bash
git -C /home/pauseb/workspace/almondyoung-server status --short
git -C /home/pauseb/workspace/almondyoung-server rev-parse develop origin/develop
```
Expected: status 는 `M web/almondyoung-storefront/yarn.lock` 한 줄(남의 것)뿐. develop 과 origin/develop 이 같은 해시.

- [ ] **Step 5: 커밋·push·PR**

```bash
git add apps/medusa/src/modules/almond-payment/README.md
git commit -m "docs(medusa): almond-payment 규약 — 오류 번역·수동 표식·시도 표식·장부 맞추기 (#1016 36번 재설계 PR 2)"
git push -u origin feat/1016-36-medusa-settlement
gh pr create --base develop --title "feat(medusa): 채널 취소 정산 라우트 둘 — 장부 맞추기·수동 환불·거절 번역 (#1016 36번 재설계 PR 2)" --body-file <본문 파일>
```

본문(세션 스크래치패드에 쓰고 `--body-file` 로 넘긴다):

```markdown
## 무엇
채널 취소 정산 재설계(스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` §6.1~§6.4)의 Medusa 몫.

- `POST /admin/orders/:id/channel-cancel`(새, 기본 `/cancel` 의 «복제») — 주문 잠금 → 검증 → 장부 맞추기 → 남은 몫 환불 → 기본 취소. 200 `{ orderId, status, refund: { mode, amount } }`
- `POST /admin/orders/:id/partial-cancel` — 같은 맞추기·환불 부품. 영구 거절은 400 `wallet_refund_refused:<code>` + `stage: edited`. 그 밖 응답은 옛 모양 그대로(+ 200 에 `refund` 칸)
- 본문 `refundMode: 'auto' | 'manual'` — 수동은 wallet `execution: 'MANUAL'`(외부 결제 몫 송금 대기)
- 장부 맞추기 — wallet 환불 목록(#1048)에서 장부에 없는 SUCCEEDED·PENDING 을 기존 투영 경로로. 응답 유실 MEDUSA_REFUND 도 넣는다(시도 표식이 있으면 그 요청 메모로)
- almond-payment — `WalletHttpError`, `retryable: false`(4xx·200 FAILED)만 표지 붙은 NOT_ALLOWED
- 웹훅 투영 함수를 뽑아 장부 맞추기와 함께 쓴다(동작 같음)
- 특성 테스트 — 기본 `/cancel` 은 wallet 거절에도 200 + canceled + Refund 0 + 환불 거래 −X(유령). Medusa 업그레이드 경보

#1045(닫힘)에서 라우트 뼈대·`assertCancelable`·`WalletHttpError`·FakeWallet 틀·특성 테스트를 옮기고, `classifyWalletRefundRefusal` 두 갈래·부분취소 502 `refundFailure` 본문은 버렸다.

## 스펙과 다른 점 · 계획이 정한 곳
(계획 `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr2-medusa.md` 의 D1~D7 표를 옮긴다)

## 혼자 나가도 휴면
`channel-cancel` 은 부르는 쪽이 없다(PR 3). 부분취소는 옛 channel-adapter 가 부른다 — 200·400 `partial_cancel_rejected`·502 `refund_pending` 모양은 그대로.
**롤링 창의 차이 하나:** wallet 영구 거절이 502 → 400 표지가 된다. 옛 adapter 는 그 400 을 던져 재시도하고 정체 사실을 내지 않는다(오늘은 502 + 정체 사실).
라이브 부분취소 기록 0(스펙 §2.3).

## 배포
마이그레이션 없음. **전제: wallet #1048 이 라이브여야 한다**(목록 API 가 없으면 정산이 전부 500). PR 2 와 PR 3 사이에 배포 한 번.
배포 전 대기 마이그레이션 대조는 평소대로(남이 머지한 마이그도 함께 실린다).

## 검증
`npm run test:medusa` (n suites / n tests) · `apps/medusa` tsc 기준선과 같음(n) · HTTP 통합 (n suites / n tests) · 모듈 통합 (n / n) · 루트 `type-check` 0 · `npx jest` 0

## 범위 밖 · 알려진 한계
- **응답 없는 PG 호출(`PROVIDER_EXCEPTION`)은 일시다**(PR 1 #1048 의 한계 그대로). 토스가 실제로 처리했는데 응답만 잃었으면 wallet 행은 FAILED 라 장부 맞추기가 넣지 않고,
  재시도가 부분환불을 두 번 낼 수 있다. 닫으려면 토스 결제 조회 단계가 필요하다
- **대시보드 환불과 맞추기의 경합:** 결제 잠금 밖의 대시보드 환불이 wallet 에서 끝났는데 provider 가 id 를 쓰기 전에 맞추기가 돌면 그 환불을 외부로 한 번 더 장부에 넣는다
  (장부가 «더 환불함» 쪽으로 틀려 과소 환불). PR 6 미들웨어가 취소된 주문의 기본 환불을 막는다
- 시도 표식이 남은 채 다른 경로의 응답 유실 MEDUSA_REFUND 가 있으면 표식 금액까지 그 요청 몫으로 센다(과소 환불 쪽)
- 대시보드 기본 `/cancel`·환불 차단 미들웨어(스펙 §6.6)는 PR 6

https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
```

머지는 사용자가 한다(`! gh pr merge <번호> --squash` — `gh pr merge` 는 권한 분류기가 막는다).

---

## 범위 밖 · 알려진 한계

- **`PROVIDER_EXCEPTION` 부분환불 이중 송금 구멍**(PR 1 본문 «알려진 한계» 그대로) — wallet 은 응답이 끊긴 PG 호출을 `PROVIDER_EXCEPTION`·`retryable: true` FAILED 행으로 둔다.
  장부 맞추기는 FAILED 를 넣지 않으므로 토스가 실제로 처리했다면 재시도가 부분환불을 또 낸다. 토스 결제 조회로 확인하는 단계가 필요하다 — 이 PR 밖
- 대시보드 환불 ↔ 맞추기 경합, 남은 시도 표식의 과귀속 — PR 본문 그대로
- 대시보드 기본 `/cancel`·`/payments/:id/refund` 차단(§6.6) — PR 6(channel-adapter 전환 뒤)
- 다중 결제에서 앞 결제는 환불되고 뒤 결제가 영구 거절이면 400 이 나간다(돈 일부는 나감). 다음 정산(재시도·수동)이 맞추기로 앞 것을 보고 남은 몫만 낸다 — 스펙 §6.4 그대로

## 머지 뒤

- 배포: 마이그레이션 없음, `sst deploy`. **#1048 이 이미 라이브인지 먼저 확인한다**
- PR 3(계약 + channel-adapter) 계획은 새 세션에서 — 이 PR 의 응답(200 `refund`·400 `wallet_refund_refused:*`·500·502 `refund_pending`)과 `refundMode` 본문을 소비한다
- #1016 반영·메모리 갱신은 사용자 확인 뒤(본문 수정, 코멘트 금지)
