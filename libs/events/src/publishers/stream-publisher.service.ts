/**
 * Stream Publisher Service
 *
 * 도메인 스트림 기반 이벤트/커맨드 발행
 */

import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { v7 } from 'uuid';
import { DomainEvent, DomainCommand, MessageEnvelope } from '@packages/event-contracts/types';
import { StreamConfig, StreamEventTypes, EventType } from '@packages/event-contracts/types';
import { generateMessageId } from '../utils/message-id.util';
import { SchemaValidationOptions, DEFAULT_SCHEMA_VALIDATION_OPTIONS } from '@packages/event-contracts/types';
import { validateSchemaOrThrow, logValidationError, isZodSchema } from '../validation/schema-validation.util';
import { EventChainService } from '../tracking/event-chain.service';
import { EventTrackingService } from '../tracking/event-tracking.service';
import { EventTransport } from '../transport/transport.port';
import type { OutboxWriter } from '../outbox/outbox-writer.port';
import type { DbTx } from '../outbox/outbox.types';

export interface CausedByResource {
  resourceType: string;
  resourceId: string;
  description?: string;
}

/**
 * 이벤트 발행 파라미터 (타입 안전 버전)
 */
export interface PublishEventParams<TEventKey extends string, TPayload> {
  eventType: TEventKey;
  aggregateId: string;
  payload: TPayload;

  // 선택 사항
  aggregateVersion?: number;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * 아웃박스 적재 파라미터 (ADR-0029 §5-1, Task 6-C-2).
 *
 * `publishEvent` 의 파라미터에 **아웃박스 행에만 있는 두 사실**을 더한 것이다. 즉시 발행에는
 * 없는 것들이라 `PublishEventParams` 를 넓히지 않고 여기서 확장한다 — 즉시 발행은 중복될
 * 트랜잭션 경계가 없어 멱등 키를 실을 자리가 없고, 파티션 키는 그 자리에서 해석돼 전송에
 * 쓰이고 사라진다.
 */
export type EnqueueEventParams<TEventKey extends string, TPayload> = PublishEventParams<TEventKey, TPayload> & {
  /**
   * 같은 사실의 두 번째 적재를 DB 제약이 막게 하는 키. **생략하면 중복 방어가 없다** —
   * 없던 것이 생기지도, 있던 것이 사라지지도 않는다(옵셔널, additive).
   */
  idempotencyKey?: string;

  /**
   * 파티션 키를 호출자가 지정한다. 생략하면 스트림 파생(`streamConfig.partitionKey`) →
   * `aggregateId` 순으로 해석한다.
   *
   * **왜 파생만으로 통일하지 않았는가 (2026-08-09 실측 근거).** ADR §1 의 원칙은 파생이지만,
   * 파생의 단위는 *스트림*이고 실제 키는 *이벤트별*로 갈린다:
   *
   *  - `inventory.events.v1` — 재고 이벤트는 `skuId` 로, `ProductSellableQuantityChanged` 는
   *    `variantId` 로 파티션된다. aggregateId 는 셋 다 다른 값(재고 이벤트 id / variantId)이다.
   *  - `fulfillments.events.v1` — FO 완료 투영은 `salesOrderId ?? foId`, v1 배송 완료는
   *    `fulfillmentId`, 주문 이벤트는 `orderId`.
   *
   * 스트림 하나에 파생 함수 하나(`(payload: any) => string`)로는 이 갈래를 페이로드 필드
   * 유무로 넘겨짚지 않고는 표현할 수 없다. 그리고 파생으로 밀어붙이면 재고 이벤트가
   * `skuId` 대신 재고이벤트 id 로 파티션돼 **SKU 단위 순서 보장이 조용히 사라진다** — 이
   * ADR 이 내내 다룬 "무증상 소실"을 그대로 재생산하는 것이다. 그래서 파생을 기본으로 두되
   * (파생 함수가 있는 `shipments.events.v1` · `fulfillments.events.v2` 는 그대로 파생을 쓴다)
   * 명시 지정을 허용한다.
   */
  partitionKey?: string;
};

/**
 * 커맨드 발행 파라미터 (타입 안전 버전)
 */
export interface PublishCommandParams<TCommandKey extends string, TPayload> {
  commandType: TCommandKey;
  aggregateId: string;
  payload: TPayload;

