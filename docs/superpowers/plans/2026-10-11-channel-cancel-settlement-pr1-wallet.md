# PR 1 — wallet: 환불 목록·실패 분류·수동 실행 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채널 취소 정산(PR 2~5)이 쓸 wallet 능력 넷 — 환불 목록 API, 영구/일시 실패 분류(`retryable`), 수동 실행(`execution: MANUAL`), 송금 완료
일반화 — 을 «아무도 안 부르면 지금과 똑같이» 동작하게 더한다.

**Architecture:** `refunds` 에 `execution`(enum, 기본 `AUTO`)·`failure_code`·`failure_retryable` 칸을 더한다(additive). 실패의 영구/일시
판정은 두 군데서 난다 — provider 가 FAILED 를 낼 때(`RefundResult.retryable`, 토스 코드표는 토스 provider 옆)와 wallet 이 요청을 4xx 로
거절할 때(`refundRefusal()` 표) — 둘 다 «모르면 `true`»다. 수동 실행은 `createByIntent` 의 계획(남은 금액 비례·외부 먼저·포인트 마지막)을
그대로 쓰고, 외부 결제 몫만 provider 를 부르지 않고 `PENDING`+`MANUAL` 행으로 남긴다. 송금 완료(`confirmManual`)는 «무통장이거나
`MANUAL` 행»이면 받는다 — 이 규칙은 순수 함수 하나(`isManuallyConfirmable`)가 갖고 관리자 상세의 `manualConfirmable` 도 같은 함수를 쓴다.

**Tech Stack:** NestJS(Fastify), Drizzle(postgres.js), drizzle-kit, class-validator, Jest(ts-jest transpile-only), 실 Postgres 통합 스펙(`describeIfDb`).

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` — §2.3, §6.2, §6.3, §6.4, **§6.5**, §9.2 의 1, §10 wallet.
전례 계획: `docs/superpowers/plans/2026-10-11-channel-cancel-settlement-pr0-point-refund-leg.md`.

## Global Constraints

- **혼자 나가도 휴면**(스펙 §9.2 의 1): 아무도 `execution: 'MANUAL'` 을 보내지 않으면 환불 동작은 지금과 같다. 새 응답 칸은 옛 호출자가 무시해도 된다
- **4xx 거절 본문의 `error`·`message` 는 옛 값 그대로**(문자열, 같은 코드). core `WalletRefundClient` 가 `body.error` 로
  `REFUND_AMOUNT_EXCEEDS_AVAILABLE`·`REFUND_AMOUNT_EXCEEDS_TOTAL` 을 `already_refunded` 로 읽는다(`apps/core/src/modules/sales-order/services/wallet-refund.client.ts`). 새 칸은 `retryable` 하나만 더한다
- 모르는 실패 코드·없는 `retryable` = **`true`(일시)**(스펙 §6.5 — 재시도 쪽이 안전, 사람이 «지연»으로 본다)
- 마이그레이션: `refunds` 에 `execution`·`failure_code`·`failure_retryable` — additive, **`migrate → deploy`**(CLAUDE.md «Expand phase»)
- 생성은 `npm run db:generate:wallet -- --name add-refund-execution-and-failure`. 생성 SQL 에 이 셋 밖의 문장(특히 이미 있는 테이블의 `CREATE TABLE`)이
  나오면 멈춘다 — wallet 스냅샷 체인 사고의 재발 신호다(메모리 `wallet-drizzle-snapshot-chain-broken`)
- 서비스 코드에 `any`·`as` 를 새로 들이지 않는다(CLAUDE.md «Type Safety»). 스펙 파일의 목 캐스팅은 기존 관례대로 허용
- wallet 은 전역 예외 필터가 없고 Nest 예외(`BadRequestException({ error, message })`)를 쓴다 — 주변 코드 관례를 따른다(`@app/shared` 도메인 예외로 바꾸지 않는다)
- 스펙 안에서 `dotenv.config()` 금지. DB 스펙은 `describeIfDb` + `REQUIRE_WALLET_DB=1`(CLAUDE.md «검증 게이트»)
- 기존 결제·환불 건은 이미 처리된 것으로 간주한다 — 소급 분류·백필 없음(옛 FAILED 행의 `failure_*` 는 `null` 로 남는다)
- 게이트: `npm run type-check` 0 · `npx jest` 0

## Review Focus

- **옛 호출자(core `WalletRefundClient`)가 4xx 본문을 읽는 방식** — `error` 가 문자열 코드, `message` 가 문자열이어야 `REFUND_AMOUNT_EXCEEDS_*` →
  `already_refunded` 분기가 산다. Task 3 의 «core 가 읽는 두 코드» 스펙과 서비스 거절 본문 `toEqual` 테스트가 지킨다.
- **자동 환불 못 하는 수단(효성 CMS)에 `MANUAL`** — 스펙 §10 스모크 S1·S2 의 경로다. 지금 AUTO 는 계획 단계에서 400 `REFUND_NOT_AUTOMATABLE` 로
  막는데, MANUAL 에선 그 검사를 건너뛰어야 송금 대기가 생긴다. Task 4 단위 테스트와 Task 7 통합 테스트가 지킨다.
- **`MANUAL` 무통장에 `refundReceiveAccount` 가 같이 와도 토스를 부르지 않는다** — 계좌가 있으면 지금 AUTO 는 토스 송금을 부른다. 수동은 «사람이
  송금한다»이므로 provider 를 아예 안 부른다. Task 4 의 «MANUAL 은 provider 를 부르지 않는다(무통장+계좌)» 테스트가 지킨다.
- **같은 `MANUAL` 요청이 두 번 오면 송금 대기가 두 줄 생기면 안 된다** — PENDING 은 남은 금액에서 빠지므로 두 번째는 400
  `REFUND_AMOUNT_EXCEEDS_TOTAL`(`retryable: true`)이어야 한다(리컨실러 재발행의 전제는 Medusa 장부 맞추기가 이 PENDING 을 먼저 보는 것, 스펙 §6.2).
  Task 7 통합 테스트가 지킨다.
- **분류 전 옛 FAILED 행** — `failure_code`·`failure_retryable` 가 `null` 이다. 응답의 `failureCode`·`retryable` 도 `null` 로 나가야 하고(지어내지 않는다)
  호출자는 «없음 = 일시»로 읽는다. Task 1 의 매퍼 테스트가 지킨다.

---

## 실행 준비 (태스크 전에 한 번)

PR 0 **#1047** 이 같은 파일(`refunds.service.ts`·`payment-provider.interface.ts`·`points.provider.ts`)을 건드린다. 상태를 보고 바탕을 고른다.

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin
gh pr view 1047 --json state,mergedAt
# OPEN 이면 — PR 0 브랜치 위에 쌓고 PR base 를 그 브랜치로 둔다
git worktree add .claude/worktrees/feat-1016-36-wallet-settlement -b feat/1016-36-wallet-settlement origin/fix/1016-36-point-refund-leg
# MERGED 면 — develop 에서
# git worktree add .claude/worktrees/feat-1016-36-wallet-settlement -b feat/1016-36-wallet-settlement origin/develop
ln -s /home/pauseb/workspace/almondyoung-server/node_modules /home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1016-36-wallet-settlement/node_modules
```

이후 **모든 명령은 워크트리**(`/home/pauseb/workspace/almondyoung-server/.claude/worktrees/feat-1016-36-wallet-settlement`)에서 돈다. npm·jest·tsc·drizzle-kit
모두 심볼링크로 동작한다. 메인 체크아웃의 `web/almondyoung-storefront/yarn.lock` 변경은 남의 것이다 — 건드리지 않는다.

서브에이전트로 실행하면 dispatch 첫 줄에: `cd <워크트리>` → `git rev-parse --show-toplevel && git branch --show-current` → 기대값
(`…/feat-1016-36-wallet-settlement`, `feat/1016-36-wallet-settlement`)과 다르면 STOP, 특히 `develop` 이면 멈춘다. 커밋 전 두 명령의 출력을 보고서에 넣는다.
태스크마다 `git -C /home/pauseb/workspace/almondyoung-server status --short` 와 `rev-parse develop origin/develop` 로 메인 오염을 확인한다
(메모리 `subagent-worktree-contamination`).

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| Modify `apps/wallet/src/schema.ts` | `refundExecutionEnum`, `refunds.execution`·`failureCode`·`failureRetryable`, `RefundExecution` 타입 |
| Create `apps/wallet/drizzle/<timestamp>_add-refund-execution-and-failure.sql` (+ `meta/`) | 생성 마이그레이션 |
| Modify `apps/wallet/src/refunds/dto/index.ts` | `RefundResponseDto` 새 칸 셋, `RefundListItemDto` |
| Create `apps/wallet/src/refunds/refund-response.ts` (+ `.spec.ts`) | 환불 행 → 응답 매퍼 둘(`toRefundResponse`·`toRefundListItem`) |
| Modify `apps/wallet/src/refunds/refunds.controller.ts`, `apps/wallet/src/payment-intents/payment-intents.controller.ts` | 매퍼 사용, 목록 라우트 |
| Modify `apps/wallet/src/admin/payment-intent-admin.service.ts` | 상세·목록 응답 새 칸, `manualConfirmable` 규칙 |
| Modify `apps/wallet/src/providers/payment-provider.interface.ts` | `RefundResult.retryable?` |
| Create `apps/wallet/src/providers/toss/toss-refund-errors.ts` (+ `.spec.ts`) | 토스 결제 취소 오류 코드표 |
| Modify `toss.provider.ts`·`toss-billing.provider.ts`·`bank-transfer.provider.ts`·`cms/cms-batch.provider.ts`·`points/points.provider.ts` | FAILED 에 `retryable` |
| Create `apps/wallet/src/refunds/refund-refusal.ts` (+ `.spec.ts`) | wallet 자체 거절 코드표와 본문 |
| Modify `apps/wallet/src/refunds/refunds.service.ts` | 거절 본문, FAILED 행 분류 저장, 수동 실행, 송금 완료 일반화, `listByIntent` |
| Create `apps/wallet/src/refunds/manual-confirmable.ts` (+ `.spec.ts`) | «송금 완료를 받을 수 있는 행인가» 순수 함수 |
| Modify `apps/wallet/src/payment-intents/dto/index.ts` | `RefundByIntentDto.execution?` |
| Modify `apps/wallet/src/admin/refund-admin.controller.ts` | `HttpException` 은 그대로 통과 |
| Create `apps/wallet/src/refunds/refund-settlement.integration.spec.ts` | 실 Postgres 전 흐름 |
| Modify `apps/wallet/CLAUDE.md` | 실패 분류·수동 실행 규칙 |

---

### Task 1: 스키마·마이그레이션과 응답 칸

**Files:**
- Modify: `apps/wallet/src/schema.ts` (`refundStatusEnum` 아래, `refunds` 테이블, 타입 export 구역)
- Create: `apps/wallet/drizzle/<timestamp>_add-refund-execution-and-failure.sql`, `apps/wallet/drizzle/meta/*` (생성물)
- Modify: `apps/wallet/src/refunds/dto/index.ts` (`RefundResponseDto`)
- Create: `apps/wallet/src/refunds/refund-response.ts`
- Test: `apps/wallet/src/refunds/refund-response.spec.ts`
- Modify: `apps/wallet/src/refunds/refunds.controller.ts`, `apps/wallet/src/payment-intents/payment-intents.controller.ts` (private 매퍼 → 공용 매퍼)
- Modify: `apps/wallet/src/admin/payment-intent-admin.service.ts` (상세 select·map, 목록 map)
- Modify: `apps/wallet/src/refunds/refunds.service.spec.ts` (`makeMultiChargeContext` 의 `Refund` 리터럴)

**Interfaces:**
- Produces: `refundExecutionEnum`(`'refund_execution'`: `'AUTO' | 'MANUAL'`), `type RefundExecution`, `Refund.execution: RefundExecution`,
  `Refund.failureCode: string | null`, `Refund.failureRetryable: boolean | null`
- Produces: `RefundResponseDto.execution: RefundExecution`, `.failureCode: string | null`, `.retryable: boolean | null`
- Produces: `export function toRefundResponse(refund: Refund, manualConfirmable?: boolean): RefundResponseDto` (`apps/wallet/src/refunds/refund-response.ts`)

- [ ] **Step 1: 실패하는 매퍼 테스트**

