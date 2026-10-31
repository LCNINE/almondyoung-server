/**
 * Events Module
 *
 * Stream 기반 이벤트 시스템을 위한 NestJS 모듈
 */

import { DynamicModule, Global, INestApplication, Module, OnApplicationShutdown, Logger } from '@nestjs/common';
import {
  ClientKafka,
  ClientsModule,
  CustomTransportStrategy,
  NestMicroservice,
  Server,
  ServerKafka,
  Transport,
} from '@nestjs/microservices';
import { APP_INTERCEPTOR, ModuleRef } from '@nestjs/core';
import { Kafka } from 'kafkajs';
import { ClsModule, ClsService } from 'nestjs-cls';
import { requireServedTenant, TENANCY_ENV, TENANT_CONTEXT_KEY, TenancyConfig, TenancyConfigError } from '@app/tenancy';
import { StreamPublisher } from './publishers/stream-publisher.service';
import { getPublisherToken } from './publishers/publisher-token';
import { DLQHandler } from './dlq/dlq-handler.service';
import { DeadLetterInterceptorOptions, EventRetryInterceptor } from './interceptors/event-retry.interceptor';
import { GracefulShutdownService } from './shutdown/graceful-shutdown.service';
import { EventChainService } from './tracking/event-chain.service';
import { EventTrackingService } from './tracking/event-tracking.service';
import { EventTraceReader } from './tracking/event-trace.reader';
import { KafkaConfig, StreamConfig, StreamEventTypes, getDLQTopicName } from '@packages/event-contracts/types';
import { SchemaValidationOptions } from '@packages/event-contracts/types';
import { createKafkaConfigFromEnv } from './kafka-config.util';
import { OutboxConfig } from './outbox/outbox.types';
import { OutboxPublisher } from './outbox/outbox-publisher.service';
import { OutboxDispatcher } from './outbox/outbox-dispatcher.service';
import { OutboxMetricsCollector } from './outbox/outbox-metrics.collector';
import { OutboxWriter } from './outbox/outbox-writer.port';
import { OUTBOX_DISPATCH_GATE, type OutboxDispatchGate } from './outbox/outbox-dispatch-gate.port';
import { OUTBOX_TENANT_ID, type OutboxTenant } from './outbox/outbox-tenant.port';
import { EventTenantStamp } from './tenancy/event-tenant-stamp';
import { bootstrapKafkaTopics } from './bootstrap/topic-bootstrap.service';
import { outboxSchema } from './outbox/outbox.schema';
import { trackingSchema } from './tracking/tracking.schema';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { DbService } from '@app/db';
import { EVENT_TRANSPORT, EventTransport } from './transport/transport.port';
import { KafkaTransport } from './transport/kafka.transport';
import { DerivedConsumerConfig, deriveConsumerConfig, discoverEventHandlers } from './consumers/consumer-discovery';
import { buildConsumerInterceptors, EVENTS_CONSUMER_POLICY, optionalGet } from './consumers/consumer-interceptors';
import { DeadLetterRuntime } from './dead-letter/dead-letter.runtime';
import { DeadLetterStore } from './dead-letter/dead-letter.store';
import { checkDeadLetterTables, DEAD_LETTER_MIGRATION_NAME } from './dead-letter/dead-letter-tables';
import { EVENT_FAILURES_OPTIONS, type EventFailuresOptions } from './dead-letter/event-failures.options';
import {
  buildKafkaConsumerServerOptions,
  KAFKA_CONSUMER_GROUP_POSTFIX,
  KafkaConsumerTuning,
} from './transport/kafka-consumer-options';
import { ConsumerLagCollector, registerConsumerLagCollector } from './consumers/consumer-lag.collector';
import { CONSUMER_TENANCIES, type ConsumerTenancy, EventTenantGate } from './tenancy/event-tenant-gate';

export { KAFKA_CONSUMER_GROUP_POSTFIX };

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
 * 봉투에 테넌트를 찍는 도구 . 테넌트 목록(`TenancyModule`)이 없는 앱이면 `undefined` 이고 찍지 않는다 —
 * 운영의 발행 앱은 전부 Kafka 소비 앱이라 `tenancy-wiring.spec` 이 목록을 강제한다. T·outbox 테넌트가 목록에 없으면
 * 여기서 던져 기동을 거부한다.
 */
