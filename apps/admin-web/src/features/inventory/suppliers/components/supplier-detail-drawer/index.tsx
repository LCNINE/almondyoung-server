'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useDeleteSupplier } from '@/lib/services/inventory';
import type { SupplierDto } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';
import { SupplierFormDialog } from '../supplier-form-dialog';

type Props = {
  row: SupplierDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function SupplierDetailDrawer({ row, open, onOpenChange }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const deleteMutation = useDeleteSupplier();

  const handleDelete = async () => {
    if (!row) return;
    if (!window.confirm(`"${row.name}" 공급처를 삭제하시겠습니까?`)) return;
    try {
      await deleteMutation.mutateAsync(row.id);
      toast.success('공급처가 삭제되었습니다.');
      onOpenChange(false);
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  if (!row) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[480px] overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{row.name}</SheetTitle>
          </SheetHeader>

          <div className="space-y-6">
            {row.categories.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">분류</p>
                <div className="flex flex-wrap gap-1">
                  {row.categories.map((c) => (
                    <span key={c.id} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {c.name}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {row.contact && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">연락처</p>
                <InfoRow label="전화번호" value={row.contact.phone} />
                <InfoRow label="팩스" value={row.contact.fax} />
                <InfoRow label="이메일" value={row.contact.email} />
              </section>
            )}

            {row.address && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">주소</p>
                <InfoRow label="우편번호" value={row.address.zipcode} />
                <InfoRow label="주소" value={row.address.address1} />
                <InfoRow label="상세주소" value={row.address.address2} />
              </section>
            )}

            {row.businessInfo && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">사업자 정보</p>
                <InfoRow label="사업자등록번호" value={row.businessInfo.businessRegNo} />
                <InfoRow label="업태/종목" value={row.businessInfo.businessType} />
                <InfoRow label="대표자명" value={row.businessInfo.ceoName} />
              </section>
            )}

            {row.paymentInfo && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">결제 정보</p>
                <InfoRow label="은행" value={row.paymentInfo.bankName} />
                <InfoRow label="계좌번호" value={row.paymentInfo.bankAccountNo} />
                <InfoRow label="예금주" value={row.paymentInfo.bankAccountHolder} />
                <InfoRow label="결제방식" value={row.paymentInfo.paymentMethod} />
              </section>
            )}

            {row.memo && (
              <section>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">메모</p>
                <p className="text-sm text-muted-foreground">{row.memo}</p>
              </section>
            )}
          </div>

          <div className="mt-8 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditOpen(true)}>
              수정
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? '삭제 중...' : '삭제'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <SupplierFormDialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) onOpenChange(false);
        }}
        editRow={row}
      />
    </>
  );
}
