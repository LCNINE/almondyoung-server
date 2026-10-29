'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { usePiiRevealRequired } from '@/components/pii/pii-mode-context';
import { revealPhaseOf, subscribeReveal } from '@/lib/pii/pii-notices';
import { leaveRevealedScreen, revealScreen } from '@/lib/pii/pii-reveal-cleanup';
import { piiNoticeStatus, resolvePiiScreen, standingPiiNotice, type RevealPhase } from '@/lib/pii/pii-screens';
import { useMyPermissions } from '@/lib/services/users';

const NONE: ReadonlySet<string> = new Set();
const idleOnServer = (): RevealPhase => 'idle';

/** 이 화면이 개인정보를 보이는 화면이면 보는 사람의 권한과 가림 모드에 따라 상시 안내를 띄운다. */
export function PiiMaskedBanner() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const permissionsQuery = useMyPermissions();
  const revealRequired = usePiiRevealRequired();
  const reveal = useSyncExternalStore(
    subscribeReveal,
    () => revealPhaseOf(pathname),
    idleOnServer,
  );

  // 경로가 바뀌거나 셸 밖 화면으로 나가 언마운트될 때 — 둘 다 cleanup 이 돈다.
  useEffect(() => () => leaveRevealedScreen(queryClient), [pathname, queryClient]);

  const notice = standingPiiNotice({
    status: piiNoticeStatus(permissionsQuery),
    held: permissionsQuery.data?.permissions ?? NONE,
    screen: resolvePiiScreen(pathname),
    revealRequired,
    reveal,
  });
  if (!notice) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 bg-slate-100 px-5 py-2 text-sm text-slate-800">
      <span>{notice.text}</span>
      {notice.showReveal && (
        <button
          type="button"
          className="shrink-0 whitespace-nowrap font-semibold underline"
          onClick={() => void revealScreen(queryClient, pathname)}
        >
          보기
        </button>
      )}
    </div>
  );
}
