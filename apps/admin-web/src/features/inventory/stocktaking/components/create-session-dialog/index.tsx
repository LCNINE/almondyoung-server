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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateStocktakingSession } from '@/lib/services/inventory';
import { useWarehouses } from '@/lib/services/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CreateSessionDialog({ open, onOpenChange }: Props) {
  const [warehouseId, setWarehouseId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [notes, setNotes] = useState('');

  const { data: warehouses } = useWarehouses();
  const createMutation = useCreateStocktakingSession();

  const handleClose = () => {
    setWarehouseId('');
    setSessionName('');
    setNotes('');
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!warehouseId || !sessionName) {
      toast.error('창고와 세션명을 입력해 주세요.');
      return;
    }

    try {
      await createMutation.mutateAsync({
        warehouseId,
        sessionName,
        notes: notes || undefined,
      });
      toast.success('재고 실사 세션이 생성되었습니다.');
      handleClose();
    } catch {
      toast.error('세션 생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>재고 실사 세션 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="warehouseId">창고</Label>
            <select
              id="warehouseId"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">창고 선택</option>
              {(warehouses ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sessionName">세션명</Label>
            <Input
              id="sessionName"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="예: 2026-04 월간 실사 - A창고"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">메모 (선택)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="메모 입력"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
