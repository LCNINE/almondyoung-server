# 외부 환불 뒤 부분취소 안전망 (#1016 37번) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medusa 부분취소가 «품목에 연결되지 않은 외부 wallet 환불»이 있는 주문에서 운영자 확인 없이 환불하지 않게 하고, 운영자가 «이미 환불한 금액»을 주면 음수 크레딧 라인으로 상계해 나머지만 환불한다.

**Architecture:** Medusa 부분취소 오케스트레이터(`partial-cancel-order.ts`)가 주문 수정 전에 장부의 `wallet:` 환불 합 − 앞선 상계 합(U)을 보고 거절하거나, 수정 뒤 공식 `createOrderCreditLinesWorkflow` 로 −applied 를 넣고 환불을 줄인다. 값은 admin-web → core DTO → `CancelChannelOrder` 명령 → channel-adapter → Medusa 라우트로 흐르고, 거절은 `ChannelOrderCancelRejected(EXTERNAL_REFUND_UNRESOLVED, unresolvedRefundAmount)` 로 돌아온다.

**Tech Stack:** Medusa 2.13.4 워크플로, NestJS(core·channel-adapter), zod 이벤트 계약(`@packages/event-contracts`), Next.js admin-web, Jest.

**Spec:** `docs/superpowers/specs/2026-10-10-external-refund-partial-cancel-design.md` (상위 결정 `docs/adr/0043-refund-is-classified-by-what-it-reverses.md`)

## Global Constraints

