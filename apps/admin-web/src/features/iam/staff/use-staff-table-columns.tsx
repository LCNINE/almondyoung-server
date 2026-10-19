'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { DateCell, IdCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import type { AdminUserDto } from '@/lib/types/dto/user';
import { ExpiryBadge } from '../components/expiry-badge';

const columnHelper = createColumnHelper<AdminUserDto>();

export const useStaffTableColumns = () =>
  useMemo(
    () => [
      columnHelper.display({
        id: 'select',
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
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('loginId', { header: '로그인ID' }),
      columnHelper.accessor('username', { header: '이름' }),
      columnHelper.display({
        id: 'staffRoles',
        header: '역할',
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {(row.original.staffRoles ?? []).map((r) => (
              <span key={r.name} className="inline-flex items-center gap-1">
                <Badge variant="secondary">{r.displayName}</Badge>
                <ExpiryBadge expiresAt={r.expiresAt} />
              </span>
            ))}
          </div>
        ),
      }),
      columnHelper.accessor('email', { header: '이메일' }),
      columnHelper.accessor('lastActivityAt', {
        header: '최근 활동일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
      columnHelper.accessor('createdAt', {
        header: '가입일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
