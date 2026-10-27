# 임시 이용권 이어받기: 일시결제·환불 기준점·임시 일수 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 임시 이용권을 가진 고객이 일시결제로도 가입할 수 있게 하고, 임시 기간의 구매가 유료 환불 판정에 섞이지 않게 하며, 유료 시작 전 취소 시 남은 임시 일수를 되살린다.

**Architecture:** 이어받기 계약은 닫힌 지급 계약의 `SUPERSEDED_BY_SUBSCRIPTION` 이벤트(`metadata.newContractId`)로 판별한다. 계약의 `billingDate` 가 유료 시작일이다(이어받기 시 `오늘 + max(체험, 남은 임시 일수)`). 환불 기준점과 임시 일수 복구는 모두 이 두 사실에서 파생한다. 계약 종료 경로는 계약 행 잠금 후 상태를 재확인하고, 같은 트랜잭션에서 임시 일수를 복구한다.

**Tech Stack:** NestJS, Drizzle ORM (postgres.js), Jest

**Spec:** GitHub 이슈 #1067 본문의 "2번 결정 사항 (2026-10-26)" 1~5 (`gh issue view 1067 --repo LCNINE/almondyoung-server`)

## Global Constraints

- 작업 앱은 `apps/membership` 만. 스토어프론트 가입 버튼(결정 6)은 시안 확인 후 별도.
- 관리자 구독 생성(`adminCreateSubscription`) 이어받기와 유료 이용 중 추가 지급(이슈 4번)은 범위 밖.
- 무료체험 계약의 환불 기준점은 바꾸지 않는다. 바뀌는 건 이어받기 계약뿐.
- 트랜잭션은 `this.dbService.run(fn, tx)` 로 전파한다. 새 `inTx` 헬퍼·`as` 캐스팅 금지 (CLAUDE.md Transaction Propagation).
- Service 는 흐름만, 검증·DB 접근은 Reader/Manager (CLAUDE.md Layer Architecture).
- jest 는 `--maxWorkers=2`, 절대 4 초과 금지. 전체 스위트는 마지막 태스크에서만.
- 주석에 이슈 번호를 달지 않는다. 특수 인용부호(겹낫표·꺾쇠 따옴표) 금지.
- 날짜 비교는 UTC `yyyy-MM-dd` 문자열 기준 (`findGrantTakeover` 와 같은 기준).

## Review Focus

1. **무통장입금 지연**: 결제창 생성 때는 임시 이용권이 있었는데 입금 확인 시점엔 이미 만료 → 일반 가입으로 처리돼야 한다(Task 4 테스트).
2. **동기 확정과 입금 이벤트 확정이 겹침**: 같은 intent 로 두 번 `confirmCheckoutIntent` → 두 번째는 `ActiveSubscriptionExistsException`(컨슈머가 멱등 스킵) 이어야 하고 계약이 둘 생기면 안 된다(Task 4 테스트, creator 의 지급 계약 상태 재확인에 의존).
3. **환불 이벤트 재배달**: 즉시해지로 복구된 임시 이용권이 뒤따라온 `gateway.refund.succeeded` 로 닫히면 안 된다(Task 2 테스트).
4. **유료 시작일 당일 취소**: `billingDate == 오늘` 이면 복구 일수 0 → 복구하지 않는다(Task 1 테스트).
5. **이어받기 아닌 계약의 즉시해지**: 복구가 일어나지 않고 기존 동작과 같아야 한다(Task 1·2 테스트).

---

### Task 1: 임시 일수 복구 (EntitlementManager)

**Files:**
- Modify: `apps/membership/src/services/entitlement/entitlement.manager.ts` (`grantByDays` :162)
- Test: `apps/membership/src/services/entitlement/entitlement.manager.restore-grant.spec.ts` (신규)

**Interfaces:**
- Produces:
  - `grantByDays(userId: string, days: number, memo: string | null, adminId: string, tx?: DrizzleTransaction)` — 시그니처에 `tx?` 추가, 본문은 `this.dbService.run(async (trx) => …, tx)`. 반환 타입 그대로.
  - `restoreTakenOverGrant(tx: DrizzleTransaction, contract: { id: string; userId: string; billingDate: string | null }, today?: string): Promise<number>` — 복구한 일수(안 했으면 0).

- [ ] **Step 1: 실패하는 테스트 작성**

