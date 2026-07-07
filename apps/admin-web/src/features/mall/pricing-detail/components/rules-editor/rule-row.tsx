'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import type { PricingLayer, PricingScopeType, PricingOperationType, PricingRuleInput } from '@/lib/types/dto/products';
import type { ProductOptionGroup } from '@/lib/services/products/products-detail.types';
import { fromServerScale, toServerScale } from '@/lib/services/products/transformers';
import { RuleScopeTarget, type ScopeTargetVariant } from './rule-scope-target';

const SCOPE_LABELS: Record<PricingScopeType, string> = {
  all_variants: '전체',
  with_option: '특정 옵션값',
  variants: '지정 옵션조합',
};

const OP_LABELS: Record<PricingOperationType, string> = {
  offset: '증감(원)',
  scale: '비율(배수)',
  override: '고정가(원)',
};

interface Props {
  rule: PricingRuleInput;
  index: number;
  total: number;
  layer: PricingLayer;
  readonly: boolean;
  optionGroups: ProductOptionGroup[];
  variantOptions: ScopeTargetVariant[];
  onChange: (index: number, updated: PricingRuleInput) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (index: number) => void;
}

export function RuleRow({
  rule,
  index,
  total,
  layer,
  readonly,
  optionGroups,
  variantOptions,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props) {
  const displayValue =
    rule.operationType === 'scale' ? fromServerScale(rule.operationValue) : rule.operationValue;

  const handleValueChange = (raw: string) => {
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    const serverVal = rule.operationType === 'scale' ? toServerScale(num) : Math.round(num);
    onChange(index, { ...rule, operationValue: serverVal });
  };

  const handleOpTypeChange = (val: PricingOperationType) => {
    let operationValue = rule.operationValue;
    if (val === 'scale' && rule.operationType !== 'scale') {
      operationValue = toServerScale(1);
    } else if (val !== 'scale' && rule.operationType === 'scale') {
      operationValue = 0;
    }
    onChange(index, { ...rule, operationType: val, operationValue });
  };

  // 범위를 바꾸면 대상은 항상 초기화한다. 전체는 대상이 없고,
  // 옵션값 IDs 와 variant IDs 는 서로 호환되지 않기 때문.
  const handleScopeChange = (val: PricingScopeType) => {
    onChange(index, {
      ...rule,
      scopeType: val,
      scopeTargetIds: val === 'all_variants' ? undefined : [],
    });
  };

  const needsTarget = rule.scopeType === 'with_option' || rule.scopeType === 'variants';

  return (
    <tr className="border-b text-sm">
      <td className="px-3 py-2 text-center text-muted-foreground">{index + 1}</td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col gap-1.5">
          <Select
            value={rule.scopeType}
            onValueChange={(v) => handleScopeChange(v as PricingScopeType)}
            disabled={readonly}
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SCOPE_LABELS) as PricingScopeType[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {SCOPE_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {needsTarget && (
            <RuleScopeTarget
              scopeType={rule.scopeType as 'with_option' | 'variants'}
              optionGroups={optionGroups}
              variantOptions={variantOptions}
              value={rule.scopeTargetIds ?? []}
              onChange={(ids) => onChange(index, { ...rule, scopeTargetIds: ids })}
              readonly={readonly}
            />
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <Select
          value={rule.operationType}
          onValueChange={(v) => handleOpTypeChange(v as PricingOperationType)}
          disabled={readonly}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OP_LABELS) as PricingOperationType[]).map((k) => (
              <SelectItem key={k} value={k} className="text-xs">
                {OP_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2">
        <Input
          type="number"
          step={rule.operationType === 'scale' ? 0.01 : 1}
          className="h-8 w-28 text-xs"
          value={displayValue}
          onChange={(e) => handleValueChange(e.target.value)}
          disabled={readonly}
        />
      </td>
      {layer === 'tiered_price' && (
        <td className="px-3 py-2">
          <Input
            type="number"
            min={1}
            step={1}
            className="h-8 w-20 text-xs"
            value={rule.minQuantity ?? ''}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              onChange(index, { ...rule, minQuantity: isNaN(v) ? undefined : v });
            }}
            disabled={readonly}
            placeholder="수량"
          />
        </td>
      )}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={readonly || index === 0}
            onClick={() => onMoveUp(index)}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            disabled={readonly || index === total - 1}
            onClick={() => onMoveDown(index)}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive hover:text-destructive"
            disabled={readonly}
            onClick={() => onRemove(index)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
