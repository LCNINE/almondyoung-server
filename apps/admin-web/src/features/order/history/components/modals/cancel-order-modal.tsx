'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminCancelSalesOrder } from '@/lib/services/orders';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';
import type { CancelSalesOrderLineDto } from '@/lib/types/dto/orders';

const REASON_CODES = [
  { value: 'CUSTOMER_REQUEST', label: '고객 요청' },
  { value: 'OUT_OF_STOCK', label: '재고 부족' },
  { value: 'ADMIN_REQUEST', label: '관리자 처리' },
  { value: 'CHANNEL_CANCEL', label: '채널 취소' },
  { value: 'PAYMENT_FAILED', label: '결제 실패' },
  { value: 'OTHER', label: '기타' },
];

interface Props {
  order: OrderLineRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CancelResult = {
  scope: 'full' | 'partial';
  refundStatus: string;
  isShipped: boolean;
};

function RefundStatusPanel({ result, onClose }: { result: CancelResult; onClose: () => void }) {
  const isPartial = result.scope === 'partial';
  const isSucceeded = result.refundStatus === 'succeeded';
  const isPending = result.refundStatus === 'pending';

  let color = 'bg-gray-50 border-gray-200 text-gray-700';
  let icon = '✓';
  let title = '';
  let body = '';

  if (isPartial) {
    color = 'bg-amber-50 border-amber-200 text-amber-800';
    icon = '⚠';
    title = result.isShipped ? '부분 취소 접수 완료' : '부분 취소 완료';
    body = result.isShipped
      ? '출고된 상품은 반품/회수 처리가 별도로 필요합니다. 환불은 라인별 금액 확인 후 수동으로 처리하세요.'
      : '환불 금액 계산 후 수동으로 처리해야 합니다. 결제 > 환불 관리에서 확인하세요.';
  } else if (isSucceeded) {
    color = 'bg-green-50 border-green-200 text-green-800';
    icon = '✓';
    title = '주문 취소 및 환불 완료';
    body = '카드 환불이 정상 처리되었습니다.';
  } else if (isPending) {
    color = 'bg-blue-50 border-blue-200 text-blue-800';
    icon = '⟳';
    title = '주문 취소 완료 · 환불 처리 중';
    body = '환불이 진행 중입니다. 결제 > 환불 관리에서 상태를 확인하세요.';
  } else {
    color = 'bg-orange-50 border-orange-200 text-orange-800';
    icon = '!';
    title = '주문 취소 완료 · 환불 수동 처리 필요';
    body = '자동 환불에 실패하거나 결제 정보가 없습니다. 결제 > 환불 관리에서 수동으로 처리하세요.';
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>취소 처리 결과</DialogTitle>
      </DialogHeader>
      <div className={`rounded border px-4 py-3 ${color}`}>
        <div className="flex items-center gap-2 font-medium text-sm mb-1">
          <span>{icon}</span>
          <span>{title}</span>
        </div>
        <p className="text-xs leading-relaxed">{body}</p>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>확인</Button>
      </DialogFooter>
    </>
  );
}

export function CancelOrderModal({ order, open, onOpenChange }: Props) {
  const cancelMutation = useAdminCancelSalesOrder();

  const isShipped = order?.orderStatus === 'shipped' || order?.orderStatus === 'delivered';
  const isProcessing = order?.orderStatus === 'processing';
  const [scope, setScope] = useState<'full' | 'partial'>('full');
  const [lineQuantities, setLineQuantities] = useState<Record<string, number>>({});
  const [reasonCode, setReasonCode] = useState('CUSTOMER_REQUEST');
  const [reasonDetail, setReasonDetail] = useState('');
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null);

  useEffect(() => {
    if (open && order) {
      setScope(isShipped ? 'partial' : 'full');
      const initial: Record<string, number> = {};
      order.lines.forEach((l) => { initial[l.id] = l.quantity; });
      setLineQuantities(initial);
      setReasonCode('CUSTOMER_REQUEST');
      setReasonDetail('');
      setCancelResult(null);
    }
  }, [open, order, isShipped]);

