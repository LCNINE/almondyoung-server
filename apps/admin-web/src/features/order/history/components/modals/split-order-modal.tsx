// src/features/order/history/components/modals/split-order-modal.tsx
'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { toast } from 'sonner';
import type { SalesOrderRow } from '@/features/order/history/hooks/use-order-rows';

interface Props {
    order: SalesOrderRow;
    onClose: () => void;
}

export default function SplitOrderModal({ order, onClose }: Props) {
    const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
    const [recipientSuffix, setRecipientSuffix] = useState('-2');

    const handleSplit = async () => {
        if (selectedLines.size === 0) {
            toast.error('분리할 상품을 선택해주세요.');
            return;
        }

        if (selectedLines.size === order.lines.length) {
            toast.error('모든 상품을 선택했습니다. 최소 1개는 남겨두어야 합니다.');
            return;
        }

        try {
            // TODO: API 연동
            console.log('Split order:', {
                orderId: order.id,
                lineIds: Array.from(selectedLines),
                newRecipientName: order.receiverName + recipientSuffix,
            });

            toast.success('주문이 분리되었습니다.');
            onClose();
        } catch (error) {
            toast.error('주문 분리 중 오류가 발생했습니다.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex items-center justify-between">
                    <h2 className="text-lg font-semibold">배송 나누기</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        ✕
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
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
                                        <th className="p-3 text-left">상태</th>
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
                                            <td className="p-3">
                                                {line.isDirect && (
                                                    <span className="text-xs text-indigo-600">직배송</span>
                                                )}
                                                {line.isReadyToShip && (
                                                    <span className="text-xs text-emerald-600 ml-2">출고가능</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mb-6">
                        <h3 className="text-sm font-medium mb-2">새 주문 수령자명</h3>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={order.receiverName}
                                disabled
                                className="flex-1 px-3 py-2 border rounded-md bg-gray-50"
                            />
                            <span>+</span>
                            <input
                                type="text"
                                value={recipientSuffix}
                                onChange={(e) => setRecipientSuffix(e.target.value)}
                                placeholder="-2"
                                className="w-20 px-3 py-2 border rounded-md"
                            />
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
                        onClick={handleSplit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        주문 분리
                    </button>
                </div>
            </div>
        </div>
    );
}