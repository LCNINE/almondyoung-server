import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import { ORDER_STREAM, OrderCancelledPayload, OrderRefundCreatedPayload } from '@packages/event-contracts/streams';
import { SyncStatusService } from '../sync-status.service';
import { PollingChangeHashService } from '../polling-change-hash.service';
import { ChannelType } from '../../adapters/channel-adapter.factory';
import {
  CHANNEL_ORDER_PROVIDER,
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  ChannelOrderProvider,
  COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderLifecycleEventItem,
  ReplayableChannelOrderProvider,
} from './channel-order-provider.interface';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';
import { OrderCollectionFailureService } from './order-collection-failure.service';
import { SalesChannelClient } from '../clients/sales-channel.client';

const POLLING_RESOURCE_TYPE_ORDER = 'order';
const POLLING_RESOURCE_TYPE_ORDER_LIFECYCLE = 'order_lifecycle';
const WATERMARK_LOOKBACK_MS = 2 * 60 * 1000;
/** 건너뛴 주문 id 를 로그에 싣되 한 줄이 무한정 길어지지 않게 자른다. */
const SKIPPED_LOG_SAMPLE_SIZE = 20;

type OrderedPollItem =
  | { kind: 'order'; item: OrderFetchItem }
  | { kind: 'failure'; item: OrderCollectionFailureItem }
  | { kind: 'lifecycle'; item: OrderLifecycleEventItem };

type ProcessPollItemResult = {
  emitted: number;
  dedupedUnchanged: number;
  wmsOrderId?: string;
  // Lifecycle items only: whether the observation was durably recorded (a Core mapping existed).
  // false means it was skipped for a missing mapping and may need the watermark held.
  recorded?: boolean;
};

@Injectable()
export class OrderPollerOrchestrator {
  private readonly logger = new Logger(OrderPollerOrchestrator.name);

  constructor(
    @Inject(CHANNEL_ORDER_PROVIDER)
    private readonly providers: ChannelOrderProvider[],
    private readonly syncStatusService: SyncStatusService,
    @InjectPublisher(ORDER_STREAM)
    private readonly ordersPublisher: PublisherFor<typeof ORDER_STREAM>,
    private readonly pollingHashService: PollingChangeHashService,
    private readonly orderCollectionFailureService: OrderCollectionFailureService,
    private readonly db: DbService<typeof channelAdapterSchema>,
    private readonly salesChannelClient: SalesChannelClient,
  ) {}