```ts
// apps/wallet/src/refunds/refund-response.spec.ts
import type { Refund } from '../types';
import { toRefundResponse } from './refund-response';

const row = (overrides: Partial<Refund> = {}): Refund => ({
  id: 'rf-1',
  chargeId: 'ch-1',
  intentId: 'in-1',
  amount: 5000,
  currency: 'KRW',
  status: 'SUCCEEDED',
  reasonCode: 'MEDUSA_REFUND',
  reasonMessage: null,
  providerRefundId: 'pk-1',
  execution: 'AUTO',
  failureCode: null,
  failureRetryable: null,
  createdAt: new Date('2026-10-11T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
  ...overrides,
});

describe('toRefundResponse', () => {
  it('성공 행: 실패 칸은 null, execution 은 그대로, manualConfirmable 기본 false', () => {
    expect(toRefundResponse(row())).toEqual({
      id: 'rf-1',
      chargeId: 'ch-1',
      intentId: 'in-1',
      status: 'SUCCEEDED',
      amount: 5000,
      currency: 'KRW',
      reasonCode: 'MEDUSA_REFUND',
      reasonMessage: null,
      createdAt: new Date('2026-10-11T00:00:00Z'),
      manualConfirmable: false,
      execution: 'AUTO',
      failureCode: null,
      retryable: null,
    });
  });

  it('분류된 FAILED 행은 failureCode 와 retryable 을 싣는다', () => {
    const res = toRefundResponse(
      row({ status: 'FAILED', reasonMessage: '이미 취소된 결제 입니다.', failureCode: 'ALREADY_CANCELED_PAYMENT', failureRetryable: false }),
    );
    expect(res).toMatchObject({ status: 'FAILED', failureCode: 'ALREADY_CANCELED_PAYMENT', retryable: false });
  });

  it('분류 전 옛 FAILED 행은 failureCode·retryable 이 null 그대로 — 지어내지 않는다', () => {
    const res = toRefundResponse(row({ status: 'FAILED', failureCode: null, failureRetryable: null }));
    expect(res.failureCode).toBeNull();
    expect(res.retryable).toBeNull();
  });

  it('manualConfirmable 은 호출자가 정한다', () => {
    expect(toRefundResponse(row({ status: 'PENDING', execution: 'MANUAL' }), true).manualConfirmable).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refund-response.spec.ts`
Expected: FAIL — `Cannot find module './refund-response'`

- [ ] **Step 3: 스키마**

```ts
// apps/wallet/src/schema.ts — refundStatusEnum 바로 아래
// 환불을 누가 집행하나. AUTO: wallet 이 provider(PG·포인트 원장)를 부른다. MANUAL: 외부 결제 몫은 PG 를 부르지 않고
// 송금 대기(PENDING)로 두고, 운영자가 고객 계좌로 송금한 뒤 confirmManual 로 닫는다(#1016 36번 재설계 S4).
export const refundExecutionEnum = pgEnum('refund_execution', ['AUTO', 'MANUAL']);
```

```ts
// apps/wallet/src/schema.ts — refunds 테이블, providerRefundId 바로 아래
    execution: refundExecutionEnum('execution').notNull().default('AUTO'),
    // FAILED 행에만 채운다: provider 실패 코드(토스 오류 코드 등)와 «같은 환불을 다시 시도하면 될 수 있는가».
    // 영구/일시 분류의 정본은 wallet 이다(스펙 S6). 분류 전에 생긴 FAILED 행은 둘 다 null 이다.
    failureCode: varchar('failure_code', { length: 128 }),
    failureRetryable: boolean('failure_retryable'),
```

```ts
// apps/wallet/src/schema.ts — Type exports, RefundStatus 아래
export type RefundExecution = (typeof refundExecutionEnum.enumValues)[number];
```

- [ ] **Step 4: 마이그레이션 생성·검토**

Run: `npm run db:generate:wallet -- --name add-refund-execution-and-failure`

생성된 `apps/wallet/drizzle/<timestamp>_add-refund-execution-and-failure.sql` 이 **정확히** 이 네 문장이어야 한다(순서·따옴표는 drizzle-kit 출력대로):

```sql
CREATE TYPE "public"."refund_execution" AS ENUM('AUTO', 'MANUAL');--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "execution" "refund_execution" DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure_code" varchar(128);--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "failure_retryable" boolean;
```

다른 문장이 섞이면 **멈추고** 생성물을 `git rm`/삭제한 뒤 보고한다(스냅샷 체인 사고 재발 신호). `DEFAULT … NOT NULL` 새 칸은 Postgres 11+ 에서
테이블을 다시 쓰지 않고 옛 코드의 INSERT 는 기본값을 받는다 — additive 다(기존 칸에 NOT NULL 을 더하는 destructive 변경과 다르다).

- [ ] **Step 5: 응답 DTO 칸**

```ts
// apps/wallet/src/refunds/dto/index.ts — import 교체
import { RefundExecution, RefundStatus, refundExecutionEnum } from '../../schema';
```

```ts
// apps/wallet/src/refunds/dto/index.ts — RefundResponseDto 안, manualConfirmable 아래
  @ApiProperty({
    enum: refundExecutionEnum.enumValues,
    description: 'AUTO: wallet 이 provider 로 집행. MANUAL: 외부 결제 몫을 PG 없이 송금 대기로 둔 행',
  })
  execution: RefundExecution;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'FAILED 일 때 실패 코드(토스 오류 코드 등). 그 밖엔 null' })
  failureCode: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description: 'FAILED 일 때만: 같은 환불을 다시 시도하면 될 수 있는가. null 은 분류 전 옛 행 — 일시로 읽는다',
  })
  retryable: boolean | null;
```

- [ ] **Step 6: 매퍼 구현**

```ts
// apps/wallet/src/refunds/refund-response.ts
import type { Refund } from '../types';
import { RefundResponseDto } from './dto';

/** 환불 행 → API 응답. manualConfirmable 은 결제수단을 아는 호출자(관리자 상세)만 true 로 정한다. */
export function toRefundResponse(refund: Refund, manualConfirmable = false): RefundResponseDto {
  return {
    id: refund.id,
    chargeId: refund.chargeId,
    intentId: refund.intentId,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    reasonCode: refund.reasonCode,
    reasonMessage: refund.reasonMessage,
    createdAt: refund.createdAt,
    manualConfirmable,
    execution: refund.execution,
    failureCode: refund.failureCode,
    retryable: refund.failureRetryable,
  };
}
```

- [ ] **Step 7: 두 컨트롤러가 공용 매퍼를 쓰게**

`apps/wallet/src/refunds/refunds.controller.ts`: private `toResponse(...)` 메서드를 지우고 `import { toRefundResponse } from './refund-response';` 후
`return this.toResponse(refund);` 두 곳을 `return toRefundResponse(refund);` 로 바꾼다.

`apps/wallet/src/payment-intents/payment-intents.controller.ts`: private `toRefundResponse(...)` 메서드를 지우고
`import { toRefundResponse } from '../refunds/refund-response';` 후 refund 라우트를:

```ts
    return { intentId: id, refunds: refunds.map((r) => toRefundResponse(r)) };
```

(두 private 매퍼의 `status: refund.status as any` 가 함께 사라진다.) `RefundResponseDto` import 가 더 안 쓰이면 지운다.

- [ ] **Step 8: 관리자 서비스의 응답 칸**

`apps/wallet/src/admin/payment-intent-admin.service.ts` 상세(`// Refunds (charge → payment_method join으로 manualConfirmable 계산)`)의 select 에
`createdAt: refunds.createdAt,` 아래로 더한다:

```ts
        execution: refunds.execution,
        failureCode: refunds.failureCode,
        failureRetryable: refunds.failureRetryable,
```

같은 블록의 `refundData` map 과 `listRefunds` 의 `data` map, 두 객체 리터럴의 `manualConfirmable` 줄 아래에 더한다:

```ts
      execution: r.execution,
      failureCode: r.failureCode ?? null,
      retryable: r.failureRetryable ?? null,
```

(`manualConfirmable` 규칙은 Task 5 가 바꾼다.)

- [ ] **Step 9: 단위 스펙의 `Refund` 리터럴**

`apps/wallet/src/refunds/refunds.service.spec.ts` 의 `makeMultiChargeContext` 안 `const row: Refund = { … }` 에 `providerRefundId: null,` 아래로 더한다
(안 더하면 `type-check` 가 빨갛다):

```ts
          execution: 'AUTO',
          failureCode: null,
          failureRetryable: null,
```

- [ ] **Step 10: 통과·타입 확인**

Run:
```bash
npx jest apps/wallet/src/refunds
npm run type-check
```
Expected: jest PASS(매퍼 4 + 기존 전부). type-check 에러 0

- [ ] **Step 11: 커밋**

```bash
git add apps/wallet/src/schema.ts apps/wallet/drizzle apps/wallet/src/refunds/dto/index.ts \
  apps/wallet/src/refunds/refund-response.ts apps/wallet/src/refunds/refund-response.spec.ts \
  apps/wallet/src/refunds/refunds.controller.ts apps/wallet/src/payment-intents/payment-intents.controller.ts \
  apps/wallet/src/admin/payment-intent-admin.service.ts apps/wallet/src/refunds/refunds.service.spec.ts
git commit -m "feat(wallet): 환불 행에 execution·failure_code·failure_retryable 칸과 응답 매퍼 (#1016 36번 PR 1)"
```

---

### Task 2: provider 가 FAILED 의 영구/일시를 정한다

**Files:**
- Modify: `apps/wallet/src/providers/payment-provider.interface.ts` (`RefundResult`)
- Create: `apps/wallet/src/providers/toss/toss-refund-errors.ts`
- Test: `apps/wallet/src/providers/toss/toss-refund-errors.spec.ts`
- Modify: `apps/wallet/src/providers/toss/toss.provider.ts`, `apps/wallet/src/providers/toss/toss-billing.provider.ts`,
  `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.ts`, `apps/wallet/src/cms/cms-batch.provider.ts`, `apps/wallet/src/providers/points/points.provider.ts` (각 `refund()`)
- Test (Create): `apps/wallet/src/providers/toss/toss.provider.spec.ts`, `apps/wallet/src/providers/points/points.provider.spec.ts`
- Test (Modify): `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts`, `apps/wallet/src/cms/cms-batch.provider.spec.ts`

**Interfaces:**
- Produces: `RefundResult.retryable?: boolean` — «FAILED 일 때만 의미, 없으면 `true`»
- Produces: `export function isTossRefundRetryable(code: string | undefined): boolean`, `export const TOSS_REFUND_ERROR_RETRYABLE: ReadonlyMap<string, boolean>`

NicePay provider 는 건드리지 않는다(라이브 미사용, `retryable` 없음 = 일시).

- [ ] **Step 1: 토스 표 테스트 (실패)**

출처: docs.tosspayments.com/reference/error-codes «결제 취소»(2026-10-11 확인, 31개). 테스트가 문서 목록을 그대로 들고 표와 대조한다 — 표에서 코드가
빠지거나 판정이 바뀌면 빨갛다.

```ts
// apps/wallet/src/providers/toss/toss-refund-errors.spec.ts
import { TOSS_REFUND_ERROR_RETRYABLE, isTossRefundRetryable } from './toss-refund-errors';

/** 다시 보내도 같은 답 — 사람이 다른 수단(계좌 송금)을 골라야 한다 */
const PERMANENT = [
  'ALREADY_CANCELED_PAYMENT',
  'INVALID_REFUND_ACCOUNT_INFO',
  'EXCEED_CANCEL_AMOUNT_DISCOUNT_AMOUNT',
  'INVALID_REQUEST',
  'INVALID_REFUND_ACCOUNT_NUMBER',
  'INVALID_BANK',
  'NOT_MATCHES_REFUNDABLE_AMOUNT',
  'REFUND_REJECTED',
  'ALREADY_REFUND_PAYMENT',
  'FORBIDDEN_BANK_REFUND_REQUEST',
  'NOT_CANCELABLE_AMOUNT',
  'FORBIDDEN_REQUEST',
  'NOT_CANCELABLE_PAYMENT',
  'EXCEED_MAX_REFUND_DUE',
  'NOT_ALLOWED_PARTIAL_REFUND_WAITING_DEPOSIT',
  'NOT_ALLOWED_PARTIAL_REFUND',
  'NOT_CANCELABLE_PAYMENT_FOR_DORMANT_USER',
  'NOT_FOUND_PAYMENT',
];

/** 시간이 지나거나 우리 설정을 고치면 풀린다 */
const RETRYABLE = [
  'PROVIDER_ERROR',
  'UNAUTHORIZED_KEY',
  'INCORRECT_BASIC_AUTH_FORMAT',
  'FORBIDDEN_CONSECUTIVE_REQUEST',
  'NOT_AVAILABLE_BANK',
  'EXCEED_CANCEL_LIMIT',
  'FAILED_INTERNAL_SYSTEM_PROCESSING',
  'FAILED_CARD_COMPANY_RESPONSE',
  'FAILED_REFUND_PROCESS',
  'FAILED_METHOD_HANDLING_CANCEL',
  'FAILED_PARTIAL_REFUND',
  'COMMON_ERROR',
  'FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING',
];

describe('토스 결제 취소 오류 코드표', () => {
  it('문서의 31개 코드를 전부 판정한다', () => {
    expect(TOSS_REFUND_ERROR_RETRYABLE.size).toBe(31);
    expect([...TOSS_REFUND_ERROR_RETRYABLE.keys()].sort()).toEqual([...PERMANENT, ...RETRYABLE].sort());
  });

  it.each(PERMANENT)('%s 는 영구(false)', (code) => {
    expect(isTossRefundRetryable(code)).toBe(false);
  });

  it.each(RETRYABLE)('%s 는 일시(true)', (code) => {
    expect(isTossRefundRetryable(code)).toBe(true);
  });

  it('모르는 코드·없는 코드·응답 본문을 못 읽은 UNKNOWN 은 일시(true)', () => {
    expect(isTossRefundRetryable('SOMETHING_NEW')).toBe(true);
    expect(isTossRefundRetryable(undefined)).toBe(true);
    expect(isTossRefundRetryable('UNKNOWN')).toBe(true);
    // Map 이라 Object.prototype 키에 속지 않는다
    expect(isTossRefundRetryable('constructor')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/providers/toss/toss-refund-errors.spec.ts`
