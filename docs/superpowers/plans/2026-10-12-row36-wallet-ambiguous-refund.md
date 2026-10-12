# #1016 36번 마무리 ① — wallet: 응답 끊긴 환불은 같은 키로, 수동 폴백은 MANUAL 로 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 36번 재설계가 남긴 wallet 쪽 한계 셋을 닫는다 — ① 결제사 응답이 끊긴 환불(`PROVIDER_EXCEPTION`)을 재시도하면 부분환불이 두 번 나갈 수 있다
② 무통장 «계좌 없음» 폴백이 `AUTO` 송금 대기라 고객에게 «환불 완료»로 보이고 정산 장부에도 안 들어간다(D8) ③ 멈춘 `AUTO` PENDING 을 끝낼 주체가 없다(D8).

**Architecture:** 환불 행의 멱등 키는 이미 행 id 에서 나온다(`wallet:refund:<id>`). 토스는 같은 멱등 키로 다시 온 POST 에 «첫 요청이 처리됐으면 그 응답을,
아니면 이제 처리»한다(유효 15일, 아래 «근거»). 그래서 «돈이 나갔는지 모르는» 행은 **새 행을 만들지 않고 같은 행을 다시 보낸다** — 응답 끊긴 FAILED 행은
다음 환불 요청이 그 결제분을 잠근 채 되살려 보내고(①), 멈춘 AUTO PENDING 행은 5분 크론이 같은 행을 다시 보낸다(③). provider 호출과 결과 기록은
`create()` 에서 떼어 `dispatch(행)` 하나로 모은다. 무통장 provider 가 PG 를 안 부르고 PENDING 을 낼 때는 `manualTransfer: true` 를 붙이고,
wallet 은 그 행을 `execution: MANUAL` 로 적는다(②) — 그러면 이미 있는 수동 송금 경로(Medusa 장부 맞추기·환불 내역 [완료 처리]·«계좌 송금» 라벨)를 그대로 탄다.

**Tech Stack:** NestJS, Drizzle(postgres.js), `@app/cron-once`, Jest(ts-jest transpile-only), 실 Postgres 통합 스펙(`describeIfDb`).

**Spec:** `docs/superpowers/specs/2026-10-11-channel-cancel-settlement-design.md` §6.2(장부 맞추기)·§6.3(수동 실행)·§6.5(모르면 일시).
한계의 출처: PR #1048 «알려진 한계»(PROVIDER_EXCEPTION), PR #1049 표 D8·«알려진 한계»(멈춘 자동 PENDING·무통장 폴백). 판단은 #1016 36번 행 본문(2026-10-12).
짝 계획: `docs/superpowers/plans/2026-10-12-row36-core-settlement-finish.md`(core 가 «송금 대기»를 고객에게 말하게 — ② 의 나머지 반쪽).

## 근거 — 토스 멱등키 (2026-10-12 docs.tosspayments.com/reference/using-api/idempotency-key 확인)

- 「멱등키는 처음 요청에 사용한 날부터 15일간 유효합니다.」 모든 POST API 가 받는다 — 결제 취소 `POST /v1/payments/{paymentKey}/cancel` 포함
- 같은 요청이 다시 오면 「실제로 요청이 이루어지지 않고 첫 번째 요청 응답과 같은 응답」
- 원 요청이 아직 처리 중이면 409 `IDEMPOTENT_REQUEST_PROCESSING` — 「다시 한번 요청해서 응답을 확인」. 지금 코드표에 없으므로 `isTossRefundRetryable` 이 `true`(일시)로 읽는다 → 행이 FAILED·일시로 남고 다음 시도가 또 같은 행을 보낸다. 원하는 동작이다
- 「멱등한 요청에서 에러가 반환되었을 때 멱등키를 변경해서 동일한 요청을 재시도하는 것은 위험」 — 지금 코드가 정확히 이걸 한다(재시도 = 새 행 = 새 키)
- 포인트 provider 도 같은 키로 멱등이다 — `PointsLedgerService.refund` 가 `findEventByProviderIdempotencyKey` 로 이미 쌓인 REDEEM_CANCEL 을 돌려준다

## Global Constraints

