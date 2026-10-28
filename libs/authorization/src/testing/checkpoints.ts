import { Provider } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { register } from 'prom-client';
import { PermissionGuard } from '../guards/permission.guard';
import { PermissionCache } from '../services/permission-cache';
import { PermissionCheckpoints } from '../services/permission-checkpoints';
import { PermissionDecider } from '../services/permission-decider';
import { PermissionRuntimeOptions } from '../services/permission-runtime.options';
import { RouteRequirementResolver } from '../services/route-requirement.resolver';
import { FIRST_GRANT_ROLE_PERMISSIONS } from './first-grant-roles';

/**
 * 판정 지점을 가진 클래스를 스펙에서 만들 때 쓴다. 라이브와 같이 항상 새 판정을 돌려준다.
 * 기본 사본은 카탈로그의 첫 등록 부여(+ master 전체)이고, 테스트가 말하려는 권한 구성이 따로 있으면 역할별 권한을 넘긴다.
 * `null` 은 사본을 한 번도 받지 못한 상태(cold) — 판정 불가라 거부된다.
 */
export function createCheckpointsForTesting(
  byRole: Readonly<Record<string, readonly string[]>> | null = FIRST_GRANT_ROLE_PERMISSIONS,
): PermissionCheckpoints {
  const cache = cacheFor(byRole);
  return new PermissionCheckpoints(new PermissionDecider(cache), cache, runtimeOptions());
}

/**
 * HTTP 하네스(`Test.createTestingModule`)의 providers 에 펼쳐 라이브와 같은 인가를 만든다.
 * 진짜 `PermissionGuard` 가 전역 가드로 판정하고 낙인을 남긴다. 판정 지점도 같은 사본을 쓴다.
 * 역할별 권한은 읽을 때마다 다시 보므로 getter 로 두면 테스트 도중 권한을 거둘 수 있다.
 */
export function enforcedPermissionProvidersForTesting(
  byRole: Readonly<Record<string, readonly string[]>> = FIRST_GRANT_ROLE_PERMISSIONS,
): Provider[] {
  const resolver = new RouteRequirementResolver(new Reflector());
  return [
    { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting(byRole) },
    { provide: APP_GUARD, useValue: new PermissionGuard(resolver, new PermissionDecider(cacheFor(byRole))) },
  ];
}

function cacheFor(
  byRole: Readonly<Record<string, readonly string[]>> | null,
): Pick<PermissionCache, 'permissionsFor' | 'status'> {
  return {
    permissionsFor: (roles) =>
      byRole === null ? null : new Set(roles.flatMap((role) => (Object.hasOwn(byRole, role) ? byRole[role] : []))),
    status: () => ({
      state: byRole ? 'ready' : 'cold',
      version: byRole ? 'test' : null,
      ageMs: null,
      consecutiveFailures: 0,
    }),
  };
}

function runtimeOptions(): PermissionRuntimeOptions {
  return { service: 'core', refreshIntervalMs: 30_000, retryBaseMs: 1_000, summaryIntervalMs: 300_000 };
}

/** 판정 지점 비교 횟수(스펙 단언용). 스펙마다 `register.resetMetrics()` 를 먼저 부른다. */
export async function checkpointEvaluations(checkpoint: string, outcome: string): Promise<number> {
  const metric = await register.getSingleMetric('authz_checkpoint_evaluations_total')?.get();
  return metric?.values.find((v) => v.labels.checkpoint === checkpoint && v.labels.outcome === outcome)?.value ?? 0;
}
