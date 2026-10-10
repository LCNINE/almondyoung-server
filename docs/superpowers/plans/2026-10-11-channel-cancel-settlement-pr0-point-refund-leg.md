# PR 0 — wallet 포인트 환불 원장 키 결함 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 확정(CAPTURE)된 포인트 결제분을 환불할 때 `NO_CAPTURED_REDEEM` 으로 늘 실패하는 결함을 고친다.

**Architecture:** 포인트 원장은 사용(REDEEM)을 «승인(AUTHORIZE) 결제분 id» 를 키(`leg_id`)로 쌓는다 — `capture.service.ts` 가 provider 에
`chargeId: authorizeCharge.id` 를 넘기기 때문이다. 환불은 확정 결제분을 고르고 그 id 로 원장을 읽어 아무것도 못 찾는다. 라이브 원장이 이미 승인
id 로 쌓여 있으므로 **읽는 쪽**을 고친다: `RefundsService.create`(provider 환불의 유일한 호출부)가 결제분의 «원장 키 결제분 id» 를 풀어
`RefundParams.authorizeChargeId` 로 넘기고, 포인트 provider 만 그 값을 원장 키로 쓴다. 토스 등 다른 provider 는 `chargeId` 를 그대로 쓴다.

**Tech Stack:** NestJS, Drizzle(postgres.js), Jest(ts-jest, transpile-only), 실 Postgres 통합 스펙(`describeIfDb`).

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` §2.3, §9.2 의 0, §11.

## Global Constraints

- 재설계와 독립인 PR 이다 — wallet 밖(Medusa·core·channel-adapter)은 건드리지 않는다
- 마이그레이션 없음
- 원장 데이터(`point_events`)를 고치지 않는다 — 읽는 쪽만 고친다(스펙 §9.2 의 0)
- 서비스 레이어에 `any`·`as` 금지(CLAUDE.md «Type Safety») — 스펙 파일의 목(mock) 캐스팅은 기존 관례대로 허용
- 스펙 안에서 `dotenv.config()` 를 부르지 않는다. DB 스펙은 `describeIfDb` + `REQUIRE_WALLET_DB=1` 가드(CLAUDE.md «검증 게이트»)
- 게이트: `npm run type-check` 0 · `npx jest` 0

## Review Focus

- **확정 행에 `requestPayload.authorizeChargeId` 가 없는 옛 결제(2026-02-25 이전 코드로 확정된 것)** — 지금처럼 자기 id 로 읽어 실패해야 하고
  예외로 죽으면 안 된다. Task 1 의 «없으면 자기 id» 테스트가 지킨다. 라이브에 그런 행이 있는지는 Task 3 스크립트 질의 6 이 센다.
- **같은 승인분을 여러 번 부분 환불** — 원장 키가 승인 id 로 바뀌어도 «남은 금액»은 같은 키의 `REDEEM_CANCEL` 합으로 줄어야 한다(이중 환불 금지).
  Task 2 통합 스펙의 «부분 환불 두 번 + 초과 거절»이 지킨다.
- **승인만 되고 확정이 없는 포인트 결제분(1순위가 비어 AUTHORIZE 로 내려온 경우)** — 원장 키 = 자기 id 라 지금과 같다. Task 1 테스트가 지킨다.
- **카드+포인트 복합 결제의 환불 순서** — 외부 결제 먼저·포인트 마지막(`createByIntent`)은 그대로다. 이 PR 은 포인트 leg 의 원장 키만 바꾼다.
  기존 `refunds.service.spec.ts` 의 복합 결제 테스트가 계속 초록이어야 한다.
- **같은 환불 재시도(멱등)** — 원장 멱등 키는 `wallet:refund:<refund id>` 그대로라 두 번째 호출은 `idempotentReplay` 로 끝나야 한다. Task 2 통합 스펙이 지킨다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| Create `apps/wallet/src/charges/ledger-leg.ts` | 결제분 → 원장 키 결제분 id 순수 함수 하나 |
| Create `apps/wallet/src/charges/ledger-leg.spec.ts` | 그 함수의 표 |
| Modify `apps/wallet/src/providers/payment-provider.interface.ts` | `RefundParams.authorizeChargeId?` |
| Modify `apps/wallet/src/refunds/refunds.service.ts` | `create()` 가 `authorizeChargeId` 를 풀어 넘김 |
| Modify `apps/wallet/src/refunds/refunds.service.spec.ts` | provider 에 넘긴 값 단언 |
| Modify `apps/wallet/src/providers/points/points.provider.ts` | `refund()` 의 `legId` |
| Create `apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts` | 실 Postgres 로 승인 → 확정 → 환불 |
| Create `scripts/ops/1016-36-point-refund-leg-check.js` | 라이브 읽기 전용 확인 |

---

### Task 1: 원장 키 결제분 id 순수 함수

**Files:**
- Create: `apps/wallet/src/charges/ledger-leg.ts`
- Test: `apps/wallet/src/charges/ledger-leg.spec.ts`

**Interfaces:**
- Consumes: `Charge` (`apps/wallet/src/types.ts` — `InferSelectModel<typeof charges>`; 쓰는 칸은 `id`, `operation`, `requestPayload`)
- Produces: `export function ledgerLegChargeId(charge: Pick<Charge, 'id' | 'operation' | 'requestPayload'>): string`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// apps/wallet/src/charges/ledger-leg.spec.ts
import { ledgerLegChargeId } from './ledger-leg';

describe('ledgerLegChargeId — provider 원장이 이 결제분을 어떤 id 로 알고 있나', () => {
  it('확정(CAPTURE) 결제분은 requestPayload.authorizeChargeId(승인 결제분 id)', () => {
    expect(
      ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { intentId: 'i-1', authorizeChargeId: 'auth-1' } }),
    ).toBe('auth-1');
  });

  it('확정 결제분인데 authorizeChargeId 가 없으면(2026-02-25 이전 코드) 자기 id', () => {
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { intentId: 'i-1' } })).toBe('cap-1');
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: null })).toBe('cap-1');
  });

  it('authorizeChargeId 가 문자열이 아니거나 빈 문자열이면 자기 id', () => {
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { authorizeChargeId: 42 } })).toBe('cap-1');
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { authorizeChargeId: '' } })).toBe('cap-1');
  });

  it('승인(AUTHORIZE) 결제분은 자기 id — 확정 없이 1순위가 비어 내려온 경우', () => {
    expect(
      ledgerLegChargeId({ id: 'auth-1', operation: 'AUTHORIZE', requestPayload: { authorizeChargeId: 'other' } }),
    ).toBe('auth-1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/charges/ledger-leg.spec.ts`
