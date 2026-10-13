'use client';

import type { Permission } from '@permission-catalog';
import { useCan } from '@/hooks/use-permission';

/** 권한이 확인됐을 때만 보인다. 확인 중·확인 실패엔 `fallback`(기본 없음) — 거부 문구를 띄우지 않는다. */
export function Can({ anyOf, fallback = null, children }: { anyOf: readonly Permission[]; fallback?: React.ReactNode; children: React.ReactNode }) {
  const can = useCan(anyOf);
  return <>{can.status === 'ready' && can.allowed ? children : fallback}</>;
}