const eventTenantStampProvider = {
  provide: EventTenantStamp,
  useFactory: (
    cls: ClsService,
    tenancy?: TenancyConfig,
    outboxTenantId?: OutboxTenant,
  ): EventTenantStamp | undefined => {
    if (!tenancy) return undefined;

    const rawServed = process.env[TENANCY_ENV.servedTenantId];
    const servedTenantId = rawServed ? requireServedTenant(tenancy.tenants, rawServed).id : undefined;
    // 맥락을 따르는 outbox 는 부팅 때 대조할 값이 없다 — 목록 밖 맥락은 DB 라우터가 행을 읽기 전에 거절한다
    if (typeof outboxTenantId === 'string' && !tenancy.tenants.find(outboxTenantId)) {
      throw new TenancyConfigError('OUTBOX_TENANT_ID', [`outbox 테넌트 «${outboxTenantId}» 가 테넌트 목록에 없다`]);
    }

    return new EventTenantStamp({
      contextTenant: () => (cls.isActive() ? cls.get<string | undefined>(TENANT_CONTEXT_KEY) : undefined),
      servedTenantId,
      outboxTenantId: outboxTenantId ?? servedTenantId,
      gateMode: tenancy.gateMode,
    });
  },
  inject: [ClsService, { token: TenancyConfig, optional: true }, { token: OUTBOX_TENANT_ID, optional: true }],
};

/**
 * `forApp()` 설정 옵션 — 이 앱이 가진 **능력**만 선언한다 (ADR-0029 §3)
 *
 * **소비 스트림은 여기 없다.** 그건 `@On` 데코레이터에서 도출된다 (`startConsumer`).
 * 선언은 코드에서 도출할 수 없는 사실에만 둔다는 §1 원칙의 결과다.
 */
export interface EventsAppOptions {
  /**
   * 이 프로세스가 **발행**하는 스트림. 스트림당 `StreamPublisher` provider 가 하나
   * 등록되고 토픽이 부트스트랩된다. 소비만 하는 앱은 생략한다.
   *
   * 옛 이름은 `streams` 였다. 세 표면이 같은 이름으로 각각 다른 뜻(발행 능력 · 검증
   * 맵 · 무의미한 subscribe 목록)을 받던 것이 ADR-0029 Context 의 첫 번째 관측이다.
   */
  publishes?: StreamConfig[];
  kafka?: KafkaConfig; // 선택: 없으면 환경변수에서 생성
  serviceName?: string; // 선택: 기본값은 환경변수 SERVICE_NAME
  enableDLQ?: boolean; // DLQ 활성화 (기본: true)

  /**
   * **발행** 검증 정책 — 이 호출이 등록하는 publisher 에만 적용된다.
   *
   * 소비 정책과 타입이 갈려 있다. 옛 `forRoot`/`forConsumerModule` 은 둘 다
   * `validation: SchemaValidationOptions` 를 받아 이름이 같고 뜻이 달랐다.
   */
  validation?: Pick<SchemaValidationOptions, 'validateOnPublish' | 'throwOnValidationError'>;

  /**
   * **소비** 검증 정책 — 앱 전체에 하나.
   *
   * `startConsumer` 가 마이크로서비스 스코프 인터셉터를 만들 때 읽는다 (ADR-0029 §8).
   * 여러 `forApp` 호출이 선언하면 어느 것이 이기는지 알 수 없으므로 **부팅을 거부**한다
   * (`assertSinglePolicyDeclaration`).
   */
  policy?: Pick<SchemaValidationOptions, 'validateOnConsume' | 'throwOnValidationError'>;

  enableOutbox?: boolean; // Outbox 패턴 활성화 (기본: false)
  outbox?: OutboxConfig; // Outbox 설정
}

/**
 * `startConsumer()` 옵션 (ADR-0029 §3)
 *
 * **구독 목록이 없다.** 소비 집합은 `@On` 데코레이터에서 도출된다.
 * 여기 남는 것은 코드에서 도출할 수 없는 사실 — 전송 설정뿐이다.
 */
export interface StartConsumerOptions extends KafkaConsumerTuning {
  kafka?: KafkaConfig; // 없으면 환경변수에서 생성

