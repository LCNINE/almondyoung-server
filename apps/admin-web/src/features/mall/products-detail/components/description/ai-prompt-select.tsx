'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AiPromptPresetDto } from '@/lib/api/domains/products/ai-prompts.client';

/** 저장된 양식을 고르지 않은 상태 — 코드에 내장된 기본 프롬프트를 쓴다. */
export const BUILTIN_PRESET_VALUE = '__builtin__';

type Props = {
  presets: AiPromptPresetDto[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function AiPromptSelect({ presets, value, disabled, onChange }: Props) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-[200px]">
        <SelectValue placeholder="프롬프트 양식" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={BUILTIN_PRESET_VALUE}>기본 양식</SelectItem>
        {presets.map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            {preset.title}
            {preset.ownerName ? ` · ${preset.ownerName}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
