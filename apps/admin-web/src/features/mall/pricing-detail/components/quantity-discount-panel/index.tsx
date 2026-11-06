'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  MAX_QUANTITY_DISCOUNT_TIERS,
  buildTierPrices,
  formFromResponse,
  formToPayload,
  validateQuantityDiscount,
  violationMessage,
  type QuantityDiscountDto,
  type QuantityDiscountForm,
  type QuantityDiscountViolation,
  type TierForm,
  type UpsertQuantityDiscountDto,
} from '@/lib/pricing/quantity-discount';
import { fromServerScalePercent } from '@/lib/services/products/transformers';

export interface PreviewVariant {
  variantId: string;
  name: string;
  basePrice: number;
  membershipPrice: number;
}

export interface QuantityDiscountPanelProps {
  saved: QuantityDiscountDto | null | undefined;
  variants: PreviewVariant[];
  /** 버전 상태(draft 아님) 때문에 편집할 수 없다. */
  readonly: boolean;
  canSave: boolean;
  isSaving: boolean;
  serverViolations: QuantityDiscountViolation[];
  onSave: (dto: UpsertQuantityDiscountDto) => void;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function sortedRowIndexes(tiers: TierForm[]): number[] {
  const key = (t: TierForm) => {
    const trimmed = t.minQuantity.trim();
    return trimmed === '' ? Number.NaN : Number(trimmed);
  };
  return tiers
    .map((t, index) => ({ index, key: key(t) }))
    .sort((a, b) => {
      if (Number.isNaN(a.key) || Number.isNaN(b.key)) {
        return Number.isNaN(a.key) === Number.isNaN(b.key) ? a.index - b.index : Number.isNaN(a.key) ? 1 : -1;
      }
      return a.key - b.key || a.index - b.index;
    })
    .map((x) => x.index);
}

const emptyTier = (): TierForm => ({ minQuantity: '', regularPercent: '', membershipPercent: '' });

export function QuantityDiscountPanel({
  saved,
  variants,
  readonly,
  canSave,
  isSaving,
  serverViolations,
  onSave,
}: QuantityDiscountPanelProps) {
  const [form, setForm] = useState<QuantityDiscountForm>(() => formFromResponse(saved));
  const [showAllOptions, setShowAllOptions] = useState(false);
  // 서버 오류는 그 값으로 저장을 시도했을 때의 것이다 — 고치기 시작하면 감춘다.
  const [editedSinceServerCheck, setEditedSinceServerCheck] = useState(false);

  useEffect(() => {
    setEditedSinceServerCheck(false);
  }, [serverViolations]);
  const editable = !readonly && canSave;

  useEffect(() => {
    setForm(formFromResponse(saved));
  }, [saved]);

  const payload = useMemo(() => formToPayload(form), [form]);
  const violations = useMemo(() => {
    if (form.tiers.length === 0) return [];
    return validateQuantityDiscount(payload, variants);
  }, [form.tiers.length, payload, variants]);

  // 검증·미리보기는 최소 수량 순으로 매긴다. 행은 입력 순서 그대로 두고(입력 중 자리가 바뀌지 않게)
  // 각 행이 그 순서에서 몇 번째인지로 결과·위반을 붙이며, 최소 수량 칸을 떠날 때 행을 정렬한다.
  const sortedPositionOf = useMemo(() => {
    const order = sortedRowIndexes(form.tiers);
    const position = new Map<number, number>();
    order.forEach((rowIndex, sortedIndex) => position.set(rowIndex, sortedIndex));
    return position;
  }, [form.tiers]);

  const previews = useMemo(
    () =>
      variants.map((v) => ({
        variant: v,
        prices: buildTierPrices({ basePrice: v.basePrice, membershipPrice: v.membershipPrice, tiers: payload.tiers }),
      })),
    [variants, payload.tiers],
  );

  const variantName = (id?: string) => variants.find((v) => v.variantId === id)?.name;
  const allViolations = editedSinceServerCheck ? violations : [...violations, ...serverViolations];
  const tierViolations = (sortedIndex: number) => allViolations.filter((v) => v.tierIndex === sortedIndex);
  const tableViolations = allViolations.filter((v) => v.tierIndex === undefined);
  const uniqueMessages = (list: QuantityDiscountViolation[]) => [
    ...new Set(list.map((v) => violationMessage(v, variantName(v.variantId)))),
  ];

  const update = (patch: Partial<QuantityDiscountForm>) => {
    setEditedSinceServerCheck(true);
    setForm((prev) => ({ ...prev, ...patch }));
  };
  const updateTier = (index: number, patch: Partial<TierForm>) => {
    setEditedSinceServerCheck(true);
    setForm((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  };

  const canSubmit = editable && !isSaving && form.tiers.length > 0 && violations.length === 0;
  const representative = previews[0];
  const violatingVariant = (variantId: string) =>
    allViolations.some((v) => v.code === 'MEMBER_PRICE_ABOVE_REGULAR' && v.variantId === variantId);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <span className="text-sm font-semibold">수량 할인</span>
          <p className="text-xs text-muted-foreground">
            같은 옵션을 정한 수량 이상 담으면 개당 할인합니다. 한쪽 대상만 할인하려면 다른 쪽 칸을 비워 두세요(0%).
            버전을 발행해야 쇼핑몰에 반영됩니다.
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            {saved && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={isSaving}
                onClick={() => onSave({ ...formToPayload(form), tiers: [] })}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                구간표 삭제
              </Button>
            )}
            <Button size="sm" disabled={!canSubmit} onClick={() => canSubmit && onSave(payload)}>
              <Save className="mr-1 h-3 w-3" />
              {isSaving ? '저장 중...' : '저장'}
            </Button>
          </div>
        )}
        {readonly && <span className="text-xs text-muted-foreground">활성 버전은 읽기 전용입니다.</span>}
      </div>

      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
              disabled={!editable}
              aria-label="수량 할인 사용"
            />
            {form.enabled ? '사용' : '사용 안 함'}
          </label>

