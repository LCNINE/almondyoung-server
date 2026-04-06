// src/features/order/history/components/modals/edit-order-modal.tsx
// TODO: WMS API 추가 필요 - PATCH /sales-orders/:id/lines
// 현재는 WMS API 제약으로 주문 내용 수정 불가능
'use client';

import { useState } from 'react';
import {
    FocusModal,
    FocusModalContent,
    FocusModalHeader,
    FocusModalBody,
    FocusModalFooter,
    FocusModalTitle,
} from '@/components/common/focus-modal';
import { Button } from '@/components/ui/button';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function EditOrderModal({ order, open, onOpenChange }: Props) {
    const [editedOrder] = useState(order);

    return (
        <FocusModal open={open} onOpenChange={onOpenChange}>
            <FocusModalContent>
                <FocusModalHeader>
                    <div className="flex-1">
                        <FocusModalTitle>입력확인</FocusModalTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                            주문 내용을 확인합니다.
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                            주문 내용 수정은 WMS API 추가 후 지원 예정 (PATCH /sales-orders/:id/lines)
                        </p>
                    </div>
                </FocusModalHeader>

                <FocusModalBody className="p-6">
                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-3">기본 정보</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm mb-1 text-gray-600">주문번호</label>
                                <div className="px-3 py-2 border rounded-md bg-gray-50">{editedOrder.orderNo}</div>
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-gray-600">주문 상태</label>
                                <div className="px-3 py-2 border rounded-md bg-gray-50">{editedOrder.orderStatus}</div>
                            </div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-3">수령자 정보</h3>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="block text-sm mb-1 text-gray-600">주문자</label>
                                <div className="px-3 py-2 border rounded-md bg-gray-50">{editedOrder.customerName ?? '-'}</div>
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-gray-600">수령자</label>
                                <div className="px-3 py-2 border rounded-md bg-gray-50">{editedOrder.receiverName ?? '-'}</div>
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-gray-600">연락처</label>
                                <div className="px-3 py-2 border rounded-md bg-gray-50">{editedOrder.phone ?? '-'}</div>
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-gray-600">배송 주소</label>
                            <div className="px-3 py-2 border rounded-md bg-gray-50">{editedOrder.address ?? '-'}</div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-3">주문 상품</h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-left">상품명</th>
                                        <th className="p-3 text-left">옵션</th>
                                        <th className="p-3 text-center">수량</th>
                                        <th className="p-3 text-right">가격</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {editedOrder.lines.map((line: any) => (
                                        <tr key={line.id} className="border-t">
                                            <td className="p-3">{line.productName}</td>
                                            <td className="p-3 text-gray-600">{line.optionName ?? '단일상품'}</td>
                                            <td className="p-3 text-center font-medium">{line.quantity}</td>
                                            <td className="p-3 text-right">
                                                {line.unitPrice ? `${line.unitPrice.toLocaleString()}원` : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {editedOrder.memo && (
                        <div className="mb-6">
                            <h3 className="text-sm font-medium mb-3">관리자 메모</h3>
                            <div className="px-3 py-2 border rounded-md bg-gray-50 text-gray-700 whitespace-pre-wrap">
                                {editedOrder.memo}
                            </div>
                        </div>
                    )}
                </FocusModalBody>

                <FocusModalFooter>
                    <Button onClick={() => onOpenChange(false)}>
                        확인
                    </Button>
                </FocusModalFooter>
            </FocusModalContent>
        </FocusModal>
    );
}