`describe('EntitlementManager.restoreTakenOverGrant')` 에 네 케이스. tx 목은 `entitlement.manager.grant.spec.ts` 의 `makeChain` 방식.
  - `'이어받기 계약이고 유료 시작 전이면 billingDate − 오늘 만큼 지급한다'`: `SUPERSEDED_BY_SUBSCRIPTION` 행 있음, `billingDate: '2026-11-15'`, `today: '2026-10-26'` → 반환 `20`, 지급 insert 된 entitlement `endsAt === '2026-11-15'`.
  - `'billingDate 가 오늘이면 0 을 반환하고 아무것도 쓰지 않는다'`.
  - `'이어받기 계약이 아니면 0 을 반환하고 아무것도 쓰지 않는다'`: 이벤트 행 없음.
  - `'billingDate 가 null 이면 0'`.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/membership/src/services/entitlement/entitlement.manager.restore-grant.spec.ts --maxWorkers=2`
Expected: FAIL (`restoreTakenOverGrant is not a function`)

- [ ] **Step 3: 구현**

`grantByDays` 를 `dbService.run(…, tx)` 로 바꾼다. `restoreTakenOverGrant` 는 `tx` 로 `subscriptionContractEvents` 에서 `eventType = 'SUPERSEDED_BY_SUBSCRIPTION'` 이고 `metadata->>'newContractId' = contract.id` 인 행을 찾는다(`sql\`${schema.subscriptionContractEvents.metadata}->>'newContractId' = ${contract.id}\``). 있으면 `differenceInCalendarDays(parseISO(billingDate), parseISO(today))` 가 양수일 때 `this.grantByDays(contract.userId, days, '가입 취소로 임시 지급 복구', 'SYSTEM', tx)`. `today` 기본값은 `new Date().toISOString().split('T')[0]`.

- [ ] **Step 4: 통과 확인**

Run: 같은 명령 + `npx jest apps/membership/src/services/entitlement --maxWorkers=2`
Expected: PASS (기존 grant spec 포함)

- [ ] **Step 5: Commit**

```bash
git add apps/membership/src/services/entitlement/
git commit -m "feat(membership): 이어받기 계약 취소 시 남은 임시 일수를 같은 트랜잭션에서 복구하는 함수"
```

---

### Task 2: 계약 종료 경로 — 잠금·재확인·복구

**Files:**
- Modify: `apps/membership/src/services/subscription/subscription.manager.ts` (`voidSubscription` :178)
- Modify: `apps/membership/src/services/subscription/subscription-cancellation.manager.ts` (`cancelImmediately` :76, `forceCancelSubscription` :417, 생성자에 `EntitlementManager` 주입)
- Test: `apps/membership/src/services/subscription/subscription-termination.restore-grant.spec.ts` (신규)

**Interfaces:**
- Consumes: Task 1 `restoreTakenOverGrant(tx, contract)`
- Produces: 세 메서드의 시그니처·반환 타입은 그대로.

- [ ] **Step 1: 실패하는 테스트 작성**

  - `'voidSubscription: 계약이 이미 CANCELLED 면 entitlement 를 건드리지 않고 기존 cancelledAt 으로 반환한다'` — 잠금 select 가 `{ status: 'CANCELLED', cancelledAt }` 반환 → `update(subscriptionEntitlement)` 호출 0회, `restoreTakenOverGrant` 호출 0회.
  - `'voidSubscription: ACTIVE 면 종료 후 restoreTakenOverGrant(tx, contract) 를 부른다'` — entitlement 종료 update 가 restore 호출보다 먼저(호출 순서 배열로 검증).
  - `'cancelImmediately: 이미 CANCELLED 면 ActiveSubscriptionExistsException 이 아니라 BadRequestException(이미 해지된 구독입니다) 을 던진다'`.
  - `'cancelImmediately: 종료 후 restoreTakenOverGrant 를 같은 tx 로 부른다'`.
  - `'forceCancelSubscription: 종료 후 restoreTakenOverGrant 를 같은 tx 로 부른다'`.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/membership/src/services/subscription/subscription-termination.restore-grant.spec.ts --maxWorkers=2`
Expected: FAIL

- [ ] **Step 3: 구현**

세 메서드 트랜잭션 맨 앞에서 `tx.select({ status, cancelledAt }).from(subscriptionContracts).where(eq(id, contract.id)).for('update').limit(1)`. `voidSubscription` 은 `CANCELLED` 면 `{ cancelledAt: row.cancelledAt ?? now, contractId }` 로 조기 반환. 나머지 둘은 `BadRequestException('이미 해지된 구독입니다')`. entitlement 종료 직후 `await this.entitlementManager.restoreTakenOverGrant(tx, contract)`. `SubscriptionCancellationManager` 생성자에 `EntitlementManager` 추가(같은 `app.module.ts` providers 라 모듈 수정 불필요).

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/membership/src/services/subscription apps/membership/src/services/__tests__ --maxWorkers=2`
Expected: PASS (기존 해지 스펙 포함 — 생성자 인자 추가로 깨지는 기존 스펙은 목에 `restoreTakenOverGrant: jest.fn().mockResolvedValue(0)` 와 잠금 select 목을 더해 고친다)

