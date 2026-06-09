'use client';

import { Badge } from '@/components/ui/badge';
import type { FulfillmentOrderStatus } from '@/lib/types/dto/fulfillment';

const LABELS: Record<FulfillmentOrderStatus, string> = {
  created: '생성됨',
  reserving: '예약 중',
  ready: '준비 완료',
  unfulfillable: '이행 불가',
  pending: '대기',
  allocated: '할당됨',
  picking: '피킹 중',
  picked: '피킹 완료',
  inspecting: '검수 중',
  labeled: '라벨 완료',
  invoiced: '송장 발행',
  forwarded: '발송됨',
  shipped: '출고 완료',
  completed: '배송 완료',
  canceled: '취소',
};

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

const VARIANTS: Record<FulfillmentOrderStatus, Variant> = {
  created: 'secondary',
  reserving: 'secondary',
  ready: 'default',
  unfulfillable: 'destructive',
  pending: 'secondary',
  allocated: 'default',
  picking: 'default',
  picked: 'default',
  inspecting: 'default',
  labeled: 'default',
  invoiced: 'default',
  forwarded: 'default',
  shipped: 'default',
  completed: 'outline',
  canceled: 'destructive',
};

export function FoStatusBadge({ status }: { status: FulfillmentOrderStatus }) {
  return (
    <Badge variant={VARIANTS[status] ?? 'secondary'}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
