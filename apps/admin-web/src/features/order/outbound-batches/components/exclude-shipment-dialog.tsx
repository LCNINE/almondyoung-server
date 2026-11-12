'use client';

import { useId, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function WithdrawalWaybillCheckbox({
  checked,
  onCheckedChange,
  trackingNo,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  trackingNo?: string | null;
}) {
  const id = useId();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-describedby={`${id}-help`}
        />
        <Label htmlFor={id}>송장도 같이 무효화</Label>
      </div>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        이 송장{trackingNo ? `(${trackingNo})` : ''}은 더 쓸 수 없게 돼요.
        상품을 담은 상자면 다 꺼낸 뒤에 무효화돼요.
      </p>
    </div>
  );
}

export function ExcludeShipmentDialog({
  trackingNo,
  defaultVoidWaybill,
  onClose,
  onConfirm,
}: {
  trackingNo?: string | null;
  defaultVoidWaybill: boolean;
  onClose: () => void;
  onConfirm: (voidWaybill: boolean) => void;
}) {
  const [voidWaybill, setVoidWaybill] = useState(defaultVoidWaybill);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>배치에서 빼기</AlertDialogTitle>
          <AlertDialogDescription>
            이 상자를 배치에서 뺄까요?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <WithdrawalWaybillCheckbox
          checked={voidWaybill}
          onCheckedChange={setVoidWaybill}
          trackingNo={trackingNo}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(voidWaybill)}>
            빼기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