- **응답 모양은 그대로.** `POST /v1/payment-intents/:id/refund` 는 지금처럼 환불 행 배열(200) 또는 4xx 거절 본문 `{ error, message, detail, retryable }`. Medusa `judgeWalletRefund`(`apps/medusa/src/modules/almond-payment/refund-data.ts`)는 **PENDING 을 성공으로 센다** — 응답 끊긴 행을 «되살린 채 PENDING» 으로 돌려주면 Medusa 가 «환불 완료»로 기록한다. 되살린 행은 `dispatch` 가 끝난 뒤의 상태(SUCCEEDED/FAILED)로만 나간다
- 새 4xx 코드는 `refund-refusal.ts` 의 표에 판정(`retryable`)과 운영자 한국어 문장을 함께 적는다(표가 강제한다). core `WalletRefundClient` 가 `body.error` 로 읽는 `REFUND_AMOUNT_EXCEEDS_*` 는 건드리지 않는다
- 되살리는 대상은 **만든 지 14일 이내**의 `FAILED` + `failure_code = 'PROVIDER_EXCEPTION'` + `execution = 'AUTO'` 행뿐(토스 키 15일에서 하루 여유). 그보다 오래된 행은 지금처럼 무시한다 — **기존 결제·환불 건은 처리된 것으로 간주**(2026-10-11 사용자 결정)라 소급 백필·재분류를 하지 않는다
- 크론이 다시 보내는 대상은 `PENDING` + `AUTO` + 마지막 갱신 30분 전 + 만든 지 14일 이내 + 결제수단 `TOSS`·`POINTS` 뿐. 무통장 AUTO PENDING 은 다시 보낼 때 고객 계좌가 필요한데 wallet 이 저장하지 않는다(#1048 한계, 개인정보) — 건너뛴다. 30분 = 토스 호출이 매달릴 수 있는 최장(undici 기본 headers·body 각 300초)의 세 배
- 크론은 `@CronOnce(expr, { name })`(CLAUDE.md «크론»). 이름은 앱 안에서 유일
- 마이그레이션 없음(칸은 #1048 이 이미 더했다). wallet 단독 배포, 다른 앱과 순서 없음
- 서비스 코드에 `any`·`as` 를 새로 들이지 않는다. wallet 은 Nest 예외(`BadRequestException(refundRefusal(...))`) 관례를 따른다
- 스펙 안에서 `dotenv.config()` 금지. DB 스펙은 `describeIfDb` + `REQUIRE_WALLET_DB=1`
- 게이트: `npm run type-check` 0 · `npx jest` 0 · wallet 통합 스펙(아래 «실행 준비»)

## Review Focus

- **같은 금액으로 다시 온 정산 요청(가장 흔한 경로)** — 리컨실러가 같은 `requestId` 로 정산을 다시 내면 Medusa 는 같은 금액으로 wallet 을 부른다. 새 행 없이 옛 행이 같은 키로 나가고, 응답이 그 행 하나여야 Medusa 가 그 id 로 Refund 를 적는다. Task 2 의 «같은 금액» 통합 테스트가 지킨다
- **다른 금액으로 온 요청** — 장부가 달라졌을 수 있다(그 사이 다른 환불). 옛 행만 확정하고 이번 요청은 일시 거절해야 다음 정산이 장부를 다시 맞춘다. 옛 행 결과와 이번 요청을 합쳐 보내면 이중 환불이다. Task 2 의 «다른 금액» 테스트가 지킨다
- **되살려 보냈는데 또 예외** — 행은 FAILED·`PROVIDER_EXCEPTION` 으로 되돌아가고 새 행은 없어야 한다(다음 시도가 또 같은 행). Task 2 테스트가 지킨다
- **크론과 진행 중 요청의 경합** — 크론이 갓 만든 PENDING 을 집으면 같은 키로 두 번 보내게 된다(토스는 409 로 막지만 기록이 꼬인다). 30분 문턱 + `updated_at` CAS 로 한 주체만 집는다. Task 3 의 «젊은 행·MANUAL·무통장은 그대로»·«두 번 돌아도 한 번» 테스트가 지킨다
- **무통장 폴백이 MANUAL 이 된 뒤의 [완료 처리]** — `isManuallyConfirmable` 은 무통장 PENDING 을 원래 받으므로 그대로 통과해야 한다. Task 1 통합 테스트가 `confirmManual` 까지 지난다

---

## 실행 준비 (태스크 전에 한 번)

```bash
cd /home/pauseb/workspace/almondyoung-server
git fetch origin && git pull --ff-only
git worktree add .claude/worktrees/fix-1016-36-wallet-ambiguous -b fix/1016-36-wallet-ambiguous origin/develop
cd .claude/worktrees/fix-1016-36-wallet-ambiguous
npm ci
# 워크트리 type-check 는 이 둘이 없으면 빨갛다(메모리 — 정체 보드 PR 때 실측)
ln -s ../../../native/warehouse-app/node_modules native/warehouse-app/node_modules 2>/dev/null || true
```

wallet 통합 스펙용 임시 DB(로컬 postgres 컨테이너, 이 PR 전용):

```bash
# 로컬 postgres 접속 정보는 apps/wallet/.env 의 DATABASE_URL 에서 호스트·비밀번호를 읽는다
createdb -h localhost -U postgres wallet_row36 || true
DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/wallet_row36 npx drizzle-kit migrate --config apps/wallet/drizzle.config.ts
# 이후 통합 스펙 실행
DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/wallet_row36 REQUIRE_WALLET_DB=1 \
  npx jest apps/wallet/src/refunds/refund-settlement.integration.spec.ts --runInBand
```

**라이브 읽기 전용 실측(사용자가 `!` 로 실행 — 운영 DB 읽기는 권한 분류기가 막는다).** 배포 직후 크론과 되살리기가 무엇을 건드릴지 미리 센다:

```sql
-- ① 되살리기 대상: 14일 안 응답 끊긴 행
SELECT r.id, r.amount, r.created_at, pm.type
  FROM refunds r JOIN charges c ON c.id = r.charge_id JOIN payment_methods pm ON pm.id = c.payment_method_id
 WHERE r.status = 'FAILED' AND r.failure_code = 'PROVIDER_EXCEPTION' AND r.execution = 'AUTO'
   AND r.created_at > now() - interval '14 days';
-- ② 크론 대상: 30분 넘게 멈춘 AUTO PENDING (TOSS·POINTS, 14일 안)
SELECT r.id, r.amount, r.created_at, r.updated_at, pm.type
  FROM refunds r JOIN charges c ON c.id = r.charge_id JOIN payment_methods pm ON pm.id = c.payment_method_id
 WHERE r.status = 'PENDING' AND r.execution = 'AUTO' AND pm.type IN ('TOSS', 'POINTS')
   AND r.updated_at < now() - interval '30 minutes' AND r.created_at > now() - interval '14 days';
```

② 가 0 이 아니면 그 행들은 **배포 후 첫 5분 안에 토스로 다시 나간다.** 이전 almond-payment 는 AUTO PENDING 을 성공으로 세었으므로 Medusa 는 이미 «환불됨»으로 적었다 — 다시 보내 확정하는 것이 맞다. 그래도 건수를 PR 본문에 적는다.

---

### Task 1: 무통장 «계좌 없음» 폴백은 `MANUAL` 송금 대기로 남긴다 (②)

**Files:**
- Modify: `apps/wallet/src/providers/payment-provider.interface.ts:67-78` (`RefundResult`)
- Modify: `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.ts:155-166`
- Modify: `apps/wallet/src/refunds/refunds.service.ts:238-240` (provider PENDING 분기)
- Test: `apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts`
- Test: `apps/wallet/src/refunds/refund-settlement.integration.spec.ts`

**Interfaces:**
- Produces: `RefundResult.manualTransfer?: boolean` — `status: 'PENDING'` 일 때만 의미, «PG 를 부르지 않았다, 운영자가 송금해야 끝난다». Task 2 의 `dispatch` 가 이 칸을 읽는다

- [ ] **Step 1: provider 단위 테스트를 먼저 고친다**

`bank-transfer.provider.spec.ts` 에서 계좌 없는 refund 를 검사하는 테스트를 찾는다(`grep -n "PENDING" apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts`). 없으면 아래 둘을 `describe` 안에 더하고, 있으면 기대값을 아래처럼 바꾼다. 픽스처 이름(`provider`, `tossApi`, `db` 목)은 그 파일의 기존 것을 쓴다.

```ts
  it('환불계좌가 없으면 PG 를 부르지 않고 «수동 송금» PENDING — manualTransfer 로 표시한다', async () => {
    const result = await provider.refund({
      refundId: 'rf-1',
      chargeId: 'ch-1',
      intentId: 'in-1',
      userId: 'u-1',
      amount: 1000,
      currency: 'KRW',
      idempotencyKey: 'wallet:refund:rf-1',
      correlationId: 'c-1',
    });
    expect(result).toEqual({ status: 'PENDING', manualTransfer: true });
    expect(tossApi.cancelPayment).not.toHaveBeenCalled();
  });

  it('paymentKey 스냅샷이 없는 옛 건도 같은 폴백 — manualTransfer', async () => {
    // getPaymentKey 가 undefined 를 돌려주게 db 목을 설정한다(그 파일의 «paymentKey 없음» 픽스처를 쓴다)
    const result = await providerWithoutPaymentKey.refund({
      refundId: 'rf-2',
      chargeId: 'ch-2',
      intentId: 'in-2',
      userId: 'u-2',
      amount: 1000,
      currency: 'KRW',
      idempotencyKey: 'wallet:refund:rf-2',
      correlationId: 'c-2',
      refundReceiveAccount: { bank: '06', accountNumber: '1234567890', holderName: '홍길동' },
    });
    expect(result).toEqual({ status: 'PENDING', manualTransfer: true });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts`
Expected: FAIL — `{ status: 'PENDING' }` 에 `manualTransfer` 가 없다

- [ ] **Step 3: `RefundResult` 에 칸을 더하고 provider 가 채운다**

`payment-provider.interface.ts` 의 `RefundResult` 에 `retryable` 아래로:

```ts
  /**
   * PENDING 일 때만 의미: PG 를 부르지 않았다 — 운영자가 고객 계좌로 송금하고 [완료 처리](confirmManual)를 눌러야 끝난다.
   * wallet 은 이 행을 execution MANUAL 로 적는다. 없으면 PG 가 비동기로 처리 중인 PENDING 이다(#1016 36번 마무리 ②).
   */
  manualTransfer?: boolean;
```

`bank-transfer.provider.ts` 의 두 폴백:

```ts
    if (!params.refundReceiveAccount) {
      return { status: 'PENDING', manualTransfer: true };
    }
    ...
    if (!paymentKey) {
      //  대상 charge 에 paymentKey 스냅샷이 없으면(구건 등) 자동환불 불가 → 수동 폴백.
      return { status: 'PENDING', manualTransfer: true };
    }
```

- [ ] **Step 4: provider 테스트 통과 확인**

Run: `npx jest apps/wallet/src/providers/bank-transfer/bank-transfer.provider.spec.ts`
Expected: PASS

- [ ] **Step 5: 통합 테스트 — 무통장 폴백 행은 MANUAL 이고 [완료 처리]가 받는다**

`refund-settlement.integration.spec.ts` 의 helper 를 넓힌다:
- `method(userId, type: 'TOSS' | 'POINTS' | 'CMS_BATCH' | 'BANK_TRANSFER')`
- `Seeded` 에 `bankChargeId?: string`, `seed(legs: { toss?: number; points?: number; cms?: number; bank?: number })` — `cms` 블록 아래에:

```ts
    if (legs.bank) {
      seeded.bankChargeId = await capturedCharge(
        intentId,
        await method(userId, 'BANK_TRANSFER'),
        legs.bank,
        new Date(t0 + 3_000),
      );
    }
```

`total` 계산에 `+ (legs.bank ?? 0)` 를 더한다. 그리고 테스트:

```ts
  it('무통장 «계좌 없음» 폴백은 MANUAL 송금 대기로 남는다 — 목록·[완료 처리]가 수동 행으로 다룬다', async () => {
    const s = await seed({ bank: 8_000 });
    externalRefund.mockResolvedValue({ status: 'PENDING', manualTransfer: true });

    const [row] = await service.createByIntent(s.intentId, { amount: 8_000 });

    expect(row).toMatchObject({ status: 'PENDING', execution: 'MANUAL', failureCode: null });
    expect((await service.listByIntent(s.intentId)).map((r) => r.execution)).toEqual(['MANUAL']);
    expect((await service.confirmManual(row.id)).status).toBe('SUCCEEDED');
  });

  it('manualTransfer 없는 PENDING(PG 비동기)은 AUTO 그대로', async () => {
    const s = await seed({ toss: 5_000 });
    externalRefund.mockResolvedValue({ status: 'PENDING' });

    const [row] = await service.createByIntent(s.intentId, { amount: 5_000 });

    expect(row).toMatchObject({ status: 'PENDING', execution: 'AUTO' });
  });
```

- [ ] **Step 6: 실패 확인**

Run: (실행 준비의 통합 스펙 명령)
Expected: FAIL — 첫 테스트의 `execution` 이 `'AUTO'`

- [ ] **Step 7: `create()` 의 PENDING 분기가 칸을 적는다**

`refunds.service.ts` 의 `} else if (providerResult.status === 'PENDING') {` 블록을 바꾼다:

```ts
    } else if (providerResult.status === 'PENDING') {
      // PG 를 안 부른 수동 폴백(무통장 계좌 없음 등)은 MANUAL 송금 대기다 — Medusa 장부 맞추기가 넣고, 환불 내역이 [완료 처리]를 띄운다.
      // AUTO 로 두면 «진행 중»으로 읽혀 정산이 멈추고(D8) 고객에겐 «환불 완료»로 보인다(#1016 36번 마무리 ②)
      await this.dbService.db
        .update(refunds)
        .set({ ...(providerResult.manualTransfer ? { execution: 'MANUAL' as const } : {}), updatedAt: new Date() })
        .where(eq(refunds.id, refund.id));
    } else {
```

`'MANUAL' as const` 는 리터럴 좁히기라 «타입 캐스팅 금지»에 걸리지 않는다. 걸리는 게 싫으면 `const manual: RefundExecution = 'MANUAL'` 로 두고 `{ execution: manual }`.

- [ ] **Step 8: 통과 확인**

Run: 통합 스펙 + `npx jest apps/wallet/src/refunds`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/wallet/src/providers/payment-provider.interface.ts apps/wallet/src/providers/bank-transfer/ apps/wallet/src/refunds/
git commit -m "fix(wallet): 무통장 계좌 없음 폴백 환불은 MANUAL 송금 대기로 남긴다 (#1016 36번 마무리 ②)"
```

---

### Task 2: 응답 끊긴 환불은 새 행이 아니라 같은 행·같은 키로 다시 보낸다 (①)

**Files:**
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (`create()` 분해 → `dispatch`, 되살리기)
- Modify: `apps/wallet/src/refunds/refund-refusal.ts` (코드 하나)
- Test: `apps/wallet/src/refunds/refund-refusal.spec.ts`
- Test: `apps/wallet/src/refunds/refund-settlement.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `RefundResult.manualTransfer`
- Produces:
  - `export const AMBIGUOUS_RESEND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000` (refunds.service.ts 맨 위) — Task 3 도 쓴다
  - `private async dispatch(refund: Refund, ctx: DispatchContext): Promise<Refund>` — 행 하나를 provider 에 보내고 결과를 적는다. 멱등 키 `wallet:refund:${refund.id}`, 금액 `refund.amount`, 사유 `refund.reasonCode`
  - `type DispatchContext = { charge: Charge; method: PaymentMethod; userId: string; refundReceiveAccount?: CreateRefundDto['refundReceiveAccount'] }`
  - 거절 코드 `AMBIGUOUS_REFUND_RESOLVED`(retryable true), `AMBIGUOUS_REFUND_NEEDS_ACCOUNT`(retryable false)

- [ ] **Step 1: 거절 표 테스트**

`refund-refusal.spec.ts` 에 더한다:

```ts
  it('응답 끊긴 이전 환불을 확인한 뒤의 거절 — 장부를 다시 맞추면 되므로 일시', () => {
    expect(refundRefusal('AMBIGUOUS_REFUND_RESOLVED', 'charge c-1 refund r-1 resolved SUCCEEDED')).toEqual({
      error: 'AMBIGUOUS_REFUND_RESOLVED',
      message: '이전 환불 요청의 결과를 확인했습니다. 환불 금액을 다시 계산해 주세요.',
      detail: 'charge c-1 refund r-1 resolved SUCCEEDED',
      retryable: true,
    });
  });

  it('무통장 응답 끊긴 환불을 다시 보낼 계좌가 없다 — 영구(운영자가 토스 상점관리자에서 확인)', () => {
    expect(refundRefusal('AMBIGUOUS_REFUND_NEEDS_ACCOUNT', 'x').retryable).toBe(false);
  });
```

- [ ] **Step 2: 표에 코드를 더한다**

`refund-refusal.ts` 의 `REFUSALS` 끝에:

```ts
  // 결제사 응답이 끊긴 이전 환불(PROVIDER_EXCEPTION)을 같은 키로 다시 보내 확인했다. 이번 요청은 그 결과를 모른 채 계산됐으니
  // 장부를 다시 맞춘 다음 시도에 맡긴다(#1016 36번 마무리 ①)
  AMBIGUOUS_REFUND_RESOLVED: {
    retryable: true,
    message: '이전 환불 요청의 결과를 확인했습니다. 환불 금액을 다시 계산해 주세요.',
  },
  // 무통장 환불을 다시 보내려면 고객 계좌가 필요한데 wallet 은 계좌를 저장하지 않는다 — 다시 보내도 같다
  AMBIGUOUS_REFUND_NEEDS_ACCOUNT: {
    retryable: false,
    message: '결제사 응답이 끊긴 이전 환불이 있습니다. 토스페이먼츠 상점관리자에서 환불 여부를 확인한 뒤 계좌 송금으로 처리해 주세요.',
  },
```

Run: `npx jest apps/wallet/src/refunds/refund-refusal.spec.ts` → PASS

- [ ] **Step 3: 통합 테스트 넷을 먼저 쓴다**

`refund-settlement.integration.spec.ts` 에 helper 와 테스트를 더한다:

```ts
  /** 결제사 응답이 끊긴 환불 한 번 — provider 가 던지면 wallet 은 FAILED·PROVIDER_EXCEPTION 행을 남긴다 */
  async function ambiguousRefund(intentId: string, amount: number) {
    externalRefund.mockRejectedValueOnce(new Error('socket hang up'));
    const [row] = await service.createByIntent(intentId, { amount, reasonCode: 'MEDUSA_REFUND' });
    expect(row).toMatchObject({ status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION', failureRetryable: true });
    return row;
  }

  it('응답 끊긴 환불 뒤 같은 금액 요청 — 새 행 없이 같은 행이 같은 멱등 키로 다시 나가고, 그 행 하나가 응답이다', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockResolvedValueOnce({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const result = await service.createByIntent(s.intentId, { amount: 3_000, reasonCode: 'MEDUSA_REFUND' });

    expect(result.map((r) => [r.id, r.status])).toEqual([[first.id, 'SUCCEEDED']]);
    expect(externalRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ refundId: first.id, idempotencyKey: `wallet:refund:${first.id}`, amount: 3_000 }),
    );
    expect(await rowsOf(s.intentId)).toHaveLength(1);
  });

  it('응답 끊긴 환불 뒤 다른 금액 요청 — 옛 행만 확정하고 이번 요청은 일시 거절(장부를 다시 맞추게)', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockResolvedValueOnce({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const refusal = await refusalOf(service.createByIntent(s.intentId, { amount: 5_000 }));

    expect(refusal).toMatchObject({ error: 'AMBIGUOUS_REFUND_RESOLVED', retryable: true });
    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect((await rowsOf(s.intentId)).map((r) => [r.id, r.status])).toEqual([[first.id, 'SUCCEEDED']]);
  });

  it('되살려 보냈는데 또 끊김 — 같은 행이 다시 FAILED·PROVIDER_EXCEPTION, 새 행 없음', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    externalRefund.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const [row] = await service.createByIntent(s.intentId, { amount: 3_000 });

    expect(row).toMatchObject({ id: first.id, status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION' });
    expect(await rowsOf(s.intentId)).toHaveLength(1);
  });

  it('14일 지난 응답 끊긴 행은 되살리지 않는다 — 토스 멱등 키가 만료됐다, 지금처럼 새 행', async () => {
    const s = await seed({ toss: 10_000 });
    const first = await ambiguousRefund(s.intentId, 3_000);
    await db
      .update(refunds)
      .set({ createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) })
      .where(eq(refunds.id, first.id));
    externalRefund.mockResolvedValueOnce({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const [row] = await service.createByIntent(s.intentId, { amount: 3_000 });

    expect(row.id).not.toBe(first.id);
    expect(await rowsOf(s.intentId)).toHaveLength(2);
  });
```

- [ ] **Step 4: 실패 확인**

Run: 통합 스펙
Expected: 첫 셋 FAIL(새 행이 생긴다), 넷째 PASS(지금 동작)

- [ ] **Step 5: `create()` 의 provider 호출부를 `dispatch` 로 떼어 낸다 (동작 변화 없음)**

`refunds.service.ts` 에서 `create()` 의 `const correlationId = ...` 부터 `return this.findByIdOrThrow(refund.id);` 까지(지금 141~263행)를 새 private 메서드로 옮기고, `create()` 는 그걸 부른다. 바뀌는 점은 셋 — 금액은 `refund.amount`, 사유는 `refund.reasonCode`, 계좌는 `ctx` — 이고 나머지는 글자 그대로다.

```ts
type DispatchContext = {
  charge: Charge;
  method: PaymentMethod;
  userId: string;
  refundReceiveAccount?: CreateRefundDto['refundReceiveAccount'];
};
```

(`PaymentMethod` 는 `../types` 에서 import 한다.)

```ts
  /**
   * 환불 행 하나를 provider 에 보내고 결과를 그 행에 적는다. 멱등 키는 행 id 에서 나온다(`wallet:refund:<id>`) — 같은 행을 다시 보내면
   * 토스는 첫 요청이 처리됐으면 그 응답을, 아니면 이제 처리한다(멱등키 15일). 포인트 원장도 같은 키로 멱등이다.
   * 그래서 «돈이 나갔는지 모르는» 행은 새 행이 아니라 이 함수로 같은 행을 다시 보낸다(#1016 36번 마무리 ①③).
   */
  private async dispatch(refund: Refund, ctx: DispatchContext): Promise<Refund> {
    const { charge, method, userId } = ctx;
    const correlationId = `refund:${refund.id}:${Date.now()}`;
    const provider = this.providerRegistry.getProviderOrThrow(method.type);
    const idempotencyKey = `wallet:refund:${refund.id}`;

    let providerResult: Awaited<ReturnType<typeof provider.refund>>;
    try {
      providerResult = await provider.refund({
        refundId: refund.id,
        chargeId: charge.id,
        authorizeChargeId: ledgerLegChargeId(charge),
        intentId: charge.intentId,
        userId,
        amount: refund.amount,
        currency: charge.currency,
        idempotencyKey,
        correlationId,
        reasonCode: refund.reasonCode ?? undefined,
        providerData: method.providerData,
        refundReceiveAccount: ctx.refundReceiveAccount,
      });
    } catch (error) {
      // …지금 catch 블록 그대로…
    }
    // …지금 SUCCEEDED / PENDING(Task 1) / FAILED 분기 그대로 — dto.amount 는 refund.amount, dto.reasonCode 는 refund.reasonCode ?? null 로 바꾼다…
    return this.findByIdOrThrow(refund.id);
  }
```

`create()` 의 끝은:

```ts
    if (execution === 'MANUAL') {
      this.logger.log(`Manual refund awaiting transfer: refundId=${refund.id} charge=${charge.id} amount=${dto.amount}`);
      return refund;
    }
    return this.dispatch(refund, { charge, method, userId, refundReceiveAccount: dto.refundReceiveAccount });
```

`reasonCode` 를 행에서 읽어도 같은 값이다 — 행을 만들 때 `dto.reasonCode ?? null` 을 적었다.

Run: `npx jest apps/wallet/src/refunds` + 통합 스펙
Expected: 기존 테스트 전부 PASS(분해만 했다), Step 3 의 셋은 여전히 FAIL

- [ ] **Step 6: Commit (분해만)**

```bash
git add apps/wallet/src/refunds/refunds.service.ts
git commit -m "refactor(wallet): 환불 행을 provider 에 보내는 부분을 dispatch 로 뗀다"
```

- [ ] **Step 7: 되살리기를 넣는다**

파일 맨 위(`supportsAutoRefund` 아래)에:

```ts
/**
 * 결제사 응답이 끊긴 환불(FAILED·PROVIDER_EXCEPTION)을 같은 키로 다시 보낼 수 있는 기간. 토스 멱등 키가 15일이라 하루 여유를 둔다.
 * 이보다 오래된 행은 지금처럼 무시한다 — 기존 결제·환불 건은 처리된 것으로 간주(2026-10-11 결정).
 */
export const AMBIGUOUS_RESEND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
```

`create()` 의 잠금 트랜잭션을 «되살릴 행이 있으면 그 행, 없으면 새 행»을 돌려주게 바꾼다. 트랜잭션 반환 타입을 `{ refund: Refund; resumed: boolean }` 으로:

```ts
    // 2. Lock charge row → (응답 끊긴 이전 환불이 있으면 그 행을 되살린다) → 아니면 re-check available + insert
    const { refund, resumed } = await this.dbService.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${chargesTable} WHERE id = ${charge.id} FOR UPDATE`);

      // 돈이 나갔는지 모르는 행이 있으면 새 환불을 만들지 않는다 — 새 행은 새 멱등 키라 토스가 같은 돈을 또 보낸다.
      // 그 행을 PENDING 으로 되살려(남은 금액에서 빠진다) 같은 키로 다시 보낸다. MANUAL 요청은 PG 를 안 부르니 해당 없다
      if (execution === 'AUTO') {
        const ambiguous = await this.oldestAmbiguousInTx(charge.id, tx);
        if (ambiguous) {
          if (method.type === 'BANK_TRANSFER' && !dto.refundReceiveAccount) {
            throw new BadRequestException(
              refundRefusal('AMBIGUOUS_REFUND_NEEDS_ACCOUNT', `refund ${ambiguous.id} on charge ${charge.id} needs refundReceiveAccount to resend`),
            );
          }
          await this.stateTransitionService.transitionRefund(
            ambiguous.id,
            'PENDING',
            { correlationId: `ambiguous-resend:${ambiguous.id}`, reasonCode: 'AMBIGUOUS_RESEND' },
            'FAILED',
            tx,
          );
          return { refund: { ...ambiguous, status: 'PENDING' as const }, resumed: true };
        }
      }

      const alreadyRefunded = await this.getRefundedTotalInTx(charge.id, tx);
      // …지금 코드 그대로 (available 검사 + insert)…
      return { refund: row, resumed: false };
    });

    if (resumed) {
      const resolved = await this.dispatch(refund, { charge, method, userId, refundReceiveAccount: dto.refundReceiveAccount });
      // 같은 금액 = 같은 정산의 재시도(리컨실러 재발행이 거의 전부). 그 행의 결과가 이번 요청의 결과다
      if (resolved.amount === dto.amount) return resolved;
      // 금액이 다르면 이번 요청은 옛 행의 결과를 모른 채 계산됐다 — 합쳐 보내면 이중 환불. 장부를 다시 맞춘 다음 시도에 맡긴다
      throw new BadRequestException(
        refundRefusal(
          'AMBIGUOUS_REFUND_RESOLVED',
          `charge ${charge.id}: resent ambiguous refund ${resolved.id} (${resolved.amount}) → ${resolved.status}; requested ${dto.amount} not sent`,
        ),
      );
    }
