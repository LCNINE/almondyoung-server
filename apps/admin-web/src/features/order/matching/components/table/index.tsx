// src/features/order/matching/components/table/index.tsx
'use client';

import React, { useMemo, useState } from 'react';
import type { OrderLineDto } from '@/lib/types/dto/orders';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ProductRegistrationDialog } from './ProductRegistrationDialog';
import { InventoryMatchingDialog } from './InventoryMatchingDialog';
import { useVariantsBatch } from '@/lib/services/products';
import type { BatchVariantInfo } from '@/lib/api/domains/products/variants.client';
import {
  SalesChannelMark,
  type SalesChannelType,
} from '@/components/common/sales-channel-mark';
import { Skeleton } from '@/components/ui/skeleton';
import { useChangeMatchingStrategy } from '@/lib/services/matching';
import { RefreshCw } from 'lucide-react';

interface MatchingTableProps {
  data: OrderLineDto[];
  isLoading: boolean;
  error: Error | null;
}

// WMS salesChannelEnum → SalesChannelType
function toChannelType(salesChannel: string): SalesChannelType {
  switch (salesChannel) {
    case 'medusa':
      return 'almondyoung';
    case 'naver':
      return 'naver_smartstore';
    case 'coupang':
      return 'coupang';
    case '3pl':
      return 'phone_order';
    default:
      return 'other';
  }
}

