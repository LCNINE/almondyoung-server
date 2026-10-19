'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import {
  clearPiiNotices,
  markReveal,
  piiBannerText,
  piiNotices,
  subscribePiiNotices,
} from '@/lib/pii/pii-notices';

const EMPTY: ReturnType<typeof piiNotices> = [];

/** 이 화면의 응답에서 개인정보가 가려졌으면 이유를 알리고, 기본 가림 모드의 권한자에게는 [보기]를 준다. */
export function PiiMaskedBanner() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const notices = useSyncExternalStore(subscribePiiNotices, piiNotices, () => EMPTY);

  useEffect(() => {
    clearPiiNotices();
  }, [pathname]);

  const text = piiBannerText(notices);
  if (!text) return null;
  const revealable = notices.filter((notice) => notice.revealable).map((notice) => notice.url);
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-slate-100 px-5 py-2 text-sm text-slate-800">
      <span>{text}</span>
      {revealable.length > 0 && (
        <button
          type="button"
          className="shrink-0 whitespace-nowrap font-semibold underline"
          onClick={() => {
            markReveal(revealable);
            void queryClient.invalidateQueries();
          }}
        >
          보기
        </button>
      )}
    </div>
  );
}