```

`'PENDING' as const` 도 리터럴 좁히기다(Task 1 Step 7 과 같은 이유로 허용, 싫으면 `const pending: RefundStatus = 'PENDING'`).

`dispatch` 의 SUCCEEDED·PENDING·FAILED 분기는 `transitionRefund(…, 'PENDING', tx)` 처럼 **`fromStatus: 'PENDING'`** 을 기대하므로 되살린 행(PENDING)에 그대로 맞는다. catch 블록의 `transitionRefund(refund.id, 'FAILED', …)` 도 PENDING → FAILED 다.

`dispatch` 의 catch 블록은 `failureCode`·`failureRetryable` 을 다시 `PROVIDER_EXCEPTION`·`true` 로 적는다. 되살린 행이 SUCCEEDED 나 진짜 FAILED 코드로 끝나면 **`failureCode` 가 바뀌어** 다음 `oldestAmbiguousInTx` 에서 빠진다 — SUCCEEDED 분기에서 `failureCode: null, failureRetryable: null` 을 함께 지운다:

```ts
          .set({
            providerRefundId: providerResult.providerRefundId ?? null,
            // 되살린 «응답 끊긴» 행이 성공으로 끝났다 — 실패 표시를 지운다(되살리기 대상에서도 빠진다)
            failureCode: null,
            failureRetryable: null,
            updatedAt: new Date(),
          })