// ────────────────────────────────────────────────────────────
// 매칭 셀 렌더 (오른쪽 칼럼 전체 내용)
// ────────────────────────────────────────────────────────────
function MatchingContent({
  line,
  onInventoryMatching,
  onProductRegistration,
  onResolveAsVoid,
  isResolvingAsVoid,
}: {
  line: OrderLineDto;
  onInventoryMatching: (line: OrderLineDto) => void;
  onProductRegistration: (line: OrderLineDto) => void;
  onResolveAsVoid: (matchingId: string) => void;
  isResolvingAsVoid: boolean;
}) {
  // 외부채널 + PIM 미등록 → 상품 생성 필요
  if (!line.matchingId && line.salesChannel !== 'medusa') {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-red-500 font-bold text-sm">상품 없음</span>
        <Button
          size="sm"
          onClick={() => onProductRegistration(line)}
          className="bg-gray-800 hover:bg-gray-900 text-white h-7 px-3 text-xs"
        >
          상품 생성
        </Button>
      </div>
    );
  }

  // 전략 미결정 (matchingId 없거나 pending)
  if (
    !line.matchingId ||
    !line.matchingStatus ||
    line.matchingStatus === 'pending'
  ) {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-red-500 font-bold text-sm">전략 미결정</span>
        <Button
          size="sm"
          onClick={() => onInventoryMatching(line)}
          className="bg-orange-500 hover:bg-orange-600 text-white h-7 px-3 text-xs flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          SKU 구성 매칭
        </Button>
      </div>
    );
  }

  // 전략 결정 완료 (matched)
  if (line.matchingStatus === 'matched') {
    if (line.matchingStrategy === 'void') {
      return (
        <div className="flex items-center gap-3 py-1">
          <span className="text-gray-500 text-sm">재고상품 비매칭</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onInventoryMatching(line)}
            className="h-7 px-3 text-xs flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            SKU 구성 매칭
          </Button>
        </div>
      );
    }

    if (line.matchingStrategy !== 'variant') {
      return (
        <div className="flex items-center gap-3 py-1">
          <span className="text-orange-600 text-sm">전략 미결정</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onInventoryMatching(line)}
            className="h-7 px-3 text-xs flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            SKU 구성 매칭
          </Button>
        </div>
      );
    }

    if (line.matchedSkus.length === 0) {
      return (
        <div className="flex items-center gap-3 py-1">
          <span className="text-orange-600 text-sm">SKU 구성 매칭 불완전</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onInventoryMatching(line)}
            className="h-7 px-3 text-xs flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            SKU 구성 매칭
          </Button>
        </div>
      );
    }

    return (
      <div className="space-y-0">
        {/* 각 SKU 행 */}
        {line.matchedSkus.map((sku) => (
          <div
            key={sku.skuId}
            className="py-1 border-b border-gray-100 last:border-b-0"
          >
            {/* SKU 이름 + 버튼 */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-800">
                {sku.skuName}
                {sku.quantity > 1 && (
                  <span className="text-gray-500 ml-1 text-xs">
                    (수량: ×{sku.quantity})
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onInventoryMatching(line)}
                  className="h-6 px-2 text-xs flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  SKU 재매칭
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onInventoryMatching(line)}
                  className="h-6 px-2 text-xs"
                >
                  SKU 구성 수정
                </Button>
              </div>
            </div>
            {/* 바코드/수량 정보 */}
            <div className="text-xs text-gray-500 mt-0.5">
              • 주문수량 × {sku.quantity} = {line.quantity * sku.quantity}
              {sku.skuCode && (
                <span className="ml-2">[바코드: {sku.skuCode}]</span>
              )}
            </div>
          </div>
        ))}
        {/* 재고상품 비매칭 전환 + 가격 */}
        <div className="flex items-center gap-3 pt-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => line.matchingId && onResolveAsVoid(line.matchingId)}
            disabled={isResolvingAsVoid}
            className="h-6 px-2 text-xs text-gray-600 border-gray-300"
          >
            재고상품 비매칭
          </Button>
          {line.unitPrice != null && (
            <span className="text-xs text-gray-500">
              판매가: {line.unitPrice.toLocaleString()}원
            </span>
          )}
        </div>
      </div>
    );
  }

  // 레거시 ignored는 완료가 아니라 감사 대상으로 노출한다.
  if (line.matchingStatus === 'ignored') {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-gray-500 text-sm">레거시 감사 대상</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onInventoryMatching(line)}
          className="h-7 px-3 text-xs flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          SKU 구성 매칭
        </Button>
      </div>
    );
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// 행 컴포넌트 — Fragment로 2개의 <tr> 반환
// ────────────────────────────────────────────────────────────
function OrderLineRows({
  line,
  index,
  totalCount,
  variantInfo,
  isSelected,
  onRowSelect,
  onInventoryMatching,
  onProductRegistration,
  onResolveAsVoid,
  isResolvingAsVoid,
}: {
  line: OrderLineDto;
  index: number;
  totalCount: number;
  variantInfo?: BatchVariantInfo;
  isSelected: boolean;
  onRowSelect: (id: string, checked: boolean) => void;
  onInventoryMatching: (line: OrderLineDto) => void;
  onProductRegistration: (line: OrderLineDto) => void;
  onResolveAsVoid: (matchingId: string) => void;
  isResolvingAsVoid: boolean;
}) {
  const displayName =
    variantInfo?.masterName || line.productName || '상품명 없음';
  const optionLabel =
    variantInfo?.optionLabel || variantInfo?.variantName || '';

  return (
    <>
      {/* ── 메인 행 ── */}
      <tr className="bg-white">
        {/* 체크박스 + 번호 (rowspan=2) */}
        <td
          rowSpan={2}
          className="px-3 py-3 border-b border-gray-200 align-top w-12"
        >
          <div className="flex flex-col items-center gap-1.5">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onRowSelect(line.id, !!checked)}
            />
            <span className="text-xs text-gray-500 font-medium">
              {totalCount - index}
            </span>
          </div>
        </td>

        {/* 채널 마크 (rowspan=2) */}
        <td
          rowSpan={2}
          className="px-3 py-3 border-b border-gray-200 align-top w-[130px]"
        >
          <SalesChannelMark
            channel={toChannelType(line.salesChannel)}
            size="sm"
          />
        </td>

        {/* 상품명 + 옵션 */}
        <td className="px-4 pt-3 pb-1 align-top">
          <div className="font-medium text-sm text-gray-900 leading-snug">
            {displayName}
          </div>
          {optionLabel && (
            <div className="text-xs text-gray-500 mt-0.5">- {optionLabel}</div>
          )}
        </td>

        {/* 매칭 셀 (rowspan=2) */}
        <td
          rowSpan={2}
          className="px-4 py-3 border-b border-gray-200 align-top w-[380px] border-l border-l-gray-100"
        >
          <MatchingContent
            line={line}
            onInventoryMatching={onInventoryMatching}
            onProductRegistration={onProductRegistration}
            onResolveAsVoid={onResolveAsVoid}
            isResolvingAsVoid={isResolvingAsVoid}
          />
        </td>
      </tr>

      {/* ── 주문 상세 행 ── */}
      <tr className="bg-white">
        <td className="px-4 pb-3 pt-1 border-b border-gray-200 align-top">
          <div className="text-xs">
            <span className="text-gray-400">주문번호</span>{' '}
            <span className="text-blue-600 underline cursor-pointer hover:text-blue-800">
              {line.channelOrderId}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5 space-x-2">
            <span>수량: {line.quantity}개</span>
            {line.totalPrice != null && (
              <span>판매금액: {line.totalPrice.toLocaleString()}원</span>
            )}
            {line.customerName && (
              <span>수령자/주문자: {line.customerName}</span>
            )}
          </div>
        </td>
      </tr>
    </>
  );
}

