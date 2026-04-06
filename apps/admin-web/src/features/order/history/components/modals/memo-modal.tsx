// src/features/order/history/components/modals/memo-modal.tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { orders } from '@/lib/api/domains';
import { orderQueryKeys } from '@/lib/services/orders';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MemoModal({ order, open, onOpenChange }: Props) {
    const [memo, setMemo] = useState('');
    const queryClient = useQueryClient();

    // order가 변경될 때마다 memo 초기화
    useEffect(() => {
        if (order && open) {
            setMemo(order.memo ?? '');
        }
    }, [order, open]);

    const updateMutation = useMutation({
        mutationFn: async (params: { orderId: string; memo: string }) => {
            await orders.salesOrders.updateSalesOrder(params.orderId, {
                memo: params.memo,
            });
        },
        onSuccess: () => {
            toast.success('메모가 저장되었습니다.');
            queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
            onOpenChange(false);
        },
        onError: (error: any) => {
            toast.error(error.message || '메모 저장 중 오류가 발생했습니다.');
        },
    });

    const handleSave = () => {
        if (!order) return;
        updateMutation.mutate({
            orderId: order.orderId,
            memo,
        });
    };

    if (!order) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>메모 추가/수정</DialogTitle>
                    <p className="text-xs text-gray-500 mt-1">
                        주문번호: {order.orderNo}
                    </p>
                </DialogHeader>

                <div className="space-y-4">
                    {/* TODO: WMS에 메모 히스토리 API 추가 필요 */}
                    {/* 현재는 최신 메모만 표시/수정 가능 */}
                    {/* 향후: 관리자별, 시간별 메모 내역을 리스트로 표시 */}
                    {order.memo && (
                        <div className="p-3 bg-gray-50 rounded-lg border">
                            <div className="text-xs text-gray-500 mb-1">현재 메모</div>
                            <div className="text-sm text-gray-700">{order.memo}</div>
                            <div className="text-xs text-gray-400 mt-1">
                                메모 히스토리는 WMS API 추가 후 지원 예정 (관리자/시간별 이력 표시)
                            </div>
                        </div>
                    )}

                    <div>
                        <Label htmlFor="memo">새 메모 작성</Label>
                        <textarea
                            id="memo"
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mt-2"
                            rows={5}
                            placeholder="주문 관련 메모를 입력하세요..."
                        />
                    </div>

                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="text-xs font-medium text-blue-900 mb-2">주문 정보</div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-blue-700">
                            <div>
                                <span className="text-blue-500">주문자:</span> {order.customerName ?? '-'}
                            </div>
                            <div>
                                <span className="text-blue-500">수령자:</span> {order.receiverName ?? '-'}
                            </div>
                            <div className="col-span-2">
                                <span className="text-blue-500">연락처:</span> {order.phone ?? '-'}
                            </div>
                            {order.address && (
                                <div className="col-span-2">
                                    <span className="text-blue-500">주소:</span> {order.address}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={updateMutation.isPending}
                    >
                        취소
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                    >
                        {updateMutation.isPending ? '저장 중...' : '저장'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
