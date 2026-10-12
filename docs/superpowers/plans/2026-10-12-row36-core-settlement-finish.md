# #1016 36번 마무리 ② — core·admin-web: 송금 대기를 고객에게, 재발행 1분, 금액 확인 칩 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 36번 재설계의 남은 core·admin-web 한계 셋과 스펙 문장 하나를 닫는다 — ② 자동 정산이 wallet 에서 «송금 대기»로 떨어져도 고객 배지가 «환불 완료»
④ 리컨실러 백오프가 스펙 문장과 다름(코드를 따르고 스펙을 고친다) ⑤ 일시 실패 뒤 첫 재발행이 약 10.5분 ⑥ «이미 환불한 금액 확인»을 물은 정산도 칩이 «환불 거절».

**Architecture:** ② 고객 배지(`channelRefundStatus`)는 지금 «수동으로 끝난 정산»일 때만 wallet 의 송금 대기 행을 묻는다. 자동으로 끝난 정산도 묻되,
wallet 이 답하지 못하면 자동 정산은 지금처럼 기존 도출(null)로 둔다 — 수동만 «모름 = 송금 전»이다. ⑤ 리컨실러 규칙이 «할 일 없음» 뒤 다시 볼 간격을
규칙마다 정할 수 있게(`idleRecheckMin`, 기본 10분) 하고 정산 재시도 규칙만 1분으로 둔다. ⑥ admin-web 에 정산 이름 함수 하나(`settlementLabel`)를 두고
칩·줄·취소 칸이 그걸 쓴다.

**Tech Stack:** NestJS, Drizzle, Jest(ts-jest), admin-web(Next.js) Jest.

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` §7.3(리컨실러)·§8.2(고객 배지).
한계의 출처: 스모크 발견 ③④(2026-10-12, #1016 36번), PR #1052 표 D3·PR #1053 E3(백오프), PR #1049 D8(무통장 폴백). 판단은 #1016 36번 행 본문(2026-10-12).
짝 계획: `docs/superpowers/plans/2026-10-12-row36-wallet-ambiguous-refund.md` — 그 Task 1 이 무통장 폴백 행을 `MANUAL` 로 적어야 ② 가 그 행을 본다.
둘은 아무 순서로 배포해도 된다(이 PR 만 나가면 무통장 폴백 행이 아직 `AUTO` 라 배지가 지금과 같다).

## Global Constraints

- 고객 배지 규칙(스펙 §8.2·`channel-refund-status.ts` 머리 주석): **«완료»라고 했다가 돈이 안 갔으면 거짓이다.** 다만 자동 정산은 wallet 장애 때 «송금 예정»으로 바꾸면 그것도 거짓이므로, 모름(`unknown`)을 «송금 전»으로 읽는 것은 수동 정산뿐이다
- wallet 조회는 기존 `WalletRefundClient.listRefundsByIntent`(2초 시간 초과, 실패 = null)를 그대로 쓴다. 새 HTTP 호출 경로를 만들지 않는다
- 리컨실러 틀의 백오프(1·4·16·64·256분, 5회 뒤 자동 멈춤, 1024분 재확인)는 **바꾸지 않는다** — 규칙마다 백오프가 갈리면 공용 틀이 갈라진다(PR #1052 D3·#1053 E3 판정 유지). 스펙 문장을 코드에 맞춘다
- `idleRecheckMin` 은 «check 가 false 였다»(할 일 없음) 기록에만 쓴다. 칸을 벗어난 게이트 기록(`gated`)은 지금처럼 10분
- 마이그레이션 없음. core·admin-web 은 한 스택이라 함께 나간다
- 서비스 코드에 `any`·`as` 를 새로 들이지 않는다. 스펙 안 `dotenv.config()` 금지
- 게이트: `npm run type-check` 0 · `npx jest` 0 · `npm run test:admin-web` 0 · admin-web `npx tsc --noEmit -p apps/admin-web`(CI 가 안 돌린다 — 메모리 `admin-web-no-component-tests`)

## Review Focus

- **자동 정산 + wallet 장애** — 배지가 «송금 예정»으로 바뀌면 안 된다(대부분의 자동 정산은 카드 환불로 진짜 끝났다). Task 1 의 «자동만 끝남 + unknown → null» 테스트가 지킨다
- **자동·수동이 섞인 주문 + wallet 장애** — 수동이 하나라도 있으면 지금처럼 «송금 예정». Task 1 테스트가 지킨다
- **마이페이지 목록(최대 100건 배치)의 wallet 호출 수** — 이제 «정산이 끝난 채널 취소 주문»마다 한 번 부른다(지금은 수동만). 취소 주문만이라 한 페이지 몇 건이고 시간 초과 2초라 목록을 막지 않는다. PR 본문에 적는다
- **정산 재시도 규칙의 1분 재확인이 백오프를 덮지 않는가** — `act` 뒤 간격은 여전히 1·4·16…분이어야 한다. Task 2 의 nextRecord 테스트가 `act` 경로는 `idleRecheckMin` 을 무시함을 지킨다
- **칩 이름이 바뀐 뒤 alert(빨강)** — «이미 환불한 금액 확인 필요»도 거절이므로 빨강이어야 한다. Task 3 테스트가 `alert: true` 를 지킨다

---

## 실행 준비

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin && git pull --ff-only
git worktree add .claude/worktrees/fix-1016-36-core-finish -b fix/1016-36-core-finish origin/develop
cd .claude/worktrees/fix-1016-36-core-finish
npm ci && (cd apps/admin-web && npm ci)
ln -s ../../../native/warehouse-app/node_modules native/warehouse-app/node_modules 2>/dev/null || true
```

