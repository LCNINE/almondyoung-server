'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const KNOWN_RESOURCE_TYPES = [
  'ORDER',
  'PAYMENT',
  'CUSTOMER',
  'MedusaCustomer',
  'FirebaseMembership',
  'PRODUCT',
  'INBOUND',
  'OUTBOUND',
];

interface ResourceTypeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function ResourceTypeFilter({ value, onChange }: ResourceTypeFilterProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-700">리소스 타입</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="타입 선택..." />
        </SelectTrigger>
        <SelectContent>
          {KNOWN_RESOURCE_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
