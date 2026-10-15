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
import { REASON_MAX, discardFollowUpText, reasonError } from '../display';

export interface DiscardTarget {
  id: number;
  /** 무엇을 종결하는지 한 줄 — 이벤트 종류 · 순서 키 */
  label: string;
  /** 종결하면 이어서 흐를 뒤 행 수. 머리 아닌 행이면 0 */
  behind: number;
}

interface DiscardDialogProps {
  target: DiscardTarget | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function DiscardDialog({ target, pending, onClose, onSubmit }: DiscardDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* key 로 대상이 바뀔 때마다 입력을 비운다 */}
        {target && (
          <DiscardForm
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

function DiscardForm({
  target,
  pending,
  onClose,
  onSubmit,
}: {
  target: DiscardTarget;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const error = reasonError(reason);
  const followUp = discardFollowUpText(target.behind);

  return (
    <>
      <DialogHeader>
        <DialogTitle>종결</DialogTitle>
        <DialogDescription className="font-mono text-xs">{target.label}</DialogDescription>
      </DialogHeader>
      <Textarea
        value={reason}
        maxLength={REASON_MAX}
        placeholder="사유"
        onChange={(e) => setReason(e.target.value)}
        onBlur={() => setTouched(true)}
        autoFocus
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="text-red-600">{touched ? error : null}</span>
        <span>
          {reason.length}/{REASON_MAX}
        </span>
      </div>
      {followUp && <p className="text-sm font-medium">{followUp}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          취소
        </Button>
        <Button
          variant="destructive"
          disabled={error !== null || pending}
          onClick={() => onSubmit(reason.trim())}
        >
          종결
        </Button>
      </DialogFooter>
    </>
  );
}
