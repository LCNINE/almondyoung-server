'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { MasterSummaryDto } from '@/lib/types/dto/products';
import { Checkbox } from '@/components/ui/checkbox';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ProductThumbnailCell } from '@/components/table/table-cells/product-thumbnail-cell';
import { SupplierCell } from '@/components/table/table-cells/supplier-cell';
import { ShortId } from '@/components/admin-ui-experimental/common/copy/short-id';

const columnHelper = createColumnHelper<MasterSummaryDto>();

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

const won = (v: number) => v.toLocaleString('ko-KR');

const priceRange = (min: number, max: number) =>
  min === max ? won(min) : `${won(min)} ~ ${won(max)}`;

type Options = {
  /** 행 번호는 전체 건수에서 역순으로 매긴다 (피그마: 최신이 9967). */
  totalCount: number;
  pageIndex: number;
  pageSize: number;
};

export function useProductsListTableColumns({
  totalCount,
  pageIndex,
  pageSize,
}: Options) {
  const router = useRouter();

  return useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        meta: { clickTogglesRowSelection: true, width: 48 },
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            aria-label="전체 선택"
            onClick={(e) => e.stopPropagation()}
            className="size-5 border-2 border-neutral-400 bg-white"
          />
        ),
        // 표시 전용 — 선택 토글은 DataTableRoot 의 셀 onClick(meta.clickTogglesRowSelection)이 담당한다.
        cell: ({ row }) => (
          <div className="flex flex-col items-center gap-1">
            <Checkbox
              checked={row.getIsSelected()}
              aria-label="행 선택"
              className="pointer-events-none size-5 border-2 border-neutral-400 bg-white"
            />
            <span className="text-xs tabular-nums">
              {totalCount - pageIndex * pageSize - row.index}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('productCode', {
        header: '품번코드',
        meta: { width: 104 },
        cell: ({ getValue, row }) => {
          const code = getValue();
          // 품번코드 미부여 상품은 masterId 앞자리로 대체한다.
          return code ? (
            <span className="tabular-nums">{code}</span>
          ) : (
            <ShortId value={row.original.masterId} />
          );
        },
      }),
      columnHelper.accessor('thumbnail', {
        header: '이미지',
        meta: { width: 72 },
        cell: ({ getValue }) => <ProductThumbnailCell thumbnail={getValue()} />,
      }),
      columnHelper.accessor('name', {
        header: () => (
          <>
            <p>상품명</p>
            <p>브랜드 명</p>
          </>
        ),
        meta: { align: 'left' },
        cell: ({ row }) => (
          <div className="flex flex-col gap-1 text-left">
            <p className="text-base font-medium text-[#1e40ae] underline break-words">
              {row.original.name}
            </p>
            <p className="text-[#757575]">{row.original.brand ?? '-'}</p>
          </div>
        ),
      }),
      columnHelper.accessor('variantCount', {
        header: '옵션제목/옵션수',
        meta: { width: 104 },
        cell: ({ row }) => {
          const { optionGroupNames, variantCount } = row.original;
          if (optionGroupNames.length === 0) {
            return <span className="text-[#1e3a89]">단일상품</span>;
          }
          return (
            <span className="text-[#1e3a89]">
              <span className="underline">{optionGroupNames.join(' / ')}</span>
              {` / ${variantCount}`}
            </span>
          );
        },
      }),
      columnHelper.accessor('supplierId', {
        header: '공급처',
        meta: { width: 112 },
        cell: ({ getValue }) => <SupplierCell supplierId={getValue()} />,
      }),
      columnHelper.accessor('priceSummary', {
        header: () => (
          <>
            <p>판매가</p>
            <p>멤버십가</p>
            <p>공급가</p>
          </>
        ),
        meta: { width: 131, align: 'right' },
        cell: ({ getValue, row }) => {
          const summary = getValue();
          if (!summary) return <span>-</span>;
          return (
            <div className="flex flex-col font-medium tabular-nums">
              <span className="text-[#3f6212]">
                {priceRange(summary.minBasePrice, summary.maxBasePrice)}
              </span>
              <span className="text-[#a86500]">
                {priceRange(
                  summary.minMembershipPrice,
                  summary.maxMembershipPrice
                )}
                {row.original.hideMembershipPriceForNonMembers && ' (숨김)'}
              </span>
              {/* 공급가 없음은 0원이 아니라 미입력이다. */}
              {row.original.supplyPrice == null ? (
                <span className="text-muted-foreground">-</span>
              ) : (
                <span className="text-[#b81c1c]">
                  {won(row.original.supplyPrice)}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: '상태',
        meta: { width: 74 },
        cell: ({ row }) => {
          const { status, soldOutState } = row.original;

          if (
            status === 'active' &&
            (soldOutState === 'all' || soldOutState === 'partial')
          ) {
            return (
              <Badge variant="destructive">
                {soldOutState === 'all' ? '품절' : '부분품절'}
              </Badge>
            );
          }
          const label = STATUS_LABELS[status] ?? status;
          const variant =
            status === 'active'
              ? 'default'
              : status === 'draft'
                ? 'secondary'
                : 'outline';
          return <Badge variant={variant}>{label}</Badge>;
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '기능',
        meta: { width: 88 },
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/mall/pricing/${row.original.masterId}`);
            }}
          >
            가격 관리
          </Button>
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: () => (
          <>
            <p>등록일시</p>
            <p>수정일시</p>
          </>
        ),
        meta: { width: 168 },
        cell: ({ row }) => (
          <div className="flex flex-col">
            <DateCell value={row.original.createdAt} withTime />
            <span className="text-[#757575]">
              <DateCell value={row.original.updatedAt} withTime />
            </span>
          </div>
        ),
      }),
    ],
    [router, totalCount, pageIndex, pageSize]
  );
}
