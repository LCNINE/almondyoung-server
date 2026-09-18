'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useProductAuditHistory } from '@/lib/services/products';
import { DateCell } from '@/components/table/table-cells/common';
import { ACTION_LABELS } from '../audit-log-table';

function formatValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

interface Props {
  masterId: string | null;
  onClose: () => void;
}

export function HistoryDrawer({ masterId, onClose }: Props) {
  const { data, isLoading } = useProductAuditHistory(masterId ?? '');

  return (
    <Sheet open={!!masterId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>변경 이력</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3 overflow-y-auto">
          {isLoading && (
            <p className="text-sm text-muted-foreground">로딩 중...</p>
          )}
          {!isLoading && (!data || data.length === 0) && (
            <p className="text-sm text-muted-foreground">이력이 없습니다.</p>
          )}
          {data?.map((item) => (
            <div key={item.id} className="rounded-lg border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">
                  {ACTION_LABELS[item.action] ?? item.action}
                </span>
                <DateCell value={item.createdAt} />
              </div>
              <p className="text-xs text-muted-foreground">
                작업자: {item.userId}
              </p>
              {item.changes && Object.keys(item.changes).length > 0 && (
                <div className="mt-2 space-y-1">
                  {Object.entries(item.changes).map(([field, diff]) => (
                    <div key={field} className="text-xs">
                      <span className="font-medium text-foreground">
                        {field}
                      </span>
                      :{' '}
                      <span className="text-destructive line-through">
                        {formatValue(diff?.old)}
                      </span>{' '}
                      →{' '}
                      <span className="text-green-600">
                        {formatValue(diff?.new)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
