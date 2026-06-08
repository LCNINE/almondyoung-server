'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useCalculateVersionPrice, useCalculateMasterPrice } from '@/lib/services/products/mutations';
import type { CalculatePriceResponseDto, PricingLayer } from '@/lib/types/dto/products';
import {
  getValidPricingVariantId,
  type PricingVariant,
} from '../../pricing-detail-model';

const LAYER_LABEL: Record<PricingLayer, string> = {
  base_price: '기준가',
  membership_price: '멤버십가',
  tiered_price: '수량별',
};

interface Props {
  variants: PricingVariant[];
  versionId: string | null;
  masterId: string;
}

export function Calculator({ variants, versionId, masterId }: Props) {
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customerType, setCustomerType] = useState<'regular' | 'membership'>('regular');
  const [result, setResult] = useState<CalculatePriceResponseDto | null>(null);

  const calcVersion = useCalculateVersionPrice();
  const calcMaster = useCalculateMasterPrice();

  const isPending = calcVersion.isPending || calcMaster.isPending;

  useEffect(() => {
    setVariantId((current) => getValidPricingVariantId(current, variants));
  }, [variants]);

  const handleCalculate = () => {
    if (!variantId) return;
    const dto = { variantId, quantity, customerType };
    if (versionId) {
      calcVersion.mutate(
        { versionId, dto },
        { onSuccess: setResult },
      );
    } else {
      calcMaster.mutate(
        { masterId, dto },
        { onSuccess: setResult },
      );
    }
  };

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm font-semibold">가격 시뮬레이션</p>

      <div className="space-y-2">
        <Select value={variantId} onValueChange={setVariantId}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="옵션(variant) 선택" />
          </SelectTrigger>
          <SelectContent>
            {variants.map((v) => (
              <SelectItem key={v.id} value={v.id} className="text-xs">
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2">
          <Input
            type="number"
            min={1}
            className="h-8 w-24 text-xs"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            placeholder="수량"
          />
          <Select
            value={customerType}
            onValueChange={(v) => setCustomerType(v as 'regular' | 'membership')}
          >
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular" className="text-xs">일반</SelectItem>
              <SelectItem value="membership" className="text-xs">멤버십</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button size="sm" className="w-full" onClick={handleCalculate} disabled={!variantId || isPending}>
          {isPending ? '계산 중...' : '계산'}
        </Button>
      </div>

      {result && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">최종 단가</span>
            <span className="text-base font-bold">{result.price.toLocaleString()}원</span>
          </div>
          {result.totalPrice !== undefined && (
            <div className="flex items-center justify-between text-muted-foreground">
              <span>합계 ({quantity}개)</span>
              <span>{result.totalPrice.toLocaleString()}원</span>
            </div>
          )}

          <div className="mt-2 space-y-1">
            <p className="font-medium text-muted-foreground">가격 변동 단계</p>
            <div className="space-y-1">
              <Step label="시작" value={result.priceBreakdown.initialPrice} />
              <Step label="기준가 적용 후" value={result.priceBreakdown.afterBasePrice} />
              {result.priceBreakdown.afterMembershipPrice !== undefined && (
                <Step label="멤버십가 적용 후" value={result.priceBreakdown.afterMembershipPrice} />
              )}
              {result.priceBreakdown.afterTieredPrice !== undefined && (
                <Step label="수량별 가격 적용 후" value={result.priceBreakdown.afterTieredPrice} />
              )}
            </div>
          </div>

          {result.appliedRules.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="font-medium text-muted-foreground">적용된 룰</p>
              {result.appliedRules.map((r) => (
                <div key={r.ruleId} className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {LAYER_LABEL[r.layer]}
                  </Badge>
                  <span className="text-muted-foreground">
                    {r.priceBeforeRule.toLocaleString()} → {r.priceAfterRule.toLocaleString()}원
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Step({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value.toLocaleString()}원</span>
    </div>
  );
}
