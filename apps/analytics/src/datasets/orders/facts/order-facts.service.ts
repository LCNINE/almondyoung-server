import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, eq, or } from 'drizzle-orm';
import { DomainEvent } from '@packages/event-contracts/types';
import {
  OrderCreatedPayload,
  OrderCancelledPayload,
  OrderRefundCreatedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { analyticsSchema, factOrderEvents, factOrderItems } from '../../../schema';
import { toSeoulDateOnly } from '../../../shared/date.util';
import { DbTx } from '../../../db.types';
import { OrderAggregateSeed, VariantAggregateSeed, ChannelAggregateSeed, CustomerLifetimeSeed } from './order-types';

export type OrderCreatedFactResult = {
  claimed: boolean;
  seeds: OrderAggregateSeed[];
  variantSeeds: VariantAggregateSeed[];
  channelSeed: ChannelAggregateSeed | null;
  customerSeed: CustomerLifetimeSeed | null;
};

export type OrderCancelledFactResult = {
  claimed: boolean;
  orphan: boolean;
  salesChannel: string | null;
  occurredDate: string;
  masterAmounts: Array<{ masterId: string; amount: number }>;
  totalAmount: number;
};

export type OrderRefundFactResult = {
  claimed: boolean;
  orphan: boolean;
  /** 같은 주문의 `OrderCancelled` 봉투가 이미 있어 이 환불을 집계에 반영하면 안 되는 경우. */
  supersededByCancellation: boolean;
  salesChannel: string | null;
  occurredDate: string;
  /** 환불액을 주문의 상품(master)들에 배분한 결과. 합은 `payload.amount` 와 정확히 같다. */
  masterAmounts: Array<{ masterId: string; amount: number }>;
};

const EMPTY_SEEDS: Pick<OrderCreatedFactResult, 'seeds' | 'variantSeeds' | 'channelSeed' | 'customerSeed'> = {
  seeds: [],
  variantSeeds: [],
  channelSeed: null,
  customerSeed: null,
};

@Injectable()
export class OrderFactsService {
  private readonly logger = new Logger(OrderFactsService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  /**
   * Idempotency claim shared by every `recordXxx` method: insert the envelope into
   * `fact_order_events`, `onConflictDoNothing` on `messageId`, and return whatever
   * `returning()` gives back (empty = already claimed by a prior delivery).
   * `fields` carries the columns that differ per event shape (orderId/occurredAt are
   * always present in practice, salesChannel/externalOrderId only for OrderCreated).
   */
  private async claimEvent(
    executor: DbTx,
    envelope: DomainEvent<unknown>,
    fields: {
      orderId?: string;
      occurredAt?: Date;
      salesChannel?: string;
      externalOrderId?: string;
    } = {},
  ) {
    return executor
      .insert(factOrderEvents)
      .values({
        messageId: envelope.messageId,
        messageType: envelope.messageType,
        messageVersion: envelope.messageVersion,
        messageKind: envelope.messageKind,
        correlationId: envelope.correlationId,
        causationId: envelope.causationId,
        aggregateType: envelope.source.aggregateType,
        aggregateId: envelope.source.aggregateId,
        sourceService: envelope.source.service,
        payload: envelope.payload,
        metadata: envelope.metadata ?? null,
        ...fields,
      })
      .onConflictDoNothing({ target: factOrderEvents.messageId })
      .returning({ messageId: factOrderEvents.messageId });
  }

  /** Matches `fact_order_items` rows belonging to `orderId`, whichever column (orderKey — the
   * external channel order id when present, else internal orderId — or orderId itself) it
   * landed under at OrderCreated ingestion time. See order-cancellation task notes. */
  private matchesOrder(orderId: string) {
    return or(eq(factOrderItems.orderKey, orderId), eq(factOrderItems.orderId, orderId));
  }

  async recordOrderCreated(
    envelope: DomainEvent<OrderCreatedPayload>,
    payload: OrderCreatedPayload,
    tx?: DbTx,
  ): Promise<OrderCreatedFactResult> {
    const orderKey = payload.externalOrderId ?? payload.orderId;
    const occurredAt = payload.createdAt ? new Date(payload.createdAt) : undefined;
    const occurredDate = this.toDateOnly(occurredAt ?? new Date());

    const result = await this.inTx(async (executor) => {
      const claimedEvents = await this.claimEvent(executor, envelope, {
        salesChannel: payload.salesChannel,
        orderId: payload.orderId,
        externalOrderId: payload.externalOrderId,
        occurredAt,
      });

      if (claimedEvents.length === 0) {
        return { claimed: false, ...EMPTY_SEEDS };
      }

      if (payload.items.length === 0) {
        return { claimed: true, ...EMPTY_SEEDS };
      }

      const insertedItems = await executor
        .insert(factOrderItems)
        .values(
          payload.items.map((item) => ({
            messageId: envelope.messageId,
            orderKey,
            orderId: payload.orderId,
            externalOrderId: payload.externalOrderId,
            salesChannel: payload.salesChannel,
            customerId: payload.customerId,
            orderItemId: item.orderItemId ?? null,
            masterId: item.masterId,
            versionId: item.versionId,
            variantId: item.variantId,
            skuId: item.skuId,
            productName: item.productName,
            channelProductId: item.channelProductId ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            currency: payload.currency,
            occurredAt,
          })),
        )
        .onConflictDoNothing({
          target: [factOrderItems.orderKey, factOrderItems.salesChannel, factOrderItems.orderItemId],
        })
        .returning({
          masterId: factOrderItems.masterId,
          variantId: factOrderItems.variantId,
          quantity: factOrderItems.quantity,
          totalPrice: factOrderItems.totalPrice,
        });
      if (insertedItems.length === 0) {
        return { claimed: true, ...EMPTY_SEEDS };
      }

      const byMaster = new Map<string, { quantitySold: number; revenue: number }>();
      const byVariant = new Map<string, VariantAggregateSeed>();
      let orderRevenue = 0;

      for (const item of insertedItems) {
        const quantity = item.quantity ?? 0;
        const revenue = item.totalPrice ?? 0;
        orderRevenue += revenue;

        const master = byMaster.get(item.masterId);
        if (master) {
          master.quantitySold += quantity;
          master.revenue += revenue;
        } else {
          byMaster.set(item.masterId, { quantitySold: quantity, revenue });
        }

        if (item.variantId) {
          const variant = byVariant.get(item.variantId);
          if (variant) {
            variant.quantitySold += quantity;
            variant.revenue += revenue;
          } else {
            byVariant.set(item.variantId, {
              variantId: item.variantId,
              masterId: item.masterId,
              salesChannel: payload.salesChannel,
              occurredDate,
              quantitySold: quantity,
              revenue,
            });
          }
        }
      }

      return {
        claimed: true,
        seeds: [...byMaster.entries()].map(([masterId, agg]) => ({
          masterId,
          salesChannel: payload.salesChannel,
          occurredDate,
          orderCount: 1,
          quantitySold: agg.quantitySold,
          revenue: agg.revenue,
        })),
        variantSeeds: [...byVariant.values()],
        channelSeed: {
          salesChannel: payload.salesChannel,
          occurredDate,
          ordersCount: 1,
          grossRevenue: orderRevenue,
        },
        customerSeed: payload.customerId
          ? { customerId: payload.customerId, occurredAt: occurredAt ?? new Date(), revenue: orderRevenue }
          : null,
      };
    }, tx);

    if (result.claimed) {
      this.logger.debug(`OrderCreated persisted: ${payload.orderId} (${payload.salesChannel})`);
    } else {
      this.logger.debug(`Duplicate OrderCreated skipped: ${envelope.messageId}`);
    }

    return result;
  }

  async recordOrderCancelled(
    envelope: DomainEvent<OrderCancelledPayload>,
    payload: OrderCancelledPayload,
    tx?: DbTx,
  ): Promise<OrderCancelledFactResult> {
    const occurredAt = payload.cancelledAt ? new Date(payload.cancelledAt) : new Date();
    const occurredDate = this.toDateOnly(occurredAt);
    const empty: OrderCancelledFactResult = {
      claimed: false,
      orphan: false,
      salesChannel: null,
      occurredDate,
      masterAmounts: [],
      totalAmount: 0,
    };

    return this.inTx(async (executor) => {
      const claimedEvents = await this.claimEvent(executor, envelope, {
        orderId: payload.orderId,
        occurredAt,
      });

      if (claimedEvents.length === 0) {
        this.logger.debug(`Duplicate OrderCancelled skipped: ${envelope.messageId}`);
        return empty;
      }

      const originals = await executor
        .select({
          masterId: factOrderItems.masterId,
          salesChannel: factOrderItems.salesChannel,
          orderItemId: factOrderItems.orderItemId,
          quantity: factOrderItems.quantity,
          totalPrice: factOrderItems.totalPrice,
        })
        .from(factOrderItems)
        .where(this.matchesOrder(payload.orderId));

      if (originals.length === 0) {
        this.logger.warn(`백필 범위 밖 주문의 취소 — 건너뜀: ${payload.orderId}`);
        return { ...empty, claimed: true, orphan: true };
      }

      const restoredByItem = this.restoredQtyByOrderItem(payload);
      const lineAmounts = this.scopeCancelledAmounts(payload.orderId, originals, restoredByItem);

      const byMaster = new Map<string, number>();
      let totalAmount = 0;
      for (let i = 0; i < originals.length; i += 1) {
        const amount = lineAmounts[i];
        if (amount === 0) {
          continue;
        }
        totalAmount += amount;
        byMaster.set(originals[i].masterId, (byMaster.get(originals[i].masterId) ?? 0) + amount);
      }

      return {
        claimed: true,
        orphan: false,
        salesChannel: originals[0].salesChannel,
        occurredDate,
        masterAmounts: [...byMaster.entries()].map(([masterId, amount]) => ({ masterId, amount })),
        totalAmount,
      };
    }, tx);
  }

  /**
   * `OrderCancelled.stockRestorationResults[]` 를 `orderItemId → 복원수량` 으로 접는다.
   * 같은 orderItemId 가 여러 줄로 나뉘어 올 수 있어 합산한다 (한 라인이 여러 창고에서
   * 나뉘어 복원되는 경우). 필드 자체가 optional 이라 없으면 빈 맵이 되고, 호출부는 이를
   * "라인 정보 없음 → 전량 취소" 로 해석한다.
   */
  private restoredQtyByOrderItem(payload: OrderCancelledPayload): Map<string, number> {
    const restored = new Map<string, number>();
    for (const line of payload.stockRestorationResults ?? []) {
      if (!line.orderItemId) {
        continue;
      }
      restored.set(line.orderItemId, (restored.get(line.orderItemId) ?? 0) + (line.restoredQty ?? 0));
    }
    return restored;
  }

  /**
   * 주문의 각 fact 라인이 이번 취소로 얼마나 깎여야 하는지 계산한다 — `originals` 와
   * 같은 순서의 배열로 돌려준다.
   *
   * **부분 취소가 전량 차감되는 것이 이 함수가 존재하는 이유다.** 이전에는 `orderId` 로
   * 매칭되는 모든 fact 라인의 `totalPrice` 를 무조건 다 더했다. 3줄짜리 주문에서 1줄만
   * 취소돼도 3줄 값이 전부 cancelledAmount 로 들어가 순매출이 실제보다 낮게 찍힌다.
   *
   * `stockRestorationResults` 가 라인 단위 `restoredQty` 를 싣고 오므로(orders.stream.ts:123)
   * 이를 근거로 범위를 좁힌다. 없으면(외부 채널 이벤트 등) 예전대로 전량 합산한다 —
   * 정보가 없을 때 덜 깎는 것보다 다 깎는 쪽이 기존 동작이자 보수적인 선택이다.
   */
  private scopeCancelledAmounts(
    orderId: string,
    originals: Array<{ orderItemId: string | null; quantity: number | null; totalPrice: number | null }>,
    restoredByItem: Map<string, number>,
  ): number[] {
    const fullAmounts = originals.map((row) => row.totalPrice ?? 0);

    if (restoredByItem.size === 0) {
      return fullAmounts;
    }

    const scoped = originals.map((row) => this.restoredLineAmount(row, restoredByItem));
    const matchedLines = originals.filter(
      (row) => row.orderItemId !== null && restoredByItem.has(row.orderItemId),
    ).length;

    // orderItemId 는 contract 상 optional 이라(OrderItem.orderItemId?) OrderCreated 때
    // null 로 들어온 주문이 있을 수 있다. 그런 주문에 라인 정보가 실린 취소가 오면 매칭이
    // 한 줄도 안 돼 차감액이 0 이 되는데, 이는 "부분 취소"가 아니라 "매칭 실패"다.
    // 조용히 0 을 쓰면 취소가 통째로 사라지므로 전량 차감으로 되돌린다.
    if (matchedLines === 0) {
      this.logger.warn(
        `취소 라인 정보가 fact 라인과 하나도 매칭되지 않아 전량 차감으로 대체: ${orderId} ` +
          `(restoration=${restoredByItem.size}건, fact=${originals.length}건)`,
      );
      return fullAmounts;
    }

    if (restoredByItem.size !== originals.length || matchedLines !== restoredByItem.size) {
      // 정상적인 부분 취소도 여기 걸린다(fact 라인보다 복원 라인이 적으므로). 새로 켜지는
      // 경로라 아직 실물 관측이 없어서 일단 눈에 보이게 남긴다. 반대로 matchedLines 가
      // restoration 건수보다 적다면 매칭 안 된 복원 라인이 있다는 뜻이고, 그 금액은
      // 차감에서 누락된다 — 이쪽은 진짜 결함 신호다.
      this.logger.warn(
        `취소 라인 수가 fact 라인 수와 다르다 — 부분 취소로 처리: ${orderId} ` +
          `(restoration=${restoredByItem.size}건, fact=${originals.length}건, 매칭=${matchedLines}건)`,
      );
    }

    return scoped;
  }

  /** 한 fact 라인의 복원수량 비례 취소금액. 라인 단가가 아니라 `totalPrice/quantity` 를 쓰는
   * 이유는 라인 수준 할인이 `totalPrice` 에만 반영돼 있기 때문이다. */
  private restoredLineAmount(
    row: { orderItemId: string | null; quantity: number | null; totalPrice: number | null },
    restoredByItem: Map<string, number>,
  ): number {
    if (row.orderItemId === null) {
      return 0;
    }
    const restoredQty = restoredByItem.get(row.orderItemId);
    if (restoredQty === undefined || restoredQty <= 0) {
      return 0;
    }

    const total = row.totalPrice ?? 0;
    const quantity = row.quantity ?? 0;
    if (quantity <= 0) {
      return 0;
    }

    // 복원수량이 주문수량 이상이면 그 라인은 전량 취소다. 클램프해두지 않으면 중복 복원
    // 이벤트가 라인 금액보다 큰 차감을 만들 수 있다.
    const cancelledQty = Math.min(restoredQty, quantity);
    return cancelledQty === quantity ? total : Math.round((total * cancelledQty) / quantity);
  }

  async recordOrderRefund(
    envelope: DomainEvent<OrderRefundCreatedPayload>,
    payload: OrderRefundCreatedPayload,
    tx?: DbTx,
  ): Promise<OrderRefundFactResult> {
    const orderId = payload.orderId;
    const occurredAt = new Date(payload.createdAt);
    const occurredDate = this.toDateOnly(occurredAt);
    const empty: OrderRefundFactResult = {
      claimed: false,
      orphan: false,
      supersededByCancellation: false,
      salesChannel: null,
      occurredDate,
      masterAmounts: [],
    };

    return this.inTx(async (executor) => {
      const claimedEvents = await this.claimEvent(executor, envelope, { orderId, occurredAt });

      if (claimedEvents.length === 0) {
        this.logger.debug(`Duplicate ${envelope.messageType} skipped: ${envelope.messageId}`);
        return empty;
      }

      if (await this.hasCancellationEnvelope(executor, orderId)) {
        this.logger.warn(`취소된 주문의 환불 — 집계 반영 건너뜀 (이중 차감 방지): ${orderId} (${envelope.messageId})`);
        return { ...empty, claimed: true, supersededByCancellation: true };
      }

      // Same `matchesOrder` lookup the cancellation path performs — the refund needs the
      // order's lines both to resolve `salesChannel` and to spread `payload.amount` across
      // the masters it touched (agg_product_order_daily.refundedAmount).
      const originals = await executor
        .select({
          masterId: factOrderItems.masterId,
          salesChannel: factOrderItems.salesChannel,
          totalPrice: factOrderItems.totalPrice,
        })
        .from(factOrderItems)
        .where(this.matchesOrder(orderId));

      if (originals.length === 0) {
        this.logger.warn(`백필 범위 밖 주문의 ${envelope.messageType} — 건너뜀: ${orderId}`);
        return { ...empty, claimed: true, orphan: true };
      }

      return {
        ...empty,
        claimed: true,
        salesChannel: originals[0].salesChannel,
        masterAmounts: this.allocateRefundToMasters(orderId, payload.amount, originals),
      };
    }, tx);
  }

  /**
   * 환불액을 주문이 건드린 상품(master)들에 라인 금액 비례로 배분한다.
   *
   * **왜 비례 배분인가.** `OrderRefundCreated` 는 금액 하나만 싣고 라인 정보가 없다
   * (취소의 `stockRestorationResults` 같은 게 없다). 그런데 `agg_channel_daily` 는
   * `payload.amount` 를 그대로 받으므로, 상품 단위에서 라인 금액을 통째로 쓰면 부분 환불일 때
   * 상품 합계와 채널 합계가 어긋난다 — 두 테이블이 같은 돈에 대해 다른 답을 내놓는 상황이고,
   * 정확히 이 불일치를 없애려고 이 writer 를 넣는 것이라 본말이 전도된다. 비례 배분은
   * **배분 합 === `payload.amount`** 를 보장한다.
   *
   * 나머지(정수 나눗셈에서 남는 원 단위)는 소수부가 큰 순서로 1원씩 나눠준다(largest
   * remainder). masterId 로 결정론적 타이브레이크를 걸어 같은 입력이 항상 같은 배분을 낸다.
   */
  private allocateRefundToMasters(
    orderId: string,
    refundAmount: number,
    originals: Array<{ masterId: string; totalPrice: number | null }>,
  ): Array<{ masterId: string; amount: number }> {
    if (refundAmount <= 0) {
      return [];
    }

    const byMaster = new Map<string, number>();
    for (const row of originals) {
      byMaster.set(row.masterId, (byMaster.get(row.masterId) ?? 0) + (row.totalPrice ?? 0));
    }

    const entries = [...byMaster.entries()]
      .map(([masterId, lineTotal]) => ({ masterId, lineTotal }))
      .sort((a, b) => a.masterId.localeCompare(b.masterId));

    const orderTotal = entries.reduce((sum, entry) => sum + entry.lineTotal, 0);
    if (orderTotal <= 0) {
      // 라인 금액이 전부 0/null 인 주문 — 비례 기준이 없다. 채널 단위 환불은 그대로 반영되고
      // 상품 단위만 비게 되므로, 그 차이가 어디서 생겼는지 로그로 남긴다.
      this.logger.warn(`환불 배분 기준(라인 금액)이 0 이라 상품 단위 배분을 건너뜀: ${orderId}`);
      return [];
    }

    const allocations = entries.map((entry) => {
      const exact = (refundAmount * entry.lineTotal) / orderTotal;
      const floor = Math.floor(exact);
      return { masterId: entry.masterId, amount: floor, remainder: exact - floor };
    });

    let leftover = refundAmount - allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    const byRemainder = [...allocations].sort(
      (a, b) => b.remainder - a.remainder || a.masterId.localeCompare(b.masterId),
    );
    for (let i = 0; i < byRemainder.length && leftover >= 1; i += 1) {
      byRemainder[i].amount += 1;
      leftover -= 1;
    }

    return allocations
      .filter((allocation) => allocation.amount > 0)
      .map(({ masterId, amount }) => ({ masterId, amount }));
  }

  /**
   * 이 주문에 대한 `OrderCancelled` 봉투가 `fact_order_events` 에 이미 있는지.
   *
   * **왜 필요한가 — 전액 환불된 취소가 두 번 차감된다.**
   * Medusa 수집기는 한 주문에 대해 취소와 환불을 *각각* 발행한다
   * (`medusa-order.provider.ts:270-285` 이 `status === 'canceled'` 로 `OrderCancelled` 를,
   * `:288-313` 이 refund 마다 `OrderRefundCreated` 를 push). 두 이벤트가 다 도착하면
   * 취소 경로는 원본 라인 금액을 읽어 `cancelledAmount` 를, 환불 경로는 `payload.amount` 로
   * `refundedAmount` 를 올린다. 전액 환불된 취소에서는 둘이 같은 금액이라
   * `net = gross - cancelled - refunded = gross - 2×gross` 가 된다.
   * Naver/Coupang 은 `OrderCancelled` 만 발행하므로 영향이 없다.
   *
   * **도착 순서에 따라 효과가 다르다 — 한쪽만 막는다는 점을 분명히 해둔다.**
   *
   * 1. *취소 → 환불* (기대되는 순서): 취소 봉투가 이미 있으므로 환불이 여기서 걸러진다.
   *    **이중 차감이 막힌다.** 생산자가 배열에 취소를 먼저 push 하고
   *    (`buildLifecycleEvents`), inbox 는 `created_at ASC` 로 배출하며
   *    (`outbox-dispatcher.service.ts:101`), 두 이벤트가 같은 `partitionKey`(채널)로
   *    발행돼 카프카 파티션 순서까지 보존되므로 이쪽이 정상 경로다.
   * 2. *환불 → 취소* (역전): 환불 시점엔 취소 봉투가 없어 통과하고 `refundedAmount` 가
   *    올라간다. 뒤이어 도착한 취소는 이 가드를 보지 않으므로 `cancelledAmount` 도 올라간다.
   *    **이 경우 이중 차감이 그대로 남는다 — 이 가드는 그 구멍을 메우지 않는다.**
   *    실제로 일어날 수 있는 경로다: 환불을 먼저 처리하고 나중에 주문을 취소하면 서로 다른
   *    폴링 사이클에 각각 수집돼 순서가 뒤집힌다.
   *
   * 2번까지 막으려면 취소 경로에서도 대칭 가드(선행 환불 봉투가 있으면 그만큼 제외)가
   * 필요하지만, 그건 "환불액을 취소액에서 빼는" 부분 차감이라 이 가드와 성격이 다르다.
   * 애초에 이 shop 의 Medusa 환불이 `payment_collections` 에 실제로 잡히는지 자체가
   * 미확인이라 (사용자 재결) 지금은 **일어난다면 확실히 막고, 안 일어나면 무해한** 쪽만
   * 넣는다. 2번이 로그에 잡히기 시작하면 그때 대칭 가드를 검토한다.
   *
   * 조회는 `idx_fact_order_events_order` (order_id) 를 타는 predicate 하나다.
   * `payload.orderId` 는 취소·환불 양쪽 다 channel-adapter 가 같은 `wmsOrderId` 로 채우므로
   * (`order-poller.orchestrator.ts:429`) 등치 비교가 성립한다.
   */
  private async hasCancellationEnvelope(executor: DbTx, orderId: string): Promise<boolean> {
    const rows = await executor
      .select({ messageId: factOrderEvents.messageId })
      .from(factOrderEvents)
      .where(and(eq(factOrderEvents.orderId, orderId), eq(factOrderEvents.messageType, 'OrderCancelled')))
      .limit(1);

    return rows.length > 0;
  }

  /** 집계 일자는 KST 기준이다 — 근거는 `toSeoulDateOnly` 주석 참조. */
  private toDateOnly(value: Date): string {
    return toSeoulDateOnly(value);
  }
}
