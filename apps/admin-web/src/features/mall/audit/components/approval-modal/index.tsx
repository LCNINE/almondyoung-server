'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useApprove, useReject } from '@/lib/services/products';
import type { PendingApprovalDto } from '@/lib/types/dto/products';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'approve' | 'reject';
  product: PendingApprovalDto | null;
  onSuccess: () => void;
}

export function ApprovalModal({ open, onOpenChange, mode, product, onSuccess }: Props) {
  const [text, setText] = useState('');

  const approve = useApprove();
  const reject = useReject();

  const isPending = approve.isPending || reject.isPending;

  async function handleConfirm() {
    if (!product) return;
    if (mode === 'reject' && !text.trim()) {
      toast.error('거부 사유를 입력해주세요.');
      return;
    }

    try {
      if (mode === 'approve') {
        await approve.mutateAsync({ masterId: product.id, comment: text || undefined });
        toast.success(`"${product.name}"이(가) 승인되었습니다.`);
      } else {
        await reject.mutateAsync({ masterId: product.id, reason: text });
        toast.success(`"${product.name}"이(가) 거부되었습니다.`);
      }
      setText('');
      onSuccess();
      onOpenChange(false);
    } catch {
      toast.error('처리 중 오류가 발생했습니다.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'approve' ? '상품 승인' : '상품 거부'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm">
            <strong>{product?.name}</strong>을(를){' '}
            {mode === 'approve' ? '승인' : '거부'}하겠습니까?
          </p>
          <div className="space-y-2">
            <Label>
              {mode === 'approve' ? '코멘트 (선택)' : '거부 사유'}
              {mode === 'reject' && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                mode === 'approve'
                  ? '승인 코멘트를 입력하세요.'
                  : '거부 사유를 입력하세요.'
              }
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending}
            variant={mode === 'reject' ? 'destructive' : 'default'}
          >
            {isPending ? '처리 중...' : mode === 'approve' ? '승인' : '거부'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