  @Cron('*/5 * * * *')
  async poll(): Promise<void> {
    // 캐시하지 않는다. 주기가 5분이고 provider 는 한 자릿수라 호출 비용이 무시할 만한 데다,
    // 캐시를 두면 "껐는데 왜 아직 도나" 라는 혼란 지점이 생긴다. 즉시 들어야 킬스위치다.
    let activeSites: Set<string>;
    try {
      activeSites = new Set(await this.salesChannelClient.getActiveSites());
    } catch (error) {
      // fail-closed. 건너뛰기는 무손실이다 — 아래 루프에 들어가지 않으므로 워터마크가 그대로고,
      // core 가 복구되면 그 구간을 그대로 따라잡는다. 반대로 열어두면 "끈 채널이 계속 도는"
      // 상태가 되는데 그게 이 게이트가 없애려는 상태 그 자체다.
      this.logger.error(
        `활성 판매채널 조회에 실패해 이번 주기의 모든 채널을 건너뛴다 (워터마크 불변): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    for (const provider of this.providers) {
      const channelType = provider.channel as ChannelType;

      // 비활성 채널은 **아무것도 하기 전에** 빠진다. recordSyncStart 아래로 내려가면 워터마크가
      // 전진해 꺼둔 기간의 주문을 영구히 잃는다.
      if (!activeSites.has(provider.channel)) {
        this.logger.log(`채널 ${provider.channel} 은 비활성(sales_channels.is_active=false)이라 이번 주기를 건너뛴다.`);
        continue;
      }

      try {
        const syncStatus = await this.syncStatusService.getSyncStatus(channelType, 'orders');
        const since = this.applyWatermarkLookback(syncStatus?.lastSyncAt ?? null);

        await this.syncStatusService.recordSyncStart(channelType, 'orders');

        const startTime = Date.now();
        const { orders, failures, lifecycleEvents = [] } = await provider.fetchOrders(since);
        const orderedItems: OrderedPollItem[] = [
          ...orders.map((item) => ({ kind: 'order' as const, item })),
          ...failures.map((item) => ({ kind: 'failure' as const, item })),
          ...lifecycleEvents.map((item) => ({ kind: 'lifecycle' as const, item })),
        ].sort((a, b) => {
          const byTime = new Date(a.item.sourceUpdatedAt).getTime() - new Date(b.item.sourceUpdatedAt).getTime();
          if (byTime !== 0) return byTime;
          return this.pollItemPriority(a.kind) - this.pollItemPriority(b.kind);
        });

        // 이미 수집된 주문의 식별 실패는 격리 대상이 아니다 (#647). 폴링당 한 번만 조회한다.
        const collectedOrders = await this.findCollectedOrders(
          provider.channel,
          failures.map((failure) => failure.externalOrderId),
        );

        let emitted = 0;
        let dedupedUnchanged = 0;
        let quarantined = 0;
        let skippedAlreadyCollected = 0;
        const skippedExternalOrderIds: string[] = [];
        let lifecycleRecorded = 0;
        let watermark: Date | null = null;
        // An unrecorded lifecycle observation (no Core mapping yet) for an order that is still
        // collectable — currently quarantined and awaiting replay — must NOT let the durable
        // watermark move past it. The replay path only reprocesses the order candidate, never its
        // lifecycle events, so advancing past such an observation drops the refund/cancel signal
        // permanently once the order falls outside the lookback window. We therefore hold the
        // watermark below the earliest such observation until the order is collected and the
        // signal is recorded. A lifecycle observation whose order is NOT collectable (terminal
        // lifecycle-only snapshot: refunded/canceled and never collected) advances normally, so
        // terminal snapshots can't stall the poller forever.
        let watermarkHeldAt: Date | null = null;

        // 이 폴링에서 실제로 격리된 주문들. 매핑이 없고 replay 로 수집될 예정이므로 그
        // lifecycle 관측은 종결이 아니라 일시적이다.
        // 건너뛸 항목은 제외한다. 사실 이 filter 는 현재 불변식상 no-op 이다 — 매핑이 있으면
        // `processLifecycleItem` 이 같은 술어로 매핑을 찾아 `recorded: true` 를 내므로 아래
        // `has()` 분기에 애초에 도달하지 않는다. 그래도 남겨둔다: 두 조회의 술어가 갈리는 날
        // 이 filter 가 없으면 기수집 주문 때문에 워터마크가 묶인다.
        const quarantinedExternalOrderIds = new Set(
          failures
            .filter((failure) => !this.isAlreadyCollectedIdentificationFailure(failure, collectedOrders))
            .map((failure) => failure.externalOrderId),
        );

        const advanceWatermark = (sourceUpdatedAt: string) => {
          const itemTimestamp = this.toValidDate(sourceUpdatedAt);
          if (!itemTimestamp) {
            return;
          }
          if (watermarkHeldAt && itemTimestamp >= watermarkHeldAt) {
            return;
          }
          watermark = this.maxDate(watermark, sourceUpdatedAt);
        };
        const holdWatermark = (sourceUpdatedAt: string) => {
          const itemTimestamp = this.toValidDate(sourceUpdatedAt);
          if (!itemTimestamp) {
            return;
          }
          watermarkHeldAt = this.minDate(watermarkHeldAt, itemTimestamp);
        };

        for (const orderedItem of orderedItems) {
          if (orderedItem.kind === 'failure') {
            if (this.isAlreadyCollectedIdentificationFailure(orderedItem.item, collectedOrders)) {
              // 만들 주문이 이미 있다. 변경 여부는 계산할 수 없다 — 라인을 식별하지 못하면
              // 변경 해시의 입력이 빈 식별자로 채워져 의미 없는 값이 된다.
              //
              // 옛 코드가 남긴 격리가 열려 있으면 여기서 닫는다. 그러지 않으면 이 주문은
              // 앞으로 계속 건너뛰어지므로 그 행을 닫아줄 경로가 영영 없다 — 일회성 스크립트가
              // 놓친 행(배포와 스크립트 실행 사이에 생긴 행 등)이 고아로 남는다.
              await this.closeOpenQuarantineAsCollected(
                provider.channel,
                orderedItem.item.externalOrderId,
                collectedOrders.get(orderedItem.item.externalOrderId),
              );
              skippedAlreadyCollected++;
              skippedExternalOrderIds.push(orderedItem.item.externalOrderId);
              advanceWatermark(orderedItem.item.sourceUpdatedAt);
              continue;
            }
            await this.orderCollectionFailureService.recordFailure(provider.channel, orderedItem.item);
            quarantined++;
            advanceWatermark(orderedItem.item.sourceUpdatedAt);
            continue;
          }

          if (orderedItem.kind === 'lifecycle') {
            const result = await this.processLifecycleItem(provider, orderedItem.item);
            emitted += result.emitted;
            dedupedUnchanged += result.dedupedUnchanged;
            lifecycleRecorded += result.emitted;
            if (!result.recorded && quarantinedExternalOrderIds.has(orderedItem.item.externalOrderId)) {
              // Still collectable: the order is re-quarantined this poll (eligible, mapping gap not
              // yet fixed). Hold the watermark so the observation is not lost before collection.
              holdWatermark(orderedItem.item.sourceUpdatedAt);
            } else {
              // Recorded, or terminal. A terminal observation whose order carried an orphaned
              // quarantine from an earlier poll (it has since gone canceled/refunded and is no
              // longer eligible) must close that quarantine — otherwise it is left open for a
              // replay that can never collect it, and the terminal signal is durably lost. Closing
              // it records the terminal outcome, so the watermark can safely advance.
              if (!result.recorded) {
                await this.resolveOrphanedQuarantine(provider.channel, orderedItem.item);
              }
              advanceWatermark(orderedItem.item.sourceUpdatedAt);
            }
            continue;
          }

          const result = await this.processOrderItem(provider, orderedItem.item);
          emitted += result.emitted;
          dedupedUnchanged += result.dedupedUnchanged;
          advanceWatermark(orderedItem.item.sourceUpdatedAt);
        }

        if (skippedAlreadyCollected > 0) {
          // 기대되는 정상 상태다 — 사라진 Medusa variant 를 가진 기수집 주문이 재폴링되면 매번
          // 발생한다. warn 으로 올리면 바로 아래 진짜 격리 warn 이 묻힌다.
          //
          // 건너뛴 항목은 행을 남기지 않으므로 **이 로그가 유일한 흔적**이다. 그래서 개수만이
          // 아니라 주문 id 를 싣는다(상한을 둔다).
          const sample = skippedExternalOrderIds.slice(0, SKIPPED_LOG_SAMPLE_SIZE);
          const suffix = skippedExternalOrderIds.length > sample.length ? ', …' : '';
          this.logger.log(
            `[${provider.channel}] Skipped ${skippedAlreadyCollected} identification failures for orders already collected into Core (#647): ${sample.join(', ')}${suffix}`,
          );
        }

        if (quarantined > 0) {
          this.logger.warn(
            `[${provider.channel}] Quarantined ${quarantined} order collection failures due to missing PIM identity metadata`,
          );
        }

        await this.syncStatusService.recordSyncComplete(channelType, 'orders', {
          eventCount: emitted,
          processingTime: Date.now() - startTime,
          watermark,
        });

        this.logger.log(
          `[${provider.channel}] Polled ${orders.length} order candidates (emitted: ${emitted}, lifecycle: ${lifecycleRecorded}, deduped: ${dedupedUnchanged}, quarantined: ${quarantined}, skippedAlreadyCollected: ${skippedAlreadyCollected})`,
        );
      } catch (error) {
        await this.syncStatusService.recordSyncFailure(channelType, 'orders', {
          message: error.message,
        });
        this.logger.error(`[${provider.channel}] Order polling failed: ${error.message}`);
      }
    }
  }

  async replayFailure(failureId: string): Promise<{
    status:
      | 'replayed'
      | 'already_processed'
      | 'still_quarantined'
      | 'closed_terminal'
      | 'closed_already_collected'
      | 'not_found_or_not_payment_accepted'
      | 'not_replayable';
    failureId: string;
    externalOrderId: string;
    emitted: number;
    dedupedUnchanged: number;
  } | null> {
    const failure = await this.orderCollectionFailureService.findById(failureId);
    if (!failure) {
      return null;
    }

    if (failure.reason === COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED) {
      return {
        status: 'not_replayable',
        failureId,
        externalOrderId: failure.externalOrderId,
        emitted: 0,
        dedupedUnchanged: 0,
      };
    }

    const provider = this.providers.find((candidate) => candidate.channel === failure.channel);
    if (!provider || !this.isReplayableProvider(provider)) {
      throw new Error(`No replayable order provider registered for channel: ${failure.channel}`);
    }

    const fetched = await provider.fetchOrder(failure.externalOrderId);
    if (!fetched) {
      return {
        status: 'not_found_or_not_payment_accepted',
        failureId,
        externalOrderId: failure.externalOrderId,
        emitted: 0,
        dedupedUnchanged: 0,
      };
    }

    if (fetched.kind === 'failure') {
      // 이미 Core 에 있는 주문이면 replay 로 할 일이 없다. 다시 격리하면 status 가
      // `quarantined` 로 되돌아가(`recordFailure` 의 onConflictDoUpdate) 운영자가 같은 자리를
      // 영원히 맴돈다 — 실측된 117건이 정확히 그 상태였다 (#647).
      const collected = await this.findCollectedOrders(provider.channel, [failure.externalOrderId]);
      const wmsOrderId = collected.get(failure.externalOrderId);
      if (wmsOrderId) {
        // 문구는 **관측한 사실만** 말한다. 여기서 아는 것은 "지금 매핑이 있다" 뿐이고,
        // "격리보다 먼저 있었다" 는 아니다 — 진짜 격리가 나중에 해소된 행도 이 경로로 온다.
        await this.orderCollectionFailureService.closeAsAlreadyCollected(
          failure.id,
          `Closed on replay: order ${failure.externalOrderId} already has a Core sales order (${wmsOrderId}), so there is nothing to collect`,
          wmsOrderId,
        );
        return {
          status: 'closed_already_collected',
          failureId,
          externalOrderId: failure.externalOrderId,
          emitted: 0,
          dedupedUnchanged: 0,
        };
      }

      await this.orderCollectionFailureService.recordFailure(provider.channel, fetched.failure);
      return {
        status: 'still_quarantined',
        failureId,
        externalOrderId: failure.externalOrderId,
        emitted: 0,
        dedupedUnchanged: 0,
      };
    }

    // The order is no longer eligible for collection (canceled/refunded since it was quarantined).
    // processOrderItem would just skip it and report still_quarantined forever, leaving the
    // operator stuck. Close the quarantine as a terminal lifecycle outcome instead.
    if (fetched.order.eligibleForOrderCreation === false) {
      await this.orderCollectionFailureService.closeAsTerminalLifecycle(
        failure.id,
        `Closed on replay: order ${failure.externalOrderId} reached a terminal lifecycle and is no longer collectable`,
      );
      return {
        status: 'closed_terminal',
        failureId,
        externalOrderId: failure.externalOrderId,
        emitted: 0,
        dedupedUnchanged: 0,
      };
    }

    const result = await this.processOrderItem(provider, fetched.order);
    if (!result.wmsOrderId) {
      return {
        status: 'still_quarantined',
        failureId,
        externalOrderId: failure.externalOrderId,
        emitted: result.emitted,
        dedupedUnchanged: result.dedupedUnchanged,
      };
    }

    await this.orderCollectionFailureService.markReplayed(failure.id, result.wmsOrderId);

    return {
      status: result.emitted > 0 ? 'replayed' : 'already_processed',
      failureId,
      externalOrderId: failure.externalOrderId,
      emitted: result.emitted,
      dedupedUnchanged: result.dedupedUnchanged,
    };
  }

  private async processOrderItem(provider: ChannelOrderProvider, item: OrderFetchItem): Promise<ProcessPollItemResult> {
    const mapping = await this.db.db
      .select()
      .from(wmsOrderMappings)
      .where(
        and(
          eq(wmsOrderMappings.salesChannel, provider.channel),
          eq(wmsOrderMappings.channelOrderId, item.externalOrderId),
        ),
      )
      .limit(1);

    if (!mapping[0]) {
      if (item.eligibleForOrderCreation === false) {
        // Lifecycle-only snapshot (e.g. canceled/refunded) that was never collected: do not
        // seed a Core order. This is terminal — the snapshot will never become collectable —
        // so the caller still advances the watermark past it rather than re-polling forever.
        this.logger.warn(
          `[${provider.channel}] Skipping ${item.externalOrderId}: lifecycle snapshot is not eligible for OrderCreated`,
        );
        return {
          emitted: 0,
          dedupedUnchanged: 0,
        };
      }

      const payload = item.createPayload;

      const created = await this.db.db.transaction(async (tx) => {
        const insertedMappings = await tx
          .insert(wmsOrderMappings)
          .values({
            salesChannel: provider.channel,
            channelOrderId: payload.externalOrderId ?? payload.orderId,
            wmsOrderId: payload.orderId,
          })
          .onConflictDoNothing()
          .returning();

        if (!insertedMappings[0]) {
          return false;
        }

        // 공용 아웃박스에 적재 (ADR-0029 §5-1, Task 6-C-3). 매핑 insert 와 **같은 트랜잭션**
        // 이라는 성질이 그대로다 — 그것이 이 경로의 요점이다. 매핑만 남고 이벤트가 사라지면
        // 그 주문은 "수집됨" 으로 굳어 영영 재발행되지 않는다.
        //
        // `metadata` 의 `causedBy` 는 싣지 않는다. 옛 디스패처가 행의 metadata 컬럼을 읽지
        // 않고 `{ partitionKey }` 만 envelope 에 넣었으므로 **한 번도 나간 적이 없는 값**이고,
        // 회수는 나가는 envelope 를 바꾸지 않는다. (인과 추적을 켤 거면 `publishEvent` 의
        // `causedBy` 파라미터가 그 자리이고, 그건 이 조각의 범위 밖이다.)
        await this.ordersPublisher.enqueue(
          {
            eventType: 'OrderCreated',
            aggregateId: payload.orderId,
            payload,
            partitionKey: provider.channel,
            metadata: { partitionKey: provider.channel },
          },
          tx,
        );

        // 첫 폴링 직후의 후속 폴링이 동일 페이로드로 OrderModified를 오발행하지 않도록
        // 생성 시점의 변경-기준 콘텐츠 해시를 함께 기록해둔다.
        const initialChangeContent = {
          items: payload.items,
          shippingAddress: payload.shippingAddress,
          totalAmount: payload.totalAmount,
        };
        await this.pollingHashService.upsert(
          provider.channel,
          POLLING_RESOURCE_TYPE_ORDER,
          payload.externalOrderId ?? payload.orderId,
          this.pollingHashService.computeHash(initialChangeContent),
          tx,
        );
        return true;
      });

      return {
        emitted: created ? 1 : 0,
        dedupedUnchanged: 0,
        wmsOrderId: created ? payload.orderId : undefined,
      };
    }

    // 이미 Core로 넘긴 Medusa 주문 변경은 자동 반영하지 않는다.
    // 무의미한 updated_at bump는 hash로 거르고, 실제 변경은 운영 예외로 격리한다.
    const newHash = this.pollingHashService.computeHash(item.changes);

    // lifecycle 경로와 같은 이유로 확인과 기록이 한 트랜잭션·한 문장이다 (#599).
    const claimed = await this.db.db.transaction(async (tx) => {
      // 격리 저장보다 **먼저** 선점한다. 같은 트랜잭션이므로 격리가 실패하면 선점도 함께
      // 롤백되고, 다음 폴링이 다시 시도한다 — 옛 코드의 "성공 후에만 갱신" 성질이 그대로다.
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

      await this.orderCollectionFailureService.recordFailure(
        provider.channel,
        {
          externalOrderId: item.externalOrderId,
          sourceUpdatedAt: item.sourceUpdatedAt,
          reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
          affectedLineIds: item.changes.items.flatMap((line) => (line.orderItemId ? [line.orderItemId] : [])),
          rawOrder: {
            externalOrderId: item.externalOrderId,
            wmsOrderId: mapping[0].wmsOrderId,
            modifiedAt: item.modifiedAt,
            changes: item.changes,
            policy: 'Medusa order changes are not accepted after channel-adapter has collected the order.',
          },
        },
        tx,
      );

      // 해시 기록은 `claimChanged` 가 이미 같은 트랜잭션에서 끝냈다.
      return true;
    });

    return {
      emitted: 0,
      dedupedUnchanged: claimed ? 0 : 1,
      wmsOrderId: mapping[0].wmsOrderId,
    };
  }

  private async processLifecycleItem(
    provider: ChannelOrderProvider,
    item: OrderLifecycleEventItem,
  ): Promise<ProcessPollItemResult> {
    const mapping = await this.db.db
      .select()
      .from(wmsOrderMappings)
      .where(
        and(
          eq(wmsOrderMappings.salesChannel, provider.channel),
          eq(wmsOrderMappings.channelOrderId, item.externalOrderId),
        ),
      )
      .limit(1);

    if (!mapping[0]) {
      // No Core mapping yet. The caller decides whether this is terminal (advance the watermark)
      // or transient (the order is quarantined and will be collected via replay, so hold the
      // watermark until the signal can be recorded). Either way there is nothing to emit now.
      this.logger.warn(
        `[${provider.channel}] Skipping ${item.eventType} for uncollected order ${item.externalOrderId}`,
      );
      return { emitted: 0, dedupedUnchanged: 0, recorded: false };
    }

    const payload = {
      orderId: mapping[0].wmsOrderId,
      ...item.payload,
    };
    const lifecycleResourceId = `${item.externalOrderId}:${item.eventKey}`;
    const newHash = this.pollingHashService.computeHash({
      eventType: item.eventType,
      payload,
      rawEvent: item.rawEvent,
    });
    const wmsOrderId = mapping[0].wmsOrderId;

    // 해시 확인이 **트랜잭션 안**이고, 검사와 기록이 한 문장이다 (#599). 밖에서 읽고 안에서
    // 쓰면 겹쳐 도는 두 폴이 같은 옛 해시를 보고 둘 다 발행한다 — 라이브에서 실제로 발생했다.
    const claimed = await this.db.db.transaction(async (tx) => {
      const won = await this.pollingHashService.claimChanged(
        provider.channel,
        POLLING_RESOURCE_TYPE_ORDER_LIFECYCLE,
        lifecycleResourceId,
        newHash,
        tx,
      );
      if (!won) {
        return false;
      }

      // 이벤트 키마다 payload 타입이 다르므로 **분기해서** 적재한다. `OrderLifecycleEventItem`
      // 이 판별 유니온이라 각 가지에서 `item.payload` 가 알아서 좁혀진다 — 캐스팅이 없다.
      // metadata 를 `{ partitionKey }` 로 두는 근거는 `enqueueOrderCreated` 와 같다.
      const common = {
        aggregateId: wmsOrderId,
        partitionKey: provider.channel,
        metadata: { partitionKey: provider.channel },
      };

      // 채널 키 (#656). `wmsOrderId` 는 여기서 만든 id 라 **core 의 `sales_orders.id` 가 아니다** —
      // core 는 SO 를 만들 때 자체 PK 를 새로 발급한다. 이 두 필드가 없으면 core 가 SO 를 찾지
      // 못해 취소/환불이 전량 NotFound 로 DLQ 에 쌓인다. `OrderCreated` 가 쓰는 축과 같다.
      const channelKey = {
        salesChannel: provider.channel,
        externalOrderId: item.externalOrderId,
      };

      if (item.eventType === 'OrderCancelled') {
        const cancelled: OrderCancelledPayload = { orderId: wmsOrderId, ...channelKey, ...item.payload };
        await this.ordersPublisher.enqueue({ eventType: 'OrderCancelled', payload: cancelled, ...common }, tx);
      } else {
        const refunded: OrderRefundCreatedPayload = { orderId: wmsOrderId, ...channelKey, ...item.payload };
        await this.ordersPublisher.enqueue({ eventType: 'OrderRefundCreated', payload: refunded, ...common }, tx);
      }

      // 해시 기록은 `claimChanged` 가 이미 같은 트랜잭션에서 끝냈다 — 여기서 또 쓰지 않는다.
      return true;
    });

    if (!claimed) {
      return {
        emitted: 0,
        dedupedUnchanged: 1,
        recorded: true,
        wmsOrderId,
      };
    }

    return {
      emitted: 1,
      dedupedUnchanged: 0,
      recorded: true,
      wmsOrderId,
    };
  }

  private isReplayableProvider(provider: ChannelOrderProvider): provider is ReplayableChannelOrderProvider {
    return typeof (provider as ReplayableChannelOrderProvider).fetchOrder === 'function';
  }

  /**
   * A terminal lifecycle event (cancel/refund) was observed for an order with no Core mapping that
   * is NOT re-quarantined this poll. If it still has an open quarantine from an earlier poll, the
   * order went terminal before its mapping gap was fixed — it can never be collected, so close the
   * quarantine to record the terminal outcome and stop a replay from getting stuck on it.
   */
  /**
   * 이미 수집된 주문에 열려 있는 격리가 있으면 닫는다 (#647).
   *
   * `resolveOrphanedQuarantine`(terminal lifecycle 로 닫는 쪽)과 짝을 이룬다. 이쪽이 없으면
   * 수정 배포 이후 그 주문은 계속 건너뛰어지므로 옛 행을 닫아줄 경로가 사라진다.
   */
  private async closeOpenQuarantineAsCollected(
    channel: string,
    externalOrderId: string,
    wmsOrderId: string | undefined,
  ): Promise<void> {
    const open = await this.orderCollectionFailureService.findOpenByExternalOrderId(channel, externalOrderId);
    if (!open) {
      return;
    }
    await this.orderCollectionFailureService.closeAsAlreadyCollected(
      open.id,
      `Closed on poll: order ${externalOrderId} already has a Core sales order, so this quarantine is not actionable`,
      wmsOrderId,
    );
    this.logger.log(`[${channel}] Closed stale quarantine for already-collected order ${externalOrderId}`);
  }

  private async resolveOrphanedQuarantine(channel: string, item: OrderLifecycleEventItem): Promise<void> {
    const open = await this.orderCollectionFailureService.findOpenByExternalOrderId(channel, item.externalOrderId);
    if (!open) {
      return;
    }
    await this.orderCollectionFailureService.closeAsTerminalLifecycle(
      open.id,
      `Closed by ${item.eventType} (${item.eventKey}): order reached a terminal lifecycle before collection`,
    );
    this.logger.warn(
      `[${channel}] Closed orphaned quarantine for ${item.externalOrderId} after ${item.eventType}; order is no longer collectable`,
    );
  }

  /**
   * 주어진 채널 주문 ID 중 **이미 Core 판매주문이 만들어진** 것들을 돌려준다 (#647).
   *
   * 왜 필요한가: 폴러는 `updated_at > 워터마크` 로 묻기 때문에 이미 수집한 주문도 바뀌면 다시 온다.
   * 그때 라인 식별에 실패하면 — Medusa 는 주문 라인에 상품 정보를 비정규화해 두므로 원본 variant 가
   * 사라지면 평면 필드만 남고 식별자는 증발한다 — 번역기는 그 사실만 알고 격리 후보로 올린다.
   * 번역기는 DB 를 볼 수 없으므로 "이미 수집했나" 는 여기서만 답할 수 있다.
   */
  private async findCollectedOrders(channel: string, externalOrderIds: string[]): Promise<Map<string, string>> {
    if (externalOrderIds.length === 0) {
      return new Map();
    }

    const rows = await this.db.db
      .select({ channelOrderId: wmsOrderMappings.channelOrderId, wmsOrderId: wmsOrderMappings.wmsOrderId })
      .from(wmsOrderMappings)
      .where(
        and(eq(wmsOrderMappings.salesChannel, channel), inArray(wmsOrderMappings.channelOrderId, externalOrderIds)),
      );

    return new Map(rows.map((row) => [row.channelOrderId, row.wmsOrderId]));
  }

  /**
   * 이 격리 후보가 "이미 수집됨" 으로 건너뛸 대상인지. **사유를 함께 본다** — 식별 실패만
   * 이 규칙의 대상이다. `collected_order_modification_not_accepted` 는 정의상 항상 매핑을
   * 갖고 있으므로, 사유를 안 보면 그 격리 레인 전체가 조용히 죽는다.
   */
  private isAlreadyCollectedIdentificationFailure(
    item: OrderCollectionFailureItem,
    collected: Map<string, string>,
  ): boolean {
    return item.reason === CHANNEL_PRODUCT_IDENTIFICATION_FAILED && collected.has(item.externalOrderId);
  }

  private applyWatermarkLookback(since: Date | null): Date | null {
    if (!since) {
      return null;
    }

    return new Date(Math.max(0, since.getTime() - WATERMARK_LOOKBACK_MS));
  }

  private maxDate(current: Date | null, value: string): Date | null {
    const next = new Date(value);
    if (Number.isNaN(next.getTime())) {
      return current;
    }
    if (!current || next > current) {
      return next;
    }
    return current;
  }

  private minDate(current: Date | null, value: Date): Date {
    if (!current || value < current) {
      return value;
    }
    return current;
  }

  private toValidDate(value: string): Date | null {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private pollItemPriority(kind: OrderedPollItem['kind']): number {
    if (kind === 'order') return 0;
    if (kind === 'failure') return 1;
    return 2;
  }
}
