'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useTransferJob, useTransferJobStatus } from '@/lib/services/inventory';
import type { TransferJobWithLineCountDto } from '@/lib/types/dto/inventory';

type Props = {
  row: TransferJobWithLineCountDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  in_progress: '진행 중',
  completed: '완료',
};

export function TransferDetailDrawer({ row, open, onOpenChange }: Props) {
  const { data: detail, isLoading: isDetailLoading } = useTransferJob(row?.id ?? '');
  const { data: status } = useTransferJobStatus(row?.id ?? '');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:w-[620px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            이동 작업 상세
            {row && (
              <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                {row.id.slice(0, 8)}…
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {status && (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium mb-1">실행 상태</p>
              <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                <div>
                  <p className="text-xs">상태</p>
                  <p className="font-medium text-foreground">
                    {STATUS_LABELS[status.status] ?? status.status}
                  </p>
                </div>
                <div>
                  <p className="text-xs">전체 라인</p>
                  <p className="tabular-nums font-medium text-foreground">{status.total}</p>
                </div>
                <div>
                  <p className="text-xs">완료 / 대기</p>
                  <p className="tabular-nums font-medium text-foreground">
                    {status.executed} / {status.pending}
                  </p>
                </div>
              </div>
            </div>
          )}

          {row && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <p className="font-medium">작업 정보</p>
              <p className="text-muted-foreground">창고 ID: <span className="font-mono text-xs">{row.warehouseId}</span></p>
              <p className="text-muted-foreground">총 수량: <span className="tabular-nums text-foreground">{row.totalQuantity.toLocaleString('ko-KR')}</span></p>
              {row.memo && <p className="text-muted-foreground">메모: {row.memo}</p>}
              <p className="text-muted-foreground">생성일시: {new Date(row.createdAt).toLocaleString('ko-KR')}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium mb-2">이동 라인</p>
            {isDetailLoading && (
              <p className="text-sm text-muted-foreground">불러오는 중...</p>
            )}
            {!isDetailLoading && (!detail?.lines || detail.lines.length === 0) && (
              <p className="text-sm text-muted-foreground">라인 정보가 없습니다.</p>
            )}
            {!isDetailLoading && detail?.lines && detail.lines.length > 0 && (
              <ul className="space-y-2">
                {detail.lines.map((line) => (
                  <li key={line.id} className="rounded-md border p-3 text-sm space-y-1">
                    <p className="font-mono text-xs text-muted-foreground">SKU: {line.skuId}</p>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>출발: <span className="font-mono">{line.fromLocationId ?? '-'}</span></span>
                      <span>→</span>
                      <span>도착: <span className="font-mono">{line.toLocationId ?? '-'}</span></span>
                    </div>
                    <p className="tabular-nums">수량: {line.quantity.toLocaleString('ko-KR')}</p>
                    {line.memo && <p className="text-xs text-muted-foreground">{line.memo}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
