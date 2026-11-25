import { useCallback, useEffect, useRef, useState } from 'react';

const TOAST_MS = 2000;

export interface InboundToast {
  kind: 'saved' | 'cancelled';
  /** 무엇을 몇 개 — 「이쑤시개 면봉 100개입 12개」 */
  detail: string;
}

export function useSaveToast() {
  const [toast, setToast] = useState<InboundToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((next: InboundToast) => {
    clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show };
}

/** 품목 하나면 「이름 N개」, 여럿이면 「첫 이름 외 N건」 */
export function inboundToastDetail(items: readonly { name: string; quantity: number }[]): string {
  const [first, ...rest] = items;
  if (!first) {
    return '';
  }

  return rest.length === 0 ? `${first.name} ${first.quantity}개` : `${first.name} 외 ${rest.length}건`;
}

const LOOK = {
  saved: { title: '입고 완료', card: 'bg-green-700', detail: 'text-green-100' },
  cancelled: { title: '입고 취소', card: 'bg-gray-800', detail: 'text-gray-300' },
} as const;

function SavedIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M7.5 12.5l3 3 6-6.5" />
    </svg>
  );
}

function CancelledIcon() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function SaveToast({ toast }: { toast: InboundToast | null }) {
  if (!toast) {
    return null;
  }

  const look = LOOK[toast.kind];

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-gray-900/10">
      <div
        role="status"
        className={`flex flex-col items-center gap-2.5 rounded-2xl px-9 py-7 text-white shadow-2xl ${look.card}`}
      >
        {toast.kind === 'saved' ? <SavedIcon /> : <CancelledIcon />}
        <span className="text-2xl font-bold">{look.title}</span>
        {toast.detail ? <span className={`text-base ${look.detail}`}>{toast.detail}</span> : null}
      </div>
    </div>
  );
}
