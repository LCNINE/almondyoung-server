'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useInboundWorkLogs } from '@/lib/services/inventory';
import type { InboundReceiptDto, InboundReceiptLineDto } from '@/lib/types/dto/inventory';
import { PutawayDialog } from '../../line-action-menu/putaway-dialog';
import { ReturnDialog } from '../../line-action-menu/return-dialog';
import { CancelDialog } from '../../line-action-menu/cancel-dialog';
import { MemoDialog } from '../../line-action-menu/memo-dialog';

const METHOD_LABELS: Record<string, string> = {
  individual: '개별입고',
  simple: '간편입고',
  simple_fullscan: '전수조사',
  planned: '예정입고',
};

const WORK_LOG_TYPE_LABELS: Record<string, string> = {
  INBOUND: '입고',
  PUTAWAY: '적치',
  RETURN: '회송',
  CANCEL: '취소',
};

type LineAction = 'putaway' | 'return' | 'cancel' | 'memo';

type Props = {
  row: InboundReceiptDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReceiptDetailDrawer({ row, open, onOpenChange }: Props) {
  const [activeLine, setActiveLine] = useState<InboundReceiptLineDto | null>(null);
  const [activeAction, setActiveAction] = useState<LineAction | null>(null);

  const { data: workLogs } = useInboundWorkLogs(
    row
      ? { warehouseId: row.warehouseId, limit: 50, offset: 0 }
      : undefined
  );

  const openAction = (line: InboundReceiptLineDto, action: LineAction) => {
    setActiveLine(line);
    setActiveAction(action);
  };

  const closeAction = () => {
    setActiveLine(null);
    setActiveAction(null);
  };

  if (!row) return null;

  const lines: InboundReceiptLineDto[] = (row as unknown as { lines?: InboundReceiptLineDto[]; line?: InboundReceiptLineDto }).lines
    ?? ((row as unknown as { line?: InboundReceiptLineDto }).line ? [(row as unknown as { line: InboundReceiptLineDto }).line] : []);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>입고 상세</SheetTitle>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <span className="text-muted-foreground">입고 방식</span>
              <Badge variant="outline">{METHOD_LABELS[row.method] ?? row.method}</Badge>
              <span className="text-muted-foreground">상태</span>
              <span>{row.status}</span>
              <span className="text-muted-foreground">총 수량</span>
              <span className="font-medium">{row.totalQuantity.toLocaleString()}</span>
              <span className="text-muted-foreground">입고 일시</span>
              <span>{new Date(row.occurredAt).toLocaleString('ko-KR')}</span>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">입고 라인</span>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">라인 정보 없음</p>
              ) : (
                lines.map((line) => (
                  <div key={line.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex flex-col gap-0.5 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">{line.skuId.substring(0, 8)}…</span>
                        <span>수량: {line.quantity} | 회송: {line.returnedQty} | 취소: {line.canceledQty} | 적치: {line.putawayFromOriginQty}</span>
                        {line.memo && <span className="text-xs text-muted-foreground">메모: {line.memo}</span>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => openAction(line, 'putaway')}>적치</Button>
                        <Button size="sm" variant="outline" onClick={() => openAction(line, 'return')}>회송</Button>
                        <Button size="sm" variant="outline" onClick={() => openAction(line, 'cancel')}>취소</Button>
                        <Button size="sm" variant="ghost" onClick={() => openAction(line, 'memo')}>메모</Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {workLogs && workLogs.items.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">작업 로그</span>
                  <div className="flex flex-col gap-1">
                    {workLogs.items.map((log) => (
                      <div key={log.id} className="flex items-center gap-2 py-0.5 text-sm">
                        <Badge variant="outline" className="shrink-0 text-xs">
                          {WORK_LOG_TYPE_LABELS[log.type] ?? log.type}
                        </Badge>
                        <span className="font-medium">{log.quantity}개</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.occurredAt).toLocaleString('ko-KR')}
                        </span>
                        {log.memo && <span className="text-xs text-muted-foreground">{log.memo}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <PutawayDialog
        line={activeLine}
        open={activeAction === 'putaway'}
        onOpenChange={(o) => { if (!o) closeAction(); }}
      />
      <ReturnDialog
        line={activeLine}
        open={activeAction === 'return'}
        onOpenChange={(o) => { if (!o) closeAction(); }}
      />
      <CancelDialog
        line={activeLine}
        open={activeAction === 'cancel'}
        onOpenChange={(o) => { if (!o) closeAction(); }}
      />
      <MemoDialog
        line={activeLine}
        open={activeAction === 'memo'}
        onOpenChange={(o) => { if (!o) closeAction(); }}
      />
    </>
  );
}
