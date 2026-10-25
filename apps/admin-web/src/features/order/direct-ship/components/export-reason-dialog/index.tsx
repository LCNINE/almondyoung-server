'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { exportReasonError } from '../../lib/export-reason';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  pending: boolean;
  /** 사유가 5~200자일 때만 부른다 — 서버도 쓰기 전에 같은 규칙으로 막는다(N4) */
  onConfirm: (reason: string) => void;
}

/** 수령인 정보를 내보내는 동작(넘김·다시 받기)의 사유 입력 */
export function ExportReasonDialog({ open, onOpenChange, title, confirmLabel, pending, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* 닫히면 내용이 언마운트돼 사유가 비워진다 */}
        <ReasonForm
          confirmLabel={confirmLabel}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const error = exportReasonError(reason);

  const submit = () => {
    setTouched(true);
    if (error === null) onConfirm(reason.trim());
  };

  return (
    <>
      <div className="space-y-1.5 py-2">
        <Label htmlFor="direct-ship-export-reason">내보내기 사유</Label>
        <Textarea
          id="direct-ship-export-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="입점사 발송 요청"
          aria-invalid={touched && error !== null}
        />
        {touched && error !== null && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button onClick={submit} disabled={pending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
