'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { usePurchaseOrder } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderStatus } from '@/lib/types/dto/inventory';
import { PurchaseOrderFormDialog } from '../purchase-order-form-dialog';
import { PurchaseOrderLineList } from '../line-list';
import { canExecuteLines, formatLineProgress, summarizeLines, toCalendarDate } from '../../line-execution-model';

type Props = {
  row: PurchaseOrderDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
};

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function PurchaseOrderDetailDrawer({ row, open, onOpenChange }: Props) {
  const [editLinesOpen, setEditLinesOpen] = useState(false);
  const { data: detail } = usePurchaseOrder(row?.id ?? '');
  const po = detail ?? row;

  if (!po) return null;

  const progress = summarizeLines(po.lines);
  // 요청 라인이 하나도 없으면 수정할 대상이 없다 — 새 SKU 를 얹는 것도
  // 종결된 발주에 요청 라인을 되살리는 셈이라 막는다.
  const canEditLines = canExecuteLines(po.status) && progress.requested > 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[640px] max-w-full overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>발주 상세</SheetTitle>
          </SheetHeader>

          <div className="space-y-5">
            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">기본 정보</p>
              <InfoRow label="발주번호" value={po.id} />
              <InfoRow label="공급처" value={po.supplier?.name ?? po.supplierId ?? undefined} />
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">유형</span>
                <Badge variant="outline">{po.type === 'domestic' ? '국내' : '해외'}</Badge>
              </div>
              {/* 상태는 라인에서 파생된 값이라 화면에서 바꾸지 않는다 (core refreshHeaderStatus).
                  옛 「운영 상태 변경」 드롭다운은 사실 일괄 실행이었고, 강등 선택지는
                  헤더를 파생값과 어긋난 채로 영구히 남겼다. 라인 실행이 그 자리를 대신한다. */}
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">운영 상태</span>
                <Badge variant="secondary">{STATUS_LABELS[po.status]}</Badge>
                {progress.requested > 0 && (
                  <span className="text-xs text-muted-foreground">
                    요청 남음 {progress.requested}건
                  </span>
                )}
              </div>
              <InfoRow label="입고 예정일" value={toCalendarDate(po.expectedArrival) || undefined} />
            </section>

            <Separator />

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">발주 라인</p>
                  <span className="text-xs text-muted-foreground">{formatLineProgress(progress)}</span>
                </div>
                {canEditLines && (
                  <Button size="sm" variant="outline" onClick={() => setEditLinesOpen(true)}>
                    라인 수정
                  </Button>
                )}
              </div>

              <PurchaseOrderLineList po={po} />
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <PurchaseOrderFormDialog
        open={editLinesOpen}
        onOpenChange={setEditLinesOpen}
        editLinesFor={po}
      />
    </>
  );
}
