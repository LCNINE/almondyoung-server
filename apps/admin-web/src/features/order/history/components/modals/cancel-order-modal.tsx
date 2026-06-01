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

export function CancelOrderModal({ order, open, onOpenChange }: Props) {
  const cancelMutation = useAdminCancelSalesOrder();

  const isShipped = order?.orderStatus === 'shipped' || order?.orderStatus === 'delivered';
  const [scope, setScope] = useState<'full' | 'partial'>('full');
  const [lineQuantities, setLineQuantities] = useState<Record<string, number>>({});
  const [reasonCode, setReasonCode] = useState('CUSTOMER_REQUEST');
  const [reasonDetail, setReasonDetail] = useState('');

  useEffect(() => {
    if (open && order) {
      setScope(isShipped ? 'partial' : 'full');
      const initial: Record<string, number> = {};
      order.lines.forEach((l) => { initial[l.id] = l.quantity; });
      setLineQuantities(initial);
      setReasonCode('CUSTOMER_REQUEST');
      setReasonDetail('');
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
      let successMsg: string;
      if (scope === 'partial') {
        successMsg = isShipped
          ? '부분 취소가 접수되었습니다. 출고된 상품은 반품/회수 처리가 별도로 필요합니다.'
          : '부분 취소가 반영되었습니다. 환불은 수동 처리가 필요합니다.';
      } else if (result.refundStatus === 'succeeded') {
        successMsg = '주문이 취소되고 환불이 완료되었습니다.';
      } else if (result.refundStatus === 'pending') {
        successMsg = '주문이 취소되었습니다. 환불 처리 중입니다.';
      } else {
        successMsg = '주문이 취소되었습니다. 환불은 수동으로 처리가 필요합니다.';
      }
      toast.success(successMsg);
      onOpenChange(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : undefined;
      toast.error(message ?? '취소 처리 중 오류가 발생했습니다.');
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isShipped}
                className={`flex-1 py-2 rounded border text-sm ${scope === 'full' ? 'bg-red-500 text-white border-red-500' : 'hover:bg-gray-50'} disabled:opacity-40 disabled:cursor-not-allowed`}
                onClick={() => setScope('full')}
              >
                전체 취소
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
              전체 취소 시 출고 전 예약 해제 및 디지털 권리가 회수됩니다.
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
            {cancelMutation.isPending ? '처리 중...' : scope === 'full' ? '전체 취소 실행' : '부분 취소 실행'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
