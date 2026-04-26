// src/features/order/history/components/modals/add-order-item-modal.tsx
// TODO: WMS API 추가 필요 - POST /sales-orders/:id/lines
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { addOrderItem } from '@/lib/services/orders';
import { orderQueryKeys } from '@/lib/services/orders';
import { inventory } from '@/lib/api/domains';
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
import { Label } from '@/components/ui/label';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: OrderLineRow;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function AddOrderItemModal({ order, open, onOpenChange }: Props) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSku, setSelectedSku] = useState<any>(null);
    const [quantity, setQuantity] = useState(1);
    
    const queryClient = useQueryClient();

    useEffect(() => {
        if (open) {
            setSearchTerm('');
            setSelectedSku(null);
            setQuantity(1);
        }
    }, [open, order.orderId]);

    // SKU 검색
    const { data: searchResults, isLoading: isSearching } = useQuery({
        queryKey: ['skus', 'search', searchTerm],
        queryFn: async () => {
            if (!searchTerm || searchTerm.length < 2) return [];
            const results = await inventory.skus.getSkus({
                name: searchTerm,
            });
            return results?.items ?? [];
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
                onOpenChange(false);
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
        <FocusModal open={open} onOpenChange={onOpenChange}>
            <FocusModalContent>
                <FocusModalHeader>
                    <div className="flex-1">
                        <FocusModalTitle>주문 상품 추가</FocusModalTitle>
                        <p className="text-xs text-amber-600 mt-1">
                            ⚠️ WMS API 추가 필요 (POST /sales-orders/:id/lines)
                        </p>
                    </div>
                </FocusModalHeader>

                <FocusModalBody className="p-6">
                    <div className="mb-4">
                        <Label className="mb-2">상품 검색</Label>
                        <Input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="상품명 또는 SKU 코드 입력 (최소 2자)"
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
                        <Label className="mb-2">수량</Label>
                        <Input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                            min="1"
                            className="w-24"
                        />
                    </div>
                </FocusModalBody>

                <FocusModalFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={addMutation.isPending}
                    >
                        취소
                    </Button>
                    <Button
                        onClick={handleAdd}
                        disabled={addMutation.isPending || !selectedSku}
                    >
                        {addMutation.isPending ? '추가 중...' : '추가'}
                    </Button>
                </FocusModalFooter>
            </FocusModalContent>
        </FocusModal>
    );
}