Expected: FAIL — `Cannot find module './toss-refund-errors'`

- [ ] **Step 3: 표 구현**

```ts
// apps/wallet/src/providers/toss/toss-refund-errors.ts
/**
 * 토스 결제 취소(환불) 오류 코드 → 같은 환불을 나중에 다시 시도하면 될 수 있는가.
 * 출처: docs.tosspayments.com/reference/error-codes «결제 취소» (2026-10-11 확인, 31개).
 *
 * false(영구)면 정산 재시도가 멈추고 운영자가 «계좌 송금으로 환불»을 고른다. true(일시)면 core 리컨실러가 다시 부른다.
 * 모르는 코드는 true — 영구로 잘못 두면 아무도 다시 안 부르지만, 일시로 잘못 두면 «환불 지연»으로 사람 눈에 띈다(스펙 §6.5).
 */
export const TOSS_REFUND_ERROR_RETRYABLE: ReadonlyMap<string, boolean> = new Map([
  // 400
  ['ALREADY_CANCELED_PAYMENT', false],
  ['INVALID_REFUND_ACCOUNT_INFO', false], // 계좌번호·예금주 불일치 — 라이브 FAILED 의 최다 사유
  ['EXCEED_CANCEL_AMOUNT_DISCOUNT_AMOUNT', false],
  ['INVALID_REQUEST', false],
  ['INVALID_REFUND_ACCOUNT_NUMBER', false],
  ['INVALID_BANK', false],
  ['NOT_MATCHES_REFUNDABLE_AMOUNT', false], // 토스 잔액과 요청이 다르다 — 같은 요청은 또 다르다
  ['PROVIDER_ERROR', true],
  ['REFUND_REJECTED', false],
  ['ALREADY_REFUND_PAYMENT', false],
  ['FORBIDDEN_BANK_REFUND_REQUEST', false],
  // 401·403
  ['UNAUTHORIZED_KEY', true], // 우리 키 설정 문제 — 배포로 고치면 풀린다
  ['NOT_CANCELABLE_AMOUNT', false],
  ['FORBIDDEN_CONSECUTIVE_REQUEST', true],
  ['FORBIDDEN_REQUEST', false],
  ['NOT_CANCELABLE_PAYMENT', false],
  ['EXCEED_MAX_REFUND_DUE', false],
  ['NOT_ALLOWED_PARTIAL_REFUND_WAITING_DEPOSIT', false],
  ['NOT_ALLOWED_PARTIAL_REFUND', false],
  ['NOT_AVAILABLE_BANK', true], // 은행 서비스 시간 밖
  ['INCORRECT_BASIC_AUTH_FORMAT', true], // 우리 설정 문제
  ['NOT_CANCELABLE_PAYMENT_FOR_DORMANT_USER', false],
  ['EXCEED_CANCEL_LIMIT', true], // 취소 한도 — 시간이 지나면 풀릴 수 있어 일시 쪽
  // 404
  ['NOT_FOUND_PAYMENT', false],
  // 500
  ['FAILED_INTERNAL_SYSTEM_PROCESSING', true],
  ['FAILED_CARD_COMPANY_RESPONSE', true],
  ['FAILED_REFUND_PROCESS', true],
  ['FAILED_METHOD_HANDLING_CANCEL', true],
  ['FAILED_PARTIAL_REFUND', true], // «은행 점검·해약 계좌» — 영구·일시가 섞여 있어 기본값(일시) 쪽
  ['COMMON_ERROR', true],
  ['FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING', true],
]);

export function isTossRefundRetryable(code: string | undefined): boolean {
  if (!code) return true;
  return TOSS_REFUND_ERROR_RETRYABLE.get(code) ?? true;
}
```

- [ ] **Step 4: 표 통과 확인**

Run: `npx jest apps/wallet/src/providers/toss/toss-refund-errors.spec.ts`
Expected: PASS (1 + 18 + 13 + 1 = 33 tests)

- [ ] **Step 5: provider 테스트 (실패)**

```ts
// apps/wallet/src/providers/toss/toss.provider.spec.ts
import { TossPaymentProvider } from './toss.provider';
import { TossBillingProvider } from './toss-billing.provider';
import { TossApiClient } from './toss-api.client';
import { PaymentProvider, RefundParams } from '../payment-provider.interface';

/** charge 한 건을 돌려주는 최소 DbService 스텁 (getPaymentKey 조회용). */
const dbWithCharge = (row: Record<string, unknown> | undefined) =>
  ({
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
        }),
      }),
    },
  }) as never;

const refusing = (code: string, message = '거절') =>
  ({ cancelPayment: jest.fn().mockResolvedValue({ ok: false, error: { code, message }, statusCode: 400 }) }) as unknown as TossApiClient;

const refundParams = (): RefundParams => ({
  refundId: 'rf-1',
  chargeId: 'ch-1',
  intentId: 'in-1',
  userId: 'u-1',
  amount: 5000,
  currency: 'KRW',
  idempotencyKey: 'wallet:refund:rf-1',
  correlationId: 'c-1',
});

describe.each<[string, (db: never, api: TossApiClient) => PaymentProvider, string]>([
  ['TossPaymentProvider', (db, api) => new TossPaymentProvider(db, api), 'TOSS_PAYMENT_KEY_NOT_FOUND'],
  ['TossBillingProvider', (db, api) => new TossBillingProvider(db, api, null as never), 'TOSS_BILLING_PAYMENT_KEY_NOT_FOUND'],
])('%s.refund — 실패 분류', (_name, make, missingKeyCode) => {
  it('토스 영구 오류는 retryable=false, 코드·메시지는 그대로', async () => {
    const provider = make(dbWithCharge({ providerTransactionId: 'pk_1' }), refusing('ALREADY_CANCELED_PAYMENT', '이미 취소된 결제 입니다.'));
    expect(await provider.refund(refundParams())).toEqual({
      status: 'FAILED',
      errorCode: 'ALREADY_CANCELED_PAYMENT',
      errorMessage: '이미 취소된 결제 입니다.',
      retryable: false,
    });
  });

  it('토스 일시 오류·모르는 코드는 retryable=true', async () => {
    const transient = make(dbWithCharge({ providerTransactionId: 'pk_1' }), refusing('PROVIDER_ERROR'));
    expect(await transient.refund(refundParams())).toMatchObject({ status: 'FAILED', retryable: true });
    const unknown = make(dbWithCharge({ providerTransactionId: 'pk_1' }), refusing('BRAND_NEW_CODE'));
    expect(await unknown.refund(refundParams())).toMatchObject({ status: 'FAILED', retryable: true });
  });

  it('결제 키가 없으면 토스를 못 부른다 — retryable=false', async () => {
    const api = refusing('UNUSED');
    const provider = make(dbWithCharge({ providerTransactionId: null }), api);
    expect(await provider.refund(refundParams())).toEqual({ status: 'FAILED', errorCode: missingKeyCode, retryable: false });
  });
});
```

```ts
// apps/wallet/src/providers/points/points.provider.spec.ts
import { PointsPaymentProvider } from './points.provider';
import { RefundParams } from '../payment-provider.interface';

const refundParams = (): RefundParams => ({
  refundId: 'rf-1',
  chargeId: 'cap-1',
  authorizeChargeId: 'auth-1',
  intentId: 'in-1',
  userId: 'u-1',
  amount: 3000,
  currency: 'KRW',
  idempotencyKey: 'wallet:refund:rf-1',
  correlationId: 'c-1',
});

function providerFailingWith(reasonCode: string) {
  const db = { db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) } };
  const ledger = { refund: jest.fn().mockResolvedValue({ resultStatus: 'FAILED', raw: { reasonCode } }) };
  return new PointsPaymentProvider(db as never, ledger as never);
}

describe('PointsPaymentProvider.refund — 실패 분류', () => {
  it('원장에 확정 사용이 없으면(NO_CAPTURED_REDEEM) 영구 — 다시 불러도 같다', async () => {
    expect(await providerFailingWith('NO_CAPTURED_REDEEM').refund(refundParams())).toMatchObject({
      status: 'FAILED',
      errorCode: 'NO_CAPTURED_REDEEM',
      retryable: false,
    });
  });

  it('남은 금액 초과는 경합이라 일시', async () => {
    expect(await providerFailingWith('REFUND_AMOUNT_EXCEEDS_REMAINING').refund(refundParams())).toMatchObject({
      status: 'FAILED',
      errorCode: 'REFUND_AMOUNT_EXCEEDS_REMAINING',
      retryable: true,
    });
  });
});
```

`apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts` 의 마지막 `it(...)` 뒤(바깥 `describe` 닫기 전)에 더한다:

```ts
  it('환불을 토스가 영구 거절하면(계좌·예금주 불일치) retryable=false', async () => {
    const cancelPayment = jest.fn().mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_REFUND_ACCOUNT_INFO', message: '환불 계좌번호와 예금주명이 일치하지 않습니다.' },
      statusCode: 400,
    });
    const provider = new BankTransferPaymentProvider(
      dbWithCharge({ providerTransactionId: null, responsePayload: { paymentKey: 'pk_1' } }),
      { cancelPayment } as unknown as TossApiClient,
    );

    const result = await provider.refund({
      refundId: 'rf-1',
      chargeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      intentId: 'i1',
      userId: 'u1',
      amount: 10000,
      currency: 'KRW',
      idempotencyKey: 'k1',
      correlationId: 'c1',
      refundReceiveAccount: { bank: '06', accountNumber: '1234567890', holderName: '홍길동' },
    });

    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_REFUND_ACCOUNT_INFO', retryable: false });
  });
```

`apps/wallet/src/cms/cms-batch.provider.spec.ts` 파일 끝에 더한다:

```ts
describe('CmsBatchProvider.refund', () => {
  it('효성 CMS 는 환불 API 가 없다 — FAILED + retryable=false', async () => {
    const provider = new CmsBatchProvider(null as never, null as never, null as never, null as never);
    const result = await provider.refund({
      refundId: 'rf-1',
      chargeId: 'ch-1',
      intentId: 'in-1',
      userId: 'u-1',
      amount: 10000,
      currency: 'KRW',
      idempotencyKey: 'k1',
      correlationId: 'c1',
    });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'CMS_REFUND_NOT_SUPPORTED', retryable: false });
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx jest apps/wallet/src/providers apps/wallet/src/cms/cms-batch.provider.spec.ts`
Expected: 새 테스트들 FAIL — `retryable` 이 결과에 없음(`toEqual`·`toMatchObject` 불일치)

- [ ] **Step 7: 인터페이스와 provider 구현**

```ts
// apps/wallet/src/providers/payment-provider.interface.ts — RefundResult 안, errorMessage 아래
  /**
   * FAILED 일 때만 의미: 같은 환불을 나중에 다시 시도하면 될 수 있는가. 없으면 true(일시)로 본다 —
   * 모르는 실패를 영구로 두면 아무도 다시 안 부른다. 영구/일시 분류의 정본은 wallet 이다(스펙 S6).
   */
  retryable?: boolean;
```

`apps/wallet/src/providers/toss/toss.provider.ts` `refund()`:

```ts
// import 추가
import { isTossRefundRetryable } from './toss-refund-errors';

    if (!paymentKey) {
      // 결제 키가 없으면 토스를 부를 수 없다 — 다시 불러도 같다
      return { status: 'FAILED', errorCode: 'TOSS_PAYMENT_KEY_NOT_FOUND', retryable: false };
    }
    …
    return {
      status: 'FAILED',
      errorCode: result.error.code,
      errorMessage: result.error.message,
      retryable: isTossRefundRetryable(result.error.code),
    };
```

`apps/wallet/src/providers/toss/toss-billing.provider.ts` `refund()` — 같은 모양(`TOSS_BILLING_PAYMENT_KEY_NOT_FOUND` 에 `retryable: false`, 마지막 FAILED 에
`retryable: isTossRefundRetryable(result.error.code)`, import `./toss-refund-errors`).

`apps/wallet/src/providers/bank-transfer/bank-transfer.provider.ts` `refund()` 마지막 줄:

```ts
// import 추가
import { isTossRefundRetryable } from '../toss/toss-refund-errors';

    return {
      status: 'FAILED',
      errorCode: result.error.code,
      errorMessage: result.error.message,
      retryable: isTossRefundRetryable(result.error.code),
    };
```

`apps/wallet/src/cms/cms-batch.provider.ts` `refund()`:

```ts
    // CMS는 환불 개념이 없음. 별도 입금으로 처리해야 함 — 다시 불러도 같다(영구).
    return {
      status: 'FAILED',
      errorCode: 'CMS_REFUND_NOT_SUPPORTED',
      errorMessage: 'CMS batch provider does not support refunds. Use a separate deposit process.',
      retryable: false,
    };
```

`apps/wallet/src/providers/points/points.provider.ts`:

