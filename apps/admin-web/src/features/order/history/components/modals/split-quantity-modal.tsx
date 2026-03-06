// src/features/order/history/modals/split-quantity-modal.tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { SalesOrderRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: SalesOrderRow;
    onClose: () => void;
}

export function SplitQuantityModal({ order, onClose }: Props) {
    const [splitData, setSplitData] = useState(
        order.lines.map(line => ({
            lineId: line.id,
            productName: line.productName,
            originalQty: line.quantity,
            keepQty: line.quantity,
            splitQty: 0,
        }))
    );

    const handleSplit = async () => {
        const itemsToSplit = splitData.filter(item => item.splitQty > 0);

        if (itemsToSplit.length === 0) {
            toast.error('분리할 수량을 입력해주세요.');
            return;
        }

        try {
            // TODO: API 연동
            console.log('Split quantities:', {
                orderId: order.id,
                splits: itemsToSplit,
            });

            toast.success('수량이 분리되었습니다.');
            onClose();
        } catch (error) {
            toast.error('수량 분리 중 오류가 발생했습니다.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">수량 나누기</h2>
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
                                {splitData.map((item, idx) => (
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
                        className="px-4 py-2 border rounded-md hover:bg-gray-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSplit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        수량 분리
                    </button>
                </div>
            </div>
        </div>
    );
}