Expected: FAIL — `Cannot find module './ledger-leg'`

- [ ] **Step 3: 구현**

```ts
// apps/wallet/src/charges/ledger-leg.ts
import type { Charge } from '../types';

/**
 * provider 원장이 이 결제분을 어떤 결제분 id 로 기록했는가.
 *
 * 확정(CAPTURE)은 별도 결제분 행을 만들지만 provider 에는 승인(AUTHORIZE) 결제분 id 를 넘긴다
 * (`capture.service.ts` captureOneLeg). 그래서 포인트 원장의 사용(REDEEM)은 승인 id 를 키로 쌓인다.
 * 환불은 확정 결제분을 고르므로, 원장을 읽을 때는 이 함수로 승인 id 를 되찾아야 한다.
 * 승인 id 를 모르는 옛 확정 행은 자기 id 로 둔다(그 경우 지금처럼 원장을 못 찾고 실패한다).
 */
export function ledgerLegChargeId(charge: Pick<Charge, 'id' | 'operation' | 'requestPayload'>): string {
  if (charge.operation !== 'CAPTURE') return charge.id;
  const authorizeChargeId = charge.requestPayload?.['authorizeChargeId'];
  return typeof authorizeChargeId === 'string' && authorizeChargeId.length > 0 ? authorizeChargeId : charge.id;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/wallet/src/charges/ledger-leg.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add apps/wallet/src/charges/ledger-leg.ts apps/wallet/src/charges/ledger-leg.spec.ts
git commit -m "feat(wallet): 결제분의 provider 원장 키를 푸는 ledgerLegChargeId (#1016 36번 PR 0)"
```

