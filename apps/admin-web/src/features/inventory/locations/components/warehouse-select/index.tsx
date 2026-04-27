'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWarehouses } from '@/lib/services/inventory';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  value: string;
  onValueChange: (value: string) => void;
};

export function WarehouseSelect({ value, onValueChange }: Props) {
  const { data: warehouses } = useWarehouses();

  useEffect(() => {
    if (!value && warehouses && warehouses.length > 0) {
      onValueChange(warehouses[0].id);
    }
  }, [warehouses, value, onValueChange]);

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="창고 선택" />
      </SelectTrigger>
      <SelectContent>
        {(warehouses ?? []).map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