```

조회 helper(파일 아래쪽 private 들 사이):

```ts
  /** 이 결제분의 «응답 끊긴» 환불 중 가장 오래된 것 — 14일 안, AUTO 만(MANUAL 은 PG 를 부르지 않는다) */
  private async oldestAmbiguousInTx(chargeId: string, tx: DbTx): Promise<Refund | null> {
    const rows = await tx
      .select()
      .from(refunds)
      .where(
        and(
          eq(refunds.chargeId, chargeId),
          eq(refunds.status, 'FAILED'),
          eq(refunds.failureCode, 'PROVIDER_EXCEPTION'),
          eq(refunds.execution, 'AUTO'),
          gt(refunds.createdAt, new Date(Date.now() - AMBIGUOUS_RESEND_WINDOW_MS)),
        ),
      )
      .orderBy(asc(refunds.createdAt), asc(refunds.id))
      .limit(1);
    return rows[0] ?? null;
  }
```

`drizzle-orm` import 에 `gt` 를 더한다.

- [ ] **Step 8: 통과 확인**

Run: 통합 스펙 + `npx jest apps/wallet/src/refunds`
Expected: PASS(넷 모두). `refunds.service.spec.ts` 의 목 기반 테스트가 트랜잭션 반환 모양 때문에 깨지면, 그 파일의 `makeTx().select` 목이 `orderBy().limit()` 체인에 `[]` 를 돌려주도록 넓힌다:

```ts
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () =>
            Object.assign([{ amount: selectAmount }], {
              orderBy: () => ({ limit: () => Promise.resolve([]) }),
            }),
        }),
      })),
