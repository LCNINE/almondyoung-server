/**
 * Events Module
 *
 * Stream 기반 이벤트 시스템을 위한 NestJS 모듈
 */

import { DynamicModule, Global, INestApplication, Inject, Module, OnApplicationShutdown, Logger } from '@nestjs/common';
import {
  ClientKafka,
  ClientsModule,
  CustomTransportStrategy,
  NestMicroservice,
  Transport,
} from '@nestjs/microservices';
import { APP_INTERCEPTOR, ModuleRef } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import { StreamPublisher } from './publishers/stream-publisher.service';
import { getPublisherToken } from './publishers/publisher-token';
import { DLQHandler } from './dlq/dlq-handler.service';
import { SchemaValidationInterceptor } from './interceptors/schema-validation.interceptor';
import { ChainContextInterceptor } from './interceptors/chain-context.interceptor';
import { EventRetryInterceptor } from './interceptors/event-retry.interceptor';
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
import { OutboxWriter } from './outbox/outbox-writer.port';
import { OUTBOX_DISPATCH_GATE, type OutboxDispatchGate } from './outbox/outbox-dispatch-gate.port';
import { bootstrapKafkaTopics } from './bootstrap/topic-bootstrap.service';
import { outboxSchema } from './outbox/outbox.schema';
import { trackingSchema } from './tracking/tracking.schema';
import { ScheduleModule } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { EVENT_TRANSPORT, EventTransport } from './transport/transport.port';
import { KafkaTransport } from './transport/kafka.transport';
import { DerivedConsumerConfig, deriveConsumerConfig, discoverEventHandlers } from './consumers/consumer-discovery';
import { buildConsumerInterceptors, EVENTS_CONSUMER_POLICY } from './consumers/consumer-interceptors';

/**
 * Kafka 로 나가는 유일한 통로 (ADR-0029 §7). `KAFKA_CLIENT` 를 감싸며,
 * `GracefulShutdownService` 만 연결 종료 목적으로 `KAFKA_CLIENT` 를 계속 직접 쓴다.
 */
const eventTransportProvider = {
  provide: EVENT_TRANSPORT,
  useFactory: (kafkaClient: ClientKafka): EventTransport => new KafkaTransport(kafkaClient),
  inject: ['KAFKA_CLIENT'],
};

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

/**
 * `forConsumer()` 전송 설정 (deprecated 경로)
 *
 * `streams` 만 빠져 있다 — Nest 가 `subscribe.topics` 를 덮어쓰므로 무의미했다.
 * 아래 `forConsumer` 의 JSDoc 참조.
 */
export interface ConsumerTransportOptions extends Omit<ConsumerModuleOptions, 'streams'> {
  /**
   * @deprecated 무시된다. Nest 의 `ServerKafka.bindEvents()` 가 `subscribe.topics` 를
   * 등록된 `@OnEvent` 패턴으로 덮어쓰기 때문에 이 목록은 한 번도 효과를 낸 적이 없다
   * (ADR-0029 Context). 필드는 기존 호출부 호환을 위해 남겨두었다.
   */
  streams?: StreamConfig[];
}

/**
 * `startConsumer()` 옵션 (ADR-0029 §3)
 *
 * **구독 목록이 없다.** 소비 집합은 `@OnEvent` 데코레이터에서 도출된다.
 * 여기 남는 것은 코드에서 도출할 수 없는 사실 — 전송 설정뿐이다.
 */
export interface StartConsumerOptions {
  groupId: string;
  kafka?: KafkaConfig; // 없으면 환경변수에서 생성

  sessionTimeout?: number; // ms (기본: 30000)
  heartbeatInterval?: number; // ms (기본: 3000)
  maxPollInterval?: number; // ms (기본: 300000)
  autoCommit?: boolean; // 기본: false

  /** 도출된 토픽의 DLQ 토픽까지 부트스트랩할지 (기본: true) */
  enableAutoDLQ?: boolean;

  /**
   * 소비 전략 교체 (ADR-0029 §7).
   *
   * 생략하면 Nest `ServerKafka`. 테스트는 `InMemoryServer` 를 넘겨 브로커 없이 같은
   * 파이프라인(인터셉터·가드·파라미터 데코레이터·DI)을 그대로 탄다. 전략을 넘기면
   * Kafka 토픽 부트스트랩은 건너뛴다 — 붙을 브로커가 없다.
   */
  strategy?: CustomTransportStrategy;
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

