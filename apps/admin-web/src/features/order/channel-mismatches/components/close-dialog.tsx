'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MEMO_MAX, memoError } from '../display';

export interface CloseTarget {
  id: string;
  /** 무엇을 종결하는지 한 줄 — 주문번호 · 종류 */
  label: string;
}

interface CloseDialogProps {
  target: CloseTarget | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (memo: string) => void;
}

export function CloseDialog({
  target,
  pending,
  onClose,
  onSubmit,
}: CloseDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* key 로 대상이 바뀔 때마다 입력을 비운다 */}
        {target && (
          <CloseForm
            key={target.id}
            target={target}
            pending={pending}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloseForm({
  target,
  pending,
  onClose,
  onSubmit,
}: {
  target: CloseTarget;
  pending: boolean;
  onClose: () => void;
  onSubmit: (memo: string) => void;
}) {
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);
  const error = memoError(memo);

  return (
    <>
      <DialogHeader>
        <DialogTitle>종결</DialogTitle>
        <DialogDescription>{target.label}</DialogDescription>
      </DialogHeader>
      <Textarea
        value={memo}
        maxLength={MEMO_MAX}
        placeholder="메모"
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => setTouched(true)}
        autoFocus
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="text-red-600">{touched ? error : null}</span>
        <span>
          {memo.length}/{MEMO_MAX}
        </span>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button
          variant="destructive"
          disabled={error !== null || pending}
          onClick={() => onSubmit(memo.trim())}
        >
          종결
        </Button>
      </DialogFooter>
    </>
  );
}
