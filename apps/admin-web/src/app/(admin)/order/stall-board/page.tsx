// src/app/(admin)/order/stall-board/page.tsx

import RouteGuard from '@/components/layout/route-guard';
import StallBoardTemplate from '@/features/order/stall-board/template';

export default function StallBoardPage() {
  return (
    <RouteGuard screen="/order/stall-board">
      <StallBoardTemplate />
    </RouteGuard>
  );
}
