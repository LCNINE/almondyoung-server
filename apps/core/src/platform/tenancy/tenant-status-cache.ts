import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Gauge, register } from 'prom-client';

/** user-service 테넌트 행의 상태. 준비 → 활성 ↔ 정지. */
export const TENANT_STATUSES = ['preparing', 'active', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

/** 요청을 거절하는 이유. */
export type TenantRefusal = Exclude<TenantStatus, 'active'>;

/** 테넌트 상태를 어디서 받는가. 실패는 throw. */
export abstract class TenantStatusSource {
  abstract isConfigured(): boolean;
  abstract fetch(): Promise<ReadonlyMap<string, TenantStatus>>;
}

export const TENANT_STATUS_OPTIONS = Symbol('TENANT_STATUS_OPTIONS');

export interface TenantStatusOptions {
  /** 갱신 주기 = 정지가 core 에 닿는 최대 지연(+ 응답 시간). 액세스 토큰 수명(15분)보다 훨씬 짧게. */
  readonly refreshIntervalMs: number;
  /** 한 번도 받지 못했을 때 첫 재시도 간격. 1s·2s·4s… 로 늘어 주기 값에서 멈춘다. */
  readonly retryBaseMs: number;
}

export const DEFAULT_TENANT_STATUS_OPTIONS: TenantStatusOptions = { refreshIntervalMs: 15_000, retryBaseMs: 1_000 };

// 마지막 성공 시각. 실패가 이어져도 마지막 값을 쓰므로, 이 값이 멀어지면 정지가 core 에 닿지 않고 있다는 뜻이다.
const lastLoaded = new Gauge({
  name: 'core_tenant_status_last_success_timestamp_seconds',
  help: 'when core last loaded tenant statuses from user-service (stale = suspensions are not reaching core)',
  registers: [register],
});

/**
 * user-service 테넌트 상태의 프로세스 내 사본 — 정지 스위치가 남은 액세스 토큰까지 막는 자리.
 *
 * 요청 경로는 이 사본만 본다(네트워크 0). 갱신은 배경에서 주기적으로 하고, 실패하면 마지막 사본을 그대로 쓴다.
 * 한 번도 받지 못했으면 아무것도 막지 않는다: 그때는 권한 사본도 비어 권한 라우트가 이미 판정 불가이고,
 * 여기서까지 막으면 user-service 장애가 core 의 공개·고객 경로까지 끌어내린다. 정지된 테넌트의 토큰은
 * user-service 가 갱신을 거절하므로 길어야 액세스 토큰 수명(15분) 안에 끝난다.
 *
 * 크론이 아니다: 사본은 프로세스마다 있어야 하므로 모든 인스턴스가 각자 돈다.
 */
@Injectable()
export class TenantStatusCache implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TenantStatusCache.name);
  private current: ReadonlyMap<string, TenantStatus> | null = null;
  private consecutiveFailures = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly source: TenantStatusSource,
    @Inject(TENANT_STATUS_OPTIONS) private readonly options: TenantStatusOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.source.isConfigured()) {
      this.logger.warn('tenant status source is not configured — suspended tenants are not refused by core');
      return;
    }
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 한 번 맞춰 본다. 이미 도는 중이면 그 결과를 같이 기다린다. */
  refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * 이 테넌트의 사람 토큰을 거절할 이유. 활성이거나 사본이 없으면 null.
   * user-service 가 모르는 테넌트도 막지 않는다 — 그 테넌트로는 토큰이 발급되지 않고, 막으면 빈 응답 한 번이
   * 테넌트 1 까지 core 전체를 멈춘다. 스위치는 «정지·준비라고 적힌 행»만 본다.
   */
  refusal(tenant: string): TenantRefusal | null {
    const status = this.current?.get(tenant);
    return status === undefined || status === 'active' ? null : status;
  }

  private async tick(): Promise<void> {
    await this.refresh();
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.nextDelay());
    this.timer.unref();
  }

  private nextDelay(): number {
    if (this.current) return this.options.refreshIntervalMs;
    const backoff = this.options.retryBaseMs * 2 ** Math.max(this.consecutiveFailures - 1, 0);
    return Math.min(backoff, this.options.refreshIntervalMs);
  }

  private async load(): Promise<void> {
    try {
      const next = await this.source.fetch();
      this.logChanges(next);
      this.current = next;
      lastLoaded.setToCurrentTime();
      if (this.consecutiveFailures > 0) {
        this.logger.log(`tenant statuses reachable again after ${this.consecutiveFailures} failed checks`);
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures === 1) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`tenant status check failed — keeping the last copy: ${reason}`);
      }
    }
  }

  /** 정지·복귀가 core 에 닿은 순간을 로그로 남긴다 — 런북이 «반영됐나»를 이 줄로 본다. */
  private logChanges(next: ReadonlyMap<string, TenantStatus>): void {
    for (const [tenant, status] of next) {
      const before = this.current?.get(tenant);
      if (before !== status && (before !== undefined || status !== 'active')) {
        this.logger.log(`tenant ${tenant} status ${before ?? '(none)'} → ${status}`);
      }
    }
  }
}
