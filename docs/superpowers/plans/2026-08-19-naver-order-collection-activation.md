# 네이버 주문 수집 개통 + 격리 큐 운영 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 스마트스토어 주문을 Core 판매주문으로 수집하고, 매핑이 없어 격리된 주문을 운영자가 화면에서 등록·재처리할 수 있게 한다.

**Architecture:** ADR-0031 의 `ChannelOrderSource` port 에 네이버 구현체를 채운다. 번역·식별·격리는 기존 공용 층(`ChannelOrderTranslator`, `OrderPollerOrchestrator`)이 그대로 처리한다. 취소는 `OrderCancelled` 계약에 라인 범위를 더해 Core 의 기존 부분취소 기구에 연결한다. 개통은 코드가 아니라 `sales_channels.is_active` 로 켠다.

**Tech Stack:** NestJS 11 · Drizzle · zod 4 · Jest(ts-jest) · Next.js(admin-web) · @tanstack/react-query

**Spec:** `docs/superpowers/specs/2026-08-19-naver-order-collection-activation-design.md`

## Global Constraints

- 계층 규칙: Controller → Service → Reader/Manager → Repository. Service 는 `HttpException`/drizzle 을 import 하지 않는다.
- 도메인 예외는 `@app/shared` 의 `NotFoundError`/`BadRequestError`/`ConflictError` 를 쓴다.
- `any`/`as` 캐스팅 금지 (문서화된 정당화 없이).
- 검증 게이트는 **0 이 기준선**이다: `npm run type-check` → 0, `npx jest --maxWorkers=2` → 실패 0 (`--maxWorkers=2` 없이 돌리면 OOM), `npm run test:admin-web` → 실패 0.
- 마이그레이션 **0건**. 이 계획의 어떤 태스크도 스키마를 바꾸지 않는다.
- 배포 순서: **Task 1–2(Core) → Task 3–7(channel-adapter) → Task 8 shadow → Task 9 → Task 10–13(admin-web) → 개통**. Core 선배포를 어기면 부분취소가 전체 취소로 실행된다.
- 커밋 메시지는 한국어 본문, 끝에 `Claude-Session:` 줄.
- admin-web 은 컴포넌트 테스트가 불가능하다. 판정 로직은 반드시 `.ts` 순수 함수로 분리해 `.spec.ts` 로 덮는다.

---

## File Structure

**Phase A — 취소 계약 (Core 선배포)**

| 파일 | 책임 |
|---|---|
| `packages/event-contracts/streams/orders.stream.ts` (수정) | `OrderCancelledPayload.cancelledLines?` + zod |
| `packages/event-contracts/streams/orders.stream.spec.ts` (신규) | 계약 zod 회귀 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (수정) | `findLineIdsByChannelOrderItemIds` 조회 |
| `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` (수정) | 채널 라인 → `salesOrderLineId` 해석 후 부분취소 위임 |

**Phase B — 네이버 source**

| 파일 | 책임 |
|---|---|
| `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts` (수정) | `ChannelOrderLineSnapshot.cancelled?` |
| `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts` (수정) | 살아있는 라인 vs 전 라인 분리 |
| `apps/channel-adapter/src/zods/naver/naver-core.zod.ts` (수정) | `LastChangedTypeSchema` |
| `apps/channel-adapter/src/zods/naver/naver.order.zod.ts` (수정) | 변경 피드 응답 + 상세 응답 스키마 |
| `apps/channel-adapter/src/adapters/naver/clients/naver-order.client.ts` (수정) | 조회 창 파라미터 + `more` 페이징 |
| `apps/channel-adapter/src/services/order-collection/naver-order-fields.ts` (신규) | **네이버 원어 필드 접근을 한 곳에 가둔다** (shadow 로 확정할 지점) |
| `apps/channel-adapter/src/services/order-collection/naver-order.source.ts` (신규) | 스냅샷 조립 |
| `apps/channel-adapter/src/adapter.module.ts` (수정) | provider 등록 |

**Phase E — 격리 큐 화면**

| 파일 | 책임 |
|---|---|
| `packages/domain-types/listing-resolution-cause.ts` (수정) | `AffectedLine.channelProductId?` |
| `apps/admin-web/src/features/mall/quarantine/guidance.ts` (신규) | 사유→조치·상태→재처리가능·결과→문구 **순수 함수** |
| `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.client.ts` (신규) | REST 클라이언트 |
| `apps/admin-web/src/lib/services/channel/{query-keys,queries,mutations}.ts` (신규) | react-query |
| `apps/admin-web/src/features/mall/quarantine/components/*` (신규) | 목록·상세 UI |

---

## Phase A — 취소 계약 (Core 선배포)

### Task 1: `OrderCancelled` 에 라인 범위를 더한다

**Files:**
- Modify: `packages/event-contracts/streams/orders.stream.ts:118-143` (interface), `:279-300` (zod)
- Test: `packages/event-contracts/streams/orders.stream.spec.ts` (신규)

**Interfaces:**
- Produces: `OrderCancelledPayload.cancelledLines?: Array<{ channelOrderItemId: string; quantity: number }>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/event-contracts/streams/orders.stream.spec.ts`:

```ts
import { ORDER_STREAM } from './orders.stream';

const base = {
  orderId: 'ord_1',
  reason: 'CUSTOMER_REQUEST' as const,
  cancelledBy: 'naver',
  cancelledAt: '2026-08-19T00:00:00.000Z',
  refundRequired: true,
};

describe('OrderCancelled 계약', () => {
  const schema = ORDER_STREAM.events.OrderCancelled.schema;

  it('cancelledLines 없이도 통과한다 (전체 취소)', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('cancelledLines 가 있으면 통과한다 (부분 취소)', () => {
    const result = schema.safeParse({
      ...base,
      cancelledLines: [{ channelOrderItemId: '2026081900001', quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it('빈 배열은 거부한다 — 전체 취소는 필드를 생략해서 표현한다', () => {
    expect(schema.safeParse({ ...base, cancelledLines: [] }).success).toBe(false);
  });

  it('수량 0 이하를 거부한다', () => {
    const result = schema.safeParse({
      ...base,
      cancelledLines: [{ channelOrderItemId: '2026081900001', quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 packages/event-contracts/streams/orders.stream.spec.ts`
Expected: FAIL — 빈 배열/수량 0 케이스가 통과해버린다 (스키마에 필드가 없어 무시되므로).

- [ ] **Step 3: 계약을 고친다**

`orders.stream.ts` 의 `OrderCancelledPayload` 에 추가 (`stockRestorationResults` 위):

```ts
  /**
   * 부분 취소 범위 (네이버 개통). **생략 = 전체 취소** 이며, 이는 Core 의
   * `CancelSalesOrderDto.lines` 유무 규칙과 같은 축이다 (`sales-orders.service.ts:440`).
   * 값은 채널이 소유한 라인 식별자이고, Core 가 `sales_order_lines.channel_order_item_id`
   * 로 자기 PK 를 찾는다. 선택 필드라 이 필드를 모르는 옛 메시지도 계속 통과한다.
   */
  cancelledLines?: Array<{ channelOrderItemId: string; quantity: number }>;
```

`OrderCancelledSchema` 에 추가 (`stockRestorationResults` 위):

```ts
  cancelledLines: z
    .array(
      z.object({
        channelOrderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .optional(),
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 packages/event-contracts/streams/orders.stream.spec.ts`
Expected: PASS (4건)

- [ ] **Step 5: 커밋**

```bash
git add packages/event-contracts/streams/orders.stream.ts packages/event-contracts/streams/orders.stream.spec.ts
git commit -m "feat(contracts): OrderCancelled 에 부분취소 라인 범위를 더한다"
```

---

### Task 2: Core 소비자가 부분취소를 위임한다

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (조회 메서드 추가)
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts:147-196`
- Test: `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`

**Interfaces:**
- Consumes: `OrderCancelledPayload.cancelledLines` (Task 1)
- Produces: `SalesOrdersService.findLineIdsByChannelOrderItemIds(salesOrderId: string, channelOrderItemIds: string[], tx: DbTx): Promise<Map<string, string>>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`order-events.consumer.spec.ts` 의 `describe('handleOrderCancelled')` 안에 추가 (기존 mock 헬퍼를 그대로 쓴다):

