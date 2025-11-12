/**
 * Events Module
 *
 * Stream 기반 이벤트 시스템을 위한 NestJS 모듈
 */

import {
  DynamicModule,
  Global,
  Inject,
  Module,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { StreamPublisher } from './publishers/stream-publisher.service';
import { DLQHandler } from './dlq/dlq-handler.service';
import { EventsExceptionFilter } from './filters/events-exception.filter';
import { SchemaValidationInterceptor } from './interceptors/schema-validation.interceptor';
import { GracefulShutdownService } from './shutdown/graceful-shutdown.service';
import {
  KafkaConfig,
  StreamConfig,
  StreamEventTypes,
  getDLQTopicName,
} from '@packages/event-contracts/types';
import { SchemaValidationOptions } from '@packages/event-contracts/types';

/**
 * EventsModule 설정 옵션 (Publisher용)
 */
export interface EventsModuleOptions {
  streams: StreamConfig[]; // 여러 stream 지원
  kafka?: KafkaConfig; // 선택: 없으면 환경변수에서 생성
  serviceName?: string; // 선택: 기본값은 환경변수 SERVICE_NAME
  enableDLQ?: boolean; // DLQ 활성화 (기본: true)
  validation?: SchemaValidationOptions; // 스키마 검증 옵션
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
    const serviceName =
      options.serviceName || process.env.SERVICE_NAME || 'unknown-service';
    const enableDLQ = options.enableDLQ ?? true;

    // 각 stream별 StreamPublisher 제공자 생성
    const publisherProviders = options.streams.map((stream) => ({
      provide: this.getPublisherToken(stream.topic.topic),
      useFactory: (kafkaClient: any) => {
        return new StreamPublisher(
          kafkaClient,
          stream,
          serviceName,
          options.validation, // 스키마 검증 옵션 전달
        );
      },
      inject: ['KAFKA_CLIENT'],
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

    // Graceful Shutdown Service
    const shutdownProvider = {
      provide: GracefulShutdownService,
      useFactory: (kafkaClient: any) => {
        return new GracefulShutdownService(kafkaClient);
      },
      inject: ['KAFKA_CLIENT'],
    };

    const providers = [
      ...publisherProviders,
      ...(dlqProvider ? [dlqProvider] : []),
      shutdownProvider, // Graceful shutdown 항상 등록
    ];

    return {
      module: EventsModule,
      imports: [
        ClientsModule.register([
          {
            name: 'KAFKA_CLIENT',
            transport: Transport.KAFKA,
            options: {
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

    // Exception Filter 제공자
    const filterProvider = enableAutoDLQ
      ? {
          provide: APP_FILTER,
          useClass: EventsExceptionFilter,
        }
      : null;

    // Schema Validation Interceptor 제공자
    const interceptorProvider = {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: any) => {
        return new SchemaValidationInterceptor(
          reflector,
          options.streams,
          options.validation,
        );
      },
      inject: ['Reflector'],
    };

    // Graceful Shutdown Service
    const shutdownProvider = {
      provide: GracefulShutdownService,
      useFactory: (kafkaClient: any) => {
        return new GracefulShutdownService(kafkaClient);
      },
      inject: ['KAFKA_CLIENT'],
    };

    const providers = [
      ...(dlqProvider ? [dlqProvider] : []),
      ...(filterProvider ? [filterProvider] : []),
      interceptorProvider, // 스키마 검증 Interceptor는 항상 등록
      shutdownProvider, // Graceful shutdown 항상 등록
    ];

    return {
      module: EventsModule,
      global: true,
      imports: [
        ClientsModule.register([
          {
            name: 'KAFKA_CLIENT',
            transport: Transport.KAFKA,
            options: {
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
      exports: providers
        .filter((p) => p.provide !== APP_FILTER)
        .map((p) => p.provide),
      // exports: providers
      //   .filter(
      //     (p) => p.provide !== APP_FILTER && p.provide !== APP_INTERCEPTOR,
      //   )
      //   .map((p) => p.provide),
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
   * 환경변수에서 KafkaConfig 생성 (헬퍼 메서드)
   */
  private static createKafkaConfigFromEnv(): KafkaConfig {
    const brokers = (process.env.KAFKA_BROKERS || '')
      .split(',')
      .map((b) => b.trim());

    const config: KafkaConfig = {
      clientId: process.env.KAFKA_CLIENT_ID || process.env.SERVICE_NAME || '',
      brokers,
      retry: {
        retries: 5,
        initialRetryTime: 300,
        multiplier: 2,
        maxRetryTime: 30000,
      },
    };

    // Confluent Cloud / SASL 설정
    // KAFKA_API_KEY/SECRET (신규 표준) 또는 KAFKA_SASL_USERNAME/PASSWORD (하위 호환)
    const apiKey = process.env.KAFKA_API_KEY || process.env.KAFKA_SASL_USERNAME;
    const apiSecret =
      process.env.KAFKA_API_SECRET || process.env.KAFKA_SASL_PASSWORD;

    if (apiKey && apiSecret) {
      config.ssl = true;
      config.sasl = {
        mechanism: 'plain',
        username: apiKey,
        password: apiSecret,
      };
    } else if (process.env.KAFKA_SSL === 'true') {
      config.ssl = true;
    }

    return config;
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
}

/**
 * Publisher 주입 데코레이터 (단축)
 */
export const InjectStreamPublisher =
  EventsModule.InjectStreamPublisher.bind(EventsModule);