```ts
// 클래스 위 모듈 상수
/**
 * 다시 불러도 같은 포인트 환불 실패. NO_CAPTURED_REDEEM 은 원장에 확정 사용이 없다는 데이터 모양이다.
 * 금액 초과(REFUND_AMOUNT_EXCEEDS_REMAINING)는 동시 환불 경합이라 일시로 둔다(스펙 §6.2).
 */
const POINTS_REFUND_PERMANENT_CODES: ReadonlySet<string> = new Set(['NO_CAPTURED_REDEEM']);

// refund() 의 FAILED 반환 교체
    const raw = result.raw ?? {};
    const errorCode = String(raw['reasonCode'] ?? 'POINTS_REFUND_FAILED');
    return {
      status: 'FAILED',
      errorCode,
      errorMessage: String(raw['reasonCode'] ?? 'Points refund failed'),
      retryable: !POINTS_REFUND_PERMANENT_CODES.has(errorCode),
      raw: result.raw,
    };
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/wallet/src/providers apps/wallet/src/cms`
Expected: PASS (새 테스트 포함 전부. 통합 스펙은 `DATABASE_URL` 없으면 skip)

- [ ] **Step 9: 커밋**

```bash
git add apps/wallet/src/providers apps/wallet/src/cms/cms-batch.provider.ts apps/wallet/src/cms/cms-batch.provider.spec.ts
git commit -m "feat(wallet): provider 환불 실패에 retryable — 토스 결제 취소 오류 코드표 (#1016 36번 PR 1)"
```

---

### Task 3: wallet 이 실패 분류를 저장하고, 거절 본문에 싣는다

**Files:**
- Create: `apps/wallet/src/refunds/refund-refusal.ts`
- Test: `apps/wallet/src/refunds/refund-refusal.spec.ts`
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (모든 `{ error, message }` 거절, `create()` 의 FAILED·예외 분기)
- Test: `apps/wallet/src/refunds/refunds.service.spec.ts`

**Interfaces:**
- Consumes: `RefundResult.retryable?` (Task 2), `Refund.failureCode`·`failureRetryable` (Task 1)
- Produces: `export type WalletRefundRefusalCode`, `export function refundRefusal(error: WalletRefundRefusalCode, message: string): { error: WalletRefundRefusalCode; message: string; retryable: boolean }`

- [ ] **Step 1: 거절 표 테스트 (실패)**

```ts
// apps/wallet/src/refunds/refund-refusal.spec.ts
import { refundRefusal } from './refund-refusal';

describe('refundRefusal — wallet 이 환불 요청을 거절할 때의 본문', () => {
  it('금액 초과류는 retryable=true — 호출자 장부와 wallet 이 어긋난 경합이다(맞춘 뒤 다시 보낸다)', () => {
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_CHARGE', 'm').retryable).toBe(true);
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'm').retryable).toBe(true);
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_TOTAL', 'm').retryable).toBe(true);
  });

  it('수단·정책·데이터가 막는 거절은 retryable=false', () => {
    for (const code of [
      'REFUND_NOT_AUTOMATABLE',
      'MEMBERSHIP_REFUND_NOT_ALLOWED',
      'CHARGE_NOT_FOUND',
      'CHARGE_INTENT_MISMATCH',
      'CHARGE_NOT_REFUNDABLE',
      'PAYMENT_METHOD_NOT_FOUND',
      'INTENT_NOT_FOUND',
      'REFUNDABLE_CHARGE_NOT_FOUND',
    ] as const) {
      expect(refundRefusal(code, 'm').retryable).toBe(false);
    }
  });

  it('core WalletRefundClient 가 읽는 모양 그대로: error 는 코드 문자열, message 는 문자열', () => {
    // core 는 body.error 가 REFUND_AMOUNT_EXCEEDS_AVAILABLE·_TOTAL 이면 already_refunded 로 읽는다 — 이 두 이름이 바뀌면 안 된다
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_AVAILABLE', '초과')).toEqual({
      error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
      message: '초과',
      retryable: true,
    });
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_TOTAL', '초과').error).toBe('REFUND_AMOUNT_EXCEEDS_TOTAL');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refund-refusal.spec.ts`
Expected: FAIL — `Cannot find module './refund-refusal'`

- [ ] **Step 3: 거절 표 구현**

```ts
// apps/wallet/src/refunds/refund-refusal.ts
/**
 * wallet 이 환불 요청을 4xx 로 거절할 때의 본문 — `{ error, message, retryable }`.
 *
 * error·message 는 옛 모양 그대로다: core WalletRefundClient 가 body.error 로 금액 초과류를 «이미 환불됨»으로 읽는다.
 * retryable 은 «같은 요청을 나중에 다시 보내면 될 수 있는가» — almond-payment 가 영구 거절과 일시 실패를 가른다(스펙 §6.4).
 * 코드를 더하면 이 표에 판정을 함께 적어야 컴파일된다.
 */
const RETRYABLE = {
  // 금액 초과류: 호출자 장부와 wallet 이 어긋난 경합(동시 환불 등)이다. 장부를 맞춘 다음 시도가 남은 몫만 보낸다(스펙 §6.2)
  REFUND_AMOUNT_EXCEEDS_CHARGE: true,
  REFUND_AMOUNT_EXCEEDS_AVAILABLE: true,
  REFUND_AMOUNT_EXCEEDS_TOTAL: true,
  // 결제수단·정책·데이터가 막는다 — 다시 보내도 같다
  REFUND_NOT_AUTOMATABLE: false,
  MEMBERSHIP_REFUND_NOT_ALLOWED: false,
  CHARGE_NOT_FOUND: false,
  CHARGE_INTENT_MISMATCH: false,
  CHARGE_NOT_REFUNDABLE: false,
  PAYMENT_METHOD_NOT_FOUND: false,
  INTENT_NOT_FOUND: false,
  REFUNDABLE_CHARGE_NOT_FOUND: false,
} as const satisfies Record<string, boolean>;

export type WalletRefundRefusalCode = keyof typeof RETRYABLE;

export function refundRefusal(
  error: WalletRefundRefusalCode,
  message: string,
): { error: WalletRefundRefusalCode; message: string; retryable: boolean } {
  return { error, message, retryable: RETRYABLE[error] };
}
```

- [ ] **Step 4: 표 통과 확인**

Run: `npx jest apps/wallet/src/refunds/refund-refusal.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 서비스 테스트 (실패)**

`apps/wallet/src/refunds/refunds.service.spec.ts`:

1. 파일 첫 줄 import 를 `import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';` 로 바꾼다.
2. `makeContext` 의 options 타입에서 `providerResult?:` 를 `{ status: string; errorCode?: string; errorMessage?: string; providerRefundId?: string; retryable?: boolean }` 로 넓힌다.
3. `describe('RefundsService', () => {` 바로 안에 블록을 더한다:

```ts
  describe('실패 분류 (#1016 36번 PR 1)', () => {
    async function refusalOf(p: Promise<unknown>): Promise<unknown> {
      try {
        await p;
      } catch (e) {
        expect(e).toBeInstanceOf(HttpException);
        return (e as HttpException).getResponse();
      }
      throw new Error('expected rejection');
    }

    it('provider 영구 실패(retryable=false) → FAILED 행에 failureCode·failureRetryable=false, 토스 메시지는 reasonMessage', async () => {
      const { service, updateCalls } = makeContext({
        providerResult: {
          status: 'FAILED',
          errorCode: 'ALREADY_CANCELED_PAYMENT',
          errorMessage: '이미 취소된 결제 입니다.',
          retryable: false,
        },
      });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(updateCalls).toContainEqual({
        set: expect.objectContaining({
          reasonMessage: '이미 취소된 결제 입니다.',
          failureCode: 'ALREADY_CANCELED_PAYMENT',
          failureRetryable: false,
        }),
      });
    });

    it('provider 가 retryable 을 안 주면 일시(true), 코드가 없으면 REFUND_FAILED', async () => {
      const { service, updateCalls } = makeContext({ providerResult: { status: 'FAILED' } });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(updateCalls).toContainEqual({
        set: expect.objectContaining({ failureCode: 'REFUND_FAILED', failureRetryable: true }),
      });
    });

    it('provider 가 던지면 PROVIDER_EXCEPTION · 일시(true)', async () => {
      const { service, providerRegistry, updateCalls } = makeContext();
      providerRegistry.getProviderOrThrow.mockReturnValue({ refund: jest.fn().mockRejectedValue(new Error('socket hang up')) });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(updateCalls).toContainEqual({
        set: expect.objectContaining({ failureCode: 'PROVIDER_EXCEPTION', failureRetryable: true }),
      });
    });

    it('금액 초과 거절 본문은 옛 error·message 에 retryable=true 만 더한다', async () => {
      const { service } = makeContext({ priorRefundedAmount: 8000 });

      expect(await refusalOf(service.create({ chargeId: CHARGE_ID, amount: 5000 }))).toEqual({
        error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
        message: 'Refund amount (5000) exceeds available refundable amount (2000)',
        retryable: true,
      });
    });

    it('멤버십 결제 거절은 retryable=false', async () => {
      const { service } = makeContext({ intentMetadata: { type: 'MEMBERSHIP_FEE' } });

      expect(await refusalOf(service.create({ chargeId: CHARGE_ID, amount: 5000 }))).toEqual({
        error: 'MEMBERSHIP_REFUND_NOT_ALLOWED',
        message: '멤버십 결제는 환불할 수 없습니다.',
        retryable: false,
      });
    });

    it('charge 없음(404)도 retryable=false 를 싣는다', async () => {
      const { service, chargesService } = makeContext();
      chargesService.findById.mockResolvedValue(null);

      expect(await refusalOf(service.create({ chargeId: 'missing', amount: 5000 }))).toEqual({
        error: 'CHARGE_NOT_FOUND',
        message: 'Charge not found: missing',
        retryable: false,
      });
    });
  });
```

4. `describe('createByIntent — 복합결제: …')` 안, `'효성 CMS 단독 결제도 FAILED 행을 만들지 않고 400 REFUND_NOT_AUTOMATABLE'` 테스트 뒤에 더한다:

```ts
    it('REFUND_NOT_AUTOMATABLE 은 retryable=false, REFUND_AMOUNT_EXCEEDS_TOTAL 은 retryable=true', async () => {
      const cms = makeMultiChargeContext({ charges: [{ id: 'M1', amount: 10000, type: 'CMS_BATCH' }] });
      expect((await catchResponse(cms.service.createByIntent(INTENT_ID, { amount: 10000 }))).retryable).toBe(false);

      const over = makeMultiChargeContext({ charges: POINTS_THEN_CARD });
      const response = await catchResponse(over.service.createByIntent(INTENT_ID, { amount: 10001 }));
      expect(response.error).toBe('REFUND_AMOUNT_EXCEEDS_TOTAL');
      expect(response.retryable).toBe(true);
    });
```

- [ ] **Step 6: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refunds.service.spec.ts -t "실패 분류|retryable"`
Expected: FAIL — update 의 `set` 에 `failureCode` 없음, 거절 본문에 `retryable` 없음

- [ ] **Step 7: 서비스 구현**

`apps/wallet/src/refunds/refunds.service.ts`:

```ts
// import 추가
import { refundRefusal } from './refund-refusal';
```

**모든** `{ error: '<CODE>', message: <msg> }` 객체 리터럴(서비스 안 12곳: `CHARGE_NOT_FOUND`·`CHARGE_INTENT_MISMATCH`·`CHARGE_NOT_REFUNDABLE`·
`REFUND_AMOUNT_EXCEEDS_CHARGE`·`PAYMENT_METHOD_NOT_FOUND` 두 곳·`INTENT_NOT_FOUND`·`REFUND_AMOUNT_EXCEEDS_AVAILABLE`·`REFUNDABLE_CHARGE_NOT_FOUND`·
`REFUND_AMOUNT_EXCEEDS_TOTAL`·`REFUND_NOT_AUTOMATABLE`·`MEMBERSHIP_REFUND_NOT_ALLOWED`)을 `refundRefusal('<CODE>', <msg>)` 로 바꾼다.
예외 종류(`BadRequestException`/`NotFoundException`)와 메시지 문자열은 그대로 둔다. 예:

```ts
      throw new NotFoundException(refundRefusal('CHARGE_NOT_FOUND', `Charge not found: ${dto.chargeId}`));
```

`findByIdOrThrow` 의 `REFUND_NOT_FOUND` 는 환불 «요청» 거절이 아니므로 그대로 둔다. 바꾼 뒤
`grep -n "error: '" apps/wallet/src/refunds/refunds.service.ts` 의 결과가 `REFUND_NOT_FOUND` 한 줄뿐인지 확인한다.

`create()` 의 provider 예외 분기 update:

```ts
      await this.dbService.db
        .update(refunds)
        .set({
          reasonMessage: message.slice(0, 500),
          // 응답이 안 왔다 — 돈이 나갔는지 모른다. 일시로 두면 정산이 장부를 다시 맞춘 뒤 이어 간다(스펙 §6.2)
          failureCode: 'PROVIDER_EXCEPTION',
          failureRetryable: true,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));
```

`create()` 의 FAILED 분기 update:

```ts
      await this.dbService.db
        .update(refunds)
        .set({
          reasonMessage: failMessage,
          failureCode: failCode,
          // provider 가 영구/일시를 정한다(토스 코드표 등). 모르면 일시 — 스펙 §6.5
          failureRetryable: providerResult.retryable ?? true,
          updatedAt: new Date(),
        })
        .where(eq(refunds.id, refund.id));
```

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/wallet/src/refunds`
Expected: PASS (기존 포함 전부)

- [ ] **Step 9: 커밋**

```bash
git add apps/wallet/src/refunds/refund-refusal.ts apps/wallet/src/refunds/refund-refusal.spec.ts \
  apps/wallet/src/refunds/refunds.service.ts apps/wallet/src/refunds/refunds.service.spec.ts
git commit -m "feat(wallet): 환불 거절 본문과 FAILED 행에 영구/일시 분류 (#1016 36번 PR 1)"
```

