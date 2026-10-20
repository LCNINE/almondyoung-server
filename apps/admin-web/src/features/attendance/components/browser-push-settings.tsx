'use client';

import { useState } from 'react';
import { BellRing, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  disableAttendancePush,
  enableAttendancePush,
} from '../lib/browser-push';

export function BrowserPushSettings() {
  const [action, setAction] = useState<'connect' | 'disconnect' | null>(null);

  async function change(enabled: boolean) {
    setAction(enabled ? 'connect' : 'disconnect');

    try {
      await (enabled ? enableAttendancePush() : disableAttendancePush());

      toast.success(
        enabled ? '이 기기에 알림을 연결했어요.' : '이 기기 알림을 해제했어요.'
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200/70 bg-white">
      <div className="p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            <Smartphone className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-bold leading-6 text-slate-900">
              이 기기 알림
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              지금 사용하는 기기에서 출퇴근 알림을 받아요.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Button
            className="h-12 rounded-2xl bg-indigo-50 px-5 font-semibold text-indigo-700 hover:bg-indigo-100"
            disabled={action !== null}
            onClick={() => change(true)}
          >
            <BellRing className="size-4" aria-hidden />
            {action === 'connect' ? '연결 중…' : '알림 연결하기'}
          </Button>
          <Button
            className="h-12 rounded-2xl px-5 text-slate-500"
            variant="ghost"
            disabled={action !== null}
            onClick={() => change(false)}
          >
            {action === 'disconnect' ? '해제 중…' : '이 기기 알림 끄기'}
          </Button>
        </div>
        <p className="mt-4 text-xs leading-6 text-slate-400">
          연결하기를 누른 뒤 기기의 알림 권한을 허용해 주세요. 기기 알림 연결과
          해제는 바로 적용돼요.
        </p>
      </div>
      <details className="group border-t border-slate-100 bg-slate-50/70 px-5 sm:px-6">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-500 [&::-webkit-details-marker]:hidden">
          휴대폰에서 알림 받는 방법
          <span
            aria-hidden
            className="text-base transition-transform group-open:rotate-45"
          >
            +
          </span>
        </summary>
        <div className="space-y-2 pb-5 text-xs leading-6 text-slate-500">
          <p>
            iPhone은 Safari에서 출결 페이지를 열고 공유 → 홈 화면에 추가한 뒤
            실행해 주세요.
          </p>
          <p>
            Android는 브라우저 메뉴에서 홈 화면 추가 또는 앱 설치를 선택해
            주세요.
          </p>
          <p>알림 도착 시각은 기기와 네트워크 상태에 따라 달라질 수 있어요.</p>
        </div>
      </details>
    </section>
  );
}
