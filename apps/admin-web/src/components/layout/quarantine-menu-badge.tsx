'use client';

// src/components/layout/quarantine-menu-badge.tsx
// 사이드바 "채널 노출 관리" 메뉴 항목 옆에 격리 큐 건수를 보여준다. `menu.ts` 의
// `hasQuarantineBadge` 플래그가 붙은 항목에서만 마운트된다 — 모든 메뉴 항목마다 훅을
// 호출하지 않기 위함이다. count 가 0 이거나 로딩 중이면 아무것도 그리지 않는다: 격리가
// 없을 때도 배지가 보이면 운영자가 오해한다.

import { Badge } from '@/components/ui/badge';
import { useQuarantinedFailures } from '@/lib/services/channel/queries';
import { formatQuarantineCount } from '@/lib/api/domains/channel/order-collection-failures.client';

export function QuarantineMenuBadge() {
  const { data, isLoading } = useQuarantinedFailures();
  const count = data?.count ?? 0;
  // 한 판의 상한에 닿았으면 "200" 이 아니라 "200+" 로 적는다 — 배지가 상한을 실제 건수처럼
  // 보여주면 운영자가 큐를 다 봤다고 오해한다.
  const label = data ? formatQuarantineCount(data) : String(count);

  if (isLoading || count === 0) return null;

  return (
    <Badge
      variant="destructive"
      className="ml-auto text-xs group-data-[collapsible=icon]:hidden"
      aria-label={`격리 ${label}건`}
    >
      {label}
    </Badge>
  );
}
