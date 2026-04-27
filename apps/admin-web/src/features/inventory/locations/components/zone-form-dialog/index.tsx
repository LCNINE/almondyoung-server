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
import { useCreateZoneLocation } from '@/lib/services/inventory';
import type { CreateZoneLocationRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
};

export function ZoneFormDialog({ open, onOpenChange, warehouseId }: Props) {
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [notes, setNotes] = useState('');

  const createMutation = useCreateZoneLocation();

  useEffect(() => {
    if (!open) {
      setCode('');
      setDisplayName('');
      setNotes('');
    }
  }, [open]);

  const handleClose = () => onOpenChange(false);

  const handleSubmit = async () => {
    if (!code.trim()) {
      toast.error('구역 코드를 입력해 주세요.');
      return;
    }
    const data: CreateZoneLocationRequest = {
      code: code.trim(),
      displayName: displayName.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    try {
      await createMutation.mutateAsync({ warehouseId, data });
      toast.success('구역 로케이션이 생성되었습니다.');
      handleClose();
    } catch {
      toast.error('구역 생성에 실패했습니다.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>새 구역 생성</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="zone-code">구역 코드 *</Label>
            <Input
              id="zone-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="예: 입고기본존"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zone-display-name">표시명</Label>
            <Input
              id="zone-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="표시명 (미입력 시 코드 사용)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zone-notes">메모</Label>
            <Input
              id="zone-notes"
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
