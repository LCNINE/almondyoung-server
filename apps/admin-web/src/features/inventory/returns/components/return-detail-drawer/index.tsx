'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useReturn } from '@/lib/services/inventory';
import type { ReturnDto, ReturnStatus } from '@/lib/types/dto/inventory';
import { ReceiveReturnDialog } from '../receive-return-dialog';
import { InspectReturnDialog } from '../inspect-return-dialog';
import { ProcessReturnDialog } from '../process-return-dialog';

const STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: '회수 요청',
  received: '입고 완료',
  qc_passed: 'QC 통과',
  qc_failed: 'QC 실패',
  disposed: '처리 완료',
};

const STATUS_VARIANTS: Record<ReturnStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  requested: 'outline',
  received: 'secondary',
  qc_passed: 'default',
  qc_failed: 'destructive',
  disposed: 'secondary',
};

function InfoRow({ label, value }: { label: string; value?: string | null | number }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span>{String(value)}</span>
    </div>
  );
}

type Props = {
  row: ReturnDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReturnDetailDrawer({ row, open, onOpenChange }: Props) {
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [processOpen, setProcessOpen] = useState(false);

  const { data: detail } = useReturn(row?.id ?? '');
  const current = detail ?? row;

  if (!current) return null;

  const status = current.status as ReturnStatus;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[480px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>회수 상세</SheetTitle>
          </SheetHeader>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANTS[status] ?? 'outline'}>
                {STATUS_LABELS[status] ?? status}
              </Badge>
            </div>

            <section className="space-y-0.5">
              <InfoRow label="회수 ID" value={current.id} />
              <InfoRow label="주문 ID" value={current.orderId} />
              <InfoRow label="출하 ID" value={current.shipmentId} />
              <InfoRow label="창고 ID" value={current.warehouseId} />
              <InfoRow label="반품 사유" value={current.returnReason} />
              <InfoRow label="재입고 수량" value={current.restockQuantity} />
              <InfoRow label="폐기 수량" value={current.disposeQuantity} />
              <InfoRow label="QC 검사자" value={current.qcInspectedBy} />
              <InfoRow label="QC 메모" value={current.qcNotes} />
            </section>

            {current.items && current.items.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">아이템 목록</p>
                <div className="space-y-2">
                  {current.items.map((item) => (
                    <div key={item.id} className="rounded border p-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-mono text-xs text-muted-foreground">{item.skuId.substring(0, 8)}…</span>
                        <Badge variant="outline" className="text-xs">{item.qcStatus ?? '대기'}</Badge>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-1 text-xs text-muted-foreground">
                        <span>요청: {item.requestedQuantity}</span>
                        <span>입고: {item.receivedQuantity ?? '-'}</span>
                        <span>QC통과: {item.qcPassedQuantity ?? '-'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex flex-col gap-2 pt-2">
              {status === 'requested' && (
                <Button onClick={() => setReceiveOpen(true)}>입고 처리</Button>
              )}
              {status === 'received' && (
                <Button onClick={() => setInspectOpen(true)}>QC 검수</Button>
              )}
              {(status === 'qc_passed' || status === 'qc_failed') && (
                <Button onClick={() => setProcessOpen(true)}>처리 (재입고/폐기)</Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ReceiveReturnDialog
        returnId={current.id}
        items={current.items ?? []}
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
      />
      <InspectReturnDialog
        returnId={current.id}
        items={current.items ?? []}
        open={inspectOpen}
        onOpenChange={setInspectOpen}
      />
      <ProcessReturnDialog
        returnId={current.id}
        items={current.items ?? []}
        open={processOpen}
        onOpenChange={setProcessOpen}
      />
    </>
  );
}
