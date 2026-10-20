'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HelpCircle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  playAttendanceVoice,
  prepareAttendanceVoice,
} from '../lib/attendance-sound';
import {
  LEAVE_LABELS,
  seoulClock,
  type LocationSample,
} from '@packages/domain-types/attendance';

export function AttendanceCard() {
  const query = useAttendance();
  const me = query.data;
  const punch = useAttendanceAction(attendanceApi.punch);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [now, setNow] = useState<Date | null>(null);
  const lock = useRef(false);
  const links = '/attendance';
  const attempt = useRef<{ kind: 'in' | 'out'; requestId: string } | null>(
    null
  );

  useEffect(() => {
    const refreshClock = () => setNow(new Date());

    refreshClock();

    const timer = window.setInterval(refreshClock, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const clock = now ? seoulClock(now) : '--:--';
  const seconds = now ? String(now.getUTCSeconds()).padStart(2, '0') : '--';
  const dateLabel = now
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(now)
    : (me?.today ?? '');

  async function record() {
    if (!me || lock.current || me.status === 'done') {
      return;
    }

    lock.current = true;

    setBusy(true);

    const kind = me.status === 'working' ? 'out' : 'in';
    const site =
      me.worksites.find((item) => item.id === siteId) ?? me.worksites[0];
    let voiceReady = false;

    try {
      if (!site) {
        throw new Error(
          '근무지가 아직 설정되지 않았어요. 마스터에게 문의해 주세요.'
        );
      }

      if (me.settings.sound) {
        try {
          prepareAttendanceVoice();
          voiceReady = true;
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

      if (voiceReady) {
        void playAttendanceVoice(kind).catch(() => undefined);
      }
    } catch (error) {
      if (!punch.isError) {
        toast.error(attendanceError(error));
      }

      await query.refetch();
    } finally {
      lock.current = false;

      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      aria-busy={query.isPending}
    >
      <div className="mb-6 flex items-center gap-2">
        <h1 className="text-lg font-bold">오늘의 근무</h1>
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
        {me && (
          <span
            className={`ml-auto rounded-md px-2 py-1 text-xs font-medium ${me.status === 'working' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
          >
            {describeStatus(me.status)}
          </span>
        )}
        {query.isPending && (
          <Skeleton className="ml-auto h-6 w-20" aria-hidden />
        )}
      </div>
      {query.isPending ? (
        <AttendanceCardSkeleton />
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
              {me.leave && (
                <p className="mt-1 text-xs text-slate-500">
                  {LEAVE_LABELS[me.leave.type]}
                </p>
              )}
            </div>
          </div>
          <div className="my-7">
            <p
              className="text-4xl font-semibold tracking-tight tabular-nums"
              aria-label="현재 한국 시각"
            >
              {clock}
              <span className="text-xl font-normal text-slate-400">
                :{seconds}
              </span>
            </p>
            <p className="mt-2 text-xs text-slate-500">{dateLabel}</p>
          </div>
          <div className="mb-6 divide-y border-y border-slate-100">
            <div className="flex items-center justify-between py-4">
              <p className="text-xs text-slate-500">출근</p>
              <p className="text-sm font-medium tabular-nums">
                {formatAttendanceTime(me.session?.checkIn)}
              </p>
            </div>
            <div className="flex items-center justify-between py-4">
              <p className="text-xs text-slate-500">퇴근</p>
              <p className="text-sm font-medium tabular-nums">
                {formatAttendanceTime(me.session?.checkOut)}
              </p>
            </div>
          </div>
          {me.session && me.session.workDate !== me.today && (
            <p className="mb-4 text-xs text-amber-700">
              {me.session.workDate}에 시작한 근무예요.
            </p>
          )}
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
              className="h-12 w-full rounded-xl bg-indigo-600 text-base hover:bg-indigo-700"
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
                  ? me.isMaster
                    ? '근무지를 등록하면 출근을 기록할 수 있어요.'
                    : '관리자가 근무지를 등록하면 출근을 기록할 수 있어요.'
                  : '버튼을 누를 때만 현재 위치를 확인해요.'}
            </p>
            {me.isMaster && !me.worksites.length && (
              <Link
                prefetch={true}
                href={`${links}/worksites`}
                className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                근무지 등록하기
              </Link>
            )}
          </>
          <nav
            aria-label="출결 메뉴"
            className="mt-5 grid grid-cols-2 gap-2 text-sm font-medium text-slate-600 [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:justify-center [&_a]:rounded-lg [&_a]:bg-slate-50 [&_a]:px-2 [&_a]:py-2 [&_a]:text-center [&_a]:focus-visible:outline-none [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-indigo-500 [&_a]:active:bg-slate-100"
          >
            <Link prefetch={true} href={`${links}/records`}>
              내 기록
            </Link>
            <Link prefetch={true} href={`${links}/calendar`}>
              내 일정
            </Link>
            <Link prefetch={true} href={`${links}/requests`}>
              정정 / 예외 요청
            </Link>
            <Link prefetch={true} href={`${links}/settings`}>
              알림 설정
            </Link>
            {me.isMaster && (
              <Link
                prefetch={true}
                className="col-span-2"
                href={`${links}/review`}
              >
                요청 검토
              </Link>
            )}
            {me.isMaster && (
              <Link className="col-span-2" href={`${links}/statistics`}>
                월별 통계
              </Link>
            )}
            {me.isMaster && me.worksites.length > 0 && (
              <Link className="col-span-2" href={`${links}/worksites`}>
                근무지 관리
              </Link>
            )}
          </nav>
        </>
      ) : null}
    </section>
  );
}

function AttendanceCardSkeleton() {
  return (
    <div className="motion-reduce:[&_[data-slot=skeleton]]:animate-none">
      <span className="sr-only" role="status">
        근무 기록을 불러오는 중이에요.
      </span>
      <div aria-hidden>
        <div className="flex h-11 items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="my-7">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="mt-2 h-4 w-36" />
        </div>
        <div className="mb-6 divide-y border-y border-slate-100">
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center justify-between py-4">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-5 w-14" />
            </div>
          ))}
        </div>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="mx-auto mt-3 h-6 w-48 max-w-full" />
        <div className="mt-5 grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
