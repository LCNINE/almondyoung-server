import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Permission } from '../permissions/permission-catalog';
import { checkpointEvaluationsTotal } from './authz-checkpoint.metrics';
import { PermissionCache } from './permission-cache';
import { getPermissionDecision } from './permission-decision';
import { PermissionDecider, Verdict } from './permission-decider';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';
import { AuthzSubject, isSystemPrincipal } from './system-principal';

export type CheckpointName = `${string}.${string}`;
export type CheckpointOutcome = 'match' | 'would_deny' | 'would_allow' | 'unavailable';

interface WindowEntry {
  readonly checkpoint: CheckpointName;
  readonly subject: string | readonly string[];
  readonly outcome: CheckpointOutcome;
  count: number;
}

/** 창 하나에서 기억할 불일치 종류 상한. 넘치면 건수만 센다. */
const MAX_WINDOW_KEYS = 200;
const ALLOW: Verdict = { allowed: true };
const emptyTotals = () => ({ evaluated: 0, match: 0, wouldDeny: 0, wouldAllow: 0, unavailable: 0, overflow: 0 });

/**
 * 핸들러 «안»의 판정(역할 이름·옛 스코프·옛 판정 낙인)을 권한 판정과 나란히 계산해 비교한다.
 *
 * 결과를 바꾸지 않는다 — `compare`·`compareDecision` 은 언제나 옛 판정을 그대로 돌려준다(대조군/후보 실험).
 * 호출하는 쪽은 옛 판정을 끝까지 계산하고 그 값을 넘긴다 — 옛 판정이 조회 실패로 던지면 여기까지 오지 않고,
 * 그건 인가 판정이 아니므로 비교하지 않는다. 요청 경로에서 하는 일은 메모리 조회뿐이다.
 */
@Injectable()
export class PermissionCheckpoints implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionCheckpoints.name);
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
    this.timer = setInterval(() => this.flush(), this.options.summaryIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 주체의 권한으로 새 판정을 계산해 옛 판정과 비교한다. 옛 판정을 그대로 반환한다. */
  compare(
    point: CheckpointName,
    legacy: boolean,
    subject: AuthzSubject | undefined,
    anyOf: readonly Permission[],
  ): boolean {
    const verdict: Verdict = isSystemPrincipal(subject)
      ? ALLOW
      : this.decider.decide({ kind: 'permission', anyOf }, subject?.roles);
    this.record(point, legacy, verdict, this.subjectLabel(subject), anyOf);
    return legacy;
  }

  /** 라우트가 이 요청에 남긴 권한 판정 낙인으로 새 판정을 계산해 비교한다. 옛 판정을 그대로 반환한다. */
  compareDecision(point: CheckpointName, legacy: boolean, request: unknown, anyOf: readonly Permission[]): boolean {
    const verdict: Verdict =
      this.cache.status().state !== 'ready'
        ? { allowed: false, reason: 'unavailable' }
        : anyOf.some((permission) => getPermissionDecision(request, permission) !== undefined)
          ? ALLOW
          : { allowed: false, reason: 'missing_permission' };
    this.record(point, legacy, verdict, 'route-decision', anyOf);
    return legacy;
  }

  flush(now = Date.now()): void {
    if (this.totals.evaluated > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'authz_checkpoint_summary',
          service: this.options.service,
          windowSeconds: Math.round((now - this.windowStartedAt) / 1_000),
          ...this.totals,
          mismatches: [...this.window.values()],
        }),
      );
    }
    this.window = new Map();
    this.totals = emptyTotals();
    this.windowStartedAt = now;
  }

  private subjectLabel(subject: AuthzSubject | undefined): string | readonly string[] {
    if (subject === undefined) return 'anonymous';
    if (isSystemPrincipal(subject)) return `system:${subject.name}`;
    return [...new Set(subject.roles)].sort();
  }

  private record(
    point: CheckpointName,
    legacy: boolean,
    verdict: Verdict,
    subject: string | readonly string[],
    anyOf: readonly Permission[],
  ): void {
    const outcome: CheckpointOutcome =
      !verdict.allowed && verdict.reason === 'unavailable'
        ? 'unavailable'
        : verdict.allowed === legacy
          ? 'match'
          : legacy
            ? 'would_deny'
            : 'would_allow';

    checkpointEvaluationsTotal.inc({ service: this.options.service, checkpoint: point, outcome });
    this.totals.evaluated += 1;
    if (outcome === 'match') this.totals.match += 1;
    else if (outcome === 'would_deny') this.totals.wouldDeny += 1;
    else if (outcome === 'would_allow') this.totals.wouldAllow += 1;
    else this.totals.unavailable += 1;
    if (outcome !== 'would_deny' && outcome !== 'would_allow') return;

    const key = JSON.stringify([point, subject, outcome]);
    const seen = this.window.get(key);
    if (seen) {
      seen.count += 1;
      return;
    }
    if (this.window.size >= MAX_WINDOW_KEYS) {
      this.totals.overflow += 1;
      return;
    }
    this.window.set(key, { checkpoint: point, subject, outcome, count: 1 });
    this.logger.warn(
      JSON.stringify({
        event: 'authz_checkpoint_mismatch',
        service: this.options.service,
        checkpoint: point,
        subject,
        legacy: legacy ? 'allow' : 'deny',
        next: verdict.allowed ? 'allow' : 'deny',
        reason: verdict.allowed ? null : verdict.reason,
        required: anyOf,
      }),
    );
  }
}
