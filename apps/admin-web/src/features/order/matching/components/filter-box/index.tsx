// src/features/order/matching/components/filter-box/index.tsx
'use client';

import React from 'react';
import { useMatchingFilter } from '../../contexts/filter.context';
import {
  FormField,
  FormSelect,
  FormInput,
  FormCheckbox,
  FormRadioGroup,
  FormDateRangePicker
} from '@/components/common';
import { Button } from '@/components/common/button';

const SALES_CHANNEL_OPTIONS = [
  { value: 'all', label: '판매처 전체' },
  { value: 'medusa', label: '자사몰 (Medusa)' },
  { value: 'naver', label: '네이버 스마트스토어' },
  { value: 'coupang', label: '쿠팡' },
  { value: '3pl', label: '3PL' },
];

const KEYWORD_TYPE_OPTIONS = [
  { value: 'sellerProductName', label: '판매처 상품명' },
  { value: 'orderNumber', label: '주문번호' },
  { value: 'customerName', label: '고객명' },
];

const DATE_TYPE_OPTIONS = [
  { value: 'today', label: '오늘' },
  { value: 'custom', label: '임의기간' },
];

export function FilterBox() {
  const { filters, setFilters, applySearch } = useMatchingFilter();

  const handleSearch = () => {
    applySearch();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      applySearch();
    }
  };

  return (
    <div className="space-y-4">
      {/* 필터박스 */}
      <div className="border border-[#C6C6C6] rounded-[10px] bg-[#F5F5F5] p-8">
        <div className="space-y-6">
          {/* 판매처 */}
          <FormField
            label="판매처"
            direction="horizontal"
            className="items-start"
            labelClassName="w-[90px] pt-1.5"
          >
            <div className="flex gap-2.5">
              <FormSelect
                options={SALES_CHANNEL_OPTIONS}
                placeholder="판매처 전체"
                value={filters.sellerCategory || 'all'}
                onValueChange={(value) =>
                  setFilters({ sellerCategory: value === 'all' ? undefined : value })
                }
                className="w-[220px]"
              />
            </div>
          </FormField>

          {/* 주문일자 */}
          <FormField
            label="주문일자"
            direction="horizontal"
            className="items-start"
            labelClassName="w-[90px] pt-1.5"
          >
            <div className="space-y-3 flex-1">
              <FormRadioGroup
                options={DATE_TYPE_OPTIONS}
                value={filters.dateType}
                onValueChange={(value) => setFilters({ dateType: value as 'today' | 'custom' })}
                orientation="horizontal"
              />
              {filters.dateType === 'custom' && (
                <FormDateRangePicker
                  value={
                    filters.startDate && filters.endDate
                      ? { from: new Date(filters.startDate), to: new Date(filters.endDate) }
                      : undefined
                  }
                  onChange={(range) =>
                    setFilters({
                      startDate: range?.from ? range.from.toISOString().split('T')[0] : undefined,
                      endDate: range?.to ? range.to.toISOString().split('T')[0] : undefined,
                    })
                  }
                  placeholder="날짜 범위를 선택하세요"
                />
              )}
            </div>
          </FormField>

          {/* 키워드 */}
          <FormField
            label="키워드"
            direction="horizontal"
            className="items-start"
            labelClassName="w-[90px] pt-1.5"
          >
            <div className="flex gap-2.5 flex-1">
              <FormSelect
                options={KEYWORD_TYPE_OPTIONS}
                placeholder="판매처 상품명"
                value={filters.keywordType}
                onValueChange={(value) =>
                  setFilters({ keywordType: value as 'sellerProductName' | 'orderNumber' | 'customerName' })
                }
                className="w-[136px]"
              />
              <FormInput
                placeholder="키워드를 입력하세요"
                value={filters.keyword || ''}
                onChange={(e) => setFilters({ keyword: e.target.value })}
                onKeyDown={handleKeyDown}
                className="flex-1"
              />
            </div>
          </FormField>

          {/* 체크박스들 */}
          <div className="flex items-center gap-6 pl-[90px]">
            <FormCheckbox
              label="매칭완료 제외"
              checked={filters.excludeMatched}
              onCheckedChange={(checked) => setFilters({ excludeMatched: !!checked })}
            />
            <FormCheckbox
              label="취소주문 표시"
              checked={filters.showCanceledOrders}
              onCheckedChange={(checked) => setFilters({ showCanceledOrders: !!checked })}
            />
            <FormCheckbox
              label="발송완료 건 제외"
              checked={filters.excludeShipped}
              onCheckedChange={(checked) => setFilters({ excludeShipped: !!checked })}
            />
          </div>
        </div>
      </div>

      {/* 검색 버튼 */}
      <div className="flex justify-center pt-4">
        <Button
          onClick={handleSearch}
          variant="primary"
          size="lg"
          className="px-8"
        >
          검색
        </Button>
      </div>
    </div>
  );
}