    // 아웃박스를 켠 앱에서만 `enqueue` 가 동작한다 — publisher 가 적재 대상을 알아야 하기
    // 때문이다(ADR-0029 §5). 켜지 않은 앱에서 `enqueue` 를 부르면 던진다.
    const enableOutbox = options.enableOutbox ?? false;

    // 각 stream별 StreamPublisher 제공자 생성
    const publisherProviders = options.streams.map((stream) => ({
      provide: this.getPublisherToken(stream.topic.topic),
      useFactory: (
        transport: EventTransport,
        eventChainService: EventChainService,
        eventTrackingService: EventTrackingService,
        outboxWriter?: OutboxWriter,
      ) => {
        return new StreamPublisher(
          transport,
          stream,
          serviceName,
          options.validation, // 스키마 검증 옵션 전달
          eventChainService,
          eventTrackingService,
          outboxWriter,
        );
      },
      // `OutboxPublisher` 는 **항상 optional 로** 주입한다 (Task 6-C-2). 그 전에는 같은
      // `forRoot` 호출이 `enableOutbox: true` 여야만 주입 목록에 들어갔는데, 아웃박스는 앱 하나에
      // 테이블 하나이고 BC 별 `forRoot` 는 여럿이라 그 결합이 어긋난다 — core 는 catalog 만
      // 아웃박스를 켰지만 inventory·fulfillment·sales-order 의 publisher 도 `enqueue` 를 쓴다.
      // 이 모듈은 `@Global()` 이라 어느 한 곳이 켜면 provider 는 앱 전체에서 보인다. 아무도 켜지
      // 않은 앱에서는 그대로 `undefined` 이고 `enqueue` 가 던진다 = 이 변경 전과 같다.
      inject: [EVENT_TRANSPORT, EventChainService, EventTrackingService, { token: OutboxPublisher, optional: true }],
    }));

