// src/features/order/history/modals/edit-order-modal.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { SalesOrderRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: SalesOrderRow;
    onClose: () => void;
}

export function EditOrderModal({ order, onClose }: Props) {
    const [editedOrder, setEditedOrder] = useState(order);

    const handleSave = async () => {
        try {
            // TODO: API 연동
            console.log('Update order:', editedOrder);
            toast.success('주문 정보가 수정되었습니다.');
            onClose();
        } catch (error) {
            toast.error('주문 수정 중 오류가 발생했습니다.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">입력확인 / 수정</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <div className="grid grid-cols-2 gap-6 mb-6">
                        <div>
                            <label className="block text-sm font-medium mb-2">수령자명</label>
                            <input
                                type="text"
                                value={editedOrder.receiverName}
                                onChange={(e) => setEditedOrder({ ...editedOrder, receiverName: e.target.value })}
                                className="w-full px-3 py-2 border rounded-md"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-2">연락처</label>
                            <input
                                type="text"
                                value={editedOrder.phone ?? ''}
                                onChange={(e) => setEditedOrder({ ...editedOrder, phone: e.target.value })}
                                className="w-full px-3 py-2 border rounded-md"
                            />
                        </div>
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium mb-2">배송 주소</label>
                        <input
                            type="text"
                            value={editedOrder.address ?? ''}
                            onChange={(e) => setEditedOrder({ ...editedOrder, address: e.target.value })}
                            className="w-full px-3 py-2 border rounded-md"
                        />
                    </div>

                    <div className="mb-6">
                        <label className="block text-sm font-medium mb-2">메모</label>
                        <textarea
                            value={editedOrder.memo ?? ''}
                            onChange={(e) => setEditedOrder({ ...editedOrder, memo: e.target.value })}
                            className="w-full px-3 py-2 border rounded-md"
                            rows={3}
                        />
                    </div>

                    <div>
                        <h3 className="text-sm font-medium mb-2">상품 목록</h3>
                        <div className="border rounded-lg overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-left">상품명</th>
                                        <th className="p-3 text-left">옵션</th>
                                        <th className="p-3 text-center">수량</th>
                                        <th className="p-3 text-center">작업</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {editedOrder.lines.map((line, idx) => (
                                        <tr key={line.id} className="border-t">
                                            <td className="p-3">{line.productName}</td>
                                            <td className="p-3">{line.optionName ?? '단일상품'}</td>
                                            <td className="p-3">
                                                <input
                                                    type="number"
                                                    value={line.quantity}
                                                    onChange={(e) => {
                                                        const newLines = [...editedOrder.lines];
                                                        newLines[idx] = { ...line, quantity: parseInt(e.target.value) || 0 };
                                                        setEditedOrder({ ...editedOrder, lines: newLines });
                                                    }}
                                                    className="w-20 px-2 py-1 border rounded text-center"
                                                    min="1"
                                                />
                                            </td>
                                            <td className="p-3 text-center">
                                                <button
                                                    className="text-red-600 hover:text-red-700 text-sm"
                                                    onClick={() => {
                                                        const newLines = editedOrder.lines.filter((_, i) => i !== idx);
                                                        setEditedOrder({ ...editedOrder, lines: newLines });
                                                    }}
                                                >
                                                    삭제
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 border rounded-md hover:bg-gray-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}