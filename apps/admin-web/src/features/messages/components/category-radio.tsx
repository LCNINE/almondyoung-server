'use client';

import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { SmsGateCategory } from '@/lib/api/domains/sms-gate';

export function CategoryRadio({
  value,
  onChange,
}: {
  value: SmsGateCategory;
  onChange: (value: SmsGateCategory) => void;
}) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as SmsGateCategory)} className="flex gap-6">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="INFORMATIONAL" id="category-info" />
        <Label htmlFor="category-info" className="font-normal">
          정보
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="MARKETING" id="category-marketing" />
        <Label htmlFor="category-marketing" className="font-normal">
          광고
        </Label>
      </div>
    </RadioGroup>
  );
}
