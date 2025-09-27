import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { v4 as uuidv4 } from 'uuid';
import { firstValueFrom, timeout } from 'rxjs';
import { BaseEventPayload, EventDefinition } from './types';

export const EVENT_PUBLISHER_CLIENT = 'EVENT_PUBLISHER_CLIENT';

@Injectable()
export class EventPublisherService<
  TEvents extends Record<string, EventDefinition> = Record<string, never>,
> {
  private readonly logger = new Logger(EventPublisherService.name);
  private serviceName: string;

  constructor(
    @Inject(EVENT_PUBLISHER_CLIENT)
    private readonly kafkaClient: ClientKafka,
  ) {
    this.serviceName = 'unknown-service';
  }

  async onModuleInit() {
    // 필요한 토픽들에 대한 연결 설정
    await this.kafkaClient.connect();
  }

  async onModuleDestroy() {
    await this.kafkaClient.close();
  }

  // 서비스 이름 설정
  setServiceName(name: string) {
    this.serviceName = name;
  }

  // 타입 안전한 이벤트 발행
  async publishEvent<K extends keyof TEvents>(
    eventKey: K,
    payload: Omit<TEvents[K]['payload'], keyof BaseEventPayload>,
    options?: {
      partition?: number;
      headers?: Record<string, string>;
    },
  ): Promise<void> {
    try {
      const topic = String(eventKey);

      const enrichedPayload = {
        ...payload,
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        source: this.serviceName,
      } as TEvents[K]['payload'];

      await firstValueFrom(
        this.kafkaClient.emit(topic, {
          value: JSON.stringify(enrichedPayload),
          partition: options?.partition,
          headers: options?.headers,
        })
      );

      this.logger.log(`Event published: ${topic}`, {
        topic,
        correlationId: enrichedPayload.correlationId,
      });
    } catch (error) {
      this.logger.error(`Failed to publish event: ${String(eventKey)}`, error);
      throw error;
    }
  }

  // 다중 이벤트 발행
  async publishEvents<K extends keyof TEvents>(
    events: Array<{
      eventKey: K;
      payload: Omit<TEvents[K]['payload'], keyof BaseEventPayload>;
      options?: {
        partition?: number;
        headers?: Record<string, string>;
      };
    }>,
  ): Promise<void> {
    const publishPromises = events.map((event) =>
      this.publishEvent(event.eventKey, event.payload, event.options),
    );

    await Promise.all(publishPromises);
  }

  // Request-Response 패턴 지원
  async sendRequest<K extends keyof TEvents, TResponse = any>(
    eventKey: K,
    payload: Omit<TEvents[K]['payload'], keyof BaseEventPayload>,
    timeoutMs: number = 5000,
  ): Promise<TResponse> {
    try {
      const topic = String(eventKey);

      const enrichedPayload = {
        ...payload,
        timestamp: new Date().toISOString(),
        correlationId: uuidv4(),
        source: this.serviceName,
      } as TEvents[K]['payload'];

      const response = await firstValueFrom(
        this.kafkaClient.send(topic, enrichedPayload).pipe(
          timeout(timeoutMs)
        )
      );

      this.logger.log(`Request sent and response received: ${topic}`, {
        topic,
        correlationId: enrichedPayload.correlationId,
      });

      return response;
    } catch (error) {
      this.logger.error(`Failed to send request: ${String(eventKey)}`, error);
      throw error;
    }
  }
} 