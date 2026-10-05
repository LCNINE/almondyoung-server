# 수집 뒤 채널 변경 반영 — PR 1 (반영과 대기 목록) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 수집된 채널 주문이 바뀌면 channel-adapter 가 격리 대신 `OrderModified`(전체 스냅샷)를 보내고, core 가 유효 판매주문과 비교해 배송지(송장 전)·수량 감소·라인 제거를 자동 반영하며, 나머지는 amendment `pending` 으로 남겨 admin-web 에서 보이게 한다.

**Architecture:** channel-adapter 는 전달만 한다(해시 입력 불변). core 의 순수 함수 `diffChannelSnapshot` 이 델타를 만들고, `ChannelOrderChangeManager` 가 델타마다 기존 경로(`SalesOrdersService.cancel`, 새 `ShipmentPlanningService.reviseRecipientFromChannel`)를 **savepoint 안에서 시도**해 그 자리에서 끝나지 않으면 되돌리고 `pending` 으로 기록한다. 결과는 `sales_order_amendments` 한 행(origin/status 칸 추가)이다.

**Tech Stack:** NestJS 11, Drizzle ORM(postgres.js), zod 4(event contracts), Jest(ts-jest), Next.js admin-web + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md` (§7 은 «계획 단계 수정» 판을 따른다)

## Global Constraints

- core 레이어: Controller → Service(2~3줄) → Reader/Manager → Repository. Service 는 `HttpException`·drizzle 을 import 하지 않는다(CLAUDE.md)
- 트랜잭션: `DbTx` 는 `inventory.schema` 에서 import, `this.db.run(fn, tx)` 하나만. per-class `inTx`·로컬 `type Tx` 금지(ADR-0025)
- `any`·`as` 금지. 불가피하면 바로 윗줄에 근거 주석(이 계획에서 허용한 곳은 Task 6 의 jsonb `deltas` 한 곳)
- 채널 변경은 **돈을 움직이지 않는다** — `cancel` 호출에 `walletRefund` 를 넘기지 않는다(스펙 R6)
- channel-adapter 해시 입력(`OrderFetchItem.changes`)을 **바꾸지 않는다**(스펙 §5)
- 공동현관 비밀번호는 `OrderModified` 에 싣지 않고, 이벤트에 없다고 지우지 않는다
- 사유 코드 문자열은 스펙 §8.4 표 그대로: `WAYBILL_ISSUED` `SHIPMENT_IN_BATCH` `SHIPMENT_NOT_REVISABLE` `CONSOLIDATED_SHIPMENT` `RECIPIENT_INCOMPLETE` `CANCEL_NOT_IMMEDIATE` `ALL_LINES_REMOVED` `LINE_IDENTITY_MISSING` `OUT_OF_SCOPE`
- 채널 amendment `reason_code` = `CHANNEL_ORDER_MODIFIED`
- 검증 게이트: `npm run type-check` 에러 0, `npx jest --maxWorkers=2` 실패 0. admin-web 은 루트 type-check 밖이라 `cd apps/admin-web && npx tsc --noEmit` 를 따로 돌린다
- DB 통합 스펙은 `describeIfDb` 가드. 실행은 `npm run test:core:integration:local`(워크트리면 `COMPOSE_PROJECT_NAME=almondyoung-server` 를 앞에 붙인다)
- **`db:generate` 는 서브에이전트가 돌리지 못한다** — Task 3 의 마이그레이션 생성 단계는 메인 세션이 한다
- 작업자 문구는 「라벨」 대신 「송장」. 화면 문구는 최소(설명 캡션을 미리 깔지 않는다)

## Review Focus

1. **네이버 `OrderModified` 와 `OrderCancelled(partial)` 이 같은 라인에 대해 어느 순서로 와도 감소는 한 번이어야 한다** — 스냅샷의 `cancelled` 라인을 diff 가 건너뛰므로. Task 4 의 «cancelled 라인 건너뜀» 과 Task 7 의 «lifecycle 뒤 OrderModified» 통합 테스트가 고정한다
2. **우리 쪽 식별만 바뀐 스냅샷은 새 행을 만들지 않되, 이전 pending 은 superseded 로 닫아야 한다** — Task 4(델타 0) + Task 7(«실질 차이 0 → superseded») 테스트
3. **다른 판매주문과 합포장된 박스가 있으면 판매주문 주소도 그대로여야 한다**(반쪽 반영 금지) — Task 5 거절 + Task 7 «합포장 → SO 주소 불변» 테스트
4. **진행 중인 직배 출고지시가 있으면 주소를 반영하지 않는다** — Task 7 «drop_ship → SHIPMENT_NOT_REVISABLE» 테스트
5. **취소된 판매주문에 남은 pending 은 대기 목록에 안 뜬다** — Task 6 목록 통합 테스트

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `packages/event-contracts/streams/orders.stream.ts` | `OrderModified` 스냅샷 계약 |
| `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` | `OrderFetchItem.modification` 필드 |
| `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts` | 스냅샷 → `modification` 조립 |
| `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` | 수집된 주문 해시 변경 시 `OrderModified` enqueue |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` + `apps/core/drizzle/*` | amendment 4칸 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.types.ts` | 델타·사유·유효 주문 타입 |
| `.../channel-order-change/channel-order-diff.ts` | 순수 diff |
| `.../channel-order-change/channel-change-blockers.ts` | 예외 → 사유 코드(순수) |
| `.../channel-order-change/channel-order-change.reader.ts` | 유효 주문·박스·취소 효과 읽기 |
| `.../channel-order-change/channel-order-change.manager.ts` | savepoint 시도·적용·기록 |
| `.../channel-order-change/channel-order-change.service.ts` | Port(2줄) |
| `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` | `reviseRecipientFromChannel` |
| `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts` | 채널 행 기록·supersede·목록 |
| `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` | `handleOrderModified` 배선 |
| `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.{shape,client}.ts` | 응답 정형·요약 문구(순수)·호출 |
| `apps/admin-web/src/features/mall/pending-changes/components/pending-changes-table/index.tsx` | «반영 대기 변경» 표 |

---

### Task 1: `OrderModified` 계약을 전체 스냅샷으로

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts` (`OrderModifiedPayload`, `OrderModifiedSchema`)
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`updateFromEvent` 삭제, import 정리)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts` (OrderModified 픽스처)
- Test: `packages/event-contracts/streams/orders.stream.spec.ts`

**Interfaces:**
- Produces: `OrderModifiedSnapshotLine`, `OrderModifiedPayload { orderId; salesChannel; externalOrderId; modifiedAt; snapshot: { lines: OrderModifiedSnapshotLine[]; shippingAddress: ShippingAddress } }` (export from `@packages/event-contracts/streams`)

- [ ] **Step 1: 실패하는 계약 테스트를 쓴다** — `orders.stream.spec.ts` 끝에 추가:

```ts
describe('ORDER_STREAM OrderModified snapshot', () => {
  const schema = ORDER_STREAM.events.OrderModified.schema!;
  const base = {
    orderId: 'wms-order-1',
    salesChannel: 'naver' as const,
    externalOrderId: 'channel-order-1',
    modifiedAt: '2026-10-05T10:00:00+09:00',
    snapshot: {
      lines: [
        { channelOrderItemId: 'po-1', channelProductId: 'p-1', quantity: 0, unitPrice: 5000, cancelled: false },
        { channelOrderItemId: null, channelProductId: null, quantity: 1, unitPrice: 0, cancelled: true },
      ],
      shippingAddress: { recipientName: 'R', phone: '', postalCode: '', roadAddress: '', detailAddress: '' },
    },
  };

  it('네이버 +09:00 시각·수량 0·식별 없는 라인을 받는다', () => {
    expect(schema.parse(base)).toEqual(base);
  });

  it('채널 키가 없으면 거부한다 — core 가 판매주문을 못 찾는다', () => {
    const { externalOrderId: _drop, ...withoutKey } = base;
    expect(() => schema.parse(withoutKey)).toThrow();
  });

  it('음수 수량은 거부한다', () => {
    const bad = { ...base, snapshot: { ...base.snapshot, lines: [{ ...base.snapshot.lines[0], quantity: -1 }] } };
    expect(() => schema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx jest packages/event-contracts/streams/orders.stream.spec.ts` / Expected: FAIL (현재 스키마는 `changes`·`modifiedBy` 요구)

- [ ] **Step 3: 계약 교체** — `orders.stream.ts` 의 `OrderModifiedPayload` 인터페이스를 아래로 바꾼다:

```ts
/**
 * 수집 뒤 채널 변경 (#1016 5번 행). 변경분이 아니라 **채널이 지금 보여 주는 전체 스냅샷**이다 —
 * channel-adapter 는 이전 값을 들고 있지 않고, 비교는 core 가 유효 판매주문과 한다.
 * 공동현관 비밀번호는 싣지 않는다. core 가 그 값의 정본이고 «없음»은 «지워라»가 아니다.
 */
export interface OrderModifiedSnapshotLine {
  channelOrderItemId: string | null;
  channelProductId: string | null;
  quantity: number;
  unitPrice: number;
  /** 채널이 라인 취소로 표시한 라인. 감소는 lifecycle `OrderCancelled` 가 맡으므로 diff 가 건너뛴다. */
  cancelled: boolean;
}

export interface OrderModifiedPayload {
  /** channel-adapter 의 wms_order_id — core 판매주문 id 가 아니다. 참고용. */
  orderId: string;
  salesChannel: SalesChannel;
  externalOrderId: string;
  modifiedAt: string;
  snapshot: {
    lines: OrderModifiedSnapshotLine[];
    shippingAddress: ShippingAddress;
  };
}
```

`OrderModifiedSchema` 를 바꾼다:

```ts
// 기존 OrderItemSchema 를 쓰지 않는다 — 수량 0(Medusa 라인 제거)·미식별 라인이 소비 단계에서 거부된다.
const OrderModifiedSnapshotLineSchema = z.object({
  channelOrderItemId: z.string().trim().min(1).nullable(),
  channelProductId: z.string().trim().min(1).nullable(),
  quantity: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  cancelled: z.boolean(),
});

const OrderModifiedSchema = z.object({
  orderId: z.string().min(1),
  salesChannel: SalesChannelSchema,
  externalOrderId: z.string().min(1),
  // 네이버 시각은 +09:00 오프셋을 단다(#1016 2번 행과 같은 병) — offset 을 받아야 한다.
  modifiedAt: z.string().datetime({ offset: true }),
  snapshot: z.object({
    lines: z.array(OrderModifiedSnapshotLineSchema),
    shippingAddress: ShippingAddressSchema,
  }),
});
```

`index.ts` 가 `orders.stream` 을 `export *` 하는지 확인하고, 아니면 `OrderModifiedSnapshotLine` 을 export 목록에 더한다.

- [ ] **Step 4: core 컴파일 깨짐 정리**
  - `sales-orders.service.ts` 의 `updateFromEvent` 메서드 전체를 지운다(호출자 없음). `OrderModifiedPayload` import 가 남지 않으면 지운다
  - `order-events.consumer.spec.ts` 의 `'OrderModified 는 수락된 판매주문 계약 데이터를 …'` 테스트 픽스처를 새 모양으로 바꾸고 `updateFromEvent` 기대를 지운다(이 테스트는 Task 7 에서 다시 쓴다):

```ts
    const payload: OrderModifiedPayload = {
      orderId: 'so-accepted-1',
      salesChannel: 'medusa',
      externalOrderId: 'ext-accepted-1',
      modifiedAt: new Date().toISOString(),
      snapshot: {
        lines: [
          { channelOrderItemId: 'line-1', channelProductId: 'variant-1', quantity: 2, unitPrice: 6000, cancelled: false },
        ],
        shippingAddress: { recipientName: 'R', phone: '', postalCode: '', roadAddress: 'Changed', detailAddress: '' },
      },
    };
```

- [ ] **Step 5: 통과 확인** — Run: `npx jest packages/event-contracts apps/core/src/modules/sales-order/consumers` / Expected: PASS. Run: `npm run type-check` / Expected: 0 errors (channel-adapter 는 아직 `OrderModified` 를 만들지 않으므로 깨지지 않는다)

- [ ] **Step 6: Commit**

```bash
git add packages/event-contracts apps/core/src/modules/sales-order
git commit -m "feat(contracts): OrderModified 를 채널 전체 스냅샷 계약으로 (#1016 5번 행)"
```

---

### Task 2: channel-adapter — 격리 대신 `OrderModified` 를 보낸다

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` (`OrderFetchItem`)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` (`processOrderItem` 의 매핑 있음 분기)
- Modify: `apps/channel-adapter/src/demo/demo-order.provider.ts`
- Modify: `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts` (주석)
- Modify: `apps/channel-adapter/CLAUDE.md` §3-5
- Test: `channel-order.translator.spec.ts`, `order-poller.orchestrator.spec.ts`

**Interfaces:**
- Consumes: `OrderModifiedPayload` (Task 1)
- Produces: `OrderFetchItem.modification: OrderModifiedPayload['snapshot']`

- [ ] **Step 1: translator 실패 테스트** — `channel-order.translator.spec.ts` 의 `'ChannelOrderTranslator — 취소된 라인'` describe 안에 추가:

```ts
  it('modification 은 취소 라인까지 전 라인을 cancelled 표시와 함께 싣는다 — 우리 쪽 식별은 싣지 않는다', async () => {
    const { translator } = makeTranslator(LISTING);
    const { outcome } = await translator.translate(
      'naver',
      makeSnapshot({
        lines: [
          { channelOrderItemId: 'po-1', channelProductId: 'naver-product-1', productName: 'a', quantity: 1, unitPrice: 5000 },
          { channelOrderItemId: 'po-2', channelProductId: 'naver-product-2', productName: 'b', quantity: 1, unitPrice: 3000, cancelled: true },
        ],
      }),
    );
    expect(outcome.kind).toBe('order');
    if (outcome.kind !== 'order') return;
    expect(outcome.order.modification).toEqual({
      lines: [
        { channelOrderItemId: 'po-1', channelProductId: 'naver-product-1', quantity: 1, unitPrice: 5000, cancelled: false },
        { channelOrderItemId: 'po-2', channelProductId: 'naver-product-2', quantity: 1, unitPrice: 3000, cancelled: true },
      ],
      shippingAddress: SHIPPING_ADDRESS,
    });
  });
```

- [ ] **Step 2: 실패 확인** — Run: `npx jest apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts` / Expected: FAIL (`modification` undefined)

- [ ] **Step 3: 인터페이스와 translator**
  - `channel-order-provider.interface.ts`: import 에 `OrderModifiedPayload` 를 더하고 `OrderFetchItem` 에 필드를 더한다:

```ts
  /**
   * 수집된 주문의 해시가 바뀌면 `OrderModified` 로 그대로 나가는 스냅샷 (#1016 5번 행).
   * `changes`(해시 입력)와 따로 둔다 — 해시 입력은 배포 직후 오격리를 막으려고 모양을 고정했다.
   */
  modification: OrderModifiedPayload['snapshot'];
```

  - `channel-order.translator.ts` 의 `const order: OrderFetchItem = { … }` 에 `modifiedAt` 다음 줄로 더한다:

```ts
      modification: {
        lines: snapshot.lines.map((line) => ({
          channelOrderItemId: line.channelOrderItemId.trim() || null,
          channelProductId: line.channelProductId?.trim() || null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          cancelled: line.cancelled === true,
        })),
        shippingAddress: snapshot.shippingAddress,
      },
```

  - `demo-order.provider.ts` 의 반환 객체에 더한다:

```ts
    modification: {
      lines: items.map((item) => ({
        channelOrderItemId: item.orderItemId ?? null,
        channelProductId: item.channelProductId ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        cancelled: false,
      })),
      shippingAddress,
    },
```

- [ ] **Step 4: translator 통과 확인** — Run: 같은 명령 / Expected: PASS

- [ ] **Step 5: orchestrator 실패 테스트로 바꾼다** — `order-poller.orchestrator.spec.ts`:
  - 헬퍼 `makeOrder` 의 반환에 `modification` 을 더한다(`changes` 다음):

```ts
    modification: {
      lines: [{ channelOrderItemId: 'item_1', channelProductId: 'variant_1', quantity: 1, unitPrice: 10000, cancelled: false }],
      shippingAddress,
    },
```

  - `makeOrderWithCancelledLine` 에도 `modification: { lines: [{ channelOrderItemId: 'po-1', channelProductId: 'naver_product_1', quantity: 1, unitPrice: 10000, cancelled: false }, { channelOrderItemId: 'po-2', channelProductId: 'naver_product_1', quantity: 1, unitPrice: 3000, cancelled: true }], shippingAddress }` 를 더한다
  - 테스트 `'quarantines collected Medusa order modifications instead of emitting OrderModified'` 를 아래로 교체:

```ts
  it('수집된 주문의 해시가 바뀌면 격리하지 않고 OrderModified 를 한 번 보낸다', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] })
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:10:00.000Z', { totalAmount: 12000 })], failures: [] })
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:10:00.000Z', { totalAmount: 12000 })], failures: [] }),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const failures = makeFailureService();
    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      makeSyncStatus() as any,
      outbox as any,
      makeHashService() as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();
    await orchestrator.poll();

    const modified = outbox.enqueue.mock.calls.filter(([event]) => event.eventType === 'OrderModified');
    expect(modified).toHaveLength(1);
    expect(modified[0][0]).toMatchObject({
      aggregateId: '11111111-1111-4111-8111-111111111111',
      partitionKey: 'medusa',
      payload: {
        orderId: '11111111-1111-4111-8111-111111111111',
        salesChannel: 'medusa',
        externalOrderId: 'medusa_order_1',
        modifiedAt: '2026-05-26T01:10:00.000Z',
        snapshot: { lines: [expect.objectContaining({ channelOrderItemId: 'item_1', quantity: 1 })] },
      },
    });
    expect(failures.recordFailure).not.toHaveBeenCalled();
  });
```

  - `'still quarantines contract changes observed with refunded Medusa lifecycle snapshots'` → 이름을 `'환불 lifecycle 이 함께 와도 내용 변경은 OrderModified 로 간다'` 로 바꾸고, `recordFailure` 기대를 `expect(failures.recordFailure).not.toHaveBeenCalled()` 로, enqueue 기대를 `toHaveBeenCalledTimes(3)` + `expect.objectContaining({ eventType: 'OrderModified' })` 포함으로 바꾼다
  - `'quarantines refunded Medusa snapshots even when concrete refund rows are delayed'` → 이름 `'환불 행이 늦어도 내용 변경은 OrderModified 로 간다'`, 기대 `toHaveBeenCalledTimes(2)`·`OrderModified` 포함·`recordFailure` 미호출
  - `'quarantines a collected-order modification once when two concurrent polls observe the same stale hash'` → 이름 `'두 폴링이 같은 낡은 해시를 봐도 OrderModified 는 한 번'`, 기대를 `outbox.enqueue.mock.calls.filter(([e]) => e.eventType === 'OrderModified')` 길이 1 로
  - 같은 파일에서 `OrderModified` 를 «보내지 않는다»고 기대하는 나머지(`'emits collected Medusa cancellation and refund lifecycle events separately …'` 등)는 해시가 같은 스냅샷이라 그대로 통과해야 한다 — 고치지 않는다

- [ ] **Step 6: 실패 확인** — Run: `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts` / Expected: 바꾼 4개 FAIL

- [ ] **Step 7: orchestrator 구현** — `processOrderItem` 의 매핑 있음 분기에서 주석 두 줄(`// 이미 Core로 넘긴 …`)과 `recordFailure(...)` 호출을 아래로 바꾼다:

```ts
    // 이미 Core 로 넘긴 주문의 변경은 판정하지 않고 전달한다 (#1016 5번 행, 스펙 R2).
    // 무의미한 updated_at bump 는 해시가 거르고, 반영·대기 판정은 core 가 유효 판매주문과 비교해서 한다.
    const newHash = this.pollingHashService.computeHash(item.changes);

    // lifecycle 경로와 같은 이유로 확인과 기록이 한 트랜잭션·한 문장이다 (#599).
    const claimed = await this.db.db.transaction(async (tx) => {
      // 발행보다 **먼저** 선점한다. 같은 트랜잭션이므로 적재가 실패하면 선점도 함께 롤백되고,
      // 다음 폴링이 다시 시도한다.
      const won = await this.pollingHashService.claimChanged(
        provider.channel,
        POLLING_RESOURCE_TYPE_ORDER,
        item.externalOrderId,
        newHash,
        tx,
      );
      if (!won) {
        return false;
      }

      await this.ordersPublisher.enqueue(
        {
          eventType: 'OrderModified',
          aggregateId: mapping[0].wmsOrderId,
          payload: {
            orderId: mapping[0].wmsOrderId,
            salesChannel: provider.channel,
            externalOrderId: item.externalOrderId,
            modifiedAt: item.modifiedAt,
            snapshot: item.modification,
          },
          // OrderCreated·lifecycle 과 같은 키 — 채널 단위 순서가 유지돼야 core 가 생성보다 변경을 먼저 받지 않는다.
          partitionKey: provider.channel,
          metadata: { partitionKey: provider.channel },
        },
        tx,
      );
      return true;
    });

    return {
      emitted: claimed ? 1 : 0,
      dedupedUnchanged: claimed ? 0 : 1,
      wmsOrderId: mapping[0].wmsOrderId,
    };
```

  `COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED` import 가 orchestrator 에서 더 안 쓰이면 지운다(replay 거부 분기 `:312-320` 에서 쓰면 남긴다 — 기존 격리 행 replay 는 계속 거부한다).

- [ ] **Step 8: 통과 확인** — Run: `npx jest apps/channel-adapter` / Expected: PASS. 실패가 `emitted` 카운트 기대(워터마크·결과 집계)에서 나면 그 테스트가 «수정 = 발행 0» 을 전제한 것이다 — 새 동작(발행 1)으로 기대를 고친다

- [ ] **Step 9: 문서·주석**
  - `apps/channel-adapter/CLAUDE.md` §3-5 의 «수집된 주문 변경은 격리» 문장을 «수집된 주문의 해시가 바뀌면 `OrderModified`(전체 스냅샷)를 보낸다. 반영·대기 판정은 core 가 한다(#1016 5번 행, `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md`). 기존 `collected_order_modification_not_accepted` 행은 남고 replay 는 계속 거부된다» 로 바꾼다
  - `fulfillment-events.consumer.ts` 의 `handleCoreOrderCancelled` 문서 주석 «부분취소를 외부채널/Medusa에 전파하지 않는 이유» 목록에 4번을 더한다: `4. 메아리 방지: 채널 변경을 core 가 반영한 부분취소(cancelledBy 'channel')도 이 이벤트로 나온다. 부분취소 전파를 켤 때(#1016 35번 행) 그 이벤트는 제외해야 한다 — 안 그러면 채널 변경이 채널로 되돌아간다.`

- [ ] **Step 10: Commit**

```bash
git add apps/channel-adapter
git commit -m "feat(channel-adapter): 수집된 주문 변경을 격리 대신 OrderModified 로 전달 (#1016 5번 행)"
```

---

### Task 3: amendment 에 origin·status·source_event_id·superseded_by_id

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (`salesOrderAmendments`)
- Create: `apps/core/drizzle/<timestamp>_add-amendment-origin-status.sql` + `apps/core/drizzle/meta/*` (생성됨)

**Interfaces:**
- Produces: 컬럼 `origin`(`'channel'|'operator'`), `status`(`'applied'|'pending'|'superseded'`), `sourceEventId: string | null`, `supersededById: string | null`

- [ ] **Step 1: 스키마 수정** — `salesOrderAmendments` 칸 목록의 `createdBy` 앞에 더한다:

```ts
    // #1016 판단 6: 채널 변경과 운영자 수정을 함께 담는 단일 변경 기록. `decision` 은 운영자 승인 축, `status` 는 적용 축이다.
    origin: varchar('origin', { length: 16 }).$type<'channel' | 'operator'>().notNull().default('operator'),
    status: varchar('status', { length: 16 }).$type<'applied' | 'pending' | 'superseded'>().notNull().default('pending'),
    sourceEventId: varchar('source_event_id', { length: 255 }),
    supersededById: uuid('superseded_by_id').references((): AnyPgColumn => salesOrderAmendments.id, {
      onDelete: 'set null',
    }),
```

  인덱스·체크에 더한다:

```ts
    uqSourceEventId: uniqueIndex('uq_sales_order_amendments_source_event_id')
      .on(t.sourceEventId)
      .where(sql`${t.sourceEventId} IS NOT NULL`),
    idxPendingList: index('idx_sales_order_amendments_status_origin_occurred').on(t.status, t.origin, t.occurredAt),
    originCheck: check('sales_order_amendments_origin_check', sql`${t.origin} IN ('channel', 'operator')`),
    statusCheck: check(
      'sales_order_amendments_status_check',
      sql`${t.status} IN ('applied', 'pending', 'superseded')`,
    ),
```

  `AnyPgColumn` 이 import 돼 있지 않으면 `drizzle-orm/pg-core` import 에 더한다(파일 안 다른 자기 참조가 쓰는 방식을 grep 으로 확인: `grep -n "AnyPgColumn" apps/core/src/modules/inventory/schema/inventory.schema.ts`).

- [ ] **Step 2: 🔴 메인 세션에서 마이그레이션 생성** — Run: `npm run db:generate:core -- --name add-amendment-origin-status`
  Expected: `apps/core/drizzle/<timestamp>_add-amendment-origin-status.sql` 에 `ADD COLUMN "origin" … DEFAULT 'operator' NOT NULL`, `"status" … DEFAULT 'pending' NOT NULL`, `"source_event_id"`, `"superseded_by_id"`, FK, unique partial index, index, check 두 개 **만** 있다. `DROP` 이나 다른 테이블 변경이 섞이면 `git rm` 하고 스냅샷 체인부터 확인한다(메모리: core 스냅샷 체인 복구 `ccd7f6b8c`)

- [ ] **Step 3: 적용 확인** — 로컬 core DB 에 migrate 가 조용히 멈추는 경우가 있다(타 브랜치 잔재). 임시 DB 로 확인한다:

```bash
createdb -h localhost -U postgres core_amend_check
DATABASE_URL=postgres://postgres:postgres@localhost:5432/core_amend_check npx drizzle-kit migrate --config apps/core/drizzle.config.ts
psql -h localhost -U postgres core_amend_check -c '\d sales_order_amendments'
dropdb -h localhost -U postgres core_amend_check
```

  Expected: 4칸과 인덱스가 보인다

- [ ] **Step 4: type-check** — Run: `npm run type-check` / Expected: 0 errors

- [ ] **Step 5: Commit** (스키마 + SQL + meta 한 커밋, CLAUDE.md 규칙)

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle
git commit -m "feat(core): sales_order_amendments 에 origin·status·source_event_id·superseded_by_id (#1016 5번 행)"
```

---

### Task 4: 순수 diff

**Files:**
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.types.ts`
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-order-diff.ts`
- Test: `apps/core/src/modules/sales-order/channel-order-change/channel-order-diff.spec.ts`

**Interfaces:**
- Consumes: `OrderModifiedPayload['snapshot']` (Task 1)
- Produces:
  - `type ChannelOrderSnapshot = OrderModifiedPayload['snapshot']`
  - `interface EffectiveSalesOrder { id: string; status: string; shippingAddress: ShippingAddress; lines: EffectiveSalesOrderLine[] }`
  - `interface EffectiveSalesOrderLine { id: string; channelOrderItemId: string | null; channelProductId: string | null; effectiveQuantity: number; unitPrice: number | null }`
  - `type ChannelDelta` (아래), `type ChannelBlockerCode`, `interface ChannelBlocker { code; shipmentId?; detail? }`, `type RecordedChannelDelta = ChannelDelta & ({ outcome: 'applied' } | { outcome: 'pending'; blockers: ChannelBlocker[] })`
  - `function diffChannelSnapshot(order: EffectiveSalesOrder, snapshot: ChannelOrderSnapshot): ChannelDelta[]`
  - `function isDecrease(delta: ChannelDelta): delta is QuantityCorrectionDelta`
  - `function removesAllLines(order: EffectiveSalesOrder, deltas: ChannelDelta[]): boolean`
  - `function toShippingAddress(value: unknown): ShippingAddress`

- [ ] **Step 1: 타입 파일을 만든다** — `channel-order-change.types.ts`:

```ts
import type { OrderModifiedPayload, ShippingAddress } from '@packages/event-contracts/streams';

export type ChannelOrderSnapshot = OrderModifiedPayload['snapshot'];

export const CHANNEL_ORDER_MODIFIED_REASON = 'CHANNEL_ORDER_MODIFIED';

export type ChannelBlockerCode =
  | 'WAYBILL_ISSUED'
  | 'SHIPMENT_IN_BATCH'
  | 'SHIPMENT_NOT_REVISABLE'
  | 'CONSOLIDATED_SHIPMENT'
  | 'RECIPIENT_INCOMPLETE'
  | 'CANCEL_NOT_IMMEDIATE'
  | 'ALL_LINES_REMOVED'
  | 'LINE_IDENTITY_MISSING'
  | 'OUT_OF_SCOPE';

export interface ChannelBlocker {
  code: ChannelBlockerCode;
  shipmentId?: string;
  detail?: string;
}

export interface EffectiveSalesOrderLine {
  id: string;
  channelOrderItemId: string | null;
  channelProductId: string | null;
  /** 라인 수량 − 이미 취소된 수량 */
  effectiveQuantity: number;
  unitPrice: number | null;
}

export interface EffectiveSalesOrder {
  id: string;
  status: string;
  shippingAddress: ShippingAddress;
  lines: EffectiveSalesOrderLine[];
}

export interface ShippingAddressChangeDelta {
  type: 'shipping_address_change';
  before: ShippingAddress;
  after: ShippingAddress;
}
export interface QuantityCorrectionDelta {
  type: 'quantity_correction';
  salesOrderLineId: string;
  channelOrderItemId: string;
  quantityBefore: number;
  correctedQuantity: number;
}
export interface AddProductDelta {
  type: 'add_product';
  channelOrderItemId: string;
  channelProductId: string | null;
  quantity: number;
  unitPrice: number;
}
export interface ReplaceProductDelta {
  type: 'replace_product';
  salesOrderLineId: string;
  channelOrderItemId: string;
  channelProductIdBefore: string;
  channelProductIdAfter: string;
}
export interface AmountCorrectionDelta {
  type: 'amount_correction';
  salesOrderLineId: string;
  channelOrderItemId: string;
  unitPriceBefore: number;
  unitPriceAfter: number;
}
/** 어느 한쪽에 채널 라인 id 가 없어 짝을 못 지은 라인. 항상 pending(LINE_IDENTITY_MISSING). */
export interface UnmatchedLineDelta {
  type: 'unmatched_line';
  salesOrderLineId: string | null;
  quantity: number;
}

export type ChannelDelta =
  | ShippingAddressChangeDelta
  | QuantityCorrectionDelta
  | AddProductDelta
  | ReplaceProductDelta
  | AmountCorrectionDelta
  | UnmatchedLineDelta;

export type ChannelDeltaOutcome = { outcome: 'applied' } | { outcome: 'pending'; blockers: ChannelBlocker[] };

export type RecordedChannelDelta = ChannelDelta & ChannelDeltaOutcome;
```

- [ ] **Step 2: 실패 테스트** — `channel-order-diff.spec.ts`:

```ts
import { diffChannelSnapshot, isDecrease, removesAllLines, toShippingAddress } from './channel-order-diff';
import type { ChannelOrderSnapshot, EffectiveSalesOrder } from './channel-order-change.types';

const ADDRESS = { recipientName: '김', phone: '010', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

function order(over: Partial<EffectiveSalesOrder> = {}): EffectiveSalesOrder {
  return {
    id: 'so-1',
    status: 'pending',
    shippingAddress: ADDRESS,
    lines: [
      { id: 'sol-1', channelOrderItemId: 'ci-1', channelProductId: 'cp-1', effectiveQuantity: 2, unitPrice: 1000 },
      { id: 'sol-2', channelOrderItemId: 'ci-2', channelProductId: 'cp-2', effectiveQuantity: 1, unitPrice: 500 },
    ],
    ...over,
  };
}

function snapshot(over: Partial<ChannelOrderSnapshot> = {}): ChannelOrderSnapshot {
  return {
    shippingAddress: ADDRESS,
    lines: [
      { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
      { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: false },
    ],
    ...over,
  };
}

describe('diffChannelSnapshot', () => {
  it('같으면 델타가 없다 — 우리 쪽 식별만 바뀐 «변경»은 여기서 사라진다', () => {
    expect(diffChannelSnapshot(order(), snapshot())).toEqual([]);
  });

  it('취소·타임아웃 판매주문은 비교하지 않는다', () => {
    const changed = snapshot({ shippingAddress: { ...ADDRESS, roadAddress: '부산' } });
    expect(diffChannelSnapshot(order({ status: 'cancelled' }), changed)).toEqual([]);
    expect(diffChannelSnapshot(order({ status: 'timeout' }), changed)).toEqual([]);
  });

  it('주소 필드 하나라도 다르면 배송지 변경 — 앞뒤 공백은 무시한다', () => {
    const after = { ...ADDRESS, detailAddress: '202', deliveryNote: '문 앞' };
    expect(diffChannelSnapshot(order(), snapshot({ shippingAddress: after }))).toEqual([
      { type: 'shipping_address_change', before: ADDRESS, after },
    ]);
    expect(diffChannelSnapshot(order(), snapshot({ shippingAddress: { ...ADDRESS, phone: ' 010 ' } }))).toEqual([]);
  });

  it('수량 감소, 수량 0, 라인 소멸은 같은 감소다', () => {
    const decreased = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [{ channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 1, unitPrice: 1000, cancelled: false }],
      }),
    );
    expect(decreased).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 2, correctedQuantity: 1 },
      { type: 'quantity_correction', salesOrderLineId: 'sol-2', channelOrderItemId: 'ci-2', quantityBefore: 1, correctedQuantity: 0 },
    ]);
    const zeroed = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [
          { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
          { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 0, unitPrice: 500, cancelled: false },
        ],
      }),
    );
    expect(zeroed).toEqual([decreased[1]]);
  });

  it('cancelled 라인은 건너뛴다 — lifecycle 취소가 맡는다(이중 차감 방지)', () => {
    const naver = snapshot({
      lines: [
        { channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 2, unitPrice: 1000, cancelled: false },
        { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: true },
      ],
    });
    expect(diffChannelSnapshot(order(), naver)).toEqual([]);
    // lifecycle 이 먼저 적용돼 유효 수량이 0 이 된 뒤에도 같다
    const afterLifecycle = order({
      lines: [order().lines[0], { ...order().lines[1], effectiveQuantity: 0 }],
    });
    expect(diffChannelSnapshot(afterLifecycle, naver)).toEqual([]);
  });

  it('증가·추가·교체·단가는 델타로 남는다(분류는 매니저가 범위 밖으로)', () => {
    const deltas = diffChannelSnapshot(
      order(),
      snapshot({
        lines: [
          { channelOrderItemId: 'ci-1', channelProductId: 'cp-9', quantity: 3, unitPrice: 900, cancelled: false },
          { channelOrderItemId: 'ci-2', channelProductId: 'cp-2', quantity: 1, unitPrice: 500, cancelled: false },
          { channelOrderItemId: 'ci-3', channelProductId: 'cp-3', quantity: 1, unitPrice: 700, cancelled: false },
        ],
      }),
    );
    expect(deltas).toEqual([
      { type: 'quantity_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', quantityBefore: 2, correctedQuantity: 3 },
      { type: 'replace_product', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', channelProductIdBefore: 'cp-1', channelProductIdAfter: 'cp-9' },
      { type: 'amount_correction', salesOrderLineId: 'sol-1', channelOrderItemId: 'ci-1', unitPriceBefore: 1000, unitPriceAfter: 900 },
      { type: 'add_product', channelOrderItemId: 'ci-3', channelProductId: 'cp-3', quantity: 1, unitPrice: 700 },
    ]);
  });

  it('채널 라인 id 가 없는 라인은 짝을 못 지은 라인으로 남긴다', () => {
    const deltas = diffChannelSnapshot(
      order({ lines: [{ id: 'sol-x', channelOrderItemId: null, channelProductId: null, effectiveQuantity: 1, unitPrice: 1 }] }),
      snapshot({ lines: [{ channelOrderItemId: null, channelProductId: null, quantity: 1, unitPrice: 1, cancelled: false }] }),
    );
    expect(deltas).toEqual([
      { type: 'unmatched_line', salesOrderLineId: 'sol-x', quantity: 1 },
      { type: 'unmatched_line', salesOrderLineId: null, quantity: 1 },
    ]);
  });
});