          <RadioGroup
            className="flex items-center gap-4"
            value={form.periodMode}
            onValueChange={(value) => update({ periodMode: value === 'period' ? 'period' : 'always' })}
            disabled={!editable}
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="always" id="qd-period-always" />
              <Label htmlFor="qd-period-always" className="text-sm font-normal">
                상시
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="period" id="qd-period-range" />
              <Label htmlFor="qd-period-range" className="text-sm font-normal">
                기간 지정
              </Label>
            </div>
          </RadioGroup>

          {form.periodMode === 'period' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input
                type="date"
                aria-label="시작일"
                className="h-8 w-40"
                value={form.startsOn}
                onChange={(e) => update({ startsOn: e.target.value })}
                disabled={!editable}
              />
              <span>~</span>
              <Input
                type="date"
                aria-label="종료일"
                className="h-8 w-40"
                value={form.endsOn}
                onChange={(e) => update({ endsOn: e.target.value })}
                disabled={!editable}
              />
              <span className="text-xs text-muted-foreground">
                한국 시간 기준, 시작일 0시부터 종료일 끝까지. 한쪽은 비워 둘 수 있습니다.
              </span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {form.tiers.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">구간이 없습니다.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">최소 수량</th>
                  <th className="px-3 py-2 text-left">일반 할인</th>
                  <th className="px-3 py-2 text-left">멤버십 할인</th>
                  <th className="px-3 py-2 text-right">
                    결과 가격{representative && variants.length > 1 ? ` (${representative.variant.name})` : ''}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {form.tiers.map((tier, index) => {
                  const position = sortedPositionOf.get(index) ?? index;
                  const regular = representative?.prices.regular[position];
                  const membership = representative?.prices.membership[position];
                  const sortedTier = payload.tiers[position];
                  const messages = uniqueMessages(tierViolations(position));
                  const label = index + 1;
                  return (
                    <tr key={index} data-testid={`tier-row-${position}`} className="border-b align-top">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 text-sm">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={2}
                            aria-label={`${label}구간 최소 수량`}
                            className="h-8 w-20"
                            value={tier.minQuantity}
                            onChange={(e) => updateTier(index, { minQuantity: e.target.value })}
                            onBlur={() => setForm((prev) => ({ ...prev, tiers: sortedRowIndexes(prev.tiers).map((i) => prev.tiers[i]) }))}
                            disabled={!editable}
                          />
                          개 이상
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 text-sm">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={99}
                            placeholder="0"
                            aria-label={`${label}구간 일반 할인`}
                            className="h-8 w-20"
                            value={tier.regularPercent}
                            onChange={(e) => updateTier(index, { regularPercent: e.target.value })}
                            disabled={!editable}
                          />
                          %
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 text-sm">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={99}
                            placeholder="0"
                            aria-label={`${label}구간 멤버십 할인`}
                            className="h-8 w-20"
                            value={tier.membershipPercent}
                            onChange={(e) => updateTier(index, { membershipPercent: e.target.value })}
                            disabled={!editable}
                          />
                          %
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums">
                        {regular && membership && Number.isFinite(regular.price) && Number.isFinite(membership.price) ? (
                          <div className="flex flex-col items-end">
                            <span>
                              일반 <span>{sortedTier?.regularRateBp === 0 ? '할인 없음' : won(regular.price)}</span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              멤버십 <span>{sortedTier?.membershipRateBp === 0 ? '할인 없음' : won(membership.price)}</span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {messages.map((m) => (
                          <p key={m} className="mt-1 text-left text-xs text-destructive">
                            {m}
                          </p>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${label}구간 삭제`}
                            onClick={() => update({ tiers: form.tiers.filter((_, i) => i !== index) })}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {editable && (
            <div className="mt-2 px-3">
              <Button
                size="sm"
                variant="ghost"
                disabled={form.tiers.length >= MAX_QUANTITY_DISCOUNT_TIERS}
                onClick={() => update({ tiers: [...form.tiers, emptyTier()] })}
              >
                <Plus className="mr-1 h-3 w-3" />
                구간 추가
              </Button>
              <span className="text-xs text-muted-foreground">최대 {MAX_QUANTITY_DISCOUNT_TIERS}개</span>
            </div>
          )}
        </div>

        {uniqueMessages(tableViolations).map((m) => (
          <p key={m} className="text-xs text-destructive">
            {m}
          </p>
        ))}

        {variants.length > 1 && payload.tiers.length > 0 && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowAllOptions((v) => !v)}>
              {showAllOptions ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
              옵션별 결과 {showAllOptions ? '접기' : `펼치기 (${variants.length}개)`}
            </Button>
            {showAllOptions && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left">옵션</th>
                      {payload.tiers.map((t, i) => (
                        <th key={i} className="px-3 py-2 text-right">
                          {Number.isFinite(t.minQuantity) ? `${t.minQuantity}개 이상` : '-'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previews.map(({ variant, prices }) => (
                      <tr
                        key={variant.variantId}
                        className={`border-b ${violatingVariant(variant.variantId) ? 'bg-destructive/10' : ''}`}
                      >
                        <td className="px-3 py-2">{variant.name}</td>
                        {prices.regular.map((r, i) => (
                          <td key={i} className="px-3 py-2 text-right tabular-nums">
                            {Number.isFinite(r.price) ? won(r.price) : '-'}
                            <span className="block text-xs text-muted-foreground">
                              {Number.isFinite(prices.membership[i].price) ? won(prices.membership[i].price) : '-'}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
