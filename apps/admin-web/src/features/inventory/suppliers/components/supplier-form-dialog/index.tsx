'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateSupplier, useUpdateSupplier, useSupplierCategories } from '@/lib/services/inventory';
import type { SupplierDto, CreateSupplierRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editRow?: SupplierDto | null;
};

const EMPTY_FORM: CreateSupplierRequest = { name: '' };

export function SupplierFormDialog({ open, onOpenChange, editRow }: Props) {
  const isEdit = !!editRow;
  const [form, setForm] = useState<CreateSupplierRequest>(EMPTY_FORM);

  const { data: categories } = useSupplierCategories();
  const createMutation = useCreateSupplier();
  const updateMutation = useUpdateSupplier();

  useEffect(() => {
    if (editRow) {
      setForm({
        name: editRow.name,
        phone: editRow.contact?.phone ?? undefined,
        fax: editRow.contact?.fax ?? undefined,
        email: editRow.contact?.email ?? undefined,
        zipcode: editRow.address?.zipcode ?? undefined,
        address1: editRow.address?.address1 ?? undefined,
        address2: editRow.address?.address2 ?? undefined,
        businessRegNo: editRow.businessInfo?.businessRegNo ?? undefined,
        businessType: editRow.businessInfo?.businessType ?? undefined,
        ceoName: editRow.businessInfo?.ceoName ?? undefined,
        bankName: editRow.paymentInfo?.bankName ?? undefined,
        bankAccountNo: editRow.paymentInfo?.bankAccountNo ?? undefined,
        bankAccountHolder: editRow.paymentInfo?.bankAccountHolder ?? undefined,
        paymentMethod: editRow.paymentInfo?.paymentMethod ?? undefined,
        description: editRow.description ?? undefined,
        memo: editRow.memo ?? undefined,
        defaultWarehouseId: editRow.defaultWarehouseId ?? undefined,
        categoryIds: editRow.categories.map((c) => c.id),
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [editRow, open]);

  const set = (key: keyof CreateSupplierRequest) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value || undefined }));

  const handleClose = () => {
    setForm(EMPTY_FORM);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!form.name?.trim()) {
      toast.error('공급처명을 입력해 주세요.');
      return;
    }
    try {
      if (isEdit && editRow) {
        await updateMutation.mutateAsync({ id: editRow.id, data: form });
        toast.success('공급처 정보가 수정되었습니다.');
      } else {
        await createMutation.mutateAsync(form);
        toast.success('공급처가 등록되었습니다.');
      }
      handleClose();
    } catch {
      toast.error(isEdit ? '수정에 실패했습니다.' : '등록에 실패했습니다.');
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '공급처 수정' : '공급처 등록'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">기본 정보</p>
            <div className="space-y-2">
              <Label htmlFor="name">공급처명 *</Label>
              <Input id="name" value={form.name} onChange={set('name')} placeholder="공급처명" />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">연락처</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="phone">전화번호</Label>
                <Input id="phone" value={form.phone ?? ''} onChange={set('phone')} placeholder="전화번호" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fax">팩스</Label>
                <Input id="fax" value={form.fax ?? ''} onChange={set('fax')} placeholder="팩스번호" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="email">이메일</Label>
                <Input id="email" type="email" value={form.email ?? ''} onChange={set('email')} placeholder="이메일" />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">주소</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="zipcode">우편번호</Label>
                <Input id="zipcode" value={form.zipcode ?? ''} onChange={set('zipcode')} placeholder="우편번호" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="address1">주소</Label>
                <Input id="address1" value={form.address1 ?? ''} onChange={set('address1')} placeholder="주소" />
              </div>
              <div className="col-span-3 space-y-2">
                <Label htmlFor="address2">상세주소</Label>
                <Input id="address2" value={form.address2 ?? ''} onChange={set('address2')} placeholder="상세주소" />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">사업자 정보</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="businessRegNo">사업자등록번호</Label>
                <Input id="businessRegNo" value={form.businessRegNo ?? ''} onChange={set('businessRegNo')} placeholder="000-00-00000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessType">업태/종목</Label>
                <Input id="businessType" value={form.businessType ?? ''} onChange={set('businessType')} placeholder="업태" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ceoName">대표자명</Label>
                <Input id="ceoName" value={form.ceoName ?? ''} onChange={set('ceoName')} placeholder="대표자명" />
              </div>
            </div>
          </div>

          {categories && categories.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">분류</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const selected = (form.categoryIds ?? []).includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          categoryIds: selected
                            ? (prev.categoryIds ?? []).filter((id) => id !== cat.id)
                            : [...(prev.categoryIds ?? []), cat.id],
                        }))
                      }
                      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background text-foreground hover:bg-accent'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="memo">메모</Label>
            <Input id="memo" value={form.memo ?? ''} onChange={set('memo')} placeholder="내부 메모" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (isEdit ? '수정 중...' : '등록 중...') : isEdit ? '수정' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
