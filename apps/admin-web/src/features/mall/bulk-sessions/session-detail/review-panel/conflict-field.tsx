'use client';

import type {
  BulkSessionItemConflict,
  ConflictDecision,
} from '@/lib/types/dto/bulk-session';

interface Props {
  conflict: BulkSessionItemConflict;
  disabled: boolean;
  onDecide: (field: string, decision: ConflictDecision) => void;
}

export function ConflictField({ conflict, disabled, onDecide }: Props) {
  const name = `conflict-${conflict.field}`;
  return (
    <div className="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
      <div className="font-medium">
        충돌 · {conflict.label}
        <span className="ml-2 font-normal text-muted-foreground">
          기준 「{conflict.base}」
        </span>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          disabled={disabled}
          checked={conflict.decision === 'overwrite'}
          onChange={() => onDecide(conflict.field, 'overwrite')}
        />
        <span>내 값 「{conflict.mine}」</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          disabled={disabled}
          checked={conflict.decision === 'skip'}
          onChange={() => onDecide(conflict.field, 'skip')}
        />
        <span>
          현재 값 「{conflict.current}」
          <span className="ml-1 text-muted-foreground">(남이 바꿈)</span>
        </span>
      </label>
      {conflict.decision === null && (
        <p className="text-xs text-amber-700">
          아직 정하지 않았습니다. 「내 값」을 고르면 남의 편집을 되돌립니다.
        </p>
      )}
    </div>
  );
}
