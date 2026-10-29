import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Counter, register } from 'prom-client';
import { PermissionCache } from './permission-cache';
import type { DenyReason, Verdict } from './permission-decider';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';

export type DecisionKind = 'route' | 'checkpoint';
type Outcome = 'allow' | 'deny' | 'unavailable';

/**
 * 인가 판정 지표 — 모듈 스코프 싱글턴(인스턴스 필드면 prom-client 전역 register 중복 등록 예외).
 * 라우트는 라벨에 넣지 않는다(로그에 남긴다). checkpoint 라벨은 코드에 고정된 지점 이름이라 값의 수가 코드로 정해진다.
 */
const decisionsTotal = new Counter({
  name: 'authz_decisions_total',
  help: 'Authorization decisions made by the permission guard and in-handler checkpoints, by outcome',
  labelNames: ['service', 'kind', 'checkpoint', 'outcome'],
  registers: [register],
});

/** 창 하나에서 기억할 거부 종류 상한. 넘치면 건수만 센다. */
const MAX_WINDOW_KEYS = 200;
const TOP_DENIED = 10;

interface DeniedEntry {
  readonly kind: DecisionKind;
  readonly name: string;
  readonly reason: DenyReason;
  count: number;
}

const emptyTotals = () => ({ allowed: 0, denied: 0, unavailable: 0, overflow: 0 });

/**
 * 인가 판정 기록 — 권한 가드와 판정 지점이 판정한 그 자리에서 남긴다.
 *
 * 창마다(기본 5분) 서비스의 허용·거부·판정 불가 건수와 거부가 많았던 라우트·지점을 요약 1줄로 남기고, 거부·판정 불가는
 * (종류·이름·사유)마다 창에서 첫 1건만 자세히 남긴다. 사용자 id·URL·쿼리 값은 남기지 않는다.
 */
@Injectable()
export class AuthzDecisionLog implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthzDecisionLog.name);
  private window = new Map<string, DeniedEntry>();
  private totals = emptyTotals();
  private windowStartedAt = Date.now();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(PermissionCache) private readonly cache: Pick<PermissionCache, 'status'>,
    @Inject(PERMISSION_RUNTIME_OPTIONS) private readonly options: PermissionRuntimeOptions,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.flush(), this.options.summaryIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** `roles` 는 상세 로그의 주체 표시다(시스템 주체는 `system:<이름>`). */
  record(
    kind: DecisionKind,
    name: string,
    verdict: Verdict,
    required: readonly string[],
    roles: readonly string[] | undefined,
  ): void {
    const outcome: Outcome = verdict.allowed ? 'allow' : verdict.reason === 'unavailable' ? 'unavailable' : 'deny';
    decisionsTotal.inc({
      service: this.options.service,
      kind,
      checkpoint: kind === 'checkpoint' ? name : '',
      outcome,
    });
    if (verdict.allowed) {
      this.totals.allowed += 1;
      return;
    }
    if (outcome === 'unavailable') this.totals.unavailable += 1;
    else this.totals.denied += 1;

    const key = `${kind}\n${name}\n${verdict.reason}`;
    const seen = this.window.get(key);
    if (seen) {
      seen.count += 1;
      return;
    }
    if (this.window.size >= MAX_WINDOW_KEYS) {
      this.totals.overflow += 1;
      return;
    }
    this.window.set(key, { kind, name, reason: verdict.reason, count: 1 });
    this.logger.warn(
      JSON.stringify({
        event: 'authz_decision_denied',
        service: this.options.service,
        kind,
        name,
        reason: verdict.reason,
        required,
        roles: [...new Set(roles ?? [])].sort(),
      }),
    );
  }

  /** 창을 닫고 요약 1줄을 남긴다. 판정이 없던 창은 조용히 넘긴다. */
  flush(now = Date.now()): void {
    const { allowed, denied, unavailable } = this.totals;
    if (allowed + denied + unavailable > 0) {
      const status = this.cache.status(now);
      this.logger.log(
        JSON.stringify({
          event: 'authz_decision_summary',
          service: this.options.service,
          windowSeconds: Math.round((now - this.windowStartedAt) / 1_000),
          ...this.totals,
          snapshotVersion: status.version,
          snapshotAgeSeconds: status.ageMs === null ? null : Math.round(status.ageMs / 1_000),
          topDenied: [...this.window.values()]
            .filter((entry) => entry.reason !== 'unavailable')
            .sort((a, b) => b.count - a.count)
            .slice(0, TOP_DENIED)
            .map(({ kind, name, reason, count }) => ({ kind, name, reason, count })),
        }),
      );
    }
    this.window = new Map();
    this.totals = emptyTotals();
    this.windowStartedAt = now;
  }
}
