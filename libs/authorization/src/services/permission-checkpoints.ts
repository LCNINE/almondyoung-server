import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Permission } from '../permissions/permission-catalog';
import { checkpointEvaluationsTotal } from './authz-checkpoint.metrics';
import { PermissionCache } from './permission-cache';
import { getPermissionDecision } from './permission-decision';
import { PermissionDecider, Verdict } from './permission-decider';
import { PERMISSION_RUNTIME_OPTIONS, PermissionRuntimeOptions } from './permission-runtime.options';
import { AuthzSubject, isSystemPrincipal } from './system-principal';

export type CheckpointName = `${string}.${string}`;
export type CheckpointOutcome = 'match' | 'unavailable';

const ALLOW: Verdict = { allowed: true };
/** 요약 로그의 모양은 관측 도구가 파싱하므로 wouldDeny·wouldAllow·overflow 는 0 으로, mismatches 는 빈 배열로 남긴다. */
const emptyTotals = () => ({ evaluated: 0, match: 0, wouldDeny: 0, wouldAllow: 0, unavailable: 0, overflow: 0 });

/**
 * 핸들러 «안»의 판정을 권한으로 정한다. 주체의 권한(`check`) 또는 라우트가 남긴 판정 낙인(`checkRoute`)만 보고,
 * 판정 불가(사본 없음)는 거부한다. 요청 경로에서 하는 일은 메모리 조회뿐이다.
 */
@Injectable()
export class PermissionCheckpoints implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionCheckpoints.name);
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

  /** 주체의 권한만으로 정한다. 시스템 주체는 사본 없이도 허용한다. */
  check(point: CheckpointName, subject: AuthzSubject | undefined, anyOf: readonly Permission[]): boolean {
    const verdict: Verdict = isSystemPrincipal(subject)
      ? ALLOW
      : this.decider.decide({ kind: 'permission', anyOf }, subject?.roles);
    this.tally(point, verdict);
    return verdict.allowed;
  }

  /** 라우트가 이 요청에 남긴 권한 판정 낙인만으로 정한다. 사본이 준비되지 않았으면 거부한다. */
  checkRoute(point: CheckpointName, request: unknown, anyOf: readonly Permission[]): boolean {
    const verdict: Verdict =
      this.cache.status().state !== 'ready'
        ? { allowed: false, reason: 'unavailable' }
        : anyOf.some((permission) => getPermissionDecision(request, permission) !== undefined)
          ? ALLOW
          : { allowed: false, reason: 'missing_permission' };
    this.tally(point, verdict);
    return verdict.allowed;
  }

  flush(now = Date.now()): void {
    if (this.totals.evaluated > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'authz_checkpoint_summary',
          service: this.options.service,
          mode: 'enforce',
          windowSeconds: Math.round((now - this.windowStartedAt) / 1_000),
          ...this.totals,
          mismatches: [],
        }),
      );
    }
    this.totals = emptyTotals();
    this.windowStartedAt = now;
  }

  /** 판정 불가가 아니면 모두 `match` 로 센다(지표·요약 모양 유지). */
  private tally(point: CheckpointName, verdict: Verdict): void {
    this.count(point, !verdict.allowed && verdict.reason === 'unavailable' ? 'unavailable' : 'match');
  }

  private count(point: CheckpointName, outcome: CheckpointOutcome): void {
    checkpointEvaluationsTotal.inc({ service: this.options.service, checkpoint: point, outcome });
    this.totals.evaluated += 1;
    if (outcome === 'match') this.totals.match += 1;
    else this.totals.unavailable += 1;
  }
}
