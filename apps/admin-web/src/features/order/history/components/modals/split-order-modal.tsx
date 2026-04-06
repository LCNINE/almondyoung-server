// src/features/order/history/components/modals/split-order-modal.tsx
// TODO: WMS API 추가 필요 - POST /sales-orders/:id/split
'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { splitOrder } from '@/lib/services/orders';
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

export default function SplitOrderModal({ order, open, onOpenChange }: Props) {
    const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
    const [recipientSuffix, setRecipientSuffix] = useState('-2');
    const queryClient = useQueryClient();

    useEffect(() => {
        if (open) {
            setSelectedLines(new Set());
            setRecipientSuffix('-2');
        }
    }, [open, order.orderId]);

    const splitMutation = useMutation({
        mutationFn: splitOrder,
        onSuccess: (result) => {
            if (result.success) {
                toast.success('주문이 분리되었습니다.');
                queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
                onOpenChange(false);
            } else {
                toast.error(result.error || '주문 분리 중 오류가 발생했습니다.');
            }
        },
        onError: (error: any) => {
            toast.error(error.message || '주문 분리 중 오류가 발생했습니다.');
        },
    });

    const handleSplit = async () => {
        if (selectedLines.size === 0) {
            toast.error('분리할 상품을 선택해주세요.');
            return;
        }

        if (selectedLines.size === order.lines.length) {
            toast.error('모든 상품을 선택했습니다. 최소 1개는 남겨두어야 합니다.');
            return;
        }

        splitMutation.mutate({
            orderId: order.orderId,
            selectedLineIds: Array.from(selectedLines),
            originalOrder: order,
        });
    };

    return (
        <FocusModal open={open} onOpenChange={onOpenChange}>
            <FocusModalContent>
                <FocusModalHeader>
                    <div className="flex-1">
                        <FocusModalTitle>배송 나누기</FocusModalTitle>
                        <p className="text-xs text-amber-600 mt-1">
                            WMS API 추가 필요 (POST /sales-orders/:id/split)
                        </p>
                    </div>
                </FocusModalHeader>

                <FocusModalBody className="p-6">
                    <div className="mb-4 p-4 bg-amber-50 rounded-lg">
                        <p className="text-sm text-amber-800">
                            한 바구니에 담긴 주문을 나누는 기능입니다. 나뉜 주문은 동일한 주문번호를 가지며,
                            수령자 이름 뒤에 구분자를 추가하여 구분됩니다.
                        </p>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-2">원본 주문 정보</h3>
                        <div className="p-3 bg-gray-50 rounded text-sm">
                            <div>주문번호: {order.orderNo}</div>
                            <div>수령자: {order.receiverName}</div>
                            <div>주소: {order.address}</div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-2">분리할 상품 선택</h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-left w-10">
                                            <input
                                                type="checkbox"
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedLines(new Set(order.lines.map((l: any) => l.id)));
                                                    } else {
                                                        setSelectedLines(new Set());
                                                    }
                                                }}
                                            />
                                        </th>
                                        <th className="p-3 text-left">상품명</th>
                                        <th className="p-3 text-left">옵션</th>
                                        <th className="p-3 text-center">수량</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {order.lines.map((line: any) => (
                                        <tr key={line.id} className="border-t">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLines.has(line.id)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedLines);
                                                        if (e.target.checked) {
                                                            newSet.add(line.id);
                                                        } else {
                                                            newSet.delete(line.id);
                                                        }
                                                        setSelectedLines(newSet);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-3">{line.productName}</td>
                                            <td className="p-3">{line.optionName ?? '단일상품'}</td>
                                            <td className="p-3 text-center">{line.quantity}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-2">새 주문 수령자명</h3>
                        <div className="flex items-center gap-2">
                            <Input
                                type="text"
                                value={order.receiverName}
                                disabled
                                className="flex-1 bg-gray-50"
                            />
                            <span>+</span>
                            <Input
                                type="text"
                                value={recipientSuffix}
                                onChange={(e) => setRecipientSuffix(e.target.value)}
                                placeholder="-2"
                                className="w-20"
                            />
                        </div>
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
                        disabled={splitMutation.isPending || selectedLines.size === 0}
                    >
                        {splitMutation.isPending ? '처리 중...' : '주문 분리'}
                    </Button>
                </FocusModalFooter>
            </FocusModalContent>
        </FocusModal>
    );
}
