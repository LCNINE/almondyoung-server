import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { SalesChannelClient } from '../clients/sales-channel.client';
import type { ChannelOrderSource } from '../order-collection/channel-order-source.interface';
import { errorMessage } from '../order-collection/order-processing-stage.error';
import { RECONCILE_WINDOW_MS } from './channel-order-reconcile.classifier';
import { ChannelOrderReconcileService } from './channel-order-reconcile.service';
import { RECONCILE_ORDER_SOURCES } from './reconcile-order-sources';

/** 채널 대사 크론 (#1016 45번). 폴링(5분)과 따로 돈다 — 대사가 실패해도 수집은 영향받지 않는다. */
@Injectable()
export class ChannelOrderReconcileJob {
  private readonly logger = new Logger(ChannelOrderReconcileJob.name);

  constructor(
    @Inject(RECONCILE_ORDER_SOURCES) private readonly sources: ChannelOrderSource[],
    private readonly salesChannelClient: SalesChannelClient,
    private readonly service: ChannelOrderReconcileService,
  ) {}

  @CronOnce('*/30 * * * *', { name: 'channel-order-reconcile' })
  async run(): Promise<void> {
    if (this.sources.length === 0) return;
    let active: Set<string>;
    try {
      active = new Set(await this.salesChannelClient.getActiveSites());
    } catch (error) {
      this.logger.error(`활성 판매채널 조회 실패로 이번 대사를 건너뛴다: ${errorMessage(error)}`);
      return;
    }
    const now = new Date();
    for (const source of this.sources) {
      if (!active.has(source.channel)) continue;
      try {
        await this.service.runCycle(source.channel, {
          updatedAfter: new Date(now.getTime() - RECONCILE_WINDOW_MS),
          now,
          observeOnly: false,
        });
      } catch (error) {
        this.logger.error(`[${source.channel}] 채널 대사 실패: ${errorMessage(error)}`);
      }
    }
  }
}
