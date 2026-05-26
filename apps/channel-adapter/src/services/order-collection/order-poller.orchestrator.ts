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
  OrderCollectionFailureItem,
  OrderFetchItem,
  ReplayableChannelOrderProvider,
} from './channel-order-provider.interface';
import { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';
import { OrderCollectionFailureService } from './order-collection-failure.service';

const POLLING_RESOURCE_TYPE_ORDER = 'order';

type OrderedPollItem = { kind: 'order'; item: OrderFetchItem } | { kind: 'failure'; item: OrderCollectionFailureItem };

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
        const since = syncStatus?.lastSyncAt ?? null;

        await this.syncStatusService.recordSyncStart(channelType, 'orders');

        const startTime = Date.now();
        const { orders, failures } = await provider.fetchOrders(since);
        const orderedItems: OrderedPollItem[] = [
          ...orders.map((item) => ({ kind: 'order' as const, item })),
          ...failures.map((item) => ({ kind: 'failure' as const, item })),
        ].sort((a, b) => new Date(a.item.sourceUpdatedAt).getTime() - new Date(b.item.sourceUpdatedAt).getTime());

        let emitted = 0;
        let dedupedUnchanged = 0;
        let quarantined = 0;
        let watermark: Date | null = null;

        for (const orderedItem of orderedItems) {
          if (orderedItem.kind === 'failure') {
            await this.orderCollectionFailureService.recordFailure(provider.channel, orderedItem.item);
            quarantined++;
            watermark = this.maxDate(watermark, orderedItem.item.sourceUpdatedAt);
            continue;
          }

          const result = await this.processOrderItem(provider, orderedItem.item);
          emitted += result.emitted;
          dedupedUnchanged += result.dedupedUnchanged;
          watermark = this.maxDate(watermark, orderedItem.item.sourceUpdatedAt);
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
          `[${provider.channel}] Polled ${orders.length} order candidates (emitted: ${emitted}, deduped: ${dedupedUnchanged}, quarantined: ${quarantined})`,
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
    status: 'replayed' | 'already_processed' | 'still_quarantined' | 'not_found_or_not_payment_accepted';
    failureId: string;
    externalOrderId: string;
    emitted: number;
    dedupedUnchanged: number;
  } | null> {
    const failure = await this.orderCollectionFailureService.findById(failureId);
    if (!failure) {
      return null;
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

    const result = await this.processOrderItem(provider, fetched.order);
    await this.orderCollectionFailureService.markReplayed(
      failure.id,
      result.wmsOrderId ?? fetched.order.createPayload.orderId,
    );

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
  ): Promise<{ emitted: number; dedupedUnchanged: number; wmsOrderId?: string }> {
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
            aggregateId: payload.externalOrderId ?? payload.orderId,
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

    // OrderModified
    // 외부 시스템이 무의미하게 updated_at만 bump한 경우(상태머신 부수효과 등)를 거른다.
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

    const modifiedPayload: OrderModifiedPayload = {
      orderId: mapping[0].wmsOrderId,
      changes: item.changes,
      modifiedBy: 'medusa',
      modifiedAt: item.modifiedAt,
    };

    await this.db.db.transaction(async (tx) => {
      await this.inboxService.enqueue(
        {
          eventType: 'OrderModified',
          aggregateId: item.externalOrderId,
          aggregateType: 'ChannelAdapter',
          partitionKey: provider.channel,
          payload: modifiedPayload,
          metadata: {
            salesChannel: provider.channel,
            causedBy: {
              resourceType: 'MEDUSA_ORDER',
              resourceId: item.externalOrderId,
            },
          },
        },
        tx,
      );

      // enqueue 성공 후에만 갱신 — 도중 실패 시 다음 폴링에서 재시도되도록
      await this.pollingHashService.upsert(
        provider.channel,
        POLLING_RESOURCE_TYPE_ORDER,
        item.externalOrderId,
        newHash,
        tx,
      );
    });

    return {
      emitted: 1,
      dedupedUnchanged: 0,
      wmsOrderId: mapping[0].wmsOrderId,
    };
  }

  private isReplayableProvider(provider: ChannelOrderProvider): provider is ReplayableChannelOrderProvider {
    return typeof (provider as ReplayableChannelOrderProvider).fetchOrder === 'function';
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
}