---

### Task 4: 수동 실행 — 외부 결제 몫은 송금 대기, 포인트 몫은 자동

**Files:**
- Modify: `apps/wallet/src/payment-intents/dto/index.ts` (`RefundByIntentDto`)
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (`create`·`createByIntent`·`planIntentRefund`)
- Test: `apps/wallet/src/refunds/refunds.service.spec.ts`

**Interfaces:**
- Consumes: `RefundExecution`, `refundExecutionEnum` (Task 1)
- Produces: `RefundByIntentDto.execution?: RefundExecution`
- Produces: `RefundsService.create(dto: CreateRefundDto, options?: { execution?: RefundExecution }): Promise<Refund>` — `MANUAL` 이면 provider 를 부르지 않고
  `PENDING`·`MANUAL` 행을 돌려준다
- Produces: `RefundsService.createByIntent(intentId, dto: { …기존, execution?: RefundExecution })` — `MANUAL` 이면 POINTS 가 아닌 leg 만 `MANUAL`

- [ ] **Step 1: 테스트 하네스 넓히기**

`apps/wallet/src/refunds/refunds.service.spec.ts`:

```ts
// makeInsertedRefund 교체
function makeInsertedRefund(
  overrides: Partial<{ amount: number; reasonCode: string | null; execution: 'AUTO' | 'MANUAL' }> = {},
) {
  return {
    id: REFUND_ID,
    chargeId: CHARGE_ID,
    intentId: INTENT_ID,
    status: 'PENDING',
    amount: overrides.amount ?? 5000,
    currency: 'KRW',
    reasonCode: overrides.reasonCode ?? null,
    reasonMessage: null,
    providerRefundId: null,
    execution: overrides.execution ?? 'AUTO',
    failureCode: null,
    failureRetryable: null,
    createdAt: new Date(),
  };
}
```

`makeContext` 안, `const updateCalls … = [];` 아래에 `const insertCalls: Array<Record<string, unknown>> = [];` 를 두고 `makeTx` 의 `insert` 를 교체한다:

```ts
      insert: jest.fn().mockImplementation(() => ({
        values: (vals: any) => {
          insertCalls.push(vals);
          return {
            returning: jest
              .fn()
              .mockResolvedValue([
                makeInsertedRefund({ amount: vals.amount, reasonCode: vals.reasonCode, execution: vals.execution }),
              ]),
          };
        },
      })),
```

`makeContext` 의 return 에 `insertCalls` 를 더한다.

`makeMultiChargeContext` 안 `createSpy` 를 교체한다(기존 `calls` 단언은 그대로 두고 집행 방식은 따로 모은다):

```ts
      const executions: Record<string, string> = {};
      const createSpy = jest.spyOn(ctx.service, 'create').mockImplementation(async (dto, options) => {
        calls.push({ chargeId: dto.chargeId, amount: dto.amount });
        executions[dto.chargeId] = options?.execution ?? 'AUTO';
        const outcome = opts.outcomes?.[dto.chargeId] ?? 'SUCCEEDED';
        if (outcome === 'THROW') throw new Error(`boom:${dto.chargeId}`);
        const row: Refund = {
          id: `rf-${dto.chargeId}`,
          chargeId: dto.chargeId,
          intentId: INTENT_ID,
          amount: dto.amount,
          currency: 'KRW',
          status: outcome,
          reasonCode: null,
          reasonMessage: null,
          providerRefundId: null,
          execution: options?.execution ?? 'AUTO',
          failureCode: null,
          failureRetryable: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        return row;
      });
```

그리고 그 함수의 return 을 `return { ...ctx, calls, executions, createSpy, errorLog, refundedTotals };` 로 바꾼다.

- [ ] **Step 2: 수동 실행 테스트 (실패)**

`describe('RefundsService', () => {` 안에 블록을 더한다:

```ts
  describe('수동 실행 create() (#1016 36번 PR 1)', () => {
    it('MANUAL 은 provider 를 부르지 않고 PENDING·MANUAL 행을 돌려준다', async () => {
      const { service, provider, insertCalls, stateTransitionService } = makeContext({ method: makeMethod('TOSS') });

      const refund = await service.create({ chargeId: CHARGE_ID, amount: 5000 }, { execution: 'MANUAL' });

      expect(provider.refund).not.toHaveBeenCalled();
      expect(insertCalls).toEqual([expect.objectContaining({ status: 'PENDING', execution: 'MANUAL', amount: 5000 })]);
      expect(refund).toMatchObject({ status: 'PENDING', execution: 'MANUAL' });
      expect(stateTransitionService.transitionRefund).not.toHaveBeenCalled();
    });

    it('MANUAL 은 무통장에 환불 계좌가 같이 와도 토스를 부르지 않는다 — 사람이 송금한다', async () => {
      const { service, provider } = makeContext({ method: makeMethod('BANK_TRANSFER') });

      await service.create(
        {
          chargeId: CHARGE_ID,
          amount: 5000,
          refundReceiveAccount: { bank: '06', accountNumber: '1234567890', holderName: '홍길동' },
        },
        { execution: 'MANUAL' },
      );

      expect(provider.refund).not.toHaveBeenCalled();
    });

    it('MANUAL 도 검증은 같다 — 남은 금액을 넘으면 400', async () => {
      const { service, provider } = makeContext({ priorRefundedAmount: 8000 });

      await expect(service.create({ chargeId: CHARGE_ID, amount: 5000 }, { execution: 'MANUAL' })).rejects.toThrow(
        BadRequestException,
      );
      expect(provider.refund).not.toHaveBeenCalled();
    });

    it('기본은 AUTO — 행에 execution AUTO, provider 를 부른다', async () => {
      const { service, provider, insertCalls } = makeContext();

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(insertCalls).toEqual([expect.objectContaining({ execution: 'AUTO' })]);
      expect(provider.refund).toHaveBeenCalledTimes(1);
    });
  });
```

`describe('createByIntent — 복합결제: …')` 안, 마지막 테스트 뒤에 더한다:

```ts
    it('MANUAL: 카드 몫은 MANUAL, 포인트 몫은 AUTO — 순서·분할은 AUTO 와 같다', async () => {
      const { service, calls, executions } = makeMultiChargeContext({ charges: POINTS_THEN_CARD });

      await service.createByIntent(INTENT_ID, { amount: 10000, execution: 'MANUAL' });

      expect(calls).toEqual([
        { chargeId: 'C1', amount: 7000 },
        { chargeId: 'P1', amount: 3000 },
      ]);
      expect(executions).toEqual({ C1: 'MANUAL', P1: 'AUTO' });
    });

    it('MANUAL 은 자동 환불 못 하는 수단(효성 CMS)도 받는다 — REFUND_NOT_AUTOMATABLE 로 막지 않는다', async () => {
      const { service, calls, executions } = makeMultiChargeContext({
        charges: [
          { id: 'P1', amount: 3000, type: 'POINTS' },
          { id: 'M1', amount: 7000, type: 'CMS_BATCH' },
        ],
      });

      await service.createByIntent(INTENT_ID, { amount: 10000, execution: 'MANUAL' });

      expect(calls.map((c) => c.chargeId)).toEqual(['M1', 'P1']);
      expect(executions).toEqual({ M1: 'MANUAL', P1: 'AUTO' });
    });

    it('execution 없으면 전부 AUTO(지금과 같다)', async () => {
      const { service, executions } = makeMultiChargeContext({ charges: POINTS_THEN_CARD });

      await service.createByIntent(INTENT_ID, { amount: 10000 });

      expect(executions).toEqual({ C1: 'AUTO', P1: 'AUTO' });
    });
```

- [ ] **Step 3: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refunds.service.spec.ts -t "수동 실행|MANUAL|execution 없으면"`
Expected: FAIL — provider 가 불림, `execution` 이 insert 에 없음, CMS 에서 `REFUND_NOT_AUTOMATABLE`

- [ ] **Step 4: DTO**

```ts
// apps/wallet/src/payment-intents/dto/index.ts — class-validator import 에 IsIn 추가, schema import 추가
import { RefundExecution, refundExecutionEnum } from '../../schema';

// RefundByIntentDto 안, refundReceiveAccount 아래
  @ApiPropertyOptional({
    enum: refundExecutionEnum.enumValues,
    description:
      'MANUAL: 외부 결제 몫은 PG 를 부르지 않고 송금 대기(PENDING)로 남긴다 — 운영자가 고객 계좌로 송금한 뒤 [송금 완료]. ' +
      '포인트 몫은 그대로 자동으로 되돌린다. 기본 AUTO',
  })
  @IsOptional()
  @IsIn([...refundExecutionEnum.enumValues])
  execution?: RefundExecution;
