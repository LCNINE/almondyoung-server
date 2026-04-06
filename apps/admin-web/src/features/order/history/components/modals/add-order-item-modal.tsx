// src/features/order/history/components/modals/add-order-item-modal.tsx
// TODO: WMS API 추가 필요 - POST /sales-orders/:id/lines
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { addOrderItem } from '@/lib/services/orders';
import { orderQueryKeys } from '@/lib/services/orders';
import { inventory } from '@/lib/api/domains';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    onClose: () => void;
}

export function AddOrderItemModal({ order, onClose }: Props) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSku, setSelectedSku] = useState<any>(null);
    const [quantity, setQuantity] = useState(1);
    
    const queryClient = useQueryClient();

    // SKU 검색
    const { data: searchResults, isLoading: isSearching } = useQuery({
        queryKey: ['skus', 'search', searchTerm],
        queryFn: async () => {
            if (!searchTerm || searchTerm.length < 2) return [];
            const results = await inventory.skus.getSkus({ 
                name: searchTerm,
            });
            return results || [];
        },
        enabled: searchTerm.length >= 2,
        staleTime: 30 * 1000,
    });

    const addMutation = useMutation({
        mutationFn: addOrderItem,
        onSuccess: (result) => {
            if (result.success) {
                toast.success('상품이 추가되었습니다.');
                queryClient.invalidateQueries({ queryKey: orderQueryKeys.orders });
                onClose();
            } else {
                toast.error(result.error || '상품 추가 중 오류가 발생했습니다.');
            }
        },
        onError: (error: any) => {
            toast.error(error.message || '상품 추가 중 오류가 발생했습니다.');
        },
    });

    const handleAdd = async () => {
        if (!selectedSku) {
            toast.error('상품을 선택해주세요.');
            return;
        }

        if (quantity < 1) {
            toast.error('수량은 1개 이상이어야 합니다.');
            return;
        }

        addMutation.mutate({
            orderId: order.orderId,
            newItem: {
                skuId: selectedSku.id,
                quantity,
                unitPrice: 0,
            },
            originalOrder: order,
        });
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold">주문 상품 추가</h2>
                        <p className="text-xs text-amber-600 mt-1">
                            WMS API 추가 필요 (POST /sales-orders/:id/lines)
                        </p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">상품 검색</label>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="상품명 또는 SKU 코드 입력 (최소 2자)"
                            className="w-full px-3 py-2 border rounded-md"
                        />
                    </div>

                    {/* 검색 결과 */}
                    <div className="mb-4">
                        {isSearching ? (
                            <div className="p-4 border rounded-lg bg-gray-50 text-sm text-gray-600 text-center">
                                검색 중...
                            </div>
                        ) : searchResults && searchResults.length > 0 ? (
                            <div className="border rounded-lg max-h-64 overflow-y-auto">
                                {searchResults.map((sku: any) => (
                                    <button
                                        key={sku.id}
                                        onClick={() => setSelectedSku(sku)}
                                        className={`w-full p-3 text-left hover:bg-gray-50 border-b last:border-b-0 ${
                                            selectedSku?.id === sku.id ? 'bg-blue-50' : ''
                                        }`}
                                    >
                                        <div className="font-medium text-sm">{sku.name}</div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            SKU: {sku.code || sku.id}
                                            {sku.optionName && ` • ${sku.optionName}`}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : searchTerm.length >= 2 ? (
                            <div className="p-4 border rounded-lg bg-gray-50 text-sm text-gray-600 text-center">
                                검색 결과가 없습니다.
                            </div>
                        ) : (
                            <div className="p-4 border rounded-lg bg-gray-50 text-sm text-gray-600 text-center">
                                상품명 또는 SKU 코드를 입력하세요.
                            </div>
                        )}
                    </div>

                    {selectedSku && (
                        <div className="mb-4 p-3 border border-blue-200 bg-blue-50 rounded-lg">
                            <div className="text-sm font-medium text-blue-900 mb-1">선택된 상품</div>
                            <div className="text-sm text-blue-700">{selectedSku.name}</div>
                            <div className="text-xs text-blue-600 mt-1">
                                SKU: {selectedSku.code || selectedSku.id}
                            </div>
                        </div>
                    )}

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
                        disabled={addMutation.isPending}
                        className="px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleAdd}
                        disabled={addMutation.isPending || !selectedSku}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                        {addMutation.isPending ? '추가 중...' : '추가'}
                    </button>
                </div>
            </div>
        </div>
    );
}
