import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { outboxEvents } from '../../schema';
import { eq, and, lte } from 'drizzle-orm';
import { PimMedusaSyncService } from './pim-medusa-sync.service';
import type { PimActiveVersionChangedEvent, ChannelAdapterSchema } from '../../types';

@Injectable()
export class OutboxWorkerService implements OnModuleInit {
    private readonly logger = new Logger(OutboxWorkerService.name);
    private isRunning = false;
    private intervalId: NodeJS.Timeout | null = null;
    private readonly pollIntervalMs: number;
    private readonly batchSize: number;
    private readonly maxRetries: number;

    constructor(
        private readonly dbService: DbService<ChannelAdapterSchema>,
        private readonly syncService: PimMedusaSyncService,
        private readonly configService: ConfigService,
    ) {
        this.pollIntervalMs = this.configService.get<number>(
            'OUTBOX_POLL_INTERVAL_MS',
        ) || 5000; // 5초마다 polling
        this.batchSize = this.configService.get<number>(
            'OUTBOX_BATCH_SIZE',
        ) || 10;
        this.maxRetries = this.configService.get<number>(
            'OUTBOX_MAX_RETRIES',
        ) || 5;
    }

    async onModuleInit() {
        this.logger.log('Starting Outbox Worker...');
        this.start();
    }

    start() {
        if (this.isRunning) {
            this.logger.warn('Outbox worker is already running');
            return;
        }

        this.isRunning = true;
        this.intervalId = setInterval(async () => {
            await this.processOutboxBatch();
        }, this.pollIntervalMs);

        this.logger.log(`Outbox worker started (poll interval: ${this.pollIntervalMs}ms)`);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        this.logger.log('Outbox worker stopped');
    }

    // Outbox에서 pending 이벤트를 가져와 처리
    private async processOutboxBatch(): Promise<void> {
        try {
            // 1. pending 상태이면서 nextAttemptAt이 지난 이벤트 조회
            const events = await this.dbService.db
                .select()
                .from(outboxEvents)
                .where(
                    and(
                        eq(outboxEvents.status, 'pending'),
                        lte(outboxEvents.nextAttemptAt, new Date()),
                        eq(outboxEvents.aggregateType, 'Product'),
                    ),
                )
                .orderBy(outboxEvents.createdAt)
                .limit(this.batchSize);

            if (events.length === 0) {
                return;
            }

            this.logger.debug(`Processing ${events.length} outbox events...`);

            for (const event of events) {
                await this.processOutboxEvent(event);
            }
        } catch (error) {
            this.logger.error('Failed to process outbox batch', error.stack);
        }
    }

    // 단일 outbox 이벤트 처리
    private async processOutboxEvent(event: any): Promise<void> {
        const eventId = event.id;

        try {
            this.logger.debug(`Processing outbox event: ${eventId}`);

            // 상태를 processing으로 변경 (동시성 제어)
            await this.dbService.db
                .update(outboxEvents)
                .set({ status: 'processing' })
                .where(eq(outboxEvents.id, eventId));

            // PIM 동기화 처리
            const payload: PimActiveVersionChangedEvent = event.payload;
            await this.syncService.handleActiveVersionChanged(payload);

            // 성공 처리
            await this.dbService.db
                .update(outboxEvents)
                .set({
                    status: 'published',
                    publishedAt: new Date(),
                })
                .where(eq(outboxEvents.id, eventId));

            this.logger.log(`Outbox event processed: ${eventId}`);
        } catch (error) {
            this.logger.error(
                `Failed to process outbox event: ${eventId}`,
                error.stack,
            );

            // 실패 처리 (재시도 로직)
            await this.handleFailure(event, error.message);
        }
    }

    // 실패 처리: 재시도 횟수 증가 + 백오프 + DLQ
    private async handleFailure(event: any, errorMessage: string): Promise<void> {
        const eventId = event.id;
        const attempts = event.attempts + 1;

        if (attempts >= this.maxRetries) {
            // 최대 재시도 횟수 초과 → failed (DLQ)
            await this.dbService.db
                .update(outboxEvents)
                .set({
                    status: 'failed',
                    attempts,
                    errorMessage,
                    failedAt: new Date(),
                })
                .where(eq(outboxEvents.id, eventId));

            this.logger.error(`Outbox event failed permanently: ${eventId}`);
        } else {
            const nextAttemptAt = new Date(
                Date.now() + Math.pow(2, attempts) * 1000,
            );

            await this.dbService.db
                .update(outboxEvents)
                .set({
                    status: 'pending',
                    attempts,
                    errorMessage,
                    nextAttemptAt,
                })
                .where(eq(outboxEvents.id, eventId));

            this.logger.warn(
                `Outbox event retry scheduled: ${eventId} (attempts: ${attempts}, next: ${nextAttemptAt.toISOString()})`,
            );
        }
    }

    async onModuleDestroy() {
        this.stop();
    }
}

