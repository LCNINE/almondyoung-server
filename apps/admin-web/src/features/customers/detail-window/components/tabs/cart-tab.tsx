'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Package, ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils/ui';
import { useCustomerById } from '@/lib/services/customers';
import {
  useMedusaCustomerByEmail,
  useMedusaCustomerCart,
} from '@/lib/services/medusa-customers';
import type { CustomerCartItem } from '@/lib/types/dto/medusa';
import { formatDateTime } from '@/lib/utils/date';
import { formatCurrency } from '../../lib/order-labels';

const PAGE_SIZE = 10;

function getPageWindow(current: number, totalPages: number): number[] {
  const span = 5;
  let start = Math.max(1, current - Math.floor(span / 2));
  const end = Math.min(totalPages, start + span - 1);
  start = Math.max(1, end - span + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function StockCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-gray-400">-</span>;
  return (
    <span className={cn(value <= 0 && 'font-medium text-red-500')}>
      {value.toLocaleString()}
    </span>
  );
}

export function CartTab({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);

  const { data: customer, isLoading: isCustomerLoading } =
    useCustomerById(customerId);
  const email = customer?.email ?? '';

  const { data: medusaCustomerRes, isLoading: isMedusaCustomerLoading } =
    useMedusaCustomerByEmail(email);
  const medusaCustomerId = medusaCustomerRes?.customers?.[0]?.id;
  const {
    data: cartRes,
    isLoading: isCartLoading,
    isError: isCartError,
  } = useMedusaCustomerCart(medusaCustomerId);

  const items: CustomerCartItem[] = useMemo(
    () => cartRes?.items ?? [],
    [cartRes]
  );
  const currency = cartRes?.cart?.currency_code;
  const total = items.length;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = items.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  const isLoading =
    isCustomerLoading ||
    (!!email && (isMedusaCustomerLoading || isCartLoading));
  const isError = !!email && !isLoading && (isCartError || !medusaCustomerId);

  return (
    <section className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-800">
        <ShoppingCart className="text-indigo-500 size-4" />
        장바구니 정보
        {!isLoading && !isError && (
          <span className="text-xs font-normal text-gray-500">
            [총 {total.toLocaleString()}건]
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="py-2 space-y-2">
          <Skeleton className="w-full h-8" />
          <Skeleton className="w-full h-8" />
          <Skeleton className="w-full h-8" />
        </div>
      ) : isError ? (
        <div className="py-8 text-sm text-center text-red-400">
          장바구니 정보를 불러오지 못했습니다.
        </div>
      ) : total === 0 ? (
        <div className="py-12 text-sm text-center text-gray-400 border border-gray-100 rounded-md">
          검색결과가 없습니다.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">담은일자</TableHead>
                  <TableHead className="min-w-[200px]">상품정보</TableHead>
                  <TableHead className="w-32">옵션</TableHead>
                  <TableHead className="w-20 text-center">옵션재고</TableHead>
                  <TableHead className="w-20 text-center">총재고량</TableHead>
                  <TableHead className="text-center w-14">수량</TableHead>
                  <TableHead className="w-24 text-right">판매가</TableHead>
                  <TableHead className="w-20 text-center">품절옵션</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedItems.map((item) => (
                  <TableRow key={item.id} className="align-top">
                    <TableCell className="text-xs text-gray-600 whitespace-nowrap">
                      {formatDateTime(item.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {item.thumbnail ? (
                          // 외부 CDN(메두사) 이미지라 next/image 대신 img 사용
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnail}
                            alt={item.product_title ?? ''}
                            className="object-cover border rounded size-10 shrink-0"
                          />
                        ) : (
                          <div className="flex items-center justify-center text-gray-300 border rounded size-10 shrink-0 bg-gray-50">
                            <Package className="size-4" />
                          </div>
                        )}
                        <div className="min-w-0 text-xs leading-tight">
                          <div className="text-gray-900">
                            {item.product_title ?? '-'}
                          </div>
                          {item.variant_sku && (
                            <div className="text-gray-400">
                              ({item.variant_sku})
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-gray-600">
                      {item.variant_title ?? '-'}
                    </TableCell>
                    {item.manage_inventory === false ? (
                      <TableCell
                        colSpan={2}
                        className="text-xs text-center text-gray-400"
                      >
                        재고관리 안함
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-center text-gray-700">
                          <StockCell value={item.option_stock} />
                        </TableCell>
                        <TableCell className="text-center text-gray-700">
                          <StockCell value={item.total_stock} />
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-center text-gray-700">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-right text-gray-900">
                      {formatCurrency(item.unit_price, currency)}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.sold_out ? (
                        <Badge variant="destructive">품절</Badge>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 mt-4">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                aria-label="이전 페이지"
              >
                <ChevronLeft className="size-4" />
              </Button>
              {getPageWindow(safePage, totalPages).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="icon"
                  variant={p === safePage ? 'default' : 'outline'}
                  className="text-xs size-7"
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              ))}
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-7"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                aria-label="다음 페이지"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
