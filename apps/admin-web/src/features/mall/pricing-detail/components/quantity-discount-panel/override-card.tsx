'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { OverrideForm } from '@/lib/pricing/quantity-discount';
import { TierTable, type TierPreviewBasis } from './tier-table';

export interface OptionChoice {
  combination: string;
  name: string;
}

interface OverrideCardProps {
  card: OverrideForm;
  /** 1부터. 칸 이름(«예외 1 · 1구간 …»)과 제목에 쓴다. */
  number: number;
  options: OptionChoice[];
  /** 다른 카드가 이미 고른 조합. */
  takenElsewhere: ReadonlySet<string>;
  editable: boolean;
  preview: TierPreviewBasis | null;
  messagesAt: (sortedIndex: number) => string[];
  cardMessages: string[];
  maxQuantity: number | null;
  onChange: (card: OverrideForm) => void;
  onRemove: () => void;
}

export function OverrideCard({
  card,
  number,
  options,
  takenElsewhere,
  editable,
  preview,
  messagesAt,
  cardMessages,
  maxQuantity,
  onChange,
  onRemove,
}: OverrideCardProps) {
  const prefix = `예외 ${number} · `;
  const selected = new Set(card.combinations);
  const toggle = (combination: string, checked: boolean) =>
    onChange({
      ...card,
      combinations: checked
        ? [...card.combinations, combination]
        : card.combinations.filter((c) => c !== combination),
    });

  return (
    <section
      aria-label={`예외 ${number}`}
      data-testid={`override-card-${number}`}
      className="rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">예외 {number}</span>
        {editable && (
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRemove}>
            <Trash2 className="mr-1 h-3 w-3" />
            예외 {number} 삭제
          </Button>
        )}
      </div>

      <fieldset className="mt-2">
        <legend className="text-xs text-muted-foreground">적용할 옵션</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
          {options.map((o) => {
            const taken = takenElsewhere.has(o.combination);
            const id = `qd-${card.key}-${o.combination}`;
            return (
              <div key={o.combination} className="flex items-center gap-1.5">
                <Checkbox
                  id={id}
                  checked={selected.has(o.combination)}
                  disabled={!editable || taken}
                  onCheckedChange={(checked) => toggle(o.combination, checked === true)}
                />
                <Label htmlFor={id} className={`text-sm font-normal ${taken ? 'text-muted-foreground' : ''}`}>
                  {o.name}
                  {taken && ' (다른 예외)'}
                </Label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <RadioGroup
        className="mt-3 flex items-center gap-4"
        value={card.mode}
        onValueChange={(value) => onChange({ ...card, mode: value === 'none' ? 'none' : 'tiers' })}
        disabled={!editable}
        aria-label={`예외 ${number} 방식`}
      >
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="tiers" id={`qd-${card.key}-tiers`} />
          <Label htmlFor={`qd-${card.key}-tiers`} className="text-sm font-normal">
            다른 구간
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="none" id={`qd-${card.key}-none`} />
          <Label htmlFor={`qd-${card.key}-none`} className="text-sm font-normal">
            할인 없음
          </Label>
        </div>
      </RadioGroup>

      {card.mode === 'tiers' ? (
        <div className="mt-2">
          <TierTable
            rows={card.tiers}
            onChange={(tiers) => onChange({ ...card, tiers })}
            editable={editable}
            preview={preview}
            namePreview={card.combinations.length > 1}
            messagesAt={messagesAt}
            maxQuantity={maxQuantity}
            labelPrefix={prefix}
            testIdPrefix={`override-${number}-`}
          />
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">고른 옵션은 몇 개를 사도 수량 할인이 없습니다.</p>
      )}

      {cardMessages.map((m) => (
        <p key={m} className="mt-2 text-xs text-destructive">
          {m}
        </p>
      ))}
    </section>
  );
}