---

### Task 2: 환불이 원장 키를 넘기고 포인트 provider 가 그 키로 읽는다

**Files:**
- Modify: `apps/wallet/src/providers/payment-provider.interface.ts:36-50` (`RefundParams`)
- Modify: `apps/wallet/src/refunds/refunds.service.ts:121-137` (`provider.refund({...})` 호출)
- Modify: `apps/wallet/src/providers/points/points.provider.ts:131-145` (`refund()`)
- Test: `apps/wallet/src/refunds/refunds.service.spec.ts`
- Test (Create): `apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts`

**Interfaces:**
- Consumes: `ledgerLegChargeId(charge)` (Task 1)
- Produces: `RefundParams.authorizeChargeId?: string` — «provider 원장이 이 결제분을 아는 id(확정분이면 승인분 id)». 포인트 provider 만 읽는다

- [ ] **Step 1: 단위 테스트 — provider 에 넘긴 값 (실패)**

`refunds.service.spec.ts` 의 `makeCharge` 가 `operation`·`requestPayload` 를 받도록 넓히고(기본값 `operation: 'CAPTURE'`, `requestPayload: null` —
지금 테스트의 결제분은 확정분 취급이 자연스럽고 `null` 이면 자기 id 라 기존 단언이 안 바뀐다), `describe('RefundsService')` 안에 블록을 더한다.

```ts
// makeCharge 교체
function makeCharge(
  overrides: Partial<{
    id: string;
    status: string;
    amount: number;
    paymentMethodId: string;
    operation: 'AUTHORIZE' | 'CAPTURE';
    requestPayload: Record<string, unknown> | null;
  }> = {},
) {
  return {
    id: CHARGE_ID,
    intentId: INTENT_ID,
    paymentMethodId: PM_ID,
    status: 'SUCCEEDED',
    amount: 10000,
    currency: 'KRW',
    operation: 'CAPTURE' as const,
    requestPayload: null,
    ...overrides,
  };
}
```

```ts
  describe('provider 원장 키 (#1016 36번 PR 0)', () => {
    it('확정 결제분 환불은 provider 에 승인 결제분 id 를 authorizeChargeId 로 넘긴다', async () => {
      const { service, provider } = makeContext({
        charge: makeCharge({ operation: 'CAPTURE', requestPayload: { intentId: INTENT_ID, authorizeChargeId: 'auth-001' } }),
        method: makeMethod('POINTS'),
      });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(provider.refund).toHaveBeenCalledWith(
        expect.objectContaining({ chargeId: CHARGE_ID, authorizeChargeId: 'auth-001' }),
      );
    });

    it('승인 결제분 환불은 자기 id 를 넘긴다', async () => {
      const { service, provider } = makeContext({
        charge: makeCharge({ operation: 'AUTHORIZE', requestPayload: null }),
        method: makeMethod('POINTS'),
      });

      await service.create({ chargeId: CHARGE_ID, amount: 5000 });

      expect(provider.refund).toHaveBeenCalledWith(
        expect.objectContaining({ chargeId: CHARGE_ID, authorizeChargeId: CHARGE_ID }),
      );
    });
  });
```

`makeContext` 는 이미 `provider` 를 반환한다(`return { service, db, chargesService, …, provider, … }`).

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/refunds/refunds.service.spec.ts -t "provider 원장 키"`
Expected: FAIL — `authorizeChargeId` 가 호출 인자에 없음

- [ ] **Step 3: `RefundParams` 에 칸 추가**

```ts
// apps/wallet/src/providers/payment-provider.interface.ts — RefundParams 안, chargeId 바로 아래
  /**
   * provider 원장이 이 결제분을 아는 id. 확정(CAPTURE)분이면 그 승인(AUTHORIZE)분 id 다 —
   * 확정 때 provider 에 승인분 id 를 넘기기 때문이다(`ledgerLegChargeId`). 포인트 provider 만 읽는다.
   */
  authorizeChargeId?: string;
```

- [ ] **Step 4: `RefundsService.create` 가 넘기게**

```ts
// apps/wallet/src/refunds/refunds.service.ts — import 에 추가
import { ledgerLegChargeId } from '../charges/ledger-leg';

