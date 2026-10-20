'use client';

import { useId, useState } from 'react';
import { Bell, Clock3, MapPin, Plus, Search, Volume2 } from 'lucide-react';
import { AddressSearchDialog } from '@/components/common/address-search-dialog';
import {
  AttendanceSettingsSkeleton,
  WorksiteSettingsSkeleton,
} from './attendance-settings-skeleton';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AttendanceTimeField } from './attendance-time-field';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { attendanceApi } from '@/lib/api/domains/attendance';
import {
  ATTENDANCE_KEY,
  attendanceError,
  useAttendance,
  useAttendanceAction,
} from '../hooks/use-attendance';
import { useAttendanceAccess } from '../hooks/use-attendance-access';
import {
  normalSchedule,
  seoulDate,
  validatePlannedTimes,
  type AttendanceSettings,
  type Worksite,
} from '@packages/domain-types/attendance';

export function AttendanceSettingsPage({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
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
    return <AttendanceSettingsSkeleton showHeading={showHeading} />;
  }

  return <SettingsForm initial={me.data.settings} showHeading={showHeading} />;
}

function SettingsForm({
  initial,
  showHeading,
}: {
  initial: AttendanceSettings;
  showHeading: boolean;
}) {
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
    <section className="mx-auto w-full max-w-2xl space-y-6 sm:space-y-8">
      <div>
        {showHeading && (
          <h1 className="text-[28px] leading-10 font-bold tracking-tight text-slate-950">
            내 근무·알림 설정
          </h1>
        )}
        <p
          className={`${showHeading ? 'mt-1' : ''} text-sm leading-6 text-slate-500`}
        >
          내 근무 리듬에 맞게 시간을 설정해 보세요.
        </p>
      </div>
      <form
        className="space-y-5"
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
        <div className="rounded-3xl border border-slate-200/70 bg-white p-5 sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Clock3 className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold leading-6 text-slate-900">
                평소 근무 시간
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                반차 일정의 출퇴근 예정 시각으로 사용해요.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AttendanceTimeField
              label="출근 시각"
              required
              value={settings.normalStart}
              onChange={startChanged}
            />
            <AttendanceTimeField
              label="퇴근 시각"
              required
              value={settings.normalEnd}
              onChange={(value) => patch('normalEnd', value)}
            />
          </div>
        </div>
        <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white">
          <div className="flex items-start gap-3 px-5 pt-5 pb-2 sm:px-6 sm:pt-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Bell className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold leading-6 text-slate-900">
                출퇴근 알림
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                잊지 않도록 원하는 시각에 알려드려요.
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-100 px-5 sm:px-6">
            {(['in', 'out'] as const).map((kind) => (
              <div key={kind} className="pt-2 pb-5">
                <SettingsToggleRow
                  title={`${kind === 'in' ? '출근' : '퇴근'} 알림`}
                  description={
                    settings[`${kind}Enabled`]
                      ? '설정한 시각에 알림을 받아요.'
                      : '이 알림을 받지 않아요.'
                  }
                  checked={settings[`${kind}Enabled`]}
                  onChange={(value) => patch(`${kind}Enabled`, value)}
                />
                <AttendanceTimeField
                  label={`${kind === 'in' ? '출근' : '퇴근'} 알림 시각`}
                  required
                  disabled={!settings[`${kind}Enabled`]}
                  value={settings[`${kind}Time`]}
                  onChange={(value) => patch(`${kind}Time`, value)}
                />
              </div>
            ))}
            <div className="py-5">
              <h3 className="text-sm font-semibold text-slate-800">
                알림 받을 요일
              </h3>
              <div className="mt-4 grid grid-cols-7 gap-1.5">
                {'일월화수목금토'.split('').map((label, day) => (
                  <label key={day} className="relative min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label={`${label}요일 알림`}
                      className="peer sr-only"
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
                    <span className="flex min-h-11 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-400 transition-colors peer-checked:bg-indigo-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2">
                      {label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <SettingsToggleRow
              title="오늘은 알림 받지 않기"
              description="오늘 하루만 알림을 쉬어요."
              checked={settings.skipDate === seoulDate(new Date())}
              onChange={(value) =>
                patch('skipDate', value ? seoulDate(new Date()) : null)
              }
            />
          </div>
          <p className="bg-slate-50/80 px-5 py-3 text-xs leading-6 text-slate-500 sm:px-6">
            종일 휴가에는 알림을 쉬고, 반차에는 등록한 출퇴근 예정을 사용해요.
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200/70 bg-white px-5 sm:px-6">
          <div className="flex items-center gap-3">
            <Volume2 className="size-5 shrink-0 text-slate-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <SettingsToggleRow
                title="출퇴근 완료음"
                description="출퇴근이 기록되면 소리로 알려드려요."
                checked={settings.sound}
                onChange={(value) => patch('sound', value)}
              />
            </div>
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-600"
          >
            {error}
          </p>
        )}
        <div className="pt-1">
          <p className="mb-3 text-center text-xs leading-6 text-slate-400">
            시간과 알림 변경은 저장한 뒤 적용돼요.
          </p>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="h-13 w-full rounded-2xl bg-indigo-600 text-base font-semibold hover:bg-indigo-700"
          >
            {mutation.isPending ? '저장 중…' : '설정 저장'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function SettingsToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();

  return (
    <label
      htmlFor={id}
      className="flex min-h-20 cursor-pointer items-center justify-between gap-4 py-4"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-6 text-slate-800">
          {title}
        </span>
        <span
          id={`${id}-description`}
          className="mt-0.5 block text-xs leading-5 text-slate-500"
        >
          {description}
        </span>
      </span>
      <Switch
        id={id}
        aria-label={title}
        aria-describedby={`${id}-description`}
        checked={checked}
        onCheckedChange={onChange}
        className="shrink-0 data-[state=checked]:bg-indigo-600"
      />
    </label>
  );
}

export function WorksiteSettings({
  showHeading = true,
}: {
  showHeading?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const me = useAttendance();
  const { canManageWorksites, worksitesState } = useAttendanceAccess();
  const sites = useQuery({
    queryKey: [...ATTENDANCE_KEY, 'worksites'],
    queryFn: attendanceApi.worksites,
    enabled: canManageWorksites,
  });

  if (me.isError) {
    return (
      <p role="alert">
        사용자 정보를 불러오지 못했어요.{' '}
        <button onClick={() => me.refetch()}>다시 시도</button>
      </p>
    );
  }

  if (worksitesState.status === 'error') {
    return (
      <p role="alert">
        권한 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.
      </p>
    );
  }

  if (!me.data || worksitesState.status === 'loading') {
    return <WorksiteSettingsSkeleton showHeading={showHeading} />;
  }

  if (!canManageWorksites) {
    return <p role="alert">근무지 설정을 바꿀 권한이 없어요.</p>;
  }

  if (sites.isPending) {
    return <WorksiteSettingsSkeleton showHeading={showHeading} />;
  }

  const selectedSite = sites.data?.find((site) => site.id === editingId);
  const activeCount = sites.data?.filter((site) => site.active).length ?? 0;

  return (
    <section className="max-w-xl space-y-6">
      <div>
        {showHeading && <h1 className="text-2xl font-bold">근무지 설정</h1>}
        <p className="mt-2 text-sm leading-6 text-slate-500">
          출퇴근할 근무지를 관리해요. 수정할 곳을 선택해 주세요.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          등록 {sites.data?.length ?? 0}곳 · 사용 중 {activeCount}곳
        </p>
        <Button className="min-h-11 gap-2" onClick={() => setEditingId('new')}>
          <Plus className="size-4" aria-hidden />
          근무지 추가
        </Button>
      </div>
      {sites.isError ? (
        <p role="alert" className="text-sm text-red-600">
          근무지를 불러오지 못했어요.{' '}
          <button onClick={() => sites.refetch()}>다시 시도</button>
        </p>
      ) : sites.data.length ? (
        <ul className="space-y-3" aria-label="등록된 근무지">
          {sites.data.map((site) => (
            <li
              key={site.id}
              className="min-w-0 rounded-2xl border bg-white p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words font-semibold">{site.name}</h2>
                    <span
                      className={`shrink-0 rounded-md px-2 py-1 text-xs ${site.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {site.active ? '사용 중' : '비활성'}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-sm leading-6 text-slate-500">
                    {site.address || '현재 위치로 등록한 근무지'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="min-h-11 shrink-0"
                  aria-label={`${site.name} 수정`}
                  onClick={() => setEditingId(site.id)}
                >
                  수정
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed bg-white px-5 py-10 text-center">
          <MapPin className="mx-auto mb-3 size-6 text-slate-400" aria-hidden />
          <p className="font-medium text-slate-700">
            아직 등록된 근무지가 없어요.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            근무지를 추가하면 출퇴근을 기록할 수 있어요.
          </p>
        </div>
      )}
      <Link
        href="/attendance"
        className="flex min-h-11 items-center justify-center rounded-lg bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        오늘의 근무로 돌아가기
      </Link>
      <Dialog
        open={editingId !== null}
        onOpenChange={(open) => !open && setEditingId(null)}
      >
        <DialogContent
          // 첫 입력칸에 포커스가 가면 휴대폰에서 키보드가 바로 올라와 주소·위치 버튼을 가린다
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl p-0 outline-none sm:max-w-xl [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center"
        >
          <DialogHeader className="border-b px-5 pt-5 pr-16 pb-4 text-left sm:px-6 sm:pr-16">
            <DialogTitle>
              {selectedSite ? '근무지 수정' : '새 근무지 등록'}
            </DialogTitle>
            <DialogDescription>
              주소를 검색하거나 현재 위치로 설정해 주세요.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-1 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6">
            <WorksiteForm
              key={selectedSite?.id ?? 'new'}
              site={selectedSite}
              onSaved={() => setEditingId(null)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type WorksiteFields = Pick<
  Worksite,
  | 'name'
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'radiusMeters'
  | 'accuracyMeters'
>;

function WorksiteForm({
  site,
  onSaved,
}: {
  site?: Worksite;
  onSaved: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const [active, setActive] = useState(site?.active ?? true);
  const [fields, setFields] = useState({
    name: site?.name ?? '',
    address: site?.address ?? '',
    latitude: site ? String(site.latitude) : '',
    longitude: site ? String(site.longitude) : '',
  });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const mutation = useAttendanceAction(
    async (input: WorksiteFields & { active: boolean }) => {
      if (site) {
        return attendanceApi.updateSite({ ...site, ...input });
      }

      return attendanceApi.createSite({
        name: input.name,
        address: input.address,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        accuracyMeters: input.accuracyMeters,
      });
    },
    site ? '근무지를 수정했어요.' : '근무지를 등록했어요.'
  );

  async function fillCurrentLocation() {
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError('이 기기에서는 위치를 확인할 수 없어요.');

      return;
    }

    setLocating(true);

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000,
          });
        }
      );

      const { latitude, longitude, accuracy } = position.coords;

      if (
        ![latitude, longitude, accuracy].every(Number.isFinite) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180 ||
        accuracy < 0 ||
        accuracy > 100
      ) {
        setLocationError(
          '현재 위치의 오차가 커요. 창가에서 다시 시도하거나 주소로 검색해 주세요.'
        );

        return;
      }

      setFields((current) => ({
        ...current,
        address: '',
        latitude: latitude.toFixed(7),
        longitude: longitude.toFixed(7),
      }));

      setResolvingAddress(true);

      try {
        const response = await fetch('/api/attendance/worksite-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || '현재 위치의 주소를 확인하지 못했어요.'
          );
        }

        setFields((current) => ({ ...current, address: result.address }));
      } catch {
        setLocationError(
          '위치는 설정했지만 주소를 가져오지 못했어요. 위치를 다시 확인하거나 주소로 검색해 주세요.'
        );
      } finally {
        setResolvingAddress(false);
      }
    } catch (error) {
      setLocationError(
        (error as GeolocationPositionError).code === 1
          ? '위치 권한을 허용하고 다시 눌러 주세요.'
          : '현재 위치를 확인하지 못했어요. 다시 시도하거나 주소로 검색해 주세요.'
      );
    } finally {
      setLocating(false);
    }
  }

  async function selectAddress({ address }: { address: string }) {
    setLocationError(null);
    setResolvingAddress(true);
    setFields((current) => ({
      ...current,
      address,
      latitude: '',
      longitude: '',
    }));

    try {
      const response = await fetch('/api/attendance/worksite-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || '주소의 위치를 확인하지 못했어요.');
      }

      setFields((current) => ({
        ...current,
        latitude: String(result.latitude),
        longitude: String(result.longitude),
      }));
    } catch (error) {
      setLocationError(
        error instanceof Error
          ? error.message
          : '주소의 위치를 확인하지 못했어요. 다시 시도해 주세요.'
      );
    } finally {
      setResolvingAddress(false);
    }
  }

  const hasLocation = fields.latitude !== '' && fields.longitude !== '';
  const locationBusy = locating || resolvingAddress;

  return (
    <form
      className="space-y-6 bg-white"
      onSubmit={(event) => {
        event.preventDefault();

        if (!hasLocation || locationBusy || mutation.isPending) {
          return;
        }

        const input = {
          name: fields.name.trim(),
          address: fields.address || null,
          latitude: Number(fields.latitude),
          longitude: Number(fields.longitude),
          radiusMeters: 300,
          accuracyMeters: 100,
          active,
        };

        mutation.mutate(input, { onSuccess: onSaved });
      }}
    >
      <div className="grid gap-5">
        <div className="relative min-w-0">
          <Input
            id={`${formId}-name`}
            name="name"
            placeholder=" "
            className="peer h-16 min-w-0 rounded-lg px-4 pt-7 pb-2 text-base md:text-base"
            value={fields.name}
            onChange={(event) =>
              setFields((current) => ({ ...current, name: event.target.value }))
            }
            required
            disabled={mutation.isPending}
          />
          <label
            htmlFor={`${formId}-name`}
            className={`pointer-events-none absolute left-4 text-slate-500 transition-all peer-focus:top-2 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-indigo-600 peer-disabled:opacity-50 motion-reduce:transition-none ${
              fields.name !== ''
                ? 'top-2 text-xs'
                : 'top-1/2 -translate-y-1/2 text-base'
            }`}
          >
            근무지 이름
          </label>
        </div>
        <div className="space-y-3">
          <button
            type="button"
            aria-label={
              fields.address
                ? `근무지 주소 변경: ${fields.address}`
                : '근무지 주소 검색'
            }
            aria-haspopup="dialog"
            aria-expanded={addressSearchOpen}
            className="group relative min-h-16 w-full rounded-lg border border-input bg-transparent px-4 pt-7 pr-12 pb-2 text-left text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={locationBusy || mutation.isPending}
            onClick={() => setAddressSearchOpen(true)}
          >
            <span
              className={`pointer-events-none absolute left-4 text-slate-500 transition-all group-focus:top-2 group-focus:translate-y-0 group-focus:text-xs group-focus:text-indigo-600 motion-reduce:transition-none ${
                fields.address || hasLocation
                  ? 'top-2 text-xs'
                  : 'top-1/2 -translate-y-1/2 text-base'
              }`}
            >
              근무지 주소
            </span>
            <span className="block min-w-0 break-words leading-6">
              {resolvingAddress ? (
                <Skeleton
                  className="h-6 w-full motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                fields.address ||
                (hasLocation ? (
                  '위치 설정됨 · 주소 확인 필요'
                ) : (
                  <span aria-hidden>&nbsp;</span>
                ))
              )}
            </span>
            <Search
              className="absolute top-1/2 right-4 size-5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
          </button>
          <p className="px-1 text-xs leading-6 text-slate-500">
            건물명이나 도로명 주소로 검색해 주세요.
          </p>
        </div>
        <div className="space-y-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full gap-2"
            disabled={locationBusy || mutation.isPending}
            onClick={fillCurrentLocation}
          >
            <MapPin className="size-4 shrink-0" aria-hidden />
            {locating ? '현재 위치 확인 중…' : '현재 위치로 설정하기'}
          </Button>
          <p className="px-1 text-xs leading-6 text-slate-500">
            지금 근무지에 있다면 현재 위치로 간편하게 설정할 수 있어요.
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6">
          {resolvingAddress ? (
            <div
              aria-busy="true"
              className="motion-reduce:[&_[data-slot=skeleton]]:animate-none"
            >
              <span role="status" className="sr-only">
                주소의 위치를 확인하고 있어요.
              </span>
              <Skeleton className="h-6 w-48 max-w-full" aria-hidden />
            </div>
          ) : (
            <p role="status" className="font-medium text-slate-700">
              {hasLocation
                ? fields.address
                  ? '선택한 주소로 근무지를 설정했어요.'
                  : '근무지 위치가 설정되어 있어요.'
                : '주소 또는 현재 위치를 선택해 주세요.'}
            </p>
          )}
          <p className="mt-2 text-xs leading-6 text-slate-500">
            근무지 주변 약 300m까지 출퇴근을 기록할 수 있어요. GPS 오차도
            고려하므로 건물 안에 정확히 있지 않아도 괜찮아요.
          </p>
        </div>
        {locationError && (
          <p role="alert" className="text-sm leading-6 text-red-600">
            {locationError}
          </p>
        )}
      </div>
      <AddressSearchDialog
        open={addressSearchOpen}
        onOpenChange={setAddressSearchOpen}
        onSelect={selectAddress}
        title="근무지 주소 검색"
      />
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
      <Button
        className="min-h-11 w-full sm:w-auto"
        type="submit"
        disabled={mutation.isPending || locationBusy || !hasLocation}
      >
        {mutation.isPending ? '저장 중…' : site ? '변경 저장' : '근무지 등록'}
      </Button>
    </form>
  );
}
