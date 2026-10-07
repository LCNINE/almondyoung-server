import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { eq, and, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectPublisher, PublisherFor } from '@app/events';
import {
  ORDER_STREAM,
  OrderCancelledPayload,
  OrderRefundCreatedPayload,
  SalesChannel,
} from '@packages/event-contracts/streams';
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
  OrderFetchOutcome,
  OrderLifecycleEventItem,
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderProcessingFailureItem,
  OrderProcessingStage,
  OrderSyncFetch,
  ReplayableChannelOrderProvider,
  SyncableChannelOrderProvider,
} from './channel-order-provider.interface';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';
import {
  OrderCollectionFailureService,
  PROCESSING_FAILURE_MAX_ATTEMPTS,
  PROCESSING_FAILURE_RETRY_BATCH,
} from './order-collection-failure.service';
import { OrderProcessingStageError, errorMessage } from './order-processing-stage.error';
import { OrderCollectionFailure } from '../../types';
import { SalesChannelClient } from '../clients/sales-channel.client';

const POLLING_RESOURCE_TYPE_ORDER = 'order';
const POLLING_RESOURCE_TYPE_ORDER_LIFECYCLE = 'order_lifecycle';
const WATERMARK_LOOKBACK_MS = 2 * 60 * 1000;
/** 건너뛴 주문 id 를 로그에 싣되 한 줄이 무한정 길어지지 않게 자른다. */
const SKIPPED_LOG_SAMPLE_SIZE = 20;

type OrderedPollItem =
  | { kind: 'order'; item: OrderFetchItem }
  | { kind: 'failure'; item: OrderCollectionFailureItem }
  | { kind: 'processing_failure'; item: OrderProcessingFailureItem }
  | { kind: 'lifecycle'; item: OrderLifecycleEventItem };

type ProcessPollItemResult = {
  emitted: number;
  dedupedUnchanged: number;
  wmsOrderId?: string;
  // Lifecycle items only: whether the observation was durably recorded (a Core mapping existed).
  // false means it was skipped for a missing mapping and may need the watermark held.
  recorded?: boolean;
  // 이번 호출이 매핑을 새로 만들었는가(OrderCreated). 즉시 끌어오기의 응답을 가른다.
  created?: boolean;
};

/** 즉시 끌어오기의 결과 (스펙 §9.1 의 네 값 + 계획 단계에서 더한 셋). */
export type OrderSyncOutcome =
  | 'unchanged'
  | 'emitted'
  | 'created'
  | 'not_found'
  | 'not_eligible'
  | 'identification_failed'
  | 'channel_inactive';

/** 즉시 끌어오기·재시도·replay 가 함께 쓰는 처리부의 결과. */
type SyncFetchResult = { outcome: OrderSyncOutcome; emitted: number; dedupedUnchanged: number; wmsOrderId?: string };

