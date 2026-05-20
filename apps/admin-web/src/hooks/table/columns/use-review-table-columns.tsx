import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ReviewDto } from '@/lib/types/dto/review';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import {
  ReviewStatusCell,
  ReviewRatingCell,
  ReviewCommentStatusCell,
} from '@/components/table/table-cells/review';
import { Copy } from '@/components/admin-ui-experimental/common/copy/copy';

const columnHelper = createColumnHelper<ReviewDto>();

export interface ReviewProductSummary {
  masterId: string;
  name: string;
  thumbnail: string | null;
}

export interface ReviewAuthorSummary {
  id: string;
  username: string;
  nickname: string | null;
}

interface ReviewTableColumnContext {
  productMap: Map<string, ReviewProductSummary>;
  userMap: Map<string, ReviewAuthorSummary>;
}

export const useReviewTableColumns = ({
  productMap,
  userMap,
}: ReviewTableColumnContext) => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'author',
        header: '작성자',
        cell: ({ row }) => {
          const { legacy_author_name, userId } = row.original;
          if (legacy_author_name) {
            return <span>{legacy_author_name}</span>;
          }
          if (userId) {
            const user = userMap.get(userId);
            const displayName = user?.nickname ?? user?.username;
            if (displayName) {
              return <span>{displayName}</span>;
            }
            return <IdCell value={userId} />;
          }
          return <span className="text-muted-foreground">-</span>;
        },
      }),
      columnHelper.display({
        id: 'product',
        header: '상품',
        cell: ({ row }) => {
          const { productId } = row.original;
          const product = productMap.get(productId);
          if (product?.name) {
            return (
              <div className="flex items-center gap-1.5">
                <span
                  className="line-clamp-1 cursor-pointer text-sm hover:underline"
                  title="리뷰 상세로 이동"
                >
                  {product.name}
                </span>
                <Copy
                  content={productId}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                />
              </div>
            );
          }
          return <IdCell value={productId} />;
        },
      }),
      columnHelper.accessor('rating', {
        header: '별점',
        cell: ({ getValue }) => <ReviewRatingCell value={getValue()} />,
      }),
      columnHelper.accessor('content', {
        header: '내용',
        cell: ({ getValue }) => {
          const content = getValue() ?? '';
          const trimmed =
            content.length > 40 ? `${content.slice(0, 40)}…` : content;
          return <span className="line-clamp-1">{trimmed}</span>;
        },
      }),
      columnHelper.display({
        id: 'hasComment',
        header: '답글',
        cell: ({ row }) => (
          <ReviewCommentStatusCell hasComment={!!row.original.adminComment} />
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ row }) => (
          <ReviewStatusCell
            status={row.original.status}
            deletedAt={row.original.deletedAt}
          />
        ),
      }),
      columnHelper.accessor('createdAt', {
        header: '작성일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    [productMap, userMap]
  );
};
