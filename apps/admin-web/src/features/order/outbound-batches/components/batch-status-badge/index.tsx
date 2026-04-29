'use client';

import { Badge } from '@/components/ui/badge';
import type { OutboundBatchStatus } from '@/lib/types/dto/fulfillment';

const STATUS_MAP: Record<OutboundBatchStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  created: { label: '생성됨', variant: 'secondary' },
  picking: { label: '피킹 중', variant: 'default' },
  completed: { label: '완료', variant: 'outline' },
  canceled: { label: '취소됨', variant: 'destructive' },
};

export function BatchStatusBadge({ status }: { status: OutboundBatchStatus }) {
  const { label, variant } = STATUS_MAP[status] ?? { label: status, variant: 'secondary' };
  return <Badge variant={variant}>{label}</Badge>;
}
