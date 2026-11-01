import { Logger } from '@nestjs/common';
import type { TenantGateMode } from '@app/tenancy';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { OUTBOX_TENANT_FROM_CONTEXT, type OutboxTenant } from '../outbox/outbox-tenant.port';
import { recordPublishedWithoutTenant } from './tenant-stamp.metrics';

export interface EventTenantStampOptions {
  /** 지금 맥락의 테넌트(요청·메시지). 없으면 `undefined`. */
  contextTenant: () => string | undefined;
  /** 앱 설정 T. 목록과 대조를 마친 값이다. «T 만 섬기는» 앱이 아니면 `undefined`. */
  servedTenantId: string | undefined;
  /**
   * 이 앱 outbox 테이블이 든 DB 의 테넌트. core ① 은 접속한 DB 로, 다른 앱은 T 로 정해진다.
   * `OUTBOX_TENANT_FROM_CONTEXT` 면 DB 를 맥락이 고른다(core ②) — 디스패처가 도는 테넌트 루프의 맥락으로 찍는다.
   */
  outboxTenantId: OutboxTenant | undefined;
  gateMode: TenantGateMode;
}

/**
 * 봉투에 찍을 테넌트를 정한다. 생산 코드는 테넌트를 넘기지 않는다 — 넘겨도 덮어쓴다.
 *
 * - 직접 발행: 맥락의 테넌트, 없으면 앱의 T.
 * - outbox 발행: 행이 든 DB 의 테넌트. 적재 때가 아니라 나갈 때 찍으므로, 이 코드 전에 쌓인 행도 찍힌다.
 *   ① 은 맥락을 보지 않는다 — 행의 테넌트는 DB 가 이미 말한다. ② 의 core 는 그 DB 를 맥락이 골랐으므로 맥락이 곧 DB 의 테넌트다.
 *
 * 정할 수 없으면 ① warn 은 테넌트 없이 보내고 경고·셈, ② reject 는 던진다(발행이 실패한다).
 */
export class EventTenantStamp {
  private readonly logger = new Logger(EventTenantStamp.name);

  constructor(private readonly options: EventTenantStampOptions) {}

  /** 직접 발행의 봉투에 찍는다. */
  stampDirect<T extends MessageEnvelope>(envelope: T): T {
    return withTenant(envelope, this.forDirectPublish());
  }

  /** outbox 행에 실린 봉투에 찍는다. */
  stampOutbox<T extends MessageEnvelope>(envelope: T): T {
    return withTenant(envelope, this.forOutboxPublish());
  }

  forDirectPublish(): string | undefined {
    return this.resolveOrWarn(this.options.contextTenant() ?? this.options.servedTenantId, 'direct');
  }

  forOutboxPublish(): string | undefined {
    const { outboxTenantId } = this.options;
    const tenantId = outboxTenantId === OUTBOX_TENANT_FROM_CONTEXT ? this.options.contextTenant() : outboxTenantId;
    return this.resolveOrWarn(tenantId, 'outbox');
  }

  private resolveOrWarn(tenantId: string | undefined, path: 'direct' | 'outbox'): string | undefined {
    if (tenantId) return tenantId;

    const reason =
      path === 'direct'
        ? '직접 발행에 테넌트가 없다 — 맥락에도 없고 앱 설정 T(SERVED_TENANT_ID)도 없다'
        : 'outbox 발행에 테넌트가 없다 — 이 앱 outbox DB 의 테넌트를 모른다';
    if (this.options.gateMode === 'reject') throw new Error(reason);

    this.logger.warn(`${reason}. 테넌트 없이 보낸다(TENANT_GATE_MODE=warn).`);
    recordPublishedWithoutTenant(path);
    return undefined;
  }
}

/**
 * `metadata.tenantId` 만 바꾼다. payload 는 손대지 않는다 — strict 토픽의 옛 소비자가 모르는 키에 throw 한다.
 * 테넌트가 없으면 생산 코드가 넣은 값도 지운다(찍는 주체는 라이브러리 하나다).
 */
export function withTenant<T extends MessageEnvelope>(envelope: T, tenantId: string | undefined): T {
  const { tenantId: _ignored, ...rest } = envelope.metadata ?? {};
  const metadata = tenantId ? { ...rest, tenantId } : rest;
  return { ...envelope, metadata: Object.keys(metadata).length > 0 ? metadata : undefined };
}
