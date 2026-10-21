'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** 지우기는 두 번 누른다 — 브라우저 확인창 대신 그 자리에서 한 번 더 묻는다. */
export function ConfirmDelete({
  label = '삭제',
  question = '정말 지울까요?',
  disabled,
  onConfirm,
}: {
  label?: string;
  question?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-red-600"
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      {question}
      <Button
        size="sm"
        variant="destructive"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {label}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        취소
      </Button>
    </span>
  );
}