describe('isDecrease / removesAllLines', () => {
  it('감소만 참이다', () => {
    const [down] = diffChannelSnapshot(
      order(),
      snapshot({ lines: [{ channelOrderItemId: 'ci-1', channelProductId: 'cp-1', quantity: 1, unitPrice: 1000, cancelled: false }, snapshot().lines[1]] }),
    );
    expect(isDecrease(down)).toBe(true);
    expect(isDecrease({ type: 'add_product', channelOrderItemId: 'x', channelProductId: null, quantity: 1, unitPrice: 1 })).toBe(false);
  });

  it('남는 수량 합이 0 이면 전 라인 제거', () => {
    const deltas = diffChannelSnapshot(order(), snapshot({ lines: [] }));
    expect(removesAllLines(order(), deltas)).toBe(true);
    const partial = diffChannelSnapshot(order(), snapshot({ lines: [snapshot().lines[0]] }));
    expect(removesAllLines(order(), partial)).toBe(false);
  });
});

describe('toShippingAddress', () => {
  it('jsonb 값을 계약 모양으로 읽고, 없는 선택 필드는 키 자체를 만들지 않는다', () => {
    expect(toShippingAddress({ ...ADDRESS, extra: 1 })).toEqual(ADDRESS);
    expect(toShippingAddress(null)).toEqual({ recipientName: '', phone: '', postalCode: '', roadAddress: '', detailAddress: '' });
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx jest apps/core/src/modules/sales-order/channel-order-change` / Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현** — `channel-order-diff.ts`:

```ts
import type { ShippingAddress } from '@packages/event-contracts/streams';
import type {
  ChannelDelta,
  ChannelOrderSnapshot,
  EffectiveSalesOrder,
  QuantityCorrectionDelta,
} from './channel-order-change.types';

const REQUIRED_ADDRESS_FIELDS = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'] as const;
const OPTIONAL_ADDRESS_FIELDS = ['deliveryNote', 'personalCustomsCode'] as const;
const ADDRESS_FIELDS = [...REQUIRED_ADDRESS_FIELDS, ...OPTIONAL_ADDRESS_FIELDS] as const;
const NOT_DIFFED_STATUSES = new Set(['cancelled', 'timeout']);

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 판매주문 jsonb(`convertShippingAddress` 결과)를 계약 모양으로 읽는다. 없는 선택 필드는 키를 만들지 않는다. */
export function toShippingAddress(value: unknown): ShippingAddress {
  const record = value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {};
  const address: ShippingAddress = {
    recipientName: text(record.recipientName),
    phone: text(record.phone),
    postalCode: text(record.postalCode),
    roadAddress: text(record.roadAddress),
    detailAddress: text(record.detailAddress),
  };
  for (const field of OPTIONAL_ADDRESS_FIELDS) {
    const optional = record[field];
    if (typeof optional === 'string') address[field] = optional;
  }
  return address;
}

function addressChanged(current: ShippingAddress, next: ShippingAddress): boolean {
  return ADDRESS_FIELDS.some((field) => (current[field] ?? '').trim() !== (next[field] ?? '').trim());
}

/**
 * 채널 스냅샷과 «지금 유효한» 판매주문의 차이 (스펙 §6). 판정(반영/대기)은 하지 않는다.
 * 비교하지 않는 것: 총액·할인(감소의 결과), 우리 쪽 식별·상품명(6번 행의 오탐), 공동현관 비밀번호.
 */
export function diffChannelSnapshot(order: EffectiveSalesOrder, snapshot: ChannelOrderSnapshot): ChannelDelta[] {
  if (NOT_DIFFED_STATUSES.has(order.status)) return [];
  const deltas: ChannelDelta[] = [];

  if (addressChanged(order.shippingAddress, snapshot.shippingAddress)) {
    deltas.push({ type: 'shipping_address_change', before: order.shippingAddress, after: toShippingAddress(snapshot.shippingAddress) });
  }

  // 채널이 취소로 표시한 라인은 lifecycle OrderCancelled 가 맡는다 — 여기서 또 줄이면 이중 차감이다.
  const cancelledItemIds = new Set(
    snapshot.lines.flatMap((line) => (line.cancelled && line.channelOrderItemId ? [line.channelOrderItemId] : [])),
  );
  const liveLines = snapshot.lines.filter((line) => !line.cancelled);
  const liveByItemId = new Map(
    liveLines.flatMap((line) => (line.channelOrderItemId ? [[line.channelOrderItemId, line] as const] : [])),
  );

  for (const line of order.lines) {
    if (!line.channelOrderItemId) {
      deltas.push({ type: 'unmatched_line', salesOrderLineId: line.id, quantity: line.effectiveQuantity });
      continue;
    }
    if (cancelledItemIds.has(line.channelOrderItemId)) continue;
    const next = liveByItemId.get(line.channelOrderItemId);
    const nextQuantity = next?.quantity ?? 0;
    if (nextQuantity !== line.effectiveQuantity) {
      deltas.push({
        type: 'quantity_correction',
        salesOrderLineId: line.id,
        channelOrderItemId: line.channelOrderItemId,
        quantityBefore: line.effectiveQuantity,
        correctedQuantity: nextQuantity,
      });
    }
    if (!next) continue;
    if (line.channelProductId && next.channelProductId && line.channelProductId !== next.channelProductId) {
      deltas.push({
        type: 'replace_product',
        salesOrderLineId: line.id,
        channelOrderItemId: line.channelOrderItemId,
        channelProductIdBefore: line.channelProductId,
        channelProductIdAfter: next.channelProductId,
      });
    }
    if (line.unitPrice !== null && next.unitPrice !== line.unitPrice) {
      deltas.push({
        type: 'amount_correction',
        salesOrderLineId: line.id,
        channelOrderItemId: line.channelOrderItemId,
        unitPriceBefore: line.unitPrice,
        unitPriceAfter: next.unitPrice,
      });
    }
  }

  const knownItemIds = new Set(order.lines.flatMap((line) => (line.channelOrderItemId ? [line.channelOrderItemId] : [])));
  for (const next of liveLines) {
    if (!next.channelOrderItemId) {
      deltas.push({ type: 'unmatched_line', salesOrderLineId: null, quantity: next.quantity });
      continue;
    }
    if (!knownItemIds.has(next.channelOrderItemId) && next.quantity > 0) {
      deltas.push({
        type: 'add_product',
        channelOrderItemId: next.channelOrderItemId,
        channelProductId: next.channelProductId,
        quantity: next.quantity,
        unitPrice: next.unitPrice,
      });
    }
  }
  return deltas;
}

export function isDecrease(delta: ChannelDelta): delta is QuantityCorrectionDelta {
  return delta.type === 'quantity_correction' && delta.correctedQuantity < delta.quantityBefore;
}

/** 감소를 다 적용하면 남는 수량 합이 0 인가. 추가 라인이 있으면 거짓. */
export function removesAllLines(order: EffectiveSalesOrder, deltas: ChannelDelta[]): boolean {
  if (deltas.some((delta) => delta.type === 'add_product')) return false;
  const corrected = new Map(
    deltas.flatMap((delta) => (delta.type === 'quantity_correction' ? [[delta.salesOrderLineId, delta.correctedQuantity] as const] : [])),
  );
  const remaining = order.lines.reduce((sum, line) => sum + (corrected.get(line.id) ?? line.effectiveQuantity), 0);
  return remaining === 0 && order.lines.some((line) => line.effectiveQuantity > 0);
}
```

- [ ] **Step 5: 통과 확인** — Run: `npx jest apps/core/src/modules/sales-order/channel-order-change` / Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/sales-order/channel-order-change
git commit -m "feat(core): 채널 스냅샷 ↔ 유효 판매주문 순수 diff (#1016 5번 행)"
```

---

### Task 5: `ShipmentPlanningService.reviseRecipientFromChannel`

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts`
- Test: `apps/core/src/modules/fulfillment/services/shipment-recipient-from-channel.integration.spec.ts`

**Interfaces:**
- Consumes: 기존 private `lockAggregate`, `assertNoCustodyOrActiveWork`, `assertNoActiveWaybill`, `assertRecipientComplete`, `createOperation`, `completeOperation`, `auditCommand`, `snapshot`, `loadAggregate`, `conflict`, export `resolveRecipientRevision`
- Produces: `reviseRecipientFromChannel(shipmentId: string, salesOrderId: string, recipientSnapshot: ShippingAddress, idempotencyKey: string, actor: ShipmentPlanningActor, tx: DbTx): Promise<{ changed: boolean }>` — 거절은 `ConflictException({ code })`, 코드: `SHIPMENT_REOPEN_REQUIRED` · `SHIPMENT_CONSOLIDATED` · `SHIPMENT_CUSTODY_EXISTS` · `SHIPMENT_ACTIVE_WORK_ITEM` · `SHIPMENT_ACTIVE_INVOICE` · `SHIPMENT_RECIPIENT_INCOMPLETE`

- [ ] **Step 1: 실패 통합 테스트** — `shipment-recipient-from-channel.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';
import {
  inRollbackTx,
  makeDb,
  makeDbService,
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from './__support__';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: '00000000-0000-4000-8000-000000000010', roles: ['master'] };
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };
const NEXT = { ...ADDRESS, roadAddress: '부산', detailAddress: '202' };

describeIfDb('reviseRecipientFromChannel (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 판매주문 1건 → FO → draft 박스 1개. */
  async function draftBox(tx: DbTx) {
    const w = wireLogistics(makeDbService(db));
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [so] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `IT-${randomUUID().slice(0, 8)}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: ADDRESS,
        orderDate: new Date(),
      })
      .returning();
    await tx.insert(wmsTables.salesOrderLines).values({
      salesOrderId: so.id,
      variantId,
      productName: 'IT',
      quantity: 1,
      unitPrice: 1000,
      channelOrderItemId: `ci-${randomUUID().slice(0, 8)}`,
    });
    await w.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
    const [row] = await tx
      .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
      .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId))
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, so.id))
      .limit(1);
    return { salesOrderId: so.id, shipmentId: row.shipmentId, warehouseId };
  }

  async function codeOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ConflictException) {
        const response = error.getResponse();
        if (typeof response === 'object' && response !== null && 'code' in response && typeof response.code === 'string') {
          return response.code;
        }
      }
      throw error;
    }
    throw new Error('expected a conflict');
  }

  it('draft 박스의 수령인을 바꾸고 manifestVersion 을 올리며 recipient_revision 작업을 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      const [before] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      const result = await assembleOutbound(tx).planning.reviseRecipientFromChannel(
        box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx,
      );
      expect(result).toEqual({ changed: true });
      const [after] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(after.recipientSnapshot).toEqual(NEXT);
      expect(after.manifestVersion).toBe(before.manifestVersion + 1);
      const ops = await tx.select().from(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.type, 'recipient_revision'));
      expect(ops.some((op) => op.reason === 'CHANNEL_ORDER_MODIFIED' && op.status === 'completed')).toBe(true);
    });
  });

  it('같은 주소면 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      const result = await assembleOutbound(tx).planning.reviseRecipientFromChannel(
        box.shipmentId, box.salesOrderId, ADDRESS, `k-${randomUUID()}`, actor, tx,
      );
      expect(result).toEqual({ changed: false });
    });
  });

  it('배치 밖 planned 박스도 받는다 — 불완전한 새 주소는 거절', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      const planning = assembleOutbound(tx).planning;
      await expect(
        planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx),
      ).resolves.toEqual({ changed: true });
      expect(
        await codeOf(
          planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, { ...NEXT, detailAddress: '' }, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_RECIPIENT_INCOMPLETE');
    });
  });

  it('살아 있는 송장이 있으면 SHIPMENT_ACTIVE_INVOICE', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      await tx.insert(wmsTables.waybills).values({
        shipmentId: box.shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `T${Date.now()}`,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalFulfillmentRequestHash(ADDRESS),
      });
      expect(
        await codeOf(
          assembleOutbound(tx).planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_ACTIVE_INVOICE');
    });
  });

  it('다른 판매주문의 라인을 실은 박스는 SHIPMENT_CONSOLIDATED', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      expect(
        await codeOf(
          assembleOutbound(tx).planning.reviseRecipientFromChannel(box.shipmentId, randomUUID(), NEXT, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_CONSOLIDATED');
    });
  });

  it('shipped 박스는 SHIPMENT_REOPEN_REQUIRED', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await draftBox(tx);
      await tx.update(wmsTables.shipments).set({ status: 'shipped' }).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(
        await codeOf(
          assembleOutbound(tx).planning.reviseRecipientFromChannel(box.shipmentId, box.salesOrderId, NEXT, `k-${randomUUID()}`, actor, tx),
        ),
      ).toBe('SHIPMENT_REOPEN_REQUIRED');
    });
  });
});
```

  `seedWarehouseWithZone`·`receiveStock` 등은 `sales-order-to-fulfillment.conversion.integration.spec.ts` 와 같은 헬퍼다. `wireLogistics(makeDbService(db))` 의 `fulfillments.create` 는 tx 를 받으므로 rollback 트랜잭션 안에서 돈다.

- [ ] **Step 2: 실패 확인** — Run: `npm run test:core:integration:local -- shipment-recipient-from-channel` / Expected: FAIL (`reviseRecipientFromChannel is not a function`). 스크립트가 경로 인자를 안 받으면 `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/fulfillment/services/shipment-recipient-from-channel.integration.spec.ts --runInBand`

- [ ] **Step 3: 구현** — `reviseRecipient` 바로 아래에 더한다. import 에 `ShippingAddress`(`@packages/event-contracts/streams`)가 없으면 더한다:

```ts
  /**
   * 채널 변경(#1016 5번 행)이 박스 수령인을 따라가게 한다. `reviseRecipient`(운영자)와 같은 검사·같은 기록을 하되 둘이 다르다:
   * 배치 밖 `planned` 도 받고(작업 항목은 `assertNoCustodyOrActiveWork` 가 막는다), 이 판매주문 밖의 라인을 실은 박스는 거절한다.
   * 거절은 `ConflictException({ code })` 다 — 호출자가 savepoint 를 되돌리고 대기로 남긴다.
   */
  async reviseRecipientFromChannel(
    shipmentId: string,
    salesOrderId: string,
    recipientSnapshot: ShippingAddress,
    idempotencyKey: string,
    actor: ShipmentPlanningActor,
    tx: DbTx,
  ): Promise<{ changed: boolean }> {
    this.workflowGate.assertV2MutationAllowed('shipment.revise_recipient');
    return this.commands.execute(
      {
        commandType: 'shipment.recipient_revision',
        idempotencyKey,
        canonicalRequest: { actorId: actor.id, shipmentId, salesOrderId, recipientSnapshot, origin: 'channel' },
      },
      async (tx, _commandRequestId, requestHash) => {
        const aggregate = await this.lockAggregate(shipmentId, tx);
        if (aggregate.shipment.status !== 'draft' && aggregate.shipment.status !== 'planned') {
          throw this.conflict('SHIPMENT_REOPEN_REQUIRED', `Shipment ${shipmentId} is ${aggregate.shipment.status}`);
        }
        if (aggregate.lines.some((line) => line.salesOrderId !== salesOrderId)) {
          throw this.conflict('SHIPMENT_CONSOLIDATED', `Shipment ${shipmentId} carries lines of another sales order`);
        }
        await this.assertNoCustodyOrActiveWork(aggregate, tx);
        await this.assertNoActiveWaybill(shipmentId, tx);
        if (aggregate.shipment.status === 'planned') this.assertRecipientComplete(recipientSnapshot);

        const revision = resolveRecipientRevision(
          {
            recipientSnapshot: aggregate.shipment.recipientSnapshot,
            manifestVersion: aggregate.shipment.manifestVersion,
            entrancePassword: aggregate.shipment.entrancePassword,
          },
          { recipientSnapshot },
        );
        if (!revision.snapshotChanged) {
          return { response: { changed: false }, resourceType: 'shipment', resourceId: shipmentId };
        }

        const before = this.snapshot(aggregate);
        const operation = await this.createOperation(
          tx,
          'recipient_revision',
          actor,
          'CHANNEL_ORDER_MODIFIED',
          undefined,
          undefined,
          idempotencyKey,
          requestHash,
          before,
        );
        await tx
          .update(wmsTables.shipments)
          .set({ ...revision.update, lastUpdated: new Date() })
          .where(eq(wmsTables.shipments.id, shipmentId));
        await this.invariant.assertFulfillmentOrders(aggregate.fulfillmentOrderIds, tx);
        const after = this.snapshot(await this.loadAggregate(shipmentId, tx));
        await this.completeOperation(tx, operation.id, [{ shipmentId, role: 'target', before, after }]);
        await this.auditCommand(tx, actor, 'shipment.revise_recipient_from_channel', operation.id, 'CHANNEL_ORDER_MODIFIED', {
          shipmentId,
          salesOrderId,
          before,
          after,
        });
        return { response: { changed: true }, resourceType: 'shipment', resourceId: shipmentId, operationId: operation.id };
      },
      tx,
    );
  }
```

- [ ] **Step 4: 통과 확인** — Run: Step 2 명령 / Expected: PASS 6건. `npx jest apps/core/src/modules/fulfillment/services/shipment-planning` (유닛) 도 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/services
git commit -m "feat(fulfillment): 채널 변경용 박스 수령인 수정 — 배치 밖 planned 허용·합포장 거절 (#1016 5번 행)"
```

---

### Task 6: amendment 기록·supersede·대기 목록 API

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts`
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (`FULFILLMENT_SYSTEM_ACTOR_ID` export, `getCancelledQuantityByLine` 추가)
- Modify: `apps/core/src/modules/sales-order/controllers/sales-order-amendments.controller.ts`
- Create: `apps/core/src/modules/sales-order/dto/list-sales-order-amendments.dto.ts`
- Modify: `apps/core/src/modules/sales-order/dto/sales-order-amendment-response.dto.ts`
- Test: `apps/core/src/modules/sales-order/services/sales-order-amendments.channel.integration.spec.ts`

**Interfaces:**
- Consumes: `RecordedChannelDelta`, `CHANNEL_ORDER_MODIFIED_REASON` (Task 4), 컬럼 (Task 3)
- Produces:
  - `SalesOrderAmendmentsService.recordChannelAmendment(input: { id: string; salesOrderId: string; deltas: RecordedChannelDelta[]; occurredAt: Date; sourceEventId: string; salesChannel: string; externalOrderId: string }, tx: DbTx): Promise<void>` — `deltas` 가 비면 행을 쓰지 않고 supersede 만 한다
  - `SalesOrderAmendmentsService.list(query: { status?: AmendmentStatus; origin?: AmendmentOrigin; limit: number; before?: string }, tx?: DbTx): Promise<{ items: AmendmentListItem[]; nextBefore: string | null }>`
  - `SalesOrdersService.getCancelledQuantityByLine(salesOrderId: string, tx: DbTx): Promise<Map<string, number>>`
  - `export const FULFILLMENT_SYSTEM_ACTOR_ID` (sales-orders.service.ts)

- [ ] **Step 1: 실패 통합 테스트** — `sales-order-amendments.channel.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { ambientDbService } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { SalesOrderAmendmentsService } from './sales-order-amendments.service';
import type { RecordedChannelDelta } from '../channel-order-change/channel-order-change.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' };
const PENDING: RecordedChannelDelta = {
  type: 'add_product',
  channelOrderItemId: 'ci-9',
  channelProductId: null,
  quantity: 1,
  unitPrice: 1,
  outcome: 'pending',
  blockers: [{ code: 'OUT_OF_SCOPE' }],
};

describeIfDb('SalesOrderAmendmentsService 채널 기록·목록 (DB integration, rollback-only)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function salesOrder(tx: DbTx, status: 'pending' | 'cancelled' = 'pending') {
    const [so] = await tx
      .insert(wmsTables.salesOrders)
      .values({ channelOrderId: `IT-${randomUUID().slice(0, 8)}`, salesChannel: 'medusa', status, shippingAddress: ADDRESS, orderDate: new Date() })
      .returning();
    return so.id;
  }

  function record(service: SalesOrderAmendmentsService, salesOrderId: string, deltas: RecordedChannelDelta[], tx: DbTx) {
    const id = randomUUID();
    return service
      .recordChannelAmendment(
        { id, salesOrderId, deltas, occurredAt: new Date(), sourceEventId: `msg-${id}`, salesChannel: 'medusa', externalOrderId: 'ext' },
        tx,
      )
      .then(() => id);
  }

  it('pending 델타가 있으면 status=pending, 다음 채널 행이 오면 이전 pending 은 superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const first = await record(service, soId, [PENDING], tx);
      const second = await record(service, soId, [PENDING], tx);
      const rows = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, soId));
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(first)).toMatchObject({ origin: 'channel', status: 'superseded', supersededById: second });
      expect(byId.get(second)).toMatchObject({ origin: 'channel', status: 'pending', reasonCode: 'CHANNEL_ORDER_MODIFIED', amendmentKind: 'commercial' });
    });
  });

  it('델타가 비면 행을 쓰지 않고 이전 pending 만 superseded(대체 행 없음)', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const first = await record(service, soId, [PENDING], tx);
      await record(service, soId, [], tx);
      const rows = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, soId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first, status: 'superseded', supersededById: null });
    });
  });

  it('주소 델타만 있으면 fulfillment_only, 전부 applied 면 status=applied', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const soId = await salesOrder(tx);
      const id = await record(service, soId, [{ type: 'shipping_address_change', before: ADDRESS, after: { ...ADDRESS, detailAddress: '2' }, outcome: 'applied' }], tx);
      const [row] = await tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.id, id));
      expect(row).toMatchObject({ amendmentKind: 'fulfillment_only', status: 'applied' });
    });
  });

  it('대기 목록은 취소된 판매주문의 행을 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const service = new SalesOrderAmendmentsService(ambientDbService(tx));
      const open = await salesOrder(tx);
      const cancelled = await salesOrder(tx, 'cancelled');
      const visible = await record(service, open, [PENDING], tx);
      const hidden = await record(service, cancelled, [PENDING], tx);
      const page = await service.list({ status: 'pending', origin: 'channel', limit: 200 }, tx);
      const ids = page.items.map((item) => item.id);
      expect(ids).toContain(visible);
      expect(ids).not.toContain(hidden);
      expect(page.items.find((item) => item.id === visible)).toMatchObject({ salesChannel: 'medusa', salesOrderId: open });
    });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/sales-order/services/sales-order-amendments.channel.integration.spec.ts --runInBand` / Expected: FAIL

- [ ] **Step 3: 서비스 구현** — `sales-order-amendments.service.ts`:
  - import 에 `and, desc, eq, inArray, lt, ne, notInArray` (`drizzle-orm`), `RecordedChannelDelta`, `CHANNEL_ORDER_MODIFIED_REASON` 을 더한다
  - 파일 상단 상수 아래에 타입을 더한다:

```ts
export type AmendmentStatus = 'applied' | 'pending' | 'superseded';
export type AmendmentOrigin = 'channel' | 'operator';
export interface AmendmentListItem {
  id: string;
  salesOrderId: string;
  salesChannel: string;
  channelOrderId: string;
  displayOrderNo: string | null;
  origin: AmendmentOrigin;
  status: AmendmentStatus;
  deltas: unknown[];
  occurredAt: Date;
}
const HIDDEN_ORDER_STATUSES = ['cancelled', 'timeout'] as const;
```

  - 클래스에 메서드 둘을 더한다:

```ts
  /**
   * 채널 변경 한 건 = 한 행 (#1016 판단 6). 같은 판매주문의 이전 채널 pending 은 superseded —
   * diff 가 매번 판매주문과 새로 비교하므로 최신 행이 남은 차이를 전부 담는다. 델타가 비면 행을 쓰지 않는다.
   */
  async recordChannelAmendment(
    input: {
      id: string;
      salesOrderId: string;
      deltas: RecordedChannelDelta[];
      occurredAt: Date;
      sourceEventId: string;
      salesChannel: string;
      externalOrderId: string;
    },
    tx: DbTx,
  ): Promise<void> {
    const table = wmsTables.salesOrderAmendments;
    if (input.deltas.length > 0) {
      const pending = input.deltas.some((delta) => delta.outcome === 'pending');
      const [amendment] = await tx
        .insert(table)
        .values({
          id: input.id,
          salesOrderId: input.salesOrderId,
          amendmentKind: input.deltas.every((delta) => delta.type === 'shipping_address_change') ? 'fulfillment_only' : 'commercial',
          reasonCode: CHANNEL_ORDER_MODIFIED_REASON,
          deltas: input.deltas,
          metadata: { salesChannel: input.salesChannel, externalOrderId: input.externalOrderId },
          createdBy: null,
          occurredAt: input.occurredAt,
          origin: 'channel',
          status: pending ? 'pending' : 'applied',
          sourceEventId: input.sourceEventId,
        })
        .returning();
      await tx.insert(wmsTables.businessLinks).values({
        sourceType: SALES_ORDER_REF_TYPE,
        sourceId: input.salesOrderId,
        sourceExternalRef: null,
        targetType: AMENDMENT_REF_TYPE,
        targetId: amendment.id,
        targetExternalRef: null,
        relationName: 'opened_amendment',
        metadata: { amendmentKind: amendment.amendmentKind, origin: 'channel', status: amendment.status, deltaTypes: input.deltas.map((delta) => delta.type) },
        occurredAt: amendment.occurredAt,
      });
    }
    await tx
      .update(table)
      .set({ status: 'superseded', supersededById: input.deltas.length > 0 ? input.id : null, updatedAt: new Date() })
      .where(
        and(
          eq(table.salesOrderId, input.salesOrderId),
          eq(table.origin, 'channel'),
          eq(table.status, 'pending'),
          ne(table.id, input.id),
        ),
      );
  }

  /** 대기 목록(#1016 5번 행 화면). 끝난 판매주문의 행은 뺀다 — Medusa 취소 직전 스냅샷이 남긴 pending 이 거기 남는다. */
  async list(
    query: { status?: AmendmentStatus; origin?: AmendmentOrigin; limit: number; before?: string },
    tx?: DbTx,
  ): Promise<{ items: AmendmentListItem[]; nextBefore: string | null }> {
    const db = tx ?? this.db.db;
    const table = wmsTables.salesOrderAmendments;
    const orders = wmsTables.salesOrders;
    const rows = await db
      .select({
        id: table.id,
        salesOrderId: table.salesOrderId,
        salesChannel: orders.salesChannel,
        channelOrderId: orders.channelOrderId,
        displayOrderNo: orders.displayOrderNo,
        origin: table.origin,
        status: table.status,
        deltas: table.deltas,
        occurredAt: table.occurredAt,
      })
      .from(table)
      .innerJoin(orders, eq(orders.id, table.salesOrderId))
      .where(
        and(
          query.status ? eq(table.status, query.status) : undefined,
          query.origin ? eq(table.origin, query.origin) : undefined,
          query.before ? lt(table.occurredAt, new Date(query.before)) : undefined,
          notInArray(orders.status, [...HIDDEN_ORDER_STATUSES]),
        ),
      )
      .orderBy(desc(table.occurredAt), desc(table.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({ ...row, deltas: Array.isArray(row.deltas) ? row.deltas : [] })),
      nextBefore: rows.length > query.limit ? page[page.length - 1].occurredAt.toISOString() : null,
    };
  }
```

  `inArray` 를 안 쓰면 import 에서 뺀다. `salesOrders.status` 컬럼 enum 에 `'timeout'` 이 없으면(`grep -n "orderStatusEnum\|salesOrderStatus" inventory.schema.ts`) `HIDDEN_ORDER_STATUSES` 를 그 enum 에 있는 값만으로 줄인다.

- [ ] **Step 4: `SalesOrdersService` 노출** — `sales-orders.service.ts`:
  - `const FULFILLMENT_SYSTEM_ACTOR_ID = …` 를 `export const` 로 바꾼다
  - `loadPriorPartialCancellationContext` 위에 공개 메서드를 더한다:

```ts
  /** 라인별 이미 취소된 수량 — 채널 변경 diff 의 «유효 수량» 기준(#1016 5번 행)이 취소 경로와 같은 계산을 쓰게 한다. */
  async getCancelledQuantityByLine(salesOrderId: string, tx: DbTx): Promise<Map<string, number>> {
    return (await this.loadPriorPartialCancellationContext(salesOrderId, tx)).cancelledByLine;
  }
```

- [ ] **Step 5: 컨트롤러·DTO** — `list-sales-order-amendments.dto.ts`:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class ListSalesOrderAmendmentsQueryDto {
  @ApiPropertyOptional({ enum: ['applied', 'pending', 'superseded'] })
  @IsOptional()
  @IsIn(['applied', 'pending', 'superseded'])
  status?: 'applied' | 'pending' | 'superseded';

  @ApiPropertyOptional({ enum: ['channel', 'operator'] })
  @IsOptional()
  @IsIn(['channel', 'operator'])
  origin?: 'channel' | 'operator';

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '이 시각보다 이전 행(다음 쪽 커서 = 응답의 nextBefore)' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}
```

  컨트롤러에 `@Get()` 을 `@Get(':id')` **위에** 더한다(`Query` import 추가):

```ts
  @Get()
  @ApiOperation({ summary: '정정 목록 — 반영 대기 변경 화면' })
  list(@Query() query: ListSalesOrderAmendmentsQueryDto) {
    return this.service.list({ status: query.status, origin: query.origin, limit: query.limit ?? 50, before: query.before });
  }
```

  `sales-order-amendment-response.dto.ts` 에 칸 넷을 더한다:

```ts
  @ApiProperty({ description: '변경을 만든 곳', enum: ['channel', 'operator'] })
  origin: string;

  @ApiProperty({ description: '적용 상태', enum: ['applied', 'pending', 'superseded'] })
  status: string;

  @ApiProperty({ description: '채널 이벤트 messageId', nullable: true })
  sourceEventId: string | null;

  @ApiProperty({ description: '이 행을 대체한 행', nullable: true })
  supersededById: string | null;
```

  `toResponse` 의 `deltas` 캐스트 위에 근거 주석을 단다: `// jsonb 의 모양은 쓰는 쪽이 보장한다 — 운영자 행은 DTO 검증, 채널 행은 RecordedChannelDelta(recordChannelAmendment).`

- [ ] **Step 6: 통과 확인** — Run: Step 2 명령 / Expected: PASS 4건. Run: `npm run type-check` / Expected: 0

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 채널 amendment 기록·supersede·대기 목록 API (#1016 5번 행)"
```

---

### Task 7: 채널 변경 반영 — Reader·Manager·Service·컨슈머

**Files:**
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-change-blockers.ts` (+ `.spec.ts`)
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts`
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.manager.ts`
- Create: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.service.ts`
- Modify: `apps/core/src/modules/sales-order/sales-order.module.ts` (providers)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (+ `.spec.ts`)
- Test: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.integration.spec.ts`

**Interfaces:**
- Consumes: Task 4 전부, `reviseRecipientFromChannel` (Task 5), `recordChannelAmendment`·`getCancelledQuantityByLine`·`FULFILLMENT_SYSTEM_ACTOR_ID` (Task 6), `SalesOrdersService.cancel(id, options, tx)`
- Produces:
  - `toAddressBlocker(error: unknown, shipmentId?: string): ChannelBlocker`, `errorDetail(error: unknown): string`
  - `ChannelOrderChangeService.handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx?: DbTx): Promise<void>`

- [ ] **Step 1: 사유 변환 실패 테스트** — `channel-change-blockers.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { errorDetail, toAddressBlocker } from './channel-change-blockers';

describe('toAddressBlocker', () => {
  it.each([
    ['SHIPMENT_ACTIVE_INVOICE', 'WAYBILL_ISSUED'],
    ['SHIPMENT_ACTIVE_WORK_ITEM', 'SHIPMENT_IN_BATCH'],
    ['SHIPMENT_CUSTODY_EXISTS', 'SHIPMENT_IN_BATCH'],
    ['SHIPMENT_RECIPIENT_INCOMPLETE', 'RECIPIENT_INCOMPLETE'],
    ['SHIPMENT_CONSOLIDATED', 'CONSOLIDATED_SHIPMENT'],
    ['SHIPMENT_REOPEN_REQUIRED', 'SHIPMENT_NOT_REVISABLE'],
  ])('%s → %s', (code, expected) => {
    expect(toAddressBlocker(new ConflictException({ code, message: 'm' }), 'sh-1')).toEqual({
      code: expected,
      shipmentId: 'sh-1',
      detail: 'm',
    });
  });

  it('코드 없는 예외는 SHIPMENT_NOT_REVISABLE', () => {
    expect(toAddressBlocker(new Error('boom'))).toEqual({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'boom' });
  });
});

describe('errorDetail', () => {
  it('Nest 예외의 message 를, 없으면 Error.message 를', () => {
    expect(errorDetail(new BadRequestException('이미 출고'))).toBe('이미 출고');
    expect(errorDetail(new ConflictException({ code: 'X', message: '짧음' }))).toBe('짧음');
    expect(errorDetail('문자열')).toBe('문자열');
  });
});
```

- [ ] **Step 2: 구현** — `channel-change-blockers.ts`:

```ts
import { HttpException } from '@nestjs/common';
import type { ChannelBlocker, ChannelBlockerCode } from './channel-order-change.types';

const ADDRESS_BLOCKER_BY_CODE: Record<string, ChannelBlockerCode> = {
  SHIPMENT_ACTIVE_INVOICE: 'WAYBILL_ISSUED',
  SHIPMENT_ACTIVE_WORK_ITEM: 'SHIPMENT_IN_BATCH',
  SHIPMENT_CUSTODY_EXISTS: 'SHIPMENT_IN_BATCH',
  SHIPMENT_RECIPIENT_INCOMPLETE: 'RECIPIENT_INCOMPLETE',
  SHIPMENT_CONSOLIDATED: 'CONSOLIDATED_SHIPMENT',
};

function responseField(error: unknown, field: 'code' | 'message'): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response !== 'object' || response === null || !(field in response)) return undefined;
  const value: unknown = Reflect.get(response, field);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(', ');
  return undefined;
}

export function errorDetail(error: unknown): string {
  return responseField(error, 'message') ?? (error instanceof Error ? error.message : String(error));
}

/** 박스 수령인 수정 거절(스펙 §7.1 표) → 화면 사유. */
export function toAddressBlocker(error: unknown, shipmentId?: string): ChannelBlocker {
  const code = responseField(error, 'code');
  return {
    code: (code && ADDRESS_BLOCKER_BY_CODE[code]) || 'SHIPMENT_NOT_REVISABLE',
    ...(shipmentId ? { shipmentId } : {}),
    detail: errorDetail(error),
  };
}
```

  Run: `npx jest apps/core/src/modules/sales-order/channel-order-change/channel-change-blockers.spec.ts` / Expected: PASS

- [ ] **Step 3: Reader** — `channel-order-change.reader.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../services/sales-orders.service';
import { toShippingAddress } from './channel-order-diff';
import type { EffectiveSalesOrder } from './channel-order-change.types';

const FINISHED_SHIPMENT_STATUSES = ['shipped', 'in_transit', 'delivered', 'canceled', 'superseded', 'failed'] as const;
const FINISHED_FULFILLMENT_STATUSES = ['shipped', 'completed', 'canceled'] as const;

@Injectable()
export class ChannelOrderChangeReader {
  constructor(private readonly salesOrders: SalesOrdersService) {}

  /** 판매주문을 FOR UPDATE 로 잡고 «지금 유효한» 모양으로 읽는다(스펙 §6). 없으면 null. */
  async lockEffectiveOrder(salesOrderId: string, tx: DbTx): Promise<EffectiveSalesOrder | null> {
    const [order] = await tx
      .select({
        id: wmsTables.salesOrders.id,
        status: wmsTables.salesOrders.status,
        shippingAddress: wmsTables.salesOrders.shippingAddress,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    if (!order) return null;
    const lines = await tx
      .select({
        id: wmsTables.salesOrderLines.id,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        channelProductId: wmsTables.salesOrderLines.channelProductId,
        quantity: wmsTables.salesOrderLines.quantity,
        unitPrice: wmsTables.salesOrderLines.unitPrice,
      })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId))
      .orderBy(asc(wmsTables.salesOrderLines.id));
    const cancelled = await this.salesOrders.getCancelledQuantityByLine(salesOrderId, tx);
    return {
      id: order.id,
      status: order.status,
      shippingAddress: toShippingAddress(order.shippingAddress),
      lines: lines.map((line) => ({
        id: line.id,
        channelOrderItemId: line.channelOrderItemId,
        channelProductId: line.channelProductId,
        effectiveQuantity: Math.max(0, line.quantity - (cancelled.get(line.id) ?? 0)),
        unitPrice: line.unitPrice,
      })),
    };
  }

  /** 아직 떠나지 않은 박스(id 순 — 잠금 순서). */
  async remainingShipmentIds(salesOrderId: string, tx: DbTx): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
      .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId))
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          notInArray(wmsTables.shipments.status, [...FINISHED_SHIPMENT_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.shipments.id));
    return rows.map((row) => row.id);
  }

  /** 공급처에 이미 넘어간 직배가 있는가 — 주소를 바꿔도 따라가지 못한다. */
  async hasDropShipInProgress(salesOrderId: string, tx: DbTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id })
      .from(wmsTables.fulfillmentOrders)
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship'),
          isNotNull(wmsTables.fulfillmentOrders.directShipStatus),
          notInArray(wmsTables.fulfillmentOrders.status, [...FINISHED_FULFILLMENT_STATUSES]),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** 이 취소가 박스 쪽에서 대기(CANCEL_REPLAN_PENDING·이탈 대기)로 끝났는가. */
  async cancellationLeftPendingShipment(salesOrderId: string, sourceEventId: string, tx: DbTx): Promise<boolean> {
    const rows = await tx
      .select({ effects: wmsTables.salesOrderCancellations.effects })
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          sql`${wmsTables.salesOrderCancellations.metadata}->>'sourceEventId' = ${sourceEventId}`,
        ),
      );
    return rows.some((row) =>
      (Array.isArray(row.effects) ? row.effects : []).some((effect: unknown) => {
        if (typeof effect !== 'object' || effect === null) return false;
        const metadata: unknown = Reflect.get(effect, 'metadata');
        return (
          Reflect.get(effect, 'type') === 'shipment_outstanding_cancellation' &&
          typeof metadata === 'object' &&
          metadata !== null &&
          Reflect.get(metadata, 'operationStatus') === 'pending'
        );
      }),
    );
  }

  async updateOrderAddress(salesOrderId: string, address: EffectiveSalesOrder['shippingAddress'], tx: DbTx): Promise<void> {
    await tx
      .update(wmsTables.salesOrders)
      .set({ shippingAddress: address, updatedAt: new Date() })
      .where(eq(wmsTables.salesOrders.id, salesOrderId));
    await tx
      .update(wmsTables.fulfillmentOrders)
      .set({ shippingAddress: address, updatedAt: new Date() })
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          notInArray(wmsTables.fulfillmentOrders.status, [...FINISHED_FULFILLMENT_STATUSES]),
        ),
      );
  }
}
```

  `fulfillmentOrders.updatedAt` 칸 이름을 `grep -n "export const fulfillmentOrders = " -A40 inventory.schema.ts` 로 확인하고 다르면 맞춘다(`lastUpdated` 등). `inArray` 는 안 쓰면 import 에서 뺀다. `updateOrderAddress` 는 쓰기라 Manager 몫이지만 같은 테이블 쿼리를 한 곳에 모으려고 Reader 에 둔다 — 레이어 규칙상 어긋나면 Manager 의 private 메서드로 옮긴다(동작 동일).

- [ ] **Step 4: Manager** — `channel-order-change.manager.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { ShipmentPlanningService } from '../../fulfillment/services/shipment-planning.service';
import { FULFILLMENT_SYSTEM_ACTOR_ID, SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { ChannelOrderChangeReader } from './channel-order-change.reader';
import { diffChannelSnapshot, isDecrease, removesAllLines } from './channel-order-diff';
import { errorDetail, toAddressBlocker } from './channel-change-blockers';
import {
  CHANNEL_ORDER_MODIFIED_REASON,
  ChannelBlocker,
  ChannelDelta,
  EffectiveSalesOrder,
  QuantityCorrectionDelta,
  RecordedChannelDelta,
  ShippingAddressChangeDelta,
} from './channel-order-change.types';

const CHANNEL_ACTOR = { id: FULFILLMENT_SYSTEM_ACTOR_ID, roles: ['master'] };

/** savepoint 를 되돌리려고 던지는 표지. 밖으로 새지 않는다. */
class Refused extends Error {
  constructor(readonly blocker: ChannelBlocker) {
    super(blocker.code);
  }
}

@Injectable()
export class ChannelOrderChangeManager {
  constructor(
    private readonly reader: ChannelOrderChangeReader,
    private readonly salesOrders: SalesOrdersService,
    private readonly amendments: SalesOrderAmendmentsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx: DbTx): Promise<void> {
    const order = await this.reader.lockEffectiveOrder(salesOrderId, tx);
    if (!order) throw new Error(`Sales order ${salesOrderId} vanished after resolve`);
    const deltas = diffChannelSnapshot(order, payload.snapshot);
    const amendmentId = randomUUID();
    const allRemoved = removesAllLines(order, deltas);
    const recorded: RecordedChannelDelta[] = [];
    for (const delta of deltas) {
      recorded.push(await this.settle(order, delta, { amendmentId, allRemoved, occurredAt: payload.modifiedAt }, tx));
    }
    await this.amendments.recordChannelAmendment(
      {
        id: amendmentId,
        salesOrderId,
        deltas: recorded,
        occurredAt: new Date(payload.modifiedAt),
        sourceEventId,
        salesChannel: payload.salesChannel,
        externalOrderId: payload.externalOrderId,
      },
      tx,
    );
  }

  private async settle(
    order: EffectiveSalesOrder,
    delta: ChannelDelta,
    ctx: { amendmentId: string; allRemoved: boolean; occurredAt: string },
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    if (delta.type === 'shipping_address_change') return this.tryAddress(order, delta, ctx.amendmentId, tx);
    if (isDecrease(delta)) {
      if (ctx.allRemoved) return { ...delta, outcome: 'pending', blockers: [{ code: 'ALL_LINES_REMOVED' }] };
      return this.tryDecrease(order, delta, ctx, tx);
    }
    if (delta.type === 'unmatched_line') return { ...delta, outcome: 'pending', blockers: [{ code: 'LINE_IDENTITY_MISSING' }] };
    return { ...delta, outcome: 'pending', blockers: [{ code: 'OUT_OF_SCOPE' }] };
  }

  /** 스펙 §7.1 — 판매주문·출고지시·남은 박스를 한 savepoint 에서. 하나라도 거절되면 전부 되돌린다. */
  private async tryAddress(
    order: EffectiveSalesOrder,
    delta: ShippingAddressChangeDelta,
    amendmentId: string,
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    const planning = this.moduleRef.get(ShipmentPlanningService, { strict: false });
    const refusal = await this.attempt(tx, async (sp) => {
      if (await this.reader.hasDropShipInProgress(order.id, sp)) {
        throw new Refused({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'drop_ship already handed to supplier' });
      }
      await this.reader.updateOrderAddress(order.id, delta.after, sp);
      for (const shipmentId of await this.reader.remainingShipmentIds(order.id, sp)) {
        try {
          await planning.reviseRecipientFromChannel(
            shipmentId,
            order.id,
            delta.after,
            `channel-order-change:${amendmentId}:${shipmentId}`,
            CHANNEL_ACTOR,
            sp,
          );
        } catch (error) {
          throw new Refused(toAddressBlocker(error, shipmentId));
        }
      }
    });
    return refusal ? { ...delta, outcome: 'pending', blockers: [refusal] } : { ...delta, outcome: 'applied' };
  }

  /** 스펙 §7.2 — 기존 취소를 그대로 시도. 그 자리에서 끝나지 않으면 되돌린다(R1: 새 대기를 만들지 않는다). */
  private async tryDecrease(
    order: EffectiveSalesOrder,
    delta: QuantityCorrectionDelta,
    ctx: { amendmentId: string; occurredAt: string },
    tx: DbTx,
  ): Promise<RecordedChannelDelta> {
    const sourceEventId = `${ctx.amendmentId}:${delta.salesOrderLineId}`;
    const refusal = await this.attempt(tx, async (sp) => {
      try {
        await this.salesOrders.cancel(
          order.id,
          {
            lines: [{ salesOrderLineId: delta.salesOrderLineId, quantity: delta.quantityBefore - delta.correctedQuantity }],
            cancelledBy: 'channel',
            reasonCode: CHANNEL_ORDER_MODIFIED_REASON,
            occurredAt: ctx.occurredAt,
            // walletRefund 를 넘기지 않는다 — 채널 변경의 환불은 채널이 한다(스펙 R6).
            metadata: { sourceEventId },
          },
          sp,
        );
      } catch (error) {
        throw new Refused({ code: 'CANCEL_NOT_IMMEDIATE', detail: errorDetail(error) });
      }
      if (await this.reader.cancellationLeftPendingShipment(order.id, sourceEventId, sp)) {
        throw new Refused({ code: 'CANCEL_NOT_IMMEDIATE', detail: 'shipment cancellation would wait' });
      }
    });
    return refusal ? { ...delta, outcome: 'pending', blockers: [refusal] } : { ...delta, outcome: 'applied' };
  }

  /** savepoint 하나. 거절이면 되돌리고 사유를, 성공이면 null 을. 예상 밖 예외는 그대로 던진다(스펙 §11). */
  private async attempt(tx: DbTx, fn: (sp: DbTx) => Promise<void>): Promise<ChannelBlocker | null> {
    try {
      await tx.transaction(async (sp) => fn(sp));
      return null;
    } catch (error) {
      if (error instanceof Refused) return error.blocker;
      throw error;
    }
  }
}
```

  `tx.transaction` 콜백 인자 타입이 `DbTx` 로 안 맞으면(타입체크 에러), 콜백 인자에 타입을 붙이지 말고 `fn(sp)` 가 받는지 확인한다. 안 받으면 `inventory.schema` 에 `DbTx` 정의를 보고 그 정의가 `PgTransaction<…>` 이면 같은 제네릭으로 맞는다 — `as` 로 덮지 말고 에러 메시지를 그대로 보고한다.

- [ ] **Step 5: Service 와 모듈** — `channel-order-change.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { ChannelOrderChangeManager } from './channel-order-change.manager';

/** 수집 뒤 채널 변경을 판매주문에 반영한다(#1016 5번 행). */
@Injectable()
export class ChannelOrderChangeService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly manager: ChannelOrderChangeManager,
  ) {}

  handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx?: DbTx): Promise<void> {
    return this.db.run((trx) => this.manager.handle(salesOrderId, payload, sourceEventId, trx), tx);
  }
}
```

  `sales-order.module.ts` providers 에 `ChannelOrderChangeReader`, `ChannelOrderChangeManager`, `ChannelOrderChangeService` 를 더한다.

- [ ] **Step 6: 컨슈머 실패 테스트** — `order-events.consumer.spec.ts`:
  - `makeMocks` 반환에 `channelOrderChanges: { handle: jest.fn().mockResolvedValue(undefined) }` 를, `makeConsumer` 에 6번째 인자 `mocks.channelOrderChanges as any` 를 더한다(`Mocks` 타입에도 필드 추가)
  - Task 1 에서 고친 OrderModified 테스트를 아래로 교체:

```ts
  it('OrderModified 는 채널 키로 판매주문을 찾아 한 번만 반영을 맡긴다', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    const payload: OrderModifiedPayload = {
      orderId: 'wms-1',
      salesChannel: 'medusa',
      externalOrderId: 'ext-1',
      modifiedAt: new Date().toISOString(),
      snapshot: { lines: [], shippingAddress: { recipientName: 'R', phone: '', postalCode: '', roadAddress: '', detailAddress: '' } },
    };
    const envelope = { messageId: 'modified-msg-1', correlationId: 'c' } as EnvelopeOf<typeof ORDER_STREAM, 'OrderModified'>;
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue({ id: 'so-1' });

    await consumer.handleOrderModified(payload, envelope);

    expect(mocks.salesOrders.findByChannelOrderId).toHaveBeenCalledWith('medusa', 'ext-1', expect.anything());
    expect(mocks.channelOrderChanges.handle).toHaveBeenCalledWith('so-1', payload, 'modified-msg-1', expect.anything());
    expect(mocks.txInserts[0].values).toMatchObject({ eventId: 'modified-msg-1', orderId: 'so-1', eventType: 'ORDER_MODIFIED' });
  });

  it('OrderModified 가 판매주문을 못 찾으면 NotFound(비재시도) — 생성보다 변경이 먼저 올 수 없다(같은 파티션)', async () => {
    const mocks = makeMocks();
    const consumer = makeConsumer(mocks);
    mocks.salesOrders.findByChannelOrderId.mockResolvedValue(null);
    await expect(
      consumer.handleOrderModified(
        { orderId: 'w', salesChannel: 'naver', externalOrderId: 'x', modifiedAt: new Date().toISOString(), snapshot: { lines: [], shippingAddress: { recipientName: 'R', phone: '', postalCode: '', roadAddress: '', detailAddress: '' } } },
        { messageId: 'm', correlationId: 'c' } as EnvelopeOf<typeof ORDER_STREAM, 'OrderModified'>,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(mocks.channelOrderChanges.handle).not.toHaveBeenCalled();
  });
```

  (`NotFoundException` import 가 없으면 `@nestjs/common` 에서 더한다. `mocks.txInserts` 는 fakeTx 의 `insert` 로 쌓인다.)

- [ ] **Step 7: 컨슈머 구현** — `order-events.consumer.ts`: 생성자 마지막에 `private readonly channelOrderChanges: ChannelOrderChangeService` 를 더하고(import 추가), `handleOrderModified` 를 교체:

```ts
  /**
   * 수집 뒤 채널 변경 (#1016 5번 행). 판정·반영은 `ChannelOrderChangeService` 가 한다.
   * 공동현관 비밀번호는 이 이벤트에 없다 — «없음»을 «지워라»로 읽지 않는다(core 가 정본).
   */
  @On(ORDER_STREAM, 'OrderModified')
  @RetryPolicy({ nonRetryableErrors: [NotFoundException] })
  async handleOrderModified(
    @EventPayload() payload: EventPayloadOf<typeof ORDER_STREAM, 'OrderModified'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof ORDER_STREAM, 'OrderModified'>,
  ) {
    this.logger.log(`[OrderModified] Received: ${payload.salesChannel}/${payload.externalOrderId}`, {
      correlationId: envelope.correlationId,
    });
    await this.dbService.run(async (tx) => {
      const salesOrderId = await this.resolveSalesOrderId(payload, tx);
      if (!salesOrderId) {
        throw new NotFoundException(`Sales order ${payload.salesChannel}/${payload.externalOrderId} not found for OrderModified`);
      }
      const alreadyProcessed = await this.checkAndRecordEvent(envelope.messageId, salesOrderId, 'ORDER_MODIFIED', payload, tx);
      if (alreadyProcessed) return;
      await this.channelOrderChanges.handle(salesOrderId, payload, envelope.messageId, tx);
    });
  }
```

  Run: `npx jest apps/core/src/modules/sales-order` / Expected: PASS

- [ ] **Step 8: 통합 실패 테스트** — `channel-order-change.integration.spec.ts`. 배선 헬퍼부터:

```ts
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeDb,
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../outbox/__support__/outbox-publisher.factory';
import { PoliciesService } from '../services/policies.service';
import { SalesOrdersService } from '../services/sales-orders.service';
import { SalesOrderAmendmentsService } from '../services/sales-order-amendments.service';
import { ChannelOrderChangeReader } from './channel-order-change.reader';
import { ChannelOrderChangeManager } from './channel-order-change.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };
const NEXT = { ...ADDRESS, roadAddress: '부산', detailAddress: '202' };

function wire(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    new PoliciesService(dbService),
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  const amendments = new SalesOrderAmendmentsService(dbService);
  const reader = new ChannelOrderChangeReader(salesOrders);
  const manager = new ChannelOrderChangeManager(reader, salesOrders, amendments, { get: () => outbound.planning } as never);
  return { logistics, outbound, salesOrders, manager };
}

/** 판매주문(채널 라인 2개, 수량 2·1) → FO → draft 박스. withFo=false 면 FO 를 만들지 않는다. */
async function seedOrder(tx: DbTx, w: ReturnType<typeof wire>, opts: { withFo: boolean }) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const lines = [
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 2 },
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 1 },
  ];
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({ channelOrderId: `ext-${randomUUID().slice(0, 8)}`, salesChannel: 'medusa', status: 'confirmed', shippingAddress: ADDRESS, orderDate: new Date() })
    .returning();
  const lineIds: string[] = [];
  for (const line of lines) {
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [row] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({ salesOrderId: so.id, variantId, productName: 'IT', quantity: line.qty, unitPrice: 1000, channelOrderItemId: line.item, channelProductId: `cp-${line.item}` })
      .returning();
    lineIds.push(row.id);
  }
  if (opts.withFo) await w.logistics.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
  return { salesOrderId: so.id, externalOrderId: so.channelOrderId, lines, lineIds };
}

function payload(seed: Awaited<ReturnType<typeof seedOrder>>, over: Partial<OrderModifiedPayload['snapshot']>): OrderModifiedPayload {
  return {
    orderId: randomUUID(),
    salesChannel: 'medusa',
    externalOrderId: seed.externalOrderId,
    modifiedAt: new Date().toISOString(),
    snapshot: {
      shippingAddress: ADDRESS,
      lines: seed.lines.map((line) => ({ channelOrderItemId: line.item, channelProductId: `cp-${line.item}`, quantity: line.qty, unitPrice: 1000, cancelled: false })),
      ...over,
    },
  };
}

async function amendmentsOf(tx: DbTx, salesOrderId: string) {
  return tx.select().from(wmsTables.salesOrderAmendments).where(eq(wmsTables.salesOrderAmendments.salesOrderId, salesOrderId));
}

async function boxesOf(tx: DbTx, salesOrderId: string) {
  return tx
    .selectDistinct({ id: wmsTables.shipments.id, status: wmsTables.shipments.status, recipientSnapshot: wmsTables.shipments.recipientSnapshot })
    .from(wmsTables.shipments)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
    .innerJoin(wmsTables.fulfillmentOrderItems, eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId))
    .innerJoin(wmsTables.fulfillmentOrders, eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId))
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
}
```

  그리고 시나리오:

```ts
describeIfDb('채널 변경 반영 (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('배송지 — 판매주문·출고지시·draft 박스에 한 번에 반영되고 applied 행 하나', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(NEXT);
      const fos = await tx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.salesOrderId, seed.salesOrderId));
      expect(fos.every((fo) => JSON.stringify(fo.shippingAddress) === JSON.stringify(NEXT))).toBe(true);
      expect((await boxesOf(tx, seed.salesOrderId)).every((box) => JSON.stringify(box.recipientSnapshot) === JSON.stringify(NEXT))).toBe(true);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ origin: 'channel', status: 'applied', amendmentKind: 'fulfillment_only' });
    });
  });

  it('배송지 — 박스에 살아 있는 송장이 있으면 판매주문 주소도 그대로이고 WAYBILL_ISSUED 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      const [box] = await boxesOf(tx, seed.salesOrderId);
      await tx.insert(wmsTables.waybills).values({
        shipmentId: box.id, source: 'manual', carrier: 'HANJIN', status: 'registered', trackingNo: `T${Date.now()}`, manifestVersion: 1, recipientHash: 'x',
      });
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [so] = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      expect(so.shippingAddress).toEqual(ADDRESS);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('pending');
      expect(row.deltas).toEqual([expect.objectContaining({ type: 'shipping_address_change', outcome: 'pending', blockers: [expect.objectContaining({ code: 'WAYBILL_ISSUED', shipmentId: box.id })] })]);
    });
  });

  it('배송지 — 진행 중인 직배가 있으면 SHIPMENT_NOT_REVISABLE 대기', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ fulfillmentMode: 'drop_ship', directShipStatus: 'ordered' })
        .where(eq(wmsTables.fulfillmentOrders.salesOrderId, seed.salesOrderId));
      await w.manager.handle(seed.salesOrderId, payload(seed, { shippingAddress: NEXT }), `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.deltas).toEqual([expect.objectContaining({ blockers: [expect.objectContaining({ code: 'SHIPMENT_NOT_REVISABLE' })] })]);
    });
  });

  it('감소 — 출고지시 전이면 반영되고 취소 행에 walletRefund 효과가 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const p = payload(seed, {});
      p.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      const [row] = await amendmentsOf(tx, seed.salesOrderId);
      expect(row.status).toBe('applied');
      expect(await w.salesOrders.getCancelledQuantityByLine(seed.salesOrderId, tx)).toEqual(new Map([[seed.lineIds[0], 1]]));
      const cancellations = await tx.select().from(wmsTables.salesOrderCancellations).where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(JSON.stringify(cancellations.map((c) => c.effects))).not.toContain('wallet_refund');
    });
  });

  it('감소 — draft 박스면 즉시 반영, planned 박스면 되돌리고 CANCEL_NOT_IMMEDIATE(박스 무변경)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: true });
      const first = payload(seed, {});
      first.snapshot.lines[0].quantity = 1;
      await w.manager.handle(seed.salesOrderId, first, `m-${randomUUID()}`, tx);
      expect((await amendmentsOf(tx, seed.salesOrderId))[0].status).toBe('applied');

      for (const box of await boxesOf(tx, seed.salesOrderId)) {
        await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, box.id));
      }
      const second = payload(seed, {});
      second.snapshot.lines[0].quantity = 1;
      second.snapshot.lines[1].quantity = 0;
      await w.manager.handle(seed.salesOrderId, second, `m-${randomUUID()}`, tx);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      const latest = rows.find((row) => row.status === 'pending');
      expect(latest?.deltas).toEqual([expect.objectContaining({ salesOrderLineId: seed.lineIds[1], outcome: 'pending', blockers: [expect.objectContaining({ code: 'CANCEL_NOT_IMMEDIATE' })] })]);
      const boxes = await boxesOf(tx, seed.salesOrderId);
      expect(boxes.every((box) => box.status === 'planned')).toBe(true);
    });
  });

  it('전 라인 0 이면 ALL_LINES_REMOVED, 증가·추가는 OUT_OF_SCOPE', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await w.manager.handle(seed.salesOrderId, payload(seed, { lines: [] }), `m-${randomUUID()}`, tx);
      const grow = payload(seed, {});
      grow.snapshot.lines[0].quantity = 5;
      grow.snapshot.lines.push({ channelOrderItemId: 'ci-new', channelProductId: 'cp-new', quantity: 1, unitPrice: 1, cancelled: false });
      await w.manager.handle(seed.salesOrderId, grow, `m-${randomUUID()}`, tx);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      const superseded = rows.find((row) => row.status === 'superseded');
      const pending = rows.find((row) => row.status === 'pending');
      expect(JSON.stringify(superseded?.deltas)).toContain('ALL_LINES_REMOVED');
      expect(pending?.deltas).toEqual([
        expect.objectContaining({ type: 'quantity_correction', blockers: [{ code: 'OUT_OF_SCOPE' }] }),
        expect.objectContaining({ type: 'add_product', blockers: [{ code: 'OUT_OF_SCOPE' }] }),
      ]);
    });
  });

  it('lifecycle 취소가 먼저 적용된 라인을 cancelled 로 실은 스냅샷은 다시 줄이지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      await w.salesOrders.cancel(seed.salesOrderId, { lines: [{ salesOrderLineId: seed.lineIds[1], quantity: 1 }], cancelledBy: 'naver', metadata: { sourceEventId: `lc-${randomUUID()}` } }, tx);
      const p = payload(seed, {});
      p.snapshot.lines[1].cancelled = true;
      await w.manager.handle(seed.salesOrderId, p, `m-${randomUUID()}`, tx);
      expect(await amendmentsOf(tx, seed.salesOrderId)).toEqual([]);
      expect(await w.salesOrders.getCancelledQuantityByLine(seed.salesOrderId, tx)).toEqual(new Map([[seed.lineIds[1], 1]]));
    });
  });

  it('실질 차이 0 이면 새 행 없이 이전 pending 만 superseded', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wire(tx);
      const seed = await seedOrder(tx, w, { withFo: false });
      const grow = payload(seed, {});
      grow.snapshot.lines[0].quantity = 9;
      await w.manager.handle(seed.salesOrderId, grow, `m-${randomUUID()}`, tx);
      await w.manager.handle(seed.salesOrderId, payload(seed, {}), `m-${randomUUID()}`, tx);
      const rows = await amendmentsOf(tx, seed.salesOrderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'superseded', supersededById: null });
    });
  });
});
```

  `directShipStatus` 의 enum 값은 `grep -n "directShipStatusEnum" -A8 inventory.schema.ts` 로 확인해 실제 값 하나로 바꾼다. 합포장 시나리오(Review Focus 3)는 Task 5 의 `SHIPMENT_CONSOLIDATED` 거절 + 이 매니저의 «거절이면 savepoint 전체 되돌림» 경로(송장 시나리오와 같은 경로)로 덮인다 — 같은 경로를 두 번 세우지 않는다.

- [ ] **Step 9: 실패 → 통과 확인** — Run: `dotenv -e apps/core/.env -- npx jest apps/core/src/modules/sales-order/channel-order-change --runInBand` / Expected: 먼저 실행하면 PASS 여야 한다(Step 2~7 이 구현을 이미 넣었다). 실패하면 실패 메시지를 보고 Manager·Reader 를 고친다 — 테스트 기대를 구현에 맞춰 낮추지 않는다. 특히 «planned 감소» 가 `applied` 로 나오면 `cancellationLeftPendingShipment` 가 effects 를 못 읽는 것이다(`metadata.operationStatus` 위치를 실제 행으로 확인)

- [ ] **Step 10: 게이트** — Run: `npm run type-check` / Expected: 0. Run: `npx jest --maxWorkers=2 apps/core/src/modules/sales-order apps/core/src/modules/fulfillment` / Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): OrderModified 를 판매주문에 반영 — savepoint 시도·대기 기록 (#1016 5번 행)"
```

