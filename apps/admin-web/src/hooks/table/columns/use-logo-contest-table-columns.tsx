import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { DateCell } from '@/components/table/table-cells/common';
import { EntryActions } from '@/features/logo-contest/components/entry-actions';
import { EntryAuthor } from '@/features/logo-contest/components/entry-author';
import { EntryDescription } from '@/features/logo-contest/components/entry-description';
import { EntryMediaPreview } from '@/features/logo-contest/components/entry-media-preview';
import {
  AdminLogoContestEntryDto,
  LOGO_CONTEST_STATUS_LABELS,
} from '@/lib/types/dto/logo-contest';

const columnHelper = createColumnHelper<AdminLogoContestEntryDto>();

export const useLogoContestTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.display({
        id: 'media',
        header: '이미지',
        cell: ({ row }) => (
          <EntryMediaPreview
            title={row.original.title}
            mediaFileIds={row.original.mediaFileIds}
          />
        ),
      }),
      columnHelper.accessor('title', {
        header: '작품명',
        cell: ({ getValue }) => (
          <span className="text-sm font-medium">{getValue()}</span>
        ),
      }),
      columnHelper.accessor('description', {
        header: '설명',
        cell: ({ getValue }) => <EntryDescription description={getValue()} />,
      }),
      columnHelper.display({
        id: 'author',
        header: '작성자',
        cell: ({ row }) => (
          <EntryAuthor
            userId={row.original.userId}
            maskedName={row.original.authorName}
          />
        ),
      }),
      columnHelper.accessor('voteCount', {
        header: '득표수',
        cell: ({ getValue }) => (
          <span className="font-medium tabular-nums">
            {getValue().toLocaleString('ko-KR')}
          </span>
        ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const status = getValue();
          return (
            <Badge variant={status === 'active' ? 'default' : 'secondary'}>
              {LOGO_CONTEST_STATUS_LABELS[status]}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('isWinner', {
        header: '수상 결과',
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge>대상</Badge>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      }),
      columnHelper.accessor('createdAt', {
        header: '등록 시각',
        cell: ({ getValue }) => <DateCell value={getValue()} withTime />,
      }),
      columnHelper.display({
        id: 'actions',
        header: '관리',
        cell: ({ row }) => <EntryActions entry={row.original} />,
      }),
    ],
    []
  );
};
