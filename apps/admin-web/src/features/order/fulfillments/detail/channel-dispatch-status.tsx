'use client';

import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { ChannelDispatchViewModel } from './channel-dispatch-model';

const statusVariant = (
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (
    status === 'manual_adjustment_required' ||
    status === 'recovery_required'
  ) {
    return 'destructive';
  }
  if (status === 'pending') return 'secondary';
  return 'outline';
};

const shortId = (value: string) => `${value.slice(0, 8)}…`;

export function ChannelDispatchAlerts({
  viewModel,
}: {
  viewModel: ChannelDispatchViewModel;
}) {
  return (
    <>
      {viewModel.manualOperations.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>채널 수동 조정 필요</AlertTitle>
          <AlertDescription>
            {viewModel.manualOperations.length}건의 채널 작업을 자동 반영할 수
            없습니다. 채널 관리자에서 수량과 배송 상태를 직접 확인하세요.
          </AlertDescription>
        </Alert>
      )}
      {viewModel.hasUnavailable && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>채널 반영 상태 확인 불가</AlertTitle>
          <AlertDescription>
            일부 주문의 채널 상태를 조회하지 못했습니다. 조회 실패는 채널 반영
            성공을 의미하지 않습니다.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export function ChannelDispatchAttemptStatus({
  attemptId,
  viewModel,
}: {
  attemptId: string;
  viewModel: ChannelDispatchViewModel;
}) {
  const attempt = viewModel.attempts.find(
    (candidate) => candidate.dispatchAttemptId === attemptId
  );
  if (!attempt) {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        source 주문이 없어 채널 반영 조회 대상이 없습니다.
      </p>
    );
  }

  return (
    <div className="mb-3 space-y-2 rounded-md bg-muted/40 p-2">
      <p className="text-xs font-medium">주문별 채널 반영 상태</p>
      {attempt.orders.map((order) => (
        <div key={order.salesOrderId} className="space-y-1 text-xs">
          <p className="font-mono text-muted-foreground">
            order {shortId(order.salesOrderId)}
          </p>
          {order.availability === 'loading' ? (
            <p className="flex items-center gap-1 text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" /> 조회 중
            </p>
          ) : order.availability === 'error' ? (
            <Badge variant="destructive">unavailable</Badge>
          ) : order.operations.length === 0 ? (
            <Badge variant="outline">관찰된 채널 작업 없음</Badge>
          ) : (
            <div className="flex flex-wrap gap-1">
              {order.operations.map((operation) => (
                <Badge
                  key={`${operation.operation}:${operation.channel}:${operation.externalOrderId}`}
                  variant={statusVariant(operation.status)}
                >
                  {operation.channel} · {operation.operation} ·{' '}
                  {operation.status}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