  /**
   * 이 앱의 테넌트 모드 — 코드에서 도출할 수 없는 사실이라 선언한다. 기본값은 없다.
   * `served-tenant` 는 `SERVED_TENANT_ID` 를 목록과 대조하고, 없거나 목록에 없으면 기동을 거부한다.
   * 핸들러 앞의 문이 이 선언으로 판정한다 — `tenancy/event-tenant-gate.ts`.
   */
  tenancy: ConsumerTenancy;

  /** 도출된 토픽의 DLQ 토픽까지 부트스트랩할지 (기본: true) */
  enableAutoDLQ?: boolean;

  /**
   * 소비 전략 교체 (ADR-0029 §7).
   *
   * 생략하면 Nest `ServerKafka`. 테스트는 `InMemoryServer` 를 넘겨 브로커 없이 같은
   * 파이프라인(인터셉터·가드·파라미터 데코레이터·DI)을 그대로 탄다. 전략을 넘기면
   * Kafka 토픽 부트스트랩은 건너뛴다 — 붙을 브로커가 없다.
   */
  strategy?: CustomTransportStrategy & Server;
}

@Global()
@Module({})
export class EventsModule {
  /**
   * 앱 등록 — 발행 능력 · 정책 · 인프라 (ADR-0029 §3)
   *
   * 등록 표면은 이것과 `startConsumer` 둘뿐이다. 옛 `forRoot`(발행) ·
   * `forConsumerModule`(소비 인프라) · `forConsumer`(전송) 세 벌은 Task 7 에서
   * 사라졌다 — 셋이 같은 이름·같은 타입의 `streams` 를 받고 각각 다른 뜻이었다.
   *
   * BC 별로 여러 번 불러도 된다(core 가 그렇게 쓴다). 다만 `policy` 는 앱 전체에
   * 하나이므로 **한 호출에서만** 선언한다 — 둘 이상이면 `startConsumer` 가 거부한다.
   *
   * @example
   * EventsModule.forApp({
   *   publishes: [ORDER_STREAM, INVENTORY_STREAM],
   *   serviceName: 'core',
   *   policy: { validateOnConsume: true },
   * })
   */
  static forApp(options: EventsAppOptions = {}): DynamicModule {
    // Kafka 설정 (환경변수 또는 명시적)
    const kafka = options.kafka || this.requireKafkaConfigFromEnv('forApp');
    const serviceName = options.serviceName || process.env.SERVICE_NAME || 'unknown-service';
    const enableDLQ = options.enableDLQ ?? true;
    const publishes = options.publishes ?? [];

    // 아웃박스를 켠 앱에서만 `enqueue` 가 동작한다 — publisher 가 적재 대상을 알아야 하기
    // 때문이다(ADR-0029 §5). 켜지 않은 앱에서 `enqueue` 를 부르면 던진다.
    const enableOutbox = options.enableOutbox ?? false;

    // 각 stream별 StreamPublisher 제공자 생성
    const publisherProviders = publishes.map((stream) => ({
      provide: this.getPublisherToken(stream.topic.topic),
      useFactory: (
        transport: EventTransport,
        eventChainService: EventChainService,
        eventTrackingService: EventTrackingService,
        outboxWriter?: OutboxWriter,
        tenantStamp?: EventTenantStamp,
      ) => {
        return new StreamPublisher(
          transport,
          stream,
          serviceName,
          options.validation, // 스키마 검증 옵션 전달
          eventChainService,
          eventTrackingService,
          outboxWriter,
          tenantStamp,
        );
      },
      // `OutboxPublisher` 는 **항상 optional 로** 주입한다 (Task 6-C-2). 그 전에는 같은
      // `forRoot` 호출이 `enableOutbox: true` 여야만 주입 목록에 들어갔는데, 아웃박스는 앱 하나에
      // 테이블 하나이고 BC 별 `forRoot` 는 여럿이라 그 결합이 어긋난다 — core 는 catalog 만
      // 아웃박스를 켰지만 inventory·fulfillment·sales-order 의 publisher 도 `enqueue` 를 쓴다.
      // 이 모듈은 `@Global()` 이라 어느 한 곳이 켜면 provider 는 앱 전체에서 보인다. 아무도 켜지
      // 않은 앱에서는 그대로 `undefined` 이고 `enqueue` 가 던진다 = 이 변경 전과 같다.
      inject: [
        EVENT_TRANSPORT,
        EventChainService,
        EventTrackingService,
        { token: OutboxPublisher, optional: true },
        EventTenantStamp,
      ],
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
        await bootstrapKafkaTopics({ kafka, streams: publishes, includeDLQ: enableDLQ });
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
              tenantStamp?: EventTenantStamp,
            ) => {
              // topic -> StreamPublisher 매핑 생성
              const publisherMap = new Map<string, StreamPublisher>();
              publishes.forEach((stream) => {
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

              return new OutboxDispatcher(
                dbService,
                publisherMap,
                options.outbox,
                resolvePublisher,
                dispatchGate,
                tenantStamp,
              );
            },
            inject: [
              DbService,
              EVENT_TRANSPORT,
              EventChainService,
              EventTrackingService,
              ModuleRef,
              { token: OUTBOX_DISPATCH_GATE, optional: true },
              EventTenantStamp,
            ],
          },
          {
            // 적체 게이지 (#712). 아웃박스를 켠 앱에만 붙는다 — 테이블이 없는 앱에서 돌면 매
            // tick 이 실패 로그만 남긴다. `SCHEDULE_ROOT` 는 바로 위 `enableOutbox` 분기가
            // 이미 imports 에 넣으므로 `@Cron` 이 산다.
            //
            // 선언 토픽은 이 `forApp` 호출의 것뿐이다. 그것만으로는 부족하고(core 는 아웃박스를
            // 켠 BC 가 하나인데 적재는 여럿이 한다), 나머지는 collector 가 첫 tick 에
            // 테이블에서 훑는다.
            provide: OutboxMetricsCollector,
            useFactory: (dbService: DbService) =>
              new OutboxMetricsCollector(
                dbService,
                publishes.map((stream) => stream.topic.topic),
              ),
            inject: [DbService],
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

    // 앱이 선언한 소비 검증 정책. `startConsumer` 가 읽어 마이크로서비스 스코프
    // 인터셉터를 만들 때 쓴다 (ADR-0029 §8) — 정책은 도출 불가한 사실이라 선언이 맞고,
    // 스트림 목록만 도출로 대체된다. 선언하지 않으면 provider 자체가 없고
    // `buildConsumerInterceptors` 의 `optionalGet` 이 기본값(`validateOnConsume: true`)
    // 으로 떨어진다.
    const consumerPolicyProviders = options.policy
      ? [{ provide: EVENTS_CONSUMER_POLICY, useValue: { validation: options.policy } }]
      : [];

    const providers = [
      retryInterceptorProvider, // 최외곽 — 등록 순서가 래핑 순서
      eventTransportProvider, // Kafka 로 나가는 유일한 통로
      eventTenantStampProvider, // 봉투 테넌트 — publisher·디스패처가 주입받는다
      ...publisherProviders,
      ...(dlqProvider ? [dlqProvider] : []),
      ...outboxProviders,
      ...trackingProviders,
      ...consumerPolicyProviders, // startConsumer 가 읽는 소비 정책
      shutdownProvider, // Graceful shutdown 항상 등록
      topicBootstrapProvider, // MSK Serverless 등 auto-create 불가 환경 대응
    ];

    return {
      module: EventsModule,
      imports: [
        ClsModule.forRoot({ global: true, middleware: { mount: false } }),
        ...(enableOutbox ? [SCHEDULE_ROOT] : []),
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
   * 소비를 시작한다 — 구독 목록 인자 없음 (ADR-0029 §3)
   *
   * 컨테이너를 훑어 `@On` 핸들러를 찾고, 거기서 **구독 토픽 · 검증 스키마 맵 ·
   * 토픽 부트스트랩 목록을 전부 파생**한다. 선언과 실제가 어긋날 자리가 없다.
   *
   * 세 가지를 부팅에서 거부한다 — 전부 지금까지 완전 무증상이던 실수다:
   * - 계약 레지스트리에 없는 토픽 구독
   * - `@On` 핸들러 0개 (컨트롤러를 `controllers: []` 에 등록하지 않은 경우.
   *   Nest 는 이때 `subscribe` 자체를 건너뛰므로 로그조차 남지 않는다)
   * - `forApp({ policy })` 를 두 곳 이상에서 선언 (어느 것이 이기는지 알 수 없다)
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
    const kafka = options.kafka || this.requireKafkaConfigFromEnv('startConsumer');
    const tenantGate = this.requireTenantGate(app, options.tenancy);
    const derived = deriveConsumerConfig(discoverEventHandlers(app));

    const enableAutoDLQ = options.enableAutoDLQ ?? true;

    if (!options.strategy) {
      await bootstrapKafkaTopics({ kafka, streams: derived.streams, includeDLQ: enableAutoDLQ });
    }

    // 서버를 직접 만든다 (#1016 8번). 다시 넣기가 이 서버의 `getHandlerByPattern` 을 써야 하는데
    // `NestMicroservice` 의 서버 인스턴스는 private 이다. `{ strategy }` 분기는 `{ transport, options }` 와
    // 같은 서버를 만든다(`nest-microservice.js` createServer → `ServerFactory.create` 는 `new ServerKafka(options)` 뿐).
    const server: CustomTransportStrategy & Server =
      options.strategy ?? new ServerKafka(buildKafkaConsumerServerOptions(kafka, options));

    // deferInitialization 없이 부르면 Nest 가 즉시 리스너를 바인딩해버려
    // useGlobalInterceptors 가 늦는다. 미룬 뒤 인터셉터를 얹고, 비-defer 경로가
    // 하던 일(리스너 바인딩 + 초기화 플래그)을 직접 한다 — 플래그를 세우지 않으면
    // listen() 이 registerModules() 를 타면서 onModuleInit 이 두 번 실행된다.
    const microservice = app.connectMicroservice(
      { strategy: server },
      {
        deferInitialization: true,
      },
    ) as NestMicroservice;

    // 실패 테이블 (#1016 8번). 앱이 `EventFailuresModule` 을 import 했을 때만 있다.
    const deadLetters = await this.enableDeadLetters(app, options.groupId, server, logger);

    microservice.useGlobalInterceptors(...buildConsumerInterceptors(app, derived.streams, deadLetters, tenantGate));
    microservice.registerListeners();
    microservice.setIsInitialized(true);
    microservice.setIsInitHookCalled(true);

    await app.startAllMicroservices();

    logger.log(
      `Consumer started (groupId=${options.groupId}) — ${derived.handlers.length} handler(s) on ` +
        `${derived.topics.length} topic(s): ${derived.topics.join(', ')}`,
    );

    // lag 폴러(#815). 전략을 넘긴 경우(인메모리)는 붙을 브로커가 없으므로 토픽 부트스트랩과
    // 같이 건너뛴다. 토픽 목록은 위에서 도출한 것 그대로다 — 손으로 나열하면 어긋난다.
    if (!options.strategy) {
      this.startConsumerLagPoller(kafka, `${options.groupId}${KAFKA_CONSUMER_GROUP_POSTFIX}`, derived);
    }

    return derived;
  }

  /**
   * 테넌트 문을 세운다. 틀리면 소비를 시작하기 전에 던진다 — 기동 거부. 전부 «조용히 죽는» 실수다:
   * - 모드 선언이 없다(JS 호출·타입 우회). 기본 모드를 두면 «T 만 섬김» 앱이 «메시지마다»로 남의 테넌트를 처리한다.
   * - 테넌트 목록이 없다(`TenancyModule` 미import). 문이 판정할 기준이 없다.
   * - `served-tenant` 인데 T 가 없거나 목록에 없다. 모든 메시지를 건너뛰며 아무 일도 하지 않는다.
   */
  private static requireTenantGate(app: INestApplication, tenancy: ConsumerTenancy | undefined): EventTenantGate {
    if (!tenancy || !CONSUMER_TENANCIES.includes(tenancy)) {
      throw new TenancyConfigError('startConsumer({ tenancy })', [
        `소비 앱의 테넌트 모드가 없거나 틀렸다(${String(tenancy)}) — ${CONSUMER_TENANCIES.join(' 또는 ')}. 기본값은 없다`,
      ]);
    }
    const config = optionalGet(app, TenancyConfig);
    if (!config) {
      throw new TenancyConfigError('TenancyModule', [
        '소비 앱이 테넌트 목록을 받지 않았다 — 루트 모듈에 TenancyModule(@app/tenancy) 을 import 할 것',
      ]);
    }
    const servedTenantId =
      tenancy === 'served-tenant'
        ? requireServedTenant(config.tenants, process.env[TENANCY_ENV.servedTenantId]).id
        : undefined;
    return new EventTenantGate({ tenancy, servedTenantId, tenants: config.tenants, gateMode: config.gateMode });
  }

  /**
   * 실패 테이블 모드를 켠다 (#1016 8번). 테이블이 없으면 **켜지 않는다** — 마이그 없이 배포되면 보류 검사가 매 메시지
   * 던져 모든 파티션이 멈추기 때문이다(이 저장소는 10-10 에 마이그 없는 배포로 두 시간 장애를 냈다). 끄면 옛 `.dlq` 경로로
   * 돌고 outbox 쪽은 그대로 동작한다. 순서는 여전히 `migrate → deploy` 다 — 이건 그 순서가 어긋났을 때의 안전망이다.
   */
  private static async enableDeadLetters(
    app: INestApplication,
    consumerGroup: string,
    server: Server,
    logger: Logger,
  ): Promise<DeadLetterInterceptorOptions | undefined> {
    const runtime = optionalGet(app, DeadLetterRuntime);
    if (!runtime) return undefined;

    const tables = await checkDeadLetterTables(app.get(DbService, { strict: false }));
    if (!tables.present) {
      logger.error(
        `실패 테이블 모드를 켜지 않는다 — event.dead_letters·event.failure_actions 가 없다` +
          `${tables.queryError ? ` (확인 질의 실패: ${tables.queryError})` : ''}. ` +
          `마이그 \`${DEAD_LETTER_MIGRATION_NAME}\` 이 이 앱 DB 에 적용되지 않았다. 결과: 컨슈머 최종 실패는 옛 \`.dlq\` 토픽으로 가고, ` +
          `보류(같은 순서 키 지키기)는 꺼지며, /event-failures 의 컨슈머 실패 다시 넣기·종결은 쓸 수 없다. ` +
          `db:migrate 후 재시작하면 켜진다.`,
      );
      return undefined;
    }

    runtime.attach({ consumerGroup, server });
    return {
      recorder: app.get(DeadLetterStore, { strict: false }),
      consumerGroup,
      sequencedTopics: app.get<EventFailuresOptions>(EVENT_FAILURES_OPTIONS, { strict: false }).sequencedTopics,
    };
  }

  /**
   * admin 클라이언트는 `KAFKA_CLIENT`(producer 전용) 와 별개다 — `topic-bootstrap` 이 자기
   * `Kafka` 인스턴스를 만드는 것과 같은 이유로, 소비자 연결에 admin 요청을 섞지 않는다.
   * 첫 tick 은 기다리지 않는다(`void`): 브로커가 늦어도 부팅이 늦어지면 안 된다.
   */
  private static startConsumerLagPoller(kafka: KafkaConfig, groupId: string, derived: DerivedConsumerConfig): void {
    const admin = new Kafka({
      clientId: `${kafka.clientId}-lag`,
      brokers: kafka.brokers,
      ssl: kafka.ssl,
      sasl: kafka.sasl,
      retry: kafka.retry,
    }).admin();
    const collector = new ConsumerLagCollector(
      admin,
      groupId,
      derived.streams.map((stream) => stream.topic),
    );
    registerConsumerLagCollector(collector);
    void collector.start();
  }

  /**
   * 환경변수의 Kafka 설정. 없으면 **원인을 말하며** 던진다 — `forApp`·`startConsumer` 는 Kafka 없이
   * 뜰 수 없다. 예전엔 `null` 을 그대로 넘겨 `Cannot read properties of null (reading 'clientId')`
   * 로 죽었고, 로그만으로는 무엇이 빠졌는지 알 수 없었다.
   * Kafka 를 선택 사항으로 두려는 앱은 `createKafkaConfigFromEnv()` 로 먼저 묻고 이 모듈을
   * 조건부로 import 한다(ai 가 그렇다).
   */
  private static requireKafkaConfigFromEnv(caller: 'forApp' | 'startConsumer'): KafkaConfig {
    const config = createKafkaConfigFromEnv();
    if (!config) {
      throw new Error(
        `EventsModule.${caller}: KAFKA_BROKERS 가 설정되지 않았다. 이 앱은 Kafka 없이 부팅할 수 없다 — ` +
          `.env 에 KAFKA_BROKERS 를 넣을 것(로컬은 localhost:9092).`,
      );
    }
    return config;
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
