'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateRegion } from '@/lib/services/wallet';
import { useState } from 'react';
import { toast } from 'sonner';

export function CreateRegionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const createMutation = useCreateRegion();

  const reset = () => {
    setCode('');
    setName('');
  };

  const handleSubmit = async () => {
    const normalized = code.trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(normalized)) {
      toast.error('국가코드는 소문자 alpha-2 형식이어야 해요 (예: kr, us).');
      return;
    }
    if (!name.trim()) {
      toast.error('리전 이름을 입력해 주세요.');
      return;
    }
    try {
      await createMutation.mutateAsync({ code: normalized, name: name.trim() });
      toast.success(`리전 "${normalized}" 을 추가했어요.`);
      reset();
      onOpenChange(false);
    } catch {
      toast.error('리전 추가에 실패했어요. (이미 존재하는 코드일 수 있어요)');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>리전 추가</DialogTitle>
          <DialogDescription>
            소문자 ISO 3166-1 alpha-2 국가코드로 리전을 만듭니다 (예: kr, us,
            jp).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="region-code">국가코드 (alpha-2)</Label>
            <Input
              id="region-code"
              placeholder="kr"
              maxLength={2}
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="region-name">리전 이름</Label>
            <Input
              id="region-name"
              placeholder="대한민국"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? '추가 중...' : '추가'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
