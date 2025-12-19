// PIM에서 publish/unpublish/rollback 이벤트가 발생하면 Medusa로 동기화

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { ConfigService } from '@nestjs/config';
import { PimMedusaSyncService } from '../services/pim-medusa-sync/pim-medusa-sync.service';
import type { PimActiveVersionChangedEvent } from '../types';

@Injectable()
export class PimProductEventConsumer implements OnModuleInit {
    private readonly logger = new Logger(PimProductEventConsumer.name);
    private consumer: Consumer;
    private kafka: Kafka;

    constructor(
        private readonly configService: ConfigService,
        private readonly syncService: PimMedusaSyncService,
    ) {
        const kafkaBrokers =
            this.configService.get<string>('KAFKA_BROKERS')?.split(',') || [
                'localhost:9092',
            ];

        this.kafka = new Kafka({
            clientId: 'channel-adapter-pim-sync',
            brokers: kafkaBrokers,
        });

        this.consumer = this.kafka.consumer({
            groupId: 'channel-adapter-pim-medusa-sync',
        });
    }

    async onModuleInit() {
        await this.connect();
    }

    private async connect() {
        try {
            await this.consumer.connect();
            this.logger.log('Kafka consumer connected');

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
            this.logger.error('Failed to connect Kafka consumer', error.stack);
            throw error;
        }
    }

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
                await this.handleActiveVersionChanged(event.payload);
            } else {
                this.logger.debug(`Ignoring event type: ${eventType}`);
            }
        } catch (error) {
            this.logger.error(
                `Failed to process message from ${topic}`,
                error.stack,
            );
            // 에러 발생해도 컨슈머는 계속 실행 (메시지는 skip)
        }
    }

    private async handleActiveVersionChanged(
        payload: PimActiveVersionChangedEvent,
    ) {
        try {
            this.logger.log(
                `Processing PIM Product ActiveVersionChanged: ${payload.masterId} (${payload.changeReason})`,
            );

            // 동기화 서비스에 위임
            await this.syncService.handleActiveVersionChanged(payload);

            this.logger.log(
                `Successfully processed: ${payload.masterId}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to handle ActiveVersionChanged: ${payload.masterId}`,
                error.stack,
            );
            // TODO: DLQ (Dead Letter Queue)로 전송 또는 재시도 큐에 추가
        }
    }

    async onModuleDestroy() {
        await this.consumer.disconnect();
        this.logger.log('Kafka consumer disconnected');
    }
}

