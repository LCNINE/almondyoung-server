// src/features/order/history/modals/split-quantity-modal.tsx
// TODO: WMS API 추가 필요 - POST /sales-orders/:id/split 또는 PATCH /sales-orders/:id/lines
'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { splitQuantity } from '@/lib/services/orders';
import { orderQueryKeys } from '@/lib/services/orders';
import {
    FocusModal,
    FocusModalContent,
    FocusModalHeader,
    FocusModalBody,
    FocusModalFooter,
    FocusModalTitle,
} from '@/components/common/focus-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SplitQuantityModal({ order, open, onOpenChange }: Props) {
    const [splitData, setSplitData] = useState(
        order.lines.map((line: any) => ({
            lineId: line.id,
            productName: line.productName,
            originalQty: line.quantity,
            keepQty: line.quantity,
            splitQty: 0,
        }))
    );

    useEffect(() => {
        if (open) {
            setSplitData(
                order.lines.map((line: any) => ({
                    lineId: line.id,
                    productName: line.productName,
                    originalQty: line.quantity,
                    keepQty: line.quantity,
                    splitQty: 0,
                }))
            );
        }
    }, [open, order.orderId, order.lines]);
    
    const queryClient = useQueryClient();

    const splitMutation = useMutation({
        mutationFn: splitQuantity,
        onSuccess: (result) => {
            if (result.success) {
                toast.success('수량이 분리되었습니다.');
                queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
                onOpenChange(false);
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
        <FocusModal open={open} onOpenChange={onOpenChange}>
            <FocusModalContent>
                <FocusModalHeader>
                    <div className="flex-1">
                        <FocusModalTitle>수량 나누기</FocusModalTitle>
                        <p className="text-xs text-amber-600 mt-1">
                            WMS API 추가 필요 (PATCH /sales-orders/:id/lines)
                        </p>
                    </div>
                </FocusModalHeader>

                <FocusModalBody className="p-6">
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
                                            <Input
                                                type="number"
                                                value={item.keepQty}
                                                onChange={(e) => {
                                                    const keepQty = parseInt(e.target.value) || 0;
                                                    const splitQty = Math.max(0, item.originalQty - keepQty);
                                                    const newData = [...splitData];
                                                    newData[idx] = { ...item, keepQty, splitQty };
                                                    setSplitData(newData);
                                                }}
                                                className="w-20 text-center mx-auto"
                                                min="0"
                                                max={item.originalQty}
                                            />
                                        </td>
                                        <td className="p-3 text-center">
                                            <Input
                                                type="number"
                                                value={item.splitQty}
                                                onChange={(e) => {
                                                    const splitQty = parseInt(e.target.value) || 0;
                                                    const keepQty = Math.max(0, item.originalQty - splitQty);
                                                    const newData = [...splitData];
                                                    newData[idx] = { ...item, keepQty, splitQty };
                                                    setSplitData(newData);
                                                }}
                                                className="w-20 text-center mx-auto"
                                                min="0"
                                                max={item.originalQty}
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </FocusModalBody>

                <FocusModalFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={splitMutation.isPending}
                    >
                        취소
                    </Button>
                    <Button
                        onClick={handleSplit}
                        disabled={splitMutation.isPending}
                    >
                        {splitMutation.isPending ? '처리 중...' : '수량 분리'}
                    </Button>
                </FocusModalFooter>
            </FocusModalContent>
        </FocusModal>
    );
}