// ────────────────────────────────────────────────────────────
// 메인 테이블 컴포넌트
// ────────────────────────────────────────────────────────────
export function MatchingTable({ data, isLoading, error }: MatchingTableProps) {
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showInventoryDialog, setShowInventoryDialog] = useState(false);
  const [showProductDialog, setShowProductDialog] = useState(false);
  const [currentLine, setCurrentLine] = useState<OrderLineDto | null>(null);

  const changeMatchingStrategy = useChangeMatchingStrategy();
  const isResolvingAsVoid = changeMatchingStrategy.isPending;

  const variantIds = useMemo(
    () => [...new Set(data.map((l) => l.variantId).filter(Boolean))],
    [data]
  );
  const { data: variantMap } = useVariantsBatch(variantIds);

  const handleRowSelect = (id: string, checked: boolean) => {
    const next = new Set(selectedRows);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    setSelectedRows(next);
  };

  const handleInventoryMatching = (line: OrderLineDto) => {
    setCurrentLine(line);
    setShowInventoryDialog(true);
  };

  const handleProductRegistration = (line: OrderLineDto) => {
    setCurrentLine(line);
    setShowProductDialog(true);
  };

  const handleResolveAsVoid = async (matchingId: string) => {
    if (
      !confirm(
        '현재 SKU 구성을 삭제하고 재고상품 비매칭 전략으로 변경하시겠습니까?'
      )
    )
      return;
    await changeMatchingStrategy.mutateAsync({
      id: matchingId,
      data: { strategy: 'void' },
    });
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 border rounded-lg bg-white">
        <div className="text-red-500 text-sm">
          오류가 발생했습니다: {error.message}
        </div>
      </div>
    );
  }

  const SKELETON_ROWS = 8;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-3 w-12">
                <Checkbox
                  checked={selectedRows.size === data.length && data.length > 0}
                  onCheckedChange={(checked) => {
                    setSelectedRows(
                      checked ? new Set(data.map((l) => l.id)) : new Set()
                    );
                  }}
                />
              </th>
              <th className="px-3 py-3 text-center text-xs font-medium text-gray-600 w-[130px]">
                판매처명
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-600">
                판매처상품명
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 w-[380px] border-l border-l-gray-100">
                매칭상품명 / 수량
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <React.Fragment key={`skeleton-${i}`}>
                  <tr className="bg-white">
                    <td
                      rowSpan={2}
                      className="px-3 py-3 border-b border-gray-200 align-top w-12"
                    >
                      <Skeleton className="h-4 w-4 mx-auto mb-1" />
                      <Skeleton className="h-3 w-4 mx-auto" />
                    </td>
                    <td
                      rowSpan={2}
                      className="px-3 py-3 border-b border-gray-200 align-top"
                    >
                      <Skeleton className="h-8 w-24 mx-auto" />
                    </td>
                    <td className="px-4 pt-3 pb-1">
                      <Skeleton className="h-4 w-48 mb-1" />
                      <Skeleton className="h-3 w-24" />
                    </td>
                    <td
                      rowSpan={2}
                      className="px-4 py-3 border-b border-gray-200 align-top w-[380px]"
                    >
                      <Skeleton className="h-6 w-32 mb-2" />
                      <Skeleton className="h-6 w-20" />
                    </td>
                  </tr>
                  <tr className="bg-white">
                    <td className="px-4 pb-3 pt-1 border-b border-gray-200">
                      <Skeleton className="h-3 w-36 mb-1" />
                      <Skeleton className="h-3 w-48" />
                    </td>
                  </tr>
                </React.Fragment>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-16 text-center text-gray-400 text-sm"
                >
                  데이터가 없습니다. 필터 조건을 설정하고 검색 버튼을
                  눌러주세요.
                </td>
              </tr>
            ) : (
              data.map((line, index) => (
                <OrderLineRows
                  key={line.id}
                  line={line}
                  index={index}
                  totalCount={data.length}
                  variantInfo={variantMap?.get(line.variantId)}
                  isSelected={selectedRows.has(line.id)}
                  onRowSelect={handleRowSelect}
                  onInventoryMatching={handleInventoryMatching}
                  onProductRegistration={handleProductRegistration}
                  onResolveAsVoid={handleResolveAsVoid}
                  isResolvingAsVoid={isResolvingAsVoid}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 재고 생성/매칭 다이얼로그 */}
      <InventoryMatchingDialog
        isOpen={showInventoryDialog}
        line={currentLine}
        onClose={() => {
          setShowInventoryDialog(false);
          setCurrentLine(null);
        }}
      />

      {/* 외부채널 상품 등록 다이얼로그 */}
      <ProductRegistrationDialog
        isOpen={showProductDialog}
        line={currentLine}
        onClose={() => {
          setShowProductDialog(false);
          setCurrentLine(null);
        }}
      />
    </div>
  );
}
