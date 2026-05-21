'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateCampaign } from '@/lib/services/campaigns';
import { toast } from 'sonner';

export function CampaignCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [budgetType, setBudgetType] = useState<'usage' | 'spend' | ''>('');
  const [budgetLimit, setBudgetLimit] = useState<number | ''>('');

  const createMutation = useCreateCampaign();

  const handleSubmit = async () => {
    if (!name.trim() || !identifier.trim()) return;

    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        campaign_identifier: identifier.trim().toUpperCase(),
        ...(startsAt ? { starts_at: new Date(startsAt).toISOString() } : {}),
        ...(endsAt ? { ends_at: new Date(endsAt).toISOString() } : {}),
        ...(budgetType && budgetLimit
          ? { budget: { type: budgetType, limit: Number(budgetLimit) } }
          : {}),
      });
      toast.success('캠페인이 생성되었습니다.');
      handleClose();
    } catch (e: unknown) {
      const msg = (e as any)?.response?.data?.message ?? '캠페인 생성에 실패했습니다.';
      toast.error(msg);
    }
  };

  const handleClose = () => {
    setName('');
    setIdentifier('');
    setStartsAt('');
    setEndsAt('');
    setBudgetType('');
    setBudgetLimit('');
    onOpenChange(false);
  };

  const isValid = name.trim() && identifier.trim() && (!budgetType || budgetLimit);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>캠페인 생성</DialogTitle>
          <DialogDescription>여러 쿠폰을 묶는 행사 캠페인을 만듭니다.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>캠페인 이름 <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 봄 할인 행사 2025"
            />
          </div>

          <div className="space-y-2">
            <Label>캠페인 식별자 <span className="text-destructive">*</span></Label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              placeholder="예: SPRING2025"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">영문 대문자/숫자, 쿠폰 코드와 중복 불가</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>시작일</Label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>종료일</Label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <div className="space-y-2">
              <Label>예산 유형</Label>
              <Select value={budgetType} onValueChange={(v) => { setBudgetType(v as 'usage' | 'spend' | ''); setBudgetLimit(''); }}>
                <SelectTrigger>
                  <SelectValue placeholder="예산 없음" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usage">사용 횟수 제한</SelectItem>
                  <SelectItem value="spend">총 할인금액 한도</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {budgetType && (
              <div className="space-y-2">
                <Label>
                  {budgetType === 'usage' ? '최대 사용 횟수' : '최대 할인금액 (원)'}
                  <span className="text-destructive"> *</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(e.target.value ? Number(e.target.value) : '')}
                  placeholder={budgetType === 'usage' ? '예: 1000' : '예: 5000000'}
                />
                {!!budgetLimit && (
                  <p className="text-xs text-muted-foreground">
                    {budgetType === 'usage'
                      ? `최대 ${(budgetLimit as number).toLocaleString('ko-KR')}회까지 사용 가능`
                      : `최대 ${(budgetLimit as number).toLocaleString('ko-KR')}원까지 할인 지급`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>취소</Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || !isValid}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
