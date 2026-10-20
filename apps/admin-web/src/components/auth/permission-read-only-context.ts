'use client';

import { createContext, useContext } from 'react';
import { readOnlyControl, type ReadOnlyControl } from '@/lib/auth/read-only-control';

/**
 * 편집 폼이 권한 때문에 읽기 전용일 때의 이유. `components/ui` 의 입력 계열이 읽는다 —
 * 텍스트 입력은 `readOnly`(포커스·복사·낭독은 된다), 그 밖의 입력은 비활성. 기본값 null(아무 영향 없음).
 */
export const PermissionReadOnlyContext = createContext<string | null>(null);

export function usePermissionReadOnly(): string | null {
  return useContext(PermissionReadOnlyContext);
}

/** 폼 위 «보기 전용» 안내의 id — 비텍스트 컨트롤이 `aria-describedby` 로 잇는다. 안내가 없으면 null. */
export const PermissionReadOnlyNoteContext = createContext<string | null>(null);

/** 비텍스트 컨트롤(체크박스·스위치·라디오·셀렉트)이 권한 읽기 전용 문맥에서 쓸 속성. */
export function useReadOnlyControl(disabled?: boolean): ReadOnlyControl {
  const readOnly = useContext(PermissionReadOnlyContext) !== null;
  const noteId = useContext(PermissionReadOnlyNoteContext) ?? undefined;
  return readOnlyControl({ readOnly, disabled, noteId });
}