// provider.refund({ ... }) 인자, chargeId: charge.id 바로 아래에 추가
        authorizeChargeId: ledgerLegChargeId(charge),
```

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `npx jest apps/wallet/src/refunds/refunds.service.spec.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 6: 통합 테스트 — 실 원장으로 승인 → 확정 → 환불 (실패)**

```ts
// apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { pointEventDetails, pointEvents, pointHoldDetails, pointHolds, walletSchema, WalletSchema } from '../../schema';
import { PointsAdminService } from '../../admin/points-admin.service';
import { PointsLedgerService } from './points-ledger.service';
import { PointsPaymentProvider } from './points.provider';

/**
 * #1016 36번 PR 0 — 확정된 포인트 결제분의 환불이 원장을 찾는가.
 * 확정은 provider 에 승인 결제분 id 를 넘기므로(capture.service.ts captureOneLeg) 사용(REDEEM)은 승인 id 로 쌓인다.
 * provider 를 mock 하지 않는다 — 기존 스펙이 mock 이라 이 결함을 못 잡았다.
 *
 * 실행: 스크래치 DB 에 wallet 마이그레이션 적용 후
 *   DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/wallet_itest REQUIRE_WALLET_DB=1 \
 *     npx jest apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

if (process.env.REQUIRE_WALLET_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_WALLET_DB=1 인데 DATABASE_URL 이 없습니다');
}

describeIfDb('포인트 환불 원장 키 (실 Postgres)', () => {
  jest.setTimeout(60_000);

  let sql: postgres.Sql;
  let provider: PointsPaymentProvider;
  let pointsAdmin: PointsAdminService;
  const userIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    const db = drizzle(sql, { schema: walletSchema });
    const dbService = { db } as unknown as DbService<WalletSchema>;
    provider = new PointsPaymentProvider(dbService, new PointsLedgerService());
    pointsAdmin = new PointsAdminService(dbService);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      const db = drizzle(sql, { schema: walletSchema });
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

  /** 포인트 3,000 을 승인·확정한 결제를 만든다. 반환: 승인 결제분 id(A)와 확정 결제분 id(C) */
  async function paidWithPoints(): Promise<{ userId: string; intentId: string; authorizeId: string; captureId: string }> {
    const userId = `itest-points-${randomUUID()}`;
    userIds.push(userId);
    await pointsAdmin.earn(userId, 10_000, 'ITEST');
    const intentId = randomUUID();
    const authorizeId = randomUUID();
    const captureId = randomUUID();
    const base = { intentId, paymentMethodId: randomUUID(), userId, amount: 3_000, currency: 'KRW' };

    const authorized = await provider.authorize({
      ...base,
      chargeId: authorizeId,
      idempotencyKey: `wallet:authorize:${authorizeId}`,
      correlationId: 'itest',
    });
    expect(authorized.status).toBe('SUCCEEDED');

    // capture.service.ts captureOneLeg 와 같다 — 확정 결제분 행을 따로 만들지만 provider 엔 승인 id 를 넘긴다
    const captured = await provider.capture({
      ...base,
      chargeId: authorizeId,
      idempotencyKey: `wallet:capture:${authorizeId}`,
      correlationId: 'itest',
    });
    expect(captured.status).toBe('SUCCEEDED');
    return { userId, intentId, authorizeId, captureId };
  }

  function refund(p: { userId: string; intentId: string; authorizeId: string; captureId: string }, amount: number, authorizeChargeId?: string) {
    const refundId = randomUUID();
    return provider.refund({
      refundId,
      chargeId: p.captureId,
      authorizeChargeId,
      intentId: p.intentId,
      userId: p.userId,
      amount,
      currency: 'KRW',
      idempotencyKey: `wallet:refund:${refundId}`,
      correlationId: 'itest',
    });
  }

  it('authorizeChargeId 없이 확정 결제분 id 로만 부르면 원장을 못 찾는다(결함 재현 — 옛 호출 모양)', async () => {
    const p = await paidWithPoints();
    const result = await refund(p, 3_000);
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('NO_CAPTURED_REDEEM');
  });

  it('authorizeChargeId 로 승인 결제분 id 를 주면 전액 환불된다', async () => {
    const p = await paidWithPoints();
    const result = await refund(p, 3_000, p.authorizeId);
    expect(result.status).toBe('SUCCEEDED');

    const cancels = await sql`
      select amount, leg_id from point_events
       where user_id = ${p.userId} and event_type = 'REDEEM_CANCEL'`;
    expect(cancels).toEqual([{ amount: 3_000, leg_id: p.authorizeId }]);
  });

  it('부분 환불 두 번은 남은 금액 안에서 되고, 넘치면 거절된다', async () => {
    const p = await paidWithPoints();
    expect((await refund(p, 1_000, p.authorizeId)).status).toBe('SUCCEEDED');
    expect((await refund(p, 2_000, p.authorizeId)).status).toBe('SUCCEEDED');
    const over = await refund(p, 1, p.authorizeId);
    expect(over.status).toBe('FAILED');
    expect(over.errorCode).toBe('REFUND_AMOUNT_EXCEEDS_REMAINING');
  });

  it('같은 멱등 키로 두 번 부르면 두 번째는 재생이다', async () => {
    const p = await paidWithPoints();
    const refundId = randomUUID();
    const call = () =>
      provider.refund({
        refundId,
        chargeId: p.captureId,
        authorizeChargeId: p.authorizeId,
        intentId: p.intentId,
        userId: p.userId,
        amount: 3_000,
        currency: 'KRW',
        idempotencyKey: `wallet:refund:${refundId}`,
        correlationId: 'itest',
      });
    expect((await call()).status).toBe('SUCCEEDED');
    const second = await call();
    expect(second.status).toBe('SUCCEEDED');
    expect(second.raw).toEqual(expect.objectContaining({ idempotentReplay: true }));

    const cancels = await sql`select count(*)::int as n from point_events where user_id = ${p.userId} and event_type = 'REDEEM_CANCEL'`;
    expect(cancels[0].n).toBe(1);
  });
});
```

