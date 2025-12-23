// PIM에서 publish/unpublish/rollback 이벤트가 발생하면 Outbox에 저장

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { processedEvents, outboxEvents } from '../schema';
import { eq } from 'drizzle-orm';
import type { PimActiveVersionChangedEvent, ChannelAdapterSchema } from '../types';

@Injectable()
export class PimProductEventConsumer implements OnModuleInit {
    private readonly logger = new Logger(PimProductEventConsumer.name);
    private consumer: Consumer;
    private kafka: Kafka;

    constructor(
        private readonly configService: ConfigService,
        private readonly dbService: DbService<ChannelAdapterSchema>,
    ) {
        const kafkaBrokers =
            this.configService.get<string>('KAFKA_BROKERS')?.split(',') || [
                'localhost:9092',
            ];

        this.kafka = new Kafka({
            clientId: 'channel-adapter-pim-sync',
            brokers: kafkaBrokers,
            ssl: this.configService.get<string>('KAFKA_API_KEY') ? true : false,
            sasl:
                this.configService.get<string>('KAFKA_API_KEY') &&
                    this.configService.get<string>('KAFKA_API_SECRET')
                    ? {
                        mechanism: 'plain' as const,
                        username: this.configService.get<string>('KAFKA_API_KEY')!,
                        password: this.configService.get<string>('KAFKA_API_SECRET')!,
                    }
                    : undefined,
        });

        this.consumer = this.kafka.consumer({
            groupId: 'channel-adapter-pim-medusa-sync',
        });
    }

    async onModuleInit() {
        // Kafka 연결 실패해도 앱은 계속 실행되도록 비동기 처리
        this.connect().catch((error) => {
            this.logger.error(
                'Failed to initialize Kafka consumer, will retry later',
                error.message,
            );
        });
    }

    private async connect() {
        try {
            this.logger.log('Connecting to Kafka...');
            await this.consumer.connect();
            this.logger.log('✅ Kafka consumer connected');

            // PIM Product Stream 구독
            await this.consumer.subscribe({
                topic: 'pim.product',
                fromBeginning: false, // 최신 메시지만
            });

            this.logger.log('Subscribed to topic: pim.product');

            await this.consumer.run({
                eachMessage: async (payload: EachMessagePayload) => {
                    await this.handleMessage(payload);
                },
            });

            this.logger.log('Consumer running...');
        } catch (error) {
            this.logger.error('❌ Failed to connect Kafka consumer');
            this.logger.error(error.stack);
            throw error;
        }
    }

    // 컨슈머는 DB에 저장만
    private async handleMessage(payload: EachMessagePayload) {
        const { topic, partition, message } = payload;

        try {
            const key = message.key?.toString();
            const valueRaw = message.value?.toString();

            if (!valueRaw) {
                this.logger.warn('Empty message received, skipping');
                return;
            }

            const event = JSON.parse(valueRaw);
            const eventType = event.eventType;

            this.logger.debug(
                `Received event: ${eventType} (key: ${key}, partition: ${partition})`,
            );

            // ProductMasterActiveVersionChanged 이벤트만 처리
            if (eventType === 'ProductMasterActiveVersionChanged') {
                const eventPayload: PimActiveVersionChangedEvent = event.payload;

                // Idempotency 체크 + Outbox에 저장
                await this.storeEventToOutbox(eventPayload);
            } else {
                this.logger.debug(`Ignoring event type: ${eventType}`);
            }
        } catch (error) {
            this.logger.error(
                `Failed to process message from ${topic}`,
                error.stack,
            );
            // throw 하지 않으면 오프셋 커밋됨
            // 하지만 지금은 DB 저장 실패도 throw 해서 재시도
            throw error;
        }
    }

    // Idempotency 체크 + Outbox 저장
    private async storeEventToOutbox(
        event: PimActiveVersionChangedEvent,
    ): Promise<void> {
        const { masterId, version, changeReason, changedAt } = event;

        // Idempotency Key 생성 (source + eventType + masterId + version)
        const idempotencyKey = `pim:version_changed:${masterId}:${version ?? 'null'}`;

        // 1. processed_events에 이미 있으면 skip
        const [existing] = await this.dbService.db
            .select()
            .from(processedEvents)
            .where(eq(processedEvents.idempotencyKey, idempotencyKey))
            .limit(1);

        if (existing) {
            this.logger.debug(`Duplicate event detected, skipping: ${idempotencyKey}`);
            return;
        }

        // 2. processed_events에 기록 (PROCESSED 상태)
        await this.dbService.db.insert(processedEvents).values({
            idempotencyKey,
            source: 'pim',
            eventType: 'ProductMasterActiveVersionChanged',
            resourceId: masterId,
            eventVersion: String(version ?? 0),
            status: 'PROCESSED', // 일단 받았다는 의미
        });

        // 3. outbox_events에 저장 (pending 상태, 워커가 처리)
        await this.dbService.db.insert(outboxEvents).values({
            eventType: 'PimProductSync',
            aggregateType: 'PimProduct',
            aggregateId: masterId,
            partitionKey: masterId,
            payload: event,
            metadata: {
                source: 'pim.product',
                changeReason,
                changedAt,
            },
            status: 'pending',
        });

        this.logger.log(
            `Event stored to outbox: ${masterId} (${changeReason}, v${version})`,
        );
    }

    async onModuleDestroy() {
        await this.consumer.disconnect();
        this.logger.log('Kafka consumer disconnected');
    }
}
