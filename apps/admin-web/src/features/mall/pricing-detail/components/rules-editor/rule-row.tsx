'use client';

import { useEffect, useRef, useState } from 'react';
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
import type {
  PricingLayer,
  PricingScopeType,
  PricingOperationType,
  PricingRuleInput,
} from '@/lib/types/dto/products';
import type { ProductOptionGroup } from '@/lib/services/products/products-detail.types';
import {
  fromServerScalePercent,
  toServerScalePercent,
} from '@/lib/services/products/transformers';
import { RuleScopeTarget, type ScopeTargetVariant } from './rule-scope-target';

const SCOPE_LABELS: Record<PricingScopeType, string> = {
  all_variants: '전체',
  with_option: '특정 옵션값',
  variants: '지정 옵션조합',
};

const OP_LABELS: Record<PricingOperationType, string> = {
  offset: '증감(원)',
  scale: '비율(%)',
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
    rule.operationType === 'scale'
      ? fromServerScalePercent(rule.operationValue)
      : rule.operationValue;

  // 값 입력창은 자체 문자열(draft)을 소유한다. 숫자 모델과 분리해서
  // "", "-", "12." 같은 편집 중간 상태를 그대로 유지한다.
  // (controlled number input이 이 상태들을 거부해 값이 튕기던 문제 해결)
  // 파싱 가능한 순간에만 부모로 숫자를 전파한다.
  const [draft, setDraft] = useState(() => String(displayValue));
  const editingRef = useRef(false);

  // 외부 변경(연산 타입 전환, 순서 이동, 최초 로드)은 draft에 반영하되,
  // 사용자가 편집 중일 땐 절대 덮어쓰지 않는다.
  useEffect(() => {
    if (!editingRef.current) setDraft(String(displayValue));
  }, [displayValue]);

  const commitValue = (num: number) => {
    const serverVal =
      rule.operationType === 'scale'
        ? toServerScalePercent(num)
        : Math.round(num);
    onChange(index, { ...rule, operationValue: serverVal });
  };

  const handleValueChange = (raw: string) => {
    setDraft(raw);
    // 중간 상태는 전파하지 않는다 (모델 유지 → 화면이 튕기지 않음).
    if (raw === '' || raw === '-' || raw === '.' || raw === '-.') return;
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    commitValue(num);
  };

  const handleValueBlur = () => {
    editingRef.current = false;
    const num = parseFloat(draft);
    if (isNaN(num)) {
      // 비우고 떠나면 현재 모델 값으로 되돌린다.
      setDraft(String(displayValue));
      return;
    }
    commitValue(num);
    // 정규화된 표기로 다시 그린다 (예: 증감 "5.7" → "6").
    setDraft(
      String(
        rule.operationType === 'scale'
          ? fromServerScalePercent(toServerScalePercent(num))
          : Math.round(num)
      )
    );
  };

  const handleOpTypeChange = (val: PricingOperationType) => {
    let operationValue = rule.operationValue;
    // 연산 타입이 바뀌면 값의 의미(원 vs %)가 달라지므로 중립값으로 초기화한다.
    if (val === 'scale' && rule.operationType !== 'scale') {
      operationValue = toServerScalePercent(0); // 0% = 변화 없음
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

  const needsTarget =
    rule.scopeType === 'with_option' || rule.scopeType === 'variants';

  return (
    <tr className="border-b text-sm">
      <td className="px-3 py-2 text-center text-muted-foreground">
        {index + 1}
      </td>
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
              onChange={(ids) =>
                onChange(index, { ...rule, scopeTargetIds: ids })
              }
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
        <div className="flex items-center gap-1">
          <Input
            type="text"
            inputMode="decimal"
            className="h-8 w-28 text-xs"
            value={draft}
            onFocus={() => {
              editingRef.current = true;
            }}
            onChange={(e) => handleValueChange(e.target.value)}
            onBlur={handleValueBlur}
            disabled={readonly}
          />
          {rule.operationType === 'scale' && (
            <span className="text-xs text-muted-foreground">%</span>
          )}
        </div>
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
              onChange(index, {
                ...rule,
                minQuantity: isNaN(v) ? undefined : v,
              });
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
