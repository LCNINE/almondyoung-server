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
import { VariantPreviewCell } from '@/components/table/table-cells/variant-preview-cell';
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
  /** 매칭 편집 창을 연다. 없으면 기능 칸에 매칭하기를 그리지 않는다. */
  onEditMatching?: (row: MasterSummaryDto) => void;
};

export function useProductsListTableColumns({
  totalCount,
  pageIndex,
  pageSize,
  onEditMatching,
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
        // 폭을 정하지 않은 유일한 글 열이라 좁은 화면(~900px)에서 한 글자 폭까지 눌렸다 — 최소 폭을 두고 표가 가로로 스크롤되게.
        meta: { align: 'left', minWidth: 200 },
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
        header: '품목',
        meta: { width: 260, align: 'left' },
        cell: ({ row }) => (
          <VariantPreviewCell
            optionGroupNames={row.original.optionGroupNames}
            variantCount={row.original.variantCount}
            variantPreviews={row.original.variantPreviews ?? []}
          />
        ),
      }),
      columnHelper.accessor('unlinkedVariantCount', {
        header: 'SKU 연결',
        meta: { width: 120 },
        cell: ({ row }) => {
          const { unlinkedVariantCount, variantCount } = row.original;

          if (!unlinkedVariantCount) return null;

          return (
            <span className="whitespace-nowrap text-[13px] font-bold text-[#b91c1c]">
              {unlinkedVariantCount >= variantCount
                ? `${variantCount}개 모두 안 됨`
                : `${variantCount}개 중 ${unlinkedVariantCount}개 안 됨`}
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
          if (status === 'active') {
            return (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[#374151]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" aria-hidden="true" />
                판매중
              </span>
            );
          }
          const label = STATUS_LABELS[status] ?? status;
          const variant = status === 'draft' ? 'secondary' : 'outline';
          return <Badge variant={variant}>{label}</Badge>;
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: '기능',
        meta: { width: 96 },
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
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
            {onEditMatching && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditMatching(row.original);
                }}
              >
                매칭하기
              </Button>
            )}
          </div>
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
    [router, totalCount, pageIndex, pageSize, onEditMatching]
  );
}