```

- [ ] **Step 9: Commit**

```bash
git add apps/wallet/src/refunds/
git commit -m "fix(wallet): 결제사 응답이 끊긴 환불은 새 행이 아니라 같은 행·같은 멱등 키로 다시 보낸다 (#1016 36번 마무리 ①)"
```

---

### Task 3: 멈춘 AUTO PENDING 을 같은 키로 마저 보내는 크론 (③)

**Files:**
- Modify: `apps/wallet/src/refunds/refunds.service.ts` (`resendStuckAutoPending`)
- Create: `apps/wallet/src/refunds/refund-resend.job.ts`
- Modify: `apps/wallet/src/wallet.module.ts` (providers 에 job)
- Test: `apps/wallet/src/refunds/refund-settlement.integration.spec.ts`
- Test: `apps/wallet/src/refunds/refund-resend.job.spec.ts`

**Interfaces:**
- Consumes: Task 2 의 `dispatch`, `AMBIGUOUS_RESEND_WINDOW_MS`
- Produces:
  - `export const STUCK_PENDING_AFTER_MS = 30 * 60 * 1000`
  - `RefundsService.resendStuckAutoPending(now: Date, limit = 50): Promise<{ scanned: number; resent: number }>`

- [ ] **Step 1: 통합 테스트**

```ts
  /** 멈춘 AUTO PENDING — provider 호출 도중 프로세스가 죽은 꼴. 행만 직접 만든다 */
  async function stuckPending(chargeId: string, intentId: string, amount: number, updatedAgoMs: number, execution: 'AUTO' | 'MANUAL' = 'AUTO') {
    const id = randomUUID();
    const at = new Date(Date.now() - updatedAgoMs);
    await db.insert(refunds).values({
      id, chargeId, intentId, amount, currency: 'KRW', status: 'PENDING', execution, reasonCode: 'MEDUSA_REFUND',
      createdAt: at, updatedAt: at,
    });
    return id;
  }

  it('크론: 30분 넘게 멈춘 TOSS AUTO PENDING 만 같은 키로 다시 보낸다 — 젊은 행·MANUAL·무통장은 그대로', async () => {
    const s = await seed({ toss: 10_000, bank: 5_000 });
    const old = await stuckPending(s.tossChargeId!, s.intentId, 2_000, 31 * 60_000);
    const young = await stuckPending(s.tossChargeId!, s.intentId, 1_000, 5 * 60_000);
    const manual = await stuckPending(s.tossChargeId!, s.intentId, 1_000, 31 * 60_000, 'MANUAL');
    const bank = await stuckPending(s.bankChargeId!, s.intentId, 1_000, 31 * 60_000);
    externalRefund.mockResolvedValue({ status: 'SUCCEEDED', providerRefundId: 'pk' });

    const summary = await service.resendStuckAutoPending(new Date());

    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect(externalRefund).toHaveBeenCalledWith(expect.objectContaining({ refundId: old, idempotencyKey: `wallet:refund:${old}`, amount: 2_000 }));
    const byId = new Map((await rowsOf(s.intentId)).map((r) => [r.id, r.status]));
    expect([byId.get(old), byId.get(young), byId.get(manual), byId.get(bank)]).toEqual(['SUCCEEDED', 'PENDING', 'PENDING', 'PENDING']);
    expect(summary.resent).toBeGreaterThanOrEqual(1);
  });

  it('크론: 다시 보내다 또 끊기면 FAILED·PROVIDER_EXCEPTION — 다음 환불 요청이 Task 2 경로로 같은 행을 되살린다', async () => {
    const s = await seed({ toss: 10_000 });
    const old = await stuckPending(s.tossChargeId!, s.intentId, 2_000, 31 * 60_000);
    externalRefund.mockRejectedValueOnce(new Error('ECONNRESET'));

    await service.resendStuckAutoPending(new Date());

    expect(await rowsOf(s.intentId)).toEqual([expect.objectContaining({ id: old, status: 'FAILED', failureCode: 'PROVIDER_EXCEPTION' })]);
  });

  it('크론: 두 번 돌아도 한 번만 보낸다 — 집은 행은 다음 바퀴 후보에서 빠진다', async () => {
    const s = await seed({ toss: 10_000 });
    const old = await stuckPending(s.tossChargeId!, s.intentId, 2_000, 31 * 60_000);
    externalRefund.mockResolvedValue({ status: 'SUCCEEDED', providerRefundId: 'pk' });
    await service.resendStuckAutoPending(new Date());
    await service.resendStuckAutoPending(new Date());

    expect(externalRefund).toHaveBeenCalledTimes(1);
    expect((await rowsOf(s.intentId))[0]).toMatchObject({ id: old, status: 'SUCCEEDED' });
  });