```ts
  it('cancelledLines 가 있으면 채널 라인 ID 를 salesOrderLineId 로 바꿔 부분취소로 넘긴다', async () => {
    salesOrdersService.findByChannelOrderId.mockResolvedValue({ id: 'so-1' });
    salesOrdersService.findLineIdsByChannelOrderItemIds.mockResolvedValue(
      new Map([['2026081900001', 'sol-1']]),
    );

    await consumer.handleOrderCancelled(
      {
        orderId: 'ord-1',
        salesChannel: 'naver',
        externalOrderId: '2026081900000',
        reason: 'CUSTOMER_REQUEST',
        cancelledBy: 'naver',
        cancelledAt: '2026-08-19T00:00:00.000Z',
        refundRequired: true,
        cancelledLines: [{ channelOrderItemId: '2026081900001', quantity: 2 }],
      } as any,
      { messageId: 'msg-1', correlationId: 'corr-1' } as any,
    );

    expect(salesOrdersService.cancel).toHaveBeenCalledWith(
      'so-1',
      expect.objectContaining({ lines: [{ salesOrderLineId: 'sol-1', quantity: 2 }] }),
      expect.anything(),
    );
  });

  it('cancelledLines 가 없으면 lines 를 넘기지 않는다 (전체 취소)', async () => {
    salesOrdersService.findByChannelOrderId.mockResolvedValue({ id: 'so-1' });

    await consumer.handleOrderCancelled(
      {
        orderId: 'ord-1',
        salesChannel: 'naver',
        externalOrderId: '2026081900000',
        reason: 'CUSTOMER_REQUEST',
        cancelledBy: 'naver',
        cancelledAt: '2026-08-19T00:00:00.000Z',
        refundRequired: true,
      } as any,
      { messageId: 'msg-2', correlationId: 'corr-2' } as any,
    );

    const [, options] = salesOrdersService.cancel.mock.calls[0];
    expect(options.lines).toBeUndefined();
  });

  it('해석되지 않는 채널 라인이 있으면 NotFoundException 을 던진다', async () => {
    salesOrdersService.findByChannelOrderId.mockResolvedValue({ id: 'so-1' });
    salesOrdersService.findLineIdsByChannelOrderItemIds.mockResolvedValue(new Map());

    await expect(
      consumer.handleOrderCancelled(
        {
          orderId: 'ord-1',
          salesChannel: 'naver',
          externalOrderId: '2026081900000',
          reason: 'CUSTOMER_REQUEST',
          cancelledBy: 'naver',
          cancelledAt: '2026-08-19T00:00:00.000Z',
          refundRequired: true,
          cancelledLines: [{ channelOrderItemId: 'unknown', quantity: 1 }],
        } as any,
        { messageId: 'msg-3', correlationId: 'corr-3' } as any,
      ),
    ).rejects.toThrow(NotFoundException);
  });
```

`salesOrdersService` mock 객체에 `findLineIdsByChannelOrderItemIds: jest.fn()` 를 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`
Expected: FAIL — `salesOrdersService.findLineIdsByChannelOrderItemIds is not a function`

- [ ] **Step 3: 조회 메서드를 만든다**

`sales-orders.service.ts` 에 추가 (`findByChannelOrderId` 근처):

```ts
  /**
   * 채널이 소유한 라인 식별자 → 우리 `sales_order_lines.id`.
   *
   * `(salesOrderId, channelOrderItemId)` 부분 unique 인덱스가 있으므로
   * (`inventory.schema.ts:1343`) 주문 안에서 단건 확정이다.
   */
  async findLineIdsByChannelOrderItemIds(
    salesOrderId: string,
    channelOrderItemIds: string[],
    tx?: DbTx,
  ): Promise<Map<string, string>> {
    if (channelOrderItemIds.length === 0) return new Map();

    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          id: wmsTables.salesOrderLines.id,
          channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        })
        .from(wmsTables.salesOrderLines)
        .where(
          and(
            eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId),
            inArray(wmsTables.salesOrderLines.channelOrderItemId, channelOrderItemIds),
          ),
        );

      return new Map(
        rows
          .filter((row): row is { id: string; channelOrderItemId: string } => row.channelOrderItemId !== null)
          .map((row) => [row.channelOrderItemId, row.id]),
      );
    }, tx);
  }
```

- [ ] **Step 4: 소비자를 고친다**

`order-events.consumer.ts` 의 `handleOrderCancelled` 에서 `salesOrdersService.cancel` 호출 직전에 삽입하고, 옵션에 `lines` 를 조건부로 붙인다:

```ts
        const lines = await this.resolveCancelledLines(salesOrderId, payload.cancelledLines, tx);

        await this.salesOrdersService.cancel(
          salesOrderId,
          {
            reasonCode: payload.reason,
            reasonDetail: payload.reasonDetail,
            cancelledBy: payload.cancelledBy,
            occurredAt: payload.cancelledAt,
            ...(lines ? { lines } : {}),
            metadata: {
              refundRequired: payload.refundRequired,
              refundAmount: payload.refundAmount,
              stockRestorationResults: payload.stockRestorationResults ?? [],
              sourceEventId: envelope.messageId,
            },
          },
          tx,
        );
```

같은 클래스에 private 헬퍼를 더한다:

```ts
  /**
   * 채널 라인 범위를 Core 라인 범위로 옮긴다.
   *
   * **없으면 `undefined` 를 돌려준다** — Core 는 `lines` 유무로 전체/부분을 가르므로
   * 빈 배열을 넘기면 `BadRequestException` 이 된다 (`sales-orders.service.ts:436`).
   */
  private async resolveCancelledLines(
    salesOrderId: string,
    cancelledLines: Array<{ channelOrderItemId: string; quantity: number }> | undefined,
    tx: DbTx,
  ): Promise<Array<{ salesOrderLineId: string; quantity: number }> | undefined> {
    if (!cancelledLines || cancelledLines.length === 0) return undefined;

    const channelOrderItemIds = cancelledLines.map((line) => line.channelOrderItemId);
    const idByChannelItem = await this.salesOrdersService.findLineIdsByChannelOrderItemIds(
      salesOrderId,
      channelOrderItemIds,
      tx,
    );

    return cancelledLines.map((line) => {
      const salesOrderLineId = idByChannelItem.get(line.channelOrderItemId);
      if (!salesOrderLineId) {
        // 재시도해도 결과가 같다. NotFound 는 이 핸들러의 nonRetryableErrors 라 DLQ 로 간다.
        throw new NotFoundException(
          `Sales order line not found for channelOrderItemId=${line.channelOrderItemId} (salesOrder=${salesOrderId})`,
        );
      }
      return { salesOrderLineId, quantity: line.quantity };
    });
  }
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts`
Expected: PASS

- [ ] **Step 6: 게이트를 돌린다**

Run: `npm run type-check`
Expected: 0

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/sales-order
git commit -m "feat(core): 채널 부분취소를 판매주문 부분취소로 위임한다"
```

---

## Phase B — 네이버 source

### Task 3: 취소된 라인을 계약에서 분리한다

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts:31-48`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts:36-102`
- Test: `apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts`

