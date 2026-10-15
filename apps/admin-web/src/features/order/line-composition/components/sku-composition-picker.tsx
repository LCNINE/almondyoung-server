'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button, FormInput, FormNumberInput, FormSelect } from '@/components/common';
import { useSkuSearch } from '@/lib/services/inventory';
import { cn } from '@/lib/utils/cn';
import type { PickedSku } from '../picked-skus';

function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** 고른 SKU 와 판매 1개당 수량 — 상품매칭 수동 탭과 «이 주문만» 다이얼로그가 같이 쓴다 */
export function PickedSkuList({
  value,
  onRemove,
  onQuantityChange,
  emptyText = '현재 매칭된 재고상품이 없습니다.',
}: {
  emptyText?: string;
  value: PickedSku[];
  onRemove: (skuId: string) => void;
  onQuantityChange: (skuId: string, value: number) => void;
}) {
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm border border-dashed rounded-lg">
          {emptyText}
        </div>
      ) : (
        value.map((sku) => (
          <div key={sku.skuId} className="bg-white border rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{sku.skuName}</div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <FormNumberInput
                  className="w-12 h-7 text-center text-xs"
                  value={String(sku.quantity)}
                  onChange={(e) => onQuantityChange(sku.skuId, Number(e.target.value))}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (isNaN(v) || v < 1) onQuantityChange(sku.skuId, 1);
                  }}
                  min={1}
                  step={1}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-red-600 hover:bg-red-50 text-xs"
                  onClick={() => onRemove(sku.skuId)}
                >
                  삭제
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/** 재고상품 검색 입력과 결과 표. 검색어는 부모가 든다(부모가 판매상품명으로 프리필한다) */
export function SkuSearchPanel({
  query,
  onQueryChange,
  suggestedQuery,
  picked,
  onAdd,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  suggestedQuery?: string;
  picked: PickedSku[];
  onAdd: (sku: { id: string; name: string }) => void;
}) {
  const [searchType, setSearchType] = useState('name');
  const debounced = useDebounced(query, 350);
  const { data: skuResults, isLoading: searching } = useSkuSearch(debounced, 1, 20);
  // 서버가 이미 거른다 — 클라이언트는 추가로 거르지 않는다
  const results = skuResults?.items ?? [];

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <FormSelect
          options={[{ value: 'name', label: '재고 상품명' }]}
          value={searchType || 'name'}
          onValueChange={setSearchType}
          className="w-40"
        />
        <div className="flex-1 relative">
          <FormInput
            placeholder="재고 상품명으로 검색"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="pr-10"
          />
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
        <Button
          className="bg-orange-500 hover:bg-orange-600 text-white px-4"
          onClick={() => {
            // 검색은 useSkuSearch 가 디바운스된 검색어로 자동 실행한다
          }}
        >
          찾기
        </Button>
        {suggestedQuery && (
          <Button variant="outline" onClick={() => onQueryChange(suggestedQuery)}>
            판매상품명으로 검색
          </Button>
        )}
      </div>

      <div className="bg-white border rounded-lg">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-700">등록</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-700">재고상품 명</th>
              <th className="text-center px-4 py-2 text-xs font-medium text-gray-700">공급처</th>
            </tr>
          </thead>
          <tbody>
            {searching ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                </td>
              </tr>
            ) : results.length > 0 ? (
              results.map((sku) => {
                const isLinked = picked.some((s) => s.skuId === sku.id);
                return (
                  <tr key={sku.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Button
                        size="sm"
                        variant={isLinked ? 'outline' : 'primary'}
                        className={cn(
                          'h-7 px-3 text-xs',
                          isLinked ? 'text-gray-500' : 'bg-orange-500 hover:bg-orange-600 text-white'
                        )}
                        onClick={() => !isLinked && onAdd({ id: sku.id, name: sku.name })}
                        disabled={isLinked}
                      >
                        {isLinked ? '등록됨' : '등록'}
                      </Button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{sku.name}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {/* 검색 응답은 suppliers 배열이다 — 옛 코드의 sku.supplier 는 늘 비어 «자체제작»만 보였다 */}
                      <div className="text-sm text-gray-600">{sku.suppliers[0]?.name ?? '자체제작'}</div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-500">
                  {debounced ? '검색 결과가 없습니다.' : '검색어를 입력해주세요'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 페이지 네이션 */}
        <div className="text-center py-2 border-t">
          <span className="text-xs text-gray-400">페이지 네이션</span>
        </div>
      </div>
    </div>
  );
}