- [ ] **Step 7: 스크래치 DB 를 만들고 실패 확인**

```bash
# 로컬 postgres 컨테이너(almondyoung-server-postgres-1). 비밀번호는 apps/wallet/.env 의 DATABASE_URL 과 같다
PGURL=$(grep '^DATABASE_URL=' apps/wallet/.env | cut -d= -f2- | sed 's#/wallet$#/wallet_itest#')
docker exec almondyoung-server-postgres-1 psql -U postgres -c 'DROP DATABASE IF EXISTS wallet_itest' -c 'CREATE DATABASE wallet_itest'
DATABASE_URL="$PGURL" npx drizzle-kit migrate --config apps/wallet/drizzle.config.ts
DATABASE_URL="$PGURL" REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
```

Expected: 첫 테스트(결함 재현) PASS, 나머지 셋 FAIL — `NO_CAPTURED_REDEEM`(아직 provider 가 `authorizeChargeId` 를 안 읽음)

- [ ] **Step 8: 포인트 provider 가 원장 키를 읽게**

```ts
// apps/wallet/src/providers/points/points.provider.ts — refund() 안
      this.pointsLedgerService.refund(tx, {
        intentId: params.intentId,
        // 원장은 사용(REDEEM)을 승인 결제분 id 로 쌓았다 — 확정분 환불이면 그 id 로 읽어야 한다(ledgerLegChargeId)
        legId: params.authorizeChargeId ?? params.chargeId,
        attemptId: params.refundId,
```

- [ ] **Step 9: 통합·단위 통과 확인**

Run:
```bash
DATABASE_URL="$PGURL" REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
npx jest apps/wallet
```
Expected: 통합 4 PASS. `apps/wallet` 전체 PASS(통합 스펙은 `DATABASE_URL` 없으면 skip)

- [ ] **Step 10: 커밋**

```bash
git add apps/wallet/src/providers/payment-provider.interface.ts apps/wallet/src/refunds/refunds.service.ts \
  apps/wallet/src/refunds/refunds.service.spec.ts apps/wallet/src/providers/points/points.provider.ts \
  apps/wallet/src/providers/points/points-refund-leg.integration.spec.ts
git commit -m "fix(wallet): 확정된 포인트 결제분 환불이 승인 결제분 원장 키로 읽게 (#1016 36번 PR 0)"
```

