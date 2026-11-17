'use client';

import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { siteLabel } from '@/lib/api/domains/sales-channel/vocabulary';
import type { ChannelDispatchViewModel } from './channel-dispatch-model';
import {
  channelOperationLabel,
  channelProjectionStatusLabel,
} from './fulfillment-labels';

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
          <AlertTitle>쇼핑몰에 직접 반영해야 해요</AlertTitle>
          <AlertDescription>
            {viewModel.manualOperations.length}건을 쇼핑몰에 자동으로 반영하지
            못했어요. 쇼핑몰 판매자 센터에서 수량과 배송 상태를 직접 맞춰
            주세요.
          </AlertDescription>
        </Alert>
      )}
      {viewModel.hasUnavailable && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>쇼핑몰 반영 상태를 확인하지 못했어요</AlertTitle>
          <AlertDescription>
            일부 주문의 쇼핑몰 반영 상태를 불러오지 못했어요. 반영됐다는 뜻은
            아니니 잠시 뒤 새로고침해 주세요.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export function ChannelDispatchAttemptStatus({
  attemptId,
  orderNoOf,
  viewModel,
}: {
  attemptId: string;
  /** 판매주문의 고객 주문번호. 모르면 null */
  orderNoOf: (salesOrderId: string) => string | null;
  viewModel: ChannelDispatchViewModel;
}) {
  const attempt = viewModel.attempts.find(
    (candidate) => candidate.dispatchAttemptId === attemptId
  );
  if (!attempt) {
    return (
      <p className="mb-3 text-xs text-muted-foreground">
        이 출고에 연결된 쇼핑몰 주문이 없어요.
      </p>
    );
  }

  return (
    <div className="mb-3 space-y-2 rounded-md bg-muted/40 p-2">
      <p className="text-xs font-medium">쇼핑몰 반영</p>
      {attempt.orders.map((order) => (
        <div key={order.salesOrderId} className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            {orderNoOf(order.salesOrderId)
              ? `#${orderNoOf(order.salesOrderId)}`
              : '주문'}
          </p>
          {order.availability === 'loading' ? (
            <p className="flex items-center gap-1 text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" /> 조회 중
            </p>
          ) : order.availability === 'error' ? (
            <Badge variant="destructive">확인하지 못했어요</Badge>
          ) : order.operations.length === 0 ? (
            <Badge variant="outline">아직 반영할 내용이 없어요</Badge>
          ) : (
            <div className="flex flex-wrap gap-1">
              {order.operations.map((operation) => (
                <Badge
                  key={`${operation.operation}:${operation.channel}:${operation.externalOrderId}`}
                  variant={statusVariant(operation.status)}
                >
                  {siteLabel(operation.channel)} ·{' '}
                  {channelOperationLabel(operation.operation)} ·{' '}
                  {channelProjectionStatusLabel(operation.status)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
