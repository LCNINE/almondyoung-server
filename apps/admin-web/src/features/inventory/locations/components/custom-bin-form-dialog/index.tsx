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
import { useAddCustomBin, useLocationColumns, useLocationRacks } from '@/lib/services/inventory';
import type { AddCustomBinRequest } from '@/lib/types/dto/inventory';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
};

export function CustomBinFormDialog({ open, onOpenChange, warehouseId }: Props) {
  const [columnName, setColumnName] = useState('');
  const [rackNumber, setRackNumber] = useState('');
  const [customBinName, setCustomBinName] = useState('');
  const [displayName, setDisplayName] = useState('');

  const { data: columns } = useLocationColumns(warehouseId);
  const { data: racks } = useLocationRacks(warehouseId, columnName || undefined);
  const addMutation = useAddCustomBin();

  useEffect(() => {
    if (!open) {
      setColumnName('');
      setRackNumber('');
      setCustomBinName('');
      setDisplayName('');
    }
  }, [open]);

  const handleClose = () => onOpenChange(false);

  const handleSubmit = async () => {
    if (!columnName) { toast.error('열을 선택해 주세요.'); return; }
    if (!rackNumber) { toast.error('랙을 선택해 주세요.'); return; }
    if (!customBinName.trim()) { toast.error('커스텀 빈 이름을 입력해 주세요.'); return; }

    const data: AddCustomBinRequest = {
      columnName,
      rackNumber: Number(rackNumber),
      customBinName: customBinName.trim(),
      displayName: displayName.trim() || undefined,
    };
    try {
      await addMutation.mutateAsync({ warehouseId, data });
      toast.success('커스텀 빈이 추가되었습니다.');
      handleClose();
    } catch {
      toast.error('커스텀 빈 추가에 실패했습니다.');
    }
  };

  const filteredRacks = (racks ?? []).filter(
    (r) => !columnName || r.column.columnName === columnName
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>커스텀 빈 추가</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>열 *</Label>
            <Select value={columnName} onValueChange={(v) => { setColumnName(v); setRackNumber(''); }}>
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
            <Label>랙 *</Label>
            <Select value={rackNumber} onValueChange={setRackNumber} disabled={!columnName}>
              <SelectTrigger>
                <SelectValue placeholder="랙 선택" />
              </SelectTrigger>
              <SelectContent>
                {filteredRacks.map((r) => (
                  <SelectItem key={r.id} value={String(r.rackNumber)}>
                    {`${r.column.columnName}-${r.rackNumber}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-bin-name">커스텀 빈 이름 *</Label>
            <Input
              id="custom-bin-name"
              value={customBinName}
              onChange={(e) => setCustomBinName(e.target.value)}
              placeholder="예: 바닥, 상단"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-bin-display">표시명</Label>
            <Input
              id="custom-bin-display"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="표시명 (미입력 시 빈 이름 사용)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={addMutation.isPending}>
            {addMutation.isPending ? '추가 중...' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
