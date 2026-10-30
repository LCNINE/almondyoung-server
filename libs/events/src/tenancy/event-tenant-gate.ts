import { CallHandler, ExecutionContext, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KafkaContext } from '@nestjs/microservices';
import { ClsService } from 'nestjs-cls';
import { Observable, of } from 'rxjs';
import { TENANT_CONTEXT_KEY, type TenantGateMode, type TenantList } from '@app/tenancy';
import { eventTenancy } from '@packages/event-contracts/streams/registry';
import { EVENT_TYPE_FILTER } from '../consumers/decorators';
import { parseEnvelope } from '../utils/envelope.util';
import { recordConsumedWithoutKnownTenant, recordSkippedOtherTenant } from './tenant-gate.metrics';

/**
 * 소비 앱이 선언하는 테넌트 모드. 기본값은 없다 — `startConsumer` 가 선언 없이 부르면 기동을 거부한다.
 * - `per-message`   : 메시지마다 봉투의 테넌트를 맥락으로 세운다(core·user-service).
 * - `served-tenant` : 앱 설정 T 하나만 섬긴다. T 와 다른 테넌트 이벤트는 건너뛴다(그 밖의 소비 앱 전부).
 */
export type ConsumerTenancy = 'per-message' | 'served-tenant';

export const CONSUMER_TENANCIES: readonly ConsumerTenancy[] = ['per-message', 'served-tenant'];

/**
 * 테넌트 이벤트인데 테넌트가 없거나 목록에 없다(② reject). 재시도해도 봉투는 바뀌지 않으므로 재시도 없이 DLQ 로 간다 —
 * `EventRetryInterceptor` 가 비재시도 에러로 분류한다.
 */
export class TenantGateRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantGateRejection';
  }
}

export type TenantGateVerdict =
  /** 핸들러에 넘긴다. `tenantId` 가 있으면 그것이 맥락이다. 계정 이벤트·① 의 모르는 테넌트는 맥락 없이 넘긴다. */
  | { kind: 'pass'; tenantId: string | undefined }
  /** 남의 테넌트 — 그 테넌트의 정상 업무라 실패가 아니다. */
  | { kind: 'skip' }
  /** ② 에서 테넌트가 없거나 목록에 없다. */
  | { kind: 'reject'; reason: string }
  /** ① 에서 테넌트가 없거나 목록에 없다 — 경고하고 세고 맥락 없이 넘긴다. */
  | { kind: 'warn'; reason: string; cause: 'missing' | 'unlisted' };

/** 문이 보는 봉투의 두 칸 — 종류(계정/테넌트 판정)와 테넌트. 남이 보낸 값이라 `tenantId` 는 모양을 믿지 않는다. */
export interface GatedEnvelope {
  messageType: string;
  metadata?: { tenantId?: unknown };
}

export interface EventTenantGateOptions {
  tenancy: ConsumerTenancy;
  /** `served-tenant` 일 때만. 목록과 대조를 마친 값이다. */
  servedTenantId: string | undefined;
  tenants: TenantList;
  gateMode: TenantGateMode;
}

/** 판정만 한다 — 순수 함수라 두 인터셉터가 같은 메시지에 같은 답을 낸다. */
export class EventTenantGate {
  constructor(private readonly options: EventTenantGateOptions) {}

  judge(topic: string, envelope: GatedEnvelope): TenantGateVerdict {
    if (eventTenancy(topic, envelope.messageType) === 'account') return { kind: 'pass', tenantId: undefined };

    const raw = envelope.metadata?.tenantId;
    const tenantId = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
    const cause = !tenantId ? 'missing' : !this.options.tenants.find(tenantId) ? 'unlisted' : undefined;
    if (cause) {
      const reason =
        cause === 'missing'
          ? `테넌트 이벤트 ${envelope.messageType} 에 봉투 테넌트(metadata.tenantId)가 없다`
          : `테넌트 이벤트 ${envelope.messageType} 의 봉투 테넌트 «${String(tenantId)}» 가 테넌트 목록에 없다`;
      return this.options.gateMode === 'reject' ? { kind: 'reject', reason } : { kind: 'warn', reason, cause };
    }

    if (this.options.tenancy === 'served-tenant' && tenantId !== this.options.servedTenantId) return { kind: 'skip' };
    return { kind: 'pass', tenantId };
  }
}

