'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import {
  formFromResponse,
  formToPayload,
  isEmptyQuantityDiscount,
  newOverrideKey,
  overrideProblems,
  sortTiers,
  tiersForCombination,
  validateQuantityDiscount,
  violationMessage,
  type OverrideForm,
  type QuantityDiscountDto,
  type QuantityDiscountForm,
  type QuantityDiscountViolation,
  type UpsertQuantityDiscountDto,
} from '@/lib/pricing/quantity-discount';
import { TierTable } from './tier-table';
import { OverrideCard } from './override-card';
import { OptionResults, type OptionResultRow } from './option-results';

export interface PreviewVariant {
  variantId: string;
  name: string;
  basePrice: number;
  membershipPrice: number;
  /** 옵션값 id 정렬 «+» 결합. 옵션 없는 상품은 ''. */
  combination: string;
}

export interface QuantityDiscountPanelProps {
  saved: QuantityDiscountDto | null | undefined;
  variants: PreviewVariant[];
  /** 버전의 최대구매수량. 없으면 null. */
  maxQuantity?: number | null;
  /** 버전 상태(draft 아님) 때문에 편집할 수 없다. */
  readonly: boolean;
  canSave: boolean;
  isSaving: boolean;
  serverViolations: QuantityDiscountViolation[];
  onSave: (dto: UpsertQuantityDiscountDto) => void;
}

const uniq = (list: string[]) => [...new Set(list)];

export function QuantityDiscountPanel({
  saved,
  variants,
  maxQuantity = null,
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
  useEffect(() => {
    setForm(formFromResponse(saved));
  }, [saved]);

  const editable = !readonly && canSave;
  const payload = useMemo(() => formToPayload(form), [form]);
  const empty = isEmptyQuantityDiscount(payload);
  const violations = useMemo(
    () => (empty ? [] : validateQuantityDiscount(payload, variants)),
    [empty, payload, variants],
  );
  const problems = useMemo(() => overrideProblems(form), [form]);
  const allViolations = editedSinceServerCheck ? violations : [...violations, ...serverViolations];

  const cardOf = (combination: string | undefined) =>
    combination === undefined ? undefined : form.overrides.find((c) => c.combinations.includes(combination));
  const variantName = (id?: string) => variants.find((v) => v.variantId === id)?.name;
  const messages = (list: QuantityDiscountViolation[]) =>
    uniq(list.map((v) => violationMessage(v, variantName(v.variantId))));
  const violationsOf = (card: OverrideForm | undefined) =>
    allViolations.filter((v) => cardOf(v.combination)?.key === card?.key);
  const rowMessages = (card: OverrideForm | undefined) => (sortedIndex: number) =>
    messages(violationsOf(card).filter((v) => v.tierIndex === sortedIndex));
  const tableMessages = messages(allViolations.filter((v) => v.tierIndex === undefined && v.combination === undefined));

  const update = (patch: Partial<QuantityDiscountForm>) => {
    setEditedSinceServerCheck(true);
    setForm((prev) => ({ ...prev, ...patch }));
  };
  const updateCard = (card: OverrideForm) =>
    update({ overrides: form.overrides.map((c) => (c.key === card.key ? card : c)) });

  const hasOptions = variants.length > 1;
  const live = new Set(variants.map((v) => v.combination));
  const staleCount = variants.length === 0 ? 0 : uniq(form.overrides.flatMap((c) => c.combinations)).filter((c) => !live.has(c)).length;
  const basePreview = variants.find((v) => !cardOf(v.combination)) ?? null;
  const options = variants.map((v) => ({ combination: v.combination, name: v.name }));

  const optionRows: OptionResultRow[] = variants.map((v) => {
    const card = cardOf(v.combination);
    const number = card ? form.overrides.indexOf(card) + 1 : 0;
    return {
      ...v,
      source: card ? `예외 ${number}` : '기본',
      tiers: sortTiers(tiersForCombination(payload, v.combination)),
      violating: allViolations.some((x) => x.code === 'MEMBER_PRICE_ABOVE_REGULAR' && x.variantId === v.variantId),
    };
  });

  const canSubmit = editable && !isSaving && !empty && violations.length === 0 && problems.length === 0;

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
                onClick={() => onSave({ ...payload, tiers: [], variantOverrides: [] })}
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

        <div>
          {hasOptions && (
            <div className="mb-1">
              <span className="text-sm font-medium">기본 구간</span>
              <p className="text-xs text-muted-foreground">
                {form.tiers.length === 0 && form.overrides.length > 0
                  ? '기본: 할인 없음 — 예외로 고른 옵션만 할인됩니다.'
                  : '아래 예외로 고르지 않은 옵션 전부에 적용됩니다.'}
              </p>
            </div>
          )}
          <TierTable
            rows={form.tiers}
            onChange={(tiers) => update({ tiers })}
            editable={editable}
            preview={basePreview}
            namePreview={hasOptions}
            messagesAt={rowMessages(undefined)}
            maxQuantity={maxQuantity}
          />
        </div>

        {tableMessages.map((m) => (
          <p key={m} className="text-xs text-destructive">
            {m}
          </p>
        ))}

        {(hasOptions || form.overrides.length > 0) && (
          <div className="flex flex-col gap-2">
            <div>
              <span className="text-sm font-medium">옵션별 예외</span>
              <p className="text-xs text-muted-foreground">
                고른 옵션만 다른 구간을 쓰거나 할인하지 않습니다. 사용·기간은 모든 옵션이 같습니다.
              </p>
            </div>
            {form.overrides.map((card, i) => (
              <OverrideCard
                key={card.key}
                card={card}
                number={i + 1}
                options={options}
                takenElsewhere={
                  new Set(form.overrides.filter((c) => c.key !== card.key).flatMap((c) => c.combinations))
                }
                editable={editable}
                preview={variants.find((v) => card.combinations.includes(v.combination)) ?? null}
                messagesAt={rowMessages(card)}
                cardMessages={[
                  ...problems.filter((p) => p.key === card.key).map((p) => p.message),
                  ...messages(violationsOf(card).filter((v) => v.tierIndex === undefined)),
                ]}
                maxQuantity={maxQuantity}
                onChange={updateCard}
                onRemove={() => update({ overrides: form.overrides.filter((c) => c.key !== card.key) })}
              />
            ))}
            {staleCount > 0 && (
              <p className="text-xs text-muted-foreground">
                이 버전에 없는 옵션 {staleCount}개의 예외는 저장할 때 지워집니다.
              </p>
            )}
            {editable && hasOptions && (
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    update({
                      overrides: [...form.overrides, { key: newOverrideKey(), combinations: [], mode: 'tiers', tiers: [] }],
                    })
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  예외 추가
                </Button>
              </div>
            )}
          </div>
        )}

        {hasOptions && !empty && (
          <div>
            <Button size="sm" variant="ghost" onClick={() => setShowAllOptions((v) => !v)}>
              {showAllOptions ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
              옵션별 결과 {showAllOptions ? '접기' : `펼치기 (${variants.length}개)`}
            </Button>
            {showAllOptions && <OptionResults rows={optionRows} />}
          </div>
        )}
      </div>
    </div>
  );
}
