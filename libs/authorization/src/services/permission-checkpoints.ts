import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '../permissions/permission-catalog';
import { AuthzDecisionLog } from './authz-decision.log';
import { PermissionCache } from './permission-cache';
import { getPermissionDecision } from './permission-decision';
import { PermissionDecider, Verdict } from './permission-decider';
import { AuthzSubject, isSystemPrincipal } from './system-principal';

export type CheckpointName = `${string}.${string}`;

const ALLOW: Verdict = { allowed: true };

/**
 * 핸들러 «안»의 판정을 권한으로 정한다. 주체의 권한(`check`) 또는 라우트가 남긴 판정 낙인(`checkRoute`)만 보고,
 * 판정 불가(사본 없음)는 거부한다. 요청 경로에서 하는 일은 메모리 조회뿐이고, 판정은 판정 기록에 남긴다.
 */
@Injectable()
export class PermissionCheckpoints {
  constructor(
    @Inject(PermissionDecider) private readonly decider: Pick<PermissionDecider, 'decide'>,
    @Inject(PermissionCache) private readonly cache: Pick<PermissionCache, 'status'>,
    @Inject(AuthzDecisionLog) private readonly log: Pick<AuthzDecisionLog, 'record'>,
  ) {}

  /** 주체의 권한만으로 정한다. 시스템 주체는 사본 없이도 허용한다. */
  check(point: CheckpointName, subject: AuthzSubject | undefined, anyOf: readonly Permission[]): boolean {
    const system = isSystemPrincipal(subject);
    const verdict: Verdict = system ? ALLOW : this.decider.decide({ kind: 'permission', anyOf }, subject?.roles);
    this.log.record('checkpoint', point, verdict, anyOf, system ? [`system:${subject.name}`] : subject?.roles);
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
    this.log.record('checkpoint', point, verdict, anyOf, undefined);
    return verdict.allowed;
  }
}