```

Run: 통합 스펙 → FAIL(`resendStuckAutoPending is not a function`)

- [ ] **Step 2: 서비스에 구현**

`AMBIGUOUS_RESEND_WINDOW_MS` 아래에:

```ts
/**
 * AUTO PENDING 이 이만큼 갱신이 없으면 멈춘 것으로 본다 — provider 호출 도중 프로세스가 죽었다(배포 교체 등).
 * 토스 호출이 매달릴 수 있는 최장(undici 기본 headers·body 각 300초)의 세 배라, 진행 중인 호출을 집지 않는다.
 */
export const STUCK_PENDING_AFTER_MS = 30 * 60 * 1000;
/** 같은 키로 다시 보낼 때 추가 정보가 필요 없는 수단. 무통장은 고객 계좌가 필요한데 저장하지 않는다 */
const RESENDABLE_METHOD_TYPES = ['TOSS', 'POINTS'] as const;
```

메서드(`listByIntent` 위):

```ts
  /**
   * 멈춘 AUTO PENDING 을 같은 키로 마저 보낸다(#1016 36번 마무리 ③). Medusa 장부 맞추기는 장부에 없는 AUTO PENDING 을 «진행 중»으로 보고
   * 정산을 멈추므로(D8), 이 크론이 끝내 주지 않으면 그 주문의 정산은 리컨실러 «자동 멈춤»까지 간다.
   * 한 행은 한 주체만 — updated_at CAS 로 집는다(크론 태스크가 둘이어도, 늦게 끝난 create() 와 겹쳐도).
   */
  async resendStuckAutoPending(now: Date, limit = 50): Promise<{ scanned: number; resent: number }> {
    const candidates = await this.dbService.db
      .select({ refund: refunds, charge: chargesTable, method: paymentMethodsTable })
      .from(refunds)
      .innerJoin(chargesTable, eq(chargesTable.id, refunds.chargeId))
      .innerJoin(paymentMethodsTable, eq(paymentMethodsTable.id, chargesTable.paymentMethodId))
      .where(
        and(
          eq(refunds.status, 'PENDING'),
          eq(refunds.execution, 'AUTO'),
          lt(refunds.updatedAt, new Date(now.getTime() - STUCK_PENDING_AFTER_MS)),
          gt(refunds.createdAt, new Date(now.getTime() - AMBIGUOUS_RESEND_WINDOW_MS)),
          inArray(paymentMethodsTable.type, [...RESENDABLE_METHOD_TYPES]),
        ),
      )
      .orderBy(asc(refunds.updatedAt))
      .limit(limit);

    let resent = 0;
    for (const { refund, charge, method } of candidates) {
      const claimed = await this.dbService.db
        .update(refunds)
        .set({ updatedAt: now })
        .where(and(eq(refunds.id, refund.id), eq(refunds.status, 'PENDING'), eq(refunds.updatedAt, refund.updatedAt)))
        .returning({ id: refunds.id });
      if (claimed.length === 0) continue;
      const userId = await this.getIntentUserId(refund.intentId);
      if (!userId) {
        this.logger.error(`[resendStuckAutoPending] intent 없음 — refund=${refund.id}`);
        continue;
      }
      const result = await this.dispatch(refund, { charge, method, userId });
      this.logger.warn(`[resendStuckAutoPending] refund=${refund.id} amount=${refund.amount} → ${result.status}`);
      resent++;
    }
    return { scanned: candidates.length, resent };
  }
