// src/app/(admin)/order/channel-mismatches/page.tsx
// 메뉴에 없다 — 정체 보드 0단계에서만 들어온다(#1016 45번 스펙 §8.2)

import RouteGuard from '@/components/layout/route-guard';
import ChannelMismatchesTemplate from '@/features/order/channel-mismatches/template';

export default function ChannelMismatchesPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <ChannelMismatchesTemplate />
    </RouteGuard>
  );
}