  // 선택 사항
  expiresIn?: number; // ms
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class StreamPublisher<TEvents extends StreamEventTypes = StreamEventTypes> {
  private readonly logger: Logger;
  private readonly validationOptions: Required<SchemaValidationOptions>;

  constructor(
    private readonly transport: EventTransport,
    private readonly streamConfig: StreamConfig<TEvents>,
    private readonly serviceName: string,
    validationOptions?: SchemaValidationOptions,
    private readonly eventChainService?: EventChainService,
    private readonly eventTrackingService?: EventTrackingService,
    /**
     * 아웃박스 적재 대상 (ADR-0029 §5). 없으면 `enqueue` 가 던진다 — 이 앱이 아웃박스를
     * 켜지 않았다는 뜻이고, 조용히 이벤트를 버리는 것보다 부팅/호출 시점에 드러나는 편이 낫다.
     */
    private readonly outboxWriter?: OutboxWriter,
  ) {
    this.logger = new Logger(`StreamPublisher:${streamConfig.topic.topic}`);
    this.validationOptions = {
      ...DEFAULT_SCHEMA_VALIDATION_OPTIONS,
      ...validationOptions,
    };
  }

  /**
   * 도메인 이벤트 발행 (타입 안전)
   *
   * @example
   * await publisher.publishEvent({
   *   eventType: 'OrderCreated',  // ← 자동완성됨, 오타 시 컴파일 에러
   *   aggregateId: 'ORD-123',
   *   payload: { orderId: 'ORD-123', customerId: 'USR-456', ... },
   * });
   */
  async publishEvent<K extends keyof TEvents & string>(
    params: PublishEventParams<K, TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never> & {
      causedBy?: CausedByResource;
    },
  ): Promise<void> {
    const envelope = this.buildEventEnvelope(params);

    const partitionKey = this.resolvePartitionKey(envelope.payload, params.aggregateId);
    await this.sendMessage(envelope, partitionKey);

    // causedBy가 있으면 CAUSE 링크 기록
    if (params.causedBy && this.eventTrackingService) {
      await this.eventTrackingService
        .trackCause({
          eventId: envelope.messageId,
          chainId: envelope.chainId as string,
          eventType: envelope.messageType,
          ...params.causedBy,
        })
        .catch((err) => this.logger.warn('Failed to track cause', err?.message));
    }
  }

  /**
   * 트랜잭셔널 아웃박스 적재 (ADR-0029 §5)
   *
   * `publishEvent` 와 **같은 파라미터·같은 타입 도출·같은 검증**이고, 다른 것은 배달 방식뿐이다.
   * 즉시 Kafka 로 보내는 대신 호출자의 트랜잭션에 행으로 남기고, 디스패처가 커밋 이후에 발행한다.
   *
   * 검증이 여기서 일어나는 것이 이 메서드의 요점이다. 잘못된 payload 는 아웃박스에 poison row 로
   * 남아 나중에 소비자 DLQ 에서 발견되는 대신, **호출자의 도메인 트랜잭션을 그 자리에서 실패시킨다.**
   * 진단 위치가 원인에 붙어 있다.
   *
   * @example
   * await this.products.enqueue(
   *   { eventType: 'ProductMasterDeleted', aggregateId: masterId, payload: { masterId, deletedAt } },
   *   tx,
   * );
   */
  async enqueue<K extends keyof TEvents & string>(
    params: EnqueueEventParams<K, TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never>,
    tx: DbTx,
  ): Promise<void> {
    if (!this.outboxWriter) {
      throw new Error(
        `Stream ${this.streamConfig.topic.topic} has no outbox writer — ` +
          'EventsModule.forApp({ enableOutbox: true }) 가 필요하다.',
      );
    }

    const envelope = this.buildEventEnvelope(params);

    // 파티션 키는 **적재 시점에 해석해서 행에 싣는다.** 디스패처에서 해석하면 그때의 스트림
    // 설정이 적용되므로, 적재와 발행 사이에 파생 함수가 바뀌면 행이 조용히 다른 파티션으로
    // 간다. 발행 시점에 이미 결정된 사실을 행이 그대로 들고 있는 편이 낫다.
    const partitionKey = this.resolvePartitionKey(envelope.payload, params.aggregateId, params.partitionKey);

    await this.outboxWriter.write(
      {
        topic: this.streamConfig.topic.topic,
        aggregateType: this.streamConfig.aggregateType,
        aggregateId: params.aggregateId,
        eventType: String(params.eventType),
        idempotencyKey: params.idempotencyKey,
        partitionKey,
        envelope,
      },
      tx,
    );

    this.logger.debug({
      msg: `📥 event enqueued: ${envelope.messageType}`,
      messageId: envelope.messageId,
      aggregateId: params.aggregateId,
    });
  }

  /**
   * Envelope 조립 + 검증 — `publishEvent` 와 `enqueue` 의 공통부.
   *
   * 싣는 것은 원본이 아니라 **zod 가 파싱한 결과**다. 파싱은 멱등이므로 이 envelope 는 같은
   * 스키마의 소비 검증을 반드시 통과한다 (ADR-0029 §8 "검증 스위치(C)").
   */
  private buildEventEnvelope<K extends keyof TEvents & string>(
    params: PublishEventParams<K, TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never>,
  ): DomainEvent<TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never> {
    const messageId = generateMessageId();
    const now = new Date();

    // 스키마 검증 (활성화된 경우)
    let validatedPayload = params.payload;
    if (this.validationOptions.validateOnPublish) {
      validatedPayload = this.validatePayload(String(params.eventType), params.payload);
    }

    // chainId: CLS 에서 읽고, 없으면 만들어 **CLS 에 심는다** (#612).
    // 옛 `getChainId() ?? v7()` 은 심지 않았기 때문에 같은 컨텍스트의 두 발행이 서로 다른
    // 사슬을 받았다 — 사슬이 컨슈머 경계에서만 끊긴 게 아니라 애초에 시작되지 않았다.
    // `EventChainService` 가 없는 앱(주입 optional)에서는 이 발행 한 건짜리 사슬이 맞다.
    const chainId = this.eventChainService?.ensureChainId() ?? v7();

    return {
      messageId,
      messageType: String(params.eventType),
      messageVersion: 1,
      messageKind: 'event',

      correlationId: params.correlationId || messageId,
      causationId: params.causationId,
      chainId,

      timestamp: now.toISOString(),
      occurredAt: (params.occurredAt || now).toISOString(),

      source: {
        service: this.serviceName,
        aggregateType: this.streamConfig.aggregateType,
        aggregateId: params.aggregateId,
        aggregateVersion: params.aggregateVersion,
      },

      payload: validatedPayload,
      metadata: params.metadata,
    };
  }

  /**
   * 우선순위: 호출자 지정 → 스트림 파생 → `aggregateId`.
   *
   * 세 갈래가 **같은 유효성 검사 한 곳**을 지나는 것이 요점이다. 호출자가 넘긴 빈 문자열이
   * 검사를 건너뛰면 그 메시지는 Kafka 에서 라운드로빈으로 흩어지고, 순서가 필요했던 키일수록
   * 증상이 늦게 나타난다.
   */
  private resolvePartitionKey(payload: unknown, aggregateId: string, explicit?: string): string {
    const partitionKey = explicit ?? this.streamConfig.partitionKey?.(payload as never) ?? aggregateId;
    if (typeof partitionKey !== 'string' || partitionKey.length === 0) {
      throw new Error(`Stream ${this.streamConfig.topic.topic} resolved an invalid partition key`);
    }
    return partitionKey;
  }

  /**
   * 배치 이벤트 발행
   *
   * @example
   * await publisher.publishEvents([
   *   { eventType: 'OrderCreated', aggregateId: 'ORD-123', payload: {...} },
   *   { eventType: 'OrderCreated', aggregateId: 'ORD-124', payload: {...} },
   * ]);
   */
  async publishEvents<K extends keyof TEvents & string>(
    events: Array<PublishEventParams<K, TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never>>,
  ): Promise<void> {
    await Promise.all(events.map((event) => this.publishEvent(event)));
  }

  /**
   * 도메인 명령 발행 (Command 패턴)
   *
   * @example
   * await publisher.publishCommand({
   *   commandType: 'ProcessOrder',
   *   aggregateId: 'ORD-123',
   *   payload: { orderId: 'ORD-123' },
   *   expiresIn: 60000, // 1분
   * });
   */
  async publishCommand<K extends keyof TEvents & string>(
    params: PublishCommandParams<K, TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never>,
  ): Promise<void> {
    const messageId = generateMessageId();
    const now = new Date();

    // 이벤트와 같은 검증을 탄다. 이 줄이 없던 동안 커맨드는 zod 를 우회하는 세 번째 경로였다
    // (ADR-0029 §8 "검증 스위치(C)" 의 전수 폐쇄 논증이 놓쳤던 자리).
    let validatedPayload = params.payload;
    if (this.validationOptions.validateOnPublish) {
      validatedPayload = this.validatePayload(String(params.commandType), params.payload);
    }

    const envelope: DomainCommand<TEvents[K] extends EventType<any, infer TPayload> ? TPayload : never> = {
      messageId,
      messageType: String(params.commandType),
      messageVersion: 1,
      messageKind: 'command',

      correlationId: params.correlationId || messageId,
      causationId: params.causationId,

      timestamp: now.toISOString(),

      source: {
        service: this.serviceName,
        aggregateType: this.streamConfig.aggregateType,
        aggregateId: params.aggregateId,
      },

      payload: validatedPayload,
      metadata: params.metadata,

      expiresAt: params.expiresIn ? new Date(Date.now() + params.expiresIn).toISOString() : undefined,
    };

    await this.sendMessage(envelope, params.aggregateId);
  }

  /**
   * 전송 (내부 메서드) — 어댑터가 Kafka 인지 인메모리인지 여기서는 모른다
   */
  private async sendMessage(envelope: MessageEnvelope, partitionKey: string): Promise<void> {
    const topic = this.streamConfig.topic.topic;

    try {
      await this.transport.send(topic, {
        key: partitionKey, // 파티션 키 (순서 보장)
        value: JSON.stringify(envelope),
        compress: true,
        headers: {
          'message-id': envelope.messageId,
          'message-type': envelope.messageType,
          'message-kind': envelope.messageKind,
          'aggregate-type': envelope.source.aggregateType,
          'aggregate-id': envelope.source.aggregateId,
          'correlation-id': envelope.correlationId,
          timestamp: envelope.timestamp,
        },
      });

      this.logger.debug({
        msg: `📤 ${envelope.messageKind} published: ${envelope.messageType}`,
        messageId: envelope.messageId,
        aggregateId: envelope.source.aggregateId,
        correlationId: envelope.correlationId,
      });
    } catch (error) {
      this.logger.error({
        msg: `❌ Failed to publish ${envelope.messageKind}: ${envelope.messageType}`,
        error: error instanceof Error ? error.message : String(error),
        messageId: envelope.messageId,
        aggregateId: envelope.source.aggregateId,
      });
      throw error;
    }
  }

  /**
   * 아웃박스에 저장된 envelope 발행 (ADR-0029 §5)
   *
   * 옛 이름은 `publishRawEnvelope` 였고 zod 를 우회했다 — 그것이 이 레포에서 검증되지 않는
   * 유일한 발행 경로였고, 소비 검증을 앱별로 켤 수 없게 만든 원인이었다(§8 "검증 스위치(C)").
   *
   * 이제 검증한다. `enqueue` 가 이미 적재 시점에 걸렀으므로 정상 경로에서는 두 번째 통과이고
   * 비용은 파싱 한 번이다. 이 문이 실제로 무는 것은 **enqueue 를 지나지 않은 행**이다:
   * 이 변경 이전에 적재돼 아직 PENDING 인 행, 그리고 테이블에 직접 insert 하는 앱 자체 판본
   * (wallet). 그 행들이 남아 있는 한 "Kafka 로 나간 것은 검증을 통과한 값"이 조건부가 된다.
   *
   * 실패하면 던진다 — 디스패처가 그 행을 실패로 기록하고 재시도/DLQ 정책에 태운다. 조용히
   * 넘기면 아웃박스가 검증을 무력화하는 우회로로 되돌아간다.
   */
  async publishStoredEnvelope(envelope: MessageEnvelope, partitionKey: string): Promise<void> {
    let payload = envelope.payload;
    if (this.validationOptions.validateOnPublish) {
      payload = this.validatePayload(envelope.messageType, envelope.payload);
    }

    await this.sendMessage({ ...envelope, payload }, partitionKey);
  }

  /**
   * 토픽 정보 조회
   */
  getTopicInfo(): {
    topic: string;
    aggregateType: string;
    eventTypes: string[];
  } {
    return {
      topic: this.streamConfig.topic.topic,
      aggregateType: this.streamConfig.aggregateType,
      eventTypes: Object.keys(this.streamConfig.events),
    };
  }

  /**
   * Payload 스키마 검증 (내부 메서드)
   */
  private validatePayload<T>(eventType: string, payload: T): T {
    const eventConfig = this.streamConfig.events[eventType];

    if (!eventConfig) {
      this.logger.warn(`Event type not found in stream config: ${eventType}`);
      return payload;
    }

    const schema = eventConfig.schema;

    // 스키마가 없으면 검증 생략
    if (!schema || !isZodSchema(schema)) {
      return payload;
    }

    try {
      // 스키마 검증 수행
      const validatedPayload = validateSchemaOrThrow(schema, payload, `${this.streamConfig.topic.topic}.${eventType}`);

      this.logger.debug(`✅ Schema validation passed: ${eventType}`);

      return validatedPayload;
    } catch (error) {
      if (this.validationOptions.throwOnValidationError) {
        // 에러를 다시 던짐
        throw error;
      } else {
        // 경고만 로깅하고 원본 payload 반환
        this.logger.warn(`⚠️  Schema validation failed but throwOnValidationError is false: ${eventType}`);
        return payload;
      }
    }
  }
}
