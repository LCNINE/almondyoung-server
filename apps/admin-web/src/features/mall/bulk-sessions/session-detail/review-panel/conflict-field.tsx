'use client';

import { BlockedReason } from '@/components/auth/blocked-reason';
import type {
  BulkSessionItemConflict,
  ConflictDecision,
} from '@/lib/types/dto/bulk-session';

interface Props {
  conflict: BulkSessionItemConflict;
  disabled: boolean;
  /** 권한이 없으면 고른 값은 보이고 바꾸지 못한다. */
  blockedReason: string | null;
  onDecide: (field: string, decision: ConflictDecision) => void;
}

export function ConflictField({ conflict, disabled, blockedReason, onDecide }: Props) {
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
        <BlockedReason reason={blockedReason}>
          {(blocked) => (
            <input
              {...blocked}
              type="radio"
              name={name}
              disabled={disabled}
              checked={conflict.decision === 'overwrite'}
              onChange={() => {
                if (!blockedReason) onDecide(conflict.field, 'overwrite');
              }}
            />
          )}
        </BlockedReason>
        <span>내 값 「{conflict.mine}」</span>
      </label>
      <label className="flex items-center gap-2">
        <BlockedReason reason={blockedReason}>
          {(blocked) => (
            <input
              {...blocked}
              type="radio"
              name={name}
              disabled={disabled}
              checked={conflict.decision === 'skip'}
              onChange={() => {
                if (!blockedReason) onDecide(conflict.field, 'skip');
              }}
            />
          )}
        </BlockedReason>
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
