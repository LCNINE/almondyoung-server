import { register } from 'prom-client';
import { PermissionCache } from '../services/permission-cache';
import { PermissionCheckpoints } from '../services/permission-checkpoints';
import { PermissionDecider } from '../services/permission-decider';

/**
 * 판정 지점을 가진 클래스를 스펙에서 만들 때 쓴다. 판정 지점은 옛 판정을 그대로 돌려주므로 사본이 없어도(기본)
 * 그 클래스의 동작은 같다. 비교 결과까지 보려면 역할별 권한을 넘긴다.
 */
export function createCheckpointsForTesting(byRole: Record<string, string[]> | null = null): PermissionCheckpoints {
  const cache: Pick<PermissionCache, 'permissionsFor' | 'status'> = {
    permissionsFor: (roles) => (byRole === null ? null : new Set(roles.flatMap((role) => byRole[role] ?? []))),
    status: () => ({
      state: byRole ? 'ready' : 'cold',
      version: byRole ? 'test' : null,
      ageMs: null,
      consecutiveFailures: 0,
    }),
  };
  return new PermissionCheckpoints(new PermissionDecider(cache), cache, {
    service: 'core',
    enforce: false,
    refreshIntervalMs: 30_000,
    retryBaseMs: 1_000,
    summaryIntervalMs: 300_000,
  });
}

/** 판정 지점 비교 횟수(스펙 단언용). 스펙마다 `register.resetMetrics()` 를 먼저 부른다. */
export async function checkpointEvaluations(checkpoint: string, outcome: string): Promise<number> {
  const metric = await register.getSingleMetric('authz_checkpoint_evaluations_total')?.get();
  return metric?.values.find((v) => v.labels.checkpoint === checkpoint && v.labels.outcome === outcome)?.value ?? 0;
}
