'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuditRecent, useAuditByAction } from '@/lib/services/products';
import { DateCell } from '@/components/table/table-cells/common';
import { Badge } from '@/components/ui/badge';
import { HistoryDrawer } from '../history-drawer';

export const ACTION_LABELS: Record<string, string> = {
  created: '생성',
  updated: '수정',
  published: '발행',
  rolled_back: '이전 버전 재발행',
  unpublished: '판매 중단',
  exposure_updated: '노출 정책 변경',
  deleted: '삭제',
  restored: '복구',
  hard_deleted: '영구 삭제',
  master_deleted: '상품 삭제',
  master_restored: '상품 복구',
  bulk_updated: '일괄 수정',
  bulk_activated: '일괄 재공개',
};

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
  const [drawerMasterId, setDrawerMasterId] = useState<string | null>(null);

  const recent = useAuditRecent(100);
  const byAction = useAuditByAction(action === 'all' ? '' : action, 100);

  const logs = action === 'all' ? recent.data : byAction.data;
  const isLoading = action === 'all' ? recent.isLoading : byAction.isLoading;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={action} onValueChange={setAction}>
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
            className="flex w-full items-center justify-between p-3 text-left transition-colors hover:bg-muted/50"
            onClick={() => setDrawerMasterId(item.productId)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant={ACTION_BADGE[item.action] ?? 'outline'}
                  className="text-xs"
                >
                  {ACTION_LABELS[item.action] ?? item.action}
                </Badge>
                <span className="truncate text-xs text-muted-foreground">
                  상품 ID: {item.productId}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                작업자: {item.userId}
              </p>
            </div>
            <DateCell value={item.createdAt} />
          </button>
        ))}
      </div>

      <HistoryDrawer
        masterId={drawerMasterId}
        onClose={() => setDrawerMasterId(null)}
      />
    </div>
  );
}
