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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateRack, useLocationColumns } from '@/lib/services/inventory';
import type { CreateRackRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
};

export function RackFormDialog({ open, onOpenChange, warehouseId }: Props) {
  const [columnName, setColumnName] = useState('');
  const [rackNumber, setRackNumber] = useState('');
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [binStart, setBinStart] = useState('1');
  const [binEnd, setBinEnd] = useState('15');
  const [notes, setNotes] = useState('');

  const { data: columns } = useLocationColumns(warehouseId);
  const createMutation = useCreateRack();

  useEffect(() => {
    if (!open) {
      setColumnName('');
      setRackNumber('');
      setAutoGenerate(true);
      setBinStart('1');
      setBinEnd('15');
      setNotes('');
    }
  }, [open]);

  const handleClose = () => onOpenChange(false);

  const handleSubmit = async () => {
    if (!columnName) {
      toast.error('열을 선택해 주세요.');
      return;
    }
    if (!rackNumber || Number(rackNumber) < 1) {
      toast.error('랙 번호를 입력해 주세요.');
      return;
    }
    const data: CreateRackRequest = {
      columnName,
      rackNumber: Number(rackNumber),
      binSettings: {
        autoGenerate,
        standardBins: autoGenerate ? { start: Number(binStart), end: Number(binEnd) } : undefined,
      },
      notes: notes || undefined,
    };
    try {
      const result = await createMutation.mutateAsync({ warehouseId, data });
      toast.success(`랙이 생성되었습니다. (로케이션 ${result.createdCount}개 생성)`);
      handleClose();
    } catch {
      toast.error('랙 생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 랙 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>열 *</Label>
            <Select value={columnName} onValueChange={setColumnName}>
              <SelectTrigger>
                <SelectValue placeholder="열 선택" />
              </SelectTrigger>
              <SelectContent>
                {(columns ?? []).filter((c) => c.isActive).map((c) => (
                  <SelectItem key={c.id} value={c.columnName}>{c.columnName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rack-number">랙 번호 *</Label>
            <Input
              id="rack-number"
              type="number"
              min="1"
              max="999"
              value={rackNumber}
              onChange={(e) => setRackNumber(e.target.value)}
              placeholder="예: 1"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="auto-generate"
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              className="size-4 rounded border"
            />
            <Label htmlFor="auto-generate">빈 자동 생성</Label>
          </div>

          {autoGenerate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="bin-start">빈 시작 번호</Label>
                <Input
                  id="bin-start"
                  type="number"
                  min="1"
                  value={binStart}
                  onChange={(e) => setBinStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bin-end">빈 끝 번호</Label>
                <Input
                  id="bin-end"
                  type="number"
                  min="1"
                  value={binEnd}
                  onChange={(e) => setBinEnd(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rack-notes">메모</Label>
            <Input
              id="rack-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="내부 메모"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
