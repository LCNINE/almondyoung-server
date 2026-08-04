'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  BulkSessionItem,
  ConflictDecision,
} from '@/lib/types/dto/bulk-session';
import { ConflictField } from './conflict-field';

const KIND_LABEL: Record<BulkSessionItem['kind'], string> = {
  create: '신규',
  update: '수정',
};

interface Props {
  item: BulkSessionItem;
  disabled: boolean;
  onDecide: (itemId: string, field: string, decision: ConflictDecision) => void;
}

export function ItemRow({ item, disabled, onDecide }: Props) {
  const [expanded, setExpanded] = useState(false);

  // 서버가 표시용 이름을 직접 붙여 준다(빈 문자열이면 이름을 뽑을 수 없었던 것) — 화면은
  // 대시로 대체한다.
  const displayName = item.productName || '—';

  // 이미 결정 단계를 지난 행(초안 생성 이후)에서는 결정을 더 바꿀 수 없다.
  const conflictsDisabled = disabled || item.status !== 'pending';

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50 ${
          item.status === 'invalid' ? 'text-destructive' : ''
        }`}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span>
          {item.rowNumber} · {item.rowKey} · {KIND_LABEL[item.kind]} ·{' '}
          {displayName} · 변경 {item.changes.length} · 충돌{' '}
          {item.conflicts.length}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 border-t px-3 py-2">
          {item.changes.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {item.changes.map((change) => (
                <li key={change.field}>
                  {change.label} {change.before || '(비움)'} →{' '}
                  {change.after || '(비움)'}
                </li>
              ))}
            </ul>
          )}

          {item.status === 'invalid'
            ? item.errorMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {item.errorMessage}
                </p>
              )
            : item.conflicts.map((conflict) => (
                <ConflictField
                  key={conflict.field}
                  conflict={conflict}
                  disabled={conflictsDisabled}
                  onDecide={(field, decision) =>
                    onDecide(item.id, field, decision)
                  }
                />
              ))}
        </div>
      )}
    </div>
  );
}
