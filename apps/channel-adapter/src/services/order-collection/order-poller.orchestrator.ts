import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { SyncStatusService } from '../sync-status.service';
import { InboxService } from '../inbox.service';
import { PollingChangeHashService } from '../polling-change-hash.service';
import { ChannelType } from '../../adapters/channel-adapter.factory';
import {
  CHANNEL_ORDER_PROVIDER,
  ChannelOrderProvider,
  COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderLifecycleEventItem,
  ReplayableChannelOrderProvider,
} from './channel-order-provider.interface';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';
import { OrderCollectionFailureService } from './order-collection-failure.service';

const POLLING_RESOURCE_TYPE_ORDER = 'order';
const POLLING_RESOURCE_TYPE_ORDER_LIFECYCLE = 'order_lifecycle';
const WATERMARK_LOOKBACK_MS = 2 * 60 * 1000;

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
    private readonly inboxService: InboxService,
    private readonly pollingHashService: PollingChangeHashService,
    private readonly orderCollectionFailureService: OrderCollectionFailureService,
    private readonly db: DbService<typeof channelAdapterSchema>,
  ) {}

  @Cron('*/5 * * * *')
  async poll(): Promise<void> {
    for (const provider of this.providers) {
      const channelType = provider.channel as ChannelType;

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

        let emitted = 0;
        let dedupedUnchanged = 0;
        let quarantined = 0;
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

        // Orders quarantined this poll have no mapping yet but are still on track to be collected
        // via replay; their lifecycle observations are transient, not terminal.
        const quarantinedExternalOrderIds = new Set(failures.map((failure) => failure.externalOrderId));

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

        if (quarantined > 0) {
          this.logger.warn(
            `[${provider.channel}] Quarantined ${quarantined} order collection failures due to missing pimVariantId`,
          );
        }

        await this.syncStatusService.recordSyncComplete(channelType, 'orders', {
          eventCount: emitted,
          processingTime: Date.now() - startTime,
          watermark,
        });

        this.logger.log(
          `[${provider.channel}] Polled ${orders.length} order candidates (emitted: ${emitted}, lifecycle: ${lifecycleRecorded}, deduped: ${dedupedUnchanged}, quarantined: ${quarantined})`,
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

        await this.inboxService.enqueue(
          {
            eventType: 'OrderCreated',
            aggregateId: payload.orderId,
            aggregateType: 'ChannelAdapter',
            partitionKey: provider.channel,
            payload,
            metadata: {
              salesChannel: provider.channel,
              causedBy: {
                resourceType: 'MEDUSA_ORDER',
                resourceId: payload.externalOrderId,
              },
            },
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
    const storedHash = await this.pollingHashService.getStoredHash(
      provider.channel,
      POLLING_RESOURCE_TYPE_ORDER,
      item.externalOrderId,
    );
    if (storedHash === newHash) {
      return {
        emitted: 0,
        dedupedUnchanged: 1,
        wmsOrderId: mapping[0].wmsOrderId,
      };
    }

    await this.db.db.transaction(async (tx) => {
      await this.orderCollectionFailureService.recordFailure(
        provider.channel,
        {
          externalOrderId: item.externalOrderId,
          sourceUpdatedAt: item.sourceUpdatedAt,
          reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
          affectedLineIds: item.changes.items.map((line) => line.orderItemId),
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

      // 격리 저장 성공 후에만 갱신 — 도중 실패 시 다음 폴링에서 재시도되도록
      await this.pollingHashService.upsert(
        provider.channel,
        POLLING_RESOURCE_TYPE_ORDER,
        item.externalOrderId,
        newHash,
        tx,
      );
    });

    return {
      emitted: 0,
      dedupedUnchanged: 0,
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
    const storedHash = await this.pollingHashService.getStoredHash(
      provider.channel,
      POLLING_RESOURCE_TYPE_ORDER_LIFECYCLE,
      lifecycleResourceId,
    );

    if (storedHash === newHash) {
      return {
        emitted: 0,
        dedupedUnchanged: 1,
        recorded: true,
        wmsOrderId: mapping[0].wmsOrderId,
      };
    }

    await this.db.db.transaction(async (tx) => {
      await this.inboxService.enqueue(
        {
          eventType: item.eventType,
          aggregateId: mapping[0].wmsOrderId,
          aggregateType: 'ChannelAdapter',
          partitionKey: provider.channel,
          payload,
          metadata: {
            salesChannel: provider.channel,
            causedBy: {
              resourceType: 'MEDUSA_ORDER_LIFECYCLE',
              resourceId: item.externalOrderId,
            },
            lifecycleEventKey: item.eventKey,
          },
        },
        tx,
      );

      await this.pollingHashService.upsert(
        provider.channel,
        POLLING_RESOURCE_TYPE_ORDER_LIFECYCLE,
        lifecycleResourceId,
        newHash,
        tx,
      );
    });

    return {
      emitted: 1,
      dedupedUnchanged: 0,
      recorded: true,
      wmsOrderId: mapping[0].wmsOrderId,
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
