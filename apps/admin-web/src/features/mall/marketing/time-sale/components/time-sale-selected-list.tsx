'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TimeSaleRow } from '../time-sale-model';

/**
 * 이 세일에 담긴 상품 목록.
 *
 * 아래 검색 표는 한 페이지만 보여주므로, 담긴 상품이 다른 페이지에 있으면 화면에서 사라진다.
 * 수정 화면에선 그게 "무엇을 고치는 중인지 모르는" 상태가 된다 — 담긴 것은 항상 여기 보인다.
 */
export function TimeSaleSelectedList({
  rows,
  isLoading,
  onRemove,
}: {
  rows: TimeSaleRow[];
  isLoading: boolean;
  onRemove: (productId: string) => void;
}) {
  const products = new Map<string, { title: string; variants: number }>();
  for (const row of rows) {
    const found = products.get(row.productId);
    if (found) found.variants += 1;
    else products.set(row.productId, { title: row.productTitle, variants: 1 });
  }

  if (products.size === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
        {isLoading ? '불러오는 중…' : '아직 담은 상품이 없습니다. 아래에서 검색해 고르세요.'}
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <div className="bg-muted flex items-center justify-between px-3 py-2 text-xs font-medium">
        <span>담긴 상품 {products.size}개</span>
        <span className="text-muted-foreground">품목 {rows.length}개</span>
      </div>
      <ul className="max-h-56 divide-y overflow-y-auto">
        {Array.from(products.entries()).map(([productId, product]) => (
          <li key={productId} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{product.title}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              품목 {product.variants}개
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${product.title} 제외`}
              onClick={() => onRemove(productId)}
            >
              <X className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
