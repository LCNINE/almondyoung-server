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

export const useQnaTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('nickname', { header: '작성자' }),
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
    []
  );
};