- [ ] **Step 5: Commit**

```bash
git add apps/membership/src/services/subscription/ apps/membership/src/services/__tests__/
git commit -m "fix(membership): 계약 종료 경로가 행을 잠그고 재확인 — 재배달된 환불이 복구된 임시 이용권을 닫지 않게"
```

---

### Task 3: 환불 기준점 = 유료 시작일 (이어받기 계약)

**Files:**
- Modify: `apps/membership/src/services/subscription/subscription-contract.reader.ts` (`findGrantTakeover` 근처)
- Modify: `apps/membership/src/services/subscription/cancellation-context.reader.ts` (`resolvePaidPeriodStart` :62)
- Test: `apps/membership/src/services/subscription/__tests__/cancellation-context.grant-takeover.spec.ts` (신규)

**Interfaces:**
- Produces: `SubscriptionContractReader.isGrantTakeoverContract(contractId: string): Promise<boolean>` — Task 1 과 같은 이벤트 조건을 `this.dbService.db` 로.

- [ ] **Step 1: 실패하는 테스트 작성**

`resolvePaidPeriodStart(contract, plan, entitlement)` 직접 호출.
  - `'이어받기 계약은 결제일보다 billingDate 가 늦으면 billingDate 를 쓴다'` — `findLastChargeSuccessAt → 2026-10-26`, `billingDate '2026-11-15'` → `2026-11-15`.
  - `'이어받기 계약의 인보이스 수금 전은 entitlement.startsAt 대신 billingDate 를 쓴다'` — `lastPaymentIntentId: null`, `billingPath: 'INVOICE'`, `startsAt '2026-10-26'`, `billingDate '2026-11-15'` → `2026-11-15`.
  - `'이어받기 계약이 아니면 기존 값 그대로'` — 무료체험 계약(`billingDate` 미래, `isGrantTakeoverContract → false`) → 결제일/`startsAt` 그대로.
  - `'갱신 결제 후에는 결제일이 더 늦으므로 결제일'` — `findLastChargeSuccessAt → 2026-12-15`, `billingDate '2026-11-15'` → `2026-12-15`.
  - `refund-policy.service.spec.ts` 에 한 케이스: `'유료 시작 전(paidPeriodStart 가 미래)이면 혜택 사용과 무관하게 WITHDRAWAL_FULL'` — `currentPeriodBenefit` 는 0(미래 기준점 이후 사용 없음)으로 주고 `immediateRefund.refundKind === 'WITHDRAWAL_FULL'`.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/membership/src/services/subscription/__tests__ --maxWorkers=2`
Expected: 신규 케이스 FAIL (refund-policy 케이스는 이미 PASS 일 수 있다 — 회귀 고정용)

- [ ] **Step 3: 구현**

`resolvePaidPeriodStart` 의 기존 결과를 `base` 로 두고, `contract.billingDate && await this.contractReader.isGrantTakeoverContract(contract.id)` 이면 `max(base ?? billingDate, new Date(contract.billingDate))`. `base` 가 null(결제 없음 + 인보이스 아님)이면 null 유지.

- [ ] **Step 4: 통과 확인**

Run: 같은 명령
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/membership/src/services/subscription/
git commit -m "fix(membership): 임시 이용권 이어받기 계약은 환불 판정을 유료 시작일부터 센다"
```

---

### Task 4: 일시결제 이어받기

**Files:**
- Modify: `apps/membership/src/services/subscription/subscription.creator.ts` (one_time `endsAt` :177)
- Modify: `apps/membership/src/services/subscription.service.ts` (`createSubscription` :153, `createCheckoutIntent` :214)
- Test: `apps/membership/src/services/subscription/subscription.creator.grant-takeover.spec.ts` (기존에 추가), `apps/membership/src/services/subscription-grant-takeover.spec.ts` (기존에 추가)

**Interfaces:**
- Consumes: 기존 `contractReader.findGrantTakeover(contractId, entitlementEndsAt): Promise<GrantTakeover | null>`, `createNewSubscription(…, grantTakeover?)`

- [ ] **Step 1: 실패하는 테스트 작성**