---

### Task 8: admin-web — «반영 대기 변경» 탭과 주문 변경 기록

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.shape.ts` (+ `.spec.ts`)
- Create: `apps/admin-web/src/lib/api/domains/orders/sales-order-amendments.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/index.ts`
- Modify: `apps/admin-web/src/lib/services/orders/query-keys.ts`, `queries.ts`, `index.ts`
- Create: `apps/admin-web/src/features/mall/pending-changes/components/pending-changes-table/index.tsx`
- Modify: `apps/admin-web/src/features/mall/channel-listings/template/index.tsx` (탭)
- Modify: `apps/admin-web/src/features/order/history/components/table/index.tsx` (`BusinessTimelineModal`)

**Interfaces:**
- Consumes: `GET /sales-order-amendments?status=&origin=&limit=&before=` → `{ items, nextBefore }`, `GET /sales-orders/:id/amendments` → 배열 (Task 6)
- Produces: `toAmendmentPage(body: unknown): AmendmentPage`, `toAmendmentRecords(body: unknown): AmendmentRecord[]`, `summarizeDelta(delta: AmendmentDelta): string`, `blockerLabel(code: string): string`, `usePendingChannelChanges()`, `useSalesOrderAmendments(salesOrderId: string)`

- [ ] **Step 1: 실패 테스트** — `sales-order-amendments.shape.spec.ts`:

```ts
import { blockerLabel, summarizeDelta, toAmendmentPage, toAmendmentRecords } from './sales-order-amendments.shape';

