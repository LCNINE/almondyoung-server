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
import { useCreateCoupon } from '@/lib/services/coupons';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';

function generateCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join('').slice(0, 8).toUpperCase();
}

export function CouponCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [value, setValue] = useState<number | ''>('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [minOrderAmount, setMinOrderAmount] = useState<number | ''>('');
  const [usageLimit, setUsageLimit] = useState<number | ''>('');

  const createMutation = useCreateCoupon();

  const handleSubmit = async () => {
    if (!code.trim() || !value || (value as number) <= 0) return;
    if (discountType === 'percentage' && (value as number) > 100) return;

    const hasCampaign = startsAt || endsAt || usageLimit;
    const campaignIdentifier = `CAMP_${code.trim().toUpperCase()}`;

    try {
      await createMutation.mutateAsync({
        code: code.trim().toUpperCase(),
        type: 'standard',
        is_automatic: false,
        application_method: {
          type: discountType,
          value: value as number,
          target_type: 'order',
          ...(discountType === 'fixed' ? { currency_code: 'krw' } : {}),
        },
        ...(hasCampaign
          ? {
              campaign: {
                campaign_identifier: campaignIdentifier,
                ...(startsAt ? { starts_at: new Date(startsAt).toISOString() } : {}),
                ...(endsAt ? { ends_at: new Date(endsAt).toISOString() } : {}),
                ...(usageLimit
                  ? { budget: { type: 'usage' as const, limit: Number(usageLimit) } }
                  : {}),
              },
            }
          : {}),
        ...(minOrderAmount
          ? {
              rules: [
                {
                  attribute: 'subtotal',
                  operator: 'gte',
                  values: [String(minOrderAmount)],
                },
              ],
            }
          : {}),
      });
      toast.success('쿠폰이 생성되었습니다.');
      handleClose();
    } catch {
      toast.error('쿠폰 생성에 실패했습니다.');
    }
  };

  const handleClose = () => {
    setCode('');
    setDiscountType('percentage');
    setValue('');
    setStartsAt('');
    setEndsAt('');
    setMinOrderAmount('');
    setUsageLimit('');
    onOpenChange(false);
  };

  const isValid =
    code.trim() &&
    value &&
    (value as number) > 0 &&
    !(discountType === 'percentage' && (value as number) > 100);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>쿠폰 생성</DialogTitle>
          <DialogDescription>새 쿠폰 코드와 할인 조건을 설정하세요.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>쿠폰 코드 <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SUMMER2025"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setCode(generateCode())}
                title="자동 생성"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>할인 유형 <span className="text-destructive">*</span></Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as 'percentage' | 'fixed')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">정률 (%)</SelectItem>
                  <SelectItem value="fixed">정액 (원)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                할인 {discountType === 'percentage' ? '율 (%)' : '금액 (원)'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                min={1}
                max={discountType === 'percentage' ? 100 : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value ? Number(e.target.value) : '')}
                placeholder={discountType === 'percentage' ? '10' : '5000'}
              />
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">사용 조건 (선택)</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>최소 주문 금액 (원)</Label>
            <Input
              type="number"
              min={0}
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value ? Number(e.target.value) : '')}
              placeholder="예: 50000 (5만원 이상 구매 시 사용 가능)"
            />
            {!!minOrderAmount && (
              <p className="text-xs text-muted-foreground">
                {minOrderAmount.toLocaleString('ko-KR')}원 이상 구매 시 사용 가능
              </p>
            )}
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
              <Label>만료일</Label>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>총 사용 횟수 제한</Label>
            <Input
              type="number"
              min={1}
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value ? Number(e.target.value) : '')}
              placeholder="예: 100 (100회 사용 후 자동 만료)"
            />
            {!!usageLimit && (
              <p className="text-xs text-muted-foreground">
                전체 {usageLimit.toLocaleString('ko-KR')}회 사용 후 자동 비활성화
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending || !isValid}>
            {createMutation.isPending ? '생성 중...' : '생성'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
