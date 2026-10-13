'use client';

import { createContext, useContext } from 'react';

/**
 * 편집 폼이 권한 때문에 읽기 전용일 때의 이유. `components/ui` 의 입력 계열이 읽는다 —
 * 텍스트 입력은 `readOnly`(포커스·복사·낭독은 된다), 그 밖의 입력은 비활성. 기본값 null(아무 영향 없음).
 */
export const PermissionReadOnlyContext = createContext<string | null>(null);

export function usePermissionReadOnly(): string | null {
  return useContext(PermissionReadOnlyContext);
}
