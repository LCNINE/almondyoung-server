'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  disableAttendancePush,
  enableAttendancePush,
  sendAttendanceTestPush,
} from '../lib/browser-push';

export function BrowserPushSettings() {
  const [action, setAction] = useState<
    'connect' | 'disconnect' | 'test' | null
  >(null);

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

  async function sendTest() {
    setAction('test');

    try {
      await sendAttendanceTestPush();

      toast.success('테스트 알림을 보냈어요. 알림 센터를 확인해 주세요.');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setAction(null);
    }
  }

  return (
    <section className="max-w-xl space-y-4 rounded-2xl border bg-white p-6">
      <h2 className="text-sm font-semibold">이 기기 알림</h2>
      <p className="text-xs leading-6 text-slate-400">
        iPhone은 Safari에서 출결 페이지를 열고 공유 → 홈 화면에 추가한 뒤 실행해
        주세요. Android는 브라우저 메뉴에서 홈 화면 추가 또는 앱 설치를 선택해
        주세요. 알림 도착 시각은 기기와 네트워크 상태에 따라 달라질 수 있어요.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button
          className="min-h-11"
          disabled={action !== null}
          onClick={() => change(true)}
        >
          알림 연결하기
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={action !== null}
          onClick={sendTest}
        >
          {action === 'test' ? '보내는 중…' : '테스트 알림 보내기'}
        </Button>
        <Button
          className="min-h-11"
          variant="outline"
          disabled={action !== null}
          onClick={() => change(false)}
        >
          이 기기 알림 끄기
        </Button>
      </div>
      <p className="text-xs leading-6 text-slate-400">
        알림을 연결한 뒤 테스트해 보세요. 이 기기로 테스트 알림을 보내요.
      </p>
    </section>
  );
}
