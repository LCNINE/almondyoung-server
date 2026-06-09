'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useBulkApprove } from '@/lib/services/orders/mutations';

interface Props {
  sessionId: string;
  inspectorUserId: string;
  onClose: () => void;
}

export function BulkApproveDialog({
  sessionId,
  inspectorUserId,
  onClose,
}: Props) {
  const [foiIdsInput, setFoiIdsInput] = useState('');
  const mutation = useBulkApprove();

  const handleSubmit = async () => {
    const ids = foiIdsInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      toast.error('FO 라인 ID를 한 줄에 하나씩 입력해주세요.');
      return;
    }

    try {
      const result = await mutation.mutateAsync({
        sessionId,
        foiIds: ids,
        inspectorUserId,
      });
      toast.success(`${result.approvedCount}개 항목이 일괄 승인되었습니다.`);
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '일괄 승인에 실패했습니다.');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>일괄 승인</DialogTitle>
          <DialogDescription>
            승인할 FO 라인 ID(foiId)를 쉼표 또는 줄바꿈으로 구분하여 입력하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>FO 라인 ID 목록</Label>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="uuid1&#10;uuid2&#10;uuid3"
              value={foiIdsInput}
              onChange={(e) => setFoiIdsInput(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending || !foiIdsInput.trim()}
          >
            {mutation.isPending ? '처리 중…' : '일괄 승인'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