```

import 정리: `../schema` 에서 `paymentMethods as paymentMethodsTable` 추가, `drizzle-orm` 에서 `lt`·`gt` 추가. `refunds.updatedAt` 은 timestamptz 라 JS `Date` 비교가 밀리초까지 맞는다 — 행을 읽은 그대로 넘긴다. (raw `sql` 템플릿에 `Date` 를 넣지 말 것 — 메모리 `drizzle-raw-sql-date-trap`. 여기선 drizzle 연산자만 쓴다.)

- [ ] **Step 3: 통과 확인**

Run: 통합 스펙 → PASS

- [ ] **Step 4: 크론 클래스 + 단위 테스트**

`refund-resend.job.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { RefundsService } from './refunds.service';

/**
 * 멈춘 AUTO PENDING 환불을 같은 멱등 키로 마저 보낸다(#1016 36번 마무리 ③).
 * 클러스터 전체에서 주기당 한 번 — 행 단위 선점은 서비스의 updated_at CAS 가 한 번 더 막는다.
 */
@Injectable()
export class RefundResendJob {
  private readonly logger = new Logger(RefundResendJob.name);

  constructor(private readonly refunds: RefundsService) {}

  @CronOnce('0 */5 * * * *', { name: 'refund-stuck-resend' })
  async run(): Promise<void> {
    try {
      const { scanned, resent } = await this.refunds.resendStuckAutoPending(new Date());
      if (scanned > 0) this.logger.log(`refund-stuck-resend: scanned=${scanned} resent=${resent}`);
    } catch (error) {
      this.logger.error(`refund-stuck-resend failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
```

`refund-resend.job.spec.ts`:

```ts
import { RefundResendJob } from './refund-resend.job';

describe('RefundResendJob', () => {
  it('서비스에 지금 시각을 넘긴다', async () => {
    const service = { resendStuckAutoPending: jest.fn().mockResolvedValue({ scanned: 0, resent: 0 }) };
    await new RefundResendJob(service as never).run();
    expect(service.resendStuckAutoPending).toHaveBeenCalledWith(expect.any(Date));
  });

  it('서비스가 던져도 크론은 삼킨다 — 다음 주기가 다시 본다', async () => {
    const service = { resendStuckAutoPending: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(new RefundResendJob(service as never).run()).resolves.toBeUndefined();
  });
});
```

`wallet.module.ts`: `import { RefundResendJob } from './refunds/refund-resend.job';` 를 더하고 providers 의 `PointsExpirationJob,` 아래에 `RefundResendJob,`.

- [ ] **Step 5: 크론 가드·게이트**

Run: `npx jest libs/cron-once apps/wallet/src/refunds` → PASS (`cron-once-guard.spec.ts` 가 이름 중복·모듈 누락을 본다)
Run: `npm run type-check` → 0

- [ ] **Step 6: Commit**

```bash
git add apps/wallet/src/refunds/ apps/wallet/src/wallet.module.ts
git commit -m "fix(wallet): 멈춘 자동 환불(AUTO PENDING)을 같은 멱등 키로 마저 보내는 크론 (#1016 36번 마무리 ③)"
```

---

### Task 4: 문서 — wallet CLAUDE.md 와 PR

**Files:**
- Modify: `apps/wallet/CLAUDE.md` («환불 실패 분류와 수동 실행» 절)

- [ ] **Step 1: CLAUDE.md 에 세 줄**

«환불 실패 분류와 수동 실행 (#1016 36번)» 절 끝에:

```markdown
- **돈이 나갔는지 모르는 환불은 새 행을 만들지 않는다.** 멱등 키가 행 id(`wallet:refund:<id>`)라 새 행 = 새 키 = 토스가 같은 돈을 또 보낸다.
  응답 끊긴 FAILED(`PROVIDER_EXCEPTION`, 14일 안)는 다음 환불 요청이 같은 행을 되살려 보내고, 멈춘 AUTO PENDING(30분)은 `refund-stuck-resend` 크론이 보낸다(TOSS·POINTS 만)
- provider 가 PG 를 안 부른 PENDING 은 `RefundResult.manualTransfer` 를 붙이고 wallet 이 그 행을 `MANUAL` 로 적는다(무통장 계좌 없음 폴백)
```

- [ ] **Step 2: 게이트 전체**

```bash
npm run type-check
npx jest
DATABASE_URL=… REQUIRE_WALLET_DB=1 npx jest apps/wallet/src/refunds/refund-settlement.integration.spec.ts --runInBand
```

Expected: 0 · 0 실패 · 통합 PASS

- [ ] **Step 3: Commit · push · PR**

```bash
git add apps/wallet/CLAUDE.md
git commit -m "docs(wallet): 돈이 나갔는지 모르는 환불은 같은 행으로 — 규칙 기록"
git push -u origin fix/1016-36-wallet-ambiguous
```

PR 본문에 적을 것: 바꾼 셋(①②③), «응답 모양 그대로», 라이브 실측 ①② 건수, 배포 = wallet 단독·마이그 없음, 배포 뒤 확인(`refund-stuck-resend` 로그, 대상 행 상태), 짝 PR(core 계획). 머지되면 #1016 36번 해결 칸에 해시.
