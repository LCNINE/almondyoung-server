/**
 * Events Module
 *
 * Stream 기반 이벤트 시스템을 위한 NestJS 모듈
 */

import { DynamicModule, Global, Inject, Module, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { StreamPublisher } from './publishers/stream-publisher.service';
import { DLQHandler } from './dlq/dlq-handler.service';
import { SchemaValidationInterceptor } from './interceptors/schema-validation.interceptor';
import { ChainContextInterceptor } from './interceptors/chain-context.interceptor';
import { GracefulShutdownService } from './shutdown/graceful-shutdown.service';
import { EventChainService } from './tracking/event-chain.service';
import { EventTrackingService } from './tracking/event-tracking.service';
import { EventTraceReader } from './tracking/event-trace.reader';
import { EventTraceController } from './tracking/event-trace.controller';
import { KafkaConfig, StreamConfig, StreamEventTypes, getDLQTopicName } from '@packages/event-contracts/types';
import { SchemaValidationOptions } from '@packages/event-contracts/types';
import { OutboxConfig } from './outbox/outbox.types';
import { OutboxPublisher } from './outbox/outbox-publisher.service';
import { OutboxDispatcher } from './outbox/outbox-dispatcher.service';
import { bootstrapKafkaTopics } from './bootstrap/topic-bootstrap.service';
import { outboxSchema } from './outbox/outbox.schema';
import { trackingSchema } from './tracking/tracking.schema';
import { ScheduleModule } from '@nestjs/schedule';
import { DbService } from '@app/db';

/**
 * EventsModule 설정 옵션 (Publisher용)
 */
export interface EventsModuleOptions {
  streams: StreamConfig[]; // 여러 stream 지원
  kafka?: KafkaConfig; // 선택: 없으면 환경변수에서 생성
  serviceName?: string; // 선택: 기본값은 환경변수 SERVICE_NAME
  enableDLQ?: boolean; // DLQ 활성화 (기본: true)
  validation?: SchemaValidationOptions; // 스키마 검증 옵션
  enableOutbox?: boolean; // Outbox 패턴 활성화 (기본: false)
  outbox?: OutboxConfig; // Outbox 설정
}

/**
 * Consumer 설정 옵션
 */
export interface ConsumerModuleOptions {
  streams: StreamConfig[]; // 여러 stream 구독 지원
  groupId: string;
  kafka?: KafkaConfig; // 선택: 없으면 환경변수에서 생성

  // Consumer 세부 설정
  sessionTimeout?: number; // ms (기본: 30000)
  heartbeatInterval?: number; // ms (기본: 3000)
  maxPollInterval?: number; // ms (기본: 300000)
  autoCommit?: boolean; // 기본: false

  // DLQ 및 재시도 설정
  enableAutoDLQ?: boolean; // 자동 DLQ 처리 활성화 (기본: true)

  // 스키마 검증 설정
  validation?: SchemaValidationOptions; // 스키마 검증 옵션
}

@Global()
@Module({})
export class EventsModule {
  /**
   * Publisher 모듈 설정 (모든 서비스)
   *
   * - Kafka ClientsModule 등록
   * - 각 Stream별 StreamPublisher 제공
   *
   * @example
   * EventsModule.forRoot({
   *   streams: [ORDER_STREAM, INVENTORY_STREAM],
   * })
   */
  static forRoot(options: EventsModuleOptions): DynamicModule {
    // Kafka 설정 (환경변수 또는 명시적)
    const kafka = options.kafka || this.createKafkaConfigFromEnv();
    const serviceName = options.serviceName || process.env.SERVICE_NAME || 'unknown-service';
    const enableDLQ = options.enableDLQ ?? true;

    // 각 stream별 StreamPublisher 제공자 생성
    const publisherProviders = options.streams.map((stream) => ({
      provide: this.getPublisherToken(stream.topic.topic),
      useFactory: (
        kafkaClient: any,
        eventChainService: EventChainService,
        eventTrackingService: EventTrackingService,
      ) => {
        return new StreamPublisher(
          kafkaClient,
          stream,
          serviceName,
          options.validation, // 스키마 검증 옵션 전달
          eventChainService,
          eventTrackingService,
        );
      },
      inject: ['KAFKA_CLIENT', EventChainService, EventTrackingService],
    }));

    // DLQ Handler 제공자 (DLQ가 활성화된 경우에만)
    const dlqProvider = enableDLQ
      ? {
          provide: DLQHandler,
          useFactory: (kafkaClient: any) => {
            return new DLQHandler(kafkaClient);
          },
          inject: ['KAFKA_CLIENT'],
        }
      : null;

    // async useFactory로 토픽 생성을 provider resolution 시점에 완료한다.
    // shutdownProvider/publisherProviders가 이를 의존 → 미사용 시에도 강제 resolve.
    const bootstrapToken = Symbol('TOPIC_BOOTSTRAP_FORROOT');
    const topicBootstrapProvider = {
      provide: bootstrapToken,
      useFactory: async () => {
        await bootstrapKafkaTopics({ kafka, streams: options.streams, includeDLQ: enableDLQ });
        return true;
      },
    };

    // Graceful Shutdown Service — topic bootstrap 완료를 대기하도록 의존성 주입.
    const shutdownProvider = {
      provide: GracefulShutdownService,
      useFactory: (kafkaClient: any, _bootstrap: unknown) => {
        return new GracefulShutdownService(kafkaClient);
      },
      inject: ['KAFKA_CLIENT', bootstrapToken],
    };

    // Outbox 관련 providers
    const enableOutbox = options.enableOutbox ?? false;
    const outboxProviders = enableOutbox
      ? [
          {
            provide: OutboxPublisher,
            useClass: OutboxPublisher,
          },
          {
            provide: OutboxDispatcher,
            useFactory: (
              dbService: DbService,
              kafkaClient: any,
              eventChainService: EventChainService,
              eventTrackingService: EventTrackingService,
            ) => {
              // topic -> StreamPublisher 매핑 생성
              const publisherMap = new Map<string, StreamPublisher>();
              options.streams.forEach((stream) => {
                const publisher = new StreamPublisher(
                  kafkaClient,
                  stream,
                  serviceName,
                  options.validation,
                  eventChainService,
                  eventTrackingService,
                );
                publisherMap.set(stream.topic.topic, publisher);
              });

              return new OutboxDispatcher(dbService, publisherMap, options.outbox);
            },
            inject: [DbService, 'KAFKA_CLIENT', EventChainService, EventTrackingService],
          },
        ]
      : [];

    const trackingProviders = [
      { provide: EventChainService, useClass: EventChainService },
      { provide: EventTrackingService, useClass: EventTrackingService },
      { provide: EventTraceReader, useClass: EventTraceReader },
    ];

    const providers = [
      ...publisherProviders,
      ...(dlqProvider ? [dlqProvider] : []),
      ...outboxProviders,
      ...trackingProviders,
      shutdownProvider, // Graceful shutdown 항상 등록
      topicBootstrapProvider, // MSK Serverless 등 auto-create 불가 환경 대응
    ];

    return {
      module: EventsModule,
      imports: [
        ClsModule.forRoot({ global: true, middleware: { mount: false } }),
        ...(enableOutbox ? [ScheduleModule.forRoot()] : []),
        ClientsModule.register([
          {
            name: 'KAFKA_CLIENT',
            transport: Transport.KAFKA,
            options: {
              producerOnlyMode: true,
              client: {
                clientId: kafka.clientId,
                brokers: kafka.brokers,
                ssl: kafka.ssl,
                sasl: kafka.sasl,
                retry: kafka.retry,
              },
              // Producer 설정
              producer: {
                allowAutoTopicCreation: false,
                transactionTimeout: 30000,
                idempotent: true, // 중복 방지
                maxInFlightRequests: 5,
              },
            },
          },
        ]),
      ],
      providers,
      exports: providers.map((p) => p.provide),
    };
  }

  /**
   * Consumer 모듈 등록 (자동 DLQ 처리 포함)
   *
   * main.ts가 아닌 AppModule에서 사용
   *
   * @example
   * @Module({
   *   imports: [
   *     EventsModule.forConsumer({
   *       streams: [ORDER_STREAM],
   *       groupId: 'order-consumer',
   *       enableAutoDLQ: true,
   *     }),
   *   ],
   * })
   * export class AppModule {}
   */
  static forConsumerModule(options: ConsumerModuleOptions): DynamicModule {
    const kafka = options.kafka || this.createKafkaConfigFromEnv();
    const enableAutoDLQ = options.enableAutoDLQ ?? true;

    // DLQ Handler 제공자
    const dlqProvider = enableAutoDLQ
      ? {
          provide: DLQHandler,
          useFactory: (kafkaClient: any) => {
            return new DLQHandler(kafkaClient);
          },
          inject: ['KAFKA_CLIENT'],
        }
      : null;

    // Schema Validation Interceptor 제공자
    const interceptorProvider = {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: any) => {
        return new SchemaValidationInterceptor(reflector, options.streams, options.validation);
      },
      inject: ['Reflector'],
    };

    const bootstrapToken = Symbol('TOPIC_BOOTSTRAP_CONSUMER');
    const topicBootstrapProvider = {
      provide: bootstrapToken,
      useFactory: async () => {
        await bootstrapKafkaTopics({ kafka, streams: options.streams, includeDLQ: enableAutoDLQ });
        return true;
      },
    };

    // Graceful Shutdown — bootstrap 의존으로 강제 resolve.
    const shutdownProvider = {
      provide: GracefulShutdownService,
      useFactory: (kafkaClient: any, _bootstrap: unknown) => {
        return new GracefulShutdownService(kafkaClient);
      },
      inject: ['KAFKA_CLIENT', bootstrapToken],
    };

    const chainInterceptorProvider = {
      provide: APP_INTERCEPTOR,
      useClass: ChainContextInterceptor,
    };

    const providers = [
      ...(dlqProvider ? [dlqProvider] : []),
      interceptorProvider, // 스키마 검증 Interceptor는 항상 등록
      chainInterceptorProvider, // chain context 전파 인터셉터
      shutdownProvider, // Graceful shutdown 항상 등록
      topicBootstrapProvider, // MSK Serverless 등 auto-create 불가 환경 대응
      { provide: EventChainService, useClass: EventChainService },
      { provide: EventTrackingService, useClass: EventTrackingService },
      { provide: EventTraceReader, useClass: EventTraceReader },
    ];

    return {
      module: EventsModule,
      global: true,
      imports: [
        ClsModule.forRoot({ global: true, middleware: { mount: false } }),
        ClientsModule.register([
          {
            name: 'KAFKA_CLIENT',
            transport: Transport.KAFKA,
            options: {
              producerOnlyMode: true,
              client: {
                clientId: kafka.clientId,
                brokers: kafka.brokers,
                ssl: kafka.ssl,
                sasl: kafka.sasl,
                retry: kafka.retry,
              },
            },
          },
        ]),
      ],
      providers,
      exports: providers.filter((p) => p.provide !== APP_INTERCEPTOR).map((p) => p.provide),
    };
  }

  /**
   * Consumer 설정 반환 (main.ts에서 connectMicroservice()에 사용)
   *
   * 주의: 이 메서드는 자동 DLQ 처리를 포함하지 않습니다.
   * 자동 DLQ 처리를 원하면 forConsumerModule()을 사용하세요.
   *
   * @example
   * // apps/events-test/src/main.ts
   * const consumerOptions = EventsModule.forConsumer({
   *   streams: [TEST_STREAM],
   *   groupId: 'events-test-consumer',
   * });
   *
   * app.connectMicroservice(consumerOptions);
   * await app.startAllMicroservices();
   */
  static forConsumer(options: ConsumerModuleOptions): {
    transport: Transport.KAFKA;
    options: any;
  } {
    // Kafka 설정 (환경변수 또는 명시적)
    const kafka = options.kafka || this.createKafkaConfigFromEnv();

    // 모든 stream의 토픽 수집
    const topics = options.streams.map((s) => s.topic.topic);

    return {
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: kafka.clientId,
          brokers: kafka.brokers,
          ssl: kafka.ssl,
          sasl: kafka.sasl,
          retry: kafka.retry,
        },
        consumer: {
          groupId: options.groupId,
          sessionTimeout: options.sessionTimeout || 30000,
          heartbeatInterval: options.heartbeatInterval || 3000,
          maxPollInterval: options.maxPollInterval || 300000,
          allowAutoTopicCreation: false,
        },
        subscribe: {
          topics,
          fromBeginning: false,
        },
        run: {
          autoCommit: options.autoCommit ?? false,
          autoCommitInterval: 5000,
          autoCommitThreshold: 100,
        },
      },
    };
  }

  /**
   * @deprecated Use createKafkaConfigFromEnv() from kafka-config.util.ts directly
   */
  private static createKafkaConfigFromEnv(): KafkaConfig {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createKafkaConfigFromEnv: buildConfig } = require('./kafka-config.util');
    return buildConfig() as KafkaConfig;
  }

  /**
   * Publisher 토큰 생성
   *
   * @example
   * @Inject(EventsModule.getPublisherToken('orders.events.v1'))
   * private readonly orderPublisher: StreamPublisher<OrderEvents>
   */
  static getPublisherToken(topicName: string): string {
    return `STREAM_PUBLISHER_${topicName}`;
  }

  /**
   * Publisher 주입 데코레이터
   *
   * @example
   * constructor(
   *   @InjectStreamPublisher('orders.events.v1')
   *   private readonly orderPublisher: StreamPublisher<OrderEvents>
   * ) {}
   */
  static InjectStreamPublisher(topicName: string) {
    return Inject(this.getPublisherToken(topicName));
  }

  /**
   * Outbox 스키마 export (앱에서 병합할 수 있도록)
   *
   * @example
   * const combinedSchema = {
   *   ...wmsSchema,
   *   ...EventsModule.outboxSchema,
   * };
   */
  static get outboxSchema() {
    return outboxSchema;
  }

  /**
   * Tracking 스키마 export (앱에서 DbModule 스키마에 병합할 수 있도록)
   */
  static get trackingSchema() {
    return trackingSchema;
  }
}

/**
 * Publisher 주입 데코레이터 (단축)
 */
export const InjectStreamPublisher = EventsModule.InjectStreamPublisher.bind(EventsModule);