---

### Task 1: 자동으로 끝난 정산도 wallet 의 송금 대기를 묻는다 (②)

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/channel-refund-status.ts`
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:756-763`
- Test: `apps/core/src/modules/sales-order/services/channel-refund-status.spec.ts`

**Interfaces:**
- Produces: `needsTransferCheck(facts: ChannelSettlementFact[]): boolean` (이름 바뀜 — `needsManualTransferCheck` 는 지운다), `channelRefundStatus(facts, transfer)` 시그니처 그대로

- [ ] **Step 1: 테스트를 먼저 고친다**

`channel-refund-status.spec.ts` 의 import 를 `needsTransferCheck` 로 바꾸고, `channelRefundStatus` describe 의 «자동으로 끝남» 테스트를 아래로 바꾸고 둘을 더한다:

```ts
  it('자동으로 끝남 → wallet 이 송금 대기(무통장 계좌 없음 폴백)를 갖고 있으면 transfer_pending, 아니면 기존 도출', () => {
    expect(channelRefundStatus([applied('auto')], 'pending')).toBe('transfer_pending');
    expect(channelRefundStatus([applied('auto')], 'done')).toBeNull();
  });
  it('자동으로만 끝남 + wallet 모름 → 기존 도출 — 대부분 카드 환불로 진짜 끝났다, «송금 예정»도 거짓일 수 있다', () => {
    expect(channelRefundStatus([applied('auto')], 'unknown')).toBeNull();
    expect(channelRefundStatus([applied('auto')], null)).toBeNull();
  });
  it('자동·수동 섞임 + wallet 모름 → 수동이 있으니 transfer_pending(지금 그대로)', () => {
    expect(channelRefundStatus([applied('auto'), applied('manual')], 'unknown')).toBe('transfer_pending');
  });
```

`needsManualTransferCheck` describe 를 통째로 바꾼다:

```ts
describe('needsTransferCheck — 정산이 끝났고 정산 중인 것이 없으면 wallet 의 송금 대기를 묻는다(자동도 — wallet 이 수동으로 떨어뜨릴 수 있다)', () => {
  it('끝난 정산이 하나라도 있고 정산 중인 것이 없을 때만', () => {
    expect(needsTransferCheck([applied('auto')])).toBe(true);
    expect(needsTransferCheck([applied('manual'), applied('auto')])).toBe(true);
    expect(needsTransferCheck([settling('in_progress'), applied('manual')])).toBe(false);
    expect(needsTransferCheck([])).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/sales-order/services/channel-refund-status.spec.ts`
Expected: FAIL — `needsTransferCheck` 없음, 자동 + pending 이 null

- [ ] **Step 3: 구현**

`channel-refund-status.ts` 의 `needsManualTransferCheck` 를 바꾼다:

```ts
/**
 * 정산이 끝났으면 wallet 에 송금 대기 행을 묻는다(스펙 §8.2). 수동 정산은 물론이고, 자동 정산도 wallet 이 PG 를 못 불러
 * «송금 대기»(MANUAL PENDING)로 떨어뜨릴 수 있다 — 무통장 계좌 없음 폴백(#1016 36번 마무리 ②). 정산 중이면 묻지 않는다(정산 칸이 말한다).
 */
export function needsTransferCheck(facts: ChannelSettlementFact[]): boolean {
  if (facts.some((f) => f.status === 'settling')) return false;
  return facts.some((f) => f.status === 'applied');
}
```

`channelRefundStatus` 의 마지막 두 줄을 바꾼다:

```ts
  if (open.length > 0) return 'pending';
  if (manualTransfer === 'pending') return 'transfer_pending';
  // wallet 을 모를 때 «아직 송금 전»으로 읽는 것은 수동 정산뿐이다 — 자동 정산은 대부분 PG 환불로 끝났으니 지금 도출을 쓴다
  if (manualTransfer === 'unknown' && facts.some((f) => f.status === 'applied' && f.mode === 'manual')) return 'transfer_pending';
  return null;
```

`store-sales-orders.service.ts` 의 import 와 `channelSettlementRefundStatus` 를 `needsTransferCheck` 로:

```ts
    const transfer = needsTransferCheck(facts)
      ? manualTransferOf(so.walletIntentId ? await this.walletRefundClient.listRefundsByIntent(so.walletIntentId) : null)
      : null;
```

`grep -rn "needsManualTransferCheck" apps/ libs/` 로 남은 참조가 0 인지 본다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/sales-order` → PASS
Run: `npm run type-check` → 0

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/sales-order/services/
git commit -m "fix(core): 자동 정산도 wallet 송금 대기를 물어 고객에게 «계좌 송금 예정»으로 보인다 (#1016 36번 마무리 ②)"
```

---

### Task 2: 정산 재시도 규칙은 «할 일 없음» 뒤 1분에 다시 본다 (⑤)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.ts` (`nextRecord` 입력)
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts` (`ReconcileRuleBody`)
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts:204-212`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.spec.ts`

**Interfaces:**
- Produces: `ReconcileRuleBody.idleRecheckMin?: number`, `nextRecord(eff, input: { …; idleRecheckMin?: number }, now)`

**왜 1분인가:** 정산을 막 (다시) 시작하면 60초 동안은 재발행하지 않는다(`SETTLEMENT_REISSUE_GRACE_MS`). 리컨실러의 첫 평가는 거의 늘 그 60초 안에 와서
check 가 false → `not_needed` → `IDLE_RECHECK_MIN`(10분) 뒤 재확인이 된다. 운영자의 [다시 시도] 뒤에도 같다(스모크 실측 ≈10.5분). 대상은
«정산 중인 채널 취소 주문»뿐이라 매분 봐도 부담이 없다.

- [ ] **Step 1: 상태 테스트**

`order-reconcile.state.spec.ts` 의 `describe('nextRecord'` 안에:

```ts
  it('할 일 없음(not_needed)의 재확인 간격은 규칙이 정할 수 있다 — 기본 10분', () => {
    expect(nextRecord(fresh, { ...base, step: 'not_needed' }, NOW).nextCheckAt).toEqual(plusMin(10));
    expect(nextRecord(fresh, { ...base, step: 'not_needed', idleRecheckMin: 1 }, NOW).nextCheckAt).toEqual(plusMin(1));
  });

  it('idleRecheckMin 은 실행 뒤 백오프를 바꾸지 않는다', () => {
    expect(nextRecord(fresh, { ...base, step: 'act', outcome: 'acted', idleRecheckMin: 1 }, NOW).nextCheckAt).toEqual(plusMin(1));
    expect(nextRecord({ ...fresh, attempts: 1 }, { ...base, step: 'act', outcome: 'acted', idleRecheckMin: 1 }, NOW).nextCheckAt).toEqual(plusMin(4));
  });
```

`retry-channel-settlement.rule.spec.ts` 의 첫 테스트에 한 줄:

```ts
    // 막 (다시) 시작한 정산은 60초 유예 안이라 첫 평가가 «할 일 없음»이 된다 — 10분이 아니라 1분 뒤에 다시 본다(스모크 발견 ④)
    expect(rule.idleRecheckMin).toBe(1);
```

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.state.spec.ts apps/core/src/modules/fulfillment/order-reconcile/rules/retry-channel-settlement.rule.spec.ts`
Expected: FAIL

- [ ] **Step 2: 구현**

`order-reconcile.state.ts` 의 `nextRecord` 입력 타입에 칸을 더하고 not_needed·would_act 분기에서 쓴다:

```ts
  input: {
    fingerprint: string;
    mode: ReconcileMode;
    step: ReconcileStep;
    outcome?: 'acted' | 'error';
    error?: string | null;
    /** 할 일이 없었을 때(not_needed·would_act) 다시 볼 간격. 규칙이 정한다 — 없으면 IDLE_RECHECK_MIN */
    idleRecheckMin?: number;
  },
  ...
      nextCheckAt: plusMinutes(now, input.idleRecheckMin ?? IDLE_RECHECK_MIN),
```

`order-reconcile.rule.ts` 의 `ReconcileRuleBody` 에:

```ts
  /** check 가 false(할 일 없음)였을 때 다시 볼 간격(분). 없으면 틀 기본 10분. 칸을 벗어난 게이트 기록에는 쓰지 않는다 */
  readonly idleRecheckMin?: number;
```

`order-reconcile.runner.ts` 의 check 경로 `nextRecord` 호출(게이트 기록이 아닌 쪽, `{ fingerprint, mode: rule.mode, step, outcome: … }`)에 칸을 더한다:

```ts
              nextRecord(
                eff,
                { fingerprint, mode: rule.mode, step, outcome: step === 'act' ? 'acted' : undefined, idleRecheckMin: rule.idleRecheckMin },
                now,
              ),
```

`retry-channel-settlement.rule.ts`:

```ts
  readonly mode: ReconcileMode = 'act';
  // 막 (다시) 시작한 정산은 SETTLEMENT_REISSUE_GRACE_MS(60초) 안이라 첫 평가가 늘 «할 일 없음»이다 — 10분이 아니라 1분 뒤에 다시 본다
  readonly idleRecheckMin = 1;
```

- [ ] **Step 3: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile` → PASS
Run: `npm run type-check` → 0

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "fix(core): 정산 재시도는 유예 직후 1분에 다시 본다 — 첫 재발행 10분 지연 (#1016 36번 마무리 ⑤)"
```

---

### Task 3: «이미 환불한 금액 확인 필요»를 칩 이름으로 (⑥)

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts`
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx:10,865`
- Test: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts`

**Interfaces:**
- Produces: `export function settlementLabel(s: SettlementView): string`

- [ ] **Step 1: 테스트**

`cancel-request.shape.spec.ts` 의 `describe('정산(#1016 36번 재설계)'` 안에(그 describe 의 `settlement()` 픽스처를 쓴다). import 에 `settlementLabel` 추가:

```ts
  it('칩 이름 — 채널이 «이미 환불한 금액»을 물은 거절(external_refund_*)은 거절과 할 일이 달라 따로 부른다(스모크 발견 ③)', () => {
    const asked = settlement({ lastFailure: { code: 'external_refund_unresolved', message: 'x', retryable: false, at: 'x' } });
    expect(settlementLabel(asked)).toBe('이미 환불한 금액 확인 필요');
    expect(settlementLabel(settlement())).toBe('환불 거절');
    expect(settlementLabel(settlement({ phase: 'delayed' }))).toBe('환불 지연');
    // 다시 시도해 진행 중이면 지난 실패로 이름을 정하지 않는다
    expect(settlementLabel({ ...asked, phase: 'in_progress' })).toBe('환불 처리 중');
  });

  it('취소 칸 — 금액 확인 거절도 빨강(alert)이다', () => {
    const request = toCancelRequestView({
      id: 'r1',
      status: 'settling',
      scope: 'partial',
      settlement: settlement({ lastFailure: { code: 'external_refund_unresolved', message: 'x', retryable: false, at: 'x' } }),
    });
    expect(cancelActionOf({ channel: 'medusa', orderStatus: 'processing', cancelRequest: request })).toEqual({
      kind: 'settling',
      label: '이미 환불한 금액 확인 필요',
      alert: true,
    });
  });
```

`cancelRequestLine` 의 settling 줄도 확인하는 테스트 하나:

```ts
  it('요청 줄 — 금액 확인 거절은 «부분취소 확정 · 이미 환불한 금액 확인 필요»', () => {
    const v = toCancelRequestView({
      id: 'r1',
      status: 'settling',
      scope: 'partial',
      settlement: settlement({ lastFailure: { code: 'external_refund_exceeds', message: 'x', retryable: false, at: 'x' } }),
    });
    expect(cancelRequestLine(v!)).toBe('부분취소 확정 · 이미 환불한 금액 확인 필요');
  });
```

(`toCancelRequestView` 가 null 을 돌려줄 수 있는 타입이면 기존 테스트들처럼 `as never` 또는 `!` 를 쓴다 — 그 파일의 관례를 따른다.)

Run: `npm run test:admin-web -- cancel-request.shape` → FAIL

- [ ] **Step 2: 구현**

`cancel-request.shape.ts` 의 `SETTLEMENT_LABELS` 아래(그리고 `EXTERNAL_REFUND_PREFIX`·`REJECTION_LABELS` 선언 뒤 — 순서가 안 맞으면 함수를 `settlementReason` 바로 위로 둔다):

```ts
/**
 * 정산의 칩·줄 이름. 거절 중 채널이 «이미 환불한 금액»을 물은 것(#1016 37번, external_refund_*)은 운영자가 할 일이 다르다 —
 * 계좌 송금이 아니라 [다시 시도]에 금액을 넣는다. 그래서 «환불 거절» 대신 그 말로 부른다(36번 스모크 발견 ③).
 */
export function settlementLabel(s: SettlementView): string {
  if (s.phase === 'refused' && s.lastFailure?.code.startsWith(EXTERNAL_REFUND_PREFIX)) {
    return REJECTION_LABELS.EXTERNAL_REFUND_UNRESOLVED;
  }
  return SETTLEMENT_LABELS[s.phase];
}
```

`cancelActionOf` 의 settling 분기:

```ts
  if (request?.status === 'settling') {
    const phase = request.settlement?.phase ?? 'in_progress';
    const label = request.settlement ? settlementLabel(request.settlement) : SETTLEMENT_LABELS.in_progress;
    return { kind: 'settling', label, alert: phase !== 'in_progress' };
  }
```

`cancelRequestLine` 의 settling:

```ts
      return view.settlement ? `${name} 확정 · ${settlementLabel(view.settlement)}` : `${name} 확정 · 정산 중`;
```

`features/order/history/components/table/index.tsx`: import 의 `SETTLEMENT_LABELS` 를 `settlementLabel` 로 바꾸고 865행을:

```tsx
                      {settlementLabel(r.cancelRequest.settlement)}
```

`grep -rn "SETTLEMENT_LABELS\[" apps/admin-web/src` 로 남은 직접 조회가 `settlementLabel` 안의 하나뿐인지 본다. 정체 보드의 `settle_refused` 라벨(`order-progress.shape.ts`)은 상태 단위 집계라 실패 코드가 없다 — 바꾸지 않는다.

- [ ] **Step 3: 통과 확인**

Run: `npm run test:admin-web` → PASS
Run: `npx tsc --noEmit -p apps/admin-web` → 0

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/lib/api/domains/orders/ apps/admin-web/src/features/order/history/components/table/index.tsx
git commit -m "fix(admin-web): «이미 환불한 금액» 확인을 묻는 정산은 칩도 그 말로 (#1016 36번 마무리 ⑥)"
```

---

### Task 4: 스펙 문장을 코드에 맞춘다 (④) · 게이트 · PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md:270-273`

- [ ] **Step 1: §7.3 리컨실러 규칙 문장**

270행 «검사» 줄과 273행 «백오프·포기를 틀이…» 줄을 바꾼다:

```markdown
- 검사: 요청이 `settling`, `state ≠ refused`, 마지막 (다시) 시작에서 60초(`SETTLEMENT_REISSUE_GRACE_MS`)가 지남. 지문 = 요청 id + `state` + `mode`.
  할 일이 없었으면 1분 뒤 다시 본다(규칙의 `idleRecheckMin`).
...
- 백오프·포기는 리컨실러 틀의 것을 그대로 쓴다 — 실행 뒤 1·4·16·64·256분, 5회 뒤 «자동 멈춤»(정체 보드에 보인다), 그 뒤로도 1024분(약 17시간)마다 한 번 더 해 본다.
  처음 이 절은 «1분 → 5분 → 15분 → 이후 1시간, 포기 없음»이었으나, 규칙마다 백오프를 두면 공용 틀이 갈라져 틀을 따랐다(PR #1052 D3·#1053 E3, 2026-10-12 #1016 36번 마무리에서 확정).
```

- [ ] **Step 2: 게이트 전체**

```bash
npm run type-check
npx jest
npm run test:admin-web
npx tsc --noEmit -p apps/admin-web
```

Expected: 전부 0

- [ ] **Step 3: Commit · push · PR**

```bash
git add docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md
git commit -m "docs: 36번 스펙 §7.3 — 리컨실러 백오프는 틀을 따른다(자동 멈춤·17시간 재확인)"
git push -u origin fix/1016-36-core-finish
```

PR 본문에 적을 것: 바꾼 셋(②⑤⑥)과 스펙 정정(④), 마이페이지 목록의 wallet 호출 증가(정산 끝난 채널 취소 주문당 1회, 2초 시간 초과), 마이그 없음, 짝 PR(wallet 계획)과 순서 무관.
배포 뒤 확인: 로컬에서 스모크 S4(wallet 내림 → 정산 일시 실패 → 올림)를 다시 해 첫 재발행이 2분 안에 오는지. 머지되면 #1016 36번 해결 칸에 해시.