describe('toAmendmentPage', () => {
  const page = { items: [{ id: 'a1', salesOrderId: 's1', salesChannel: 'medusa', channelOrderId: 'o1', displayOrderNo: '2332', origin: 'channel', status: 'pending', deltas: [], occurredAt: '2026-10-05T00:00:00.000Z' }], nextBefore: null };

  it('인터셉터가 벗긴 모양과 안 벗긴 모양을 모두 받는다', () => {
    expect(toAmendmentPage(page).items).toHaveLength(1);
    expect(toAmendmentPage({ success: true, data: page }).items).toHaveLength(1);
  });

  it('모양이 틀리면 빈 쪽 — 표가 조용히 깨지지 않게', () => {
    expect(toAmendmentPage(undefined)).toEqual({ items: [], nextBefore: null });
  });
});

describe('toAmendmentRecords', () => {
  it('배열 또는 { data: 배열 }', () => {
    expect(toAmendmentRecords([{ id: 'a' }])).toHaveLength(1);
    expect(toAmendmentRecords({ success: true, data: [{ id: 'a' }] })).toHaveLength(1);
    expect(toAmendmentRecords(null)).toEqual([]);
  });
});

describe('summarizeDelta', () => {
  it.each([
    [{ type: 'shipping_address_change', before: { roadAddress: '서울', detailAddress: '1' }, after: { roadAddress: '부산', detailAddress: '2' } }, '배송지 서울 1 → 부산 2'],
    [{ type: 'quantity_correction', channelOrderItemId: 'ci', quantityBefore: 2, correctedQuantity: 0 }, '라인 ci 제거 (2 → 0)'],
    [{ type: 'quantity_correction', channelOrderItemId: 'ci', quantityBefore: 2, correctedQuantity: 1 }, '라인 ci 수량 2 → 1'],
    [{ type: 'add_product', channelOrderItemId: 'ci', quantity: 3 }, '라인 ci 추가 ×3'],
    [{ type: 'replace_product', channelOrderItemId: 'ci', channelProductIdBefore: 'a', channelProductIdAfter: 'b' }, '라인 ci 상품 a → b'],
    [{ type: 'amount_correction', channelOrderItemId: 'ci', unitPriceBefore: 1000, unitPriceAfter: 900 }, '라인 ci 단가 1,000 → 900'],
    [{ type: 'unmatched_line' }, '채널 라인 id 없는 라인'],
    [{ type: 'mystery' }, 'mystery'],
  ])('%j', (delta, expected) => {
    expect(summarizeDelta(delta)).toBe(expected);
  });
});

