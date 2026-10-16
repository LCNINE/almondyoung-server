'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { attendanceApi } from '@/lib/api/domains/attendance';
import {
  ATTENDANCE_KEY,
  attendanceError,
  useAttendance,
  useAttendanceAction,
} from '../hooks/use-attendance';
import {
  normalSchedule,
  seoulDate,
  validatePlannedTimes,
  type AttendanceSettings,
  type Worksite,
} from '@packages/domain-types/attendance';

export function AttendanceSettingsPage() {
  const me = useAttendance();

  if (me.isError) {
    return (
      <p role="alert">
        설정을 불러오지 못했어요.{' '}
        <button onClick={() => me.refetch()}>다시 시도</button>
      </p>
    );
  }

  if (!me.data) {
    return <p className="text-sm text-slate-400">설정을 불러오고 있어요.</p>;
  }

  return <SettingsForm initial={me.data.settings} />;
}

function SettingsForm({ initial }: { initial: AttendanceSettings }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const mutation = useAttendanceAction(
    attendanceApi.settings,
    '내 설정을 저장했어요.'
  );

  function patch<K extends keyof AttendanceSettings>(
    key: K,
    value: AttendanceSettings[K]
  ) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function startChanged(value: string) {
    try {
      const planned = normalSchedule(value);

      setSettings((current) => ({
        ...current,
        normalStart: planned.start,
        normalEnd: planned.end,
      }));

      setError(null);
    } catch {
      patch('normalStart', value);

      setError('같은 날짜 안의 평소 근무 시각을 입력해 주세요.');
    }
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">내 근무·알림 설정</h1>
        <p className="mt-2 text-sm text-slate-400">
          평소 근무 시간과 필요한 알림을 설정해요.
        </p>
      </div>
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();

          const message = validatePlannedTimes(
            settings.normalStart,
            settings.normalEnd
          );

          setError(message);

          if (!message) {
            mutation.mutate(settings);
          }
        }}
      >
        <div className="space-y-5 rounded-2xl border bg-white p-6">
          <h2 className="text-sm font-semibold">평소 근무 시간</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-2 text-xs">
              출근
              <Input
                type="time"
                required
                value={settings.normalStart}
                onChange={(event) => startChanged(event.target.value)}
              />
            </label>
            <label className="space-y-2 text-xs">
              퇴근
              <Input
                type="time"
                required
                value={settings.normalEnd}
                onChange={(event) => patch('normalEnd', event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs leading-6 text-slate-400">
            반차 등록 시 예정 시각을 채우는 데 사용해요.
          </p>
        </div>
        <div className="space-y-6 rounded-2xl border bg-white p-6">
          <h2 className="text-sm font-semibold">내 출퇴근 알림</h2>
          {(['in', 'out'] as const).map((kind) => (
            <div key={kind} className="space-y-3">
              <label className="flex items-center justify-between text-sm">
                {kind === 'in' ? '출근' : '퇴근'} 알림
                <Switch
                  checked={settings[`${kind}Enabled`]}
                  onCheckedChange={(value) => patch(`${kind}Enabled`, value)}
                />
              </label>
              <Input
                aria-label={`${kind === 'in' ? '출근' : '퇴근'} 알림 시각`}
                type="time"
                required
                disabled={!settings[`${kind}Enabled`]}
                value={settings[`${kind}Time`]}
                onChange={(event) => patch(`${kind}Time`, event.target.value)}
              />
            </div>
          ))}
          <div>
            <p className="mb-3 text-xs text-slate-400">알림 받을 요일</p>
            <div className="flex flex-wrap gap-3">
              {'일월화수목금토'.split('').map((label, day) => (
                <label key={day} className="flex gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.weekdays.includes(day)}
                    onChange={(event) =>
                      patch(
                        'weekdays',
                        event.target.checked
                          ? [...settings.weekdays, day]
                          : settings.weekdays.filter((item) => item !== day)
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between text-sm">
            오늘은 알림 받지 않기
            <Switch
              checked={settings.skipDate === seoulDate(new Date())}
              onCheckedChange={(value) =>
                patch('skipDate', value ? seoulDate(new Date()) : null)
              }
            />
          </label>
          <p className="text-xs leading-6 text-slate-400">
            종일 휴가는 알림을 쉬어요. 반차인 날은 등록한 출퇴근 예정을
            사용해요.
          </p>
        </div>
        <label className="flex items-center justify-between rounded-2xl border bg-white p-6 text-sm">
          출퇴근 완료음
          <Switch
            checked={settings.sound}
            onCheckedChange={(value) => patch('sound', value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          설정 저장
        </Button>
      </form>
    </section>
  );
}

export function WorksiteSettings() {
  const me = useAttendance();
  const sites = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'worksites'],
    queryFn: attendanceApi.worksites,
    enabled: !!me.data?.isMaster,
  });

  if (me.isError) {
    return (
      <p role="alert">
        사용자 정보를 불러오지 못했어요.{' '}
        <button onClick={() => me.refetch()}>다시 시도</button>
      </p>
    );
  }

  if (!me.data) {
    return <p>근무지 설정을 불러오고 있어요.</p>;
  }

  if (!me.data.isMaster) {
    return <p role="alert">근무지 설정은 관리자만 변경할 수 있어요.</p>;
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">근무지 설정</h1>
        <p className="mt-2 text-sm text-slate-400">
          회사 좌표와 현장에서 확인한 허용 반경을 등록해요. 사용하지 않는
          근무지는 비활성화할 수 있어요.
        </p>
      </div>
      {sites.isError ? (
        <p role="alert" className="text-sm text-red-600">
          근무지를 불러오지 못했어요.{' '}
          <button onClick={() => sites.refetch()}>다시 시도</button>
        </p>
      ) : sites.isPending ? (
        <p>근무지를 불러오고 있어요.</p>
      ) : (
        <div className="space-y-4">
          {sites.data.map((site) => (
            <WorksiteForm key={`${site.id}:${site.version}`} site={site} />
          ))}
          {!sites.data.length && (
            <p className="text-sm text-slate-400">등록된 근무지가 없어요.</p>
          )}
        </div>
      )}
      <WorksiteForm />
    </section>
  );
}

type WorksiteFields = Pick<
  Worksite,
  'name' | 'latitude' | 'longitude' | 'radiusMeters' | 'accuracyMeters'
>;

function WorksiteForm({ site }: { site?: Worksite }) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState(site?.active ?? true);
  const mutation = useAttendanceAction(
    async (input: WorksiteFields & { active: boolean }) => {
      if (site) {
        return attendanceApi.updateSite({ ...site, ...input });
      }

      return attendanceApi.createSite({
        name: input.name,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        accuracyMeters: input.accuracyMeters,
      });
    },
    site ? '근무지를 수정했어요.' : '근무지를 등록했어요.'
  );

  return (
    <form
      className="space-y-4 rounded-2xl border bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();

        const form = new FormData(event.currentTarget);
        const input = {
          name: String(form.get('name')).trim(),
          latitude: Number(form.get('latitude')),
          longitude: Number(form.get('longitude')),
          radiusMeters: Number(form.get('radiusMeters')),
          accuracyMeters: Number(form.get('accuracyMeters')),
          active,
        };

        mutation.mutate(input);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{site ? site.name : '새 근무지 등록'}</h2>
        {site && (
          <span className="text-xs text-slate-400">
            {site.active ? '사용 중' : '비활성화됨'}
          </span>
        )}
      </div>
      {(
        [
          ['name', '근무지 이름', 'text'],
          ['latitude', '위도', 'number'],
          ['longitude', '경도', 'number'],
          ['radiusMeters', '허용 반경(m)', 'number'],
          ['accuracyMeters', '허용 위치 오차(m)', 'number'],
        ] as const
      ).map(([name, label, type]) => (
        <label key={name} className="block space-y-2 text-xs">
          {label}
          <Input
            name={name}
            type={type}
            defaultValue={site?.[name]}
            step={
              name === 'latitude' || name === 'longitude' ? 'any' : undefined
            }
            min={
              name === 'latitude'
                ? -90
                : name === 'longitude'
                  ? -180
                  : type === 'number'
                    ? 1
                    : undefined
            }
            max={
              name === 'latitude' ? 90 : name === 'longitude' ? 180 : undefined
            }
            required
            disabled={mutation.isPending}
          />
        </label>
      ))}
      {site && (
        <label className="flex items-center justify-between text-sm">
          근무지 사용
          <Switch
            checked={active}
            onCheckedChange={setActive}
            disabled={mutation.isPending}
          />
        </label>
      )}
      {mutation.isError && (
        <p role="alert" className="text-sm text-red-600">
          {attendanceError(mutation.error)}{' '}
          {site && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                queryClient.invalidateQueries({
                  queryKey: [...ATTENDANCE_KEY, 'worksites'],
                })
              }
            >
              최신 근무지 정보 다시 불러오기
            </button>
          )}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? '저장 중…' : site ? '변경 저장' : '근무지 등록'}
      </Button>
    </form>
  );
}