  const handleSubmit = async () => {
    if (!order) return;

    let lines: CancelSalesOrderLineDto[] | undefined;
    if (scope === 'partial') {
      lines = order.lines
        .filter((l) => (lineQuantities[l.id] ?? 0) > 0)
        .map((l) => ({ salesOrderLineId: l.id, quantity: lineQuantities[l.id]! }));
      if (lines.length === 0) {
        toast.error('취소할 수량을 1개 이상 입력하세요.');
        return;
      }
    }

    try {
      const result = await cancelMutation.mutateAsync({
        id: order.orderId,
        body: {
          lines,
          reasonCode: reasonCode || undefined,
          reasonDetail: reasonDetail || undefined,
          cancelledBy: 'admin',
        },
      });
      setCancelResult({ scope, refundStatus: result.refundStatus, isShipped });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined;
      toast.error(message ?? '취소 처리 중 오류가 발생했습니다.');
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {cancelResult ? (
          <RefundStatusPanel result={cancelResult} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>주문 취소</DialogTitle>
              <p className="text-xs text-gray-500 mt-1">주문번호: {order.orderNo}</p>
            </DialogHeader>

            <div className="space-y-4">
              {/* 취소 범위 */}
              <div className="space-y-2">
                <Label>취소 범위</Label>
                {isShipped && (
                  <div className="rounded bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    출고/배송 완료 주문은 전체 취소를 할 수 없습니다. 부분 취소 후 반품/회수 처리를 진행하세요.
                  </div>
                )}
                {isProcessing && !isShipped && (
                  <div className="rounded bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-800">
                    <strong>WMS 처리 중 주문</strong> — 출고 작업(피킹/패킹)이 진행 중일 수 있습니다.
                    전체 취소 시 WMS 작업이 강제 중단되며, 피킹·패킹된 상품은 원위치 처리가 필요합니다.
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isShipped}
                    className={`flex-1 py-2 rounded border text-sm ${scope === 'full' ? 'bg-red-500 text-white border-red-500' : 'hover:bg-gray-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
                    onClick={() => setScope('full')}
                  >
                    {isProcessing ? '강제 취소' : '전체 취소'}
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-2 rounded border text-sm ${scope === 'partial' ? 'bg-orange-500 text-white border-orange-500' : 'hover:bg-gray-50'}`}
                    onClick={() => setScope('partial')}
                  >
                    부분 취소
                  </button>
                </div>
              </div>

              {/* 부분 취소: 라인별 수량 */}
              {scope === 'partial' && (
                <div className="space-y-2">
                  <Label>취소 수량</Label>
                  <div className="rounded border divide-y max-h-48 overflow-y-auto">
                    {order.lines.map((line) => (
                      <div key={line.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{line.productName}</div>
                          {line.optionName && <div className="text-xs text-gray-500">{line.optionName}</div>}
                          <div className="text-xs text-gray-400">최대 {line.quantity}개</div>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          max={line.quantity}
                          value={lineQuantities[line.id] ?? line.quantity}
                          onChange={(e) =>
                            setLineQuantities((prev) => ({
                              ...prev,
                              [line.id]: Math.min(line.quantity, Math.max(0, Number(e.target.value))),
                            }))
                          }
                          className="w-20 text-center"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-amber-600">부분 취소는 자동 환불이 적용되지 않습니다. 취소 후 수동으로 환불 금액을 계산하여 처리하세요.</p>
                </div>
              )}

              {/* 취소 사유 코드 */}
              <div className="space-y-2">
                <Label>취소 사유</Label>
                <select
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                >
                  {REASON_CODES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* 취소 사유 상세 */}
              <div className="space-y-2">
                <Label>상세 사유 (선택)</Label>
                <Input
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                  placeholder="취소 사유를 구체적으로 입력하세요"
                />
              </div>

              {scope === 'full' && (
                <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {isProcessing
                    ? '강제 취소 시 진행 중인 출고 작업이 중단되고 예약 재고가 해제됩니다.'
                    : '전체 취소 시 출고 전 예약 해제 및 디지털 권리가 회수됩니다.'}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancelMutation.isPending}>
                닫기
              </Button>
              <Button
                variant="destructive"
                onClick={handleSubmit}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? '처리 중...'
                  : scope === 'full'
                    ? (isProcessing ? '강제 취소 실행' : '전체 취소 실행')
                    : '부분 취소 실행'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