- PR 은 넷이고 **머지·배포 순서가 core(+계약) → channel-adapter → Medusa → admin-web** 이다. 꼭 지킬 것은 «core 가 channel-adapter 보다 먼저» 하나(새 enum 을 옛 core 의 zod 가 throw). 한 SST 스택이라 PR 하나를 머지·배포한 뒤 다음 PR 을 머지한다.
- 마이그레이션 없음 — 전부 jsonb·계약 선택 칸.
- Medusa 거절은 **기존** `400 { type: 'not_allowed', code: 'partial_cancel_rejected' }` 에 `reason`·`unresolvedAmount` 를 **더한다**. 새 code 를 만들지 않는다.
- 외부 환불이 없는 주문의 부분취소는 지금과 한 글자도 다르지 않다 — 요청 해시는 `alreadyRefunded` 가 없으면 지금과 같은 값, 진행 기록·`OrderModified` 의 `externalRefundApplied` 는 0 이면 키를 생략한다(수집 해시가 바이트 단위로 그대로).
- 상계는 품목 차액까지만: `applied = min(a, max(0, owed))`. 배송비 환불 몫은 상계하지 않는다.
- 금액은 원 단위 0 이상 정수.
- 검증 게이트(각 PR): 루트 `npm run type-check` 0 · `npx jest --maxWorkers=2` 0. Medusa PR 은 추가로 `cd apps/medusa && TEST_TYPE=unit npx jest src/workflows/orders/partial-cancel` 와 `scripts/local/run-medusa-integration.sh --testPathPattern partial-cancel.spec`. core PR 은 `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request`. admin-web PR 은 `(cd apps/admin-web && npx tsc --noEmit)` 0 · `npm run test:admin-web` 0.
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`. PR 본문 끝에 `https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`. PR 본문에 배포 순서를 적는다.
- 워크트리는 `.claude/worktrees/` 아래, 브랜치 이름에 `+` 를 쓰지 않는다(jest 무시 패턴이 죽는다). core 통합은 워크트리에서 `COMPOSE_PROJECT_NAME=almondyoung-server` 필수.

## Review Focus

1. **확정과 기록 사이에 끊긴 요청의 재시도** — 외부 환불 판정이 `ensureNoDanglingEdit` 보다 먼저 돌면 «진행 기록 없음» 대신 업무 거절(400)이 나가 core 가 요청을 닫고 주문은 줄어든 채 남는다. 판정은 반드시 그 뒤. → Task 7 의 «확정 뒤 기록 없음 + 외부 환불» 테스트.
2. **크레딧 라인은 넣었는데 환불이 실패한 뒤 재시도** — 음수 라인이 두 번 들어가면 차액이 양수(고객이 갚을 돈)로 뒤집힌다. → Task 7 의 «환불 실패 → 재시도» 테스트.
3. **a 가 품목 차액보다 큼** — 차액을 넘는 음수 라인은 Medusa 가 거절하고, 넘기면 장부가 뒤집힌다. 남는 몫은 U 에 남아야 한다. → Task 6 유닛 + Task 7 «a > owed» 통합.
4. **운영자가 0 원으로 답함** — 0 은 «이 품목 몫 없음»이다. 전액 환불하되 U 는 그대로 남아 다음 부분취소가 다시 묻는다. → Task 7 «a=0» 통합.
5. **배포 겹침에서 옛 레코드 이어 가기** — 옛 코드가 남긴 `edited` 기록(해시: 품목만)을 새 코드가 이어 갈 때 «같은 requestId 다른 요청»으로 거절하면 안 된다. → Task 6 의 `hashRequest` 유닛.

---

## PR 1 — 계약 + core (브랜치 `feat/1016-37-core`, 먼저 머지·배포)

### Task 1: 이벤트 계약 — 명령 칸, 거절 코드·금액, 진행 기록 상계액

**Files:**
- Modify: `packages/event-contracts/streams/channel-orders-command.stream.ts` (`CancelChannelOrderPayload`, `CancelChannelOrderSchema`)
- Modify: `packages/event-contracts/streams/orders.stream.ts` (`OrderModifiedCancelRequest`·스키마, `CHANNEL_ORDER_CANCEL_REJECTION_CODES`, `ChannelOrderCancelRejectedPayload`·스키마)
- Test: `packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts`, `packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`

**Interfaces:**
- Produces: `CancelChannelOrderPayload.alreadyRefundedAmount?: number`, 거절 코드 `'EXTERNAL_REFUND_UNRESOLVED'`, `ChannelOrderCancelRejectedPayload.unresolvedRefundAmount?: number`, `OrderModifiedCancelRequest.externalRefundApplied?: number`

- [ ] **Step 1: 실패하는 테스트**

`channel-orders-command-stream.spec.ts` 의 `describe('CancelChannelOrder (#1016 35번 행)'` 안 끝에 더한다:

```ts
    it('이미 환불한 금액(#1016 37번)은 부분취소에만 — 0 이상 정수', () => {
      expect(schema.parse({ ...partial, alreadyRefundedAmount: 0 })).toMatchObject({ alreadyRefundedAmount: 0 });
      expect(schema.parse({ ...partial, alreadyRefundedAmount: 10000 })).toMatchObject({ alreadyRefundedAmount: 10000 });
      expect(() => schema.parse({ ...full, alreadyRefundedAmount: 10000 })).toThrow();
      expect(() => schema.parse({ ...partial, alreadyRefundedAmount: -1 })).toThrow();
      expect(() => schema.parse({ ...partial, alreadyRefundedAmount: 1.5 })).toThrow();
    });
```

`channel-order-cancel-facts.spec.ts` 의 `describe('ChannelOrderCancelRejected'` 안에 더한다:

```ts
    it('EXTERNAL_REFUND_UNRESOLVED 는 미해결 외부 환불 금액을 싣는다(#1016 37번)', () => {
      const payload = { ...key, reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', unresolvedRefundAmount: 10000 };
      expect(schema.parse(payload)).toEqual(payload);
      expect(() => schema.parse({ ...payload, unresolvedRefundAmount: -1 })).toThrow();
    });
```

같은 파일 끝(최상위 `describe` 안)에 더한다:

```ts
  describe('OrderModified cancelRequests 의 상계액 (#1016 37번)', () => {
    const schema = ORDER_STREAM.events.OrderModified.schema!;
    it('externalRefundApplied 는 선택 칸이다', () => {
      const base = { requestId: 'req-1', stage: 'refunded', refundAmount: 20000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false };
      const payload = (cancelRequests: unknown[]) => ({
        orderId: 'o1', salesChannel: 'medusa', externalOrderId: 'order_1', modifiedAt: '2026-10-10T00:00:00.000Z',
        snapshot: {
          lines: [],
          shippingAddress: { recipientName: 'a', phone: '', postalCode: '', roadAddress: '', detailAddress: '' },
          cancelRequests,
        },
      });
      expect(schema.parse(payload([base])).snapshot.cancelRequests).toEqual([base]);
      expect(schema.parse(payload([{ ...base, externalRefundApplied: 10000 }])).snapshot.cancelRequests?.[0]).toMatchObject({ externalRefundApplied: 10000 });
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest packages/event-contracts/streams/__tests__/channel-orders-command-stream.spec.ts packages/event-contracts/streams/__tests__/channel-order-cancel-facts.spec.ts`
Expected: FAIL — 전체취소 + 금액이 통과하고, `EXTERNAL_REFUND_UNRESOLVED` 가 enum 에 없어 throw, `externalRefundApplied` 가 벗겨진다.

- [ ] **Step 3: 구현**

`channel-orders-command.stream.ts` — `CancelChannelOrderPayload` 의 `reasonCode?` 위에:

```ts
  /**
   * partial 일 때만. 이번 취소 품목에 이미 다른 경로(wallet 관리자 환불 등)로 돌려준 금액(원) — 채널이 그만큼 상계하고
   * 나머지만 환불한다(#1016 37번, ADR-0043). 없으면 채널이 «품목에 연결 안 된 외부 환불»을 보고 거절할 수 있다.
   */
  alreadyRefundedAmount?: number;
```

`CancelChannelOrderSchema` 의 객체에 `reasonCode` 위로:

```ts
    alreadyRefundedAmount: z.number().int().nonnegative().optional(),
```

`superRefine` 안 `scope === 'full' && lines` 검사 다음에:

```ts
    if (payload.scope === 'full' && payload.alreadyRefundedAmount !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['alreadyRefundedAmount'],
        message: '전체취소는 상계하지 않는다 — 캡처 − 환불을 돌려준다',
      });
    }
```

`orders.stream.ts`:

`OrderModifiedCancelRequest` 의 `shippingNotAdjusted` 아래:

```ts
  /** 이번 부분취소가 외부 환불에서 상계한 금액(#1016 37번). 0 이면 생략한다 — 수집 해시가 그대로이게 */
  externalRefundApplied?: number;
```

`OrderModifiedCancelRequestSchema` 에 `externalRefundApplied: z.number().nonnegative().optional(),`

`CHANNEL_ORDER_CANCEL_REJECTION_CODES` 위 주석 목록에 한 줄 더하고 값을 더한다:

```ts
 * - `EXTERNAL_REFUND_UNRESOLVED`: 품목에 연결 안 된 외부 환불이 있어 «이미 환불한 금액»이 필요하다(#1016 37번) — 금액을 넣어 다시 요청한다
 */
export const CHANNEL_ORDER_CANCEL_REJECTION_CODES = [
  'NOT_SUPPORTED',
  'ORDER_NOT_FOUND',
  'NOT_CANCELABLE',
  'REFUND_FAILED',
  'EXTERNAL_REFUND_UNRESOLVED',
] as const;
```

`ChannelOrderCancelRejectedPayload` 의 `message` 아래:

```ts
  /** EXTERNAL_REFUND_UNRESOLVED 일 때 — 품목에 연결 안 된 외부 환불(원) */
  unresolvedRefundAmount?: number;
```

`ChannelOrderCancelRejectedSchema` 에 `unresolvedRefundAmount: z.number().int().nonnegative().optional(),`

- [ ] **Step 4: 통과 확인**

Run: Step 2 와 같은 명령. Expected: PASS. 이어서 `npm run type-check` → 0.

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams
git commit -m "feat(contracts): 부분취소 «이미 환불한 금액»·외부 환불 미해결 거절·상계액 칸 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

### Task 2: core — 요청이 «이미 환불한 금액»을 받아 명령에 싣는다

**Files:**
- Modify: `apps/core/src/modules/sales-order/dto/cancel-sales-order.dto.ts` (`CancelSalesOrderDto`)
- Modify: `apps/core/src/modules/sales-order/controllers/sales-orders.controller.ts:60-87` (`cancel`)
- Modify: `apps/core/src/modules/sales-order/services/store-sales-orders.service.ts:130-155` (`adminCancelRequest`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts` (`CancelRequestInput`, `request`)
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `CancelChannelOrderPayload.alreadyRefundedAmount`
- Produces: `CancelRequestInput.alreadyRefundedAmount?: number`, HTTP `POST /sales-orders/:id/cancel` 본문 `alreadyRefundedAmount?: number`

- [ ] **Step 1: 실패하는 테스트**

`channel-cancel-request.integration.spec.ts` 의 `it('부분 — 명령 줄은 …')` 다음에 더한다:

```ts
  it('37번 — 이미 환불한 금액은 부분 명령에 실린다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await w.manager.request(
        {
          salesOrderId: seed.salesOrderId,
          lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
          requester: OPERATOR,
          sourceKey: 'k1',
          alreadyRefundedAmount: 10000,
        },
        tx,
      );
      const [command] = await commandsOf(tx, seed.externalOrderId);
      expect(command.payload.payload).toMatchObject({ scope: 'partial', alreadyRefundedAmount: 10000 });
    });
  });

  it('37번 — 금액이 없으면 명령에 키 자체가 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await w.manager.request(
        { salesOrderId: seed.salesOrderId, lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], requester: OPERATOR, sourceKey: 'k1' },
        tx,
      );
      const [command] = await commandsOf(tx, seed.externalOrderId);
      expect('alreadyRefundedAmount' in command.payload.payload).toBe(false);
    });
  });

  it('37번 — 전체로 가는 요청에 금액을 실으면 400, 행·명령 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancelRequest(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await expect(
        w.manager.request({ salesOrderId: seed.salesOrderId, requester: OPERATOR, sourceKey: 'k1', alreadyRefundedAmount: 0 }, tx),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(await requestsOf(tx, seed.salesOrderId)).toHaveLength(0);
      expect(await commandsOf(tx, seed.externalOrderId)).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.integration`
Expected: FAIL — `alreadyRefundedAmount` 가 `CancelRequestInput` 에 없어 타입은 ts-jest 가 안 보지만 명령에 안 실리고, 세 번째는 400 이 안 난다.

- [ ] **Step 3: 구현**

`channel-cancel-request.manager.ts` — `CancelRequestInput` 의 `reasonDetail?` 아래:

```ts
  /** 부분취소만. 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 채널이 상계한다(#1016 37번) */
  alreadyRefundedAmount?: number;
```

`request` 안, `scope` 를 정한 직후(`const channelItems = …` 위):

```ts
      // 상계는 Medusa 부분취소만 안다(ADR-0043) — 전체취소는 «캡처 − 환불»을 돌려주므로 상계할 게 없다.
      if (input.alreadyRefundedAmount !== undefined) {
        if (so.salesChannel !== 'medusa') {
          throw new BadRequestError('이미 환불한 금액은 Medusa 주문 부분취소에만 적을 수 있습니다.');
        }
        if (scope !== 'partial') throw new BadRequestError('이미 환불한 금액은 부분취소에만 적을 수 있습니다.');
      }
```

`command` 객체의 `...(input.reasonCode ? …)` 위에:

```ts
        ...(input.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: input.alreadyRefundedAmount } : {}),
```

`cancel-sales-order.dto.ts` — `CancelSalesOrderDto` 의 `postShipmentHandoff` 아래:

```ts
  @ApiProperty({
    description:
      '채널(Medusa) 주문 부분취소만 — 이번 취소 품목에 이미 다른 경로(wallet 관리자 환불 등)로 돌려준 금액. Medusa 가 그만큼 상계하고 나머지만 환불한다(#1016 37번).',
    required: false,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  alreadyRefundedAmount?: number;
```

`sales-orders.controller.ts` `cancel` — `adminCancelRequest` 인자에 `lines: dto.lines,` 다음 줄:

```ts
      alreadyRefundedAmount: dto.alreadyRefundedAmount,
```

`store-sales-orders.service.ts` `adminCancelRequest` — dto 타입에 `alreadyRefundedAmount?: number;` 를 더하고, `request({ … })` 인자에 `reasonDetail: dto.reasonDetail,` 다음:

```ts
        ...(dto.alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount: dto.alreadyRefundedAmount } : {}),
```

`if (route === 'command') { … }` 블록 바로 뒤(core 경로 시작 전):

```ts
    if (dto.alreadyRefundedAmount !== undefined) {
      throw new BadRequestException('이미 환불한 금액은 Medusa 주문 부분취소에만 적을 수 있습니다.');
    }
```

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령 → PASS. `npm run type-check` → 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 채널 부분취소 요청이 «이미 환불한 금액»을 받아 명령에 싣는다 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

### Task 3: core — 거절 금액과 상계 결과를 요청 행에 남긴다

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.types.ts` (`CancelRequestMetadataSchema.rejection`·`outcome`, `CancelRequestView`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.manager.ts` (`reject`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.service.ts` (`reject`)
- Modify: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settler.ts:77-82` (outcome)
- Test: `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-request.facts.integration.spec.ts`, `apps/core/src/modules/sales-order/channel-cancel-request/channel-cancel-settle.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `unresolvedRefundAmount`, `externalRefundApplied`
- Produces: 요청 뷰 `rejection.unresolvedRefundAmount?: number`, `outcome.externalRefundApplied?: number` — admin-web(Task 9)이 읽는다

- [ ] **Step 1: 실패하는 테스트**

`channel-cancel-request.facts.integration.spec.ts` 에:

```ts
  it('37번 거절 — 미해결 외부 환불 금액을 함께 적는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, id } = await open(tx);
      await w.manager.reject(
        { requestId: id, reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', unresolvedRefundAmount: 10000 },
        tx,
      );
      expect((await rowOf(tx, id)).metadata).toMatchObject({
        rejection: { reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', unresolvedRefundAmount: 10000 },
      });
    });
  });
```

`channel-cancel-settle.integration.spec.ts` 의 첫 테스트 다음에:

```ts
  it('37번 — refunded 기록의 상계액을 결과에 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, seed, requestId } = await partialRequest(tx);
      const [record] = progress(requestId, 'refunded');
      await w.changes.handle(
        seed.salesOrderId,
        modifiedPayload(seed, { quantities: [1, 1], cancelRequests: [{ ...record, externalRefundApplied: 10000 }] }),
        'm-1',
        tx,
      );
      expect((await requestOf(tx, requestId)).metadata).toMatchObject({ outcome: { refundAmount: 1000, externalRefundApplied: 10000 } });
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- apps/core/src/modules/sales-order/channel-cancel-request`
Expected: 두 새 테스트 FAIL (금액 키가 안 남는다).

- [ ] **Step 3: 구현**

`channel-cancel-request.types.ts`:

```ts
  rejection: z
    .object({ reasonCode: z.string(), message: z.string(), at: z.string(), unresolvedRefundAmount: z.number().optional() })
    .optional(),
  outcome: z
    .object({
      refundAmount: z.number(),
      shippingCharge: z.number(),
      shippingRefund: z.number(),
      shippingNotAdjusted: z.boolean(),
      externalRefundApplied: z.number().optional(),
    })
    .optional(),
```

`CancelRequestView` 를 같은 모양으로:

```ts
  rejection: { reasonCode: string; message: string; at: string; unresolvedRefundAmount?: number } | null;
  outcome: {
    refundAmount: number;
    shippingCharge: number;
    shippingRefund: number;
    shippingNotAdjusted: boolean;
    externalRefundApplied?: number;
  } | null;
```

`channel-cancel-request.manager.ts` `reject`:

```ts
  async reject(
    fact: { requestId: string; reasonCode: string; message: string; unresolvedRefundAmount?: number },
    tx?: DbTx,
  ): Promise<void> {
    await this.db.run(async (trx) => {
      const row = await this.reader.findById(fact.requestId, trx, { lock: true });
      if (!row || row.status !== 'requested') {
        this.logger.log(`[CancelRequest] rejection ignored: ${fact.requestId} is ${row?.status ?? 'unknown'}`);
        return;
      }
      const meta = readCancelRequestMetadata(row.metadata);
      const rejection = {
        reasonCode: fact.reasonCode,
        message: fact.message,
        at: new Date().toISOString(),
        ...(fact.unresolvedRefundAmount !== undefined ? { unresolvedRefundAmount: fact.unresolvedRefundAmount } : {}),
      };
      await this.write(row.id, 'rejected', { ...meta, rejection }, trx);
    }, tx);
  }
```

`channel-cancel-request.service.ts` `reject` 의 인자 타입에 `unresolvedRefundAmount?: number` 를 더한다(본문은 그대로 위임). 소비자(`order-events.consumer.ts:311`)는 페이로드를 통째로 넘기므로 바꾸지 않는다.

`channel-cancel-settler.ts` outcome:

```ts
          outcome: {
            refundAmount: record.refundAmount,
            shippingCharge: record.shippingCharge,
            shippingRefund: record.shippingRefund,
            shippingNotAdjusted: record.shippingNotAdjusted,
            ...(record.externalRefundApplied ? { externalRefundApplied: record.externalRefundApplied } : {}),
          },
```

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령 → PASS. `npm run type-check` → 0. `npx jest apps/core/src/modules/sales-order --maxWorkers=2` → 0.

- [ ] **Step 5: 커밋 + PR 1**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 외부 환불 미해결 거절 금액·상계 결과를 취소 요청에 남긴다 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

PR 제목 `feat(core): #1016 37번 — 부분취소 «이미 환불한 금액» 계약·core (1/4)`. 본문에 «배포 순서: 이 PR(core) → channel-adapter → Medusa → admin-web. core 가 channel-adapter 보다 먼저여야 한다(새 거절 enum)» 를 적는다.

---

## PR 2 — channel-adapter (브랜치 `feat/1016-37-channel-adapter`, PR 1 배포 뒤 머지)

### Task 4: 명령의 금액을 Medusa 로 넘기고, 외부 환불 거절을 사실로 돌려준다

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/medusa.client.ts:249-252` (`MedusaPartialCancelOutcome`), `:2586-2609` (`partialCancelOrder`)
- Modify: `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.ts` (`Rejection`, `cancelPartial`)
- Modify: `apps/channel-adapter/src/services/order-collection/medusa-order.source.ts:214-235` (`readCancelRequests`)
- Test: `apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts`, `apps/channel-adapter/src/services/order-cancel/channel-order-cancel.manager.spec.ts`, `apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts`

**Interfaces:**
- Consumes: Task 1 계약. Medusa 응답(Task 7): 400 `{ code: 'partial_cancel_rejected', reason: 'external_refund_unresolved' | 'external_refund_exceeds' | 'external_refund_absent', unresolvedAmount: number, message }`, 200 `{ …, externalRefundApplied: number }`, 진행 기록 `externalRefundApplied?: number`
- Produces: `MedusaClient.partialCancelOrder(orderId, { requestId, items, alreadyRefunded?: number })`, outcome `{ kind: 'external_refund'; message: string; unresolvedAmount: number }`

- [ ] **Step 1: 실패하는 테스트**

`medusa.client.spec.ts` 의 `describe('partialCancelOrder'` 안에:

```ts
    it('이미 환불한 금액은 already_refunded 로 싣고, 없으면 키가 없다', async () => {
      global.fetch = respond(200, { requestId: 'req-1', refundAmount: 20000, shippingDelta: 0, shippingNotAdjusted: false, stage: 'refunded' });
      await makeClient().partialCancelOrder('order_1', { ...input, alreadyRefunded: 10000 });
      expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual({
        requestId: 'req-1',
        items: [{ item_id: 'ordli_1', quantity: 2 }],
        already_refunded: 10000,
      });
    });

    it('external_refund_* 사유의 거절은 금액과 함께 따로 돌려준다', async () => {
      global.fetch = respond(400, {
        type: 'not_allowed', code: 'partial_cancel_rejected', reason: 'external_refund_unresolved', unresolvedAmount: 10000, message: '외부 환불 10,000원',
      });
      await expect(makeClient().partialCancelOrder('order_1', input)).resolves.toEqual({
        kind: 'external_refund', message: '외부 환불 10,000원', unresolvedAmount: 10000,
      });
    });
```

`channel-order-cancel.manager.spec.ts` 의 `describe('부분취소'` 안에:

```ts
    it('명령의 이미 환불한 금액을 Medusa 로 넘긴다', async () => {
      const { manager, medusa } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'cancelled', refundAmount: 0, shippingDelta: 0, shippingNotAdjusted: false });
      await manager.execute({ ...partial, alreadyRefundedAmount: 10000 }, 'd1');
      expect(medusa.partialCancelOrder).toHaveBeenCalledWith('order_1', {
        requestId: 'req-1',
        items: [{ itemId: 'ordli_1', quantity: 2 }],
        alreadyRefunded: 10000,
      });
    });

    it('외부 환불 거절은 EXTERNAL_REFUND_UNRESOLVED + 금액', async () => {
      const { manager, repository, medusa, poller } = setup();
      medusa.partialCancelOrder.mockResolvedValue({ kind: 'external_refund', message: '외부 환불 10,000원', unresolvedAmount: 10000 });
      await manager.execute(partial, 'd1');
      expect(repository.recordRejected).toHaveBeenCalledWith(
        { ...key, reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', unresolvedRefundAmount: 10000 },
        'd1',
      );
      expect(poller.syncOrder).not.toHaveBeenCalled();
    });
```

`medusa-order-collection.spec.ts` 의 partialCancels 묶음 안에:

```ts
    it('상계액이 있으면 싣고, 0 이면 키가 없다(#1016 37번)', async () => {
      const provider = makeProvider({
        listOrders: jest.fn().mockResolvedValue([
          order({ partialCancels: { 'req-a': { ...record, externalRefundApplied: 10000 }, 'req-b': { ...record, externalRefundApplied: 0 } } }),
        ]),
      });
      const [item] = (await provider.fetchOrders(null)).orders;
      expect(item.changes.cancelRequests?.[0]).toMatchObject({ requestId: 'req-a', externalRefundApplied: 10000 });
      expect('externalRefundApplied' in (item.changes.cancelRequests?.[1] ?? {})).toBe(false);
    });
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/adapters/medusa/medusa.client.spec.ts apps/channel-adapter/src/services/order-cancel apps/channel-adapter/src/services/order-collection/medusa-order-collection.spec.ts`
Expected: 새 테스트 FAIL.

- [ ] **Step 3: 구현**

`medusa.client.ts` 타입:

```ts
export type MedusaPartialCancelOutcome =
  | { kind: 'cancelled'; refundAmount: number | null; shippingDelta: number | null; shippingNotAdjusted: boolean }
  | { kind: 'rejected'; message: string }
  /** 품목에 연결 안 된 외부 환불이 있어 «이미 환불한 금액»이 필요하다(#1016 37번) */
  | { kind: 'external_refund'; message: string; unresolvedAmount: number }
  | { kind: 'refund_pending'; message: string };
```

`partialCancelOrder` 시그니처·본문·거절 분기:

```ts
  async partialCancelOrder(
    orderId: string,
    input: { requestId: string; items: Array<{ itemId: string; quantity: number }>; alreadyRefunded?: number },
  ): Promise<MedusaPartialCancelOutcome> {
    const path = `/admin/orders/${encodeURIComponent(orderId)}/partial-cancel`;
    const { status, body } = await this.postAdmin(path, {
      requestId: input.requestId,
      items: input.items.map((item) => ({ item_id: item.itemId, quantity: item.quantity })),
      ...(input.alreadyRefunded !== undefined ? { already_refunded: input.alreadyRefunded } : {}),
    });
```

```ts
    if (status === 400 && body.code === 'partial_cancel_rejected') {
      // 같은 code 에 사유를 더한 거절이다 — 옛 클라이언트는 이걸 그냥 거절(NOT_CANCELABLE)로 닫고 문장만 보인다
      if (typeof body.reason === 'string' && body.reason.startsWith('external_refund_')) {
        return {
          kind: 'external_refund',
          message,
          unresolvedAmount: typeof body.unresolvedAmount === 'number' ? body.unresolvedAmount : 0,
        };
      }
      return { kind: 'rejected', message };
    }
```

(JSDoc 의 «정해진 거절은 code === 'partial_cancel_rejected' 뿐이다» 문장에 «— `reason` 이 `external_refund_*` 면 금액을 묻는 거절이다(#1016 37번)» 를 덧붙인다.)

`channel-order-cancel.manager.ts`:

```ts
type Rejection = { reasonCode: ChannelOrderCancelRejectionCode; message: string; unresolvedRefundAmount?: number };
```

`cancelPartial` 호출과 분기:

```ts
    const outcome = await this.medusaClient.partialCancelOrder(externalOrderId, {
      requestId,
      items: command.lines.map((line) => ({ itemId: line.channelOrderItemId, quantity: line.quantity })),
      ...(command.alreadyRefundedAmount !== undefined ? { alreadyRefunded: command.alreadyRefundedAmount } : {}),
    });
    switch (outcome.kind) {
      case 'cancelled':
        return undefined;
      case 'rejected':
        return { reasonCode: 'NOT_CANCELABLE', message: outcome.message };
      case 'external_refund':
        return { reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: outcome.message, unresolvedRefundAmount: outcome.unresolvedAmount };
```

(`refund_pending` 분기는 그대로.) `reject()` 는 `...rejection` 을 펼치므로 바꾸지 않는다.

`medusa-order.source.ts` `readCancelRequests` 의 반환 객체에 `shippingNotAdjusted` 다음:

```ts
            ...(typeof r.externalRefundApplied === 'number' && r.externalRefundApplied > 0
              ? { externalRefundApplied: r.externalRefundApplied }
              : {}),
```

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령 → PASS. `npm run type-check` → 0. `npx jest apps/channel-adapter --maxWorkers=2` → 0.

- [ ] **Step 5: 커밋 + PR 2**

```bash
git add apps/channel-adapter
git commit -m "feat(channel-adapter): 부분취소 «이미 환불한 금액» 전달·외부 환불 거절 사실 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

PR 제목 `feat(channel-adapter): #1016 37번 — 부분취소 상계 전달 (2/4)`. 본문: «PR 1(core) 이 라이브에 있어야 머지한다».

---

## PR 3 — Medusa (브랜치 `feat/1016-37-medusa`, PR 2 배포 뒤 머지)

### Task 5: 특성 테스트 — 주문 수정 직후 공식 크레딧 라인 워크플로가 음수 라인을 받는가 (**가장 먼저 실행**)

이 결과가 Task 7 의 구현을 고른다(스펙 §4.3). 다른 PR 보다 먼저 돌려도 된다 — 코드는 바꾸지 않는다.

**Files:**
- Modify: `apps/medusa/integration-tests/http/partial-cancel.spec.ts` (테스트 하나 추가, import 추가)

**Interfaces:**
- Consumes: 픽스처 `placeOrder` → `{ orderId, intentId }`, `loadOrder`, `FakeWallet`

외부 환불 투영 없이 본다 — 투영을 섞으면 Task 7 의 안전망이 들어간 뒤 이 테스트의 부분취소가 거절돼 깨진다. 묻는 것은 «주문 수정 확정 직후 공식 워크플로가 음수 차액을 보는가» 하나다.

- [ ] **Step 1: 테스트 작성**

파일 맨 위 import 를 고친다:

```ts
import { createOrderCreditLinesWorkflow, refundPaymentWorkflow } from '@medusajs/medusa/core-flows';
```

`testSuite` 안 마지막 `it` 다음에:

```ts
    it('특성(#1016 37번): 수정 직후 공식 워크플로가 음수 크레딧 라인을 받고 차액을 그만큼 줄인다', async () => {
      // A×3 90,000(cond 무료). 환불을 실패시켜 «수정 확정 · 환불 전»에 멈춘다 → 차액 −30,000
      const o = await loadOrder(getContainer(), orderId);
      wallet.failNextRefund = true;
      await expect(
        partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-char', items: [{ itemId: o.items[0].id, quantity: 1 }] }),
      ).rejects.toThrow(PartialCancelRefundPending);
      expect(balance(await loadOrder(getContainer(), orderId))).toBe(-30000);

      await createOrderCreditLinesWorkflow(getContainer()).run({
        input: { id: orderId, credit_lines: [{ amount: -10000, reference: 'partial-cancel', reference_id: 'req-37-char' }] },
      });
      const after = await loadOrder(getContainer(), orderId);
      expect(balance(after)).toBe(-20000);
      expect(after.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0)).toBe(-10000);
      expect(after.credit_lines.filter((l: any) => l.reference_id === 'req-37-char')).toHaveLength(1);
    });
```

- [ ] **Step 2: 실행**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern partial-cancel.spec -t '특성\\(#1016 37번\\)'`

판정:
- **PASS** → Task 7 은 **주 경로**(«4단계: 공식 워크플로»)로 구현한다.
- `Can only create credit lines if the order has a positive or negative pending difference` 등으로 FAIL → 워크플로가 수정 전 summary 를 읽었다. Task 7 은 **대안 경로**(«4단계 대안: 주문 수정 안의 CREDIT_LINE_ADD»)로 구현하고, 이 테스트는 `it.skip` 이 아니라 기대를 «워크플로는 수정 직후 차액을 못 본다»로 바꿔 특성으로 남긴다(`await expect(…run(…)).rejects.toBeDefined()`).

- [ ] **Step 3: 커밋**

```bash
git add apps/medusa/integration-tests/http/partial-cancel.spec.ts
git commit -m "test(medusa): 수정 직후 음수 크레딧 라인 특성 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

### Task 6: 외부 환불 판정 순수 함수

**Files:**
- Create: `apps/medusa/src/workflows/orders/partial-cancel/external-refund.ts`
- Test: `apps/medusa/src/workflows/orders/partial-cancel/__tests__/external-refund.unit.spec.ts`

**Interfaces:**
- Consumes: `toNumber` (`./amount`), `PartialCancelRejected` (`./plan-partial-cancel`), `CancelRequestItem` (`./plan-partial-cancel`)
- Produces:
  - `EXTERNAL_REFUND_NOTE_PREFIX = 'wallet:'`
  - `type ExternalRefundReason = 'external_refund_unresolved' | 'external_refund_exceeds' | 'external_refund_absent'`
  - `class PartialCancelExternalRefundRejected extends PartialCancelRejected { reason: ExternalRefundReason; unresolvedAmount: number }`
  - `unresolvedExternalRefund(refunds: Array<{ amount: unknown; note?: string | null }>, records: Array<{ externalRefundApplied?: number }>): number`
  - `checkAlreadyRefunded(unresolved: number, alreadyRefunded: number | undefined): void` (거절이면 throw)
  - `appliedExternalRefund(alreadyRefunded: number | undefined, owed: number): number`
  - `hashRequest(items: CancelRequestItem[], alreadyRefunded: number | undefined): string`

- [ ] **Step 1: 실패하는 테스트**

```ts
// apps/medusa/src/workflows/orders/partial-cancel/__tests__/external-refund.unit.spec.ts
import { createHash } from 'crypto';
import {
  appliedExternalRefund,
  checkAlreadyRefunded,
  hashRequest,
  PartialCancelExternalRefundRejected,
  unresolvedExternalRefund,
} from '../external-refund';
import { PartialCancelRejected } from '../plan-partial-cancel';

describe('unresolvedExternalRefund', () => {
  it('wallet: 메모 환불 합에서 앞선 상계를 뺀다 — 우리 부분취소 환불·메모 없는 환불은 세지 않는다', () => {
    const refunds = [
      { amount: 10000, note: 'wallet:wr-1' },
      { amount: { numeric_: 5000 }, note: 'wallet:wr-2' },
      { amount: 30000, note: 'partial-cancel:req-1' },
      { amount: 7000, note: null },
    ];
    expect(unresolvedExternalRefund(refunds, [])).toBe(15000);
    expect(unresolvedExternalRefund(refunds, [{ externalRefundApplied: 10000 }, {}])).toBe(5000);
  });

  it('상계가 외부 환불보다 많아도 음수가 되지 않는다', () => {
    expect(unresolvedExternalRefund([{ amount: 1000, note: 'wallet:x' }], [{ externalRefundApplied: 3000 }])).toBe(0);
  });
});

describe('checkAlreadyRefunded (스펙 §4.2)', () => {
  const reasonOf = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(PartialCancelExternalRefundRejected);
      expect(e).toBeInstanceOf(PartialCancelRejected);
      const r = e as PartialCancelExternalRefundRejected;
      return { reason: r.reason, unresolvedAmount: r.unresolvedAmount };
    }
  };

  it.each([
    [0, undefined, null],
    [0, 0, null],
    [0, 5000, { reason: 'external_refund_absent', unresolvedAmount: 0 }],
    [10000, undefined, { reason: 'external_refund_unresolved', unresolvedAmount: 10000 }],
    [10000, 0, null],
    [10000, 10000, null],
    [10000, 10001, { reason: 'external_refund_exceeds', unresolvedAmount: 10000 }],
  ])('U=%p, a=%p', (u, a, expected) => {
    expect(reasonOf(() => checkAlreadyRefunded(u, a))).toEqual(expected);
  });
});

describe('appliedExternalRefund', () => {
  it('품목 차액까지만 상계한다', () => {
    expect(appliedExternalRefund(undefined, 30000)).toBe(0);
    expect(appliedExternalRefund(10000, 30000)).toBe(10000);
    expect(appliedExternalRefund(40000, 30000)).toBe(30000);
    expect(appliedExternalRefund(10000, -500)).toBe(0);
  });
});

describe('hashRequest', () => {
  const items = [{ itemId: 'b', quantity: 1 }, { itemId: 'a', quantity: 2 }];
  it('금액이 없으면 옛 해시(정렬된 품목만)와 같다 — 배포 중 옛 기록을 이어 간다', () => {
    const old = createHash('sha256')
      .update(JSON.stringify([{ itemId: 'a', quantity: 2 }, { itemId: 'b', quantity: 1 }]))
      .digest('hex');
    expect(hashRequest(items, undefined)).toBe(old);
  });
  it('금액이 다르면 다른 요청이다', () => {
    expect(hashRequest(items, 0)).not.toBe(hashRequest(items, undefined));
    expect(hashRequest(items, 0)).not.toBe(hashRequest(items, 1000));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/workflows/orders/partial-cancel/__tests__/external-refund.unit.spec.ts`
Expected: FAIL — `Cannot find module '../external-refund'`.

- [ ] **Step 3: 구현**

```ts
// apps/medusa/src/workflows/orders/partial-cancel/external-refund.ts
import { createHash } from 'crypto';
import { toNumber } from './amount';
import { PartialCancelRejected, type CancelRequestItem } from './plan-partial-cancel';

/** 환불 투영(payment-events)이 Medusa 밖 wallet 환불에 다는 메모 접두어 */
export const EXTERNAL_REFUND_NOTE_PREFIX = 'wallet:';

export type ExternalRefundReason = 'external_refund_unresolved' | 'external_refund_exceeds' | 'external_refund_absent';

/** «이미 환불한 금액»이 필요하거나 맞지 않는 거절(#1016 37번, 스펙 §4.2). 라우트가 사유·금액을 실어 400 으로 낸다. */
export class PartialCancelExternalRefundRejected extends PartialCancelRejected {
  constructor(
    readonly reason: ExternalRefundReason,
    readonly unresolvedAmount: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartialCancelExternalRefundRejected';
  }
}

const won = new Intl.NumberFormat('ko-KR');

/**
 * 품목에 연결 안 된 외부 환불(U). 외부 환불은 투영될 때 «금액 조정»(크레딧 라인)으로만 남아 어느 품목 몫인지 모른다 —
 * 앞선 부분취소가 «이미 환불함»으로 가져간 몫만 뺀다. 10-07 이전 외부 환불은 투영되지 않아 여기 없다(스펙 §4.1).
 */
export function unresolvedExternalRefund(
  refunds: Array<{ amount: unknown; note?: string | null }>,
  records: Array<{ externalRefundApplied?: number }>,
): number {
  const external = refunds
    .filter((r) => typeof r.note === 'string' && r.note.startsWith(EXTERNAL_REFUND_NOTE_PREFIX))
    .reduce((s, r) => s + toNumber(r.amount), 0);
  const claimed = records.reduce((s, r) => s + (r.externalRefundApplied ?? 0), 0);
  return Math.max(0, external - claimed);
}

/** 주문 수정 «전»에 부른다 — 거절이 주문을 건드리지 않게. 자동 차감은 하지 않는다(보상·차액 환불까지 먹는다, ADR-0043). */
export function checkAlreadyRefunded(unresolved: number, alreadyRefunded: number | undefined): void {
  if (unresolved <= 0) {
    if (alreadyRefunded !== undefined && alreadyRefunded > 0) {
      throw new PartialCancelExternalRefundRejected(
        'external_refund_absent',
        0,
        `이 주문에는 품목에 연결할 외부 환불이 없습니다 — 이미 환불한 금액(${won.format(alreadyRefunded)}원)을 비우고 다시 요청하세요`,
      );
    }
    return;
  }
  if (alreadyRefunded === undefined) {
    throw new PartialCancelExternalRefundRejected(
      'external_refund_unresolved',
      unresolved,
      `품목에 연결 안 된 외부 환불 ${won.format(unresolved)}원이 있습니다 — 이번 취소 품목에 이미 돌려준 금액을 적어 다시 요청하세요(없으면 0)`,
    );
  }
  if (alreadyRefunded > unresolved) {
    throw new PartialCancelExternalRefundRejected(
      'external_refund_exceeds',
      unresolved,
      `이미 환불한 금액 ${won.format(alreadyRefunded)}원이 품목에 연결 안 된 외부 환불 ${won.format(unresolved)}원보다 많습니다`,
    );
  }
}

/** 상계는 품목 차액까지만 — 넘기면 음수 크레딧 라인이 차액을 넘어 장부가 뒤집힌다. 남는 몫은 U 에 남아 다음 취소가 다시 묻는다. */
export function appliedExternalRefund(alreadyRefunded: number | undefined, owed: number): number {
  return Math.min(alreadyRefunded ?? 0, Math.max(0, owed));
}

const normalize = (items: CancelRequestItem[]) =>
  [...items].map((i) => ({ itemId: i.itemId, quantity: i.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId));

/** 금액이 없으면 옛 해시(품목만)와 같아야 한다 — 배포 중 옛 코드가 남긴 edited 기록을 «다른 요청»으로 거절하지 않게. */
export function hashRequest(items: CancelRequestItem[], alreadyRefunded: number | undefined): string {
  const body = alreadyRefunded === undefined ? normalize(items) : { items: normalize(items), alreadyRefunded };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
```

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령 → PASS.

- [ ] **Step 5: 커밋**

```bash
git add apps/medusa/src/workflows/orders/partial-cancel/external-refund.ts apps/medusa/src/workflows/orders/partial-cancel/__tests__/external-refund.unit.spec.ts
git commit -m "feat(medusa): 외부 환불 미해결 판정·상계 순수 함수 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

### Task 7: 부분취소 오케스트레이터·라우트에 안전망과 상계를 넣는다

**Files:**
- Modify: `apps/medusa/src/workflows/orders/partial-cancel/partial-cancel-order.ts`
- Modify: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/parse-input.ts`
- Modify: `apps/medusa/src/api/admin/orders/[id]/partial-cancel/route.ts`
- Test: `apps/medusa/integration-tests/http/partial-cancel.spec.ts`

**Interfaces:**
- Consumes: Task 6 전부, Task 5 판정
- Produces: `PartialCancelInput.alreadyRefunded?: number`, `PartialCancelRecord.externalRefundApplied?: number`, `PartialCancelResult.externalRefundApplied: number`, 라우트 본문 `already_refunded`, 400 `reason`·`unresolvedAmount`, 200 `externalRefundApplied`

- [ ] **Step 1: 실패하는 통합 테스트**

`partial-cancel.spec.ts` import 에 더한다:

```ts
import { PartialCancelExternalRefundRejected } from '../../src/workflows/orders/partial-cancel/external-refund';
import { handleRefundProjection } from '../../src/api/hooks/payment-events/route';
```

파일 위쪽 상수(`num`) 옆에:

```ts
const silent = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
```

`testSuite` 안 Task 5 테스트 다음에 도우미와 테스트들:

```ts
    const project = (orderId: string, intentId: string, amount: number, id: string) =>
      handleRefundProjection(getContainer(), intentId, amount, `msg-${id}`, orderId, silent, { refundId: id, reasonCode: 'ADMIN_REFUND' });
    const ourLines = (o: any, requestId: string) => o.credit_lines.filter((l: any) => l.reference === 'partial-cancel' && l.reference_id === requestId);
    const creditSum = (o: any) => o.credit_lines.reduce((s: number, l: any) => s + num(l.amount), 0);

    describe('외부 환불 뒤 부분취소 (#1016 37번)', () => {
      it('금액 없이 오면 주문을 건드리지 않고 거절한다 — 사유와 미해결 금액', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-a');
        const o = await loadOrder(getContainer(), orderId);

        const err = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-a', items: [{ itemId: o.items[0].id, quantity: 1 }] }).catch((e) => e);
        expect(err).toBeInstanceOf(PartialCancelExternalRefundRejected);
        expect(err).toMatchObject({ reason: 'external_refund_unresolved', unresolvedAmount: 10000 });
        expect((await loadOrder(getContainer(), orderId)).version).toBe(o.version);
        expect(wallet.callsTo('/refund')).toBe(0);
      });

      it('이미 환불한 금액만큼 음수 크레딧 라인으로 상계하고 나머지만 환불한다 — 장부 0', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-b');
        const o = await loadOrder(getContainer(), orderId);

        const res = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-b', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 10000,
        });
        expect(res).toMatchObject({ refundAmount: 20000, externalRefundApplied: 10000 });
        expect(wallet.refunds.map((r) => r.amount)).toEqual([20000]);
        const after = await loadOrder(getContainer(), orderId);
        expect(balance(after)).toBe(0);
        expect(creditSum(after)).toBe(0);
        expect(ourLines(after, 'req-37-b').map((l: any) => num(l.amount))).toEqual([-10000]);
        expect(after.metadata.partialCancels['req-37-b']).toMatchObject({ stage: 'refunded', externalRefundApplied: 10000 });
      });

      it('환불이 실패한 뒤 다시 부르면 음수 라인을 두 번 넣지 않는다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-c');
        const o = await loadOrder(getContainer(), orderId);
        const input = { orderId, requestId: 'req-37-c', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 10000 };
        wallet.failNextRefund = true;
        await expect(partialCancelOrder(getContainer(), input)).rejects.toThrow(PartialCancelRefundPending);
        expect(ourLines(await loadOrder(getContainer(), orderId), 'req-37-c')).toHaveLength(1);

        const res = await partialCancelOrder(getContainer(), input);
        expect(res.refundAmount).toBe(20000);
        const after = await loadOrder(getContainer(), orderId);
        expect(ourLines(after, 'req-37-c')).toHaveLength(1);
        expect(wallet.refunds.map((r) => r.amount)).toEqual([20000]);
        expect(balance(after)).toBe(0);
      });

      it('0 원이면 전액 환불하고 외부 환불은 미해결로 남아 다음 부분취소가 다시 묻는다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-d');
        const o = await loadOrder(getContainer(), orderId);

        const first = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-d1', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 0,
        });
        expect(first).toMatchObject({ refundAmount: 30000, externalRefundApplied: 0 });
        expect('externalRefundApplied' in (await loadOrder(getContainer(), orderId)).metadata.partialCancels['req-37-d1']).toBe(true);

        const err = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-d2', items: [{ itemId: o.items[0].id, quantity: 1 }] }).catch((e) => e);
        expect(err).toMatchObject({ reason: 'external_refund_unresolved', unresolvedAmount: 10000 });
      });

      it('품목 차액보다 큰 금액은 차액까지만 상계하고 남은 몫은 미해결로 둔다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 40000, 'wr-37-e');
        const o = await loadOrder(getContainer(), orderId);

        const res = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-e1', items: [{ itemId: o.items[0].id, quantity: 1 }], alreadyRefunded: 40000,
        });
        expect(res).toMatchObject({ refundAmount: 0, externalRefundApplied: 30000 });
        expect(wallet.callsTo('/refund')).toBe(0);
        const after = await loadOrder(getContainer(), orderId);
        expect(balance(after)).toBe(0);
        expect(creditSum(after)).toBe(10000);

        const err = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-e2', items: [{ itemId: o.items[0].id, quantity: 1 }] }).catch((e) => e);
        expect(err).toMatchObject({ reason: 'external_refund_unresolved', unresolvedAmount: 10000 });
      });

      it('미해결보다 큰 금액·외부 환불 없는데 금액은 거절한다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        const o = await loadOrder(getContainer(), orderId);
        const item = [{ itemId: o.items[0].id, quantity: 1 }];
        await expect(partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-f1', items: item, alreadyRefunded: 5000 }))
          .rejects.toMatchObject({ reason: 'external_refund_absent' });
        await project(orderId, intentId, 10000, 'wr-37-f');
        await expect(partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-f2', items: item, alreadyRefunded: 10001 }))
          .rejects.toMatchObject({ reason: 'external_refund_exceeds', unresolvedAmount: 10000 });
        expect((await loadOrder(getContainer(), orderId)).version).toBe(o.version);
      });

      it('배송비 환불이 섞여도 상계는 품목 몫만 — 양수 라인은 배송비 몫만 붙고 장부 0', async () => {
        // A×2 60,000(cond 무료) + C 10,000(flat 3,000). C 를 빼면 flat 그룹이 빈다: 10,000 + 3,000
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 2 }, { variant: 'C', quantity: 1 }] });
        await project(orderId, intentId, 5000, 'wr-37-g');
        const o = await loadOrder(getContainer(), orderId);

        const res = await partialCancelOrder(getContainer(), {
          orderId, requestId: 'req-37-g', items: [{ itemId: itemOf(o, 10000).id, quantity: 1 }], alreadyRefunded: 5000,
        });
        expect(res).toMatchObject({ refundAmount: 8000, shippingDelta: -3000, externalRefundApplied: 5000 });
        expect(wallet.refunds.map((r) => r.amount)).toEqual([8000]);
        const after = await loadOrder(getContainer(), orderId);
        expect(balance(after)).toBe(0);
        // +5,000(외부) −5,000(상계) +3,000(배송비 환불)
        expect(creditSum(after)).toBe(3000);
      });

      it('확정 뒤 기록 전에 끊긴 요청은 외부 환불이 있어도 업무 거절이 아니라 «진행 기록이 없습니다»로 멈춘다', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        const o = await loadOrder(getContainer(), orderId);
        const input = { orderId, requestId: 'req-37-h', items: [{ itemId: o.items[0].id, quantity: 1 }] };
        await partialCancelOrder(getContainer(), input);
        await project(orderId, intentId, 10000, 'wr-37-h');
        const orderModule = getContainer().resolve(Modules.ORDER);
        await orderModule.updateOrders([{ id: orderId, metadata: { partialCancels: { 'req-37-h': null } } }]);

        const err = await partialCancelOrder(getContainer(), input).catch((e) => e);
        expect(err).not.toBeInstanceOf(PartialCancelRejected);
        expect(err.message).toMatch(/진행 기록이 없습니다/);
      });

      it('외부 환불이 없는 주문은 지금과 같다 — 결과에 상계 0, 기록에 상계 키 없음', async () => {
        const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        const o = await loadOrder(getContainer(), orderId);
        const res = await partialCancelOrder(getContainer(), { orderId, requestId: 'req-37-i', items: [{ itemId: o.items[0].id, quantity: 1 }] });
        expect(res).toMatchObject({ refundAmount: 30000, externalRefundApplied: 0 });
        expect('externalRefundApplied' in (await loadOrder(getContainer(), orderId)).metadata.partialCancels['req-37-i']).toBe(false);
      });

      it('라우트: 400 에 사유·미해결 금액, already_refunded 로 200 + 상계액', async () => {
        const { orderId, intentId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
        await project(orderId, intentId, 10000, 'wr-37-r');
        const o = await loadOrder(getContainer(), orderId);
        const item = o.items[0].id;

        const rejected = await api
          .post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-37-1', items: [{ item_id: item, quantity: 1 }] }, c.adminHeaders)
          .catch((e: any) => e.response);
        expect(rejected.status).toBe(400);
        expect(rejected.data).toMatchObject({ type: 'not_allowed', code: 'partial_cancel_rejected', reason: 'external_refund_unresolved', unresolvedAmount: 10000 });

        const bad = await api
          .post(`/admin/orders/${orderId}/partial-cancel`, { requestId: 'r-37-2', items: [{ item_id: item, quantity: 1 }], already_refunded: -1 }, c.adminHeaders)
          .catch((e: any) => e.response);
        expect(bad.status).toBe(400);
        expect(bad.data.type).toBe('invalid_data');

        const ok = await api.post(
          `/admin/orders/${orderId}/partial-cancel`,
          { requestId: 'r-37-3', items: [{ item_id: item, quantity: 1 }], already_refunded: 10000 },
          c.adminHeaders,
        );
        expect(ok.status).toBe(200);
        expect(ok.data).toMatchObject({ refundAmount: 20000, externalRefundApplied: 10000 });
      });
    });
```

«외부 환불이 없는 주문» 테스트의 «기록에 상계 키 없음»을 지키려면 기록에 `externalRefundApplied` 를 0 일 때 넣지 않는다. 반대로 «0 원이면» 테스트는 운영자가 a=0 을 준 경우라 키가 있다(applied 0) — 아래 구현은 `alreadyRefunded !== undefined` 일 때만 키를 넣는다.

- [ ] **Step 2: 실패 확인**

Run: `scripts/local/run-medusa-integration.sh --testPathPattern partial-cancel.spec`
Expected: 새 묶음 FAIL(거절이 안 나고 Y 를 그대로 환불), 기존 테스트 PASS.

- [ ] **Step 3: 오케스트레이터 구현 (`partial-cancel-order.ts`)**

import 를 바꾼다 — `createHash` 와 기존 `hashItems` 는 지우고:

```ts
import {
  beginOrderEditOrderWorkflow,
  cancelBeginOrderEditWorkflow,
  confirmOrderEditRequestWorkflow,
  createOrderChangeActionsWorkflow,
  createOrderCreditLinesWorkflow,
  createOrderEditShippingMethodWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  refundPaymentWorkflow,
  requestOrderEditRequestWorkflow,
} from '@medusajs/medusa/core-flows';
```

```ts
import { appliedExternalRefund, checkAlreadyRefunded, hashRequest, unresolvedExternalRefund } from './external-refund';
```

타입:

```ts
export type PartialCancelInput = {
  orderId: string;
  requestId: string;
  items: CancelRequestItem[];
  /** 이번 취소 품목에 이미 다른 경로로 돌려준 금액(원) — 품목에 연결 안 된 외부 환불이 있을 때 필요하다(#1016 37번) */
  alreadyRefunded?: number;
  actorId?: string;
};
```

`PartialCancelRecord` 의 `refundedAt?` 위에:

```ts
  /** 외부 환불에서 상계한 금액(음수 크레딧 라인). 운영자가 금액을 줬을 때만 있다 — 다음 판정의 U 에서 빠진다 */
  externalRefundApplied?: number;
```

`PartialCancelResult` 에 `externalRefundApplied: number;`

상수 옆에:

```ts
/** 상계 음수 크레딧 라인의 reference — reference_id 는 requestId. 재시도가 이것으로 이미 넣었는지 본다 */
const OFFSET_CREDIT_LINE_REFERENCE = 'partial-cancel';
```

`run`:

```ts
async function run(container: MedusaContainer, input: PartialCancelInput): Promise<PartialCancelResult> {
  const requestHash = hashRequest(input.items, input.alreadyRefunded);
  const order = await loadOrder(container, input.orderId);
  const existing = readRecords(order.metadata)[input.requestId];
  if (existing && existing.requestHash !== requestHash) {
    throw new PartialCancelRejected(`같은 requestId 로 다른 요청이 왔습니다: ${input.requestId}`);
  }
  if (existing?.stage === 'refunded') return toResult(input.requestId, existing);

  const record = existing ?? (await edit(container, input, order, requestHash));

  try {
    // 상계 라인을 환불보다 «먼저» 넣는다 — 그래야 환불 뒤 차액이 0 이고, refundPaymentWorkflow 가 배송비 몫만 양수 라인으로 붙인다
    await offsetExternalRefund(container, input.orderId, input.requestId, record.externalRefundApplied ?? 0);
    await refund(container, input.orderId, input.requestId, record.refundAmount, input.actorId);
  } catch (error) {
    throw new PartialCancelRefundPending(input.requestId, `부분취소 환불이 끝나지 않았습니다(${input.requestId}): ${describeError(error)}`);
  }
  const done: PartialCancelRecord = { ...record, stage: 'refunded', refundedAt: new Date().toISOString() };
  await writeRecord(container, input.orderId, input.requestId, done);
  return toResult(input.requestId, done);
}
```

`edit` — `await ensureNoDanglingEdit(…)` 바로 다음 줄에:

```ts
  // 끊긴 확정 수정을 먼저 가린 «뒤»에 본다 — 앞에 두면 그 경우가 업무 거절(400)로 닫혀 주문만 줄어든 채 남는다(Review Focus 1)
  await assertExternalRefundsResolved(container, order, input.alreadyRefunded);
```

`edit` 끝의 기록 계산을 바꾼다:

```ts
  const applied = appliedExternalRefund(input.alreadyRefunded, owed);
  const record: PartialCancelRecord = {
    requestHash,
    stage: 'edited',
    items: normalizeItems(input.items),
    refundAmount: Math.max(0, owed) - applied + (shipping.adjustable ? shipping.refund : 0),
    shippingCharge: shipping.adjustable ? shipping.charge : 0,
    shippingRefund: shipping.adjustable ? shipping.refund : 0,
    shippingNotAdjusted: !shipping.adjustable,
    groupFees: shipping.adjustable ? Object.fromEntries(shipping.groups.map((g) => [g.shippingProfileId, g.recordedFee])) : {},
    at: new Date().toISOString(),
    orderVersion: edited.version,
    ...(input.alreadyRefunded !== undefined ? { externalRefundApplied: applied } : {}),
  };
```

(주석 두 줄 — `newFee 가 아니라 recordedFee` — 은 그대로 둔다.)

`refund()` 위에 두 함수를 더한다:

```ts
/**
 * 품목에 연결 안 된 외부 환불(U)이 있는데 운영자가 «이미 환불한 금액»을 주지 않았으면 거절한다(#1016 37번, 스펙 §4.2).
 * 장부만 읽는다 — 투영이 외부 환불을 `wallet:` 메모로 남긴다.
 */
async function assertExternalRefundsResolved(container: MedusaContainer, order: OrderView, alreadyRefunded: number | undefined) {
  const paymentIds = await orderPaymentIds(container, order.id);
  const payments = paymentIds.length
    ? await container.resolve(Modules.PAYMENT).listPayments({ id: paymentIds }, { relations: ['refunds'] })
    : [];
  const unresolved = unresolvedExternalRefund(
    payments.flatMap((p) => p.refunds ?? []),
    Object.values(readRecords(order.metadata)),
  );
  checkAlreadyRefunded(unresolved, alreadyRefunded);
}

/**
 * 상계한 몫을 음수 크레딧 라인으로 적는다 — 외부 환불이 남긴 «+X 금액 조정»을 «품목 값»으로 다시 분류한다.
 * 같은 requestId 의 라인이 이미 있으면 건너뛴다(환불 실패 뒤 재시도, Review Focus 2).
 */
async function offsetExternalRefund(container: MedusaContainer, orderId: string, requestId: string, applied: number) {
  if (applied <= 0) return;
  const orderModule = container.resolve(Modules.ORDER);
  const order = await orderModule.retrieveOrder(orderId, { select: ['id'], relations: ['credit_lines'] });
  const exists = (order.credit_lines ?? []).some(
    (l) => l.reference === OFFSET_CREDIT_LINE_REFERENCE && l.reference_id === requestId,
  );
  if (exists) return;
  await createOrderCreditLinesWorkflow(container).run({
    input: { id: orderId, credit_lines: [{ amount: -applied, reference: OFFSET_CREDIT_LINE_REFERENCE, reference_id: requestId }] },
  });
}
```

`toResult` 에 `externalRefundApplied: r.externalRefundApplied ?? 0,` 를 더한다. 파일 아래 `hashItems` 정의를 지운다(`normalizeItems` 는 기록에 쓰므로 남긴다).

**4단계 대안 — Task 5 가 FAIL 일 때만.** 공식 워크플로 대신 주문 수정 안에 `CREDIT_LINE_ADD` 를 넣어 확정과 함께 반영한다. 이때 applied 는 수정 «전»에 정해야 하므로 `plan.itemRefundEstimate` 로 상한한다:

- `edit` 의 `toReplace` 블록 뒤(배송비 블록 앞)에:

```ts
    // Task 5: 공식 워크플로는 수정 직후 차액을 못 본다 — 같은 주문 수정 안에 넣어 확정과 함께 반영한다
    const offset = appliedExternalRefund(input.alreadyRefunded, plan.itemRefundEstimate);
    if (offset > 0) {
      await createOrderChangeActionsWorkflow(container).run({
        input: [{
          order_change_id: change.id,
          order_id: order.id,
          version: change.version,
          action: ChangeActionType.CREDIT_LINE_ADD,
          amount: -offset,
          reference: OFFSET_CREDIT_LINE_REFERENCE,
          reference_id: input.requestId,
        }],
      });
    }
```

- 기록 계산은 `owed` 가 이미 상계를 품으므로 `const applied = offset` 로 두고 `refundAmount: Math.max(0, owed) + (shipping…)` (applied 를 빼지 않는다). `offset` 은 `try` 밖에서 `let offset = 0` 으로 선언해 넘긴다.
- `run` 에서 `offsetExternalRefund` 호출과 함수 정의를 지운다(재시도 멱등은 주문 수정 기록이 맡는다).
- 통합 테스트 «a > owed» 는 기대를 그대로 둔다(추정치 = 실제 차액인 픽스처다).

- [ ] **Step 4: 라우트**

`parse-input.ts`:

```ts
export type PartialCancelBody = {
  requestId: string;
  items: Array<{ itemId: string; quantity: number }>;
  alreadyRefunded?: number;
};

export function parseInput(body: unknown): PartialCancelBody {
  const b = (body ?? {}) as { requestId?: unknown; items?: unknown; already_refunded?: unknown };
```

`return` 앞에:

```ts
  const a = b.already_refunded;
  if (a !== undefined && (typeof a !== 'number' || !Number.isInteger(a) || a < 0)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, 'already_refunded 는 0 이상 정수여야 합니다');
  }
  return { requestId: b.requestId.trim(), items, ...(a !== undefined ? { alreadyRefunded: a } : {}) };
```

`route.ts` — import 에 `PartialCancelExternalRefundRejected` 를 더하고, 호출 인자에 `alreadyRefunded` 를 넘기고, 기존 `PartialCancelRejected` 분기 «앞»에:

```ts
  const { requestId, items, alreadyRefunded } = parseInput(req.body);
  try {
    const result = await partialCancelOrder(req.scope, {
      orderId: req.params.id,
      requestId,
      items,
      ...(alreadyRefunded !== undefined ? { alreadyRefunded } : {}),
      actorId: req.auth_context?.actor_id,
    });
    res.status(200).json(result);
  } catch (error) {
    // 하위 클래스라 먼저 본다 — code 는 그대로 두고 사유·금액만 더한다(옛 channel-adapter 는 그냥 거절로 닫는다)
    if (error instanceof PartialCancelExternalRefundRejected) {
      res.status(400).json({
        type: 'not_allowed',
        code: 'partial_cancel_rejected',
        reason: error.reason,
        unresolvedAmount: error.unresolvedAmount,
        message: error.message,
      });
      return;
    }
```

라우트 JSDoc 의 응답 계약 문장에 «400 에 `reason: external_refund_*` 가 붙으면 «이미 환불한 금액»을 묻는 거절(#1016 37번)» 을 더한다.

- [ ] **Step 5: 통과 확인**

Run: `cd apps/medusa && TEST_TYPE=unit npx jest src/workflows/orders/partial-cancel` → PASS
Run: `scripts/local/run-medusa-integration.sh --testPathPattern 'partial-cancel.spec|wallet-refund-projection'` → PASS (기존 테스트 포함)
Run: `npm run type-check` → 0. `cd apps/medusa && npx tsc --noEmit` → 0.

- [ ] **Step 6: 커밋 + PR 3**

```bash
git add apps/medusa
git commit -m "feat(medusa): 외부 환불 뒤 부분취소 — 미해결이면 거절, «이미 환불한 금액»은 음수 크레딧 라인으로 상계 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

PR 제목 `feat(medusa): #1016 37번 — 외부 환불 뒤 부분취소 안전망 (3/4)`. 본문: Task 5 판정 결과(주 경로/대안), «PR 2(channel-adapter) 배포 뒤 머지».

---

## PR 4 — admin-web (브랜치 `feat/1016-37-admin-web`, PR 3 배포 뒤 머지)

### Task 8: 거절 뒤에만 «이미 환불한 금액» 칸을 보이고 결과에 상계를 적는다

**Files:**
- Modify: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.ts`
- Modify: `apps/admin-web/src/lib/types/dto/orders.ts:343-348` (`CancelSalesOrderDto`)
- Modify: `apps/admin-web/src/features/order/history/components/modals/cancel-order-modal.tsx`
- Test: `apps/admin-web/src/lib/api/domains/orders/cancel-request.shape.spec.ts`

**Interfaces:**
- Consumes: Task 3 뷰 `rejection.unresolvedRefundAmount`, `outcome.externalRefundApplied`, Task 2 본문 `alreadyRefundedAmount`
- Produces: `unresolvedRefundToAsk(request: CancelRequestView | null): number | null`

- [ ] **Step 1: 실패하는 테스트**

`cancel-request.shape.spec.ts` import 에 `unresolvedRefundToAsk` 를 더하고, `describe` 안에:

```ts
  it('37번 — 외부 환불 미해결 거절 뒤에만 «이미 환불한 금액»을 묻는다', () => {
    const rejected = (reasonCode: string, extra: Record<string, unknown> = {}) =>
      toCancelRequestView(view({ status: 'rejected', rejection: { reasonCode, message: 'm', at: 't', ...extra } }));
    expect(unresolvedRefundToAsk(rejected('EXTERNAL_REFUND_UNRESOLVED', { unresolvedRefundAmount: 10000 }))).toBe(10000);
    expect(unresolvedRefundToAsk(rejected('EXTERNAL_REFUND_UNRESOLVED'))).toBe(0);
    expect(unresolvedRefundToAsk(rejected('NOT_CANCELABLE'))).toBeNull();
    expect(unresolvedRefundToAsk(toCancelRequestView(view()))).toBeNull();
    expect(unresolvedRefundToAsk(null)).toBeNull();
  });

  it('37번 — 반영 줄에 상계를 적고, 거절 줄은 라벨로 보인다', () => {
    const applied = toCancelRequestView(
      view({ status: 'applied', outcome: { refundAmount: 20000, shippingCharge: 0, shippingRefund: 0, shippingNotAdjusted: false, externalRefundApplied: 10000 } }),
    )!;
    expect(cancelRequestLine(applied)).toBe('부분취소 반영 · 환불 20,000원 · 외부 환불 10,000원 상계');
    const rejected = toCancelRequestView(
      view({ status: 'rejected', rejection: { reasonCode: 'EXTERNAL_REFUND_UNRESOLVED', message: '외부 환불 10,000원', at: 't' } }),
    )!;
    expect(cancelRequestLine(rejected)).toBe('부분취소 실패 · 이미 환불한 금액 확인 필요 · 외부 환불 10,000원');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- cancel-request.shape`
Expected: FAIL — `unresolvedRefundToAsk` 없음, 상계 문구 없음.

- [ ] **Step 3: 구현 (`cancel-request.shape.ts`)**

뷰 타입:

```ts
  rejection: { reasonCode: string; message: string; at: string; unresolvedRefundAmount?: number } | null;
  outcome: {
    refundAmount: number;
    shippingCharge: number;
    shippingRefund: number;
    shippingNotAdjusted: boolean;
    externalRefundApplied?: number;
  } | null;
```

`REJECTION_LABELS` 에 `EXTERNAL_REFUND_UNRESOLVED: '이미 환불한 금액 확인 필요',`

`rejectionOf`:

```ts
function rejectionOf(value: unknown): CancelRequestView['rejection'] {
  if (!isRecord(value) || typeof value.reasonCode !== 'string' || typeof value.message !== 'string') return null;
  return {
    reasonCode: value.reasonCode,
    message: value.message,
    at: typeof value.at === 'string' ? value.at : '',
    ...(typeof value.unresolvedRefundAmount === 'number' ? { unresolvedRefundAmount: value.unresolvedRefundAmount } : {}),
  };
}
```

`outcomeOf` 반환에 `...(typeof value.externalRefundApplied === 'number' ? { externalRefundApplied: value.externalRefundApplied } : {}),`

`cancelRequestLine` 의 `applied` 분기 반환:

```ts
      const offset = o.externalRefundApplied ? `외부 환불 ${won.format(o.externalRefundApplied)}원 상계` : null;
      return [`${name} 반영`, `환불 ${won.format(o.refundAmount)}원`, shipping, offset].filter(Boolean).join(' · ');
```

파일 끝에:

```ts
/**
 * 직전 요청이 «외부 환불 미해결»로 거절됐으면 다시 요청할 때 «이미 환불한 금액»을 물어야 한다(#1016 37번).
 * 물을 때는 품목에 연결 안 된 외부 환불 금액을, 아니면 null 을 돌려준다 — 평소엔 칸을 숨긴다.
 */
export function unresolvedRefundToAsk(request: CancelRequestView | null): number | null {
  if (request?.status !== 'rejected' || request.rejection?.reasonCode !== 'EXTERNAL_REFUND_UNRESOLVED') return null;
  return request.rejection.unresolvedRefundAmount ?? 0;
}
```

`orders.ts` `CancelSalesOrderDto` 에 `alreadyRefundedAmount?: number;`

- [ ] **Step 4: 취소 창 (`cancel-order-modal.tsx`)**

import 를 `import { isCancelRequested, unresolvedRefundToAsk } from '@/lib/api/domains/orders/cancel-request.shape';` 로 바꾼다.

상태와 초기화(`reasonDetail` 옆):

```ts
  const [alreadyRefunded, setAlreadyRefunded] = useState('');
  const askRefund = unresolvedRefundToAsk(order?.cancelRequest ?? null);
```

`useEffect` 초기화에 `setAlreadyRefunded('');`

`handleSubmit` 에서 `lines` 를 정한 뒤:

```ts
    let alreadyRefundedAmount: number | undefined;
    if (askRefund !== null && scope === 'partial') {
      const n = Number(alreadyRefunded);
      if (alreadyRefunded.trim() === '' || !Number.isInteger(n) || n < 0) {
        toast.error('이미 환불한 금액을 입력하세요 (없으면 0)');
        return;
      }
      alreadyRefundedAmount = n;
    }
```

`mutateAsync` 본문에 `...(alreadyRefundedAmount !== undefined ? { alreadyRefundedAmount } : {}),`

부분취소 수량 블록(`{scope === 'partial' && ( … 취소 수량 … )}`) 바로 뒤에:

```tsx
              {scope === 'partial' && askRefund !== null && (
                <div className="space-y-1">
                  <Label>이미 환불한 금액</Label>
                  <Input
                    type="number"
                    min={0}
                    value={alreadyRefunded}
                    onChange={(e) => setAlreadyRefunded(e.target.value)}
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500">품목에 연결 안 된 외부 환불 {askRefund.toLocaleString()}원</p>
                </div>
              )}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:admin-web -- cancel-request.shape` → PASS. `(cd apps/admin-web && npx tsc --noEmit)` → 0. `npm run test:admin-web` → 0.

- [ ] **Step 6: 커밋 + PR 4**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): 외부 환불 미해결 거절 뒤 «이미 환불한 금액» 칸, 반영 줄에 상계 (#1016 37번)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

PR 제목 `feat(admin-web): #1016 37번 — 이미 환불한 금액 입력 (4/4)`.

---

## 배포 뒤

- 라이브에서 이 경로가 돌 일은 core 출고 개통(한진) 전까지 거의 없다(스펙 §1.3). 개통 체크리스트에 두 줄을 더한다 — 메모리 `hanjin-api-activation` 가 가리키는 체크리스트에: «외부 환불이 있는 주문 부분취소 스모크: 거절 → 금액 입력 → 상계 환불», «wallet 관리자 화면 Medusa 주문 환불 차단(#1016 새 행)».
- #1016 37번 행의 해결 칸에 PR 커밋을 적는다(코멘트 금지, 본문 수정) → «주문의 일생» 아티팩트 재게시(메모리 `order-lifecycle-audit-2026-10-05`).
