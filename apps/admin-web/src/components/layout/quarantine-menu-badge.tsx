'use client';

// src/components/layout/quarantine-menu-badge.tsx
// 사이드바 "채널 노출 관리" 메뉴 항목 옆에 격리 큐 건수를 보여준다. `menu.ts` 의
// `hasQuarantineBadge` 플래그가 붙은 항목에서만 마운트된다 — 모든 메뉴 항목마다 훅을
// 호출하지 않기 위함이다. count 가 0 이거나 로딩 중이면 아무것도 그리지 않는다: 격리가
// 없을 때도 배지가 보이면 운영자가 오해한다.
//
// 정체 보드 0단계와 **같은 요약**을 쓴다(#1016 1번 행). 목록 건수를 세면 자동 재시도 중인 처리 실패까지
// 세어 «보드는 0, 배지는 빨강»으로 갈린다. 요약은 서버가 «사람 몫»만 센 진짜 건수다(목록 상한 200 도 없다).

import { Badge } from '@/components/ui/badge';
import { useQuarantineSummary } from '@/lib/services/channel/queries';

export function QuarantineMenuBadge() {
  const { data, isLoading } = useQuarantineSummary();
  const count = data?.quarantined ?? 0;

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
