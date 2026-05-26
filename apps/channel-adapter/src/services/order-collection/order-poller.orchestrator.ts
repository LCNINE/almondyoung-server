import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { SyncStatusService } from '../sync-status.service';
import { InboxService } from '../inbox.service';
import { PollingChangeHashService } from '../polling-change-hash.service';
import { ChannelType } from '../../adapters/channel-adapter.factory';
import { CHANNEL_ORDER_PROVIDER, ChannelOrderProvider } from './channel-order-provider.interface';
import { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

const POLLING_RESOURCE_TYPE_ORDER = 'order';

@Injectable()
export class OrderPollerOrchestrator {
  private readonly logger = new Logger(OrderPollerOrchestrator.name);

  constructor(
    @Inject(CHANNEL_ORDER_PROVIDER)
    private readonly providers: ChannelOrderProvider[],
    private readonly syncStatusService: SyncStatusService,
    private readonly inboxService: InboxService,
    private readonly pollingHashService: PollingChangeHashService,
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
        const { orders, skipped } = await provider.fetchOrders(since);
        const orderedItems = [...orders].sort(
          (a, b) => new Date(a.sourceUpdatedAt).getTime() - new Date(b.sourceUpdatedAt).getTime(),
        );

        let emitted = 0;
        let dedupedUnchanged = 0;
        let watermark: Date | null = null;

        for (const item of orderedItems) {
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
            if (created) {
              emitted++;
            }
          } else {
            // OrderModified
            // 외부 시스템이 무의미하게 updated_at만 bump한 경우(상태머신 부수효과 등)를 거른다.
            const newHash = this.pollingHashService.computeHash(item.changes);
            const storedHash = await this.pollingHashService.getStoredHash(
              provider.channel,
              POLLING_RESOURCE_TYPE_ORDER,
              item.externalOrderId,
            );
            if (storedHash === newHash) {
              dedupedUnchanged++;
              watermark = this.maxDate(watermark, item.sourceUpdatedAt);
              continue;
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
            emitted++;
          }

          watermark = this.maxDate(watermark, item.sourceUpdatedAt);
        }

        if (skipped > 0) {
          this.logger.warn(`[${provider.channel}] Skipped ${skipped} orders due to missing pimVariantId`);
        }

        await this.syncStatusService.recordSyncComplete(channelType, 'orders', {
          eventCount: emitted,
          processingTime: Date.now() - startTime,
          watermark: skipped > 0 ? null : watermark,
        });

        this.logger.log(
          `[${provider.channel}] Polled ${orders.length} orders (emitted: ${emitted}, deduped: ${dedupedUnchanged}, skipped: ${skipped})`,
        );
      } catch (error) {
        await this.syncStatusService.recordSyncFailure(channelType, 'orders', {
          message: error.message,
        });
        this.logger.error(`[${provider.channel}] Order polling failed: ${error.message}`);
      }
    }
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
