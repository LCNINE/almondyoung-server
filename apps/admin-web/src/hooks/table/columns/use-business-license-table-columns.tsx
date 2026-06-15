import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { IdCell, DateCell } from '@/components/table/table-cells/common';
import {
  BusinessLicenseDto,
  BusinessLicenseStatus,
  BUSINESS_LICENSE_STATUS_LABELS,
} from '@/lib/types/dto/business-licenses';

const columnHelper = createColumnHelper<BusinessLicenseDto>();

function statusVariant(
  status: BusinessLicenseStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'approved') return 'default';
  if (status === 'under_review') return 'secondary';
  return 'destructive';
}

export const useBusinessLicenseTableColumns = () => {
  return useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: ({ getValue }) => <IdCell value={getValue()} />,
      }),
      columnHelper.accessor('userId', {
        header: '사용자',
        cell: ({ row }) => {
          return (
            <div className="flex flex-col gap-0.5">
              <span>{row.original.userName ?? '-'}</span>
              <IdCell value={row.original.userId} />
            </div>
          );
        },
      }),
      columnHelper.accessor('businessNumber', {
        header: '사업자등록번호',
        cell: ({ getValue }) => (
          <span className="font-mono">{getValue() ?? '-'}</span>
        ),
      }),
      columnHelper.accessor('representativeName', {
        header: '대표자명',
        cell: ({ getValue }) => getValue() ?? '-',
      }),
      columnHelper.display({
        id: 'hasFile',
        header: '파일',
        cell: ({ row }) =>
          row.original.fileUrl ? (
            <Badge variant="outline">있음</Badge>
          ) : (
            <span className="text-xs text-muted-foreground">없음</span>
          ),
      }),
      columnHelper.accessor('status', {
        header: '상태',
        cell: ({ getValue }) => {
          const status = getValue();
          return (
            <Badge variant={statusVariant(status)}>
              {BUSINESS_LICENSE_STATUS_LABELS[status]}
            </Badge>
          );
        },
      }),
      columnHelper.accessor('createdAt', {
        header: '신청일',
        cell: ({ getValue }) => <DateCell value={getValue()} />,
      }),
    ],
    []
  );
};
