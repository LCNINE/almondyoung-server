'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuditLogs } from '@/lib/services/products';
import { Table } from '@/components/admin-ui-experimental/common/table/table';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { HistoryDrawer } from '../history-drawer';
import {
  ACTION_LABELS,
  ProductThumbnail,
  useUserNames,
} from '../../audit-display';
import type { AuditLogItemDto } from '@/lib/types/dto/products';

const PAGE_SIZE = 20;

const ACTION_OPTIONS = [
  { label: '전체', value: 'all' },
  ...Object.entries(ACTION_LABELS).map(([value, label]) => ({ label, value })),
];

const ACTION_BADGE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  created: 'default',
  published: 'default',
  updated: 'secondary',
  exposure_updated: 'secondary',
  unpublished: 'destructive',
  deleted: 'destructive',
  hard_deleted: 'destructive',
  master_deleted: 'destructive',
};

export function AuditLogTable() {
  const [action, setAction] = useState('all');
  const [drawerItem, setDrawerItem] = useState<AuditLogItemDto | null>(null);

  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditLogs({
    page,
    limit: PAGE_SIZE,
    action: action === 'all' ? undefined : action,
  });
  const logs = data?.data;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const userName = useUserNames((logs ?? []).map((item) => item.userId));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select
          value={action}
          onValueChange={(value) => {
            setAction(value);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">로딩 중...</p>}

      {!isLoading && (!logs || logs.length === 0) && (
        <p className="text-sm text-muted-foreground">감사 로그가 없습니다.</p>
      )}

      <div className="divide-y rounded-lg border">
        {logs?.map((item) => (
          <button
            key={item.id}
            className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
            onClick={() => setDrawerItem(item)}
          >
            <ProductThumbnail fileId={item.productThumbnail} />
            <div className="min-w-0 flex-1">
              <p
                className="truncate text-sm font-medium"
                title={item.productId ?? undefined}
              >
                {item.productName ?? '알 수 없는 상품'}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge
                  variant={ACTION_BADGE[item.action] ?? 'outline'}
                  className="text-xs"
                >
                  {ACTION_LABELS[item.action] ?? item.action}
                </Badge>
                <span className="truncate text-xs text-muted-foreground">
                  작업자: {userName(item.userId)}
                </span>
              </div>
            </div>
            <DateCell value={item.createdAt} />
          </button>
        ))}
      </div>

      {data && data.total > 0 && (
        <Table.Pagination
          className="rounded-b-lg"
          count={data.total}
          pageSize={PAGE_SIZE}
          pageIndex={page - 1}
          pageCount={totalPages}
          canPreviousPage={page > 1}
          canNextPage={page < totalPages}
          previousPage={() => setPage(page - 1)}
          nextPage={() => setPage(page + 1)}
          goPage={(index) => setPage(index + 1)}
        />
      )}

      <HistoryDrawer item={drawerItem} onClose={() => setDrawerItem(null)} />
    </div>
  );
}
