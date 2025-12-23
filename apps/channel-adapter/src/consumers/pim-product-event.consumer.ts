// PIM에서 publish/unpublish/rollback 이벤트가 발생하면 Outbox에 저장

import { Controller, Logger } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { DomainEvent } from '@packages/event-contracts/types';
import { ProductMasterActiveVersionChangedPayload } from '@packages/event-contracts/streams/product.stream';
import { DbService } from '@app/db';
import { processedEvents, outboxEvents } from '../schema';
import { eq } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';

/**
 * PIM Product Event Consumer
 * 
 * PIM 서비스가 발행한 Product 이벤트를 수신하여 Outbox에 저장합니다.
 * OutboxWorker가 비동기로 Medusa에 동기화 처리합니다.
 * 
 * - ProductMasterActiveVersionChanged: 상품 버전 활성화 변경 (발행/취소/롤백)
 */
@Controller()
export class PimProductEventConsumer {
    private readonly logger = new Logger(PimProductEventConsumer.name);

    constructor(
        private readonly dbService: DbService<ChannelAdapterSchema>,
    ) {
        this.logger.log('PIM Product Event Consumer 초기화 완료');
    }

    /**
     * PIM ProductMasterActiveVersionChanged 이벤트 처리
     * 
     * 이벤트를 Outbox에 저장하여 OutboxWorker가 비동기로 처리하도록 함
     * 
     * @param envelope 이벤트 메타데이터 (correlationId, timestamp 등)
     * @param payload 이벤트 페이로드
     */
    @OnEvent('products.events.v1', 'ProductMasterActiveVersionChanged')
    async onProductMasterActiveVersionChanged(
        @EventEnvelope() envelope: DomainEvent<ProductMasterActiveVersionChangedPayload>,
        @EventPayload() payload: ProductMasterActiveVersionChangedPayload,
    ): Promise<void> {
        const startTime = Date.now();
        const { masterId, version, changeReason } = payload;

        this.logger.log(
            `[PIM] Product Event 수신: ${masterId} → ${changeReason} (correlationId: ${envelope.correlationId})`,
            {
                version,
                productId: payload.productId,
            },
        );

        try {
            const db = this.dbService.db;

            // 1. 멱등성 체크: 동일 이벤트 처리 방지
            const idempotencyKey = `${masterId}:${version}:ProductMasterActiveVersionChanged`;
            const [existing] = await db
                .select()
                .from(processedEvents)
                .where(eq(processedEvents.idempotencyKey, idempotencyKey))
                .limit(1);

            if (existing) {
                this.logger.debug(
                    `[PIM] 이미 처리된 이벤트 스킵: ${idempotencyKey}`,
                );
                return;
            }

            // 2. processedEvents에 기록
            await db.insert(processedEvents).values({
                idempotencyKey,
                source: 'products.events.v1',
                eventType: 'ProductMasterActiveVersionChanged',
                resourceId: masterId,
                eventVersion: envelope.messageId || new Date().toISOString(),
                status: 'PROCESSED',
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // 3. Outbox에 저장 (OutboxWorker가 처리할 것)
            await db.insert(outboxEvents).values({
                eventType: 'ProductMasterActiveVersionChanged',
                aggregateType: 'Product',
                aggregateId: masterId,
                partitionKey: masterId, // Product 도메인은 masterId로 파티셔닝
                payload: payload,
                metadata: {
                    correlationId: envelope.correlationId,
                    messageId: envelope.messageId,
                },
                status: 'pending',
                createdAt: new Date(),
            });

            const duration = Date.now() - startTime;
            this.logger.log(
                `[PIM] Outbox 저장 완료: ${masterId} (${duration}ms)`,
            );
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error(
                `[PIM] Outbox 저장 실패: ${masterId} (${duration}ms)`,
                {
                    error: error.message,
                    stack: error.stack,
                },
            );
            throw error; // Re-throw to send to DLQ
        }
    }

    /**
     * Consumer 상태 확인 (헬스체크용)
     */
    getHealthStatus() {
        return {
            consumer: 'PimProductEventConsumer',
            topic: 'products.events.v1',
            status: 'active',
            lastProcessedAt: new Date().toISOString(),
        };
    }
}