/** 처리 실패 행 하나를 되살린 결과 — `replayFailure` 응답 status 와 같은 어휘다 (스펙 §6.3). */
type ProcessingRetryStatus =
  | 'replayed'
  | 'already_processed'
  | 'closed_terminal'
  | 'moved_to_identification_quarantine'
  | 'still_quarantined';

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

  @CronOnce('*/5 * * * *', { name: 'order-poll' })
  async poll(): Promise<void> {
    if (this.providers.length === 0) return;
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
        // 자동 재시도는 이번 주기 **전에** 갱신된 행만 고른다 — 이번 주기에 막 실패한 주문을 같은 주기에 또 치지 않는다 (스펙 §6.1).
        const cycleStartedAt = new Date();
        const syncStatus = await this.syncStatusService.getSyncStatus(channelType, 'orders');
        const since = this.applyWatermarkLookback(syncStatus?.lastSyncAt ?? null);

        await this.syncStatusService.recordSyncStart(channelType, 'orders');

        const startTime = Date.now();
        const {
          orders,
          failures,
          lifecycleEvents = [],
          processingFailures = [],
          completedWindowEnd,
        } = await provider.fetchOrders(since);
        const orderedItems: OrderedPollItem[] = [
          ...orders.map((item) => ({ kind: 'order' as const, item })),
          ...failures.map((item) => ({ kind: 'failure' as const, item })),
          ...processingFailures.map((item) => ({ kind: 'processing_failure' as const, item })),
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
        // 이전 주기에 처리에 실패해 열려 있는 행. 이번 주기에 그 주문이 성공하면 닫는다 (#1016 1번 행 스펙 §5.4).
        const openProcessingFailures = await this.orderCollectionFailureService.findOpenProcessingFailures(
          provider.channel,
          [...new Set(orderedItems.map((entry) => entry.item.externalOrderId))],
        );

        let emitted = 0;
        let dedupedUnchanged = 0;
        let quarantined = 0;
        let skippedAlreadyCollected = 0;
        const skippedExternalOrderIds: string[] = [];
        let lifecycleRecorded = 0;
        let processingFailed = 0;
        // 이번 주기에 처리에 실패한 주문. 같은 주문의 남은 항목은 건너뛴다 — 되살릴 때 주문과 lifecycle 을
        // 통째로 다시 가져오므로 잃지 않고, 건너뛰지 않으면 그 주문의 lifecycle 이 매핑을 못 찾아 «종결»로
        // 판정돼 방금 만든 실패 행을 닫아 버린다 (스펙 §5.2).
        const failedExternalOrderIds = new Set<string>();
        // 이번 주기에 항목이 성공한 주문. 열린 처리 실패 행을 닫는 근거다.
        const succeededOrders = new Map<string, { wmsOrderId?: string; terminal: boolean }>();
        const noteSucceeded = (externalOrderId: string, wmsOrderId: string | undefined, terminal: boolean) => {
          const previous = succeededOrders.get(externalOrderId);
          succeededOrders.set(externalOrderId, {
            wmsOrderId: wmsOrderId ?? previous?.wmsOrderId,
            terminal: terminal || (previous?.terminal ?? false),
          });
        };
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
        // 기록했으면 지나간다. 기록이 throw 하면 그대로 바깥 catch 로 가서 주기 전체가 실패하고 워터마크가
        // 멈춘다 — 그때는 DB 장애라 멈추는 게 맞다 (스펙 D4).
        const recordItemFailure = async (failure: OrderProcessingFailureItem) => {
          await this.recordProcessingFailure(provider.channel, failure);
          failedExternalOrderIds.add(failure.externalOrderId);
          processingFailed++;
          advanceWatermark(failure.sourceUpdatedAt);
        };

        for (const orderedItem of orderedItems) {
          if (failedExternalOrderIds.has(orderedItem.item.externalOrderId)) {
            advanceWatermark(orderedItem.item.sourceUpdatedAt);
            continue;
          }

          if (orderedItem.kind === 'processing_failure') {
            await recordItemFailure(orderedItem.item);
            continue;
          }

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
            let result: ProcessPollItemResult;
            try {
              result = await this.processLifecycleItem(provider, orderedItem.item);
            } catch (error) {
              await recordItemFailure({
                externalOrderId: orderedItem.item.externalOrderId,
                sourceUpdatedAt: orderedItem.item.sourceUpdatedAt,
                stage: 'enqueue_lifecycle',
                error: errorMessage(error),
                input: lifecycleInput(orderedItem.item),
              });
              continue;
            }
            if (result.recorded) {
              noteSucceeded(orderedItem.item.externalOrderId, result.wmsOrderId, false);
            }
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

          let result: ProcessPollItemResult;
          try {
            result = await this.processOrderItem(provider, orderedItem.item);
          } catch (error) {
            await recordItemFailure({
              externalOrderId: orderedItem.item.externalOrderId,
              sourceUpdatedAt: orderedItem.item.sourceUpdatedAt,
              stage: 'enqueue_order',
              error: errorMessage(error),
              input: orderInput(orderedItem.item),
            });
            continue;
          }
          emitted += result.emitted;
          dedupedUnchanged += result.dedupedUnchanged;
          noteSucceeded(
            orderedItem.item.externalOrderId,
            result.wmsOrderId,
            orderedItem.item.eligibleForOrderCreation === false,
          );
          advanceWatermark(orderedItem.item.sourceUpdatedAt);
        }

        await this.closeRecoveredProcessingFailures(openProcessingFailures, failedExternalOrderIds, succeededOrders);

        // 🔴 조용한 창은 워터마크를 영원히 묶는다. 닫힌 조회 창(`[since, since+24h]`)을 쓰는
        // source 는 그 창에 변경이 하나도 없으면 항목 0건을 낸다 — 그러면 워터마크가 `null` 로
        // 남고 `recordSyncComplete` 는 `lastSyncAt` 을 건드리지 않으므로 다음 주기가 **같은 닫힌
        // 창**을 다시 묻는다. 조용한 24시간 하나가 수집을 영구히 정지시키는 것이다.
        //
        // 항목이 하나라도 있었으면 그 항목들의 시각이 워터마크의 근거이므로 여기 오지 않는다.
        // 즉 이 갈래는 "아무것도 없었다" 는 사실만 다루며, 그때 `watermarkHeldAt` 도 정의상 없다.
        // 열린 질의를 쓰는 source(Medusa)는 `completedWindowEnd` 를 내지 않으므로 무영향이다.
        if (orderedItems.length === 0 && completedWindowEnd) {
          watermark = completedWindowEnd;
          this.logger.log(
            `[${provider.channel}] 변경 0건 — 완료한 조회 창 끝(${completedWindowEnd.toISOString()})으로 워터마크를 전진시킨다.`,
          );
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

        if (processingFailed > 0) {
          this.logger.warn(
            `[${provider.channel}] ${processingFailed}건의 주문이 처리에 실패해 그 주문만 격리했다 — 나머지는 수집했다 (#1016 1번 행)`,
          );
        }

        await this.syncStatusService.recordSyncComplete(channelType, 'orders', {
          eventCount: emitted,
          processingTime: Date.now() - startTime,
          watermark,
        });

        this.logger.log(
          `[${provider.channel}] Polled ${orders.length} order candidates (emitted: ${emitted}, lifecycle: ${lifecycleRecorded}, deduped: ${dedupedUnchanged}, quarantined: ${quarantined}, skippedAlreadyCollected: ${skippedAlreadyCollected}, processingFailed: ${processingFailed})`,
        );

        // 워터마크를 확정한 **뒤**에 돈다. 재시도가 터져도 이 채널의 sync 상태가 «실패»로 바뀌지 않는다 (스펙 §6.1).
        try {
          await this.retryProcessingFailures(provider, cycleStartedAt);
        } catch (error) {
          this.logger.error(`[${provider.channel}] 처리 실패 자동 재시도 중단: ${errorMessage(error)}`);
        }
      } catch (error) {
        await this.syncStatusService.recordSyncFailure(channelType, 'orders', {
          message: error.message,
        });
        this.logger.error(`[${provider.channel}] Order polling failed: ${error.message}`);
      }
    }
  }

  /**
   * Ingest an explicitly supplied provider without advancing channel polling watermarks.
   * Demo runs use this entrypoint so they retain the canonical mapping + typed transactional
   * outbox boundary while avoiding a second raw-Kafka or direct business-table path.
   */
  async ingestProvider(
    provider: ChannelOrderProvider,
  ): Promise<Array<{ externalOrderId: string; orderId: string; enqueued: boolean }>> {
    const { orders, failures, lifecycleEvents = [] } = await provider.fetchOrders(null);
    if (failures.length > 0 || lifecycleEvents.length > 0) {
      throw new Error('Explicit order ingestion accepts order candidates only');
    }

    const results: Array<{ externalOrderId: string; orderId: string; enqueued: boolean }> = [];
    for (const order of orders) {
      const result = await this.processOrderItem(provider, order);
      results.push({
        externalOrderId: order.externalOrderId,
        orderId: result.wmsOrderId ?? order.createPayload.orderId,
        enqueued: result.emitted > 0 || result.dedupedUnchanged > 0 || Boolean(result.wmsOrderId),
      });
    }
    return results;
  }

  /**
   * 주문 하나를 지금 채널에서 다시 가져와 폴링과 **같은** 처리를 태운다 (#1016 5번 행, 스펙 §9.1).
   *
   * 워터마크·sync_status 는 건드리지 않는다 — 주문 하나의 관측이라 채널 진행 상태와 무관하다.
   * 비활성 채널은 폴링의 킬스위치와 같은 뜻으로 거절한다. 주문을 먼저 처리해야 그 주문의 lifecycle 이
   * 매핑을 찾는다(폴링 정렬의 order < lifecycle 과 같다).
   */
  async syncOrder(
    channel: SalesChannel,
    externalOrderId: string,
    options: { force?: boolean } = {},
  ): Promise<{ outcome: OrderSyncOutcome }> {
    const activeSites = await this.salesChannelClient.getActiveSites();
    if (!activeSites.includes(channel)) {
      return { outcome: 'channel_inactive' };
    }
    const provider = this.providers.find((candidate) => candidate.channel === channel);
    if (!provider || !this.isSyncableProvider(provider)) {
      throw new Error(`No syncable order provider registered for channel: ${channel}`);
    }
    try {
      const fetched = await provider.fetchOrderForSync(externalOrderId);
      if (!fetched) {
        return { outcome: 'not_found' };
      }
      const { outcome } = await this.processSyncFetch(provider, fetched, options);
      return { outcome };
    } catch (error) {
      // 단계 태그는 처리 실패 행을 채우는 내부 용도다 — 호출자(HTTP·명령 소비자)는 원래 에러를 본다 (스펙 §6.3).
      throw error instanceof OrderProcessingStageError ? error.original : error;
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
      | 'not_replayable'
      | 'moved_to_identification_quarantine';
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

    if (failure.reason === ORDER_COLLECTION_PROCESSING_FAILED) {
      const provider = this.providers.find((candidate) => candidate.channel === failure.channel);
      if (!provider || !this.isSyncableProvider(provider)) {
        throw new Error(`No syncable order provider registered for channel: ${failure.channel}`);
      }
      // 수동 replay 는 상한을 보지 않는다 — 소진된 행을 사람이 되살리는 길이다 (스펙 §6.5).
      const result = await this.retryProcessingFailure(provider, failure);
      return { ...result, failureId, externalOrderId: failure.externalOrderId };
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

  private async processOrderItem(
    provider: ChannelOrderProvider,
    item: OrderFetchItem,
    options: { force?: boolean } = {},
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
        //
        // 🔴 입력은 **`item.changes` 그 자체**여야 한다. 예전엔 `createPayload` 에서 같은 세 값을
        // 다시 조립했는데, 그것은 두 값이 항상 같다는 가정 위에 서 있었다. 취소된 라인이 있는
        // 주문에서 그 가정이 깨진다 — `createPayload.items` 는 살아있는 라인만, `changes.items`
        // 는 전 라인이라 최초 수집 때 이미 취소된 라인이 있으면 저장 해시와 다음 폴링의 해시가
        // 구조적으로 어긋나, 그 주문은 두 번째 폴링에서 `collected_order_modification_not_accepted`
        // 로 오격리된다(그 사유는 replay 가 거부한다).
        //
        // Medusa 는 취소 라인 개념이 없어 두 값이 같은 항목·같은 주소·같은 총액이고,
        // `computeHash` 의 직렬화가 키를 정렬하므로 **저장되는 해시가 바이트 단위로 동일**하다.
        await this.pollingHashService.upsert(
          provider.channel,
          POLLING_RESOURCE_TYPE_ORDER,
          payload.externalOrderId ?? payload.orderId,
          this.pollingHashService.computeHash(item.changes),
          tx,
        );
        return true;
      });

      return {
        emitted: created ? 1 : 0,
        dedupedUnchanged: 0,
        created,
        wmsOrderId: created ? payload.orderId : undefined,
      };
    }

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
      // force(백필 전용, 스펙 §9.1): 해시가 같아도 낸다. 해시는 claimChanged 가 이미 이 값으로 맞춰 두었다.
      // 폴러와 겹치면 같은 스냅샷이 두 번 갈 수 있다 — core 가 두 번째를 실질 차이 0 으로 버린다.
      if (!won && !options.force) {
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
    // 🔴 관측의 정체성은 **`eventKey`** 다 (`LifecycleObservation.eventKey`: "같은 관측을 두 번
    // 세지 않기 위한 채널 내 안정 키"). 그래서 자원 키에 그 값을 넣고, 중복 판정도 payload 가
    // 아니라 **이 자원이 처음인가**로 한다. payload 로 판정하면 네이버 부분취소처럼 형제 라인이
    // 바뀔 때마다 `cancelledAt` 이 따라 움직이는 관측이 매 주기 재발행되고, Core 는 이미 취소된
    // 라인에 `remaining = 0` 으로 `BadRequestException` 을 던져 DLQ 에 쌓인다.
    //
    // Medusa 의 키(`cancelled`, `refund:<id>`)는 이미 안정적이라 payload 도 키마다 고정이었다 —
    // 즉 "해시가 바뀌면 재발행" 과 "처음이면 발행" 이 Medusa 에서는 같은 판정을 낸다. 해시 값
    // 자체도 계속 같은 입력으로 계산해 기록하므로 기존 행의 저장 바이트가 달라지지 않는다.
    const lifecycleResourceId = `${item.externalOrderId}:${item.eventKey}`;
    const newHash = this.pollingHashService.computeHash({
      eventType: item.eventType,
      payload,
      rawEvent: item.rawEvent,
    });
    const wmsOrderId = mapping[0].wmsOrderId;

    // 선점이 **트랜잭션 안**이고, 검사와 기록이 한 문장이다 (#599). 밖에서 읽고 안에서
    // 쓰면 겹쳐 도는 두 폴이 같은 옛 상태를 보고 둘 다 발행한다 — 라이브에서 실제로 발생했다.
    const claimed = await this.db.db.transaction(async (tx) => {
      const won = await this.pollingHashService.claimFirstSeen(
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

      // 기록은 `claimFirstSeen` 이 이미 같은 트랜잭션에서 끝냈다 — 여기서 또 쓰지 않는다.
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

  // 타입 가드 — 선택 메서드의 존재만 본다(isReplayableProvider 와 같은 관례).
  private isSyncableProvider(provider: ChannelOrderProvider): provider is SyncableChannelOrderProvider {
    return typeof (provider as SyncableChannelOrderProvider).fetchOrderForSync === 'function';
  }

  /**
   * 즉시 끌어오기·자동 재시도·수동 replay 가 함께 쓰는 처리부 — 같은 주문을 되살리는 길이 하나다 (스펙 §6.3).
   * 주문을 먼저 처리해야 그 주문의 lifecycle 이 매핑을 찾는다(폴링 정렬의 order < lifecycle 과 같다).
   * 실패는 단계를 실은 `OrderProcessingStageError` 로 던진다.
   */
  private async processSyncFetch(
    provider: ChannelOrderProvider,
    fetched: OrderSyncFetch,
    options: { force?: boolean },
  ): Promise<SyncFetchResult> {
    let result: SyncFetchResult;
    try {
      result = await this.syncFetched(provider, fetched.outcome, options);
    } catch (error) {
      const input =
        fetched.outcome.kind === 'order' ? orderInput(fetched.outcome.order) : fetched.outcome.failure.rawOrder;
      throw new OrderProcessingStageError('enqueue_order', error, input);
    }
    for (const lifecycle of fetched.lifecycle) {
      let lifecycleResult: ProcessPollItemResult;
      try {
        lifecycleResult = await this.processLifecycleItem(provider, lifecycle);
      } catch (error) {
        throw new OrderProcessingStageError('enqueue_lifecycle', error, lifecycleInput(lifecycle));
      }
      result = {
        ...result,
        emitted: result.emitted + lifecycleResult.emitted,
        dedupedUnchanged: result.dedupedUnchanged + lifecycleResult.dedupedUnchanged,
        wmsOrderId: result.wmsOrderId ?? lifecycleResult.wmsOrderId,
      };
    }
    return result;
  }

  /** 채널 주기 끝의 자동 재시도 (스펙 §6.1·§6.2). syncable 이 아닌 provider 는 행을 그대로 둔다. */
  private async retryProcessingFailures(provider: ChannelOrderProvider, cycleStartedAt: Date): Promise<void> {
    if (!this.isSyncableProvider(provider)) {
      return;
    }
    const rows = await this.orderCollectionFailureService.findRetryableProcessingFailures(
      provider.channel,
      cycleStartedAt,
      PROCESSING_FAILURE_RETRY_BATCH,
    );
    for (const row of rows) {
      const { status } = await this.retryProcessingFailure(provider, row);
      this.logger.log(
        `[${provider.channel}] 처리 실패 ${row.externalOrderId} 자동 재시도(${row.attemptCount}/${PROCESSING_FAILURE_MAX_ATTEMPTS} 뒤): ${status}`,
      );
    }
  }

  /**
   * 처리 실패 행 하나를 되살린다 — 자동 재시도와 수동 replay 가 같이 쓴다 (스펙 §6.3·§6.5). 상한은 부르는 쪽이 본다.
   * 「못 찾음」은 바로 닫지 않고 실패 1회로 센다 — 일시 오류일 수 있고, 소진되면 사람이 판단한다.
   */
  private async retryProcessingFailure(
    provider: SyncableChannelOrderProvider,
    row: OrderCollectionFailure,
  ): Promise<{ status: ProcessingRetryStatus; emitted: number; dedupedUnchanged: number }> {
    const fail = async (stage: OrderProcessingStage, error: string, input: Record<string, unknown>) => {
      await this.recordProcessingFailure(provider.channel, {
        externalOrderId: row.externalOrderId,
        sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
        stage,
        error,
        input,
      });
      return { status: 'still_quarantined' as const, emitted: 0, dedupedUnchanged: 0 };
    };

    let fetched: OrderSyncFetch | null;
    try {
      fetched = await provider.fetchOrderForSync(row.externalOrderId);
    } catch (error) {
      return error instanceof OrderProcessingStageError
        ? fail(error.stage, error.message, error.input)
        : fail('fetch', errorMessage(error), {});
    }
    if (!fetched) {
      return fail('fetch', `채널에서 주문을 찾지 못했다: ${row.externalOrderId}`, {});
    }

    let result: SyncFetchResult;
    try {
      result = await this.processSyncFetch(provider, fetched, {});
    } catch (error) {
      if (!(error instanceof OrderProcessingStageError)) throw error;
      return fail(error.stage, error.message, error.input);
    }

    if (result.outcome === 'identification_failed') {
      await this.orderCollectionFailureService.markReplayed(
        row.id,
        undefined,
        '식별 실패 격리로 넘어감 — 그 행에서 조치한다',
      );
      return { status: 'moved_to_identification_quarantine', emitted: 0, dedupedUnchanged: 0 };
    }
    if (result.outcome === 'not_eligible') {
      await this.orderCollectionFailureService.closeAsTerminalLifecycle(
        row.id,
        `Closed on retry: order ${row.externalOrderId} reached a terminal lifecycle and is no longer collectable`,
      );
      return { status: 'closed_terminal', emitted: 0, dedupedUnchanged: 0 };
    }
    await this.orderCollectionFailureService.markReplayed(row.id, result.wmsOrderId);
    return {
      status: result.emitted > 0 ? 'replayed' : 'already_processed',
      emitted: result.emitted,
      dedupedUnchanged: result.dedupedUnchanged,
    };
  }

  /** 폴링 루프의 failure·order 갈래와 같은 처리. 워터마크 계산만 없다. */
  private async syncFetched(
    provider: ChannelOrderProvider,
    fetched: OrderFetchOutcome,
    options: { force?: boolean },
  ): Promise<SyncFetchResult> {
    if (fetched.kind === 'failure') {
      const collected = await this.findCollectedOrders(provider.channel, [fetched.failure.externalOrderId]);
      if (this.isAlreadyCollectedIdentificationFailure(fetched.failure, collected)) {
        await this.closeOpenQuarantineAsCollected(
          provider.channel,
          fetched.failure.externalOrderId,
          collected.get(fetched.failure.externalOrderId),
        );
      } else {
        await this.orderCollectionFailureService.recordFailure(provider.channel, fetched.failure);
      }
      return { outcome: 'identification_failed', emitted: 0, dedupedUnchanged: 0 };
    }
    const result = await this.processOrderItem(provider, fetched.order, options);
    const counts = {
      emitted: result.emitted,
      dedupedUnchanged: result.dedupedUnchanged,
      wmsOrderId: result.wmsOrderId,
    };
    if (result.created) return { outcome: 'created', ...counts };
    if (!result.wmsOrderId) {
      return { outcome: fetched.order.eligibleForOrderCreation === false ? 'not_eligible' : 'unchanged', ...counts };
    }
    return { outcome: result.emitted > 0 ? 'emitted' : 'unchanged', ...counts };
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
  /** 처리 실패를 기록하고 로그를 남긴다. 루프와 재시도가 같이 쓴다 (스펙 §5.3·§6.4). */
  private async recordProcessingFailure(channel: SalesChannel, failure: OrderProcessingFailureItem): Promise<void> {
    const { exhaustedNow } = await this.orderCollectionFailureService.recordProcessingFailure(channel, failure);
    this.logger.warn(
      `[${channel}] 주문 ${failure.externalOrderId} 처리 실패(${failure.stage}) — 그 주문만 격리하고 계속한다: ${failure.error}`,
    );
    if (exhaustedNow) {
      this.logger.error(
        `[${channel}] 주문 ${failure.externalOrderId} 자동 재시도 ${PROCESSING_FAILURE_MAX_ATTEMPTS}회 소진 — 격리 화면에서 조치가 필요하다 (${failure.stage}): ${failure.error}`,
      );
    }
  }

  /**
   * 다음 폴링이 우연히 그 주문을 다시 가져와 성공한 경우 열린 처리 실패 행을 닫는다 (스펙 §5.4).
   * 채널은 주문을 다시 내보낼 때 그 주문의 lifecycle 도 함께 내보내므로 주문 항목의 성공이 곧 그 주문 전체의 성공이다.
   */
  private async closeRecoveredProcessingFailures(
    open: Map<string, OrderCollectionFailure>,
    failed: Set<string>,
    succeeded: Map<string, { wmsOrderId?: string; terminal: boolean }>,
  ): Promise<void> {
    for (const [externalOrderId, row] of open) {
      if (failed.has(externalOrderId)) continue;
      const success = succeeded.get(externalOrderId);
      if (!success) continue;
      if (success.wmsOrderId) {
        await this.orderCollectionFailureService.markReplayed(row.id, success.wmsOrderId);
      } else if (success.terminal) {
        await this.orderCollectionFailureService.closeAsTerminalLifecycle(
          row.id,
          `Closed on poll: order ${externalOrderId} reached a terminal lifecycle before collection`,
        );
      }
    }
  }

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
    // 수집된 주문의 «변경» 격리는 6번 행 몫이라 여기서 닫지 않는다 — 식별 실패 격리만 닫는다.
    const open = await this.orderCollectionFailureService.findOpenByExternalOrderId(
      channel,
      externalOrderId,
      CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
    );
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
    // 열린 행을 **전부** 닫는다 — 식별 실패와 처리 실패가 함께 열려 있을 수 있고, 종결된 주문은 어느 사유로도
    // 수집할 수 없다 (#1016 1번 행 스펙 §5.5).
    const open = await this.orderCollectionFailureService.findAllOpenByExternalOrderId(channel, item.externalOrderId);
    for (const row of open) {
      await this.orderCollectionFailureService.closeAsTerminalLifecycle(
        row.id,
        `Closed by ${item.eventType} (${item.eventKey}): order reached a terminal lifecycle before collection`,
      );
    }
    if (open.length > 0) {
      this.logger.warn(
        `[${channel}] Closed ${open.length} orphaned quarantine(s) for ${item.externalOrderId} after ${item.eventType}; order is no longer collectable`,
      );
    }
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
    if (kind === 'processing_failure') return 2;
    return 3;
  }
}

/** 주문 적재 실패 행의 `raw_order` — zod 가 거부한 그 값이 행 안에서 보이게 한다 (스펙 §4.3). */
function orderInput(item: OrderFetchItem): Record<string, unknown> {
  return { createPayload: item.createPayload, modification: item.modification };
}

/** lifecycle 적재 실패 행의 `raw_order`. */
function lifecycleInput(item: OrderLifecycleEventItem): Record<string, unknown> {
  return { eventType: item.eventType, eventKey: item.eventKey, payload: item.payload };
}