```

(파일이 이미 `../../schema` 에서 다른 것을 import 하면 그 줄에 합친다.)

- [ ] **Step 5: 서비스 구현**

`apps/wallet/src/refunds/refunds.service.ts`:

```ts
// import 교체
import { WalletSchema, charges as chargesTable, refunds, paymentIntents, RefundExecution } from '../schema';
```

`create` 시그니처와 insert, 그리고 트랜잭션 직후:

```ts
  /**
   * 결제분 하나를 환불한다. execution = MANUAL 이면 provider 를 부르지 않고 «송금 대기»(PENDING) 행만 남긴다 —
   * 운영자가 고객 계좌로 송금한 뒤 confirmManual 로 닫는다. PENDING 은 남은 금액에서 이미 빠지므로 같은 돈이 두 번 나가지 않는다.
   */
  async create(dto: CreateRefundDto, options: { execution?: RefundExecution } = {}): Promise<Refund> {
    const execution: RefundExecution = options.execution ?? 'AUTO';
```

insert `.values({...})` 에 `providerRefundId: null,` 아래로 `execution,` 를 더한다. 트랜잭션(`const refund = await this.dbService.db.transaction(...)`) 바로 뒤에:

```ts
    if (execution === 'MANUAL') {
      this.logger.log(`Manual refund awaiting transfer: refundId=${refund.id} charge=${charge.id} amount=${dto.amount}`);
      return refund;
    }
```

`createByIntent` dto 타입에 `execution?: RefundExecution;` 를 더하고, 계획·집행을 바꾼다:

```ts
    const plan = await this.planIntentRefund(intentId, refundableCharges, dto.amount, dto.execution ?? 'AUTO');
    …
        refund = await this.create(
          {
            chargeId: leg.chargeId,
            amount: leg.amount,
            reasonCode: dto.reasonCode,
            reasonMessage: dto.reasonMessage,
            allowMembershipRefund: dto.allowMembershipRefund,
            refundReceiveAccount: dto.refundReceiveAccount,
          },
          { execution: leg.execution },
        );
```

`planIntentRefund` 전체 교체(Task 3 의 `refundRefusal` 적용분 포함):

```ts
  /**
   * intent 환불 계획: charge 별 남은 금액(원금 − SUCCEEDED·PENDING 환불)을 구해 그 비례로 나누고,
   * 돈을 움직이기 전에 총량·자동환불 가능 여부를 검사한 뒤 실행 순서(외부 결제 먼저, 포인트 마지막)로 돌려준다.
   *
   * 포인트가 마지막인 이유: 포인트 환불은 되돌릴 수단이 없는데(REDEEM_CANCEL 의 역연산 없음) 원장 안에서
   * 끝나 실패할 일이 거의 없다. 실패 가능성이 큰 외부 PG 를 먼저 해서, 그게 실패하면 아무 돈도 안 나간 채로 멈춘다.
   *
   * execution = MANUAL 이면 외부 결제 leg 는 PG 를 부르지 않으므로 «자동 환불 가능» 검사를 건너뛴다(효성 CMS 도 받는다).
   * 포인트 leg 는 MANUAL 이어도 원장으로 자동 환불한다(스펙 §6.3).
   */
  private async planIntentRefund(
    intentId: string,
    refundableCharges: Charge[],
    amount: number,
    execution: RefundExecution,
  ): Promise<Array<{ chargeId: string; amount: number; methodType: string; execution: RefundExecution }>> {
    const refunded = await this.getActiveRefundedTotalsByCharge(refundableCharges.map((c) => c.id));
    const open = refundableCharges
      .map((charge) => ({ charge, remaining: charge.amount - (refunded.get(charge.id) ?? 0) }))
      .filter((leg) => leg.remaining > 0);

    const totalRemaining = open.reduce((sum, leg) => sum + leg.remaining, 0);
    if (amount > totalRemaining) {
      throw new BadRequestException(
        refundRefusal(
          'REFUND_AMOUNT_EXCEEDS_TOTAL',
          `Refund amount (${amount}) exceeds remaining refundable amount (${totalRemaining}) for intent ${intentId}`,
        ),
      );
    }

    // 분할 순서 = charge 생성 순서(기존과 같다) — 마지막 leg 가 반올림 나머지를 흡수한다.
    const shares = splitRefundOverRemaining(open, amount);
    const planned: Array<{ chargeId: string; amount: number; methodType: string; execution: RefundExecution }> = [];
    for (let i = 0; i < open.length; i++) {
      if (shares[i] <= 0) continue;
      const charge = open[i].charge;
      const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
      if (!method) {
        throw new NotFoundException(
          refundRefusal('PAYMENT_METHOD_NOT_FOUND', `Payment method not found: ${charge.paymentMethodId}`),
        );
      }
      const legExecution: RefundExecution = execution === 'MANUAL' && method.type !== 'POINTS' ? 'MANUAL' : 'AUTO';
      // 효성 CMS 처럼 PG 환불 API 가 없는 수단은 provider 가 반드시 FAILED 를 낸다. 복합결제에서 그 leg 가
      // 뒤에 있으면 앞 leg 만 나가고 멈춘다 — 아무것도 움직이기 전에 거절한다. 수동 집행 leg 는 PG 를 안 부르므로 검사하지 않는다.
      if (legExecution === 'AUTO' && !supportsAutoRefund(method.type)) {
        throw new BadRequestException(
          refundRefusal(
            'REFUND_NOT_AUTOMATABLE',
            `Payment method ${method.type} cannot be refunded automatically (charge ${charge.id}); refund must be handled manually`,
          ),
        );
      }
      planned.push({ chargeId: charge.id, amount: shares[i], methodType: method.type, execution: legExecution });
    }

    return [
      ...planned.filter((leg) => leg.methodType !== 'POINTS'),
      ...planned.filter((leg) => leg.methodType === 'POINTS'),
    ];
  }
```

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/wallet/src/refunds`
Expected: PASS (기존 포함 전부)

- [ ] **Step 7: 커밋**

```bash
git add apps/wallet/src/payment-intents/dto/index.ts apps/wallet/src/refunds/refunds.service.ts apps/wallet/src/refunds/refunds.service.spec.ts
git commit -m "feat(wallet): 환불 수동 실행 — 외부 결제 몫은 PG 없이 송금 대기, 포인트 몫은 자동 (#1016 36번 PR 1)"
```

---

### Task 5: 송금 완료를 결제수단과 무관하게 — `MANUAL` 행이면 받는다

**Files:**
- Create: `apps/wallet/src/refunds/manual-confirmable.ts`
- Test: `apps/wallet/src/refunds/manual-confirmable.spec.ts`
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (`confirmManual`)
- Modify: `apps/wallet/src/admin/payment-intent-admin.service.ts` (상세 `manualConfirmable`)
- Modify: `apps/wallet/src/admin/refund-admin.controller.ts` (`confirmManual` 의 catch)
- Test: `apps/wallet/src/refunds/refunds.service.spec.ts`, Create `apps/wallet/src/admin/refund-admin.controller.spec.ts`

**Interfaces:**
- Consumes: `Refund.execution` (Task 1), `MANUAL` 행 (Task 4)
- Produces: `export function isManuallyConfirmable(r: { status: RefundStatus; execution: RefundExecution; methodType: string | null }): boolean`

- [ ] **Step 1: 규칙 테스트 (실패)**

```ts
// apps/wallet/src/refunds/manual-confirmable.spec.ts
import { isManuallyConfirmable } from './manual-confirmable';

describe('isManuallyConfirmable — 운영자의 [송금 완료]를 받을 수 있는 환불 행인가', () => {
  it.each([
    ['PENDING · MANUAL · 카드', { status: 'PENDING', execution: 'MANUAL', methodType: 'TOSS' }, true],
    ['PENDING · MANUAL · 효성 CMS', { status: 'PENDING', execution: 'MANUAL', methodType: 'CMS_BATCH' }, true],
    ['PENDING · AUTO · 무통장 (지금과 같다)', { status: 'PENDING', execution: 'AUTO', methodType: 'BANK_TRANSFER' }, true],
    ['PENDING · AUTO · 카드 (PG 가 처리 중)', { status: 'PENDING', execution: 'AUTO', methodType: 'TOSS' }, false],
    ['PENDING · AUTO · 결제수단 모름', { status: 'PENDING', execution: 'AUTO', methodType: null }, false],
    ['SUCCEEDED · MANUAL', { status: 'SUCCEEDED', execution: 'MANUAL', methodType: 'TOSS' }, false],
    ['FAILED · AUTO · 무통장', { status: 'FAILED', execution: 'AUTO', methodType: 'BANK_TRANSFER' }, false],
  ] as const)('%s → %s', (_label, row, expected) => {
    expect(isManuallyConfirmable(row)).toBe(expected);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/manual-confirmable.spec.ts`
Expected: FAIL — `Cannot find module './manual-confirmable'`

- [ ] **Step 3: 규칙 구현**

```ts
// apps/wallet/src/refunds/manual-confirmable.ts
import type { RefundExecution, RefundStatus } from '../schema';

/**
 * 운영자가 [송금 완료](confirmManual)로 닫을 수 있는 환불 행인가.
 * 수동 실행(MANUAL) 행은 결제수단과 무관하게, 무통장은 지금처럼 계좌를 몰라 PENDING 으로 떨어진 행을 받는다.
 * PG 가 처리 중인 AUTO PENDING 은 받지 않는다 — 사람이 닫으면 PG 결과와 갈린다.
 */
export function isManuallyConfirmable(r: {
  status: RefundStatus;
  execution: RefundExecution;
  methodType: string | null;
}): boolean {
  return r.status === 'PENDING' && (r.execution === 'MANUAL' || r.methodType === 'BANK_TRANSFER');
}
```

- [ ] **Step 4: 규칙 통과 확인**

Run: `npx jest apps/wallet/src/refunds/manual-confirmable.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 서비스·컨트롤러 테스트 (실패)**

`apps/wallet/src/refunds/refunds.service.spec.ts` 의 `describe('BANK_TRANSFER provider', …)` 안, `'confirmManual: BANK_TRANSFER는 SUCCEEDED + REFUND_SUCCEEDED outbox 발행'` 뒤에 더한다:

```ts
    it('confirmManual: 카드 결제분이라도 MANUAL 행이면 받는다 (#1016 36번 PR 1)', async () => {
      const { service, chargesService, paymentMethodsService, stateTransitionService } = makeContext({
        method: makeMethod('TOSS'),
        pendingRefund: makeInsertedRefund({ execution: 'MANUAL' }),
      });
      chargesService.findById = jest.fn().mockResolvedValue(makeCharge());
      paymentMethodsService.findById = jest.fn().mockResolvedValue(makeMethod('TOSS'));

      await service.confirmManual(REFUND_ID);

      expect(stateTransitionService.transitionRefund).toHaveBeenCalledWith(
        REFUND_ID,
        'SUCCEEDED',
        expect.objectContaining({ reasonCode: 'MANUAL_CONFIRM' }),
        'PENDING',
        expect.anything(),
      );
    });

    it('confirmManual: 카드 AUTO PENDING 은 400 REFUND_NOT_MANUALLY_CONFIRMABLE', async () => {
      const { service, chargesService, paymentMethodsService } = makeContext({
        method: makeMethod('TOSS'),
        pendingRefund: makeInsertedRefund({ execution: 'AUTO' }),
      });
      chargesService.findById = jest.fn().mockResolvedValue(makeCharge());
      paymentMethodsService.findById = jest.fn().mockResolvedValue(makeMethod('TOSS'));

      const error = await service.confirmManual(REFUND_ID).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ error: 'REFUND_NOT_MANUALLY_CONFIRMABLE' });
    });
```

(기존 `'confirmManual: BANK_TRANSFER가 아닌 결제수단은 거절'` 은 메시지에 `BANK_TRANSFER` 가 남으므로 그대로 초록이어야 한다.)

```ts
// apps/wallet/src/admin/refund-admin.controller.spec.ts
import { BadRequestException } from '@nestjs/common';
import { RefundAdminController } from './refund-admin.controller';

function controllerWith(confirmManual: jest.Mock) {
  return new RefundAdminController({} as never, { confirmManual } as never);
}

