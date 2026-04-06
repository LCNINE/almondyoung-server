// src/features/order/history/components/modals/edit-order-modal.tsx
// TODO: WMS API 추가 필요 - PATCH /sales-orders/:id/lines
// 현재는 WMS API 제약으로 주문 내용 수정 불가능
'use client';

import { useState } from 'react';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    onClose: () => void;
}

export function EditOrderModal({ order, onClose }: Props) {
    const [editedOrder] = useState(order);

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">입력확인</h2>
                        <p className="text-xs text-gray-500 mt-1">
                            주문 내용을 확인합니다.
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                            ⚠️ 주문 내용 수정은 WMS API 추가 후 지원 예정 (PATCH /sales-orders/:id/lines)
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-3">기본 정보</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm mb-1">주문번호</label>
                                <input
                                    type="text"
                                    value={editedOrder.orderNo}
                                    disabled
                                    className="w-full px-3 py-2 border rounded-md bg-gray-50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">주문 상태</label>
                                <input
                                    type="text"
                                    value={editedOrder.orderStatus}
                                    disabled
                                    className="w-full px-3 py-2 border rounded-md bg-gray-50"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-3">수령자 정보</h3>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-sm mb-1">수령자명</label>
                                <input
                                    type="text"
                                    value={editedOrder.receiverName ?? ''}
                                    disabled
                                    className="w-full px-3 py-2 border rounded-md bg-gray-50"
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">연락처</label>
                                <input
                                    type="text"
                                    value={editedOrder.phone ?? ''}
                                    disabled
                                    className="w-full px-3 py-2 border rounded-md bg-gray-50"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm mb-1">배송 주소</label>
                            <input
                                type="text"
                                value={editedOrder.address ?? ''}
                                disabled
                                className="w-full px-3 py-2 border rounded-md bg-gray-50"
                            />
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
                                        <th className="p-3 text-center">가격</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {editedOrder.lines.map((line: any) => (
                                        <tr key={line.id} className="border-t">
                                            <td className="p-3">{line.productName}</td>
                                            <td className="p-3">{line.optionName ?? '단일상품'}</td>
                                            <td className="p-3 text-center">{line.quantity}</td>
                                            <td className="p-3 text-center">
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
                            <h3 className="text-sm font-medium mb-3">메모</h3>
                            <div className="w-full px-3 py-2 border rounded-md bg-gray-50 text-gray-700">
                                {editedOrder.memo}
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 border-t flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
}
