import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { DbService } from '@app/db';
import { SyncStatusService } from '../sync-status.service';
import { InboxService } from '../inbox.service';
import { ChannelType } from '../../adapters/channel-adapter.factory';
import {
  CHANNEL_ORDER_PROVIDER,
  ChannelOrderProvider,
} from './channel-order-provider.interface';
import { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { channelAdapterSchema, wmsOrderMappings } from '../../schema';

@Injectable()
export class OrderPollerOrchestrator {
  private readonly logger = new Logger(OrderPollerOrchestrator.name);

  constructor(
    @Inject(CHANNEL_ORDER_PROVIDER)
    private readonly providers: ChannelOrderProvider[],
    private readonly syncStatusService: SyncStatusService,
    private readonly inboxService: InboxService,
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

        for (const item of orders) {
          if (item.eventType === 'OrderCreated') {
            const { payload } = item;

            await this.inboxService.enqueue({
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
            });

            await this.db.db
              .insert(wmsOrderMappings)
              .values({
                salesChannel: provider.channel,
                channelOrderId: payload.externalOrderId ?? payload.orderId,
                wmsOrderId: payload.orderId,
              })
              .onConflictDoNothing();
          } else {
            // OrderModified
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
              this.logger.warn(
                `OrderModified skip: no wmsOrderMappings for ${item.externalOrderId}`,
              );
              continue;
            }

            const modifiedPayload: OrderModifiedPayload = {
              orderId: mapping[0].wmsOrderId,
              changes: item.changes,
              modifiedBy: 'medusa',
              modifiedAt: item.modifiedAt,
            };

            await this.inboxService.enqueue({
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
            });
          }
        }

        if (skipped > 0) {
          this.logger.warn(
            `[${provider.channel}] Skipped ${skipped} orders due to missing pimVariantId`,
          );
        }

        await this.syncStatusService.recordSyncComplete(channelType, 'orders', {
          eventCount: orders.length,
          processingTime: Date.now() - startTime,
        });

        this.logger.log(
          `[${provider.channel}] Polled ${orders.length} orders (skipped: ${skipped})`,
        );
      } catch (error) {
        await this.syncStatusService.recordSyncFailure(channelType, 'orders', {
          message: error.message,
        });
        this.logger.error(
          `[${provider.channel}] Order polling failed: ${error.message}`,
        );
      }
    }
  }
}