describe('RefundAdminController.confirmManual — 오류 상태 코드', () => {
  it('서비스가 던진 HttpException 은 그대로 내보낸다(500 으로 바꾸지 않는다)', async () => {
    const refusal = new BadRequestException({ error: 'REFUND_NOT_MANUALLY_CONFIRMABLE', message: '수동 완료 불가' });
    await expect(controllerWith(jest.fn().mockRejectedValue(refusal)).confirmManual('rf-1')).rejects.toBe(refusal);
  });

  it('옛 문자열 오류(PENDING 아님)는 지금처럼 400', async () => {
    const confirm = jest.fn().mockRejectedValue(new Error('환불이 PENDING 상태가 아닙니다: SUCCEEDED'));
    await expect(controllerWith(confirm).confirmManual('rf-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 6: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refunds.service.spec.ts apps/wallet/src/admin/refund-admin.controller.spec.ts -t "MANUAL|AUTO PENDING|HttpException"`
Expected: FAIL — 카드 MANUAL 이 «무통장만» 으로 거절됨, AUTO PENDING 이 `Error`(400 아님), 컨트롤러가 HttpException 을 500 으로 바꿈

- [ ] **Step 7: 구현**

`apps/wallet/src/refunds/refunds.service.ts` — import 에 `import { isManuallyConfirmable } from './manual-confirmable';`, `confirmManual` 의 결제수단 검사 교체:

```ts
    const method = await this.paymentMethodsService.findById(charge.paymentMethodId);
    if (!isManuallyConfirmable({ status: refund.status, execution: refund.execution, methodType: method?.type ?? null })) {
      throw new BadRequestException({
        error: 'REFUND_NOT_MANUALLY_CONFIRMABLE',
        message: '수동 완료 처리는 무통장 환불(BANK_TRANSFER)이나 수동 실행(MANUAL) 환불만 가능합니다.',
      });
    }
```

`apps/wallet/src/admin/refund-admin.controller.ts` — `HttpException` 을 import 하고 `confirmManual` 의 catch 첫 줄에:

```ts
    } catch (e: any) {
      if (e instanceof HttpException) throw e;
```

`apps/wallet/src/admin/payment-intent-admin.service.ts` 상세 `refundData` map 의 `manualConfirmable` 줄 교체(import `isManuallyConfirmable` from `'../refunds/manual-confirmable'`):

```ts
      manualConfirmable: isManuallyConfirmable({
        status: r.status,
        execution: r.execution,
        methodType: r.paymentMethodType ?? null,
      }),
```

(관리자 «목록»의 `manualConfirmable: false` 는 그대로 둔다 — 결제수단 조인이 없다는 기존 주석대로다. admin-web 의 송금 대기 노출은 PR 5 범위.)

- [ ] **Step 8: 통과 확인**

Run: `npx jest apps/wallet/src/refunds apps/wallet/src/admin`
Expected: PASS (통합 스펙은 skip)

- [ ] **Step 9: 커밋**

```bash
git add apps/wallet/src/refunds/manual-confirmable.ts apps/wallet/src/refunds/manual-confirmable.spec.ts \
  apps/wallet/src/refunds/refunds.service.ts apps/wallet/src/refunds/refunds.service.spec.ts \
  apps/wallet/src/admin/payment-intent-admin.service.ts apps/wallet/src/admin/refund-admin.controller.ts \
  apps/wallet/src/admin/refund-admin.controller.spec.ts
git commit -m "feat(wallet): 송금 완료를 MANUAL 환불 행이면 결제수단과 무관하게 받는다 (#1016 36번 PR 1)"
```

---

### Task 6: 환불 목록 API — `GET /v1/payment-intents/:id/refunds`

**Files:**
- Modify: `apps/wallet/src/refunds/dto/index.ts` (`RefundListItemDto`)
- Modify: `apps/wallet/src/refunds/refund-response.ts` (`toRefundListItem`)
- Modify: `apps/wallet/src/refunds/refund-response.spec.ts`
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (`listByIntent`)
- Modify: `apps/wallet/src/payment-intents/payment-intents.controller.ts` (라우트)
- Test (Create): `apps/wallet/src/payment-intents/payment-intents.refunds-list.spec.ts`

**Interfaces:**
- Produces: `RefundsService.listByIntent(intentId: string): Promise<Refund[]>` — 상태 무관 전부, `createdAt`·`id` 오름차순
- Produces: `RefundListItemDto { id; chargeId; status: RefundStatus; amount; reasonCode: string | null; execution: RefundExecution; createdAt: Date }`
- Produces: `export function toRefundListItem(refund: Refund): RefundListItemDto`
- Produces: HTTP `GET /v1/payment-intents/:id/refunds` (API 키, 기본 가드) → `RefundListItemDto[]`, 없는 intent 는 404 `INTENT_NOT_FOUND`

목록은 상태를 거르지 않는다 — Medusa 장부 맞추기(스펙 §6.2)는 SUCCEEDED·PENDING 만 쓰고, core(§8.2)는 MANUAL 행의 SUCCEEDED 여부를 본다. 거르는 건 호출자 몫이다.

- [ ] **Step 1: 매퍼·컨트롤러 테스트 (실패)**

`apps/wallet/src/refunds/refund-response.spec.ts` — import 를 `import { toRefundListItem, toRefundResponse } from './refund-response';` 로 바꾸고 끝에 더한다:

```ts
describe('toRefundListItem', () => {
  it('스펙 §6.5 의 일곱 칸만 낸다', () => {
    expect(toRefundListItem(row({ status: 'PENDING', execution: 'MANUAL' }))).toEqual({
      id: 'rf-1',
      chargeId: 'ch-1',
      status: 'PENDING',
      amount: 5000,
      reasonCode: 'MEDUSA_REFUND',
      execution: 'MANUAL',
      createdAt: new Date('2026-10-11T00:00:00Z'),
    });
  });
});
```

```ts
// apps/wallet/src/payment-intents/payment-intents.refunds-list.spec.ts
import { NotFoundException } from '@nestjs/common';
import type { Refund } from '../types';
import { PaymentIntentsController } from './payment-intents.controller';

const refund = (id: string, status: Refund['status'], execution: Refund['execution']): Refund => ({
  id,
  chargeId: 'ch-1',
  intentId: 'in-1',
  amount: 1000,
  currency: 'KRW',
  status,
  reasonCode: null,
  reasonMessage: null,
  providerRefundId: null,
  execution,
  failureCode: null,
  failureRetryable: null,
  createdAt: new Date('2026-10-11T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
});

describe('GET /v1/payment-intents/:id/refunds', () => {
  it('intent 의 환불을 서비스 순서대로 목록 칸으로 낸다', async () => {
    const intents = { findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'in-1' }) };
    const refunds = {
      listByIntent: jest.fn().mockResolvedValue([refund('rf-1', 'FAILED', 'AUTO'), refund('rf-2', 'PENDING', 'MANUAL')]),
    };
    const controller = new PaymentIntentsController(intents as never, refunds as never);

    const result = await controller.listRefunds('in-1');

    expect(refunds.listByIntent).toHaveBeenCalledWith('in-1');
    expect(result.map((r) => [r.id, r.status, r.execution])).toEqual([
      ['rf-1', 'FAILED', 'AUTO'],
      ['rf-2', 'PENDING', 'MANUAL'],
    ]);
  });

  it('없는 intent 는 404 그대로, 목록을 읽지 않는다', async () => {
    const notFound = new NotFoundException({ error: 'INTENT_NOT_FOUND', message: 'Payment intent not found: x' });
    const intents = { findByIdOrThrow: jest.fn().mockRejectedValue(notFound) };
    const refunds = { listByIntent: jest.fn() };
    const controller = new PaymentIntentsController(intents as never, refunds as never);

    await expect(controller.listRefunds('x')).rejects.toBe(notFound);
    expect(refunds.listByIntent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refund-response.spec.ts apps/wallet/src/payment-intents/payment-intents.refunds-list.spec.ts`
Expected: FAIL — `toRefundListItem` 없음, `controller.listRefunds is not a function`

- [ ] **Step 3: DTO·매퍼·서비스·라우트**

```ts
// apps/wallet/src/refunds/dto/index.ts — schema import 에 refundStatusEnum 추가, 파일 끝에
/** 환불 목록 한 줄 — 정산 직전 장부 맞추기(Medusa)·송금 여부 확인(core)이 읽는다(스펙 §6.2·§8.2). */
export class RefundListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chargeId: string;

  @ApiProperty({ enum: refundStatusEnum.enumValues })
  status: RefundStatus;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  reasonCode: string | null;

  @ApiProperty({ enum: refundExecutionEnum.enumValues })
  execution: RefundExecution;

  @ApiProperty()
  createdAt: Date;
}
```

```ts
// apps/wallet/src/refunds/refund-response.ts — import 에 RefundListItemDto 추가, 끝에
export function toRefundListItem(refund: Refund): RefundListItemDto {
  return {
    id: refund.id,
    chargeId: refund.chargeId,
    status: refund.status,
    amount: refund.amount,
    reasonCode: refund.reasonCode,
    execution: refund.execution,
    createdAt: refund.createdAt,
  };
}
```

```ts
// apps/wallet/src/refunds/refunds.service.ts — findByIdOrThrow 위
  /** intent 의 환불 전부(상태 무관), 만든 순서. 거르는 건 호출자 몫이다(스펙 §6.2·§8.2). */
  async listByIntent(intentId: string): Promise<Refund[]> {
    return this.dbService.db
      .select()
      .from(refunds)
      .where(eq(refunds.intentId, intentId))
      .orderBy(asc(refunds.createdAt), asc(refunds.id));
  }
```

```ts
// apps/wallet/src/payment-intents/payment-intents.controller.ts — refundability 라우트 위
// import: toRefundListItem 을 '../refunds/refund-response' 에서, RefundListItemDto 를 '../refunds/dto' 에서

  @Get(':id/refunds')
  @ApiOperation({
    summary: 'List refunds of a payment intent (API-key, server-to-server)',
    description: '상태 무관 전부, 만든 순서. 채널 취소 정산 직전 Medusa 가 장부를 맞출 때 읽는다.',
  })
  async listRefunds(@Param('id') id: string): Promise<RefundListItemDto[]> {
    await this.service.findByIdOrThrow(id);
    const refunds = await this.refundsService.listByIntent(id);
    return refunds.map(toRefundListItem);
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/wallet/src/refunds apps/wallet/src/payment-intents`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/wallet/src/refunds/dto/index.ts apps/wallet/src/refunds/refund-response.ts apps/wallet/src/refunds/refund-response.spec.ts \
  apps/wallet/src/refunds/refunds.service.ts apps/wallet/src/payment-intents/payment-intents.controller.ts \
  apps/wallet/src/payment-intents/payment-intents.refunds-list.spec.ts
git commit -m "feat(wallet): 환불 목록 API GET /v1/payment-intents/:id/refunds (#1016 36번 PR 1)"
```

---

### Task 7: 실 Postgres 로 전 흐름 — 마이그레이션·수동 실행·송금 완료·분류·목록

**Files:**
- Test (Create): `apps/wallet/src/refunds/refund-settlement.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1~6 전부. `RefundsService` 를 실제 `ChargesService`·`PaymentMethodsService`·`StateTransitionService`·`PointsPaymentProvider` 로 조립하고,
  외부 PG provider 만 가짜(`refund` 목)로, outbox 발행자만 목(`enqueue`)으로 둔다

단위 스펙의 목 하네스는 SQL·마이그레이션·상태기계를 안 지난다. 이 태스크가 «PENDING 이 남은 금액에서 빠진다»·«두 번째 MANUAL 이 막힌다»·
«확정분 포인트 몫이 실제로 원장으로 돌아간다»를 진짜로 확인한다.

- [ ] **Step 1: 통합 스펙 작성**

```ts
// apps/wallet/src/refunds/refund-settlement.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { HttpException } from '@nestjs/common';
import type { DbService } from '@app/db';
import {
  charges,
  paymentIntents,
  paymentMethods,
  paymentStateTransitions,
  pointEventDetails,
  pointEvents,
  pointHoldDetails,
  pointHolds,
  refunds,
  walletSchema,
  WalletSchema,
} from '../schema';
import { ChargesService } from '../charges/charges.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { StateTransitionService } from '../domain/state-transition/state-transition.service';
import type { ProviderRegistry } from '../providers/provider.registry';
import type { CashReceiptsService } from '../cash-receipts/cash-receipts.service';
import type { PaymentProvider, RefundParams, RefundResult } from '../providers/payment-provider.interface';
import { PointsAdminService } from '../admin/points-admin.service';
import { PointsLedgerService } from '../providers/points/points-ledger.service';
import { PointsPaymentProvider } from '../providers/points/points.provider';
import { RefundsService } from './refunds.service';

/**
 * #1016 36번 PR 1 — 환불 수동 실행·실패 분류·송금 완료·목록을 실 Postgres 로.
 * 외부 PG provider 와 outbox 발행자만 가짜다. 포인트는 진짜 원장(PR 0 의 확정분 원장 키 포함)을 지난다.
 *
 * 실행: 스크래치 DB 에 wallet 마이그레이션 적용 후
 *   DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/wallet_itest REQUIRE_WALLET_DB=1 \
 *     npx jest apps/wallet/src/refunds/refund-settlement.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

type Seeded = { intentId: string; userId: string; tossChargeId?: string; pointsChargeId?: string; cmsChargeId?: string };

describeIfDb('환불 정산 — 수동 실행·실패 분류·송금 완료·목록 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<WalletSchema>;
  let service: RefundsService;
  let pointsProvider: PointsPaymentProvider;
  let pointsAdmin: PointsAdminService;
  const externalRefund = jest.fn<Promise<RefundResult>, [RefundParams]>();
  const enqueue = jest.fn().mockResolvedValue(undefined);
  const intentIds: string[] = [];
  const methodIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: walletSchema });
    const dbService = { db } as unknown as DbService<WalletSchema>;
    pointsProvider = new PointsPaymentProvider(dbService, new PointsLedgerService());
    pointsAdmin = new PointsAdminService(dbService);
    const externalProvider = { refund: externalRefund } as unknown as PaymentProvider;
    const registry = {
      getProviderOrThrow: (type: string) => (type === 'POINTS' ? pointsProvider : externalProvider),
    } as unknown as ProviderRegistry;
    const cashReceipts = { cancelForRefund: async () => undefined } as unknown as CashReceiptsService;
    service = new RefundsService(
      dbService,
      new ChargesService(dbService),
      cashReceipts,
      new PaymentMethodsService(dbService, registry),
      registry,
      new StateTransitionService(dbService, { enqueue } as never),
    );
  });

  beforeEach(() => {
    externalRefund.mockReset();
    enqueue.mockClear();
  });

  afterAll(async () => {
    if (intentIds.length > 0) {
      const refundRows = await db.select({ id: refunds.id }).from(refunds).where(inArray(refunds.intentId, intentIds));
      const chargeRows = await db.select({ id: charges.id }).from(charges).where(inArray(charges.intentId, intentIds));
      const entityIds = [...refundRows.map((r) => r.id), ...chargeRows.map((c) => c.id)];
      if (entityIds.length > 0) {
        await db.delete(paymentStateTransitions).where(inArray(paymentStateTransitions.entityId, entityIds));
      }
      await db.delete(refunds).where(inArray(refunds.intentId, intentIds));
      await db.delete(charges).where(inArray(charges.intentId, intentIds));
      await db.delete(paymentIntents).where(inArray(paymentIntents.id, intentIds));
    }
    if (methodIds.length > 0) await db.delete(paymentMethods).where(inArray(paymentMethods.id, methodIds));
    if (userIds.length > 0) {
      const holds = await db.select({ id: pointHolds.id }).from(pointHolds).where(inArray(pointHolds.userId, userIds));
      if (holds.length > 0) {
        await db.delete(pointHoldDetails).where(inArray(pointHoldDetails.holdId, holds.map((h) => h.id)));
        await db.delete(pointHolds).where(inArray(pointHolds.userId, userIds));
      }
      await db.delete(pointEventDetails).where(inArray(pointEventDetails.userId, userIds));
      await db.delete(pointEvents).where(inArray(pointEvents.userId, userIds));
    }
    await sql.end();
  });

  async function method(userId: string, type: 'TOSS' | 'POINTS' | 'CMS_BATCH'): Promise<string> {
    const id = randomUUID();
    methodIds.push(id);
    await db.insert(paymentMethods).values({ id, userId, type });
    return id;
  }

  async function capturedCharge(intentId: string, paymentMethodId: string, amount: number, createdAt: Date, requestPayload: Record<string, unknown> | null = null) {
    const id = randomUUID();
    await db.insert(charges).values({
      id,
      intentId,
      paymentMethodId,
      amount,
      currency: 'KRW',
      operation: 'CAPTURE',
      status: 'SUCCEEDED',
      providerTransactionId: `itest-${id}`,
      providerIdempotencyKey: `itest-${id}`,
      requestPayload,
      createdAt,
    });
    return id;
  }

  /** 확정까지 끝난 결제 하나. 포인트는 진짜 원장으로 승인·확정한다(capture.service.ts 와 같이 원장 키 = 승인 결제분 id). */
  async function seed(legs: { toss?: number; points?: number; cms?: number }): Promise<Seeded> {
    const userId = `itest-settle-${randomUUID()}`;
    userIds.push(userId);
    const intentId = randomUUID();
    intentIds.push(intentId);
    const total = (legs.toss ?? 0) + (legs.points ?? 0) + (legs.cms ?? 0);
    await db.insert(paymentIntents).values({
      id: intentId,
      userId,
      payableAmount: total,
      currency: 'KRW',
      status: 'SUCCEEDED',
      clientSecret: `itest-${intentId.slice(0, 20)}`,
      expiresAt: new Date('2031-01-01T00:00:00Z'),
      metadata: {},
    });
    const seeded: Seeded = { intentId, userId };
    const t0 = Date.now() - 60_000;

    if (legs.points) {
      await pointsAdmin.earn(userId, 10_000, 'ITEST');
      const pmId = await method(userId, 'POINTS');
      const authorizeId = randomUUID();
      const base = { intentId, paymentMethodId: pmId, userId, amount: legs.points, currency: 'KRW', correlationId: 'itest' };
      expect((await pointsProvider.authorize({ ...base, chargeId: authorizeId, idempotencyKey: `wallet:authorize:${authorizeId}` })).status).toBe('SUCCEEDED');
      expect((await pointsProvider.capture({ ...base, chargeId: authorizeId, idempotencyKey: `wallet:capture:${authorizeId}` })).status).toBe('SUCCEEDED');
      seeded.pointsChargeId = await capturedCharge(intentId, pmId, legs.points, new Date(t0), { intentId, authorizeChargeId: authorizeId });
    }
    if (legs.toss) {
      seeded.tossChargeId = await capturedCharge(intentId, await method(userId, 'TOSS'), legs.toss, new Date(t0 + 1_000));
    }
    if (legs.cms) {
      seeded.cmsChargeId = await capturedCharge(intentId, await method(userId, 'CMS_BATCH'), legs.cms, new Date(t0 + 2_000));
    }
    return seeded;
  }

  async function rowsOf(intentId: string) {
    return db.select().from(refunds).where(eq(refunds.intentId, intentId));
  }

  async function refusalOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      return (e as HttpException).getResponse() as Record<string, unknown>;
    }
    throw new Error('expected rejection');
  }

  it('기본(AUTO): 외부 결제분은 provider 를 부르고 행은 execution AUTO, 실패 칸 null', async () => {
    const s = await seed({ toss: 10_000 });
    externalRefund.mockResolvedValue({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const [row] = await service.createByIntent(s.intentId, { amount: 4_000 });

    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'SUCCEEDED', execution: 'AUTO', failureCode: null, failureRetryable: null });
  });

  it('AUTO + PG 영구 거절: FAILED 행에 failure_code·failure_retryable=false 가 남는다', async () => {
    const s = await seed({ toss: 10_000 });
    externalRefund.mockResolvedValue({
      status: 'FAILED',
      errorCode: 'ALREADY_CANCELED_PAYMENT',
      errorMessage: '이미 취소된 결제 입니다.',
      retryable: false,
    });

    await service.createByIntent(s.intentId, { amount: 10_000 });

    expect(await rowsOf(s.intentId)).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        execution: 'AUTO',
        failureCode: 'ALREADY_CANCELED_PAYMENT',
        failureRetryable: false,
        reasonMessage: '이미 취소된 결제 입니다.',
      }),
    ]);
  });

  it('MANUAL 카드+포인트: 카드 몫은 PG 없이 송금 대기, 포인트 몫은 원장으로 되돌린다 — 남은 금액 0', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });

    const result = await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    expect(externalRefund).not.toHaveBeenCalled();
    expect(result.map((r) => [r.chargeId, r.status, r.execution, r.amount])).toEqual([
      [s.tossChargeId, 'PENDING', 'MANUAL', 7_000],
      [s.pointsChargeId, 'SUCCEEDED', 'AUTO', 3_000],
    ]);
    const cancels = await sql`
      select amount from point_events where user_id = ${s.userId} and event_type = 'REDEEM_CANCEL'`;
    expect(cancels).toEqual([{ amount: 3_000 }]);

    const refundability = await service.getRefundability(s.intentId);
    expect(refundability).toMatchObject({ pendingRefundAmount: 7_000, remainingRefundableAmount: 0 });
  });

  it('같은 MANUAL 요청이 다시 오면 400 REFUND_AMOUNT_EXCEEDS_TOTAL(retryable) — 송금 대기가 두 줄 생기지 않는다', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });
    await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' }));

    expect(refusal).toMatchObject({ error: 'REFUND_AMOUNT_EXCEEDS_TOTAL', retryable: true });
    expect(await rowsOf(s.intentId)).toHaveLength(2);
  });

  it('confirmManual 이 카드 결제분의 수동 행을 받는다 — SUCCEEDED, 결제분 REFUNDED, 환불 성공 이벤트', async () => {
    const s = await seed({ toss: 7_000, points: 3_000 });
    const [manual] = await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });
    enqueue.mockClear(); // 포인트 몫 환불이 낸 이벤트를 지운다 — 아래 단언은 송금 완료가 낸 것만 본다

    const confirmed = await service.confirmManual(manual.id);

    expect(confirmed).toMatchObject({ status: 'SUCCEEDED', execution: 'MANUAL' });
    const [tossCharge] = await db.select().from(charges).where(eq(charges.id, s.tossChargeId as string));
    expect(tossCharge.status).toBe('REFUNDED');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'gateway.refund.succeeded' }),
      expect.anything(),
    );
  });

  it('MANUAL 은 자동 환불 못 하는 수단(효성 CMS)도 받는다 — AUTO 는 지금처럼 REFUND_NOT_AUTOMATABLE(영구)', async () => {
    const s = await seed({ cms: 10_000 });

    expect(await refusalOf(service.createByIntent(s.intentId, { amount: 10_000 }))).toMatchObject({
      error: 'REFUND_NOT_AUTOMATABLE',
      retryable: false,
    });
    const [row] = await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    expect(externalRefund).not.toHaveBeenCalled();
    expect(row).toMatchObject({ chargeId: s.cmsChargeId, status: 'PENDING', execution: 'MANUAL', amount: 10_000 });
  });

  it('listByIntent: 상태 무관 전부, 만든 순서 — FAILED 는 남은 금액을 줄이지 않는다', async () => {
    const s = await seed({ toss: 10_000 });
    externalRefund.mockResolvedValue({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', retryable: true });
    await service.createByIntent(s.intentId, { amount: 10_000 });
    await service.createByIntent(s.intentId, { amount: 10_000, execution: 'MANUAL' });

    const list = await service.listByIntent(s.intentId);

    expect(list.map((r) => [r.status, r.execution, r.failureCode, r.failureRetryable])).toEqual([
      ['FAILED', 'AUTO', 'PROVIDER_ERROR', true],
      ['PENDING', 'MANUAL', null, null],
    ]);
  });
});
```

- [ ] **Step 2: 스크래치 DB 에 마이그레이션을 적용하고 실행**

```bash
# 로컬 postgres 컨테이너(almondyoung-server-postgres-1). 비밀번호는 메인 체크아웃 apps/wallet/.env 의 DATABASE_URL 과 같다
PGURL=$(grep '^DATABASE_URL=' /home/pauseb/workspace/almondyoung-server/apps/wallet/.env | cut -d= -f2- | sed 's#/wallet$#/wallet_itest#')
docker exec almondyoung-server-postgres-1 psql -U postgres -c 'DROP DATABASE IF EXISTS wallet_itest' -c 'CREATE DATABASE wallet_itest'
DATABASE_URL="$PGURL" npx drizzle-kit migrate --config apps/wallet/drizzle.config.ts
DATABASE_URL="$PGURL" REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/refunds/refund-settlement.integration.spec.ts \
  apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
```

Expected: 새 통합 7 PASS, PR 0 의 포인트 통합 4 PASS. 실패하면 앞 태스크의 결함이다 — 이 스펙을 느슨하게 고치지 말고 원인 태스크로 돌아간다.

컨테이너 이름이 다르면 `docker ps --format '{{.Names}}' | grep postgres` 로 찾는다. postgres 가 안 떠 있으면 `npm run bootstrap:e2e:local` 이 띄운다.

- [ ] **Step 3: 커밋**

```bash
git add apps/wallet/src/refunds/refund-settlement.integration.spec.ts
git commit -m "test(wallet): 환불 수동 실행·실패 분류·송금 완료·목록 실 Postgres 통합 스펙 (#1016 36번 PR 1)"
```

---

### Task 8: 문서·게이트·PR

**Files:**
- Modify: `apps/wallet/CLAUDE.md` («State Machine» 절 뒤)

**Interfaces:**
- Consumes: Task 1~7

- [ ] **Step 1: wallet CLAUDE.md 에 규칙 기록**

`apps/wallet/CLAUDE.md` 의 `### State Machine` 절과 `### 멱등성` 절 사이에 더한다:

```markdown
### 환불 실패 분류와 수동 실행 (#1016 36번)
- **영구/일시 분류의 정본은 wallet 이다.** 호출자(almond-payment·core)는 번역만 한다
  - 4xx 거절 본문 `{ error, message, retryable }` — 표는 `refunds/refund-refusal.ts`. `error`·`message` 는 옛 값 그대로다(core `WalletRefundClient` 가 `error` 로 금액 초과류를 «이미 환불됨»으로 읽는다)
  - FAILED 환불 행의 `failure_code`·`failure_retryable` — provider 가 `RefundResult.retryable` 로 정한다. 토스 코드표는 `providers/toss/toss-refund-errors.ts`
  - **모르는 코드·없는 값은 `true`(일시).** 영구로 잘못 두면 아무도 다시 안 부른다
- **수동 실행(`execution = MANUAL`)**: `POST /v1/payment-intents/:id/refund` 에 `execution: 'MANUAL'`. 계획(남은 금액 비례·외부 먼저·포인트 마지막)은 자동과 같고,
  외부 결제 몫만 PG 를 부르지 않고 `PENDING` 행으로 남는다. 포인트 몫은 자동. 운영자가 송금한 뒤 `confirmManual` 로 닫는다
- `confirmManual` 이 받는 행은 `isManuallyConfirmable` 한 곳이 정한다(무통장 PENDING 또는 MANUAL PENDING). 관리자 상세의 `manualConfirmable` 도 같은 함수다
- `GET /v1/payment-intents/:id/refunds` — 환불 목록(상태 무관, 만든 순서). 정산 직전 장부 맞추기가 읽는다
```

- [ ] **Step 2: 게이트**

Run:
```bash
npm run type-check
npx jest
```
Expected: 둘 다 0 (실패 0). 빨간 건 이 PR 이 만든 것이다(CLAUDE.md «검증 게이트»). jest 가 OOM 이면 `npx jest --maxWorkers=2`.

- [ ] **Step 3: 메인 오염 확인**

Run:
```bash
git -C /home/pauseb/workspace/almondyoung-server status --short
git -C /home/pauseb/workspace/almondyoung-server rev-parse develop origin/develop
```
Expected: status 는 `M web/almondyoung-storefront/yarn.lock` 한 줄(남의 것)뿐. develop 과 origin/develop 이 같은 해시.

- [ ] **Step 4: 커밋·push·PR**

```bash
git add apps/wallet/CLAUDE.md
git commit -m "docs(wallet): 환불 실패 분류·수동 실행 규칙 (#1016 36번 PR 1)"
git push -u origin feat/1016-36-wallet-settlement
```

PR base: #1047 이 OPEN 이면 `fix/1016-36-point-refund-leg`, MERGED 면 `develop`.

```bash
gh pr create --base fix/1016-36-point-refund-leg --title "feat(wallet): 환불 목록·실패 분류·수동 실행 (#1016 36번 재설계 PR 1)" --body-file <본문 파일>
```

본문:

```markdown
## 무엇
채널 취소 정산 재설계(스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` §6.5)의 wallet 몫.

- `GET /v1/payment-intents/:id/refunds` — 환불 목록(상태 무관, 만든 순서)
- 실패 분류 — 4xx 거절 본문에 `retryable`, FAILED 환불 행에 `failure_code`·`failure_retryable`. 토스 결제 취소 오류 31개 코드표. 모르는 코드는 일시
- 수동 실행 — `RefundByIntentDto.execution?: 'AUTO' | 'MANUAL'`. 외부 결제 몫은 PG 없이 송금 대기(PENDING), 포인트 몫은 자동
- 송금 완료 일반화 — `confirmManual` 이 MANUAL 행이면 결제수단과 무관하게 받는다

## 혼자 나가도 휴면
아무도 `execution: MANUAL` 을 안 보내고, 새 응답 칸은 옛 호출자가 무시한다. 4xx 본문의 `error`·`message` 는 옛 값 그대로라
core `WalletRefundClient` 의 `REFUND_AMOUNT_EXCEEDS_*` → `already_refunded` 분기가 그대로다.

## 배포
마이그레이션 1건(`refunds` 에 칸 셋, additive) — **`migrate → deploy`**. 배포 전 대기 마이그레이션 대조는 평소대로(남이 머지한 마이그도 함께 실린다).
PR 0 #1047 위에 쌓았다 — #1047 squash 머지 뒤 `git rebase --onto origin/develop fix/1016-36-point-refund-leg` 로 옮기고 base 를 develop 으로 바꾼다.

## 검증
`npm run type-check` 0 · `npx jest` 0 · 실 Postgres 통합(`refund-settlement.integration.spec.ts` 7, PR 0 포인트 통합 4) PASS

https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
```

---

## 범위 밖 · 알려진 한계

- **응답 없는 PG 호출(`PROVIDER_EXCEPTION`)은 일시로 둔다.** 토스가 실제로는 처리했는데 응답만 잃은 경우, 재시도는 새 환불 행(새 멱등 키)이라 부분환불이면
  두 번 나갈 수 있다. 오늘도 같은 구멍이고(스펙 §6.5 «모르면 일시» 결정), 전체 취소는 두 번째가 토스에서 `NOT_CANCELABLE_AMOUNT`(영구)로 막힌다.
  닫으려면 토스 결제 조회로 확인하는 단계가 필요하다 — 이 PR 범위 밖, PR 본문 «알려진 한계»로 남긴다
- NicePay provider 는 분류하지 않는다(라이브 미사용 — `retryable` 없음 = 일시)
- 관리자 환불 «목록»의 `manualConfirmable` 은 여전히 `false`(조인 없음). admin-web 송금 대기 노출은 PR 5
- intent 없음(컨트롤러 `findByIdOrThrow` 의 404 `INTENT_NOT_FOUND`)은 `PaymentIntentsService` 소유라 `retryable` 이 없다 — 호출자는 일시로 읽는다

## 머지 뒤

- 배포: `db:migrate`(wallet, `lcnine-services`) → `sst deploy`. 배포 뒤 바뀌는 동작 없음(휴면)
- PR 2(Medusa 정산 라우트) 계획은 새 세션에서 — 이 PR 의 목록 API·`retryable`·`execution: 'MANUAL'` 을 소비한다
- #1016 반영은 사용자 확인 뒤(본문 수정, 코멘트 금지)