/**
 * 판정 대상 메시지를 고른다. 판정하지 않는 것(undefined):
 * - Kafka 메시지가 아닌 실행(HTTP 등)
 * - 이 핸들러가 받는 종류가 아닌 메시지 — `EventTypeGuard`·재시도 인터셉터가 조용히 버린다. 여기서 판정하면 한 토픽의
 *   핸들러 수만큼 세고, ② 에선 그만큼 DLQ 에 쌓인다.
 * - 봉투로 알아볼 수 없는 메시지(`messageType` 이 문자열이 아니다) — 종류를 모르니 계정/테넌트도 모른다. 검증 인터셉터 몫이다.
 */
function judgeable(
  context: ExecutionContext,
  reflector: Reflector,
): { topic: string; envelope: GatedEnvelope } | undefined {
  if (context.getType() !== 'rpc') return undefined;
  const kafkaContext = context.switchToRpc().getContext<KafkaContext>();
  if (!(kafkaContext instanceof KafkaContext)) return undefined;

  let parsed: unknown;
  try {
    parsed = parseEnvelope(kafkaContext.getMessage().value);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  // 바로 아래 줄에서 `messageType` 이 문자열인지 확인한 뒤에만 봉투로 쓴다
  const envelope = parsed as { messageType?: unknown } & Pick<GatedEnvelope, 'metadata'>;
  if (typeof envelope.messageType !== 'string') return undefined;

  const expected = reflector.get<string | undefined>(EVENT_TYPE_FILTER, context.getHandler());
  if (expected && expected !== envelope.messageType) return undefined;

  return {
    topic: kafkaContext.getTopic(),
    envelope: { messageType: envelope.messageType, metadata: envelope.metadata },
  };
}

/**
 * 문의 바깥 면 — `EventRetryInterceptor` **바깥**(CLS 바로 안쪽)에 선다. 건너뛸 메시지는 재시도·실패 기록·보류 검사에
 * 닿기 전에 여기서 끝낸다. 재시도 안쪽에서 끝내면 순서 토픽의 보류 검사가 남의 테넌트 메시지를 우리 실패 행 뒤에 «보류»로
 * 적을 수 있다(순서 키가 테넌트를 모른다).
 */
export class TenantGateInterceptor implements NestInterceptor {
  private readonly logger = new Logger('EventTenantGate');

  constructor(
    private readonly gate: EventTenantGate,
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = judgeable(context, this.reflector);
    if (!target) return next.handle();

    const verdict = this.gate.judge(target.topic, target.envelope);
    switch (verdict.kind) {
      case 'skip':
        recordSkippedOtherTenant(target.topic);
        return of(undefined); // 정상 완료 → 커밋
      case 'pass':
        if (verdict.tenantId) this.cls.set(TENANT_CONTEXT_KEY, verdict.tenantId);
        return next.handle();
      case 'warn':
        this.logger.warn(`${verdict.reason}. 맥락 없이 처리한다(TENANT_GATE_MODE=warn). topic=${target.topic}`);
        recordConsumedWithoutKnownTenant(target.topic, verdict.cause);
        return next.handle();
      case 'reject':
        // 거절은 안쪽 면이 던진다 — 여기서 던지면 재시도·DLQ 분류망 밖이라 커밋되지 않고 영영 다시 온다.
        return next.handle();
    }
  }
}

/** 문의 안쪽 면 — `EventRetryInterceptor` **안쪽**에서 ② 의 거절을 던진다. 재시도망이 비재시도로 분류해 DLQ 로 보낸다. */
export class TenantGateRejectInterceptor implements NestInterceptor {
  constructor(
    private readonly gate: EventTenantGate,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = judgeable(context, this.reflector);
    if (!target) return next.handle();

    const verdict = this.gate.judge(target.topic, target.envelope);
    if (verdict.kind === 'reject') throw new TenantGateRejection(verdict.reason);
    return next.handle();
  }
}
