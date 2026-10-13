'use client';

import type { PermissionedAction } from '@/lib/auth/mutation-permission';
import { blockedReason } from '@/lib/auth/permission-check';
import { useCanRun } from '@/hooks/use-permission';
import { PermissionReadOnlyContext } from './permission-read-only-context';

const isActionList = (run: PermissionedAction | readonly PermissionedAction[]): run is readonly PermissionedAction[] => Array.isArray(run);

/**
 * 편집 폼을 권한이 허용으로 확인될 때까지 읽기 전용으로 둔다. 레이아웃 상자를 만들지 않는다.
 * 권한이 없거나 조회에 실패했으면 폼 위에 «보기 전용» 안내를 붙인다(확인 중엔 문구 없이 잠깐 읽기 전용).
 * 저장 버튼은 따로 `<Can run>` 으로 숨긴다.
 */
export function PermissionReadOnly({ run, children }: { run: PermissionedAction | readonly PermissionedAction[]; children: React.ReactNode }) {
  const list = isActionList(run) ? run : [run];
  const state = useCanRun(...list);
  const reason = blockedReason(state, list);
  return (
    <PermissionReadOnlyContext.Provider value={reason}>
      {reason !== null && state.status !== 'loading' && (
        <p role="note" className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          보기 전용 — {reason}
        </p>
      )}
      {children}
    </PermissionReadOnlyContext.Provider>
  );
}
