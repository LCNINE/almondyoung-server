// src/features/order/history/components/modals/add-order-item-modal.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { SalesOrderRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: SalesOrderRow;
    onClose: () => void;
}

export function AddOrderItemModal({ order, onClose }: Props) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSku, setSelectedSku] = useState<any>(null);
    const [quantity, setQuantity] = useState(1);

    const handleAdd = async () => {
        if (!selectedSku) {
            toast.error('상품을 선택해주세요.');
            return;
        }

        try {
            // TODO: API 연동
            console.log('Add item to order:', {
                orderId: order.id,
                skuId: selectedSku.id,
                quantity,
            });

            toast.success('상품이 추가되었습니다.');
            onClose();
        } catch (error) {
            toast.error('상품 추가 중 오류가 발생했습니다.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-2xl">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">주문 상품 추가</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">상품 검색</label>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="상품명 또는 SKU 코드 입력"
                            className="w-full px-3 py-2 border rounded-md"
                        />
                    </div>

                    {/* TODO: 검색 결과 표시 */}
                    <div className="mb-4 p-4 border rounded-lg bg-gray-50 text-sm text-gray-600">
                        검색 결과가 여기에 표시됩니다.
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">수량</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                            min="1"
                            className="w-24 px-3 py-2 border rounded-md"
                        />
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
                        onClick={handleAdd}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        추가
                    </button>
                </div>
            </div>
        </div>
    );
}