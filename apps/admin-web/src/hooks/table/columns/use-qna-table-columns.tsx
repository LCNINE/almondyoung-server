import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { QuestionDto } from '@/lib/types/dto/qna';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import {
  QnaStatusCell,
  QnaCategoryCell,
  QnaSecretCell,
} from '@/components/table/table-cells/qna';

const columnHelper = createColumnHelper<QuestionDto>();

export interface QnaAuthorSummary {
  id: string;
  username: string;
  nickname: string | null;
}

interface QnaTableColumnContext {
  userMap: Map<string, QnaAuthorSummary>;
  // 문의 대상 상품 masterId → 상품명 매핑 (상품 문의가 아니면 productId 자체가 null)
  productMap: Map<string, string>;
}

export const useQnaTableColumns = ({
  userMap,
  productMap,
}: QnaTableColumnContext) => {
  return useMemo(
    () => [
      columnHelper.accessor('userId', {
        header: '유저 ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.display({
        id: 'author',
        header: '작성자',
        // 작성 당시 스냅샷된 nickname 이 아니라 회원의 이름(username)을 우선 표시.
        // 조회 실패(탈퇴 등) 시 스냅샷 nickname 으로 fallback.
        cell: ({ row }) => {
          const { userId, nickname } = row.original;
          const displayName = userMap.get(userId)?.username || nickname;
          return <span>{displayName || '-'}</span>;
        },
      }),
      columnHelper.display({
        id: 'product',
        header: '문의 상품',
        // productId(=masterId)는 상품 문의에만 존재. 일반 문의(계정/배송 등)는 null → '-'.
        cell: ({ row }) => {
          const { productId } = row.original;
          if (!productId) return <span className="text-gray-400">-</span>;
          const name = productMap.get(productId);
          return (
            <span className="line-clamp-1 text-sm" title={productId}>
              {name ?? productId}
            </span>
          );
        },
      }),
      columnHelper.accessor('category', {
        header: '카테고리',
        cell: ({ getValue }) => <QnaCategoryCell value={getValue()} />,
      }),
      columnHelper.accessor('title', { header: '제목' }),
      columnHelper.accessor('isSecret', {
        header: '비밀글',
        cell: ({ getValue }) => <QnaSecretCell value={getValue()} />,
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ row }) => (
          <QnaStatusCell
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
    [userMap, productMap]
  );
};
