'use client';

import { createContext, useContext, type ReactNode } from 'react';

const PiiModeContext = createContext(false);

/** 서버의 `PII_REVEAL_REQUIRED` — 권한자에게도 원문을 [보기] 뒤에만 여는 기본 가림 모드인지. */
export function PiiModeProvider({
  revealRequired,
  children,
}: {
  revealRequired: boolean;
  children: ReactNode;
}) {
  return (
    <PiiModeContext.Provider value={revealRequired}>
      {children}
    </PiiModeContext.Provider>
  );
}

export function usePiiRevealRequired(): boolean {
  return useContext(PiiModeContext);
}
