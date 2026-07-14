'use client';

import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/ui';
import type { ProductOptionGroup } from '@/lib/services/products/products-detail.types';

export type ScopeTargetVariant = { id: string; name: string };

type ScopeTargetType = 'with_option' | 'variants';

interface Props {
  scopeType: ScopeTargetType;
  optionGroups: ProductOptionGroup[];
  variantOptions: ScopeTargetVariant[];
  value: string[];
  onChange: (ids: string[]) => void;
  readonly: boolean;
}

export function RuleScopeTarget({
  scopeType,
  optionGroups,
  variantOptions,
  value,
  onChange,
  readonly,
}: Props) {
  const selected = new Set(value);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange([...next]);
  };

  const count = value.length;
  const isEmpty =
    scopeType === 'with_option'
      ? optionGroups.every((group) => group.values.length === 0)
      : variantOptions.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={readonly}
          className={cn(
            'h-8 w-40 justify-between text-xs font-normal',
            count === 0 && 'border-dashed text-muted-foreground',
          )}
        >
          {count > 0 ? `${count}개 선택됨` : '대상 선택'}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="max-h-64 overflow-y-auto p-1">
          {isEmpty ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              선택할 대상이 없습니다.
            </p>
          ) : scopeType === 'with_option' ? (
            optionGroups.map((group) =>
              group.values.length === 0 ? null : (
                <div key={group.id} className="mb-1 last:mb-0">
                  <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                    {group.displayName}
                  </div>
                  {group.values.map((val) => (
                    <TargetRow
                      key={val.id}
                      label={val.displayName}
                      checked={selected.has(val.id)}
                      onToggle={() => toggle(val.id)}
                    />
                  ))}
                </div>
              ),
            )
          ) : (
            variantOptions.map((variant) => (
              <TargetRow
                key={variant.id}
                label={variant.name}
                checked={selected.has(variant.id)}
                onToggle={() => toggle(variant.id)}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TargetRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className="truncate">{label}</span>
    </label>
  );
}
