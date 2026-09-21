'use client';

import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { NAME_VARIABLE } from '../lib/sms-body';

export function NameVariableButton({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}) {
  const handleClick = () => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + NAME_VARIABLE + value.slice(end));
    requestAnimationFrame(() => {
      const cursor = start + NAME_VARIABLE.length;
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick}>
      {NAME_VARIABLE} 넣기
    </Button>
  );
}
