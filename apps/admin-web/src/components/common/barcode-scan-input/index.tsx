'use client';

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface BarcodeScanInputProps {
  value: string;
  onChange: (value: string) => void;
  onScan: (barcode: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * 바코드 스캔 입력 공용 컴포넌트.
 * Enter 키 또는 확인 버튼으로 스캔 이벤트를 발생시킨다.
 * inbound(fullscan-mode), stocktaking, picking, inspection에서 공통 사용.
 */
export function BarcodeScanInput({
  value,
  onChange,
  onScan,
  label = '바코드 스캔',
  placeholder = '바코드를 스캔하거나 입력 후 Enter',
  disabled = false,
  autoFocus = false,
}: BarcodeScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleScan = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onScan(trimmed);
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex gap-2">
      <div className="flex flex-1 flex-col gap-1">
        <Label>{label}</Label>
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleScan();
          }}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </div>
      <Button
        variant="outline"
        className="mt-6"
        onClick={handleScan}
        disabled={disabled || !value.trim()}
        type="button"
      >
        확인
      </Button>
    </div>
  );
}
