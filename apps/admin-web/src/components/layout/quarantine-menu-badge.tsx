'use client';

// src/components/layout/quarantine-menu-badge.tsx
// 사이드바 "채널 노출 관리" 메뉴 항목 옆에 격리 큐 건수를 보여준다. `menu.ts` 의
// `hasQuarantineBadge` 플래그가 붙은 항목에서만 마운트된다 — 모든 메뉴 항목마다 훅을
// 호출하지 않기 위함이다. count 가 0 이거나 로딩 중이면 아무것도 그리지 않는다: 격리가
// 없을 때도 배지가 보이면 운영자가 오해한다.

import { Badge } from '@/components/ui/badge';
import { useQuarantinedFailures } from '@/lib/services/channel/queries';

export function QuarantineMenuBadge() {
  const { data, isLoading } = useQuarantinedFailures();
  const count = data?.count ?? 0;

  if (isLoading || count === 0) return null;

  return (
    <Badge
      variant="destructive"
      className="ml-auto text-xs group-data-[collapsible=icon]:hidden"
      aria-label={`격리 ${count}건`}
    >
      {count}
    </Badge>
  );
}
