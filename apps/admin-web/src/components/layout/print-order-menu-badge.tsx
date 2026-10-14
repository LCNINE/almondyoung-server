'use client';

import { Badge } from '@/components/ui/badge';
import { usePrintOrderSummary } from '@/lib/services/orders/print-orders.queries';

export function PrintOrderMenuBadge() {
  const { data, isLoading } = usePrintOrderSummary();
  if (isLoading || !data) return null;

  const count =
    data.cancelRefused + data.testPending + data.failed + data.unsupported;
  if (count === 0) return null;

  return (
    <Badge
      variant={data.cancelRefused > 0 ? 'destructive' : 'secondary'}
      className="ml-auto text-xs group-data-[collapsible=icon]:hidden"
      aria-label={`와우프레스 발주 처리 필요 ${count}건`}
    >
      {count}
    </Badge>
  );
}
