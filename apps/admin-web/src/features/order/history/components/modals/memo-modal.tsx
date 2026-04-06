// src/features/order/history/components/modals/memo-modal.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { orders } from '@/lib/api/domains';
import { orderQueryKeys } from '@/lib/services/orders';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    onClose: () => void;
}

export function MemoModal({ order, onClose }: Props) {
    const [memo, setMemo] = useState(order.memo ?? '');
    const queryClient = useQueryClient();

    const updateMutation = useMutation({
        mutationFn: async (params: { orderId: string; memo: string }) => {
            await orders.salesOrders.updateSalesOrder(params.orderId, {
                memo: params.memo,
            });
        },
        onSuccess: () => {
            toast.success('메모가 저장되었습니다.');
            queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
            onClose();
        },
        onError: (error: any) => {
            toast.error(error.message || '메모 저장 중 오류가 발생했습니다.');
        },
    });

    const handleSave = () => {
        updateMutation.mutate({
            orderId: order.orderId,
            memo,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-2xl overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">메모 추가/수정</h2>
                        <p className="text-xs text-gray-500 mt-1">
                            주문번호: {order.orderNo}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">관리자 메모</label>
                        <textarea
                            value={memo}
                            onChange={(e) => setMemo(e.target.value)}
                            className="w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            rows={5}
                            placeholder="주문 관련 메모를 입력하세요..."
                        />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <div>수령자: {order.receiverName ?? '-'}</div>
                        <div>•</div>
                        <div>연락처: {order.phone ?? '-'}</div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={updateMutation.isPending}
                        className="px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {updateMutation.isPending ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}
