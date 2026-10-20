'use client';

import { useState, type ReactNode } from 'react';
import {
  defaultWageRules,
  type PayBasis,
  type PayGroup,
  type WageRules,
} from '@packages/domain-types/attendance-wage';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useAddMinimumWage,
  useAddPayPolicy,
  useCreatePayGroup,
  useMinimumWages,
  usePayGroups,
  usePayPolicies,
  useUpdatePayGroup,
} from '../hooks/use-attendance-wage';
import { formatWon, seoulToday } from './lib/wage-format';
import { fieldClass, panelClass, WageHeading } from './wage-ui';

const ROUNDING_UNITS: readonly WageRules['rounding']['unitMinutes'][] = [
  1, 5, 10, 15, 30,
];

const CALENDAR_PRESETS = [
  {
    label: '전월 1일~말일, 다음 달 지급',
    periodCloseDay: 0,
    payMonthOffset: 1 as const,
  },
  {
    label: '전월 16일~당월 15일, 당월 지급',
    periodCloseDay: 15,
    payMonthOffset: 0 as const,
  },
];

export function WageSettings() {
  const groups = usePayGroups();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    (groups.data ?? []).find((group) => group.id === selectedId) ??
    groups.data?.[0];

  return (
    <section className="min-w-0 space-y-6">
      <WageHeading
        title="급여 설정"
        description="급여 그룹마다 지급일·정산 기간과 계산 규칙을 정해요. 규칙은 적용 시작일과 함께 이력으로 남고, 확정한 기간에는 영향을 주지 않아요."
      />
      {groups.isError ? (
        <p role="alert" className={`${panelClass} text-sm text-red-600`}>
          급여 그룹을 불러오지 못했어요.{' '}
          <button className="underline" onClick={() => groups.refetch()}>
            다시 시도
          </button>
        </p>
      ) : groups.isPending ? (
        <Skeleton
          className="h-48 w-full rounded-2xl"
          aria-label="급여 그룹을 불러오고 있어요."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <ul className="space-y-2">
              {(groups.data ?? []).map((group) => (
                <li key={group.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(group.id)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm ${selected?.id === group.id ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white text-slate-700'}`}
                  >
                    <span className="font-semibold">{group.name}</span>
                    <span className="ml-2 text-xs opacity-70">
                      {group.payBasis === 'hourly' ? '시급제' : '월급제'} · 매월{' '}
                      {group.payday}일{group.active ? '' : ' · 쓰지 않음'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <CreateGroupForm onCreated={setSelectedId} />
          </aside>
          <div className="min-w-0 space-y-6">
            {selected && (
              <GroupForm
                key={`${selected.id}:${selected.version}`}
                group={selected}
              />
            )}
            {selected && (
              <RulesSection key={`rules:${selected.id}`} group={selected} />
            )}
            <MinimumWageSection />
          </div>
        </div>
      )}
    </section>
  );
}

function CreateGroupForm({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreatePayGroup();
  const [name, setName] = useState('');
  const [payBasis, setPayBasis] = useState<PayBasis>('hourly');
  const [payday, setPayday] = useState(23);
  const [preset, setPreset] = useState(0);
  const [fivePlus, setFivePlus] = useState(true);
  const calendar = CALENDAR_PRESETS[preset] ?? CALENDAR_PRESETS[0];

  return (
    <Can run={useCreatePayGroup}>
      <div className={`${panelClass} space-y-3`}>
        <h2 className="text-sm font-bold text-slate-900">새 급여 그룹</h2>
        <input
          className={fieldClass}
          placeholder="이름(예: 학생)"
          value={name}
          maxLength={50}
          onChange={(event) => setName(event.target.value)}
          aria-label="그룹 이름"
        />
        <select
          className={fieldClass}
          value={payBasis}
          onChange={(event) =>
            setPayBasis(
              event.target.value === 'salaried' ? 'salaried' : 'hourly'
            )
          }
          aria-label="급여 방식"
        >
          <option value="hourly">시급제 — 금액까지 계산</option>
          <option value="salaried">월급제 — 근무시간 통계만</option>
        </select>
        <label className="block text-sm text-slate-600">
          지급일(매월)
          <input
            type="number"
            min={1}
            max={31}
            className={fieldClass}
            value={payday}
            onChange={(event) => setPayday(Number(event.target.value))}
          />
        </label>
        <select
          className={fieldClass}
          value={preset}
          onChange={(event) => setPreset(Number(event.target.value))}
          aria-label="정산 기간"
        >
          {CALENDAR_PRESETS.map((option, index) => (
            <option key={option.label} value={index}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={fivePlus}
            onChange={(event) => setFivePlus(event.target.checked)}
          />
          상시 5인 이상 사업장
        </label>
        <Button
          className="w-full"
          disabled={
            !name.trim() || payday < 1 || payday > 31 || create.isPending
          }
          onClick={() =>
            create.mutate(
              {
                name,
                payBasis,
                payday,
                periodCloseDay: calendar?.periodCloseDay ?? 0,
                payMonthOffset: calendar?.payMonthOffset ?? 1,
                rules: defaultWageRules(fivePlus),
              },
              {
                onSuccess: (group) => {
                  setName('');
                  onCreated(group.id);
                },
              }
            )
          }
        >
          그룹 만들기
        </Button>
      </div>
    </Can>
  );
}

function GroupForm({ group }: { group: PayGroup }) {
  const update = useUpdatePayGroup();
  const [name, setName] = useState(group.name);
  const [payday, setPayday] = useState(group.payday);
  const [periodCloseDay, setPeriodCloseDay] = useState(group.periodCloseDay);
  const [payMonthOffset, setPayMonthOffset] = useState<0 | 1>(
    group.payMonthOffset
  );

  return (
    <section className={panelClass}>
      <h2 className="mb-4 text-base font-bold text-slate-900">
        지급일·정산 기간
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          이름
          <input
            className={fieldClass}
            value={name}
            maxLength={50}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="text-sm text-slate-600">
          지급일(매월, 그 달에 없으면 말일)
          <input
            type="number"
            min={1}
            max={31}
            className={fieldClass}
            value={payday}
            onChange={(event) => setPayday(Number(event.target.value))}
          />
        </label>
        <label className="text-sm text-slate-600">
          정산 마감일(0 = 말일)
          <input
            type="number"
            min={0}
            max={31}
            className={fieldClass}
            value={periodCloseDay}
            onChange={(event) => setPeriodCloseDay(Number(event.target.value))}
          />
        </label>
        <label className="text-sm text-slate-600">
          지급 달
          <select
            className={fieldClass}
            value={payMonthOffset}
            onChange={(event) =>
              setPayMonthOffset(event.target.value === '0' ? 0 : 1)
            }
          >
            <option value={1}>마감 다음 달에 지급</option>
            <option value={0}>마감한 달에 지급</option>
          </select>
        </label>
      </div>
      <Can run={useUpdatePayGroup}>
        <div className="mt-4 flex gap-2">
          <Button
            disabled={update.isPending || !name.trim()}
            onClick={() =>
              update.mutate({
                id: group.id,
                version: group.version,
                name,
                payday,
                periodCloseDay,
                payMonthOffset,
              })
            }
          >
            저장
          </Button>
          <Button
            variant="outline"
            disabled={update.isPending}
            onClick={() =>
              update.mutate({
                id: group.id,
                version: group.version,
                active: !group.active,
              })
            }
          >
            {group.active ? '쓰지 않기' : '다시 쓰기'}
          </Button>
        </div>
      </Can>
    </section>
  );
}

function RuleRow({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 border-t py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_260px]">
      <div>
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{help}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function RulesSection({ group }: { group: PayGroup }) {
  const policies = usePayPolicies(group.id);
  const add = useAddPayPolicy();
  const latest = policies.data?.[policies.data.length - 1];
  const [draft, setDraft] = useState<WageRules | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    seoulToday(new Date())
  );
  const rules = draft ?? latest?.rules;

  if (policies.isError) {
    return (
      <p role="alert" className={`${panelClass} text-sm text-red-600`}>
        계산 규칙을 불러오지 못했어요.{' '}
        <button className="underline" onClick={() => policies.refetch()}>
          다시 시도
        </button>
      </p>
    );
  }

  if (!rules) {
    return (
      <Skeleton
        className="h-64 w-full rounded-2xl"
        aria-label="계산 규칙을 불러오고 있어요."
      />
    );
  }

  const set = (next: WageRules) => setDraft(next);

  return (
    <section className={panelClass}>
      <h2 className="text-base font-bold text-slate-900">계산 규칙</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        법정 판단(5인 이상 여부·근로자성 등)은 회사가 확인해 주세요. 시스템은
        정한 값으로 계산만 해요.
      </p>
      <RuleRow
        title="상시 5인 이상"
        help="5인 미만이면 연장·야간 가산이 법적 의무가 아니에요(약정하면 지급). 주 52시간 경고도 5인 이상일 때만 보여요."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rules.workplaceFivePlus}
            onChange={(event) =>
              set({ ...rules, workplaceFivePlus: event.target.checked })
            }
          />
          5인 이상
        </label>
      </RuleRow>
      <RuleRow
        title="휴게 시간 빼기"
        help="법정: 4시간이면 30분, 8시간이면 1시간(근로기준법 제54조). 시간표: 그날 시간표에 적은 휴게."
      >
        <select
          className={fieldClass}
          value={rules.breakDeduction}
          onChange={(event) =>
            set({
              ...rules,
              breakDeduction:
                event.target.value === 'schedule'
                  ? 'schedule'
                  : event.target.value === 'none'
                    ? 'none'
                    : 'legal',
            })
          }
        >
          <option value="legal">법정 기준</option>
          <option value="schedule">시간표의 휴게</option>
          <option value="none">빼지 않음</option>
        </select>
      </RuleRow>
      <RuleRow
        title="근무시간 반올림"
        help="1분 단위가 기본이에요. 회사에 유리하게 잘라내는 단위 반올림은 임금 체불 쟁점이 될 수 있어요."
      >
        <select
          className={fieldClass}
          value={rules.rounding.unitMinutes}
          onChange={(event) =>
            set({
              ...rules,
              rounding: {
                ...rules.rounding,
                unitMinutes:
                  ROUNDING_UNITS.find(
                    (unit) => unit === Number(event.target.value)
                  ) ?? 1,
              },
            })
          }
        >
          {ROUNDING_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}분 단위
            </option>
          ))}
        </select>
        <select
          className={fieldClass}
          aria-label="반올림 방식"
          value={rules.rounding.mode}
          onChange={(event) =>
            set({
              ...rules,
              rounding: {
                ...rules.rounding,
                mode:
                  event.target.value === 'ceil'
                    ? 'ceil'
                    : event.target.value === 'nearest'
                      ? 'nearest'
                      : 'floor',
              },
            })
          }
        >
          <option value="floor">버림</option>
          <option value="nearest">반올림</option>
          <option value="ceil">올림</option>
        </select>
        {rules.rounding.unitMinutes !== 1 && (
          <p className="text-xs text-red-600">
            단위 반올림은 정산 화면에 경고로 표시돼요.
          </p>
        )}
      </RuleRow>
      <RuleRow
        title="시간표 방식"
        help="자동: 그날 유효한 시간표가 있으면 시간표 기준, 없으면 하루 8시간·주 40시간 초과를 연장으로 봐요."
      >
        <select
          className={fieldClass}
          value={rules.schedule.mode}
          onChange={(event) =>
            set({
              ...rules,
              schedule: {
                mode:
                  event.target.value === 'fixed'
                    ? 'fixed'
                    : event.target.value === 'flexible'
                      ? 'flexible'
                      : 'auto',
              },
            })
          }
        >
          <option value="auto">자동</option>
          <option value="fixed">항상 시간표 기준</option>
          <option value="flexible">항상 8시간·40시간 기준</option>
        </select>
      </RuleRow>
      <RuleRow
        title="연장 가산"
        help="통상임금의 50% 이상(근로기준법 제56조). 인정 방식이 수동이면 판정한 연장만 금액에 들어가요."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rules.overtime.enabled}
            onChange={(event) =>
              set({
                ...rules,
                overtime: { ...rules.overtime, enabled: event.target.checked },
              })
            }
          />
          가산 지급
        </label>
        <input
          type="number"
          step="0.1"
          min={1}
          max={3}
          className={fieldClass}
          aria-label="연장 배율"
          value={rules.overtime.rate}
          onChange={(event) =>
            set({
              ...rules,
              overtime: { ...rules.overtime, rate: Number(event.target.value) },
            })
          }
        />
        <select
          className={fieldClass}
          aria-label="연장 인정 방식"
          value={rules.overtime.recognition}
          onChange={(event) =>
            set({
              ...rules,
              overtime: {
                ...rules.overtime,
                recognition: event.target.value === 'auto' ? 'auto' : 'manual',
              },
            })
          }
        >
          <option value="manual">관리자가 판정</option>
          <option value="auto">기록 그대로 인정</option>
        </select>
        <select
          className={fieldClass}
          aria-label="인정하지 않은 초과 시간"
          value={rules.overtime.unrecognized}
          onChange={(event) =>
            set({
              ...rules,
              overtime: {
                ...rules.overtime,
                unrecognized: event.target.value === 'base' ? 'base' : 'unpaid',
              },
            })
          }
        >
          <option value="unpaid">인정 안 한 시간은 지급 안 함</option>
          <option value="base">인정 안 한 시간도 기본 시급</option>
        </select>
      </RuleRow>
      <RuleRow
        title="야간 가산"
        help="22시~06시 근로에 통상임금의 50% 이상을 더해요(근로기준법 제56조)."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rules.night.enabled}
            onChange={(event) =>
              set({
                ...rules,
                night: { ...rules.night, enabled: event.target.checked },
              })
            }
          />
          가산 지급
        </label>
        <input
          type="number"
          step="0.1"
          min={0}
          max={2}
          className={fieldClass}
          aria-label="야간 가산율"
          value={rules.night.extraRate}
          onChange={(event) =>
            set({
              ...rules,
              night: { ...rules.night, extraRate: Number(event.target.value) },
            })
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="time"
            className={fieldClass}
            aria-label="야간 시작"
            value={rules.night.start}
            onChange={(event) =>
              set({
                ...rules,
                night: { ...rules.night, start: event.target.value },
              })
            }
          />
          <input
            type="time"
            className={fieldClass}
            aria-label="야간 끝"
            value={rules.night.end}
            onChange={(event) =>
              set({
                ...rules,
                night: { ...rules.night, end: event.target.value },
              })
            }
          />
        </div>
      </RuleRow>
      <RuleRow
        title="주휴수당"
        help="주 소정근로 15시간 이상이고 그 주를 개근하면, 8시간 × 주 소정시간 ÷ 40(40시간 상한)을 지급해요. 주는 마지막 날이 속한 기간에 넣어요."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rules.weeklyHoliday.enabled}
            onChange={(event) =>
              set({
                ...rules,
                weeklyHoliday: {
                  ...rules.weeklyHoliday,
                  enabled: event.target.checked,
                },
              })
            }
          />
          지급
        </label>
        <select
          className={fieldClass}
          aria-label="주 시작 요일"
          value={rules.weeklyHoliday.weekStartsOn}
          onChange={(event) =>
            set({
              ...rules,
              weeklyHoliday: {
                ...rules.weeklyHoliday,
                weekStartsOn: event.target.value === '7' ? 7 : 1,
              },
            })
          }
        >
          <option value={1}>주는 월요일부터</option>
          <option value={7}>주는 일요일부터</option>
        </select>
        <label className="block text-xs text-slate-500">
          주 최소 소정근로(시간)
          <input
            type="number"
            min={0}
            max={40}
            className={fieldClass}
            value={rules.weeklyHoliday.minWeeklyHours}
            onChange={(event) =>
              set({
                ...rules,
                weeklyHoliday: {
                  ...rules.weeklyHoliday,
                  minWeeklyHours: Number(event.target.value),
                },
              })
            }
          />
        </label>
      </RuleRow>
      <RuleRow
        title="휴가 등록일의 기본 판정"
        help="시간표상 근무일에 기록 없이 휴가를 등록한 날을 판정할 때 미리 골라 둘 값이에요. 판정은 관리자가 확정해요."
      >
        {(
          [
            ['full', '종일 휴가'],
            ['am', '오전 반차'],
            ['pm', '오후 반차'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rules.leavePaidDefault[key]}
              onChange={(event) =>
                set({
                  ...rules,
                  leavePaidDefault: {
                    ...rules.leavePaidDefault,
                    [key]: event.target.checked,
                  },
                })
              }
            />
            {label}는 유급
          </label>
        ))}
      </RuleRow>
      <RuleRow title="금액 절사" help="항목별 합계에서 한 번만 잘라요.">
        <select
          className={fieldClass}
          value={rules.wageRounding.unit}
          onChange={(event) =>
            set({
              ...rules,
              wageRounding: {
                unit: event.target.value === '10' ? 10 : 1,
                mode: 'floor',
              },
            })
          }
        >
          <option value={1}>1원 단위</option>
          <option value={10}>10원 단위</option>
        </select>
      </RuleRow>
      <Can run={useAddPayPolicy}>
        <div className="mt-4 flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-end">
          <label className="text-sm text-slate-600">
            적용 시작일
            <input
              type="date"
              className={fieldClass}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </label>
          <Button
            disabled={!draft || !effectiveFrom || add.isPending}
            onClick={() =>
              add.mutate(
                { groupId: group.id, effectiveFrom, rules },
                { onSuccess: () => setDraft(null) }
              )
            }
          >
            이 날부터 규칙 적용
          </Button>
        </div>
      </Can>
      {(policies.data ?? []).length > 1 && (
        <p className="mt-3 text-xs text-slate-500">
          규칙 이력:{' '}
          {(policies.data ?? [])
            .map((policy) => policy.effectiveFrom)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}

function MinimumWageSection() {
  const wages = useMinimumWages();
  const add = useAddMinimumWage();
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [hourlyWage, setHourlyWage] = useState('');

  return (
    <section className={panelClass}>
      <h2 className="text-base font-bold text-slate-900">최저임금</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        시급이 최저임금보다 낮으면 정산 화면에 경고를 띄워요(막지는 않아요).
        해마다 고시액을 추가해 주세요.
      </p>
      <ul className="mb-4 divide-y text-sm">
        {(wages.data ?? []).map((wage) => (
          <li key={wage.effectiveFrom} className="flex justify-between py-2">
            <span>{wage.effectiveFrom}부터</span>
            <span className="font-semibold">{formatWon(wage.hourlyWage)}</span>
          </li>
        ))}
      </ul>
      <Can run={useAddMinimumWage}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="text-sm text-slate-600">
            적용 시작일
            <input
              type="date"
              className={fieldClass}
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </label>
          <label className="text-sm text-slate-600">
            시간급(원)
            <input
              type="number"
              min={1}
              className={fieldClass}
              value={hourlyWage}
              onChange={(event) => setHourlyWage(event.target.value)}
            />
          </label>
          <Button
            disabled={
              !effectiveFrom || !(Number(hourlyWage) > 0) || add.isPending
            }
            onClick={() =>
              add.mutate(
                { effectiveFrom, hourlyWage: Math.floor(Number(hourlyWage)) },
                {
                  onSuccess: () => {
                    setEffectiveFrom('');
                    setHourlyWage('');
                  },
                }
              )
            }
          >
            추가
          </Button>
        </div>
      </Can>
    </section>
  );
}
