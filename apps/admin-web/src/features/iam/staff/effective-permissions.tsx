'use client';

import {
  findPermission,
  PERMISSION_CATALOG,
  PERMISSION_DOMAINS,
} from '@permission-catalog';
import { useQueries } from '@tanstack/react-query';
import { roleApi } from '@/lib/api/domains/roles';
import { rolesQueryKeys } from '@/lib/services/roles';
import type { Assignment } from '@/lib/types/dto/iam';

const domainTitles: Readonly<Record<string, string>> = PERMISSION_DOMAINS;
// 사람의 판정에 쓰이지 않는 권한(서버 판정도 뺀다)
const SYSTEM_ONLY: ReadonlySet<string> = new Set(
  PERMISSION_CATALOG.filter((p) => p.systemOnly).map((p) => p.key)
);

/** 이 사람이 지금 가진 권한(만료되지 않은 직원 역할의 합집합)과 어느 역할에서 왔는지 — 읽기 전용. */
export function EffectivePermissions({
  assignments,
}: {
  assignments: readonly Assignment[];
}) {
  const active = assignments.filter(
    (r) => r.audience === 'staff' && !r.expired
  );
  const results = useQueries({
    queries: active.map((r) => ({
      queryKey: rolesQueryKeys.detail(r.roleId),
      queryFn: () => roleApi.getRole(r.roleId),
    })),
  });

  if (active.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        지금 가진 직원 역할이 없습니다.
      </p>
    );
  if (results.some((q) => q.isError)) {
    return (
      <p className="text-sm text-destructive">
        일부 역할의 권한을 불러오지 못했습니다.
      </p>
    );
  }
  if (results.some((q) => q.isLoading))
    return <p className="text-sm text-muted-foreground">권한을 불러오는 중…</p>;

  const from = new Map<string, string[]>();
  results.forEach((q, i) => {
    for (const key of q.data?.permissions ?? [])
      if (!SYSTEM_ONLY.has(key))
        from.set(key, [...(from.get(key) ?? []), active[i].displayName]);
  });
  const byDomain = new Map<string, string[]>();
  for (const key of [...from.keys()].sort()) {
    const domain = key.split('.')[0];
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), key]);
  }

  return (
    <section aria-label="실제 권한" className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">실제 권한 ({from.size})</h3>
      <dl className="space-y-2 text-sm">
        {[...byDomain.entries()].map(([domain, keys]) => (
          <div key={domain}>
            <dt className="font-medium">
              {Object.hasOwn(domainTitles, domain)
                ? domainTitles[domain]
                : domain}
            </dt>
            <dd>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {keys.map((key) => (
                  <li key={key}>
                    {findPermission(key)?.label ?? key}
                    {findPermission(key)?.dangerous && (
                      <span className="ml-0.5 text-destructive">*</span>
                    )}
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({from.get(key)?.join(', ')})
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">* 위험 권한</p>
    </section>
  );
}