---

### Task 3: 라이브 확인 스크립트 + 게이트 + PR

**Files:**
- Create: `scripts/ops/1016-36-point-refund-leg-check.js`

**Interfaces:**
- Consumes: 없음 (읽기 전용 SQL)
- Produces: 사용자가 라이브에서 돌릴 스크립트. 결과는 PR 본문과 #1016 행에 옮긴다

- [ ] **Step 1: 스크립트 작성**

```js
// scripts/ops/1016-36-point-refund-leg-check.js
// READ ONLY. #1016 36번 PR 0 — 포인트 환불 원장 키 결함의 라이브 실재와 영향 범위.
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/1016-36-point-refund-leg-check.js)"
const postgres = require('postgres');
const d = JSON.parse(process.env.SST_RESOURCE_Db);
const sql = postgres({
  host: process.env.DB_TUNNEL_HOST || d.host,
  port: Number(process.env.DB_TUNNEL_PORT || d.port),
  username: d.username,
  password: d.password,
  database: 'wallet',
  ssl: 'require',
  max: 1,
});

(async () => {
  await sql.begin('read only', async (tx) => {
    // 1. 포인트 결제분 환불 결과 분포 (월 × 상태 × 사유 × 결제분 종류)
    const pointRefunds = await tx`
      select to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM') as month,
             r.status, left(coalesce(r.reason_message, ''), 60) as reason_message,
             c.operation as charge_operation, count(*)::int as n, sum(r.amount)::int as amount
        from refunds r
        join charges c on c.id = r.charge_id
        join payment_methods pm on pm.id = c.payment_method_id
       where pm.type = 'POINTS'
       group by 1, 2, 3, 4
       order by 1, 2, 3`;

    // 2. REDEEM 원장 키가 가리키는 결제분 종류 (기대: 전부 AUTHORIZE)
    const redeemLegKeys = await tx`
      select c.operation, count(*)::int as redeem_events
        from point_events pe
        join charges c on c.id = pe.leg_id
       where pe.event_type = 'REDEEM'
       group by 1`;
    const redeemLegMissing = await tx`
      select count(*)::int as redeem_events_without_charge
        from point_events pe
       where pe.event_type = 'REDEEM'
         and not exists (select 1 from charges c where c.id = pe.leg_id)`;

    // 3. 확정된 포인트 결제가 있는 intent 수 (= 고치기 전엔 환불하면 실패할 대상)
    const pointIntentsWithCapture = await tx`
      select count(distinct c.intent_id)::int as point_intents_with_capture
        from charges c
        join payment_methods pm on pm.id = c.payment_method_id
       where pm.type = 'POINTS' and c.operation = 'CAPTURE' and c.status = 'SUCCEEDED'`;

    // 4. 2026-06 의 FAILED 환불 전부 (Medusa #14·#40·#321·#459 일부 환불의 원인 후보)
    const juneFailed = await tx`
      select r.intent_id, r.created_at at time zone 'Asia/Seoul' as created_kst, r.amount,
             pm.type as method_type, c.operation as charge_operation,
             r.reason_code, left(coalesce(r.reason_message, ''), 80) as reason_message
        from refunds r
        join charges c on c.id = r.charge_id
        join payment_methods pm on pm.id = c.payment_method_id
       where r.status = 'FAILED'
         and r.created_at >= '2026-06-01' and r.created_at < '2026-07-01'
       order by r.created_at`;

    // 5. FAILED 환불의 수단 × 사유 분포
    const failedByMethod = await tx`
      select pm.type as method_type, left(coalesce(r.reason_message, ''), 60) as reason_message,
             count(*)::int as n
        from refunds r
        join charges c on c.id = r.charge_id
        join payment_methods pm on pm.id = c.payment_method_id
       where r.status = 'FAILED'
       group by 1, 2
       order by 3 desc
       limit 30`;

    // 6. 확정된 포인트 결제분 중 승인 결제분 id 를 모르는 행 (고친 뒤에도 환불 못 하는 결제)
    const capturesWithoutAuthorizeId = await tx`
      select count(*) filter (where c.request_payload ? 'authorizeChargeId')::int as with_authorize_id,
             count(*) filter (where not coalesce(c.request_payload ? 'authorizeChargeId', false))::int as without_authorize_id
        from charges c
        join payment_methods pm on pm.id = c.payment_method_id
       where pm.type = 'POINTS' and c.operation = 'CAPTURE' and c.status = 'SUCCEEDED'`;

    console.log(
      JSON.stringify(
        { pointRefunds, redeemLegKeys, redeemLegMissing, pointIntentsWithCapture, juneFailed, failedByMethod, capturesWithoutAuthorizeId },
        null,
        2,
      ),
    );
  });
  await sql.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 게이트**

Run:
```bash
npm run type-check
npx jest
```
Expected: 둘 다 0 (실패 0). 실패가 있으면 이 PR 이 만든 것이다(CLAUDE.md «검증 게이트»)

- [ ] **Step 3: 커밋**

```bash
git add scripts/ops/1016-36-point-refund-leg-check.js
git commit -m "chore(ops): #1016 36번 PR 0 포인트 환불 원장 키 라이브 확인 스크립트(읽기 전용)"
```

- [ ] **Step 4: 사람이 라이브 스크립트를 돌린다**

에이전트는 라이브 DB 를 직접 조회하지 않는다(권한 분류기가 막는다). 사용자에게 Step 1 의 «실행(사람)» 명령을 부탁하고 결과를 받는다.
판정:
- 질의 2 가 전부 `AUTHORIZE` → 결함 실재, 이 PR 로 풀린다
- 질의 6 `without_authorize_id > 0` → 그 결제는 이 PR 뒤에도 환불이 실패한다. 개수와 intent 를 PR 본문에 적고 #1016 새 행 후보로 남긴다
- 질의 4 의 4건이 `POINTS` + `NO_CAPTURED_REDEEM` → 6월 일부 환불 원인 확정. 포인트 환급 조치는 사람이 판단한다(이 PR 범위 밖)

- [ ] **Step 5: PR 생성**

브랜치는 develop 에서 새로 판다(`fix/1016-36-point-refund-leg`). PR 본문:

```markdown
## 무엇
확정(CAPTURE)된 포인트 결제분 환불이 `NO_CAPTURED_REDEEM` 으로 늘 실패하던 결함을 고친다.

