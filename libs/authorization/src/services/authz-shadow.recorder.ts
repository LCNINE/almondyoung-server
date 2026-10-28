import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { reportSnapshotStatus, shadowEvaluationsTotal } from './authz-shadow.metrics';
import { PermissionCache } from './permission-cache';
import { PermissionDecider } from './permission-decider';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';
import { rolesOf } from './request-identity';
import type { RouteRequirement } from './route-requirement.resolver';

export type ShadowOutcome = 'match' | 'would_deny' | 'would_allow' | 'unavailable';

interface ObservedRequest {
  readonly route: string;
  readonly requirement: RouteRequirement;
  passed: boolean;
}

interface WindowEntry {
  readonly route: string;
  readonly roles: readonly string[];
  readonly outcome: ShadowOutcome;
  count: number;
}

/** 창 하나에서 기억할 불일치 종류 상한. 넘치면 건수만 센다. */
const MAX_WINDOW_KEYS = 200;

const emptyTotals = () => ({ evaluated: 0, match: 0, wouldDeny: 0, wouldAllow: 0, unavailable: 0, overflow: 0 });

/**
 * 그림자 판정: 기존 가드의 결과와 새 권한 판정을 응답이 끝난 뒤 비교해 기록한다.
 *
 * 결과를 바꾸지 않는다. 요청 경로에서 하는 일은 상태 한 칸과 `finish` 리스너 하나다.
 * 상태는 요청 객체를 키로 한 WeakMap 이라 응답이 끊겨 `finish` 가 오지 않아도 남지 않는다.
 * 기존 결과는 «인터셉터에 도달 = 허용», «도달 못 하고 401·403 = 거부»로만 읽고 나머지 상태는 세지 않는다.
 */
@Injectable()
export class AuthzShadowRecorder implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthzShadowRecorder.name);
  private readonly observed = new WeakMap<object, ObservedRequest>();
  private window = new Map<string, WindowEntry>();
  private totals = emptyTotals();
  private windowStartedAt = Date.now();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(PermissionDecider) private readonly decider: Pick<PermissionDecider, 'decide'>,
    @Inject(PermissionCache) private readonly cache: Pick<PermissionCache, 'status'>,
    @Inject(PERMISSION_RUNTIME_OPTIONS) private readonly options: PermissionRuntimeOptions,
  ) {}

  onModuleInit(): void {
    reportSnapshotStatus(this.options.service, () => this.cache.status());
    this.timer = setInterval(() => this.flush(), this.options.summaryIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  observe(request: object, response: ServerResponse, route: string, requirement: RouteRequirement): void {
    if (this.observed.has(request)) return;
    const state: ObservedRequest = { route, requirement, passed: false };
    this.observed.set(request, state);
    response.once('finish', () => this.settle(request, state, response.statusCode));
  }

  markPassed(request: object): void {
    const state = this.observed.get(request);
    if (state) state.passed = true;
  }

  /** 창을 닫고 요약 1줄을 남긴다. 트래픽이 없던 창은 조용히 넘긴다. */
  flush(now = Date.now()): void {
    if (this.totals.evaluated > 0) {
      const status = this.cache.status(now);
      this.logger.log(
        JSON.stringify({
          event: 'authz_shadow_summary',
          service: this.options.service,
          mode: this.mode(),
          windowSeconds: Math.round((now - this.windowStartedAt) / 1_000),
          ...this.totals,
          snapshotVersion: status.version,
          snapshotAgeSeconds: status.ageMs === null ? null : Math.round(status.ageMs / 1_000),
          mismatches: [...this.window.values()],
        }),
      );
    }
    this.window = new Map();
    this.totals = emptyTotals();
    this.windowStartedAt = now;
  }

  /** 권한 라우트의 «옛 결과»는 새 판정이 정한 결과다 — 로그를 읽는 쪽이 옛 그림자 기간과 구분하게 남긴다. */
  private mode(): 'enforce' {
    return 'enforce';
  }

  private settle(request: object, state: ObservedRequest, statusCode: number): void {
    const legacy = state.passed ? 'allow' : statusCode === 401 || statusCode === 403 ? 'deny' : null;
    if (legacy === null) return;

    const roles = rolesOf(request);
    const verdict = this.decider.decide(state.requirement, roles);
    const outcome: ShadowOutcome =
      !verdict.allowed && verdict.reason === 'unavailable'
        ? 'unavailable'
        : verdict.allowed === (legacy === 'allow')
          ? 'match'
          : legacy === 'allow'
            ? 'would_deny'
            : 'would_allow';

    shadowEvaluationsTotal.inc({ service: this.options.service, outcome });
    this.totals.evaluated += 1;
    if (outcome === 'match') this.totals.match += 1;
    else if (outcome === 'would_deny') this.totals.wouldDeny += 1;
    else if (outcome === 'would_allow') this.totals.wouldAllow += 1;
    else this.totals.unavailable += 1;
    if (outcome !== 'would_deny' && outcome !== 'would_allow') return;

    const sortedRoles = [...new Set(roles ?? [])].sort();
    const key = `${state.route}\n${sortedRoles.join(',')}\n${outcome}`;
    const seen = this.window.get(key);
    if (seen) {
      seen.count += 1;
      return;
    }
    if (this.window.size >= MAX_WINDOW_KEYS) {
      this.totals.overflow += 1;
      return;
    }
    this.window.set(key, { route: state.route, roles: sortedRoles, outcome, count: 1 });
    this.logger.warn(
      JSON.stringify({
        event: 'authz_shadow_mismatch',
        service: this.options.service,
        mode: this.mode(),
        route: state.route,
        roles: sortedRoles,
        legacy,
        next: verdict.allowed ? 'allow' : 'deny',
        reason: verdict.allowed ? null : verdict.reason,
        required: state.requirement.kind === 'permission' ? state.requirement.anyOf : [],
      }),
    );
  }
}
