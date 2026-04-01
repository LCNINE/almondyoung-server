// src/features/order/matching/components/table/index.tsx
// 매칭 테이블 컴포넌트
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useMemo, useState } from 'react';
import { MatchingDto } from '@/lib/types/dto/orders';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { InventoryMatchingDialog } from './InventoryMatchingDialog';
import { ProductRegistrationDialog } from './ProductRegistrationDialog';
// API 훅 import
import { useVariantsBatch } from '@/lib/services/products';
import { useSku, useSkusByIds } from '@/lib/services/inventory';
import type { BatchVariantInfo } from '@/lib/api/domains/products/variants.client';
import {
  getSalesChannelLabel,
  getMatchingStatusColor,
  getPriorityColor,
  getSalesChannelColor
} from '@/lib/services/orders';
import { SalesChannelMark } from '@/components/common/sales-channel-mark';
// 세트상품 SKU 매핑 데이터 import (임시 데이터)
const mockSetProductSkuMappings: Record<string, any[]> = {};

interface MatchingTableProps {
  data: MatchingDto[];
  isLoading: boolean;
  error: Error | null;
}


// 매칭 행 컴포넌트
function MatchingRow({
  matching,
  index,
  totalCount,
  variantInfo,
  onInventoryMatching,
  onProductRegistration,
  onRematch,
  onMatchEdit,
  onMatchDelete,
  onRowSelect,
  isSelected,
}: {
  matching: MatchingDto;
  index: number;
  totalCount: number;
  variantInfo?: BatchVariantInfo;
  onInventoryMatching: (matching: MatchingDto) => void;
  onProductRegistration: (matching: MatchingDto) => void;
  onRematch: (matching: MatchingDto) => void;
  onMatchEdit: (matching: MatchingDto) => void;
  onMatchDelete: (matching: MatchingDto) => void;
  onRowSelect: (id: string, checked: boolean) => void;
  isSelected: boolean;
}) {

  // variantInfo는 부모에서 배치 조회한 결과
  const variant = variantInfo;

  // 매칭된 SKU 정보 (새로운 API 구조)
  const matchedSkus = matching.matchedSkus || [];

  // 단일 SKU 정보 (첫 번째 매칭된 SKU)
  const firstMatchedSku = matchedSkus[0];
  const { data: sku } = useSku(firstMatchedSku?.skuId || '');

  // 세트상품 여부 및 세트 SKU ID 목록
  const setProductMappings = mockSetProductSkuMappings[matching.variantId];
  const setSkuIds = useMemo(
    () => (setProductMappings ? setProductMappings.map((m) => m.skuId) : []),
    [setProductMappings]
  );

  // ✅ 세트상품 SKU들을 일괄 조회하여 바코드/이름 사용
  const { data: skusMap, isLoading: isSkusLoading } = useSkusByIds(setSkuIds);

  // 🔹 주문 메타 정보
  const orderMeta = matching.order;

  if (!orderMeta) {
    return (
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-4">
          <Checkbox checked={isSelected} onCheckedChange={(checked) => onRowSelect(matching.id, !!checked)} />
        </td>
        <td className="px-4 py-4 text-sm text-gray-900">{totalCount - index}</td>
        <td className="px-4 py-4 text-sm text-red-500">주문 정보 없음</td>
        <td className="px-4 py-4 text-sm text-red-500">주문 정보 없음</td>
        <td className="px-4 py-4 text-sm text-red-500">주문 정보 없음</td>
      </tr>
    );
  }

  const orderNumber = orderMeta.salesOrderId;
  const sellerName = getSalesChannelLabel(orderMeta.salesChannel);

  // 🔹 상품명과 옵션: PIM 배치 조회 결과 우선 사용
  const productName = variant?.masterName || orderMeta.productName || '상품명 없음';
  const option = variant?.optionLabel || variant?.variantName || '단일 상품';

  const quantity = orderMeta.quantity ?? 0;
  const salesAmount = orderMeta.salesAmount || 0;
  const recipient = orderMeta.recipient || '수령자 정보 없음';

  // 판매처 아이콘 표시 - SalesChannelMark 사용
  const getSellerIcon = (channel: string) => {
    // salesChannel을 SalesChannelType으로 매핑
    const getChannelType = (salesChannel: string) => {
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
    };

    return (
      <SalesChannelMark
        channel={getChannelType(channel)}
        size="sm"
        className="max-w-[120px]"
      />
    );
  };

  // 매칭된 재고(세트/단일) 렌더링
  const renderMatchedInventory = () => {
    if (matching.status !== 'matched') return null;

    // 세트상품
    if (setProductMappings && setSkuIds.length > 0) {
      if (isSkusLoading) {
        return <div className="text-sm text-gray-500">세트 구성 불러오는 중…</div>;
      }

      return (
        <div className="space-y-2">
          {setProductMappings.map((mapping: any, idx) => {
            const skuInfo = (skusMap as any)?.[mapping.skuId];
            const barcode = (skuInfo as any)?.defaultBarcode || '바코드 없음';
            const displayName = (skuInfo as any)?.name || mapping.skuName;

            return (
              <div key={idx} className="text-sm">
                <div className="text-green-600 font-medium">
                  {displayName}
                  {mapping.quantity > 1 && <span className="ml-1">×{mapping.quantity}</span>}
                </div>
                <div className="text-gray-500 text-xs">바코드: {barcode}</div>
              </div>
            );
          })}
        </div>
      );
    }

    // 단일 SKU
    if (sku && firstMatchedSku) {
      return (
        <div className="text-sm">
          <div className="text-green-600 font-medium">
            {(sku as any).name}
            {firstMatchedSku.quantity > 1 && (
              <span className="ml-1">×{firstMatchedSku.quantity}</span>
            )}
          </div>
          <div className="text-gray-500 text-xs">바코드: {(sku as any).defaultBarcode || '바코드 없음'}</div>
        </div>
      );
    }

    return null;
  };

  return (
    <tr className="hover:bg-gray-50 border-b">
      <td className="px-4 py-4">
        <Checkbox checked={isSelected} onCheckedChange={(checked) => onRowSelect(matching.id, !!checked)} />
      </td>
      <td className="px-4 py-4 text-sm text-gray-900">{totalCount - index}</td>
      <td className="px-4 py-4">
        <div className="flex items-center space-x-3">
          {getSellerIcon(orderMeta.salesChannel || 'default')}
          <div className="flex-1">
            <div className="text-sm text-gray-500">
              주문번호: {orderNumber}
              {typeof matching.orderCount === 'number' && matching.orderCount > 1 && (
                <span className="ml-2 text-orange-600">(총 {matching.orderCount}건)</span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="space-y-1">
          <div className="font-medium">{productName}</div>
          <div className="text-sm text-gray-500">- {option}</div>
          <div className="text-sm text-gray-500">수량: {quantity}개</div>
          <div className="text-sm text-gray-500">판매금액: {salesAmount.toLocaleString()}원</div>
          <div className="text-sm text-gray-500">수령자: {recipient}</div>
        </div>
      </td>
      <td className="px-4 py-4">
        {/* 케이스 1: PIM에 등록되지 않은 상품 (외부채널 상품 등록) */}
        {!variant && matching.status === 'pending' && (
          <div className="space-y-2">
            <div className="text-sm text-red-500">상품 없음</div>
            <Button
              size="sm"
              className="bg-red-500 hover:bg-red-600 text-white"
              onClick={() => onProductRegistration(matching)}
            >
              상품등록
            </Button>
          </div>
        )}

        {/* 케이스 2: PIM 등록되었지만 매칭 안된 상품 (재고매칭 버튼) */}
        {variant && matching.status === 'pending' && (
          <div className="space-y-2">
            <div className="text-sm text-orange-500">매칭 재고상품 없음</div>
            <Button
              size="sm"
              className="bg-yellow-500 hover:bg-yellow-600 text-white"
              onClick={() => onInventoryMatching(matching)}
            >
              재고매칭
            </Button>
          </div>
        )}

        {/* 케이스 3: 이미 매칭된 상품 (매칭수정, 매칭삭제 버튼) */}
        {matching.status === 'matched' && (
          <div className="space-y-2">
            {renderMatchedInventory()}
            <div className="flex space-x-1">
              <Button size="sm" variant="outline" onClick={() => onRematch(matching)}>
                재매칭
              </Button>
              <Button size="sm" variant="outline" onClick={() => onMatchEdit(matching)}>
                매칭수정
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700"
                onClick={() => onMatchDelete(matching)}
              >
                매칭삭제
              </Button>
            </div>
          </div>
        )}

        {/* 케이스 4: 무시된 상품 (전자책 등) */}
        {matching.status === 'ignored' && (
          <div className="space-y-2">
            <div className="text-sm text-gray-500">재고 불필요 상품</div>
            <Button size="sm" variant="outline" onClick={() => onProductRegistration(matching)}>
              상품 생성
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

// 매칭 테이블 메인 컴포넌트
export function MatchingTable({ data, isLoading, error }: MatchingTableProps) {
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showInventoryDialog, setShowInventoryDialog] = useState(false);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [currentMatching, setCurrentMatching] = useState<MatchingDto | null>(null);

  // 전체 variantId 일괄 조회 (N+1 방지)
  const variantIds = useMemo(() => [...new Set(data.map((m) => m.variantId).filter(Boolean))], [data]);
  const { data: variantMap } = useVariantsBatch(variantIds);

  const handleRowSelect = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedRows(newSelected);
  };

  const handleInventoryMatching = (matching: MatchingDto) => {
    setCurrentMatching(matching);
    setShowInventoryDialog(true);
  };

  const handleProductRegistration = (matching: MatchingDto) => {
    setCurrentMatching(matching);
    setShowProductDialog(true);
  };

  const handleRematch = (matching: MatchingDto) => {
    console.log('재매칭:', matching);
  };

  const handleMatchEdit = (matching: MatchingDto) => {
    setCurrentMatching(matching);
    setShowInventoryDialog(true);
  };

  const handleMatchDelete = (matching: MatchingDto) => {
    console.log('매칭삭제:', matching);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">오류가 발생했습니다: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <Checkbox
                    checked={selectedRows.size === data.length && data.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedRows(new Set(data.map((item) => item.id)));
                      } else {
                        setSelectedRows(new Set());
                      }
                    }}
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">번호</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  판매처/주문번호
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상품정보</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  매칭상태/액션
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((matching, index) => (
                <MatchingRow
                  key={matching.id}
                  matching={matching}
                  index={index}
                  totalCount={data.length}
                  variantInfo={variantMap?.get(matching.variantId)}
                  onInventoryMatching={handleInventoryMatching}
                  onProductRegistration={handleProductRegistration}
                  onRematch={handleRematch}
                  onMatchEdit={handleMatchEdit}
                  onMatchDelete={handleMatchDelete}
                  onRowSelect={handleRowSelect}
                  isSelected={selectedRows.has(matching.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 새 창으로 열기 */}
      {showInventoryDialog && currentMatching && (
        <div>
          {(() => {
            const newWindow = window.open(
              `/dialog/inventory-matching?matchingId=${currentMatching.id}`,
              '_blank',
              'width=1200,height=800,scrollbars=yes,resizable=yes'
            );
            if (newWindow) {
              setShowInventoryDialog(false);
              setCurrentMatching(null);
            }
            return null;
          })()}
        </div>
      )}

      {showProductDialog && currentMatching && (
        <ProductRegistrationDialog
          isOpen={showProductDialog}
          matching={currentMatching}
          onClose={() => {
            setShowProductDialog(false);
            setCurrentMatching(null);
          }}
        />
      )}
    </div>
  );
}
