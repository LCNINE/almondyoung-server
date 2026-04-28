'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { usePurchaseOrder, useUpdatePurchaseOrderStatus } from '@/lib/services/inventory';
import type { PurchaseOrderDto, PurchaseOrderStatus } from '@/lib/types/dto/inventory';
import { AuditActionBar } from '../audit-action-bar';
import { PurchaseOrderFormDialog } from '../purchase-order-form-dialog';
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

  const updateStatusMutation = useUpdatePurchaseOrderStatus();

  const handleStatusChange = async (newStatus: PurchaseOrderStatus) => {
    if (!po) return;
    try {
      await updateStatusMutation.mutateAsync({ id: po.id, data: { status: newStatus } });
      toast.success('상태가 변경되었습니다.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '상태 변경에 실패했습니다.');
    }
  };

  if (!po) return null;

  const canEditLines = po.status === 'created' || po.status === 'confirmed';
  const canChangeStatus = po.auditStatus === 'approved';

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[520px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>발주 상세</SheetTitle>
          </SheetHeader>

          <div className="space-y-5">
            {/* 요약 */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">기본 정보</p>
              <InfoRow label="발주번호" value={po.id} />
              <InfoRow label="공급처" value={po.supplier?.name ?? po.supplierId ?? undefined} />
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">유형</span>
                <Badge variant="outline">{po.type === 'domestic' ? '국내' : '해외'}</Badge>
              </div>
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">운영 상태</span>
                <Badge variant="secondary">{STATUS_LABELS[po.status]}</Badge>
              </div>
              <div className="flex gap-2 py-1 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">심사 상태</span>
                <Badge variant={po.auditStatus === 'approved' ? 'default' : 'outline'}>
                  {po.auditStatus === 'draft' ? '초안' :
                    po.auditStatus === 'pending_audit' ? '심사중' : '승인됨'}
                </Badge>
              </div>
              {po.expectedArrival && (
                <InfoRow label="입고 예정일" value={new Date(po.expectedArrival).toLocaleDateString('ko-KR')} />
              )}
            </section>

            <Separator />

            {/* 심사 액션 */}
            <section>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">심사</p>
              <AuditActionBar po={po} />
            </section>

            {/* 상태 변경 (승인 후만 활성) */}
            {canChangeStatus && (
              <>
                <Separator />
                <section>
                  <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">운영 상태 변경</p>
                  <Select
                    value={po.status}
                    onValueChange={(v) => handleStatusChange(v as PurchaseOrderStatus)}
                    disabled={updateStatusMutation.isPending}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created">생성됨</SelectItem>
                      <SelectItem value="confirmed">확정됨</SelectItem>
                      <SelectItem value="received">입고완료</SelectItem>
                    </SelectContent>
                  </Select>
                </section>
              </>
            )}

            <Separator />

            {/* 라인 목록 */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-muted-foreground">발주 라인</p>
                {canEditLines && (
                  <Button size="sm" variant="outline" onClick={() => setEditLinesOpen(true)}>
                    라인 수정
                  </Button>
                )}
              </div>
              {po.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">라인 없음</p>
              ) : (
                <div className="space-y-2">
                  {po.lines.map((line, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{line.sku?.name ?? line.skuId}</div>
                      <div className="mt-1 flex gap-4 text-muted-foreground">
                        <span>수량: {line.quantity}</span>
                        {line.unitPrice != null && <span>단가: {line.unitPrice.toLocaleString('ko-KR')}원</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