creator spec:
  - `'one_time 이어받기는 종료일이 오늘 + 남은 일수 + 플랜 일수'` — `remainingDays: 20`, `plan.durationDays: 365` → entitlement `endsAt === addDays(today, 385)` 의 날짜, contract `billingDate === addDays(today, 20)` 의 날짜.
  - `'one_time 이어받기 없으면 종료일은 오늘 + 플랜 일수 (기존)'`.

service spec (`makeService` 재사용, `createSubscription`·`createCheckoutIntent` 용 목 추가):
  - `'createCheckoutIntent: 지급분이면 거절하지 않고 결제창을 만든다'`, `'결제로 생긴 이용권이면 거절'`.
  - `'createSubscription: 지급분이면 grantTakeover 를 creator 에 넘긴다'`.
  - `'createSubscription: 확정 시점에 이용권이 없으면(임시 이용권 만료) grantTakeover 없이 일반 가입'` — `getUserEntitlement → null` → creator 마지막 인자 `undefined`.
  - `'createSubscription: 확정 시점에 결제 이용권이면 ActiveSubscriptionExistsException'`.

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/membership/src/services/subscription-grant-takeover.spec.ts apps/membership/src/services/subscription/subscription.creator.grant-takeover.spec.ts --maxWorkers=2`
Expected: FAIL

- [ ] **Step 3: 구현**

creator: one_time `endsAt = addDays(billingDate, plan.durationDays)` (one_time 은 체험 0 이라 이어받기 없으면 `billingDate == startsAt`). service: 두 메서드의 `if (existing) throw` 를 `subscribeWithBillingMethod` :575 와 같은 `findGrantTakeover` 판정으로 바꾸고, `createSubscription` 은 `createNewSubscription` 마지막 인자로 넘긴다(현재 8개 인자 뒤 9번째).

- [ ] **Step 4: 통과 확인**

Run: 같은 명령
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/membership/src/services/
git commit -m "feat(membership): 임시 이용권 고객의 일시결제 가입 — 남은 임시 일수 뒤에 유료 기간을 붙인다"
```

---

### Task 5: 검증 게이트

- [ ] **Step 1:** Run: `npm run type-check` — Expected: 에러 0
- [ ] **Step 2:** Run: `npx jest --maxWorkers=2` — Expected: 실패 0
- [ ] **Step 3:** Codex 브랜치 리뷰(`codex:codex-rescue`) — 이 계획과 이슈 #1067 결정 사항 대비. 지적 반영 후 Step 1~2 재실행.

---

## 2차 범위 (2026-10-27 추가)

Task 1~5 와 최종 리뷰 수정(`2a5251ee8`)까지 끝난 뒤, 같은 PR 에서 마저 해결하기로 한 것.

### Task 6: 회원 단위 잠금으로 가입·해지·만료 직렬화

**문제:** 세 경로의 잠금 순서가 엇갈려 같은 회원에게 동시에 일어나면 교착할 수 있다.
- 가입(이어받기): `SubscriptionCreator.createNewSubscription` 이 지급 계약 갱신 → 이용권 닫기 (advisory lock `membership-signup:<userId>` 는 가입끼리만 직렬화).
- 해지: `voidSubscription`·`cancelImmediately`·`forceCancelSubscription` 이 계약 `FOR NO KEY UPDATE` → 이용권 닫기.
- 만료: `BillingOutcomeHandler.handleExpiration` 이 이용권 닫기 → 계약 `EXPIRED` 갱신.

**Files:**
- Create: `apps/membership/src/services/subscription/membership-user-lock.ts` — `lockMembershipUser(tx: DrizzleTransaction, userId: string): Promise<void>` (기존 키 `membership-signup:<userId>` 그대로 `pg_advisory_xact_lock(hashtext(...))`).
- Modify: `subscription.creator.ts` (기존 인라인 잠금을 헬퍼로), `subscription.manager.ts` `voidSubscription`, `subscription-cancellation.manager.ts` `cancelImmediately`·`forceCancelSubscription`, `billing/billing-outcome.handler.ts` `handleExpiration` — 각 트랜잭션 맨 앞에서 호출.
- Test: 각 경로가 트랜잭션 첫 문장으로 같은 키의 잠금을 거는지(실행 순서 기록 목).

**Interfaces:** Produces `lockMembershipUser`. advisory xact lock 은 같은 트랜잭션 안 재진입이 안전하다(복구의 `grantUntil` 은 같은 tx).

- [ ] 실패 테스트 → 구현 → `npx jest apps/membership --maxWorkers=2` → type-check → 커밋

