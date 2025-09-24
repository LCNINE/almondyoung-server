import { Injectable, Logger } from '@nestjs/common';
import { AdapterOrchestrationService } from '../services/adapter-orchestration.service';
import { IdempotencyService } from '../services/idempotency.service';
import { StockChangedEvent } from '../types';
import { RetryPolicy } from '../decorators/retry-policy.decorator';

@Injectable()
export class StockEventConsumer {
  private readonly logger = new Logger(StockEventConsumer.name);

  constructor(
    private readonly orchestrator: AdapterOrchestrationService,
    private readonly idempotencyService: IdempotencyService,
  ) {
    this.logger.log('📦 WMS 재고 이벤트 Consumer 초기화 완료');
  }

  @RetryPolicy({
    maxRetries: 3,
    backoffMs: [1000, 5000, 30000],
    dlqTopic: 'channel-adapter.stock.dlq',
  })
  async handleStockChanged(event: StockChangedEvent): Promise<void> {
    const startTime = Date.now();

    const idempotencyKey = IdempotencyService.generateIdempotencyKey(
      'WMS',
      'STOCK_CHANGED',
      event.sku,
      event.eventVersion.toString(),
    );

    this.logger.log(`📦 [WMS] 이벤트 수신: ${event.sku}`, {
      idempotencyKey,
      eventVersion: event.eventVersion,
    });

    try {
      // 1. 멱등키 체크
      if (await this.idempotencyService.isProcessed(idempotencyKey)) {
        this.logger.debug(`🔒 이미 처리된 이벤트: ${idempotencyKey}`);
        return;
      }

      // 2. 현재 재고 계산
      const currentStock = await this.calculateCurrentStock(event);

      // 3. 전체 채널에 재고 동기화
      const syncSuccess = await this.syncStockToAllChannels(
        event,
        currentStock,
      );

      // 4. 모든 채널 성공 시에만 멱등키 처리
      if (syncSuccess) {
        await this.idempotencyService.markProcessed({
          idempotencyKey,
          source: 'WMS',
          eventType: 'STOCK_CHANGED',
          resourceId: event.sku,
          eventVersion: event.eventVersion.toString(),
        });
        this.logger.debug(`🔒 멱등키 처리 완료: ${idempotencyKey}`);
      } else {
        throw new Error(`재고 동기화 실패: ${event.sku}`);
      }

      this.logger.log(`✅ 처리 완료: ${event.sku}`, {
        idempotencyKey,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error(`❌ 처리 실패: ${event.sku}`, {
        idempotencyKey,
        error: error.message,
      });

      await this.idempotencyService.markFailed(
        idempotencyKey,
        error.message,
        true,
      );

      throw error; // RetryPolicy 데코레이터가 재시도
    }
  }

  private async calculateCurrentStock(
    event: StockChangedEvent,
  ): Promise<number> {
    this.logger.debug(`📊 재고 계산: ${event.sku}`);
    return Math.max(0, event.deltaQty);
  }

  private async syncStockToAllChannels(
    event: StockChangedEvent,
    currentStock: number,
  ): Promise<boolean> {
    const all = ['naver_smartstore', 'coupang'] as const;
    const required = (process.env.REQUIRED_CHANNELS?.split(',') ?? [
      'coupang',
    ]) as Array<(typeof all)[number]>;

    const results = await Promise.all(
      all.map(async (channel) => {
        try {
          const res = await this.orchestrator.syncToChannelOrAll(channel, {
            dataType: 'inventory',
            payload: {
              productId: event.sku,
              stockQuantity: currentStock,
              isOptionProduct: false,
              warehouseId: event.warehouseId,
            },
          });
          return { channel, success: res.success };
        } catch (e: any) {
          return { channel, success: false, error: e.message };
        }
      }),
    );

    const successByChannel = Object.fromEntries(
      results.map((r) => [r.channel, r.success]),
    );
    const requiredOk = required.every((ch) => successByChannel[ch]);

    // 로그만 남기고 멱등 마킹 기준은 requiredOk로
    const failures = results.filter((r) => !r.success).map((r) => r.channel);
    if (failures.length)
      this.logger.warn(`⚠️ 일부 실패: ${failures.join(', ')}`);

    return requiredOk;
  }

  getHealthStatus() {
    return {
      consumer: 'StockEventConsumer',
      topic: 'wms.stock.changed',
      status: 'active',
      lastProcessedAt: new Date().toISOString(),
    };
  }
}
