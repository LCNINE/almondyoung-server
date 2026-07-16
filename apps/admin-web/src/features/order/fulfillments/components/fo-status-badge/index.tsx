'use client';

import { Badge } from '@/components/ui/badge';
import type { FulfillmentOrderStatus } from '@/lib/types/dto/fulfillment';

const LABELS: Record<FulfillmentOrderStatus, string> = {
  created: '생성됨',
  partially_reserved: '부분 예약',
  ready: '준비 완료',
  processing: '처리 중',
  partially_shipped: '부분 출고',
  shipped: '출고 완료',
  completed: '배송 완료',
  canceled: '취소',
  recovery_required: '복구 필요',
};

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

const VARIANTS: Record<FulfillmentOrderStatus, Variant> = {
  created: 'secondary',
  partially_reserved: 'secondary',
  ready: 'default',
  processing: 'default',
  partially_shipped: 'default',
  shipped: 'default',
  completed: 'outline',
  canceled: 'destructive',
  recovery_required: 'destructive',
};

export function FoStatusBadge({ status }: { status: FulfillmentOrderStatus }) {
  return (
    <Badge variant={VARIANTS[status] ?? 'secondary'}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