describe('blockerLabel', () => {
  it('아는 코드는 한국어, 모르는 코드는 그대로', () => {
    expect(blockerLabel('WAYBILL_ISSUED')).toBe('송장 발급됨');
    expect(blockerLabel('NEW_CODE')).toBe('NEW_CODE');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test:admin-web -- sales-order-amendments.shape` / Expected: FAIL

- [ ] **Step 3: shape 구현** — `sales-order-amendments.shape.ts`:

```ts
// src/lib/api/domains/orders/sales-order-amendments.shape.ts
//
// 정정(amendment) 응답의 순수 정형화·문구 함수. admin-web 은 컴포넌트 테스트가 안 되므로
// 화면이 읽는 판정은 전부 여기서 하고 스펙으로 지킨다. 인터셉터가 `{ success, data }` 를 이미
// 벗기지만, 술어가 바뀌어도 화면이 조용히 비지 않게 두 모양을 다 받는다(order-collection-failures.shape 와 같은 이유).

export type AmendmentDelta = Record<string, unknown> & { type?: unknown };

export interface AmendmentRecord {
  id: string;
  salesOrderId: string;
  origin: string;
  status: string;
  deltas: AmendmentDelta[];
  occurredAt: string;
}

export interface AmendmentListItem extends AmendmentRecord {
  salesChannel: string;
  channelOrderId: string;
  displayOrderNo: string | null;
}

export interface AmendmentPage {
  items: AmendmentListItem[];
  nextBefore: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrap(body: unknown): unknown {
  return isRecord(body) && body.success === true && 'data' in body ? body.data : body;
}

export function toAmendmentPage(body: unknown): AmendmentPage {
  const value = unwrap(body);
  if (!isRecord(value) || !Array.isArray(value.items)) return { items: [], nextBefore: null };
  return {
    items: value.items.filter(isRecord) as unknown as AmendmentListItem[],
    nextBefore: typeof value.nextBefore === 'string' ? value.nextBefore : null,
  };
}

export function toAmendmentRecords(body: unknown): AmendmentRecord[] {
  const value = unwrap(body);
  return Array.isArray(value) ? (value.filter(isRecord) as unknown as AmendmentRecord[]) : [];
}

const number = new Intl.NumberFormat('ko-KR');

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function addressText(value: unknown): string {
  if (!isRecord(value)) return '';
  return [str(value.roadAddress), str(value.detailAddress)].filter(Boolean).join(' ');
}

export function summarizeDelta(delta: AmendmentDelta): string {
  const line = str(delta.channelOrderItemId);
  switch (delta.type) {
    case 'shipping_address_change':
      return `배송지 ${addressText(delta.before)} → ${addressText(delta.after)}`;
    case 'quantity_correction':
      return Number(delta.correctedQuantity) === 0
        ? `라인 ${line} 제거 (${str(delta.quantityBefore)} → 0)`
        : `라인 ${line} 수량 ${str(delta.quantityBefore)} → ${str(delta.correctedQuantity)}`;
    case 'add_product':
      return `라인 ${line} 추가 ×${str(delta.quantity)}`;
    case 'replace_product':
      return `라인 ${line} 상품 ${str(delta.channelProductIdBefore)} → ${str(delta.channelProductIdAfter)}`;
    case 'amount_correction':
      return `라인 ${line} 단가 ${number.format(Number(delta.unitPriceBefore))} → ${number.format(Number(delta.unitPriceAfter))}`;
    case 'unmatched_line':
      return '채널 라인 id 없는 라인';
    default:
      return str(delta.type);
  }
}

const BLOCKER_LABELS: Record<string, string> = {
  WAYBILL_ISSUED: '송장 발급됨',
  SHIPMENT_IN_BATCH: '출고 작업 중',
  SHIPMENT_NOT_REVISABLE: '박스 수정 불가',
  CONSOLIDATED_SHIPMENT: '합포장 박스',
  RECIPIENT_INCOMPLETE: '주소 불완전',
  CANCEL_NOT_IMMEDIATE: '즉시 취소 불가',
  ALL_LINES_REMOVED: '전 라인 제거',
  LINE_IDENTITY_MISSING: '라인 식별 불가',
  OUT_OF_SCOPE: '자동 반영 범위 밖',
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABELS[code] ?? code;
}

/** pending 델타의 사유 코드들. */
export function blockerCodes(delta: AmendmentDelta): string[] {
  return Array.isArray(delta.blockers)
    ? delta.blockers.flatMap((blocker) => (isRecord(blocker) && typeof blocker.code === 'string' ? [blocker.code] : []))
    : [];
}
```

  (`as unknown as` 두 곳은 «isRecord 로 객체임을 확인한 뒤 서버 계약 모양으로 읽는다»는 정형화 경계다 — 같은 파일 위쪽 주석이 근거다. admin-web 의 기존 shape 파일이 같은 방식인지 `grep -n "as unknown as" apps/admin-web/src/lib/api/domains/channel/order-collection-failures.shape.ts` 로 보고, 다르면 그 파일의 방식을 따른다.)

  Run: `npm run test:admin-web -- sales-order-amendments.shape` / Expected: PASS

- [ ] **Step 4: client·query** — `sales-order-amendments.client.ts`:

```ts
'use client';

// src/lib/api/domains/orders/sales-order-amendments.client.ts
// 정정 목록 — 응답 정형은 ./sales-order-amendments.shape 가 한다.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { toAmendmentPage, toAmendmentRecords } from './sales-order-amendments.shape';
import type { AmendmentPage, AmendmentRecord } from './sales-order-amendments.shape';

export const salesOrderAmendmentsClient = {
  list: async (params: { status?: string; origin?: string; limit?: number; before?: string }): Promise<AmendmentPage> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/sales-order-amendments`, { params });
    return toAmendmentPage(response.data);
  },
  listForOrder: async (salesOrderId: string): Promise<AmendmentRecord[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(salesOrderId)}/amendments`);
    return toAmendmentRecords(response.data);
  },
};
```

  `domains/orders/index.ts`: import 추가, `orders` 객체에 `amendments: salesOrderAmendmentsClient,`, 아래 export 목록에 `export { salesOrderAmendmentsClient } from './sales-order-amendments.client';`

  `query-keys.ts` 의 `orderQueryKeys` 에 (인자 있는 팩토리 — undefined 키 함정 회피):

```ts
  amendments: ['sales-order-amendments'] as const,
  amendmentsList: (params: { status: string; origin: string }) => ['sales-order-amendments', 'list', params] as const,
  orderAmendments: (salesOrderId: string) => ['sales-order-amendments', 'order', salesOrderId] as const,
```

  `queries.ts` 끝에:

```ts
// ===== 정정(채널 변경 반영 대기, #1016 5번 행) =====

export const usePendingChannelChanges = () => {
  const params = { status: 'pending', origin: 'channel' };
  return useQuery({
    queryKey: orderQueryKeys.amendmentsList(params),
    queryFn: () => orders.amendments.list({ ...params, limit: 200 }),
  });
};

export const useSalesOrderAmendments = (salesOrderId: string) => {
  return useQuery({
    queryKey: orderQueryKeys.orderAmendments(salesOrderId),
    queryFn: () => orders.amendments.listForOrder(salesOrderId),
    enabled: !!salesOrderId,
  });
};
```

  `lib/services/orders/index.ts` 의 export 목록에 둘을 더한다.

- [ ] **Step 5: 표 컴포넌트** — `pending-changes-table/index.tsx`:

```tsx
'use client';

// src/features/mall/pending-changes/components/pending-changes-table/index.tsx
// 채널에서 바뀌었는데 core 가 자동 반영하지 못한 변경(#1016 5번 행). 닫기(처리완료·무시)는 6번 행 몫이다.

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { usePendingChannelChanges } from '@/lib/services/orders';
import {
  blockerCodes,
  blockerLabel,
  summarizeDelta,
} from '@/lib/api/domains/orders/sales-order-amendments.shape';

export function PendingChangesTable() {
  const { data, isLoading } = usePendingChannelChanges();
  const rows = data?.items ?? [];

  return (
    <div className="px-4 pb-4">
      {data?.nextBefore && (
        <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          상위 {rows.length}건만 표시했습니다.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>채널</TableHead>
            <TableHead>주문번호</TableHead>
            <TableHead>변경</TableHead>
            <TableHead>막힌 이유</TableHead>
            <TableHead>변경시각</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">불러오는 중…</TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">반영 대기 중인 변경이 없습니다.</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const pending = row.deltas.filter((delta) => delta.outcome === 'pending');
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.salesChannel}</TableCell>
                  <TableCell className="font-mono text-xs">{row.displayOrderNo ?? row.channelOrderId}</TableCell>
                  <TableCell className="text-sm">
                    {pending.map((delta, index) => (
                      <div key={index}>{summarizeDelta(delta)}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {pending.map((delta, index) => (
                      <div key={index}>{blockerCodes(delta).map(blockerLabel).join(', ')}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(row.occurredAt).toLocaleString('ko-KR')}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: 탭** — `channel-listings/template/index.tsx`:
  - `type Tab = 'listings' | 'quarantine' | 'pending-changes';`
  - import `PendingChangesTable` from `@/features/mall/pending-changes/components/pending-changes-table`
  - `미매핑 주문` 버튼 바로 뒤에 같은 모양의 버튼(라벨 `반영 대기 변경`, `tab === 'pending-changes'`)
  - 끝의 `) : ( <QuarantineTable /> )` 를 `) : tab === 'quarantine' ? ( <QuarantineTable /> ) : ( <PendingChangesTable /> )` 로

- [ ] **Step 7: 주문 변경 기록** — `history/components/table/index.tsx` 의 `BusinessTimelineModal`:
  - import 에 `useSalesOrderAmendments` (`@/lib/services/orders`), `{ blockerCodes, blockerLabel, summarizeDelta }` (`@/lib/api/domains/orders/sales-order-amendments.shape`)
  - `const timeline = …` 아래: `const { data: amendments } = useSalesOrderAmendments(open && order ? order.orderId : '');`
  - 스크롤 영역(`<div className="flex max-h-[60vh] …">`) 안 맨 아래, 타임라인 분기 뒤에:

```tsx
          {(amendments ?? []).some((amendment) => amendment.origin === 'channel') && (
            <div className="mt-4 border-t px-1 pt-3">
              <p className="mb-2 text-sm font-medium">채널 변경</p>
              {(amendments ?? [])
                .filter((amendment) => amendment.origin === 'channel' && amendment.status !== 'superseded')
                .map((amendment) => (
                  <div key={amendment.id} className="mb-2 text-sm">
                    {amendment.deltas.map((delta, index) => (
                      <div key={index} className={delta.outcome === 'pending' ? 'text-amber-700' : 'text-muted-foreground'}>
                        {summarizeDelta(delta)}
                        {delta.outcome === 'pending' && ` · ${blockerCodes(delta).map(blockerLabel).join(', ')}`}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
```

- [ ] **Step 8: admin-web 게이트** — Run: `cd apps/admin-web && npx tsc --noEmit` / Expected: 0 errors. Run: `npm run test:admin-web` / Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/admin-web
git commit -m "feat(admin-web): 반영 대기 변경 탭과 주문 채널 변경 기록 (#1016 5번 행)"
```

---

### Task 9: 문서·최종 게이트

**Files:**
- Modify: `docs/adr/0016-post-acceptance-order-lifecycle-boundaries.md`

- [ ] **Step 1: ADR-0016** — «수집된 Medusa 상품/금액 변경은 격리» 문장을 찾아(`grep -n "격리\|quarantin" docs/adr/0016-post-acceptance-order-lifecycle-boundaries.md`) 바로 아래에 갱신 블록을 단다:

```markdown
> **2026-10-05 갱신 (#1016 5번 행):** 수집 뒤 채널 변경은 더 이상 channel-adapter 에서 격리하지 않는다. `OrderModified`(전체 스냅샷)로 core 에
> 전달되고, core 가 배송지(송장 발급 전)·수량 감소·라인 제거를 자동 반영하며 나머지는 `sales_order_amendments`(`origin=channel`,
> `status=pending`)로 남긴다. 수락된 라인을 제자리에서 고치지 않는다는 이 ADR 의 원칙은 그대로다 — 감소는 취소 기록으로, 주소는 정정 기록과
> 함께 반영된다. 설계: `docs/superpowers/specs/2026-10-05-channel-order-change-sync-design.md`
```

- [ ] **Step 2: 전체 게이트** — Run: `npm run type-check` / Expected: 0. Run: `npx jest --maxWorkers=2` / Expected: 실패 0. Run: `cd apps/admin-web && npx tsc --noEmit` / Expected: 0. Run: `npm run test:core:integration:local` / Expected: 이 PR 의 통합 스펙 3개 PASS(나머지 suite 가 develop 부터 빨간 것은 `git stash` 후 develop 에서 같은 명령으로 확인해 이 PR 이 만든 게 아님을 PR 본문에 적는다)

- [ ] **Step 3: Commit**

```bash
git add docs/adr/0016-post-acceptance-order-lifecycle-boundaries.md
git commit -m "docs(adr): ADR-0016 에 수집 뒤 채널 변경 반영을 갱신 (#1016 5번 행)"
```

- [ ] **Step 4: PR 본문에 적을 배포 메모** — 마이그레이션은 추가뿐 → `db:migrate` 후 `sst deploy`(expand 순서). 배포 전 라이브 `select count(*) from sales_order_amendments;`(0 기대). 배포 겹침 동안 옛 core 가 `OrderModified` 를 버릴 수 있음을 감수(스펙 R3). 배포 뒤 대기 탭이 비어 있는 것이 정상이다 — 기존 3,004건 격리는 PR 2 의 백필이 다시 흘린다
