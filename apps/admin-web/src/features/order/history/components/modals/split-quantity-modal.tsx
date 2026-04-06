// src/features/order/history/modals/split-quantity-modal.tsx
// TODO: WMS API 추가 필요 - POST /sales-orders/:id/split 또는 PATCH /sales-orders/:id/lines
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { splitQuantity } from '@/lib/services/orders';
import { orderQueryKeys } from '@/lib/services/orders';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    onClose: () => void;
}

export function SplitQuantityModal({ order, onClose }: Props) {
    const [splitData, setSplitData] = useState(
        order.lines.map((line: any) => ({
            lineId: line.id,
            productName: line.productName,
            originalQty: line.quantity,
            keepQty: line.quantity,
            splitQty: 0,
        }))
    );
    
    const queryClient = useQueryClient();

    const splitMutation = useMutation({
        mutationFn: splitQuantity,
        onSuccess: (result) => {
            if (result.success) {
                toast.success('수량이 분리되었습니다.');
                queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
                onClose();
            } else {
                toast.error(result.error || '수량 분리 중 오류가 발생했습니다.');
            }
        },
        onError: (error: any) => {
            toast.error(error.message || '수량 분리 중 오류가 발생했습니다.');
        },
    });

    const handleSplit = async () => {
        const itemsToSplit = splitData.filter((item: any) => item.splitQty > 0);

        if (itemsToSplit.length === 0) {
            toast.error('분리할 수량을 입력해주세요.');
            return;
        }

        // 모든 라인이 완전히 분리되는 경우 방지
        const allFullySplit = splitData.every((item: any) => item.keepQty === 0);
        if (allFullySplit) {
            toast.error('최소 1개 상품의 수량은 원본 주문에 남겨야 합니다.');
            return;
        }

        splitMutation.mutate({
            orderId: order.orderId,
            splits: itemsToSplit.map((item: any) => ({
                lineId: item.lineId,
                splitQty: item.splitQty,
            })),
            originalOrder: order,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">수량 나누기</h2>
                        <p className="text-xs text-amber-600 mt-1">
                            WMS API 추가 필요 (PATCH /sales-orders/:id/lines)
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <div className="mb-4 p-4 bg-blue-50 rounded-lg">
                        <p className="text-sm text-blue-800">
                            상품별 수량을 새로운 주문으로 분리합니다.
                            원본 주문에서 남길 수량과 분리할 수량을 지정해주세요.
                        </p>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="p-3 text-left">상품명</th>
                                    <th className="p-3 text-center">원본 수량</th>
                                    <th className="p-3 text-center">남길 수량</th>
                                    <th className="p-3 text-center">분리할 수량</th>
                                </tr>
                            </thead>
                            <tbody>
                                {splitData.map((item: any, idx: number) => (
                                    <tr key={item.lineId} className="border-t">
                                        <td className="p-3">{item.productName}</td>
                                        <td className="p-3 text-center font-medium">{item.originalQty}</td>
                                        <td className="p-3 text-center">
                                            <input
                                                type="number"
                                                value={item.keepQty}
                                                onChange={(e) => {
                                                    const keepQty = parseInt(e.target.value) || 0;
                                                    const splitQty = Math.max(0, item.originalQty - keepQty);
                                                    const newData = [...splitData];
                                                    newData[idx] = { ...item, keepQty, splitQty };
                                                    setSplitData(newData);
                                                }}
                                                className="w-20 px-2 py-1 border rounded text-center"
                                                min="0"
                                                max={item.originalQty}
                                            />
                                        </td>
                                        <td className="p-3 text-center">
                                            <input
                                                type="number"
                                                value={item.splitQty}
                                                onChange={(e) => {
                                                    const splitQty = parseInt(e.target.value) || 0;
                                                    const keepQty = Math.max(0, item.originalQty - splitQty);
                                                    const newData = [...splitData];
                                                    newData[idx] = { ...item, keepQty, splitQty };
                                                    setSplitData(newData);
                                                }}
                                                className="w-20 px-2 py-1 border rounded text-center"
                                                min="0"
                                                max={item.originalQty}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="px-6 py-4 border-t flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={splitMutation.isPending}
                        className="px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSplit}
                        disabled={splitMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {splitMutation.isPending ? '처리 중...' : '수량 분리'}
                    </button>
                </div>
            </div>
        </div>
    );
}
