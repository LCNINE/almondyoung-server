'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MedusaProductItem } from '@/lib/api/domains/medusa/catalog';
import { useMedusaProductSearch, useTimeSaleVariantMap } from '@/lib/services/time-sale';

const PAGE_SIZE = 20;

/** 이 상품이 이미 걸려 있는 세일 이름. 없으면 null. */
const runningSaleOf = (
  product: MedusaProductItem,
  variantMap: Map<string, string> | undefined
): string | null => {
  if (!variantMap) return null;
  for (const variant of product.variants ?? []) {
    const title = variantMap.get(variant.id);
    if (title) return title;
  }
  return null;
};

export function TimeSaleProductPicker({
  selectedIds: selectedIdList,
  onToggle,
  onToggleMany,
  /** 편집 중인 세일 이름. 그 세일에 걸린 상품은 "진행 중" 으로 막지 않는다 — 자기 자신이다. */
  ignoreSaleTitle,
}: {
  selectedIds: string[];
  onToggle: (productId: string) => void;
  onToggleMany: (productIds: string[], next: boolean) => void;
  ignoreSaleTitle?: string;
}) {
  const [keyword, setKeyword] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [page, setPage] = useState(1);

  const { data, isFetching } = useMedusaProductSearch({
    keyword: submitted,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: variantMap } = useTimeSaleVariantMap();

  const products = data?.products ?? [];
  const total = data?.count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedIds = new Set(selectedIdList);

  const blockingSaleOf = (product: MedusaProductItem) => {
    const title = runningSaleOf(product, variantMap);
    return title && title !== ignoreSaleTitle ? title : null;
  };

  // 이미 다른 세일에 걸린 상품은 고를 수 없다. 같은 품목이 두 세일에 걸리면 Medusa 가 한쪽
  // 가격만 적용해, 손님이 A 목록에서 B 가격을 보게 된다.
  const selectable = products.filter((product) => !blockingSaleOf(product));
  const allChecked =
    selectable.length > 0 && selectable.every((product) => selectedIds.has(product.id));

  const search = () => {
    setPage(1);
    setSubmitted(keyword.trim());
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                search();
              }
            }}
            placeholder="상품명으로 검색"
            className="pl-9"
          />
        </div>
        <Button type="button" variant="outline" onClick={search} disabled={isFetching}>
          검색
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  disabled={selectable.length === 0}
                  onCheckedChange={(checked) =>
                    onToggleMany(
                      selectable.map((product) => product.id),
                      checked === true
                    )
                  }
                  aria-label="이 페이지 전체 선택"
                />
              </TableHead>
              <TableHead className="w-16">이미지</TableHead>
              <TableHead>상품명</TableHead>
              <TableHead className="w-40">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-10 text-center text-sm">
                  {isFetching ? '불러오는 중…' : '상품이 없습니다.'}
                </TableCell>
              </TableRow>
            )}

            {products.map((product) => {
              const running = blockingSaleOf(product);
              const checked = selectedIds.has(product.id);

              return (
                <TableRow
                  key={product.id}
                  className={running ? 'opacity-60' : 'cursor-pointer'}
                  onClick={() => !running && onToggle(product.id)}
                >
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={checked}
                      disabled={Boolean(running)}
                      onCheckedChange={() => onToggle(product.id)}
                      aria-label={product.title}
                    />
                  </TableCell>
                  <TableCell>
                    {product.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.thumbnail}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="bg-muted h-10 w-10 rounded" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{product.title}</TableCell>
                  <TableCell>
                    {running ? (
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {running} 진행 중
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          전체 {total.toLocaleString('ko-KR')}개 · {selectedIdList.length}개 선택됨
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => prev - 1)}
          >
            이전
          </Button>
          <span className="text-muted-foreground tabular-nums">
            {page} / {lastPage}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= lastPage}
            onClick={() => setPage((prev) => prev + 1)}
          >
            다음
          </Button>
        </div>
      </div>
    </div>
  );
}
