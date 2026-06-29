'use client';

import { Badge } from '@/components/ui/badge';

const intentStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  CREATED: { label: '생성', variant: 'outline' },
  PROCESSING: { label: '처리중', variant: 'secondary' },
  REQUIRES_ACTION: { label: '액션필요', variant: 'secondary' },
  AWAITING_DEPOSIT: { label: '입금대기중', variant: 'secondary' },
  AUTHORIZED: { label: '승인', variant: 'default' },
  SUCCEEDED: { label: '성공', variant: 'default' },
  CAPTURED: { label: '매입', variant: 'default' },
  REFUND_PENDING: { label: '환불 처리중', variant: 'secondary' },
  REFUND_FAILED: { label: '환불 실패', variant: 'destructive' },
  PARTIALLY_REFUNDED: { label: '부분 환불', variant: 'secondary' },
  REFUNDED: { label: '환불 완료', variant: 'default' },
  CANCELED: { label: '취소', variant: 'destructive' },
  FAILED: { label: '실패', variant: 'destructive' },
  EXPIRED: { label: '만료', variant: 'destructive' },
};

const chargeStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  CREATED: { label: '생성', variant: 'outline' },
  SUCCEEDED: { label: '성공', variant: 'default' },
  FAILED: { label: '실패', variant: 'destructive' },
  CANCELED: { label: '취소', variant: 'destructive' },
};

const refundStatusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PENDING: { label: '대기', variant: 'secondary' },
  SUCCEEDED: { label: '완료', variant: 'default' },
  FAILED: { label: '실패', variant: 'destructive' },
};

type StatusType = 'intent' | 'charge' | 'refund';

const configMap: Record<StatusType, Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }>> = {
  intent: intentStatusConfig,
  charge: chargeStatusConfig,
  refund: refundStatusConfig,
};

export function StatusBadgeCell({ value, type = 'intent' }: { value: string | null | undefined; type?: StatusType }) {
  if (!value) return <span className="text-muted-foreground">-</span>;
  const config = configMap[type]?.[value];
  return <Badge variant={config?.variant ?? 'outline'}>{config?.label ?? value}</Badge>;
}
