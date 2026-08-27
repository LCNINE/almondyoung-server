'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePurchaseOrder, useCancelPurchaseOrder } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderStatus } from '@/lib/types/dto/inventory';
import { PurchaseOrderFormDialog } from '../purchase-order-form-dialog';
import { PurchaseOrderLineList } from '../line-list';
import { canExecuteLines, formatLineProgress, summarizeLines, toCalendarDate } from '../../line-execution-model';
import { toast } from 'sonner';

type Props = {
  row: PurchaseOrderDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  created: '생성됨',
  confirmed: '확정됨',
  received: '입고완료',
  cancelled: '취소됨',
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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const { data: detail } = usePurchaseOrder(row?.id ?? '');
  const cancelMutation = useCancelPurchaseOrder();
  const po = detail ?? row;

  if (!po) return null;

  const progress = summarizeLines(po.lines);
  // 요청 라인이 하나도 없으면 수정할 대상이 없다 — 새 SKU 를 얹는 것도
  // 종결된 발주에 요청 라인을 되살리는 셈이라 막는다.
  const canEditLines = canExecuteLines(po.status) && progress.requested > 0;
  // 입고가 시작된 발주는 취소가 아니라 잔량 포기로 닫는다 — core 가 409 로 막지만
  // 버튼을 숨겨 그 409 를 사용자가 만나지 않게 한다.
  const canCancel = po.status === 'created' || po.status === 'confirmed';

  const handleCancelOpenChange = (nextOpen: boolean) => {
    setCancelOpen(nextOpen);
    if (nextOpen) setCancelReason('');
  };

  const handleCancelSubmit = async () => {
    const reason = cancelReason.trim();
    if (!reason) {
      toast.error('취소 사유를 입력해주세요.');
      return;
    }
    try {
      await cancelMutation.mutateAsync({ poId: po.id, data: { reason } });
      toast.success('발주를 취소했습니다.');
      setCancelOpen(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '발주 취소에 실패했습니다.');
    }
  };

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
                  {/* progress.total === 0 이면 formatLineProgress 는 '라인 없음' 을 낸다.
                      PurchaseOrderLineList 도 라인이 없을 때 같은 문구를 자체적으로
                      낸다 — 여기서까지 렌더하면 화면에 '라인 없음' 이 두 번 뜬다. */}
                  {progress.total > 0 && (
                    <span className="text-xs text-muted-foreground">{formatLineProgress(progress)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {canEditLines && (
                    <Button size="sm" variant="outline" onClick={() => setEditLinesOpen(true)}>
                      라인 수정
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="destructive" onClick={() => setCancelOpen(true)}>
                      발주 취소
                    </Button>
                  )}
                </div>
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

      <Dialog open={cancelOpen} onOpenChange={handleCancelOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>발주 취소</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              이 발주를 취소합니다. <strong>되돌릴 수 없습니다.</strong> 이미 입고된 라인이
              있으면 취소할 수 없습니다 — 그때는 잔량 포기로 남은 라인을 닫아주세요.
            </p>

            <div className="flex flex-col gap-1">
              <Label htmlFor="cancel-po-reason">취소 사유 (필수, 500자 이내)</Label>
              <Textarea
                id="cancel-po-reason"
                maxLength={500}
                placeholder="오발주 / 중복 발주 등"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              닫기
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelSubmit}
              disabled={cancelMutation.isPending || !cancelReason.trim()}
            >
              {cancelMutation.isPending ? '처리 중…' : '발주 취소'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