## 왜
확정은 provider 에 승인(AUTHORIZE) 결제분 id 를 넘겨 포인트 원장의 사용(REDEEM)이 승인 id 로 쌓인다(`capture.service.ts`).
환불은 확정 결제분 id 로 원장을 읽어 아무것도 못 찾았다. 모든 provider 가 자동 확정이라 포인트가 낀 주문 전부가 해당한다.
지금 라이브의 채널 전체취소는 Medusa 기본 취소라 이 실패가 삼켜져, 카드만 환불되고 포인트는 안 돌아간 채 취소된다.

## 어떻게
라이브 원장을 고치지 않고 읽는 쪽을 고친다 — `RefundsService.create` 가 `ledgerLegChargeId` 로 승인 결제분 id 를 풀어
`RefundParams.authorizeChargeId` 로 넘기고, 포인트 provider 만 그 값을 원장 키로 쓴다. 다른 provider 는 그대로.

## 라이브 확인 (읽기 전용)
<Task 3 Step 4 결과 요약 — 질의 2·4·6>

## 배포
마이그레이션 없음. wallet 단독. 재설계(스펙 `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md`)와 독립.

https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo
```

---

## 머지 뒤

- #1016: 새 행 «포인트 환불 원장 키 결함»(해결 칸에 머지 해시, 문서 칸에 스펙·이 계획) — 사용자 확인 뒤 본문 수정
- 6월 4건이 이 결함으로 확정되면 그 사실을 같은 행에, 환급 조치 여부는 사람 판단으로 남긴다
- 배포는 `sst deploy`(wallet 이 든 번들). 배포 뒤 포인트 결제 주문 하나를 로컬이 아닌 라이브에서 환불해 보는 실측은 사용자 판단