### Task 7: 실제 DB 통합 스펙

**Files:** Create `apps/membership/test/integration/grant-takeover.integration.spec.ts` (`describeIfDb`/`REQUIRE_MEMBERSHIP_DB=1` 가드, 기존 `test/integration/subscription-cancellation.integration.spec.ts` 구성 방식을 따른다).

- [ ] `'즉시해지 후 임시 이용권이 복구되고, 같은 결제의 환불 재배달이 복구분을 닫지 않는다'` — current 이용권 1개, endsAt = billingDate.
- [ ] `'임시 기간 혜택 사용과 유료 기간 재사용이 다른 행으로 남고, 유료 기간 사용만 청약철회를 막는다'`.
- [ ] `'같은 intent 동시 확정 두 번 → 계약 1개, 두 번째는 ActiveSubscriptionExistsException'`.
- [ ] `'확정 도중 지급분 만료 → 남은 일수 0으로 가입'`.
- [ ] `'가입과 만료를 동시에 → 교착 없이 둘 다 끝난다'` (Task 6 회귀).
- [ ] 실행: `dotenv -e apps/membership/.env -- npx jest apps/membership/test/integration/grant-takeover --runInBand` (로컬 도커 DB). 기본 `npx jest` 에서는 skip 이어야 한다.

### Task 8: 멤버십 홈 가입 버튼 (시안 확인 후)

**Files:** `web/almondyoung-storefront/src/domains/membership/home/components/subscriber/member-details.tsx` 의 `adminGrant` 분기, `src/i18n/messages/{ko,en,ja}/mypage.json`.

- [ ] 사용자가 고른 시안대로 버튼과 안내 한 줄. 문구는 시안 확정본, 링크는 `LocalizedClientLink` 로 `/mypage/membership/subscribe`.
- [ ] `npm run build`(storefront) 통과 확인.

---

## 3차 범위 (2026-10-27 추가, #1067 1번·3번)

4번(유료 이용 중 추가 무상 기간)은 지금 동작(기간 조정, 청구일 유지)을 유지하기로 했다. 환불 계산상 회사 손해가 없다(청약철회 창은 결제 시각, 연간 차감은 결제일 기준).

### Task 9: 임시 이용권 해지 안내 정리 (#1067 1번)

- 백엔드: 고객 해지(`SubscriptionCancellationService.cancelSubscription`)는 대상 계약이 관리자 지급 계약(`findAdminGrantDays(contract.id) !== null`)이면 해지 예약·즉시해지 모두 거절한다(`BadRequestError('임시 이용권은 종료일까지 이용하면 자동으로 끝나요.')`). 판단은 사용자의 지급 이력이 아니라 대상 계약 기준. 관리자 강제취소·탈퇴 경로는 그대로.
- 해지 미리보기(고객용)는 지급 계약이면 해지 불가로 내려 화면이 버튼을 그리지 않게 한다(필드 하나로 충분하면 그것만).
- 스토어프론트(`subscriber-section.tsx`): `adminGrant` 이면 해지 버튼, 해지 예약 배너, 1회 결제 철회 불가 안내를 그리지 않는다. 대신 안내 한 줄 "종료일까지 이용하면 자동으로 끝나요"(ko/en/ja).
- 과거 데이터: 임시 계약에 이미 찍힌 `recurringCancelledAt` 은 그대로 둔다. 임시 계약은 어차피 종료일에 끝나고, 화면은 위 분기로 예약 표시를 하지 않는다. 마이그레이션 없음.
- 테스트: 지급 계약 고객 해지 거절(두 모드), 유료 계약은 기존대로, 스토어프론트 분기.

### Task 10: 절약 금액 주기에서 이어받은 임시 기간이 빠지는 것 (#1067 3번)

- `SavingsService.resolvePeriods`: 이어받혀 닫힌 지급 계약(`SUPERSEDED_BY_SUBSCRIPTION`, `metadata.newContractId`)의 주기 끝을 `cancelledAt` 이 아니라 새 계약의 `billingDate` 로 둔다. 그러면 가입 후 남은 임시 기간 구매는 임시 계약 주기로, 유료 시작 후 구매는 유료 주기로 나뉘고 어느 쪽에서도 빠지지 않는다. 새 계약 주기 시작(`billingDate`)은 그대로.
- 테스트: 지급 10/1~, 10/26 이어받기(남은 20일, billingDate 11/15) → 10/30 구매는 임시 계약 주기, 11/20 구매는 유료 주기, 둘 다 누적에 포함. 이어받기 없는 계약은 기존과 같음.
