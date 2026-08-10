'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCreateSitePopup } from '@/lib/services/products';
import {
  EMPTY_POPUP_FORM,
  popupFormToCreateDto,
  validatePopupForm,
  type SitePopupFormValue,
} from '../../form';
import { PopupFormFields } from '../popup-form-fields';
import { PopupPreview } from '../popup-preview';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PopupCreateDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState<SitePopupFormValue>(EMPTY_POPUP_FORM);
  const createMutation = useCreateSitePopup();

  const handleClose = () => {
    setForm(EMPTY_POPUP_FORM);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    const error = validatePopupForm(form);
    if (error) {
      toast.error(error);
      return;
    }

    try {
      await createMutation.mutateAsync(popupFormToCreateDto(form));
      toast.success('팝업이 등록되었습니다.');
      handleClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '등록에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
        <DialogHeader className="shrink-0 border-b px-6 py-5">
          <DialogTitle>팝업 등록</DialogTitle>
          <DialogDescription>
            스토어프론트 진입 시 뜨는 팝업을 등록합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto px-6 py-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <PopupFormFields value={form} onChange={setForm} />
          <div className="lg:sticky lg:top-0 lg:self-start">
            <PopupPreview value={form} />
          </div>
        </div>

        <DialogFooter className="bg-background shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={handleClose} disabled={createMutation.isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            팝업 등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
