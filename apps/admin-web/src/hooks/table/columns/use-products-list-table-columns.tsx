'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageOff } from 'lucide-react';
import type { MasterSummaryDto } from '@/lib/types/dto/products';
import { Checkbox } from '@/components/ui/checkbox';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

const columnHelper = createColumnHelper<MasterSummaryDto>();

const STATUS_LABELS: Record<string, string> = {
  active: '활성',
  inactive: '판매중단',
  draft: '임시저장',
  archived: '보관',
};

function ProductThumbnailCell({
  thumbnail,
}: {
  thumbnail: string | null | undefined;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolvePublicFileUrl(thumbnail);
  const loadFailed = src !== null && failedSrc === src;

  if (!src || loadFailed) {
    return (
      <div className="mx-auto flex h-14 w-14 flex-col items-center justify-center rounded bg-muted text-muted-foreground">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span className="mt-0.5 text-[9px]">이미지 없음</span>
      </div>
    );
  }

  return (
    <div className="mx-auto h-14 w-14 overflow-hidden rounded bg-muted">
      <img
        src={src}
        alt="상품 이미지"
        className="h-full w-full object-cover"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}

export function useProductsListTableColumns() {
  const router = useRouter();

  return useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="전체 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="행 선택"
            onClick={(e) => e.stopPropagation()}
          />
        ),
      }),
      columnHelper.accessor('masterId', {
        header: '품번코드',
        cell: ({ getValue }) => (
          <span className="break-all text-xs text-muted-foreground">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('thumbnail', {
        header: '이미지',
        cell: ({ getValue }) => <ProductThumbnailCell thumbnail={getValue()} />,
      }),
      columnHelper.accessor('name', {
        header: '상품명/옵션/브랜드',
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <p className="break-words text-sm font-medium leading-tight text-blue-800">
              {row.original.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.original.optionGroupNames.join(' / ') || '-'}
            </p>
            <p className="text-xs text-muted-foreground">{row.original.brand ?? '-'}</p>
          </div>
        ),
      }),
      columnHelper.accessor('variantCount', {
        header: '옵션수',
        cell: ({ getValue }) => {
          const count = getValue();
          return (
            <span className="text-sm text-blue-900">
              {count > 0 ? `${count}개` : '단일상품'}
            </span>
          );
        },
      }),
      columnHelper.accessor('priceSummary', {
        header: '판매가/멤버십가',
        cell: ({ getValue }) => {
          const summary = getValue();
          if (!summary) return <div className="text-right text-sm">-</div>;
          const fmtRange = (min: number, max: number) =>
            min === max
              ? `${min.toLocaleString()}원`
              : `${min.toLocaleString()} ~ ${max.toLocaleString()}원`;
          return (
            <div className="space-y-0.5 text-right text-sm">
              <p className="font-medium">
                {fmtRange(summary.minBasePrice, summary.maxBasePrice)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtRange(summary.minMembershipPrice, summary.maxMembershipPrice)}
              </p>
            </div>
          );
        },
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const status = getValue();
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
      columnHelper.accessor('createdAt', {
        header: '등록일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '작업',
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
    ],
    [router]
  );
}
