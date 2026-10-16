'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, Check, Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { attendanceApi } from '@/lib/api/domains/attendance';
import {
  useAttendance,
  useAttendanceAction,
  attendanceError,
} from '../hooks/use-attendance';
import { describeStatus, formatAttendanceTime } from '../lib/attendance-model';
import { toast } from 'sonner';
import type { LocationSample } from '@packages/domain-types/attendance';

export function AttendanceCard({ mobile = false }: { mobile?: boolean }) {
  const query = useAttendance();
  const me = query.data;
  const punch = useAttendanceAction(attendanceApi.punch);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [siteId, setSiteId] = useState('');
  const lock = useRef(false);
  const links = mobile ? '/attendance' : '/company/attendance';
  const attempt = useRef<{ kind: 'in' | 'out'; requestId: string } | null>(
    null
  );

  async function record() {
    if (!me || lock.current || me.status === 'done') {
      return;
    }

    lock.current = true;

    setBusy(true);

    const kind = me.status === 'working' ? 'out' : 'in';
    const site =
      me.worksites.find((item) => item.id === siteId) ?? me.worksites[0];
    let sound: AudioContext | undefined;

    try {
      if (!site) {
        throw new Error(
          '근무지가 아직 설정되지 않았어요. 마스터에게 문의해 주세요.'
        );
      }

      if (me.settings.sound) {
        try {
          sound = new AudioContext();

          await sound.resume();
        } catch {
          /* Recording works even if sound is unavailable. */
        }
      }

      if (!navigator.geolocation) {
        throw new Error('위치를 지원하는 휴대폰 브라우저로 열어 주세요.');
      }

      const location = await new Promise<LocationSample>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (point) =>
            resolve({
              latitude: point.coords.latitude,
              longitude: point.coords.longitude,
              accuracy: point.coords.accuracy,
              timestamp: point.timestamp,
            }),
          (error) =>
            reject(
              new Error(
                error.code === 1
                  ? '위치 권한을 허용하고 다시 눌러 주세요.'
                  : '위치를 확인하지 못했어요. 창가 등에서 다시 시도해 주세요.'
              )
            ),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
      });

      if (!attempt.current || attempt.current.kind !== kind) {
        attempt.current = { kind, requestId: crypto.randomUUID() };
      }

      await punch.mutateAsync({
        ...attempt.current,
        siteId: site.id,
        location,
      });

      attempt.current = null;

      setComplete(true);

      toast.success(
        kind === 'in' ? '출근을 기록했어요.' : '퇴근을 기록했어요. 수고했어요!'
      );

      if (sound) {
        const gain = sound.createGain();

        gain.gain.setValueAtTime(0.06, sound.currentTime);

        gain.gain.exponentialRampToValueAtTime(0.001, sound.currentTime + 0.35);

        const tone = sound.createOscillator();

        tone.frequency.setValueAtTime(
          kind === 'in' ? 660 : 520,
          sound.currentTime
        );

        tone.frequency.setValueAtTime(
          kind === 'in' ? 880 : 440,
          sound.currentTime + 0.12
        );

        tone.connect(gain).connect(sound.destination);

        tone.start();

        tone.stop(sound.currentTime + 0.35);
      }
    } catch (error) {
      if (!punch.isError) {
        toast.error(attendanceError(error));
      }

      await query.refetch();
    } finally {
      if (sound) {
        window.setTimeout(() => void sound?.close(), 500);
      }

      lock.current = false;

      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-bold">오늘의 근무</h2>
        <Dialog>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="출퇴근 기록 안내">
              <HelpCircle className="size-4 text-slate-400" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>출퇴근 기록 안내</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm leading-7 text-slate-600">
              <p>
                본인 계정과 개인 휴대폰으로 기록해 주세요. 버튼을 누를 때 회사
                위치를 확인하고 기록해요. 근무 중 위치를 계속 추적하지 않아요.
              </p>
              <p>
                대리 출퇴근이나 허위 기록은 금지돼요. 위반 사실이 확인되면 관련
                법령과 취업규칙에 따라 징계 대상이 될 수 있어요.
              </p>
              <p>
                기록이 누락되거나 위치 확인에 실패했다면 정정 / 예외 요청을 남겨
                주세요.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {query.isPending ? (
        <p className="py-8 text-sm text-slate-400">기록을 불러오고 있어요.</p>
      ) : query.isError ? (
        <div className="space-y-3">
          <p className="text-sm text-red-600">기록을 불러오지 못했어요.</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            다시 시도
          </Button>
        </div>
      ) : me ? (
        <>
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-full bg-indigo-50 font-semibold text-indigo-600">
              {me.name.slice(0, 1)}
            </div>
            <div>
              <p className="font-semibold">{me.name}</p>
              <p className="mt-1 text-xs text-slate-400">
                {me.today} · {describeStatus(me.status, me.leave?.type)}
              </p>
            </div>
          </div>
          <div className="my-7 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4">
            <div>
              <p className="text-xs text-slate-400">출근</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatAttendanceTime(me.session?.checkIn)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">퇴근</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatAttendanceTime(me.session?.checkOut)}
              </p>
            </div>
          </div>
          {me.session && me.session.workDate !== me.today && (
            <p className="mb-4 text-xs text-amber-700">
              {me.session.workDate}에 시작한 근무예요.
            </p>
          )}
          {mobile ? (
            <>
              {me.worksites.length > 1 && (
                <label className="mb-4 block text-sm">
                  근무지
                  <select
                    aria-label="근무지"
                    className="mt-2 w-full rounded-lg border p-3"
                    value={siteId || me.worksites[0].id}
                    onChange={(event) => setSiteId(event.target.value)}
                  >
                    {me.worksites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                className="h-14 w-full rounded-xl bg-indigo-600 text-base hover:bg-indigo-700"
                disabled={busy || me.status === 'done' || !me.worksites.length}
                onClick={record}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    위치 확인 · 기록 중
                  </>
                ) : me.status === 'done' ? (
                  <>
                    <Check className="mr-2 size-4" />
                    오늘 근무 완료
                  </>
                ) : me.status === 'working' ? (
                  '퇴근하기'
                ) : (
                  '출근하기'
                )}
              </Button>
              <p
                className="mt-3 text-center text-xs leading-6 text-slate-400"
                role="status"
              >
                {complete
                  ? '기록이 저장됐어요.'
                  : !me.worksites.length
                    ? '마스터의 근무지 설정이 필요해요.'
                    : '버튼을 누를 때만 현재 위치를 확인해요.'}
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-4">
              <p className="mb-3 flex items-center gap-2 text-sm">
                <Smartphone className="size-4" />
                출퇴근은 개인 휴대폰에서 기록해요.
              </p>
              <Link
                href="/attendance"
                className="text-sm font-medium text-indigo-600"
              >
                모바일 출결 페이지 열기 →
              </Link>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-x-4 gap-y-3 text-xs font-medium text-slate-500">
            <Link href={`${links}/records`}>내 기록</Link>
            <Link href={`${links}/calendar`}>
              {mobile ? '내 일정' : '공유 캘린더'}
            </Link>
            <Link href={`${links}/requests`}>정정 / 예외 요청</Link>
            <Link href={`${links}/settings`}>알림 설정</Link>
          </div>
        </>
      ) : null}
    </section>
  );
}
