'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInspectItem } from '@/lib/services/orders/mutations';
import type { InspectionItem } from '@/lib/types/dto/fulfillment';

interface Props {
  sessionId: string;
  item: InspectionItem;
  inspectorUserId: string;
  onClose: () => void;
}

export function InspectItemDialog({
  sessionId,
  item,
  inspectorUserId,
  onClose,
}: Props) {
  const [approvedQty, setApprovedQty] = useState(item.approvedQty);
  const [rejectedQty, setRejectedQty] = useState(item.rejectedQty);
  const inspectedQty = approvedQty + rejectedQty;

  const inspectMutation = useInspectItem();

  const handleSubmit = async () => {
    try {
      await inspectMutation.mutateAsync({
        sessionId,
        foiId: item.foiId,
        inspectedQty,
        approvedQty,
        rejectedQty,
        issues: [],
        inspectorUserId,
      });
      toast.success('검수가 완료되었습니다.');
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '검수에 실패했습니다.');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>검수 입력</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>검수 수량</Label>
            <Input type="number" min={0} value={inspectedQty} disabled />
          </div>
          <div className="flex flex-col gap-1">
            <Label>승인 수량</Label>
            <Input
              type="number"
              min={0}
              value={approvedQty}
              onChange={(e) => setApprovedQty(Number(e.target.value))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>반려 수량</Label>
            <Input
              type="number"
              min={0}
              value={rejectedQty}
              onChange={(e) => setRejectedQty(Number(e.target.value))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={inspectMutation.isPending}>
            {inspectMutation.isPending ? '처리 중…' : '검수 완료'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