    // DLQ Handler 제공자 (DLQ가 활성화된 경우에만)
    const dlqProvider = enableDLQ
      ? {
          provide: DLQHandler,
          useFactory: (transport: EventTransport) => {
            return new DLQHandler(transport);
          },
          inject: [EVENT_TRANSPORT],
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
              transport: EventTransport,
              eventChainService: EventChainService,
              eventTrackingService: EventTrackingService,
              moduleRef: ModuleRef,
              dispatchGate?: OutboxDispatchGate,
            ) => {
              // topic -> StreamPublisher 매핑 생성
              const publisherMap = new Map<string, StreamPublisher>();
              options.streams.forEach((stream) => {
                const publisher = new StreamPublisher(
                  transport,
                  stream,
                  serviceName,
                  options.validation,
                  eventChainService,
                  eventTrackingService,
                );
                publisherMap.set(stream.topic.topic, publisher);
              });

              // 이 모듈이 등록하지 않은 토픽은 앱 컨테이너에서 파생 조회한다 (Task 6-C-2).
              // `strict: false` 라야 다른 `forRoot` 인스턴스가 등록한 publisher 까지 보인다.
              const resolvePublisher = (topic: string): StreamPublisher | undefined => {
                try {
                  return moduleRef.get<StreamPublisher>(EventsModule.getPublisherToken(topic), { strict: false });
                } catch {
                  // 그 토픽의 publisher 를 아무도 등록하지 않았다 = 설정 오류. 호출부가
                  // `No publisher found for topic` 으로 바꿔 실패로 기록한다.
                  return undefined;
                }
              };

              return new OutboxDispatcher(dbService, publisherMap, options.outbox, resolvePublisher, dispatchGate);
            },
            inject: [
              DbService,
              EVENT_TRANSPORT,
              EventChainService,
              EventTrackingService,
              ModuleRef,
              { token: OUTBOX_DISPATCH_GATE, optional: true },
            ],
          },
        ]
      : [];

    const trackingProviders = [
      { provide: EventChainService, useClass: EventChainService },
      { provide: EventTrackingService, useClass: EventTrackingService },
      { provide: EventTraceReader, useClass: EventTraceReader },
    ];

    // 재시도/분류/DLQ/offset commit — 반드시 최외곽(다른 인터셉터보다 먼저 등록)이어야
    // SchemaValidationError 등 안쪽 인터셉터의 에러도 분류망에 잡힌다.
    const retryInterceptorProvider = {
      provide: APP_INTERCEPTOR,
      useClass: EventRetryInterceptor,
    };

    const providers = [
      retryInterceptorProvider, // 최외곽 — 등록 순서가 래핑 순서
      eventTransportProvider, // Kafka 로 나가는 유일한 통로
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
      exports: providers.filter((p) => p.provide !== APP_INTERCEPTOR).map((p) => p.provide),
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
          useFactory: (transport: EventTransport) => {
            return new DLQHandler(transport);
          },
          inject: [EVENT_TRANSPORT],
        }
      : null;

    // 재시도/분류/DLQ/offset commit — 반드시 최외곽(다른 인터셉터보다 먼저 등록)이어야
    // SchemaValidationError 등 안쪽 인터셉터의 에러도 분류망에 잡힌다.
    const retryInterceptorProvider = {
      provide: APP_INTERCEPTOR,
      useClass: EventRetryInterceptor,
    };

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

    // 앱이 선언한 검증 정책. `startConsumer` 가 읽어 마이크로서비스 스코프 인터셉터를
    // 만들 때 쓴다 (ADR-0029 §8) — 정책은 도출 불가한 사실이라 선언이 맞고, 스트림
    // 목록만 도출로 대체된다.
    const consumerPolicyProvider = {
      provide: EVENTS_CONSUMER_POLICY,
      useValue: { validation: options.validation },
    };

    const providers = [
      eventTransportProvider, // Kafka 로 나가는 유일한 통로
      ...(dlqProvider ? [dlqProvider] : []),
      retryInterceptorProvider, // 최외곽 — 등록 순서가 래핑 순서
      interceptorProvider, // 스키마 검증 Interceptor는 항상 등록
      chainInterceptorProvider, // chain context 전파 인터셉터
      consumerPolicyProvider, // startConsumer 가 읽는 소비 정책
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
   * Consumer 전송 설정 반환 (main.ts에서 connectMicroservice()에 사용)
   *
   * @deprecated `startConsumer(app, { groupId })` 를 쓴다. 두 가지 이유다 (ADR-0029):
   *
   * 1. **`streams` 인자가 무효다.** Nest 의 `ServerKafka.bindEvents()` 가
   *    `subscribe.topics` 를 등록된 `@OnEvent` 패턴으로 덮어쓴다. 이 목록은 한 번도
   *    구독에 영향을 준 적이 없으며, 그럼에도 "여기 없으면 메시지가 안 온다"는 틀린
   *    모델이 주석으로 자라 2026-08-08 아키텍처 리뷰의 오판을 낳았다.
   * 2. **이 경로로 붙인 마이크로서비스에는 소비 인터셉터가 적용되지 않는다.**
   *    호출부가 `app.connectMicroservice(opts)` 를 두 번째 인자 없이 부르면 Nest 가
   *    빈 `ApplicationConfig` 를 만들어, `APP_INTERCEPTOR` 로 등록한 스키마 검증·재시도·
   *    DLQ 인터셉터가 전부 무력화된다 (ADR-0029 §8). `startConsumer` 는 그 배선을 한다.
   *
   * @example
   * const consumerOptions = EventsModule.forConsumer({ groupId: 'events-test-consumer' });
   * app.connectMicroservice(consumerOptions);
   * await app.startAllMicroservices();
   */
  static forConsumer(options: ConsumerTransportOptions): {
    transport: Transport.KAFKA;
    options: any;
  } {
    // Kafka 설정 (환경변수 또는 명시적)
    const kafka = options.kafka || this.createKafkaConfigFromEnv();

    // subscribe.topics 를 만들지 않는다 — Nest 가 어차피 덮어쓴다. 만들어 두면
    // "이 목록이 구독을 결정한다"는 틀린 모델이 다시 자란다.
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
   * 소비를 시작한다 — 구독 목록 인자 없음 (ADR-0029 §3)
   *
   * 컨테이너를 훑어 `@OnEvent` 핸들러를 찾고, 거기서 **구독 토픽 · 검증 스키마 맵 ·
   * 토픽 부트스트랩 목록을 전부 파생**한다. 선언과 실제가 어긋날 자리가 없다.
   *
   * 두 가지를 부팅에서 거부한다 — 둘 다 지금까지 완전 무증상이던 실수다:
   * - 계약 레지스트리에 없는 토픽 구독
   * - `@OnEvent` 핸들러 0개 (컨트롤러를 `controllers: []` 에 등록하지 않은 경우.
   *   Nest 는 이때 `subscribe` 자체를 건너뛰므로 로그조차 남지 않는다)
   *
   * 그리고 소비 인터셉터(재시도·DLQ·스키마 검증·chain)를 **마이크로서비스 스코프**로
   * 붙인다. 하이브리드 앱에서 `APP_INTERCEPTOR` 가 소비 경로에 닿지 않기 때문이며,
   * 근거와 대안 비교는 ADR-0029 §8 에 있다.
   *
   * @example
   * const app = await NestFactory.create(AppModule);
   * await EventsModule.startConsumer(app, { groupId: 'search-indexer' });
   * await app.listen(port);
   *
   * @returns 도출 결과 — 로깅·테스트용
   */
  static async startConsumer(app: INestApplication, options: StartConsumerOptions): Promise<DerivedConsumerConfig> {
    const logger = new Logger('EventsConsumer');
    const derived = deriveConsumerConfig(discoverEventHandlers(app));

    const kafka = options.kafka || this.createKafkaConfigFromEnv();
    const enableAutoDLQ = options.enableAutoDLQ ?? true;

    if (!options.strategy) {
      await bootstrapKafkaTopics({ kafka, streams: derived.streams, includeDLQ: enableAutoDLQ });
    }

    const microserviceOptions = options.strategy
      ? { strategy: options.strategy }
      : this.forConsumer({
          groupId: options.groupId,
          kafka,
          sessionTimeout: options.sessionTimeout,
          heartbeatInterval: options.heartbeatInterval,
          maxPollInterval: options.maxPollInterval,
          autoCommit: options.autoCommit,
        });

    // deferInitialization 없이 부르면 Nest 가 즉시 리스너를 바인딩해버려
    // useGlobalInterceptors 가 늦는다. 미룬 뒤 인터셉터를 얹고, 비-defer 경로가
    // 하던 일(리스너 바인딩 + 초기화 플래그)을 직접 한다 — 플래그를 세우지 않으면
    // listen() 이 registerModules() 를 타면서 onModuleInit 이 두 번 실행된다.
    const microservice = app.connectMicroservice(microserviceOptions, {
      deferInitialization: true,
    }) as NestMicroservice;

    microservice.useGlobalInterceptors(...buildConsumerInterceptors(app, derived.streams));
    microservice.registerListeners();
    microservice.setIsInitialized(true);
    microservice.setIsInitHookCalled(true);

    await app.startAllMicroservices();

    logger.log(
      `Consumer started (groupId=${options.groupId}) — ${derived.handlers.length} handler(s) on ` +
        `${derived.topics.length} topic(s): ${derived.topics.join(', ')}`,
    );

    return derived;
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
   * Publisher 토큰 생성 — provider 등록·테스트 조회용.
   *
   * **생성자 주입에는 쓰지 않는다.** `@Inject(getPublisherToken(topic))` 은 토큰과
   * 파라미터 타입이 아무 데서도 대조되지 않는 우회이며 `npm run audit:event-publishers`
   * 가 `RAW_TOKEN` 으로 막는다. 주입은 `@InjectPublisher(STREAM)` 을 쓴다 (ADR-0029 §4).
   *
   * @example
   * // provider 등록 (로컬 fake 등). 스텁 클래스가 아니라 **진짜 `StreamPublisher`** 를
   * // no-op 전송으로 세우는 편이 낫다 — 오리-타이핑 스텁은 `enqueue` 처럼 나중에 생기는
   * // 메서드를 조용히 빠뜨리고, 문자열 토큰 뒤라 그 불일치가 컴파일에 잡히지 않는다
   * // (channel-adapter 의 `NullEventPublisher` 가 그렇게 6-C-3 에서 터졌다).
   * {
   *   provide: EventsModule.getPublisherToken(ORDER_STREAM.topic.topic),
   *   useFactory: () => new StreamPublisher({ send: async () => undefined }, ORDER_STREAM, 'my-svc'),
   * }
   */
  static getPublisherToken(topicName: string): string {
    return getPublisherToken(topicName);
  }

  /**
   * Publisher 주입 데코레이터
   *
   * @deprecated 토픽 문자열과 이벤트 타입 제네릭 두 사실을 따로 적게 한다. 계약에서
   * 도출하는 `@InjectPublisher(STREAM)` + `PublisherFor<typeof STREAM>` 을 쓰라 —
   * 같은 토큰을 만들므로 동작은 같다 (ADR-0029 §4). 앱 사용처는 Task 6-B 로 전부
   * 이주해 0건이며, 이 표면 자체는 Task 7(contract phase)에서 삭제한다.
   *
   * @example
   * constructor(
   *   @InjectPublisher(ORDER_STREAM)
   *   private readonly orderPublisher: PublisherFor<typeof ORDER_STREAM>
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
 *
 * @deprecated `@InjectPublisher(STREAM)` 을 쓰라 — 위 `EventsModule.InjectStreamPublisher` 참조.
 */
export const InjectStreamPublisher = EventsModule.InjectStreamPublisher.bind(EventsModule);