**Interfaces:**
- Produces: `ChannelOrderLineSnapshot.cancelled?: boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`channel-order.translator.spec.ts` 에 추가 (기존 헬퍼·mock resolver 를 재사용한다):

```ts
  it('취소된 라인은 판매주문 계약에서 빠지지만 변경 해시에는 남는다', async () => {
    resolver.resolve.mockResolvedValue({
      identified: true,
      identity: { variantId: 'v1', masterId: 'm1', versionId: 'ver1' },
    });

    const { outcome } = await translator.translate('naver', {
      ...snapshotFixture,
      lines: [
        { ...lineFixture, channelOrderItemId: 'po-1' },
        { ...lineFixture, channelOrderItemId: 'po-2', cancelled: true },
      ],
    });

    expect(outcome.kind).toBe('order');
    if (outcome.kind !== 'order') return;
    expect(outcome.order.createPayload.items.map((i) => i.orderItemId)).toEqual(['po-1']);
    expect(outcome.order.changes.items?.map((i) => i.orderItemId)).toEqual(['po-1', 'po-2']);
  });

  it('취소된 라인의 미식별은 격리를 부르지 않는다', async () => {
    resolver.resolve.mockImplementation(async (_channel, line) =>
      line.channelOrderItemId === 'po-2'
        ? { identified: false, cause: 'listing_not_found' }
        : { identified: true, identity: { variantId: 'v1', masterId: 'm1', versionId: 'ver1' } },
    );

    const { outcome } = await translator.translate('naver', {
      ...snapshotFixture,
      lines: [
        { ...lineFixture, channelOrderItemId: 'po-1' },
        { ...lineFixture, channelOrderItemId: 'po-2', cancelled: true },
      ],
    });

    expect(outcome.kind).toBe('order');
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts`
Expected: FAIL — 첫 테스트는 `items` 가 2건, 둘째는 `kind === 'failure'`

- [ ] **Step 3: 스냅샷 계약에 플래그를 더한다**

`channel-order-source.interface.ts` 의 `ChannelOrderLineSnapshot` 에:

```ts
  /**
   * 채널에서 이미 취소된 라인. **스냅샷에서 빼지 않고 표시만 한다** — 빼면 변경 해시가 달라져
   * 부분취소가 `collected_order_modification_not_accepted` 로 오격리되고, 그 사유는 replay 가
   * 거부한다 (`order-poller.orchestrator.ts:271`).
   */
  cancelled?: boolean;
```

- [ ] **Step 4: translator 를 고친다**

`translate` 안에서 미식별 판정과 items 조립을 이렇게 바꾼다:

```ts
    // 취소된 라인은 판매주문을 만들지 않으므로 식별을 요구하지 않는다.
    const unidentified = snapshot.lines.flatMap((line, index) => {
      if (line.cancelled) return [];
      const resolution = resolutions[index];
      return resolution.identified ? [] : [{ lineId: line.channelOrderItemId, cause: resolution.cause }];
    });
```

```ts
    const allItems = snapshot.lines.map((line, index) => {
      const resolution = resolutions[index];
      return {
        item: this.buildOrderItem(line, resolution.identified ? resolution.identity : null),
        cancelled: line.cancelled === true,
      };
    });
    // 계약에는 살아있는 라인만 넣는다. 해시는 전 라인으로 계산해 취소가 modification 으로 세지지 않게 한다.
    const items = allItems.filter((entry) => !entry.cancelled).map((entry) => entry.item);
    const changeItems = allItems.map((entry) => entry.item);
```

`createPayload.items` 는 `items` 를, `order.changes.items` 는 `changeItems` 를 쓴다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts`
Expected: PASS — 기존 Medusa 스펙도 전부 통과해야 한다 (Medusa 는 `cancelled` 를 쓰지 않아 `items === changeItems`).

- [ ] **Step 6: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection
git commit -m "feat(channel-adapter): 취소된 라인을 계약에서 빼되 변경 해시에는 남긴다"
```

---

### Task 4: 네이버 변경 피드 zod 를 정확히 만든다

**Files:**
- Modify: `apps/channel-adapter/src/zods/naver/naver-core.zod.ts:209-219`
- Modify: `apps/channel-adapter/src/zods/naver/naver.order.zod.ts:135-160`
- Test: `apps/channel-adapter/src/zods/naver/naver.order.zod.spec.ts` (신규)

**Interfaces:**
- Produces: `LastChangedTypeSchema`, `NaverLastChangedStatusResponseSchema` (기존 이름 유지)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`naver.order.zod.spec.ts`:

```ts
import { NaverLastChangedStatusResponseSchema } from './naver.order.zod';
import { LastChangedTypeSchema, ProductOrderStatusSchema } from './naver-core.zod';

describe('네이버 변경 피드 스키마', () => {
  it('DISPATCHED 는 lastChangedType 값이지 productOrderStatus 값이 아니다', () => {
    expect(LastChangedTypeSchema.safeParse('DISPATCHED').success).toBe(true);
    expect(ProductOrderStatusSchema.safeParse('DISPATCHED').success).toBe(false);
  });

  it('발송 완료 항목을 파싱한다', () => {
    const parsed = NaverLastChangedStatusResponseSchema.safeParse({
      timestamp: '2026-08-19T00:00:00.000+09:00',
      traceId: 'trace-1',
      data: {
        count: 1,
        lastChangeStatuses: [
          {
            orderId: '2026081900000',
            productOrderId: '2026081900001',
            lastChangedType: 'DISPATCHED',
            paymentDate: '2026-08-19T00:00:00.000+09:00',
            lastChangedDate: '2026-08-19T01:00:00.000+09:00',
            productOrderStatus: 'DELIVERING',
            receiverAddressChanged: false,
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('more 객체를 파싱한다 — 페이징 입력이다', () => {
    const parsed = NaverLastChangedStatusResponseSchema.safeParse({
      timestamp: '2026-08-19T00:00:00.000+09:00',
      traceId: 'trace-2',
      data: {
        count: 300,
        lastChangeStatuses: [],
        more: { moreFrom: '2026-08-19T02:00:00.000+09:00', moreSequence: '17' },
      },
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/zods/naver/naver.order.zod.spec.ts`
Expected: FAIL — `LastChangedTypeSchema` 없음, `data.count` 필수 아님

- [ ] **Step 3: 스키마를 고친다**

`naver-core.zod.ts` 에 추가:

```ts
/**
 * 최종 변경 구분 (변경 피드 전용).
 *
 * **`productOrderStatus` 와 다른 축이다.** 발송 완료 시 `productOrderStatus` 는 `DELIVERING`,
 * `lastChangedType` 이 `DISPATCHED` 다. 옛 `mapNaverStatusToInternal` 이 둘을 한 표에 섞었다.
 */
export const LastChangedTypeSchema = z.enum([
  'PAY_WAITING',
  'PAYED',
  'DISPATCHED',
  'CANCEL_REQUESTED',
  'CLAIM_REQUESTED',
  'CLAIM_REJECTED',
  'CLAIM_COMPLETED',
  'PURCHASE_DECIDED',
]);
export type LastChangedType = z.infer<typeof LastChangedTypeSchema>;
```

`naver.order.zod.ts` 의 `NaverLastChangedStatusesDataSchema` 를 교체:

```ts
const NaverLastChangedStatusesDataSchema = z.object({
  count: z.number().int().nonnegative(),
  lastChangeStatuses: z.array(
    z.object({
      orderId: z.string(),
      productOrderId: z.string(),
      lastChangedType: LastChangedTypeSchema,
      paymentDate: z.string().optional(),
      lastChangedDate: z.string(),
      productOrderStatus: ProductOrderStatusSchema,
      claimType: z.string().optional(),
      claimStatus: ClaimStatusSchema.optional(),
      receiverAddressChanged: z.boolean().optional(),
    }),
  ),
  more: z.object({ moreFrom: z.string(), moreSequence: z.string() }).optional(),
});
```

`LastChangedTypeSchema` 를 import 목록에 더한다. 날짜는 `z.iso.datetime()` 대신 `z.string()` 이다 — 네이버는 `+09:00` 오프셋을 붙여 내려주므로 엄격한 datetime 검증이 실패한다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/zods/naver/naver.order.zod.spec.ts`
Expected: PASS (3건)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/zods/naver
git commit -m "fix(channel-adapter): lastChangedType 을 productOrderStatus 와 분리한다"
```

---

### Task 5: 조회 창과 `more` 페이징을 클라이언트에 넣는다

**Files:**
- Modify: `apps/channel-adapter/src/adapters/naver/clients/naver-order.client.ts:171-181`
- Test: `apps/channel-adapter/src/adapters/naver/clients/naver-order.client.spec.ts` (신규)

**Interfaces:**
- Produces: `NaverOrderClient.getLastChangedStatuses(params: { lastChangedFrom: string; lastChangedTo?: string; moreSequence?: string }): Promise<NaverLastChangedStatusResponse>`

기존 시그니처(`lastChangedFrom: string`)를 바꾼다. **호출자가 없음을 확인했다** (`grep -rn 'getLastChangedStatuses' apps/` → 정의 1곳).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`naver-order.client.spec.ts`:

```ts
import { of } from 'rxjs';
import { NaverOrderClient } from './naver-order.client';

describe('NaverOrderClient.getLastChangedStatuses', () => {
  const http = { get: jest.fn() } as any;
  const auth = { getAccessToken: jest.fn().mockResolvedValue('token') } as any;
  const client = new NaverOrderClient(http, auth);

  beforeEach(() => {
    jest.clearAllMocks();
    http.get.mockReturnValue(of({ data: { timestamp: '', traceId: 't', data: { count: 0, lastChangeStatuses: [] } } }));
  });

  it('조회 창의 끝을 명시해 보낸다', async () => {
    await client.getLastChangedStatuses({
      lastChangedFrom: '2026-08-19T00:00:00.000+09:00',
      lastChangedTo: '2026-08-19T06:00:00.000+09:00',
    });

    const [, config] = http.get.mock.calls[0];
    expect(config.params.lastChangedTo).toBe('2026-08-19T06:00:00.000+09:00');
    expect(config.params.limitCount).toBe(300);
  });

  it('moreSequence 를 넘기면 그대로 실어 보낸다', async () => {
    await client.getLastChangedStatuses({
      lastChangedFrom: '2026-08-19T02:00:00.000+09:00',
      moreSequence: '17',
    });

    const [, config] = http.get.mock.calls[0];
    expect(config.params.moreSequence).toBe('17');
  });

  it('moreSequence 가 없으면 파라미터를 아예 넣지 않는다', async () => {
    await client.getLastChangedStatuses({ lastChangedFrom: '2026-08-19T02:00:00.000+09:00' });

    const [, config] = http.get.mock.calls[0];
    expect('moreSequence' in config.params).toBe(false);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/adapters/naver/clients/naver-order.client.spec.ts`
Expected: FAIL — 현재 시그니처가 문자열이라 `config.params.lastChangedFrom` 이 `[object Object]`

- [ ] **Step 3: 클라이언트를 고친다**

```ts
  /**
   * 지정한 창에서 변경된 상품 주문을 조회한다.
   *
   * `lastChangedTo` 를 생략하면 네이버가 **`lastChangedFrom` + 24시간**을 자동 적용한다.
   * 즉 24시간은 "허용 과거" 가 아니라 **한 번에 볼 수 있는 창의 길이**다.
   *
   * 응답은 `limitCount` (최대·기본 300) 에서 잘리고, 남은 항목이 있으면 `data.more` 가 실린다.
   * 이어받으려면 `more.moreFrom` 을 새 `lastChangedFrom` 으로, `more.moreSequence` 를
   * `moreSequence` 로 **함께** 넘겨야 같은 일시의 항목이 중복되지 않는다.
   */
  async getLastChangedStatuses(params: {
    lastChangedFrom: string;
    lastChangedTo?: string;
    moreSequence?: string;
  }): Promise<NaverLastChangedStatusResponse> {
    const token = await this.authService.getAccessToken();
    const url = `${this.apiBaseUrl}/pay-order/seller/product-orders/last-changed-statuses`;
    const response = await firstValueFrom(
      this.http.get<NaverLastChangedStatusResponse>(url, {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          lastChangedFrom: params.lastChangedFrom,
          ...(params.lastChangedTo ? { lastChangedTo: params.lastChangedTo } : {}),
          ...(params.moreSequence ? { moreSequence: params.moreSequence } : {}),
          limitCount: 300,
        },
      }),
    );
    return response.data;
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/adapters/naver/clients/naver-order.client.spec.ts`
Expected: PASS (3건)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/adapters/naver/clients
git commit -m "feat(channel-adapter): 네이버 변경 피드에 조회 창과 more 페이징을 넣는다"
```

---

### Task 6: 네이버 원어 필드 접근을 한 파일에 가둔다

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/naver-order-fields.ts`
- Test: `apps/channel-adapter/src/services/order-collection/naver-order-fields.spec.ts`

**Interfaces:**
- Produces: `parseNaverProductOrderInfo(raw: unknown): NaverProductOrderInfo`, `NaverProductOrderInfo`

**왜 별도 파일인가**: 커머스API 문서가 `productOrder`·`order` 의 하위 구조를 생략하므로 필드명이 **아직 미확정**이다 (스펙 §6.7). shadow(Task 8)에서 실 응답을 보고 고칠 지점을 **한 파일로 모아** 나머지 코드가 흔들리지 않게 한다. 아래 이름들은 추측이 아니라 옛 어댑터가 실제로 읽던 값이다 (`naver-smartstore.adapter.ts:727-745`).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { parseNaverProductOrderInfo } from './naver-order-fields';

const raw = {
  order: {
    orderId: '2026081900000',
    paymentDate: '2026-08-19T00:00:00.000+09:00',
    ordererName: '홍길동',
    ordererTel: '010-0000-0000',
  },
  productOrder: {
    productOrderId: '2026081900001',
    productOrderStatus: 'PAYED',
    productId: '13700000002',
    productName: '아몬드영 세럼',
    quantity: 2,
    unitPrice: 12000,
    totalPaymentAmount: 24000,
    shippingAddress: {
      name: '홍길동',
      tel1: '010-0000-0000',
      zipCode: '06236',
      baseAddress: '서울 강남구 테헤란로 1',
      detailedAddress: '10층',
    },
  },
};

describe('parseNaverProductOrderInfo', () => {
  it('필요한 필드만 뽑아 좁힌 모양으로 돌려준다', () => {
    const parsed = parseNaverProductOrderInfo(raw);
    expect(parsed.orderId).toBe('2026081900000');
    expect(parsed.productOrderId).toBe('2026081900001');
    expect(parsed.channelProductId).toBe('13700000002');
    expect(parsed.quantity).toBe(2);
    expect(parsed.shippingAddress.postalCode).toBe('06236');
  });

  it('모르는 필드가 더 있어도 통과한다', () => {
    expect(() => parseNaverProductOrderInfo({ ...raw, unknownTopLevel: 1 })).not.toThrow();
  });

  it('필수 식별자가 없으면 throw 한다 — 조용히 넘기지 않는다', () => {
    expect(() => parseNaverProductOrderInfo({ ...raw, productOrder: { ...raw.productOrder, productOrderId: undefined } })).toThrow();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/naver-order-fields.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

```ts
import { z } from 'zod';
import type { ShippingAddress } from '@packages/event-contracts/streams';
import { ClaimStatusSchema, ProductOrderStatusSchema } from '../../zods/naver/naver-core.zod';

/**
 * 네이버 상품주문 상세의 **우리가 읽는 부분만** 좁힌 모양.
 *
 * 커머스API 의 공개 문서(`llms/*.md`)는 `order`·`productOrder` 의 하위 구조를 "OAS 참조" 로
 * 생략한다. 그래서 **이 파일이 필드명 확정의 단일 지점**이다 — shadow 점검(계획 Task 8)에서
 * 실 응답을 보고 여기만 고친다. 아래 이름은 옛 어댑터가 실제로 읽던 값이다
 * (`naver-smartstore.adapter.ts:727-745`).
 *
 * `looseObject` 인 것이 요점이다: 모르는 필드는 통과시키고, **우리가 의존하는 필드가 없으면
 * throw** 한다. 삼키면 라인이 조용히 빠진 주문이 Core 로 들어간다.
 */
const OrderSchema = z.looseObject({
  orderId: z.string().min(1),
  paymentDate: z.string().optional(),
  ordererName: z.string().optional(),
  ordererTel: z.string().optional(),
});

const ShippingAddressSchema = z.looseObject({
  name: z.string().optional(),
  tel1: z.string().optional(),
  zipCode: z.string().optional(),
  baseAddress: z.string().optional(),
  detailedAddress: z.string().optional(),
});

const ProductOrderSchema = z.looseObject({
  productOrderId: z.string().min(1),
  productOrderStatus: ProductOrderStatusSchema,
  claimStatus: ClaimStatusSchema.optional(),
  productId: z.union([z.string(), z.number()]).optional(),
  productName: z.string().optional(),
  quantity: z.number().int().nonnegative().optional(),
  unitPrice: z.number().nonnegative().optional(),
  totalPaymentAmount: z.number().nonnegative().optional(),
  deliveryFeeAmount: z.number().nonnegative().optional(),
  shippingAddress: ShippingAddressSchema.optional(),
});

const ProductOrderInfoSchema = z.looseObject({
  order: OrderSchema,
  productOrder: ProductOrderSchema,
});

export interface NaverProductOrderInfo {
  orderId: string;
  productOrderId: string;
  productOrderStatus: z.infer<typeof ProductOrderStatusSchema>;
  claimStatus?: z.infer<typeof ClaimStatusSchema>;
  /** 리스팅 조회 키. 종류(원상품번호 vs 채널상품번호)는 shadow 로 확정한다. */
  channelProductId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  shippingFee: number;
  paymentDate?: string;
  shippingAddress: ShippingAddress;
}

export function parseNaverProductOrderInfo(raw: unknown): NaverProductOrderInfo {
  const parsed = ProductOrderInfoSchema.parse(raw);
  const { order, productOrder } = parsed;
  const address = productOrder.shippingAddress;
  const quantity = productOrder.quantity ?? 1;
  const unitPrice = productOrder.unitPrice ?? 0;

  return {
    orderId: order.orderId,
    productOrderId: productOrder.productOrderId,
    productOrderStatus: productOrder.productOrderStatus,
    ...(productOrder.claimStatus ? { claimStatus: productOrder.claimStatus } : {}),
    ...(productOrder.productId != null ? { channelProductId: String(productOrder.productId) } : {}),
    productName: productOrder.productName ?? productOrder.productOrderId,
    quantity,
    unitPrice,
    lineTotal: productOrder.totalPaymentAmount ?? unitPrice * quantity,
    shippingFee: productOrder.deliveryFeeAmount ?? 0,
    ...(order.paymentDate ? { paymentDate: order.paymentDate } : {}),
    shippingAddress: {
      recipientName: address?.name ?? order.ordererName ?? 'Unknown',
      phone: address?.tel1 ?? order.ordererTel ?? '',
      postalCode: address?.zipCode ?? '',
      roadAddress: address?.baseAddress ?? '',
      detailAddress: address?.detailedAddress ?? '',
    },
  };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/naver-order-fields.spec.ts`
Expected: PASS (3건)

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection/naver-order-fields.ts apps/channel-adapter/src/services/order-collection/naver-order-fields.spec.ts
git commit -m "feat(channel-adapter): 네이버 원어 필드 접근을 한 파일에 가둔다"
```

---

### Task 7: `NaverOrderSource` 를 만들고 등록한다

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/naver-order.source.ts`
- Test: `apps/channel-adapter/src/services/order-collection/naver-order.source.spec.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts:269-276`

**Interfaces:**
- Consumes: `parseNaverProductOrderInfo` (Task 6), `NaverOrderClient.getLastChangedStatuses` (Task 5), `ChannelOrderLineSnapshot.cancelled` (Task 3)
- Produces: `NaverOrderSource implements ReplayableChannelOrderSource`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`naver-order.source.spec.ts`:

```ts
import { NaverOrderSource } from './naver-order.source';

const changed = (productOrderId: string, orderId: string) => ({
  orderId,
  productOrderId,
  lastChangedType: 'PAYED' as const,
  lastChangedDate: '2026-08-19T01:00:00.000+09:00',
  productOrderStatus: 'PAYED' as const,
});

const detail = (productOrderId: string, orderId: string, overrides: Record<string, unknown> = {}) => ({
  order: { orderId, paymentDate: '2026-08-19T00:00:00.000+09:00', ordererName: '홍길동' },
  productOrder: {
    productOrderId,
    productOrderStatus: 'PAYED',
    productId: '13700000002',
    productName: '세럼',
    quantity: 1,
    unitPrice: 10000,
    totalPaymentAmount: 10000,
    shippingAddress: { name: '홍길동', tel1: '010', zipCode: '06236', baseAddress: '서울', detailedAddress: '1층' },
    ...overrides,
  },
});

describe('NaverOrderSource', () => {
  let client: any;
  let source: NaverOrderSource;

  beforeEach(() => {
    client = {
      getLastChangedStatuses: jest.fn(),
      getProductOrderIdsByOrderId: jest.fn(),
      getOrderDetails: jest.fn(),
    };
    source = new NaverOrderSource(client);
  });

  it('한 라인만 변경돼도 형제 라인을 복원해 주문 전체를 조립한다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2', 'po-3'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1'), detail('po-3', 'ord-1')],
    });

    const snapshots = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].lines.map((l) => l.channelOrderItemId)).toEqual(['po-1', 'po-2', 'po-3']);
    expect(snapshots[0].paymentState).toBe('accepted');
  });

  it('상세 응답이 요청보다 적으면 throw 한다 — 라인이 빠진 주문을 만들지 않는다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({ data: [detail('po-1', 'ord-1')] });

    await expect(source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'))).rejects.toThrow(/누락/);
  });

  it('more 를 따라 다음 페이지를 이어 받는다', async () => {
    client.getLastChangedStatuses
      .mockResolvedValueOnce({
        data: {
          count: 300,
          lastChangeStatuses: [changed('po-1', 'ord-1')],
          more: { moreFrom: '2026-08-19T02:00:00.000+09:00', moreSequence: '17' },
        },
      })
      .mockResolvedValueOnce({ data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-2')] } });
    client.getProductOrderIdsByOrderId.mockImplementation(async (orderId: string) => ({
      data: [orderId === 'ord-1' ? 'po-1' : 'po-2'],
    }));
    client.getOrderDetails.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => detail(id, id === 'po-1' ? 'ord-1' : 'ord-2')),
    }));

    const snapshots = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(client.getLastChangedStatuses).toHaveBeenCalledTimes(2);
    expect(client.getLastChangedStatuses.mock.calls[1][0]).toMatchObject({
      lastChangedFrom: '2026-08-19T02:00:00.000+09:00',
      moreSequence: '17',
    });
    expect(snapshots.map((s) => s.externalOrderId).sort()).toEqual(['ord-1', 'ord-2']);
  });

  it('취소 요청 중이면 accepted 로 보지 않는다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1', { claimStatus: 'CANCEL_REQUEST' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));
    expect(snapshot.paymentState).toBe('pending');
  });

  it('일부 라인만 취소면 라인 단위 부분취소 관측을 낸다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-2', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1', { productOrderStatus: 'CANCELED' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshot.paymentState).toBe('accepted');
    expect(snapshot.lines.find((l) => l.channelOrderItemId === 'po-2')?.cancelled).toBe(true);
    expect(snapshot.lifecycle).toHaveLength(1);
    expect(snapshot.lifecycle[0].eventKey).toBe('cancelled:po-2');
    expect(snapshot.lifecycle[0].payload).toMatchObject({
      cancelledLines: [{ channelOrderItemId: 'po-2', quantity: 1 }],
    });
  });

  it('전 라인 취소면 전체 취소 1건이고 terminal 이다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 1, lastChangeStatuses: [changed('po-1', 'ord-1')] },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1'] });
    client.getOrderDetails.mockResolvedValue({
      data: [detail('po-1', 'ord-1', { productOrderStatus: 'CANCELED' })],
    });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(snapshot.paymentState).toBe('terminal');
    expect(snapshot.lifecycle).toHaveLength(1);
    expect(snapshot.lifecycle[0].eventKey).toBe('cancelled');
    expect((snapshot.lifecycle[0].payload as Record<string, unknown>).cancelledLines).toBeUndefined();
  });

  it('sourceUpdatedAt 은 채널이 말한 변경 시각이다 — 현재 시각을 쓰면 워터마크가 창을 건너뛴다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: {
        count: 1,
        lastChangeStatuses: [
          { ...changed('po-1', 'ord-1'), lastChangedDate: '2026-08-19T01:00:00.000+09:00' },
          { ...changed('po-2', 'ord-1'), lastChangedDate: '2026-08-19T03:00:00.000+09:00' },
        ],
      },
    });
    client.getProductOrderIdsByOrderId.mockResolvedValue({ data: ['po-1', 'po-2'] });
    client.getOrderDetails.mockResolvedValue({ data: [detail('po-1', 'ord-1'), detail('po-2', 'ord-1')] });

    const [snapshot] = await source.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    // 한 주문의 여러 라인이 바뀌면 가장 늦은 시각을 취한다.
    expect(snapshot.sourceUpdatedAt).toBe('2026-08-19T03:00:00.000+09:00');
  });

  it('워터마크가 없으면 최근 1시간을, 오래됐으면 24시간 창을 조회한다', async () => {
    client.getLastChangedStatuses.mockResolvedValue({ data: { count: 0, lastChangeStatuses: [] } });

    await source.fetchOrders(null);
    const firstCall = client.getLastChangedStatuses.mock.calls[0][0];
    expect(firstCall.lastChangedTo).toBeUndefined();

    const old = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await source.fetchOrders(old);
    const secondCall = client.getLastChangedStatuses.mock.calls[1][0];
    const from = new Date(secondCall.lastChangedFrom).getTime();
    const to = new Date(secondCall.lastChangedTo).getTime();
    expect(to - from).toBe(24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/naver-order.source.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: source 를 구현한다**

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { SalesChannel } from '@packages/event-contracts/streams';
import { NaverOrderClient } from '../../adapters/naver/clients/naver-order.client';
import {
  ChannelOrderLineSnapshot,
  ChannelOrderSnapshot,
  ChannelPaymentState,
  LifecycleObservation,
  ReplayableChannelOrderSource,
} from './channel-order-source.interface';
import { NaverProductOrderInfo, parseNaverProductOrderInfo } from './naver-order-fields';

/** 최초 수집 바닥값. 과거를 소급하면 이미 수기 처리된 주문이 중복 유입된다. */
const FIRST_RUN_LOOKBACK_MS = 60 * 60 * 1000;
/** 변경 피드가 한 번에 볼 수 있는 창. `lastChangedTo` 생략 시 네이버가 자동 적용하는 값과 같다. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 무한 페이징 방어. 한 창 × 300건이면 6000건으로, 우리 주문량에서 도달할 수 없다. */
const MAX_PAGES = 20;

const ACCEPTED_STATUSES = new Set(['PAYED', 'DELIVERING', 'DELIVERED', 'PURCHASE_DECIDED']);
const TERMINAL_STATUSES = new Set(['CANCELED', 'CANCELED_BY_NOPAYMENT', 'RETURNED', 'EXCHANGED']);
/** 취소 요청 중에도 productOrderStatus 는 PAYED 다 — 그대로 두면 출고로 흘러간다. */
const CANCEL_IN_FLIGHT_CLAIMS = new Set(['CANCEL_REQUEST', 'CANCELING']);

@Injectable()
export class NaverOrderSource implements ReplayableChannelOrderSource {
  readonly channel: SalesChannel = 'naver';
  private readonly logger = new Logger(NaverOrderSource.name);

  constructor(private readonly client: NaverOrderClient) {}

  async fetchOrders(since: Date | null): Promise<ChannelOrderSnapshot[]> {
    const changedAtByOrderId = await this.collectChangedOrderIds(since);
    const snapshots: ChannelOrderSnapshot[] = [];
    for (const [orderId, changedAt] of changedAtByOrderId) {
      // 🔴 채널이 말한 변경 시각을 그대로 싣는다. `now` 를 쓰면 워터마크가 조회 창을 건너뛰어
      // 그 사이 변경이 영영 조회 범위 밖으로 빠진다 (창 걷기가 무력화된다).
      const snapshot = await this.fetchSnapshot(orderId, changedAt);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  /**
   * replay 전용 단건. 워터마크 경로가 아니므로(`replayFailure` 는 `processOrderItem` 을 직접 부른다)
   * 변경 시각을 알 수 없어 현재 시각을 쓴다.
   */
  async fetchOrder(externalOrderId: string): Promise<ChannelOrderSnapshot | null> {
    return this.fetchSnapshot(externalOrderId, new Date().toISOString());
  }

  private async fetchSnapshot(externalOrderId: string, sourceUpdatedAt: string): Promise<ChannelOrderSnapshot | null> {
    // 형제 라인을 복원한다. 변경 피드는 바뀐 라인만 주므로 이걸 건너뛰면 라인이 빠진 주문이 생긴다.
    const idsResponse = await this.client.getProductOrderIdsByOrderId(externalOrderId);
    const productOrderIds = idsResponse.data ?? [];
    if (productOrderIds.length === 0) return null;

    const detailsResponse = await this.client.getOrderDetails(productOrderIds);
    const infos = (detailsResponse.data ?? []).map((raw) => parseNaverProductOrderInfo(raw));

    // 문서가 "식별자 단위로 일부만 조회 실패할 수 있다" 고 경고한다. 조용히 빠지면 §6.1 이
    // 막으려던 사고가 그대로 난다.
    if (infos.length !== productOrderIds.length) {
      throw new Error(
        `네이버 상세 조회 누락: 주문 ${externalOrderId} 요청 ${productOrderIds.length}건, 응답 ${infos.length}건`,
      );
    }

    return this.buildSnapshot(externalOrderId, infos, sourceUpdatedAt);
  }

  /**
   * `more` 를 따라 창 전체를 훑고, **주문번호 → 그 주문의 최신 변경 시각**을 모은다.
   * 한 주문의 여러 라인이 바뀌었으면 가장 늦은 시각을 취한다 — 워터마크의 근거다.
   */
  private async collectChangedOrderIds(since: Date | null): Promise<Map<string, string>> {
    const now = new Date();
    const from = since ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS);
    // 창을 앞으로 점프시키지 않는다 — 그러면 그 사이 주문이 영영 조회 범위 밖으로 빠진다.
    const windowEnd = new Date(Math.min(from.getTime() + MAX_WINDOW_MS, now.getTime()));
    const explicitTo = windowEnd.getTime() < now.getTime() ? windowEnd.toISOString() : undefined;

    const changedAtByOrderId = new Map<string, string>();
    let lastChangedFrom = from.toISOString();
    let moreSequence: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.client.getLastChangedStatuses({
        lastChangedFrom,
        ...(explicitTo ? { lastChangedTo: explicitTo } : {}),
        ...(moreSequence ? { moreSequence } : {}),
      });

      for (const status of response.data?.lastChangeStatuses ?? []) {
        const previous = changedAtByOrderId.get(status.orderId);
        if (!previous || status.lastChangedDate > previous) {
          changedAtByOrderId.set(status.orderId, status.lastChangedDate);
        }
      }

      const more = response.data?.more;
      if (!more) return changedAtByOrderId;
      lastChangedFrom = more.moreFrom;
      moreSequence = more.moreSequence;
    }

    this.logger.warn(`[naver] 변경 피드 페이징이 ${MAX_PAGES}쪽에서 끊겼다 — 다음 주기가 이어받는다.`);
    return changedAtByOrderId;
  }

  private buildSnapshot(
    externalOrderId: string,
    infos: NaverProductOrderInfo[],
    sourceUpdatedAt: string,
  ): ChannelOrderSnapshot {
    const lines = infos.map((info) => this.buildLine(info));
    const cancelled = infos.filter((info) => TERMINAL_STATUSES.has(info.productOrderStatus));
    const allCancelled = cancelled.length === infos.length;

    return {
      externalOrderId,
      sourceUpdatedAt,
      paymentState: this.resolvePaymentState(infos, allCancelled),
      customerId: null,
      lines,
      amounts: {
        total: infos.reduce((sum, info) => sum + info.lineTotal, 0),
        subtotal: infos.reduce((sum, info) => sum + info.unitPrice * info.quantity, 0),
        shipping: infos.reduce((sum, info) => sum + info.shippingFee, 0),
        discount: 0,
        currency: 'KRW',
      },
      shippingAddress: infos[0].shippingAddress,
      createdAt: infos[0].paymentDate ?? sourceUpdatedAt,
      lifecycle: this.buildLifecycle(infos, cancelled, allCancelled, sourceUpdatedAt),
      raw: { externalOrderId, productOrders: infos },
    };
  }

  private buildLine(info: NaverProductOrderInfo): ChannelOrderLineSnapshot {
    return {
      channelOrderItemId: info.productOrderId,
      ...(info.channelProductId ? { channelProductId: info.channelProductId } : {}),
      productName: info.productName,
      quantity: info.quantity,
      unitPrice: info.unitPrice,
      ...(TERMINAL_STATUSES.has(info.productOrderStatus) ? { cancelled: true } : {}),
    };
  }

  private resolvePaymentState(infos: NaverProductOrderInfo[], allCancelled: boolean): ChannelPaymentState {
    if (allCancelled) return 'terminal';

    const live = infos.filter((info) => !TERMINAL_STATUSES.has(info.productOrderStatus));
    // 고객이 취소를 원하는 주문을 출고 파이프라인에 태우지 않는다 (Medusa 의 refund-requested 방어와 대칭).
    if (live.some((info) => info.claimStatus && CANCEL_IN_FLIGHT_CLAIMS.has(info.claimStatus))) return 'pending';
    if (live.every((info) => ACCEPTED_STATUSES.has(info.productOrderStatus))) return 'accepted';
    return 'pending';
  }

  /**
   * **전 라인 취소는 full 1건, 일부 취소는 라인마다 partial 1건.**
   * Core 는 `lines` 유무로 전체/부분을 가르고, 부분취소가 누적돼 전량이 돼도 주문을 닫지 않는다.
   */
  private buildLifecycle(
    infos: NaverProductOrderInfo[],
    cancelled: NaverProductOrderInfo[],
    allCancelled: boolean,
    cancelledAt: string,
  ): LifecycleObservation[] {
    if (cancelled.length === 0) return [];

    if (allCancelled) {
      return [
        {
          eventType: 'OrderCancelled',
          eventKey: 'cancelled',
          payload: {
            reason: 'CUSTOMER_REQUEST',
            reasonDetail: '네이버 주문 취소 수집',
            cancelledBy: 'naver',
            cancelledAt,
            refundRequired: false,
          },
          rawEvent: { productOrderIds: cancelled.map((info) => info.productOrderId) },
        },
      ];
    }

    return cancelled.map((info) => ({
      eventType: 'OrderCancelled' as const,
      eventKey: `cancelled:${info.productOrderId}`,
      payload: {
        reason: 'CUSTOMER_REQUEST' as const,
        reasonDetail: '네이버 상품주문 부분 취소 수집',
        cancelledBy: 'naver',
        cancelledAt,
        refundRequired: false,
        cancelledLines: [{ channelOrderItemId: info.productOrderId, quantity: info.quantity }],
      },
      rawEvent: { productOrderId: info.productOrderId },
    }));
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/naver-order.source.spec.ts`
Expected: PASS (8건)

- [ ] **Step 5: 모듈에 등록한다**

`adapter.module.ts` 의 provider 배열에서 `NaverOrderSource` 를 더하고 factory 를 고친다:

```ts
    MedusaOrderSource,
    NaverOrderSource,
    {
      provide: CHANNEL_ORDER_PROVIDER,
      // 채널이 늘면 source 를 하나 더 만들어 이 배열에 더한다. 번역기는 공유한다.
      useFactory: (translator: ChannelOrderTranslator, medusa: MedusaOrderSource, naver: NaverOrderSource) => [
        createOrderProvider(medusa, translator),
        createOrderProvider(naver, translator),
      ],
      inject: [ChannelOrderTranslator, MedusaOrderSource, NaverOrderSource],
    },
```

import 를 파일 상단에 더한다.

- [ ] **Step 6: 게이트를 돌린다**

Run: `npm run type-check && npx jest --maxWorkers=2 apps/channel-adapter`
Expected: type-check 0, jest 실패 0

- [ ] **Step 7: 커밋**

```bash
git add apps/channel-adapter/src
git commit -m "feat(channel-adapter): 네이버 주문 수집 source 를 붙인다 (#643)"
```

---

## Phase C — shadow 점검 (사람 작업)

### Task 8: 실 응답으로 필드명을 확정한다

**이 태스크는 코드를 쓰지 않는다.** Task 1–7 이 배포된 뒤 운영자가 수행한다.

- [ ] **Step 1: 배포 전 채널을 내린다**

Core DB 에서 확인하고 내린다. **이 단계를 건너뛰면 배포 즉시 수집이 시작된다** (현재 `is_active=true`).

```sql
SELECT id, name, site, is_active FROM sales_channels WHERE site = 'naver';
UPDATE sales_channels SET is_active = false WHERE site = 'naver';
```

- [ ] **Step 2: 배포한다**

Core(Task 1–2) → channel-adapter(Task 3–7) 순서. 마이그레이션 없음.

- [ ] **Step 3: 한 주기만 켠다**

```sql
UPDATE sales_channels SET is_active = true WHERE site = 'naver';
-- 6분 대기 (폴러는 5분 주기)
UPDATE sales_channels SET is_active = false WHERE site = 'naver';
```

- [ ] **Step 4: 결과를 판정한다**

channel-adapter DB 에서:

```sql
SELECT channel_type, last_sync_at, updated_at, error FROM sync_statuses WHERE channel_type = 'naver';
SELECT external_order_id, reason, status, affected_lines FROM order_collection_failures WHERE channel = 'naver';
SELECT raw_order FROM order_collection_failures WHERE channel = 'naver' LIMIT 1;
SELECT count(*) FROM wms_order_mappings WHERE sales_channel = 'naver';  -- 0 이어야 정상
```

기대: `error` 없음 · 격리 행의 `cause` 가 전부 `listing_not_found` · 매핑 0행.

- [ ] **Step 5: `raw_order` 에서 네 가지를 확정한다**

① 상품 식별자 필드명과 **값의 종류** (원상품번호인가 채널상품번호인가 — 둘은 숫자가 겹칠 수 있다)
② 옵션 상품이면 옵션 단위 식별자 필드가 있는가 (없으면 매핑 grain 판단이 별도로 필요)
③ 금액·수량 필드명 (`totalPaymentAmount` / `unitPrice` / `deliveryFeeAmount` 가 맞는가)
④ `claimStatus` 가 실리는 자리

- [ ] **Step 6: 결과를 기록한다**

확정값을 스펙 §6.5 에 적고 커밋한다. 어긋나면 Task 9 로 간다.

⚠️ **shadow 와 개통 사이가 24시간을 넘으면**, 개통 전에 워터마크 행을 지워 최초 수집으로 되돌린다:
`DELETE FROM sync_statuses WHERE channel_type = 'naver' AND data_type = 'orders';`

---

### Task 9: 확정된 필드명을 반영한다

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/naver-order-fields.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/naver-order-fields.spec.ts`

- [ ] **Step 1: 실 응답을 픽스처로 만든다**

Task 8 에서 뜬 `raw_order` 를 그대로 `naver-order-fields.spec.ts` 의 `raw` 상수로 교체한다. 개인정보(수취인명·연락처·주소)는 더미로 치환한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/naver-order-fields.spec.ts`
Expected: 필드명이 달랐다면 FAIL. 같았다면 PASS 이고 이 태스크는 픽스처 교체만으로 끝난다.

- [ ] **Step 3: `naver-order-fields.ts` 만 고친다**

스키마의 필드명·`channelProductId` 원천을 확정값으로 바꾼다. **다른 파일은 건드리지 않는다** — 그러라고 이 파일을 분리했다.

- [ ] **Step 4: 전체 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2 apps/channel-adapter`
Expected: 0 / 실패 0

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection
git commit -m "fix(channel-adapter): shadow 실측으로 네이버 응답 필드를 확정한다"
```

---

## Phase E — 격리 큐 운영 화면

### Task 10: 격리 행에 채널상품ID 를 싣는다

**Files:**
- Modify: `packages/domain-types/listing-resolution-cause.ts:48-51`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order.translator.ts` (`unidentified` 조립부)
- Test: `apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts`

**Interfaces:**
- Produces: `AffectedLine.channelProductId?: string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
  it('격리 행에 해석에 쓴 채널상품ID 를 함께 남긴다 — 화면 프리필의 정본이다', async () => {
    resolver.resolve.mockResolvedValue({ identified: false, cause: 'listing_not_found' });

    const { outcome } = await translator.translate('naver', {
      ...snapshotFixture,
      lines: [{ ...lineFixture, channelOrderItemId: 'po-1', channelProductId: '13700000002' }],
    });

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(outcome.failure.affectedLines).toEqual([
      { lineId: 'po-1', cause: 'listing_not_found', channelProductId: '13700000002' },
    ]);
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection/channel-order.translator.spec.ts`
Expected: FAIL — `channelProductId` 가 없다

- [ ] **Step 3: 타입을 넓힌다**

`listing-resolution-cause.ts`:

```ts
/** 격리된 주문에서 식별에 실패한 라인 하나. */
export interface AffectedLine {
  lineId: string;
  cause: ListingResolutionCause;
  /**
   * 해석에 **실제로 쓴** 조회 키. 운영 화면의 "채널상품ID" 프리필이 이 값을 쓴다.
   * 원본(`raw_order`)을 프런트가 파싱하지 않게 하려는 것이고, 그 덕에 "운영자가 등록하는 값"과
   * "수집이 조회한 값"이 구조적으로 같아진다. 옛 행에는 없으므로 선택 필드다.
   */
  channelProductId?: string;
}
```

- [ ] **Step 4: translator 가 채워 넣게 한다**

`unidentified` 조립을 바꾼다:

```ts
    const unidentified = snapshot.lines.flatMap((line, index) => {
      if (line.cancelled) return [];
      const resolution = resolutions[index];
      if (resolution.identified) return [];
      return [
        {
          lineId: line.channelOrderItemId,
          cause: resolution.cause,
          ...(line.channelProductId ? { channelProductId: line.channelProductId } : {}),
        },
      ];
    });
```

- [ ] **Step 5: 통과를 확인한다**

Run: `npx jest --maxWorkers=2 apps/channel-adapter/src/services/order-collection && npm run type-check`
Expected: PASS / 0

- [ ] **Step 6: 커밋**

```bash
git add packages/domain-types apps/channel-adapter/src/services/order-collection
git commit -m "feat: 격리 라인에 해석 키를 남겨 화면 프리필의 정본으로 쓴다"
```

---

### Task 11: 화면 판정 로직을 순수 함수로 만든다

**Files:**
- Create: `apps/admin-web/src/features/mall/quarantine/guidance.ts`
- Test: `apps/admin-web/src/features/mall/quarantine/guidance.spec.ts`

**Interfaces:**
- Produces: `actionForCause(cause)`, `canReplay(status, reason)`, `replayResultMessage(status)`

**왜 순수 함수인가**: admin-web 은 렌더러가 없고 `.tsx` 가 transform 밖이라 컴포넌트 테스트가 불가능하다. `.tsx` 안에 인라인으로 두면 영구 미검증이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { actionForCause, canReplay, replayResultMessage } from './guidance';

describe('actionForCause', () => {
  it('리스팅이 없으면 매핑 생성으로 안내한다', () => {
    expect(actionForCause('listing_not_found')).toEqual({
      label: '매핑 생성',
      action: 'create-listing',
      description: '이 채널상품에 대응하는 채널 리스팅을 만드세요.',
    });
  });

  it('활성 버전이 없으면 두 갈래를 다 알린다 — 판매중지를 publish 로 오도하지 않는다', () => {
    const guidance = actionForCause('no_active_version');
    expect(guidance.action).toBe('none');
    expect(guidance.description).toContain('publish');
    expect(guidance.description).toContain('내리세요');
  });

  it('모르는 값이 와도 렌더 가능한 안내를 준다', () => {
    expect(actionForCause('unknown').action).toBe('none');
  });
});

describe('canReplay', () => {
  it('격리 상태이고 식별 실패면 재처리할 수 있다', () => {
    expect(canReplay('quarantined', 'channel_product_identification_failed')).toBe(true);
  });

  it('수집 후 변경은 재처리 대상이 아니다', () => {
    expect(canReplay('quarantined', 'collected_order_modification_not_accepted')).toBe(false);
  });

  it('닫힌 건은 재처리하지 않는다', () => {
    expect(canReplay('closed_already_collected', 'channel_product_identification_failed')).toBe(false);
  });
});

describe('replayResultMessage', () => {
  it('여섯 가지 결과를 모두 사람 말로 옮긴다', () => {
    const statuses = [
      'replayed',
      'already_processed',
      'still_quarantined',
      'closed_terminal',
      'closed_already_collected',
      'not_replayable',
    ] as const;
    for (const status of statuses) {
      expect(replayResultMessage(status).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- guidance`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현한다**

```ts
import type { ListingResolutionCause } from '@packages/domain-types';

export type QuarantineStatus =
  | 'quarantined'
  | 'replayed'
  | 'closed_lifecycle'
  | 'closed_already_collected';

export type QuarantineReason =
  | 'channel_product_identification_failed'
  | 'collected_order_modification_not_accepted';

export type ReplayStatus =
  | 'replayed'
  | 'already_processed'
  | 'still_quarantined'
  | 'closed_terminal'
  | 'closed_already_collected'
  | 'not_replayable';

export interface CauseGuidance {
  label: string;
  action: 'create-listing' | 'activate-listing' | 'activate-channel' | 'none';
  description: string;
}

const GUIDANCE: Record<ListingResolutionCause, CauseGuidance> = {
  listing_not_found: {
    label: '매핑 생성',
    action: 'create-listing',
    description: '이 채널상품에 대응하는 채널 리스팅을 만드세요.',
  },
  listing_inactive: {
    label: '리스팅 활성화',
    action: 'activate-listing',
    description: '리스팅이 비활성 상태입니다. 활성화하세요.',
  },
  channel_inactive: {
    label: '채널 활성화',
    action: 'activate-channel',
    description: '판매채널이 비활성 상태입니다. 활성화하세요.',
  },
  variant_inactive: {
    label: '품목 확인',
    action: 'none',
    description: '연결된 품목이 판매중지 상태입니다. 상품 화면에서 품목을 활성화하세요.',
  },
  no_active_version: {
    label: '버전 확인',
    action: 'none',
    description:
      '활성 버전이 없습니다. 판매를 재개하려면 publish 하고, 판매중지가 맞다면 네이버에서 해당 상품을 내리세요.',
  },
  product_deleted: {
    label: '재매핑',
    action: 'create-listing',
    description: '연결된 상품이 삭제됐습니다. 다른 상품으로 다시 매핑하세요.',
  },
  no_embedded_ids: {
    label: '상품 재생성',
    action: 'none',
    description: '채널에 우리 식별자가 없습니다. Core 를 통해 상품을 다시 만드세요.',
  },
  no_lookup_key: {
    label: '채널 데이터 확인',
    action: 'none',
    description: '주문 라인에 조회 키가 없습니다. 채널 원본 데이터를 확인하세요.',
  },
  unknown: {
    label: '판정 불가',
    action: 'none',
    description: '사유를 알 수 없는 격리입니다. 원본을 확인하세요.',
  },
};

export function actionForCause(cause: ListingResolutionCause): CauseGuidance {
  return GUIDANCE[cause] ?? GUIDANCE.unknown;
}

/**
 * 재처리 가능 여부. **상태를 먼저 본다** — 닫힌 행에 버튼을 주면 운영자가 헛수고를 반복한다.
 * `collected_order_modification_not_accepted` 는 서버가 `not_replayable` 로 응답하는 사유다.
 */
export function canReplay(status: string, reason: string): boolean {
  if (status !== 'quarantined') return false;
  return reason !== 'collected_order_modification_not_accepted';
}

const REPLAY_MESSAGES: Record<ReplayStatus, string> = {
  replayed: '재처리했습니다. 판매주문이 생성됐습니다.',
  already_processed: '이미 처리된 주문이라 새로 발행할 것이 없었습니다.',
  still_quarantined: '아직 해소되지 않았습니다. 조치가 반영됐는지 확인하세요.',
  closed_terminal: '채널에서 취소·환불되어 더 이상 수집할 수 없습니다. 격리를 닫았습니다.',
  closed_already_collected: '이미 판매주문이 있어 격리를 닫았습니다.',
  not_replayable: '수집 후 변경 건이라 재처리할 수 없습니다. CS/주문정정으로 처리하세요.',
};

/**
 * 서버 응답 문자열을 그대로 받는다. `ReplayStatus` 로 좁혀 받으면 클라이언트 DTO 의 `status: string`
 * 과 어긋나 호출부에 캐스팅이 생긴다 — 모르는 값이 오면 폴백 문구를 준다.
 */
export function replayResultMessage(status: string): string {
  return REPLAY_MESSAGES[status as ReplayStatus] ?? '알 수 없는 결과입니다.';
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test:admin-web -- guidance`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/features/mall/quarantine
git commit -m "feat(admin-web): 격리 큐 판정 로직을 순수 함수로 분리한다"
```

---

### Task 12: 격리 API 클라이언트와 쿼리 훅

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.client.ts`
- Create: `apps/admin-web/src/lib/services/channel/query-keys.ts`
- Create: `apps/admin-web/src/lib/services/channel/queries.ts`
- Create: `apps/admin-web/src/lib/services/channel/mutations.ts`

**Interfaces:**
- Consumes: `CHANNEL_ADAPTER_SERVICE_BASE_URL` (`@/const`), `client` (`@/lib/api/client`)
- Produces: `orderCollectionFailuresClient.list/get/replay`, `useQuarantinedFailures`, `useReplayFailure`

- [ ] **Step 1: 클라이언트를 만든다**

```ts
'use client';

import { CHANNEL_ADAPTER_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type { AffectedLine } from '@packages/domain-types';

export interface OrderCollectionFailureDto {
  id: string;
  channel: string;
  externalOrderId: string;
  reason: string;
  status: string;
  affectedLineIds: string[];
  affectedLines: AffectedLine[] | null;
  rawOrder: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReplayResultDto {
  status: string;
  failureId: string;
  externalOrderId: string;
  emitted: number;
  dedupedUnchanged: number;
}

export const orderCollectionFailuresClient = {
  list: async (params: { channel?: string; reason?: string; status?: string; limit?: number; offset?: number }) => {
    const response = await client.get<{ count: number; data: OrderCollectionFailureDto[] }>(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures`,
      { params },
    );
    return response.data;
  },

  get: async (id: string) => {
    const response = await client.get<{ data: OrderCollectionFailureDto; replayPath: unknown }>(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/${encodeURIComponent(id)}`,
    );
    return response.data;
  },

  replay: async (id: string) => {
    const response = await client.post<{ result: ReplayResultDto }>(
      `${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/${encodeURIComponent(id)}/replay`,
    );
    return response.data.result;
  },
};
```

브라우저에서 `CHANNEL_ADAPTER_SERVICE_BASE_URL` 은 `/proxy/channel` 이고 axios `baseURL` 이 `/api` 라 최종 경로는 `/api/proxy/channel/adapter/...` — 기존 프록시 라우트가 그대로 받는다.

- [ ] **Step 2: 쿼리 키와 훅을 만든다**

`query-keys.ts`:

```ts
export const channelQueryKeys = {
  failures: ['order-collection-failures'] as const,
  failuresList: (query: Record<string, unknown>) => [...channelQueryKeys.failures, 'list', query] as const,
  failure: (id: string) => [...channelQueryKeys.failures, id] as const,
};
```

`queries.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { channelQueryKeys } from './query-keys';
import { orderCollectionFailuresClient } from '@/lib/api/domains/channel/order-collection-failures.client';

export function useQuarantinedFailures(params: { channel?: string; status?: string } = {}) {
  const query = { status: 'quarantined', ...params };
  return useQuery({
    queryKey: channelQueryKeys.failuresList(query),
    queryFn: () => orderCollectionFailuresClient.list(query),
  });
}

export function useFailureDetail(id: string | null) {
  return useQuery({
    queryKey: channelQueryKeys.failure(id ?? ''),
    queryFn: () => orderCollectionFailuresClient.get(id as string),
    enabled: Boolean(id),
  });
}
```

`mutations.ts`:

```ts
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { channelQueryKeys } from './query-keys';
import { orderCollectionFailuresClient } from '@/lib/api/domains/channel/order-collection-failures.client';

export function useReplayFailure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => orderCollectionFailuresClient.replay(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: channelQueryKeys.failures });
    },
  });
}
```

- [ ] **Step 3: 타입 게이트**

Run: `npm run type-check`
Expected: 0

- [ ] **Step 4: 커밋**

```bash
git add apps/admin-web/src/lib
git commit -m "feat(admin-web): 격리 큐 API 클라이언트와 쿼리 훅을 만든다"
```

---

### Task 13: 미매핑 주문 탭을 붙인다

**Files:**
- Create: `apps/admin-web/src/features/mall/quarantine/components/quarantine-table/index.tsx`
- Create: `apps/admin-web/src/features/mall/quarantine/components/quarantine-detail-dialog/index.tsx`
- Modify: `apps/admin-web/src/features/mall/channel-listings/template/index.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts` (배지)

- [ ] **Step 1: 목록 컴포넌트를 만든다**

`quarantine-table/index.tsx`. 테이블 primitive(`Table`/`TableHeader`/`TableRow`/`TableCell`)와 스타일은
`features/mall/channel-listings/components/channel-listings-table/index.tsx` 에서 쓰는 것과 같은 것을 import 한다.

```tsx
'use client';

import { useState } from 'react';
import { useQuarantinedFailures } from '@/lib/services/channel/queries';
import { canReplay } from '../../guidance';
import { QuarantineDetailDialog } from '../quarantine-detail-dialog';
import type { OrderCollectionFailureDto } from '@/lib/api/domains/channel/order-collection-failures.client';

export function QuarantineTable() {
  const { data, isLoading } = useQuarantinedFailures();
  const [selected, setSelected] = useState<OrderCollectionFailureDto | null>(null);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">불러오는 중…</div>;

  const rows = data?.data ?? [];
  if (rows.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">격리된 주문이 없습니다.</div>;
  }

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left">채널</th>
            <th className="text-left">외부주문번호</th>
            <th className="text-left">사유</th>
            <th className="text-right">라인</th>
            <th className="text-left">변경시각</th>
            <th className="text-right">조치</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.channel}</td>
              <td>{row.externalOrderId}</td>
              <td>{row.reason}</td>
              <td className="text-right">{row.affectedLines?.length ?? row.affectedLineIds.length}</td>
              <td>{new Date(row.updatedAt).toLocaleString('ko-KR')}</td>
              <td className="text-right">
                {canReplay(row.status, row.reason) ? (
                  <button type="button" onClick={() => setSelected(row)}>
                    해소하기
                  </button>
                ) : (
                  <span title="수집 후 채널에서 변경된 건입니다">CS 처리 필요</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <QuarantineDetailDialog failure={selected} onClose={() => setSelected(null)} />
    </>
  );
}
```

- [ ] **Step 2: 상세 다이얼로그를 만든다**

`quarantine-detail-dialog/index.tsx`. Dialog primitive 은 `channel-listing-form-dialog` 가 쓰는 것을 그대로 쓴다.

```tsx
'use client';

import { actionForCause, replayResultMessage } from '../../guidance';
import { useReplayFailure } from '@/lib/services/channel/mutations';
import type { OrderCollectionFailureDto } from '@/lib/api/domains/channel/order-collection-failures.client';

export function QuarantineDetailDialog({
  failure,
  onClose,
}: {
  failure: OrderCollectionFailureDto | null;
  onClose: () => void;
}) {
  const replay = useReplayFailure();
  if (!failure) return null;

  const lines = failure.affectedLines;

  const handleResolved = async () => {
    const result = await replay.mutateAsync(failure.id);
    window.alert(replayResultMessage(result.status));
    onClose();
  };

  return (
    <div role="dialog" aria-label="격리 주문 상세">
      <h2>{failure.externalOrderId}</h2>

      {/* 옛 행에는 라인별 사유가 없다. 이건 정상 상태이므로 빈 화면이 아니라 설명을 렌더한다. */}
      {!lines || lines.length === 0 ? (
        <p>사유 정보가 없는 옛 격리입니다. 원본을 확인해 직접 매핑하세요.</p>
      ) : (
        <ul>
          {lines.map((line) => {
            const guidance = actionForCause(line.cause);
            return (
              <li key={line.lineId}>
                <strong>{line.lineId}</strong> — {guidance.label}
                <p>{guidance.description}</p>
                {guidance.action === 'create-listing' && (
                  <button
                    type="button"
                    onClick={() =>
                      openChannelListingForm({
                        channelCode: failure.channel,
                        channelItemId: line.channelProductId ?? '',
                      })
                    }
                  >
                    매핑 생성
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" onClick={handleResolved} disabled={replay.isPending}>
        조치 완료 — 재처리
      </button>
    </div>
  );
}
```

`openChannelListingForm` 은 기존 `channel-listing-form-dialog` 를 여는 함수다. 그 다이얼로그의 props 에
`defaultChannelCode` / `defaultChannelItemId` 를 더해 프리필을 받게 한다 (없으면 빈 문자열).

- [ ] **Step 3: 탭을 붙인다**

`channel-listings/template/index.tsx` 의 최상단 반환을 탭으로 감싼다. 기존 테이블은 첫 탭에 그대로 둔다.

```tsx
const [tab, setTab] = useState<'listings' | 'quarantine'>('listings');

return (
  <div>
    <nav>
      <button type="button" onClick={() => setTab('listings')} aria-pressed={tab === 'listings'}>
        채널 리스팅
      </button>
      <button type="button" onClick={() => setTab('quarantine')} aria-pressed={tab === 'quarantine'}>
        미매핑 주문
      </button>
    </nav>
    {tab === 'listings' ? <ChannelListingsTable /> : <QuarantineTable />}
  </div>
);
```

- [ ] **Step 4: 메뉴 배지**

메뉴 항목 컴포넌트에서 `useQuarantinedFailures()` 의 `data?.count` 를 배지로 렌더한다.
`count` 가 0 이거나 로딩 중이면 배지를 그리지 않는다.

```tsx
const { data } = useQuarantinedFailures();
const quarantinedCount = data?.count ?? 0;
// ...메뉴 라벨 옆
{quarantinedCount > 0 && <span aria-label={`격리 ${quarantinedCount}건`}>{quarantinedCount}</span>}
```

- [ ] **Step 5: 게이트**

Run: `npm run type-check && npm run test:admin-web`
Expected: 0 / 실패 0

- [ ] **Step 6: 브라우저 수동 확인 (유일한 방어선)**

- 빈 목록이 깨지지 않는가
- `affected_lines` 가 `null` 인 옛 행이 렌더되는가
- 라인이 여러 개인 격리의 라인별 사유가 다 보이는가
- `not_replayable` 건에 재처리 버튼이 없는가
- 프리필된 매핑 생성 → 저장 → 자동 재처리 → 목록에서 사라지는가

- [ ] **Step 7: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 미매핑 주문 격리 큐 화면을 붙인다 (#640)"
```

---

## 개통 (Task 13 배포 후)

- [ ] admin-web 배포 완료 확인
- [ ] shadow 이후 24시간이 지났으면 워터마크 행 삭제 (Task 8 Step 6 주석)
- [ ] `UPDATE sales_channels SET is_active = true WHERE site = 'naver';`
- [ ] 첫 격리 건이 화면에 뜨는지 확인하고 한 바퀴(매핑 등록 → 재처리 → 판매주문 생성)를 끝까지 돌린다
- [ ] 30분 뒤: `sync_statuses.updated_at` 이 갱신되는가 · `failed_syncs` +0 인가 · `wms_order_mappings` 에 naver 행이 생겼는가
