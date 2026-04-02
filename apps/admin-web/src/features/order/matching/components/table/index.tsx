// src/features/order/matching/components/table/index.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useMemo, useState } from 'react';
import type { OrderLineDto } from '@/lib/types/dto/orders';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductRegistrationDialog } from './ProductRegistrationDialog';
import { useVariantsBatch } from '@/lib/services/products';
import type { BatchVariantInfo } from '@/lib/api/domains/products/variants.client';
import { SalesChannelMark } from '@/components/common/sales-channel-mark';
import { Skeleton } from '@/components/ui/skeleton';

interface MatchingTableProps {
  data: OrderLineDto[];
  isLoading: boolean;
  error: Error | null;
}

type SalesChannelType = 'almondyoung' | 'coupang' | 'naver_smartstore' | 'phone_order' | 'other';

function toChannelType(salesChannel: string): SalesChannelType {
  switch (salesChannel) {
    case 'medusa':
    case 'online':
      return 'almondyoung';
    case 'coupang':
    case 'marketplace':
      return 'coupang';
    case 'naver_smartstore':
    case 'smartstore':
      return 'naver_smartstore';
    case 'phone_order':
    case 'direct':
      return 'phone_order';
    default:
      return 'other';
  }
}

// 행 컴포넌트
function OrderLineRow({
  line,
  index,
  totalCount,
  variantInfo,
  isSelected,
  onRowSelect,
  onInventoryMatching,
  onProductRegistration,
}: {
  line: OrderLineDto;
  index: number;
  totalCount: number;
  variantInfo?: BatchVariantInfo;
  isSelected: boolean;
  onRowSelect: (id: string, checked: boolean) => void;
  onInventoryMatching: (line: OrderLineDto) => void;
  onProductRegistration: (line: OrderLineDto) => void;
}) {
  // 상품명: PIM masterName 우선, 없으면 채널 상품명
  const displayName = variantInfo?.masterName || line.productName || '상품명 없음';
  const optionLabel = variantInfo?.optionLabel || variantInfo?.variantName || '';

  const renderMatchingCell = () => {
    // PIM 미등록 (matchingId 없음)
    if (!line.matchingId) {
      return (
        <div className="space-y-2">
          <div className="text-sm text-red-500 font-medium">상품 없음</div>
          <Button
            size="sm"
            className="bg-red-500 hover:bg-red-600 text-white"
            onClick={() => onProductRegistration(line)}
          >
            상품 생성
          </Button>
        </div>
      );
    }

    // 매칭 대기
    if (line.matchingStatus === 'pending') {
      return (
        <div className="space-y-2">
          <div className="text-sm text-red-500 font-medium">매칭 재고상품 없음</div>
          <Button
            size="sm"
            className="bg-yellow-500 hover:bg-yellow-600 text-white"
            onClick={() => onInventoryMatching(line)}
          >
            재고매칭
          </Button>
        </div>
      );
    }

    // 매칭 완료
    if (line.matchingStatus === 'matched' && line.matchedSkus.length > 0) {
      return (
        <div className="space-y-2">
          {line.matchedSkus.map((sku) => (
            <div key={sku.skuId} className="text-sm">
              <div className="text-green-600 font-medium">
                {sku.skuName}
                {sku.quantity > 1 && <span className="ml-1">×{sku.quantity}</span>}
              </div>
              {sku.skuCode && (
                <div className="text-gray-500 text-xs">바코드: {sku.skuCode}</div>
              )}
              <div className="text-gray-500 text-xs">
                주문수량 × {sku.quantity} = {line.quantity * sku.quantity}
              </div>
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <Button size="sm" variant="outline" onClick={() => onInventoryMatching(line)}>
              재매칭
            </Button>
            <Button size="sm" variant="outline" onClick={() => onInventoryMatching(line)}>
              매칭수정
            </Button>
          </div>
        </div>
      );
    }

    // 무시됨
    if (line.matchingStatus === 'ignored') {
      return (
        <div className="text-sm text-gray-500">재고 불필요 상품</div>
      );
    }

    return null;
  };

  return (
    <tr className="hover:bg-gray-50 border-b">
      <td className="px-4 py-4">
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) => onRowSelect(line.id, !!checked)}
        />
      </td>
      <td className="px-4 py-4 text-sm text-gray-900 text-center">{totalCount - index}</td>
      <td className="px-4 py-4">
        <SalesChannelMark channel={toChannelType(line.salesChannel)} size="sm" className="max-w-[120px]" />
      </td>
      <td className="px-4 py-4">
        <div className="space-y-1">
          <div className="font-medium text-sm">{displayName}</div>
          {optionLabel && <div className="text-sm text-gray-500">- {optionLabel}</div>}
          <div className="text-xs text-gray-400 mt-1">
            주문번호:{' '}
            <span className="text-blue-600 underline cursor-pointer">{line.channelOrderId}</span>
          </div>
          <div className="text-xs text-gray-500">
            수량: {line.quantity}개
            {line.totalPrice !== undefined && (
              <> &nbsp;판매금액: {line.totalPrice.toLocaleString()}원</>
            )}
            {line.customerName && <> &nbsp;수령자: {line.customerName}</>}
          </div>
        </div>
      </td>
      <td className="px-4 py-4">{renderMatchingCell()}</td>
    </tr>
  );
}

// 메인 테이블 컴포넌트
export function MatchingTable({ data, isLoading, error }: MatchingTableProps) {
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [currentLine, setCurrentLine] = useState<OrderLineDto | null>(null);

  // variantId 일괄 조회 (N+1 방지)
  const variantIds = useMemo(
    () => [...new Set(data.map((l) => l.variantId).filter(Boolean))],
    [data],
  );
  const { data: variantMap } = useVariantsBatch(variantIds);

  const handleRowSelect = (id: string, checked: boolean) => {
    const next = new Set(selectedRows);
    checked ? next.add(id) : next.delete(id);
    setSelectedRows(next);
  };

  const handleInventoryMatching = (line: OrderLineDto) => {
    window.open(
      `/dialog/inventory-matching?matchingId=${line.matchingId}&variantId=${line.variantId}`,
      '_blank',
      'width=1200,height=800,scrollbars=yes,resizable=yes',
    );
  };

  const handleProductRegistration = (line: OrderLineDto) => {
    setCurrentLine(line);
    setShowProductDialog(true);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">오류가 발생했습니다: {error.message}</div>
      </div>
    );
  }

  const SKELETON_ROWS = 10;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 w-10">
                <Checkbox
                  checked={selectedRows.size === data.length && data.length > 0}
                  onCheckedChange={(checked) => {
                    setSelectedRows(checked ? new Set(data.map((l) => l.id)) : new Set());
                  }}
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">번호</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">판매처명</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">판매처상품명</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-56">매칭상품명/수량</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  <td className="px-4 py-4"><Skeleton className="h-4 w-4" /></td>
                  <td className="px-4 py-4"><Skeleton className="h-4 w-6" /></td>
                  <td className="px-4 py-4"><Skeleton className="h-6 w-24" /></td>
                  <td className="px-4 py-4">
                    <Skeleton className="h-4 w-48 mb-2" />
                    <Skeleton className="h-3 w-32" />
                  </td>
                  <td className="px-4 py-4"><Skeleton className="h-8 w-24" /></td>
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400 text-sm">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              data.map((line, index) => (
                <OrderLineRow
                  key={line.id}
                  line={line}
                  index={index}
                  totalCount={data.length}
                  variantInfo={variantMap?.get(line.variantId)}
                  isSelected={selectedRows.has(line.id)}
                  onRowSelect={handleRowSelect}
                  onInventoryMatching={handleInventoryMatching}
                  onProductRegistration={handleProductRegistration}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showProductDialog && currentLine && (
        <ProductRegistrationDialog
          isOpen={showProductDialog}
          matching={currentLine as any}
          onClose={() => {
            setShowProductDialog(false);
            setCurrentLine(null);
          }}
        />
      )}
    </div>
  );
}
